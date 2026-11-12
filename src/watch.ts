// Слежение за избранными закупками: что изменилось в карточке ЕИС с прошлой проверки —
// новые документы (изменения извещения, разъяснения, протоколы), этап, сроки, цена.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchCard, type NoticeCard } from "./eis.js";
import { homeDir } from "./models.js";

export interface WatchSnapshot { fields: Record<string, string>; docs: string[]; at: string }
export interface WatchItem { regNumber: string; title?: string; snapshot?: WatchSnapshot }
export interface WatchChange { regNumber: string; title?: string; url: string; changes: string[] }

const file = () => join(homeDir(), "watch.json");
/** Поля карточки, изменение которых важно участнику */
const KEY_FIELDS = /этап|окончани[яе] срока подачи|подведения итогов|начальная \(максимальная\) цена|обеспечени|дата и время проведения|размещени[яе] изменени/i;
export const MAX_WATCH = 50;

export function loadWatch(): WatchItem[] { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : []; } catch { return []; } }
function save(list: WatchItem[]) { mkdirSync(homeDir(), { recursive: true }); writeFileSync(file(), JSON.stringify(list, null, 2)); }

export function setWatched(regNumber: string, on: boolean, title?: string): WatchItem[] {
  if (!/^\d{11}$|^\d{19}$/.test(regNumber)) throw new Error("Следить можно только за закупкой ЕИС с номером извещения");
  let list = loadWatch().filter(x => x.regNumber !== regNumber);
  if (on) {
    if (list.length >= MAX_WATCH) throw new Error(`Следить можно не больше чем за ${MAX_WATCH} закупками — уберите завершённые`);
    list = [...list, { regNumber, title }];
  }
  save(list);
  return list;
}

export function snapshot(c: NoticeCard): WatchSnapshot {
  return { fields: Object.fromEntries(c.fields.filter(([k]) => KEY_FIELDS.test(k)).map(([k, v]) => [k, v])), docs: c.docs.map(d => d.title), at: new Date().toISOString() };
}

export function diff(a: WatchSnapshot, b: WatchSnapshot): string[] {
  const out: string[] = [];
  const added = b.docs.filter(d => !a.docs.includes(d));
  if (added.length) out.push(`Новые документы: ${added.slice(0, 10).join("; ")}${added.length > 10 ? ` и ещё ${added.length - 10}` : ""}`);
  for (const [k, v] of Object.entries(b.fields)) if (a.fields[k] !== undefined && a.fields[k] !== v) out.push(`${k}: было «${a.fields[k]}», стало «${v}»`);
  return out;
}

/** Проверяет избранные закупки; первая проверка только запоминает состояние */
export async function checkWatched(get: (reg: string) => Promise<NoticeCard> = fetchCard): Promise<{ changes: WatchChange[]; errors: string[] }> {
  const list = loadWatch();
  const changes: WatchChange[] = [], errors: string[] = [];
  for (const w of list) {
    try {
      const card = await get(w.regNumber);
      const snap = snapshot(card);
      if (w.snapshot) { const c = diff(w.snapshot, snap); if (c.length) changes.push({ regNumber: w.regNumber, title: w.title, url: card.url, changes: c }); }
      w.snapshot = snap;
    } catch (e) { errors.push(`${w.regNumber}: ${(e as Error).message}`); }
  }
  save(list);
  return { changes, errors };
}
