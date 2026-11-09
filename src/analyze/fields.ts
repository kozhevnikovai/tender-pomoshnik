// Извлечение сведений из извещения, проекта контракта и ТЗ по подписям полей (печатная форма ЕИС)
// и типовым формулировкам. Только правила — без модели, поэтому результат воспроизводим и проверяем.
import { sourceAt } from "../docs/quote.js";
import { ref } from "../law/rules.js";
import type { DocText, Field, Law, Procedure, Source } from "../types.js";

interface Hit { value: string; source: Source }

/** Плоский текст части без переносов — по нему и ищем, и цитируем */
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Подписи полей печатной формы извещения ЕИС (44-ФЗ и 223-ФЗ) */
const LABELS: Record<string, RegExp[]> = {
  noticeNumber: [/(?:номер извещения|извещение (?:о проведении [^№]{0,80})?(?:для закупки )?№)\s*:?\s*(\d{11,19})/i, /закупк[аи]\s*№\s*(\d{11,19})/i],
  title: [/наименование объекта закупки\s*:?\s*(.{5,300}?)(?=\s(?:способ определения|начальная|код|информация об|организация|этап)|$)/i, /наименование закупки\s*:?\s*(.{5,300}?)(?=\s(?:способ|начальная|сведения|предмет)|$)/i, /предмет (?:договора|контракта)\s*:?\s*(.{5,300}?)(?=\s(?:\d+\.|начальная|место)|$)/i],
  procedure: [/способ определения поставщика(?: \(подрядчика, исполнителя\))?\s*:?\s*(.{5,200}?)(?=\s(?:наименование электронной|адрес|организация|наименование)|$)/i, /способ (?:осуществления )?закупки\s*:?\s*(.{5,200}?)(?=\s(?:наименование|адрес)|$)/i],
  platform: [/наименование электронной площадки[^:]*?(?:интернет»?|сети)\s*:?\s*(.{3,80}?)(?=\s(?:адрес|организация|размещение)|$)/i, /(сбербанк-аст|ртс-тендер|росэлторг|ets ?\(?нэп\)?|етп газпромбанка|ртс тендер|тэк-торг|аст гоз|фабрикант|b2b-center|лот-онлайн|агз рт)/i],
  deadline: [/(?:дата и время окончания срока подачи заявок|окончани[ея] (?:срока )?подачи заявок)[^\d]{0,80}?(\d{2}\.\d{2}\.\d{4}(?:\s*(?:в\s*)?\d{1,2}[:.]\d{2})?(?:\s*\(?МСК(?:\s*[+-]\s*\d{1,2})?\)?)?)/i],
  results: [/дата подведения итогов[^\d]{0,80}?(\d{2}\.\d{2}\.\d{4})/i],
  auction: [/дата (?:и время )?проведения процедуры подачи предложений о цене[^\d]{0,140}?(\d{2}\.\d{2}\.\d{4})/i],
  published: [/(?:дата размещения(?: извещения)?|размещено|дата и время начала срока подачи заявок|дата начала срока подачи заявок)\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i],
  nmck: [/начальная \(максимальная\) цена (?:контракта|договора)[^\d]{0,40}?(\d[\d\s]*(?:[.,]\d{1,2})?)/i, /(?:нмцк|нмцд)\s*:?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)/i, /максимальное значение цены контракта[^\d]{0,40}?(\d[\d\s]*(?:[.,]\d{1,2})?)/i],
  bidSecurity: [/размер обеспечения заявки[^\d]{0,60}?(\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:%|процент|российск|руб|₽))/i],
  contractSecurity: [/размер обеспечения исполнения (?:контракта|договора)[^\d]{0,80}?(\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:%|процент|российск|руб|₽))/i, /обеспечени[ея] исполнения (?:контракта|договора) (?:устанавливается )?в размере\s*(\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:%|процент|российск|руб|₽))/i],
  warrantySecurity: [/размер обеспечения гарантийных обязательств[^\d]{0,80}?(\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:%|процент|российск|руб|₽))/i, /обеспечени[ея] гарантийных обязательств (?:устанавливается )?в размере\s*(\d[\d\s]*(?:[.,]\d{1,2})?\s*(?:%|процент|российск|руб|₽))/i],
  ikz: [/(?:идентификационный код закупки|икз)\s*(?:\(икз\))?\s*:?\s*(\d{36})/i],
  okpd2: [/(?:окпд\s?2?|ктру)[^\d]{0,40}?(\d{2}\.\d{2}(?:\.\d{1,3}){0,3}(?:-\d{8})?)/i],
  place: [/место (?:поставки товара, выполнения работы или оказания услуги|поставки|выполнения работ|оказания услуг)\s*:?\s*(.{5,200}?)(?=\s(?:предусмотрена|срок|сроки|дата|информация|требования)|$)/i],
  term: [/(?:срок исполнения контракта|дата окончания исполнения контракта|срок (?:поставки|выполнения работ|оказания услуг))\s*:?\s*(.{3,160}?)(?=\s(?:место|требования|информация|условия)|$)/i],
  customer: [/(?:наименование (?:заказчика|организации)|заказчик)\s*:?\s*((?:государственное|муниципальное|федеральное|бюджетное|казенное|автономное|акционерное|общество|публичное|гбу|гку|мбу|мку|мбоу|маоу|фгбу|фку|ао|пао|ооо)[^,]{5,200}?)(?=\s(?:почтовый|место нахождения|адрес|инн|ответственное)|$)/i],
  advance: [/(?:аванс\S*|авансирование)\s*(?:[-—:]\s*)?(не предусмотрен\S*|не выплачивается|не установлен\S*)/i, /аванс[^.]{0,80}?(\d{1,3}(?:[.,]\d+)?)\s*(?:%|процент)/i],
  payDays: [/оплат[аы][^.]{0,200}?(?:не позднее|в течение|в срок(?:,)? не (?:более|превышающий))\s*(\d{1,3})(?:\s*\([а-яё ]+\))?\s*(рабочих|календарных)?\s*дн/i],
  deliveryDays: [/(?:поставк[аи]|выполнени[ея] работ|оказани[ея] услуг)[^.]{0,120}?(?:в течение|не позднее|в срок не более)\s*(\d{1,3})(?:\s*\([а-яё ]+\))?\s*(рабочих|календарных)?\s*(?:дн|час)/i],
  acceptDays: [/приемк[аиу][^.]{0,160}?(?:в течение|не позднее|в срок не более)\s*(\d{1,3})(?:\s*\([а-яё ]+\))?\s*(рабочих|календарных)?\s*дн/i],
  finePct: [/штраф[^.]{0,200}?(\d{1,2}(?:[.,]\d+)?)\s*(?:%|процент)/i],
};

