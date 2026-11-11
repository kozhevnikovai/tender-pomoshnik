// Аналитика заказчика по открытой части ЕИС: последние закупки заказчика, этапы, отмены, типичная цена и предметы.
// Источник — официальный RSS поиска ЕИС (до 50 последних закупок). Победители и снижение цены — в протоколах ЕИС,
// их разбор появится после проверки на живой ЕИС.
import { searchRss, type SearchItem } from "./eis.js";

export interface CustomerStats {
  customer: string;
  total: number;
  byStage: Record<string, number>;
  cancelledShare: number | null;
  medianPrice: number | null;
  priceRange: [number, number] | null;
  topWords: string[];
  recent: { regNumber: string; title: string; price: number | null; stage: string | null; published?: string; url: string }[];
  notes: string[];
}

const priceOf = (d: string) => { const m = d.match(/(?:начальная|максимальная)[^:]*цена[^:]*:\s*([\d\s]+(?:[.,]\d{1,2})?)/i); const n = m ? Number(m[1].replace(/\s/g, "").replace(",", ".")) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
const stageOf = (d: string) => d.match(/[Ээ]тап (?:размещения|закупки)\s*:\s*([^:]+?)(?=\s+[А-ЯЁ][а-яё ]{2,40}:|$)/)?.[1]?.trim() ?? null;
const STOP = new Set(["поставка", "поставки", "оказание", "услуг", "услуги", "выполнение", "работ", "работы", "нужд", "нужды", "для", "товаров", "товара", "закупка", "право", "заключения", "договора", "контракта", "году", "года", "годов", "учреждения", "оказанию", "выполнению"]);

export function summarize(customer: string, items: SearchItem[]): CustomerStats {
  const recent = items.map(i => ({ regNumber: i.regNumber, title: i.title.replace(/^\s*№?\s*\d{11,19}\s*[.—-]?\s*/, ""), price: priceOf(i.description), stage: stageOf(i.description), published: i.published, url: i.url }));
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
  notes.push("Победители и снижение цены — в протоколах на странице закупки в ЕИС (автоматический разбор — в следующей версии)");
  return {
    customer, total: recent.length, byStage,
    cancelledShare: recent.length ? Math.round(cancelled / recent.length * 100) : null,
    medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    priceRange: prices.length ? [prices[0], prices[prices.length - 1]] : null,
    topWords: Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w),
    recent: recent.slice(0, 20), notes,
  };
}

export async function customerHistory(customer: string): Promise<CustomerStats> {
  const name = customer.replace(/["«»]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 5) throw new Error("Укажите название заказчика как в извещении");
  return summarize(name, await searchRss({ text: name, exact: true, allStages: true }));
}
