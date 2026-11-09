// Полный разбор закупки: документы → сведения → расчёты → риски → «подходит ли нам» → сроки → чек-лист.
import { extractFile } from "../docs/extract.js";
import { antidumping, bidSecurity, contractSecurity, dumpingThreshold, rub, supplierFine } from "../law/calc.js";
import { editionWarning, ref, rules } from "../law/rules.js";
import type { CompanyProfile, DocText, Report } from "../types.js";
import { VERSION } from "../version.js";
import { buildDeadlines } from "./deadlines.js";
import { extractFields, fieldValue, find, flags, money } from "./fields.js";
import { assessFit } from "./fit.js";
import { extractRequirements } from "./requirements.js";
import { findRisks } from "./risks.js";

export const DISCLAIMER = "Тендерный помощник — помощник, а не юридическая консультация. Сведения взяты из документов закупки и базы норм на дату обновления; пункты со статусом «проверить» сверьте с первоисточником. Решение об участии, проверка и подача заявки — за вами.";

export interface AnalyzeOptions { profile?: CompanyProfile; ocr?: boolean; now?: Date; extraDocs?: DocText[] }

/** Порядок важности документов: карточка ЕИС → извещение → контракт → ТЗ → прочее */
function rank(d: DocText) {
  const n = d.name.toLowerCase();
  if (n.startsWith("карточка еис")) return 0;
  if (/извещ|информационн|печатн/.test(n)) return 1;
  if (/контракт|договор/.test(n)) return 2;
  if (/описани|тз|техническ|задани|специфик/.test(n)) return 3;
  return 4;
}

export async function analyzeFiles(files: string[], o: AnalyzeOptions = {}): Promise<Report> {
  const docs: DocText[] = [...(o.extraDocs ?? [])];
  for (const f of files) docs.push(await extractFile(f, { ocr: o.ocr }));
  return analyzeDocs(docs, o);
}

