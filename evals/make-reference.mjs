// Эталон из карточки ЕИС: точные подписи полей → ожидаемые значения. Контактные данные не берём.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseCard } from "../dist/eis.js";
const DATA = process.env.EVAL_DATA ?? "evals/data";
const CASES = process.env.EVAL_CASES ?? "evals/cases";
const picked = JSON.parse(readFileSync(`${DATA}/picked.json`, "utf8"));
const money = s => { const x = s?.match(/\d[\d\s\u00a0]*(?:,\d+)?/); return x ? +x[0].replace(/[\s\u00a0]/g, "").replace(",", ".") : null; };
const date = s => { const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}:${m[5]}` : ""}` : null; };
const exclude = new Set(process.env.EVAL_EXCLUDE ? readFileSync(process.env.EVAL_EXCLUDE, "utf8").split(/\s+/) : []);
for (const p of picked) {
  if (exclude.has(p.reg)) continue;
  if (/единственн/i.test(p.title) || p.files.length === 0) { writeFileSync(`${CASES}/${p.reg}.json`, JSON.stringify({ reg: p.reg, skip: "неконкурентная закупка или нет документов" })); continue; }
  const card = parseCard(readFileSync(`${DATA}/${p.reg}/card.html`, "utf8"));
  const g = (...labels) => card.find(([k]) => labels.some(l => k.toLowerCase().startsWith(l.toLowerCase())))?.[1] ?? null;
  const all = card.map(([k, v]) => `${k}: ${v}`).join("\n");
  const proc = g("Способ определения поставщика", "Способ осуществления закупки") ?? p.title;
  if (/единственн/i.test(proc)) { writeFileSync(`${CASES}/${p.reg}.json`, JSON.stringify({ reg: p.reg, skip: "закупка у единственного поставщика" })); continue; }
  const ref = {
    reg: p.reg, title: p.title, url: p.url,
    expected: {
      law: p.reg.length === 11 ? "223-ФЗ" : "44-ФЗ",
      procedure: /аукцион/i.test(proc) ? "аукцион" : /конкурс/i.test(proc) ? "конкурс" : /котиров/i.test(proc) ? "котировки" : /предложени/i.test(proc) ? "запрос предложений" : "иное",
      noticeNumber: p.reg,
      nmck: money(g("Начальная (максимальная) цена контракта", "Начальная (максимальная) цена договора")),
      deadline: date(g("Дата и время окончания срока подачи заявок")),
      results: date(g("Дата подведения итогов")),
      bidSecurity: g("Требуется обеспечение заявки") === "Да" ? money(g("Размер обеспечения заявки")) : null,
      contractSecurity: g("Требуется обеспечение исполнения контракта") === "Да" ? { value: money(g("Размер обеспечения исполнения контракта")), unit: /%/.test(g("Размер обеспечения исполнения контракта") ?? "") ? "%" : "₽" } : null,
      smpOnly: /ч\. 3 ст\. 30|могут быть только субъекты малого|для субъектов малого и среднего предпринимательства/i.test(all),
      nationalBan: /Запрет закупок товаров, происходящих/i.test(all),
    },
    // размечено вручную по проекту контракта: null — в документах нет / не применимо
    manual: existsSync(`${CASES}/${p.reg}.json`) ? JSON.parse(readFileSync(`${CASES}/${p.reg}.json`, "utf8")).manual ?? {} : {},
  };
  writeFileSync(`${CASES}/${p.reg}.json`, JSON.stringify(ref, null, 2));
}
console.log(readdirSync(CASES).length, "cases");
