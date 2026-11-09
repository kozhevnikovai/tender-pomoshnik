import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeDocs } from "../src/analyze/index.js";
import { checkOffer, parseRequired } from "../src/analyze/requirements.js";
import { ruDate } from "../src/analyze/fields.js";
import { wordsToNumber } from "../src/analyze/numwords.js";
import { clarificationDraft, complaintDraft } from "../src/analyze/drafts.js";
import { contractPlan } from "../src/contract.js";
import { fromPlain } from "../src/docs/extract.js";
import { locate } from "../src/docs/quote.js";
import { cardDoc, parseCard, parseDocLinks, parseRss } from "../src/eis.js";
import { toIcs, toMarkdown } from "../src/export/text.js";
import { toHtml } from "../src/export/html.js";
import { antidumping, bidSecurity, contractSecurity, dailyPenalty, supplierFine } from "../src/law/calc.js";
import { rules, searchRules } from "../src/law/rules.js";
import { maskText } from "../src/privacy.js";
import type { CompanyProfile } from "../src/types.js";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const card44 = () => cardDoc({ regNumber: "0100000000026000001", url: "https://zakupki.gov.ru/x", law: "44-ФЗ", fields: parseCard(fx("card44.html")), docs: [] });
const NOW = new Date("2026-11-02T10:00:00+03:00");
const docs = () => [card44(), fromPlain("Проект контракта.txt", fx("contract.txt")), fromPlain("Описание объекта закупки.txt", fx("tz.txt"))];

describe("база норм", () => {
  it("у каждой карточки есть источник, редакция и статус", () => {
    for (const r of rules().rules) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      expect(r.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["verified", "check"]).toContain(r.status);
      for (const u of r.sources) expect(u).toMatch(/^https:\/\//);
    }
  });
  it("подтверждённые нормы — минимум два источника", () => {
    for (const r of rules().rules.filter(x => x.status === "verified")) expect(r.sources.length, r.id).toBeGreaterThanOrEqual(2);
  });
  it("поиск находит нормы по словам", () => {
    expect(searchRules("обеспечение заявки")[0].id).toMatch(/^44-44/);
    expect(searchRules("жалоба 223").some(r => r.id === "223-18.1")).toBe(true);
  });
});

describe("расчёты 44-ФЗ", () => {
  it("обеспечение заявки: диапазоны ч. 2 ст. 44", () => {
    expect(bidSecurity(2_000_000, 1).status).toBe("ok");
    expect(bidSecurity(2_000_000, 2).status).toBe("check");
    expect(bidSecurity(30_000_000, 5).status).toBe("ok");
    expect(bidSecurity(900_000, null).value).toMatch(/вправе не требовать/);
  });
  it("обеспечение контракта не меньше аванса", () => {
    expect(contractSecurity(1_000_000, 5, 300_000).value).toBe("300 000 ₽");
  });
  it("антидемпинг: пороги 25% и 15 млн ₽", () => {
    expect(antidumping({ law: "44-ФЗ", procedure: "аукцион", nmck: 10_000_000, price: 8_000_000, securityPercent: 10 }).value).toMatch(/не применяется/);
    expect(antidumping({ law: "44-ФЗ", procedure: "аукцион", nmck: 10_000_000, price: 7_000_000, securityPercent: 10 }).value).toMatch(/на выбор: полуторное обеспечение 1 050 000 ₽/);
    expect(antidumping({ law: "44-ФЗ", procedure: "конкурс", nmck: 20_000_000, price: 14_000_000, securityPercent: 10 }).value).toMatch(/полуторное обеспечение: 2 100 000 ₽/);
    expect(antidumping({ law: "44-ФЗ", procedure: "котировки", nmck: 1_000_000, price: 500_000, securityPercent: null }).value).toMatch(/не применяется/);
    expect(antidumping({ law: "223-ФЗ", procedure: "аукцион", nmck: 1_000_000, price: 500_000, securityPercent: 5 }).value).toMatch(/положению о закупке/);
  });
  it("штраф по ПП № 1042 и пеня 1/300", () => {
    expect(supplierFine(2_000_000, false).value).toBe("200 000 ₽ (10%)");
    expect(supplierFine(10_000_000, false).value).toBe("500 000 ₽ (5%)");
    expect(supplierFine(2_000_000, true).value).toBe("5 000 ₽");
    expect(supplierFine(50_000, true).value).toBe("1 000 ₽");
    expect(dailyPenalty(3_000_000, 0, 16.5).value).toBe("1 650 ₽");
  });
});

describe("ЕИС", () => {
  it("карточка 44-ФЗ: подписи без склейки соседних полей", () => {
    const c = parseCard(fx("card44.html"));
    expect(c.find(([k]) => k === "Преимущества")?.[1]).toMatch(/ч\. 3 ст\. 30/);
    expect(c.every(([k]) => k.length < 200)).toBe(true);
    expect(parseDocLinks(fx("card44.html"))[0].title).toBe("Проект контракта.docx");
  });
  it("карточка 223-ФЗ и ссылки на документы", () => {
    const c = parseCard(fx("card223.html"));
    expect(c.find(([k]) => k.startsWith("Способ"))?.[1]).toMatch(/^Запрос котировок/);
    expect(parseDocLinks(fx("card223.html"))[0].title).toBe("Извещение.doc");
  });
  it("RSS", () => {
    const items = parseRss(`<rss><channel><item><title>Электронный аукцион №0100000000026000001</title><link>https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=0100000000026000001</link><description>&lt;b&gt;бумага&lt;/b&gt;</description></item></channel></rss>`);
    expect(items[0].regNumber).toBe("0100000000026000001");
  });
  it("дата с часовым поясом МСК+N", () => {
    expect(ruDate("05.11.2026 09:00 (МСК+4)")).toBe("2026-11-05T09:00+07:00");
    expect(ruDate("05.11.2026 09:00 (МСК)")).toBe("2026-11-05T09:00+03:00");
    expect(ruDate("05.11.2026")).toBe("2026-11-05");
  });
});

