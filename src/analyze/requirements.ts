// Характеристики товара из ТЗ (таблицы DOCX и строки PDF) и проверка заявки «строго по ТЗ».
import { sourceAt } from "../docs/quote.js";
import type { DocText, Requirement } from "../types.js";

const num = (s: string) => parseFloat(s.replace(/\s/g, "").replace(",", "."));
const N = String.raw`(\d+(?:[  ]\d{3})*(?:[.,]\d+)?)`;

/** Разбор требования: «не менее 8», «≤ 2», «от 1,5 до 3», «белый» */
export function parseRequired(s: string): Pick<Requirement, "op" | "min" | "max" | "text" | "unit"> {
  const t = s.replace(/\s+/g, " ").replace(/больше или равно/gi, "не менее").replace(/меньше или равно/gi, "не более").replace(/(?<![а-яё])больше(?![а-яё])/gi, "более").replace(/(?<![а-яё])меньше(?![а-яё])/gi, "менее").replace(/значение характеристики не может изменяться участником закупки|участник закупки указывает в заявке[^.]*\.?/gi, "").trim();
  let m = t.match(new RegExp(String.raw`(?:не менее|не ниже|не меньше|≥|более|свыше)\s*${N}\s*([^\d,;]*?)\s*(?:,|и|;)?\s*(?:не более|не выше|не больше|≤|менее)\s*${N}\s*(.*)`, "i"));
  if (m) return { op: "range", min: num(m[1]), max: num(m[3]), unit: (m[4] || m[2])?.trim() || undefined };
  m = t.match(new RegExp(String.raw`(?:от|в диапазоне от)\s*${N}\s*(?:[а-яa-z%°/.\d]*\s*)?до\s*${N}\s*(.*)`, "i")) || t.match(new RegExp(String.raw`^${N}\s*[-–—]\s*${N}\s*(.*)$`));
  if (m) return { op: "range", min: num(m[1]), max: num(m[2]), unit: m[3]?.trim() || undefined };
  m = t.match(new RegExp(String.raw`(?:не менее|не ниже|не меньше|≥|>=|более|свыше|выше)\s*${N}\s*(.*)`, "i"));
  if (m) return { op: ">=", min: num(m[1]), unit: m[2]?.trim() || undefined };
  m = t.match(new RegExp(String.raw`(?:не более|не выше|не больше|≤|<=|менее|ниже|до)\s*${N}\s*(.*)`, "i"));
  if (m) return { op: "<=", max: num(m[1]), unit: m[2]?.trim() || undefined };
  m = t.match(new RegExp(String.raw`^${N}\s*([а-яa-z%°/.²³]*)$`, "i"));
  if (m) return { op: "=", min: num(m[1]), max: num(m[1]), unit: m[2] || undefined };
  return { op: "text", text: t };
}

const HEAD_NAME = /наименование (?:характеристики|показателя)|характеристик[аи]|показател[ья]|параметр/i;
const HEAD_VALUE = /значение|требуем|требовани|величина/i;
const HEAD_UNIT = /единиц/i;
const HEAD_ITEM = /наименование (?:товара|продукции|позиции)|^товар|^наименование$/i;