export function analyzeDocs(input: DocText[], o: AnalyzeOptions = {}): Report {
  const docs = [...input].sort((a, b) => rank(a) - rank(b));
  const { fields, law, procedure } = extractFields(docs);
  const contract = docs.filter(d => rank(d) === 2);
  // условия контракта ищем прежде всего в проекте контракта
  const onlyContract = (key: string) => contract.length ? find(contract, key) ?? find(docs, key) : find(docs, key);
  for (const key of ["payDays", "deliveryDays", "acceptDays", "advance"]) {
    const h = onlyContract(key);
    const f = fields.find(x => x.key === key)!;
    if (h) { f.value = key === "advance" ? (/^не/.test(h.value) ? 0 : money(h.value)) : h.value; f.source = h.source; f.status = "ok"; }
  }
  const fine = onlyContract("finePct");
  fields.push({ key: "finePct", label: "Штраф в контракте, %", value: fine ? money(fine.value) : null, source: fine?.source, status: fine ? "ok" : "missing" });

  const fl = flags(docs);
  const reqs = extractRequirements(docs.filter(d => rank(d) >= 2));
  const nmck = fieldValue(fields, "nmck") as number | null;
  const pctOf = (key: string) => { const v = fieldValue(fields, key) as string | null; if (!v) return null; const n = money(v); return n == null ? null : /%/.test(v) ? n : nmck ? n / nmck * 100 : null; };
  const bsPct = pctOf("bidSecurity");
  const csPct = pctOf("contractSecurity");

  const calcs = [];
  const warnings: string[] = [];
  if (nmck && law === "44-ФЗ") {
    calcs.push(bidSecurity(nmck, bsPct));
    if (csPct != null) calcs.push(contractSecurity(nmck, csPct, (fieldValue(fields, "advance") as number | null) ? nmck * (fieldValue(fields, "advance") as number) / 100 : 0));
    const thr = dumpingThreshold(nmck);
    calcs.push({ label: "Порог антидемпинга", value: `цена ниже ${rub(thr)} (−25%)`, formula: `${rub(nmck)} × 0,75`, law: [ref("44-37-scope")], status: "ok" as const });
    calcs.push(antidumping({ law, procedure, nmck, price: thr * 0.99, securityPercent: csPct }));
    calcs.push(supplierFine(nmck, !!fl.smpOnly));
  } else if (nmck && law === "223-ФЗ") {
    calcs.push({ label: "Обеспечение и антидемпинг", value: "по положению о закупке заказчика", formula: "", law: [ref("223-polozhenie")], status: "check" as const });
  }
  const pub = fieldValue(fields, "published") as string | null;
  for (const id of ["44-37-484", "44-138", "1875-proof"]) { const w = editionWarning(id, pub); if (w && law === "44-ФЗ") warnings.push(w); }
  if (!nmck) warnings.push("НМЦК не найдена — расчёты обеспечения и антидемпинга не выполнены. Добавьте извещение или карточку ЕИС");
  if (!docs.some(d => rank(d) === 2)) warnings.push("Нет проекта контракта — условия оплаты, приёмки и штрафов не проверены");
  if (!reqs.length) warnings.push("Характеристики товара из ТЗ не найдены (ТЗ в виде таблицы DOCX читается лучше всего)");
  for (const d of docs) warnings.push(...d.warnings.map(w => `${d.name}: ${w}`));

  const risks = findRisks(fields, law, procedure, fl, reqs, o.now, docs);
  const fit = o.profile ? assessFit({ law, nmck, bidSecurity: bsPct != null && nmck ? nmck * bsPct / 100 : null, contractSecurity: csPct != null && nmck ? nmck * csPct / 100 : null, okpd2: fieldValue(fields, "okpd2") as string | null, place: fieldValue(fields, "place") as string | null, flags: fl, profile: o.profile }) : null;

  const checklist: Report["checklist"] = [];
  if (law === "44-ФЗ") {
    checklist.push({ item: "Предложение участника: характеристики товара строго по ТЗ (конкретные значения) и страна происхождения", law: [ref("44-43")] });
    checklist.push({ item: "Декларация о соответствии единым требованиям (ст. 31)", law: [ref("44-31")] });
  } else checklist.push({ item: "Состав заявки — по документации и положению о закупке заказчика", law: [ref("223-polozhenie")] });
  if (fl.smpOnly) checklist.push({ item: "Декларация о принадлежности к СМП/СОНКО", source: fl.smpOnly, law: [ref("44-30-1")] });
  if (fl.ban || fl.limit || fl.pref) checklist.push({ item: "Номера реестровых записей (промышленная продукция / ПО) для нацрежима", source: fl.ban ?? fl.limit ?? fl.pref, law: [ref("1875-proof")] });
  if (fl.license) checklist.push({ item: "Лицензия (номер, дата, вид деятельности)", source: fl.license });
  if (fl.sro) checklist.push({ item: "Членство в СРО", source: fl.sro });
  if (fl.experience) checklist.push({ item: "Документы об опыте: исполненный контракт и акт приёмки", source: fl.experience });
  if (nmck && bsPct) checklist.push({ item: `Обеспечение заявки ${rub(nmck * bsPct / 100)}: деньги на спецсчёте или независимая гарантия`, law: [ref("44-44-2")] });
  if (csPct) checklist.push({ item: `Обеспечение контракта ${String(+csPct.toFixed(2)).replace(".", ",")}% — подготовить к подписанию (при снижении ≥25% — в 1,5 раза больше)`, law: [ref("44-96-6"), ref("44-37-scope")] });
  checklist.push({ item: "Электронная подпись руководителя (или доверенность) и аккредитация на площадке — подаёте вы сами" });

  return {
    version: VERSION, createdAt: (o.now ?? new Date()).toISOString(), rulesVersion: rules().version, rulesCount: rules().rules.length,
    law, procedure, noticeNumber: fieldValue(fields, "noticeNumber") as string | null, title: fieldValue(fields, "title") as string | null,
    docs: docs.map(d => ({ name: d.name, kind: d.kind, unit: d.unit, parts: d.parts.length, ocrParts: d.parts.filter(p => p.ocr).length, warnings: d.warnings })),
    fields, calcs, fit: fit?.items ?? [], fitSummary: fit?.summary ?? null, risks, deadlines: buildDeadlines(fields, law), requirements: reqs, checklist, warnings, disclaimer: DISCLAIMER,
  };
}