describe("разбор закупки", () => {
  const r = analyzeDocs(docs(), { now: NOW });
  const v = (k: string) => r.fields.find(f => f.key === k)?.value;
  it("сведения из карточки и контракта — с цитатами, которые есть в тексте", () => {
    expect(r.law).toBe("44-ФЗ");
    expect(r.procedure).toBe("аукцион");
    expect(v("nmck")).toBe(2_500_000);
    expect(v("deadline")).toBe("2026-11-05T09:00+07:00");
    expect(v("payDays")).toBe("15 рабочих");
    expect(v("advance")).toBe(0);
    for (const f of r.fields) if (f.source) expect(locate(docs(), f.source.quote), f.key).not.toBeNull();
  });
  it("находит нарушения и риски со ссылками на нормы", () => {
    const ids = r.risks.map(x => x.id);
    expect(ids).toContain("pay-term");
    expect(ids).toContain("contract-security"); // 35% > 30%
    expect(ids).toContain("warranty-security");
    expect(ids).toContain("fine");
    expect(ids).toContain("brand");
    expect(ids).toContain("fast-delivery");
    expect(ids.some(i => i.startsWith("num-mismatch"))).toBe(true);
    expect(ids).toContain("short-deadline");
    for (const x of r.risks.filter(x => x.complaint)) expect(x.law?.length, x.id).toBeGreaterThan(0);
  });
  it("закупка для СМП: штраф по п. 4 Правил № 1042", () => {
    expect(r.risks.find(x => x.id === "fine")?.law?.[0].id).toBe("1042-4");
    expect(r.checklist.some(c => /СМП/.test(c.item))).toBe(true);
  });
  it("сроки: разъяснения за 3 дня, жалоба, итоги", () => {
    expect(r.deadlines.find(d => /разъяснений/.test(d.title))?.at).toBe("2026-11-02");
    expect(r.deadlines.some(d => /итогов/.test(d.title))).toBe(true);
  });
  it("характеристики ТЗ и проверка заявки", () => {
    expect(r.requirements.find(q => /Плотность/.test(q.name))).toMatchObject({ op: ">=", min: 80 });
    const res = checkOffer(r.requirements, { "Плотность": "80", "Белизна": "140" });
    expect(res.find(x => /Плотность/.test(x.name))?.ok).toBe(true);
    expect(res.find(x => /Белизна/.test(x.name))?.ok).toBe(false);
  });
  it("вердикт по профилю", () => {
    const profile: CompanyProfile = { name: "ООО Тест", okved: ["17.23"], msp: false, licenses: [], sro: [], contracts: [], products: [], regions: [], maxSecurity: 100_000 };
    const res = analyzeDocs(docs(), { now: NOW, profile });
    expect(res.fitSummary).toBe("нельзя");
    expect(res.fit.find(x => /СМП/.test(x.requirement))?.verdict).toBe("нельзя");
  });
  it("черновики, отчёты, календарь", () => {
    expect(clarificationDraft(r)).toMatch(/^ЧЕРНОВИК/);
    expect(clarificationDraft(r)).toMatch(/ч\. 5 ст\. 42/);
    expect(complaintDraft(r)).toMatch(/ст\. 105/);
    expect(toMarkdown(r)).toMatch(/Риски/);
    expect(toHtml(r)).toMatch(/Тендерный помощник/);
    expect(toIcs(r)).toMatch(/BEGIN:VEVENT/);
    expect(contractPlan(r, "2026-11-20").some(d => /Оплата/.test(d.title))).toBe(true);
  });
});

describe("прочее", () => {
  it("требования ТЗ, в т. ч. формулировки КТРУ", () => {
    expect(parseRequired("не менее 600 мм и не более 700 мм")).toMatchObject({ op: "range", min: 600, max: 700 });
    expect(parseRequired("Больше или равно 30 и Меньше 35")).toMatchObject({ op: "range", min: 30, max: 35 });
    expect(parseRequired("≤ 0.1 Градус Цельсия")).toMatchObject({ op: "<=", max: 0.1 });
    expect(parseRequired("белый")).toMatchObject({ op: "text" });
  });
  it("числа прописью", () => {
    expect(wordsToNumber("пятнадцати")).toBe(15);
    expect(wordsToNumber("сорока пяти")).toBe(45);
    expect(wordsToNumber("семи рабочих")).toBe(7);
  });
  it("маскирование персональных данных", () => {
    expect(maskText("тел. +7 (912) 345-67-89, ivan@mail.ru")).toBe("тел. [телефон], [почта]");
  });
});
