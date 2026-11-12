// После победы: план исполнения контракта — поставка, приёмка, оплата, возврат обеспечения.
import { addWorkDays, rollToWorkDay } from "./law/calendar.js";
import { ref, rule } from "./law/rules.js";
import type { Deadline, Report } from "./types.js";

const D = 864e5;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Рабочие дни — по производственному календарю РФ; календарный срок, выпавший на нерабочий день, переносится (ст. 193 ГК РФ) */
function addDays(date: string, n: number, work: boolean) { return work ? addWorkDays(date, n) : rollToWorkDay(iso(Date.parse(date) + n * D)); }

/** «30 календарных» → [30, false]; без уточнения считаем календарными и помечаем */
const parse = (v: unknown): [number, boolean] | null => { const m = String(v ?? "").match(/(\d+)\s*(рабочих)?/); return m ? [+m[1], !!m[2]] : null; };

export function contractPlan(r: Report, signedAt: string): Deadline[] {
  const f = (k: string) => r.fields.find(x => x.key === k);
  const out: Deadline[] = [{ title: "Контракт подписан", at: signedAt, basis: "дата подписания" }];
  const del = parse(f("deliveryDays")?.value);
  const deliveryAt = del ? addDays(signedAt, del[0], del[1]) : null;
  if (deliveryAt) out.push({ title: "Поставка / выполнение — крайний срок", at: deliveryAt, basis: `${del![0]} ${del![1] ? "рабочих" : "календарных"} дн. с подписания (проверьте, от какой даты считает контракт)`, source: f("deliveryDays")?.source });
  const acc = parse(f("acceptDays")?.value);
  const acceptAt = deliveryAt && acc ? addDays(deliveryAt, acc[0], acc[1]) : null;
  if (acceptAt) out.push({ title: "Приёмка — ожидаемый срок", at: acceptAt, basis: `${acc![0]} ${acc![1] ? "рабочих" : "календарных"} дн. после поставки`, source: f("acceptDays")?.source });
  const pay = parse(f("payDays")?.value);
  const base = acceptAt ?? deliveryAt;
  if (base) {
    const n = pay?.[0] ?? rule("44-34-13.1").params.workDays;
    out.push({ title: "Оплата — не позднее", at: addDays(base, n, pay ? pay[1] : true), basis: pay ? `${n} ${pay[1] ? "рабочих" : "календарных"} дн. после приёмки (из контракта)` : "7 рабочих дней после приёмки (ч. 13.1 ст. 34)", law: r.law === "44-ФЗ" ? [ref("44-34-13.1")] : undefined, source: f("payDays")?.source });
    out.push({ title: "Просрочка оплаты: начисляйте пени заказчику", at: addDays(base, n + 1, pay ? pay[1] : true), basis: "1/300 ключевой ставки за день (ч. 5 ст. 34) — претензия: tender claim", law: r.law === "44-ФЗ" ? [ref("44-34-5")] : undefined });
  }
  return out;
}
