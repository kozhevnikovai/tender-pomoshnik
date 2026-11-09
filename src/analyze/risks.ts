// Риски закупки: несоответствия закону, жёсткие условия, признаки «заточки».
// Каждый риск — с цитатой из документа и нормой. Ничего не утверждаем без источника.
import { bidSecurityRange, rub } from "../law/calc.js";
import { ref, rule } from "../law/rules.js";
import type { DocText, Field, Law, Procedure, Requirement, Risk } from "../types.js";
import { sourceAt } from "../docs/quote.js";
import { wordsToNumber } from "./numwords.js";
import { fieldSource, fieldValue, money, type flags as flagsFn } from "./fields.js";
import { daysBetween } from "./deadlines.js";

type Flags = ReturnType<typeof flagsFn>;

/** «5 (пятнадцати) дней» — цифра и пропись не совпадают: какой срок действует, неясно */
export function numberMismatches(docs: DocText[]): Risk[] {
  const out: Risk[] = [];
  const re = /(?<![\d,.])(\d{1,3})\s*\(([а-яё ]{3,40})\)\s*(?:рабочих|календарных)?\s*(дн|час|месяц|процент|%)/gi;
  for (const d of docs) for (const p of d.parts) {
    const t = p.text.replace(/\s+/g, " ");
    for (const m of t.matchAll(re)) {
      if (/десят(?:ых|ой|ая)|сот(?:ых|ой|ая)|втор(?:ой|ая|ых)|половин|целы|тысячн/i.test(m[2])) continue;
      const w = wordsToNumber(m[2]);
      if (w != null && w !== +m[1] && out.length < 5) out.push({ id: `num-mismatch-${out.length + 1}`, title: "Цифра и пропись не совпадают", severity: "средний", detail: `«${m[0]}»: цифрой ${m[1]}, прописью ${w}. Какой срок или размер действует — уточните у заказчика`, source: sourceAt(d, p.n, t, m.index!, m[0].length), question: `Просим уточнить: в документации указано «${m[0]}» — цифрой ${m[1]}, прописью ${w}. Какое значение следует применять?` });
    }
  }
  return out;
}

