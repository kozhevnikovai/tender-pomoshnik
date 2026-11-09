// Календарь сроков закупки: подача, разъяснения, торги, итоги, жалоба, подписание.
import { ref, rule } from "../law/rules.js";
import type { Deadline, Field, Law } from "../types.js";
import { fieldSource, fieldValue } from "./fields.js";

const D = 864e5;
export const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / D);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Минус N рабочих дней (выходные; праздники РФ — проверить по производственному календарю) */
export function minusWorkDays(date: string, n: number) {
  let t = Date.parse(date.slice(0, 10));
  while (n > 0) { t -= D; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return iso(t);
}

export function buildDeadlines(fields: Field[], law: Law | null): Deadline[] {
  const out: Deadline[] = [];
  const dl = fieldValue(fields, "deadline") as string | null;
  const auction = fieldValue(fields, "auction") as string | null;
  const results = fieldValue(fields, "results") as string | null;
  if (dl) {
    if (law === "223-ФЗ") {
      const p = rule("223-3.2-3").params;
      out.push({ title: "Последний день для запроса разъяснений (заказчик обязан ответить)", at: minusWorkDays(dl, p.workDaysBefore + 1), basis: `не позднее чем за ${p.workDaysBefore} рабочих дня до окончания подачи; праздники — проверить`, law: [ref("223-3.2-3")] });
    } else {
      const p = rule("44-42-5").params;
      out.push({ title: "Последний день для запроса разъяснений", at: iso(Date.parse(dl.slice(0, 10)) - p.daysBefore * D), basis: `не позднее чем за ${p.daysBefore} дня до окончания подачи заявок`, law: [ref("44-42-5")] });
      out.push({ title: "Жалоба на положения извещения — до этого момента", at: dl, basis: "до окончания срока подачи заявок", law: [ref("44-105-2")] });
    }
    out.push({ title: "Окончание подачи заявок", at: dl, basis: "из извещения", source: fieldSource(fields, "deadline") });
  }
  if (auction) out.push({ title: "Подача ценовых предложений (торги)", at: auction, basis: "из извещения", source: fieldSource(fields, "auction") });
  if (results) {
    out.push({ title: "Подведение итогов", at: results, basis: "из извещения", source: fieldSource(fields, "results") });
    if (law === "223-ФЗ") out.push({ title: "Жалоба на итоги в ФАС — крайний срок", at: iso(Date.parse(results) + rule("223-18.1").params.days * D), basis: "10 дней со дня подведения итогов (по дате размещения протокола)", law: [ref("223-18.1")] });
    else out.push({ title: "Жалоба на действия после подачи заявок — ориентир", at: iso(Date.parse(results) + rule("44-105-2").params.afterProtocolDays * D), basis: "5 дней с размещения протокола подведения итогов — проверить по дате протокола", law: [ref("44-105-2")] });
    if (law === "44-ФЗ") out.push({ title: "Подписание контракта — не раньше", at: iso(Date.parse(results) + rule("44-51-1").params.days * D), basis: "10 дней с размещения протокола — ориентир, проверить", law: [ref("44-51-1")] });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
