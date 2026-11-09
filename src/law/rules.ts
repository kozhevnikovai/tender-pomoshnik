// База норм: карточки с редакциями (validFrom/validTo), источниками и статусом проверки.
// Утверждения о законе формулируются только из этих карточек, а не из «памяти» модели.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LawRef } from "../types.js";

export interface Rule {
  id: string; act: string; ref: string; topic: string; title: string; summary: string;
  params: Record<string, any>; validFrom: string; validTo: string | null;
  status: "verified" | "check"; sources: string[];
}
export interface RuleBase { version: string; asOf: string; rules: Rule[] }

let base: RuleBase | null = null;

function findRulesFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "../../rules/rules.json"), join(here, "../rules/rules.json"), join(process.cwd(), "rules/rules.json")]) if (existsSync(p)) return p;
  throw new Error("Не найдена база норм rules/rules.json");
}

export function rules(): RuleBase {
  if (!base) base = JSON.parse(readFileSync(process.env.TENDER_RULES ?? findRulesFile(), "utf8")) as RuleBase;
  return base;
}

/** Карточка нормы, действующей на дату (по умолчанию — сегодня) */
export function rule(id: string, date?: string): Rule {
  const r = rules().rules.find(x => x.id === id);
  if (!r) throw new Error(`Нет нормы ${id} в базе`);
  return r;
}

export function inForce(r: Rule, date: string) {
  return r.validFrom <= date && (r.validTo == null || date <= r.validTo);
}

export function ref(id: string): LawRef {
  const r = rule(id);
  return { id: r.id, act: r.act, ref: r.ref, title: r.title, url: r.sources[0], status: r.status };
}

/** Поиск норм по словам: «обеспечение заявки», «жалоба 223» */
export function searchRules(q: string, date?: string): Rule[] {
  const words = q.toLowerCase().replace(/ё/g, "е").split(/[\s,.;]+/).filter(w => w.length > 2);
  const d = date ?? today();
  return rules().rules
    .map(r => {
      const hay = `${r.act} ${r.ref} ${r.topic} ${r.title} ${r.summary}`.toLowerCase().replace(/ё/g, "е");
      return { r, score: words.reduce((s, w) => s + (hay.includes(w.slice(0, Math.max(4, w.length - 2))) ? 1 : 0), 0) };
    })
    .filter(x => x.score > 0 && inForce(x.r, d))
    .sort((a, b) => b.score - a.score)
    .map(x => x.r);
}

/** Предупреждение, если закупка объявлена раньше, чем начала действовать редакция нормы */
export function editionWarning(id: string, noticeDate: string | null): string | null {
  if (!noticeDate) return null;
  const r = rule(id);
  if (noticeDate < r.validFrom) return `${r.act}, ${r.ref}: в базе редакция с ${r.validFrom}, а извещение от ${noticeDate} — проверить редакцию на дату извещения`;
  if (r.validTo && noticeDate > r.validTo) return `${r.act}, ${r.ref}: норма в базе действовала до ${r.validTo} — проверить`;
  return null;
}

export const today = () => new Date().toISOString().slice(0, 10);
