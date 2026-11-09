// Цитаты: найти фрагмент в документах и вернуть «документ, страница/абзац, точная цитата».
// Любое утверждение модели принимается, только если его цитата реально есть в тексте.
import type { DocText, Source } from "../types.js";

export const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"“”„'’`]/g, "").replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();

/** Ищет цитату во всех документах. Допускает расхождения в пробелах, кавычках, регистре и переносах. */
export function locate(docs: DocText[], quote: string): Source | null {
  const q = norm(quote);
  if (q.length < 4) return null;
  for (const d of docs) for (const p of d.parts) {
    const t = norm(p.text.replace(/-\n/g, ""));
    const i = t.indexOf(q);
    if (i >= 0) return { doc: d.name, unit: d.unit, n: p.n, quote: exact(p.text, quote) };
  }
  // цитата могла попасть на стык страниц/абзацев
  for (const d of docs) for (let k = 0; k + 1 < d.parts.length; k++) {
    const t = norm(d.parts[k].text + " " + d.parts[k + 1].text);
    if (t.includes(q)) return { doc: d.name, unit: d.unit, n: d.parts[k].n, quote: quote.trim() };
  }
  return null;
}

/** Источник для совпадения регулярного выражения — с короткой цитатой вокруг */
export function sourceAt(d: DocText, partN: number, text: string, index: number, len: number): Source {
  const from = Math.max(0, text.lastIndexOf("\n", index) + 1, index - 120);
  let to = text.indexOf("\n", index + len);
  if (to < 0 || to - index > 220) to = Math.min(text.length, index + len + 160);
  return { doc: d.name, unit: d.unit, n: partN, quote: text.slice(from, to).replace(/\s+/g, " ").trim() };
}

export function fmtSource(s?: Source): string {
  if (!s) return "";
  return `${s.doc}, ${s.unit === "page" ? "стр." : "абз."} ${s.n}`;
}

function exact(text: string, quote: string) {
  const flat = text.replace(/\s+/g, " ");
  const i = flat.toLowerCase().indexOf(quote.replace(/\s+/g, " ").toLowerCase().trim());
  return i >= 0 ? flat.slice(i, i + quote.trim().length) : quote.trim();
}
