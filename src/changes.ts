// Что изменилось в закупке с прошлого разбора: сведения (НМЦК, сроки, обеспечение) и текст документов —
// какие пункты добавлены, убраны или переписаны после изменения извещения или разъяснения.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DocText, Report } from "./types.js";

export interface FieldChange { label: string; was: string; now: string }
export interface DocChange { doc: string; status: "новый" | "убран" | "изменён"; added: string[]; removed: string[] }
export interface Changes { since: string; fields: FieldChange[]; docs: DocChange[] }

const MAX_PARAS = 15;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\d%]+/gu, " ").replace(/\s+/g, " ").trim();
/** Имя документа без даты и номера версии в конце — «ТЗ (изм. 1).docx» и «ТЗ.docx» сравниваются друг с другом */
export const docKey = (name: string) => norm(name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/\(?\s*(изм(енени[ея])?\.?|ред(акция)?\.?|версия|вер\.)\s*№?\s*\d*\s*\)?/gi, "").replace(/(от\s+)?\d{2}\.\d{2}\.\d{4}/g, "").replace(/[_\-\s]+v?\d+$/i, ""));

const val = (v: unknown) => (v === null || v === undefined || v === "" ? "не указано" : String(v));

/** Абзацы, которых нет в другой версии (сравнение по нормализованному тексту, порядок не важен) */
function paraDiff(a: DocText, b: DocText): { added: string[]; removed: string[] } {
  const A = a.parts.map(p => p.text).filter(t => norm(t).length > 3), B = b.parts.map(p => p.text).filter(t => norm(t).length > 3);
  const setA = new Set(A.map(norm)), setB = new Set(B.map(norm));
  return { added: B.filter(t => !setA.has(norm(t))), removed: A.filter(t => !setB.has(norm(t))) };
}

export function compareRuns(prev: { report: Report; docs: DocText[] }, cur: { report: Report; docs: DocText[] }): Changes {
  const fields: FieldChange[] = [];
  const pf = new Map(prev.report.fields.map(f => [f.key, f]));
  for (const f of cur.report.fields) {
    const p = pf.get(f.key);
    if (p && val(p.value) !== val(f.value)) fields.push({ label: f.label, was: val(p.value), now: val(f.value) });
  }
  const docs: DocChange[] = [];
  const pd = new Map(prev.docs.map(d => [docKey(d.name), d]));
  const seen = new Set<string>();
  for (const d of cur.docs) {
    const k = docKey(d.name);
    seen.add(k);
    const p = pd.get(k);
    if (!p) { docs.push({ doc: d.name, status: "новый", added: d.parts.slice(0, MAX_PARAS).map(x => x.text), removed: [] }); continue; }
    const { added, removed } = paraDiff(p, d);
    if (added.length || removed.length) docs.push({ doc: d.name, status: "изменён", added: added.slice(0, MAX_PARAS), removed: removed.slice(0, MAX_PARAS) });
  }
  for (const [k, p] of pd) if (!seen.has(k)) docs.push({ doc: p.name, status: "убран", added: [], removed: [] });
  return { since: prev.report.createdAt, fields, docs };
}

/** Перед повторным разбором той же закупки прошлый результат уходит в «история/<дата>» — его есть с чем сравнить */
export function archivePrevious(dir: string): { report: Report; docs: DocText[] } | null {
  const rep = join(dir, "отчёт.json"), txt = join(dir, "тексты.json");
  if (!existsSync(rep) || !existsSync(txt)) return null;
  let prev: { report: Report; docs: DocText[] };
  try { prev = { report: JSON.parse(readFileSync(rep, "utf8")), docs: JSON.parse(readFileSync(txt, "utf8")) }; } catch { return null; }
  const h = join(dir, "история", (prev.report.createdAt || new Date().toISOString()).slice(0, 19).replace(/[:T]/g, "-"));
  mkdirSync(h, { recursive: true });
  copyFileSync(rep, join(h, "отчёт.json"));
  copyFileSync(txt, join(h, "тексты.json"));
  // храним не больше 10 прошлых версий
  const all = readdirSync(join(dir, "история")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 10))) { try { rmSync(join(dir, "история", old), { recursive: true, force: true }); } catch { /* занято */ } }
  return prev;
}

export const hasChanges = (c: Changes) => c.fields.length > 0 || c.docs.length > 0;

export function changesMarkdown(c: Changes): string[] {
  const L = ["## Что изменилось с прошлого разбора", "", `Прошлый разбор: ${c.since.slice(0, 16).replace("T", " ")}.`, ""];
  if (!hasChanges(c)) return [...L, "Изменений в сведениях и тексте документов нет.", ""];
  for (const f of c.fields) L.push(`- **${f.label}**: было «${f.was}», стало «${f.now}»`);
  if (c.fields.length) L.push("");
  for (const d of c.docs) {
    L.push(`### ${d.doc} — ${d.status}`, "");
    for (const t of d.added) L.push(`+ ${t.slice(0, 400)}`);
    for (const t of d.removed) L.push(`− ${t.slice(0, 400)}`);
    L.push("");
  }
  return L;
}
