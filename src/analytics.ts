// Аналитика заказчика по открытой части ЕИС: последние закупки заказчика, этапы, отмены, типичная цена и предметы.
// Источник — официальный RSS поиска ЕИС (до 50 последних закупок); победители и снижение цены —
// со страниц «Результаты определения поставщика» завершённых закупок 44-ФЗ.
import { fetchResults, searchRss, type SearchItem } from "./eis.js";
import { winnerOf, type TenderResult } from "./results.js";

export interface CustomerStats {
  customer: string;
  total: number;
  byStage: Record<string, number>;
  cancelledShare: number | null;
  medianPrice: number | null;
  priceRange: [number, number] | null;
  topWords: string[];
  recent: { regNumber: string; title: string; price: number | null; stage: string | null; published?: string; url: string }[];
  /** Итоги завершённых закупок: победитель, цена контракта, снижение от НМЦК */
  results?: { regNumber: string; title: string; winner: string; price: number | null; reduction: number | null }[];
  /** Чаще всего выигрывают */
  winners?: { name: string; wins: number }[];
  /** Среднее снижение от НМЦК, % */
  avgReduction?: number | null;
  notes: string[];
}

/** Итоги по завершённым закупкам: кто выигрывает и насколько снижают цену */
export function withResults(st: CustomerStats, res: TenderResult[]): CustomerStats {
  const rows = res.map(r => {
    const w = winnerOf(r);
    return w ? { regNumber: r.regNumber, title: st.recent.find(x => x.regNumber === r.regNumber)?.title ?? "", winner: w.supplier, price: w.price, reduction: r.reduction } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const wins: Record<string, number> = {};
  for (const r of rows) wins[r.winner] = (wins[r.winner] ?? 0) + 1;
  const reds = rows.map(r => r.reduction).filter((x): x is number => x != null);
  const notes = st.notes.filter(n => !n.startsWith("Победители"));
  if (rows.length) notes.push(`Итоги — по ${rows.length} завершённым закупкам 44-ФЗ с заключённым контрактом`);
  else notes.push("Завершённых закупок 44-ФЗ с заключённым контрактом среди последних не нашлось — победителей и снижение посчитать не по чему");
  const top = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  if (top[0] && rows.length >= 3 && top[0][1] / rows.length >= 0.5) notes.push(`Один поставщик выигрывает больше половины закупок заказчика: ${top[0][0]} (${top[0][1]} из ${rows.length})`);
  return { ...st, results: rows, winners: top.slice(0, 5).map(([name, n]) => ({ name, wins: n })), avgReduction: reds.length ? Math.round(reds.reduce((a, b) => a + b, 0) / reds.length * 10) / 10 : null, notes };
}

/** Значение после метки «… цена …:» — без регулярных выражений с откатами (описание приходит из сети) */
function after(d: string, label: RegExp): string | null {
  const m = label.exec(d.slice(0, 4000));
  return m ? d.slice(m.index + m[0].length, m.index + m[0].length + 200) : null;
}
const priceOf = (d: string) => {
  const v = after(d, /(?:начальная|максимальная)[^:]{0,40}цена[^:]{0,40}:/i)?.trimStart().match(/^[\d ]{1,20}(?:[.,]\d{1,2})?/)?.[0];
  const n = v ? Number(v.replace(/ /g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** Этап — текст до следующей метки «Размещено:», «Обновлено:» и т. п.: последнее слово с заглавной перед двоеточием — уже метка */
const stageOf = (d: string) => {
  const rest = after(d, /[Ээ]тап (?:размещения|закупки) ?:/);
  if (rest == null) return null;
  const words = rest.split(":")[0].trim().split(" ").filter(Boolean);
  let label = -1;
  if (rest.includes(":")) for (let k = words.length - 1; k > 0; k--) if (/^[А-ЯЁ]/.test(words[k])) { label = k; break; }
  const stage = (label > 0 ? words.slice(0, label) : words).join(" ").trim();
  return stage || null;
};
const STOP = new Set(["поставка", "поставки", "оказание", "услуг", "услуги", "выполнение", "работ", "работы", "нужд", "нужды", "для", "товаров", "товара", "закупка", "право", "заключения", "договора", "контракта", "году", "года", "годов", "учреждения", "оказанию", "выполнению"]);

const stripNumber = (t: string) => { const x = t.trim(); const m = /^№? ?\d{11,19}/.exec(x); return m ? x.slice(m[0].length).replace(/^[ .—-]{0,5}/, "") : x; };

export function summarize(customer: string, items: SearchItem[]): CustomerStats {
  const recent = items.map(i => ({ regNumber: i.regNumber, title: stripNumber(i.title), price: priceOf(i.description), stage: stageOf(i.description), published: i.published, url: i.url }));
  const byStage: Record<string, number> = {};
  for (const r of recent) { const k = r.stage ?? "не указан"; byStage[k] = (byStage[k] ?? 0) + 1; }
  const cancelled = recent.filter(r => /отмен/i.test(r.stage ?? "")).length;
  const prices = recent.map(r => r.price).filter((x): x is number => x != null).sort((a, b) => a - b);
  const words: Record<string, number> = {};
  for (const r of recent) for (const w of new Set(r.title.toLowerCase().match(/[а-яё]{5,}/g) ?? [])) if (!STOP.has(w)) words[w] = (words[w] ?? 0) + 1;
  const notes: string[] = [];
  if (!recent.length) notes.push("В ЕИС не найдено закупок с таким названием заказчика — проверьте название (как в извещении)");
  if (recent.length >= 50) notes.push("Показаны 50 последних закупок");
  if (recent.length && cancelled / recent.length >= 0.2) notes.push(`Заказчик часто отменяет закупки: ${cancelled} из ${recent.length}`);
  notes.push("Победители и снижение цены — по завершённым закупкам 44-ФЗ");
  return {
    customer, total: recent.length, byStage,
    cancelledShare: recent.length ? Math.round(cancelled / recent.length * 100) : null,
    medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    priceRange: prices.length ? [prices[0], prices[prices.length - 1]] : null,
    topWords: Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w),
    recent: recent.slice(0, 20), notes,
  };
}

export async function customerHistory(customer: string, o: { results?: number; onStep?: (s: string) => void } = {}): Promise<CustomerStats> {
  const name = customer.replace(/["«»]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 5) throw new Error("Укажите название заказчика как в извещении");
  const st = summarize(name, await searchRss({ text: name, exact: true, allStages: true }));
  const max = o.results ?? 10;
  if (!max) return st;
  // итоги — только завершённые закупки 44-ФЗ; не больше max страниц, чтобы не нагружать ЕИС
  const done = st.recent.filter(r => /^\d{19}$/.test(r.regNumber) && /завершен/i.test(r.stage ?? "")).slice(0, max);
  const res: TenderResult[] = [];
  for (const [i, r] of done.entries()) {
    o.onStep?.(`Итоги закупок: ${i + 1} из ${done.length}`);
    try { res.push(await fetchResults(r.regNumber, r.price)); } catch { /* итогов нет или страница недоступна — пропускаем */ }
  }
  return withResults(st, res);
}