/** Совпадение отбрасывается, если в том же предложении есть эти слова */
const REJECT: Record<string, RegExp> = {
  deliveryDays: /оплат|гаранти|претензи|уведомлени|заявк[уи] на поставку|рассмотр|формирует|сформир|аванс|расторж|возврат|документ\S* о при[её]мк|подписыва|устран|замен|недостат|экспертиз/i,
  payDays: /аванс|неустойк|штраф|пен[ия]\b|возврат|требовани[ея] об уплате|соисполнител|субподрядчик/i,
  acceptDays: /оплат/i,
  finePct: /пен[ия]\b|ключев|ставк/i,
};
const sentence = (t: string, i: number, len: number) => {
  const a = Math.max(t.lastIndexOf(". ", i) + 1, 0);
  const b = t.indexOf(". ", i + len);
  return t.slice(a, b < 0 ? t.length : b);
};

/** Первое совпадение по документам в порядке приоритета (извещение → контракт → ТЗ) */
export function find(docs: DocText[], key: keyof typeof LABELS | string, only?: (d: DocText) => boolean): Hit | null {
  const res = LABELS[key];
  for (const re of res) for (const d of docs) {
    if (only && !only(d)) continue;
    for (const p of d.parts) {
      const t = flat(p.text);
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      for (const m of t.matchAll(g)) {
        if (REJECT[key] && REJECT[key].test(sentence(t, m.index!, m[0].length).slice(0, 400).replace(m[0], ""))) continue;
        const v = m.slice(1).filter(Boolean).join(" ").trim();
        return { value: v, source: sourceAt(d, p.n, t, m.index!, m[0].length) };
      }
    }
  }
  return null;
}

