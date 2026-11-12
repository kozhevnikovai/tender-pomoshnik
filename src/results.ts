// Итоги закупки 44-ФЗ из открытой части ЕИС: победитель, цена контракта, снижение от НМЦК.
// Источник — страница «Результаты определения поставщика» (supplier-results.html): предложения участников
// и таблица заключённых контрактов. Разбор линейный (indexOf), без регулярных выражений с откатами: HTML приходит из сети.

export interface Offer { participant: string; place: string; price: number | null }
export interface ContractRow { reestr: string; supplier: string; price: number | null; placed: string | null }
export interface TenderResult { regNumber: string; url: string; offers: Offer[]; contracts: ContractRow[]; nmck: number | null; reduction: number | null }

const ENT: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'", "&laquo;": "«", "&raquo;": "»" };
/** Текст ячейки без тегов: проход по символам, без регулярных выражений по разметке */
export function cellText(html: string): string {
  let out = "", inTag = false;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === "<") { inTag = true; out += " "; continue; }
    if (c === ">") { inTag = false; continue; }
    if (!inTag) out += c;
  }
  for (const [k, v] of Object.entries(ENT)) out = out.split(k).join(v);
  return out.replace(/\s+/g, " ").trim();
}

/** Число из «1 663 269,81» */
export function money(s: string): number | null {
  const t = s.replace(/[\s ₽]/g, "").replace(",", ".");
  if (!t || t.length > 20 || !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Table { head: string[]; rows: { cells: string[]; links: string[] }[] }

function between(s: string, open: string, close: string, from = 0): [number, number] | null {
  const a = s.indexOf(open, from);
  if (a < 0) return null;
  const b = s.indexOf(close, a + open.length);
  return b < 0 ? null : [a, b + close.length];
}

/** Все ячейки тега tag (th или td) внутри фрагмента */
function cells(html: string, tag: string): string[] {
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const a = html.indexOf(`<${tag}`, pos);
    if (a < 0) break;
    const gt = html.indexOf(">", a);
    const b = html.indexOf(`</${tag}>`, gt);
    if (gt < 0 || b < 0) break;
    out.push(html.slice(gt + 1, b));
    pos = b + tag.length + 3;
  }
  return out;
}

export function parseTables(html: string, limit = 40): Table[] {
  const out: Table[] = [];
  let pos = 0;
  while (out.length < limit) {
    const r = between(html, "<table", "</table>", pos);
    if (!r) break;
    const t = html.slice(r[0], r[1]);
    pos = r[1];
    const head = cells(t, "th").map(cellText);
    const rows: Table["rows"] = [];
    let p = 0;
    for (;;) {
      const tr = between(t, "<tr", "</tr>", p);
      if (!tr) break;
      p = tr[1];
      const tds = cells(t.slice(tr[0], tr[1]), "td");
      if (!tds.length) continue;
      const links: string[] = [];
      for (const td of tds) { const h = td.indexOf('href="'); if (h >= 0) links.push(td.slice(h + 6, td.indexOf('"', h + 6))); }
      rows.push({ cells: tds.map(cellText), links });
    }
    out.push({ head, rows });
  }
  return out;
}

const col = (head: string[], word: string) => head.findIndex(h => h.toLowerCase().includes(word));

export function parseResults(html: string): { offers: Offer[]; contracts: ContractRow[] } {
  const offers: Offer[] = [], contracts: ContractRow[] = [];
  for (const t of parseTables(html.slice(0, 3_000_000))) {
    const iOffer = col(t.head, "предложени"), iPlace = col(t.head, "порядков"), iId = col(t.head, "идентификацион");
    if (iOffer >= 0 && iPlace >= 0) {
      for (const r of t.rows) offers.push({ participant: r.cells[iId >= 0 ? iId : 0] ?? "", place: r.cells[iPlace] ?? "", price: money(r.cells[iOffer] ?? "") });
      continue;
    }
    const iSup = col(t.head, "поставщик"), iPrice = col(t.head, "цена контракта"), iReestr = col(t.head, "реестров"), iPlaced = col(t.head, "размещени");
    if (iSup >= 0 && iPrice >= 0) {
      for (const r of t.rows) {
        const reestr = (r.cells[iReestr >= 0 ? iReestr : 0] ?? "").split(" ")[0];
        if (!/^\d{19}$/.test(reestr)) continue;
        contracts.push({ reestr, supplier: r.cells[iSup] ?? "", price: money(r.cells[iPrice] ?? ""), placed: iPlaced >= 0 ? (r.cells[iPlaced] ?? "").slice(0, 16) || null : null });
      }
    }
  }
  return { offers: offers.slice(0, 50), contracts: contracts.slice(0, 50) };
}

/** Снижение от НМЦК, % (одна десятая) */
export function reduction(nmck: number | null, price: number | null): number | null {
  if (!nmck || !price || nmck <= 0 || price <= 0 || price > nmck * 1.5) return null;
  return Math.round((1 - price / nmck) * 1000) / 10;
}

/** Победитель: поставщик с наибольшей суммой контрактов по закупке */
export function winnerOf(r: { contracts: ContractRow[] }): ContractRow | null {
  return [...r.contracts].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0] ?? null;
}