export function findRisks(fields: Field[], law: Law | null, procedure: Procedure | null, f: Flags, reqs: Requirement[], now = new Date(), docs: DocText[] = []): Risk[] {
  const out: Risk[] = [...numberMismatches(docs)];
  const nmck = fieldValue(fields, "nmck") as number | null;
  const is44 = law === "44-ФЗ";

  // Срок оплаты
  const pay = fieldValue(fields, "payDays") as string | null;
  if (pay && is44) {
    const [d, kind] = pay.split(" ");
    const days = +d;
    const work = /рабоч/.test(kind ?? "");
    const lim = rule("44-34-13.1").params.workDays;
    if ((work && days > lim) || (!work && days > Math.ceil(lim * 7 / 5))) {
      out.push({ id: "pay-term", title: "Срок оплаты длиннее, чем разрешает закон", severity: "высокий", detail: `В контракте: ${days} ${work ? "рабочих" : kind ? "календарных" : ""} дн. По 44-ФЗ — не более ${lim} рабочих дней с подписания документа о приёмке (если иной срок не установлен законом).`, source: fieldSource(fields, "payDays"), law: [ref("44-34-13.1")], question: `Просим привести срок оплаты в проекте контракта в соответствие с ч. 13.1 ст. 34 Закона № 44-ФЗ (не более ${lim} рабочих дней с даты подписания документа о приёмке) либо указать норму закона, устанавливающую иной срок.`, complaint: true });
    }
  }

  // Срок подачи заявок
  const pub = fieldValue(fields, "published") as string | null;
  const dl = fieldValue(fields, "deadline") as string | null;
  if (is44 && pub && dl && procedure === "аукцион" && nmck) {
    const pr = rule("44-42-3-auction").params;
    const need = nmck > pr.big ? pr.bigDays : pr.days;
    const got = daysBetween(pub, dl);
    if (got < need) out.push({ id: "short-deadline", title: "Срок подачи заявок короче минимального", severity: "высокий", detail: `С ${pub} по ${dl.slice(0, 10)} — ${got} дн., а для аукциона нужно не менее ${need}.`, source: fieldSource(fields, "deadline"), law: [ref("44-42-3-auction")], complaint: true });
  }
  if (dl) {
    const left = (Date.parse(dl) - now.getTime()) / 864e5;
    if (left < 0) out.push({ id: "closed", title: "Приём заявок завершён", severity: "высокий", detail: `Окончание подачи заявок: ${dl.replace("T", " ")}`, source: fieldSource(fields, "deadline") });
    else if (left < 2) out.push({ id: "hurry", title: "До окончания подачи меньше 2 дней", severity: "высокий", detail: "Обеспечение заявки и документы нужно успеть подготовить заранее; запрос разъяснений уже, скорее всего, не успеть", source: fieldSource(fields, "deadline"), law: [ref(is44 ? "44-42-5" : "223-3.2-3")] });
  }

  // Обеспечение заявки
  const bs = fieldValue(fields, "bidSecurity") as string | null;
  if (is44 && bs && nmck) {
    const v = money(bs)!;
    const pctv = /%/.test(bs) ? v : v / nmck * 100;
    const r = bidSecurityRange(nmck);
    if (pctv > r.max + 0.01 || pctv < r.min - 0.01) out.push({ id: "bid-security", title: "Обеспечение заявки вне допустимого диапазона", severity: "высокий", detail: `${String(+pctv.toFixed(2)).replace(".", ",")}% НМЦК при допустимых ${r.min}–${r.max}%`, source: fieldSource(fields, "bidSecurity"), law: [ref("44-44-2")], question: "Просим привести размер обеспечения заявки в соответствие с ч. 2 ст. 44 Закона № 44-ФЗ.", complaint: true });
  }
  // Обеспечение контракта и гарантийных обязательств
  const cs = fieldValue(fields, "contractSecurity") as string | null;
  if (is44 && cs && /%/.test(cs)) {
    const v = money(cs)!;
    const p = rule("44-96-6").params;
    if (v > p.max || v < p.min) out.push({ id: "contract-security", title: "Обеспечение контракта вне диапазона 0,5–30%", severity: "высокий", detail: `Установлено ${cs}`, source: fieldSource(fields, "contractSecurity"), law: [ref("44-96-6")], complaint: true });
    else if (v >= 20) out.push({ id: "contract-security-high", title: "Высокое обеспечение контракта", severity: "средний", detail: `${cs} от цены — заложите стоимость банковской гарантии или заморозку денег`, source: fieldSource(fields, "contractSecurity"), law: [ref("44-96-6")] });
  }
  const ws = fieldValue(fields, "warrantySecurity") as string | null;
  if (is44 && ws && nmck) {
    const v = money(ws)!;
    const pctv = /%/.test(ws) ? v : v / nmck * 100;
    if (pctv > rule("44-96-2.2").params.max + 0.01) out.push({ id: "warranty-security", title: "Обеспечение гарантийных обязательств больше 10% НМЦК", severity: "высокий", detail: `${String(+pctv.toFixed(2)).replace(".", ",")}% НМЦК`, source: fieldSource(fields, "warrantySecurity"), law: [ref("44-96-2.2")], complaint: true });
  }

  // Штраф в контракте больше, чем по Правилам № 1042
  const fine = fieldValue(fields, "finePct") as number | null;
  if (is44 && fine != null && nmck) {
    const bands = rule("1042-3").params.bands as { upTo: number; pct: number }[];
    const lim = f.smpOnly ? rule("1042-4").params.pct : bands.find(b => nmck <= b.upTo)?.pct;
    if (lim != null && fine > lim) out.push({ id: "fine", title: "Штраф выше, чем по Правилам № 1042", severity: "средний", detail: `В контракте ${fine}% при допустимых ${lim}%${f.smpOnly ? " (закупка для СМП: 1%, но не более 5 000 ₽)" : ""}`, source: fieldSource(fields, "finePct"), law: [ref(f.smpOnly ? "1042-4" : "1042-3")], question: "Просим привести размер штрафа поставщика в соответствие с Правилами, утверждёнными ПП РФ от 30.08.2017 № 1042.", complaint: true });
  }

  // Короткий срок поставки
  const dd = fieldValue(fields, "deliveryDays") as string | null;
  if (dd) {
    const [d, kind] = dd.split(" ");
    if (+d <= 5) out.push({ id: "fast-delivery", title: "Очень короткий срок исполнения", severity: "средний", detail: `${d} ${/рабоч/.test(kind ?? "") ? "рабочих" : "календарных"} дн. Проверьте, успеете ли закупить и доставить; короткий срок бывает признаком того, что товар уже у «своего» поставщика`, source: fieldSource(fields, "deliveryDays"), question: "Просим обосновать срок поставки или рассмотреть возможность его увеличения: установленный срок ограничивает круг участников." });
  }

  // Товарный знак без эквивалента
  if (f.equivalentMissing) out.push({ id: "brand", title: "Товарный знак без слов «или эквивалент»", severity: "средний", detail: "Указание конкретной марки без эквивалента ограничивает конкуренцию, кроме исключительных случаев", source: f.equivalentMissing, law: [ref("44-33-1-1")], question: "Просим указать, допускается ли поставка эквивалента, и привести показатели эквивалентности.", complaint: true });

  // Признаки «заточки» в ТЗ
  const exact = reqs.filter(r => r.op === "=").length;
  if (reqs.length >= 8 && exact / reqs.length > 0.4) out.push({ id: "narrow-spec", title: "Много точных значений в ТЗ", severity: "средний", detail: `${exact} из ${reqs.length} характеристик заданы точным числом без диапазона — так описание может подходить одной модели. Проверьте по каталогам, сколько производителей подходят`, source: reqs.find(r => r.op === "=")?.source, law: [ref("44-33-1-1")], question: "Просим обосновать установление точных значений характеристик либо допустить диапазон значений." });

  // Аванса нет — кассовый разрыв (деловой риск, не нарушение)
  const adv = fieldValue(fields, "advance") as number | null;
  if (adv == null && nmck && nmck > 3e6) out.push({ id: "no-advance", title: "Аванс не найден", severity: "низкий", detail: `Поставку на ${rub(nmck)} придётся финансировать самим до оплаты. Проверьте проект контракта`, source: fieldSource(fields, "term") });

  if (law === "223-ФЗ") out.push({ id: "223-polozhenie", title: "Сверьте с положением о закупке заказчика", severity: "низкий", detail: "По 223-ФЗ сроки, обеспечение и антидемпинг задаёт положение о закупке — расчёты по 44-ФЗ к нему напрямую не применяются", law: [ref("223-polozhenie")] });
  return out;
}