export const money = (s: string) => { const v = parseFloat(s.replace(/[^\d,.]/g, "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
export const isPercent = (s: string) => /%/.test(s);

/** «17.11.2026 09:00 (МСК+7)» → «2026-11-17T09:00+10:00». Без часового пояса — по Москве. */
export function ruDate(s: string | null | undefined): string | null {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s*(?:в\s*)?(\d{1,2})[:.](\d{2}))?/);
  if (!m) return null;
  if (!m[4]) return `${m[3]}-${m[2]}-${m[1]}`;
  const tz = s!.match(/МСК\s*([+-])\s*(\d{1,2})/);
  const off = 3 + (tz ? (tz[1] === "-" ? -1 : 1) * +tz[2] : 0);
  return `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, "0")}:${m[5]}${off >= 0 ? "+" : "-"}${String(Math.abs(off)).padStart(2, "0")}:00`;
}

export function detectLaw(docs: DocText[]): { law: Law | null; source?: Source } {
  let a = 0, b = 0;
  let src: Source | undefined;
  for (const d of docs) for (const p of d.parts) {
    const t = flat(p.text);
    const m44 = t.match(/44-?\s?ФЗ|№\s?44-ФЗ|о контрактной системе/gi)?.length ?? 0;
    const m223 = t.match(/223-?\s?ФЗ|о закупках товаров, работ, услуг отдельными видами/gi)?.length ?? 0;
    a += m44; b += m223;
    if (!src && (m44 || m223)) { const re = /44-?\s?ФЗ|223-?\s?ФЗ|о контрактной системе|отдельными видами юридических лиц/i; const m = re.exec(t)!; src = sourceAt(d, p.n, t, m.index, m[0].length); }
  }
  const num = find(docs, "noticeNumber")?.value;
  if (num?.length === 19) return { law: "44-ФЗ", source: src };
  if (num?.length === 11) return { law: "223-ФЗ", source: src };
  if (!a && !b) return { law: null };
  return { law: a >= b ? "44-ФЗ" : "223-ФЗ", source: src };
}

export function detectProcedure(s: string | null | undefined): Procedure | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/аукцион/.test(t)) return "аукцион";
  if (/конкурс/.test(t)) return "конкурс";
  if (/котиров/.test(t)) return "котировки";
  if (/предложени/.test(t)) return "запрос предложений";
  return "иное";
}