export function extractRequirements(docs: DocText[]): Requirement[] {
  const out: Requirement[] = [];
  for (const d of docs) {
    for (const table of d.tables) {
      const hi = table.findIndex(r => r.some(c => HEAD_NAME.test(c)) && r.some(c => HEAD_VALUE.test(c)));
      if (hi < 0) continue;
      // Двухуровневая шапка: «Характеристики товара» над «Наименование | Значение | Единица»
      const W = Math.max(...table.map(r => r.length));
      let h = table[hi];
      if (hi > 0 && h.length < W) {
        const main = table[hi - 1];
        const k = main.findIndex(c => /характеристик|показател|параметр/i.test(c));
        if (k >= 0 && main.length - 1 + h.length === W) h = [...main.slice(0, k), ...h, ...main.slice(k + 1)];
      }
      const ci = h.findIndex(c => HEAD_NAME.test(c));
      const vi = h.findIndex((c, i) => i !== ci && HEAD_VALUE.test(c));
      const ui = h.findIndex((c, i) => i > vi && HEAD_UNIT.test(c));
      const ii = h.findIndex((c, i) => i !== ci && HEAD_ITEM.test(c));
      let item = "";
      for (const raw of table.slice(hi + 1)) {
        if (raw.every(c => /^\d*\.?$/.test(c))) continue; // строка нумерации колонок «1 | 2 | 3»
        // строки с объединёнными ячейками короче: выравниваем их по колонке характеристики
        const row: string[] = raw.length === h.length ? raw : Array(h.length).fill("");
        if (raw.length !== h.length) { const off = ci + raw.length <= h.length ? ci : h.length - raw.length; raw.forEach((c, j) => { row[off + j] = c; }); }
        if (ii >= 0 && row[ii]) item = row[ii].split(/(?<=[а-я)])\s+(?=[А-Я])/)[0].slice(0, 120);
        const name = row[ci]?.trim();
        const req = row[vi]?.trim();
        if (!name || !req || HEAD_NAME.test(name)) continue;
        const rowText = row.filter(Boolean).join(" | ");
        const part = d.parts.find(p => p.text === rowText) ?? d.parts.find(p => p.text.includes(name) && p.text.includes(req));
        const p = parseRequired(req + (ui >= 0 && row[ui] ? " " + row[ui] : ""));
        out.push({ item: item || "Товар", name, required: req, ...p, unit: (ui >= 0 && row[ui]) || p.unit, source: part ? { doc: d.name, unit: d.unit, n: part.n, quote: part.text.slice(0, 240) } : undefined });
      }
    }
    if (d.tables.length) continue;
    // PDF/TXT: строки вида «Объём памяти — не менее 8 ГБ»
    const re = new RegExp(String.raw`([А-ЯЁA-Z][^:\n|;]{2,80}?)\s*(?:[:—–-]|\|)\s*((?:не менее|не более|не ниже|не выше|от)\s*${N}[^;\n|]{0,40})`, "g");
    for (const p of d.parts) {
      for (const m of p.text.matchAll(re)) {
        const name = m[1].trim();
        if (/^(?:срок|цена|оплата|аванс|штраф|пени|обеспечение|размер|начальная|дата|заказчик|поставщик|контракт)/i.test(name)) continue;
        out.push({ item: "Товар", name, required: m[2].trim(), ...parseRequired(m[2]), source: sourceAt(d, p.n, p.text.replace(/\s+/g, " "), Math.max(0, p.text.replace(/\s+/g, " ").indexOf(name)), m[0].length) });
      }
    }
  }
  return out.slice(0, 400);
}

export interface OfferCheck { name: string; required: string; offered: string; ok: boolean | null; reason: string; source?: Requirement["source"] }

/** Проверка предложения участника по каждой характеристике ТЗ */
export function checkOffer(reqs: Requirement[], offer: Record<string, string>): OfferCheck[] {
  const key = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
  const map = new Map(Object.entries(offer).map(([k, v]) => [key(k), v]));
  return reqs.map(r => {
    const offered = map.get(key(`${r.item} ${r.name}`)) ?? map.get(key(r.name));
    if (offered == null || offered === "") return { name: r.name, required: r.required, offered: "", ok: false, reason: "Не указано значение — заявку могут отклонить", source: r.source };
    if (/не менее|не более|от .* до|или эквивалент|≥|≤/i.test(offered)) return { name: r.name, required: r.required, offered, ok: false, reason: "Укажите конкретное значение, а не диапазон из ТЗ (если ТЗ не разрешает диапазон)", source: r.source };
    const v = num(offered.replace(/[^\d.,\s-]/g, ""));
    if (r.op === "text") {
      const ok = key(offered).includes(key(r.text ?? "")) || key(r.text ?? "").includes(key(offered));
      return { name: r.name, required: r.required, offered, ok: ok ? true : null, reason: ok ? "Совпадает с ТЗ" : "Текстовое требование — проверьте вручную", source: r.source };
    }
    if (!Number.isFinite(v)) return { name: r.name, required: r.required, offered, ok: false, reason: "Ожидалось число", source: r.source };
    const ok = (r.op === ">=" && v >= r.min!) || (r.op === "<=" && v <= r.max!) || (r.op === "range" && v >= r.min! && v <= r.max!) || (r.op === "=" && v === r.min);
    return { name: r.name, required: r.required, offered, ok, reason: ok ? "Соответствует ТЗ" : `Не соответствует: требуется ${r.required}`, source: r.source };
  });
}