/** Признаки закупки только для СМП/СОНКО и нацрежима — с цитатами */
export function flags(docs: DocText[]) {
  const out: { smpOnly?: Source; smpSub?: Source; ban?: Source; limit?: Source; pref?: Source; license?: Source; sro?: Source; experience?: Source; equivalentMissing?: Source; brand?: Source } = {};
  const tests: [keyof typeof out, RegExp][] = [
    ["smpOnly", /(?:закупк[аи] (?:проводится )?(?:только )?у|участниками (?:закупки|которого|которой) могут быть только) субъект\S* малого (?:и среднего )?предпринимательства|ограничение участия[^.]{0,80}субъект\S* малого предпринимательства|(?:закупка|магазин\S*) [^.]{0,60}для субъектов малого и среднего предпринимательства|част[ьию]+ 3 стать[ия] 30|ч\. ?3 ст\. ?30 (?:закона|федерального|44)/i],
    ["smpSub", /привлечени[ея] (?:к исполнению контракта )?субподрядчик\S*,? соисполнител\S* из числа (?:субъектов малого|смп)/i],
    ["ban", /запрет\S* (?:на )?допуск\S*|запрет (?:на )?закуп\S* товаров, происходящих|приложени[ея] (?:№ ?)?1 к постановлению[^.]{0,60}1875/i],
    ["limit", /ограничени[ея] допуска|ограничени[ея] закуп\S* товаров, происходящих|приложени[ея] (?:№ ?)?2 к постановлению[^.]{0,60}1875/i],
    ["pref", /преимуществ\S* в отношении товаров российского происхождения|приложени[ея] (?:№ ?)?3 к постановлению[^.]{0,60}1875|национальн\S* режим/i],
    ["license", /(?:наличи[ея]|копи[яи]) (?:действующей )?лицензи[ия]|лицензи[ия] на (?:осуществление|деятельность)/i],
    ["sro", /член(?:ом|ство)? (?:в )?саморегулируем\S* организаци|членство в сро|выписк\S* из реестра членов сро/i],
    ["experience", /опыт\S* исполнения (?:договора|контракта)|дополнительные требования[^.]{0,80}(?:2571|ч\. 2 ст\. 31|части 2 статьи 31)/i],
    ["brand", /(?:товарн\S* знак\S*|марк[аиу]|модел[ьи])\s*[:–-]?\s*[«"][^»"]{2,40}[»"]/i],
  ];
  // Карточка ЕИС — официальный источник признаков закупки: если она есть, признаки СМП и нацрежима берём только из неё
  const card = docs.filter(d => d.name.startsWith("Карточка ЕИС"));
  for (const [k, re] of tests) {
    const pool = card.length && ["smpOnly", "ban", "limit", "pref"].includes(k) ? card : docs;
    const g = new RegExp(re.source, re.flags + "g");
    outer: for (const d of pool) for (const p of d.parts) {
      const t = flat(p.text);
      for (const m of t.matchAll(g)) {
        // «…в случае установления преимущества, предусмотренного ч. 3 ст. 30 | не требуется» — признак не установлен
        const after = t.slice(m.index! + m[0].length).replace(/размер преимущества не установлен/i, "");
        if (/^[^.;]{0,100}?(?:не требуется|не установлен|не предусмотрен|не применя)/i.test(after)) continue;
        if (/в случае(?: если| установления| предоставления)?[^.;]{0,110}$|информаци\S* о преимуществах[^.;]{0,80}$/i.test(t.slice(Math.max(0, m.index! - 150), m.index))) continue;
        out[k] = sourceAt(d, p.n, t, m.index!, m[0].length);
        break outer;
      }
    }
  }
  if (out.brand) {
    const near = docs.some(d => d.parts.some(p => /эквивалент/i.test(p.text)));
    if (!near) out.equivalentMissing = out.brand;
  }
  return out;
}

export function extractFields(docs: DocText[]): { fields: Field[]; law: Law | null; procedure: Procedure | null } {
  const { law, source: lawSrc } = detectLaw(docs);
  const fields: Field[] = [];
  const add = (key: string, label: string, h: Hit | null, value?: string | number | null, note?: string) =>
    fields.push({ key, label, value: h ? (value !== undefined ? value : h.value) : null, source: h?.source, status: h ? "ok" : "missing", note });
  fields.push({ key: "law", label: "Закон", value: law, source: lawSrc, status: law ? "ok" : "missing", law: law ? [ref(law === "44-ФЗ" ? "44-31" : "223-polozhenie")] : undefined });
  add("noticeNumber", "Номер извещения", find(docs, "noticeNumber"));
  add("title", "Объект закупки", find(docs, "title"));
  const proc = find(docs, "procedure");
  const procedure = detectProcedure(proc?.value);
  add("procedure", "Способ закупки", proc, procedure ?? proc?.value);
  add("customer", "Заказчик", find(docs, "customer"));
  add("platform", "Электронная площадка", find(docs, "platform"));
  const nm = find(docs, "nmck");
  add("nmck", "НМЦК, ₽", nm, nm ? money(nm.value) : null);
  add("published", "Дата размещения", find(docs, "published"), ruDate(find(docs, "published")?.value));
  const dl = find(docs, "deadline");
  add("deadline", "Окончание подачи заявок", dl, ruDate(dl?.value));
  add("auction", "Дата торгов", find(docs, "auction"), ruDate(find(docs, "auction")?.value));
  add("results", "Подведение итогов", find(docs, "results"), ruDate(find(docs, "results")?.value));
  for (const [key, label] of [["bidSecurity", "Обеспечение заявки"], ["contractSecurity", "Обеспечение контракта"], ["warrantySecurity", "Обеспечение гарантийных обязательств"]] as const) {
    const h = find(docs, key);
    add(key, label, h, h ? h.value.replace(/российск\S*/i, "₽").replace(/\s+/g, " ").trim() : null);
  }
  add("ikz", "ИКЗ", find(docs, "ikz"));
  add("okpd2", "ОКПД2 / КТРУ", find(docs, "okpd2"));
  add("place", "Место поставки", find(docs, "place"));
  add("term", "Срок исполнения", find(docs, "term"));
  const adv = find(docs, "advance");
  add("advance", "Аванс, %", adv, adv ? money(adv.value) : null);
  const pay = find(docs, "payDays");
  add("payDays", "Срок оплаты", pay, pay ? pay.value : null);
  const del = find(docs, "deliveryDays");
  add("deliveryDays", "Срок поставки/работ", del, del ? del.value : null);
  const acc = find(docs, "acceptDays");
  add("acceptDays", "Срок приёмки", acc, acc ? acc.value : null);
  return { fields, law, procedure };
}

export const fieldValue = (fields: Field[], key: string) => fields.find(f => f.key === key)?.value ?? null;
export const fieldSource = (fields: Field[], key: string) => fields.find(f => f.key === key)?.source;
