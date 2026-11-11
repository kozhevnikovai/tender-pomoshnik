// Производственный календарь РФ: выходные, нерабочие праздничные дни (ст. 112 ТК РФ) и переносы по постановлениям Правительства.
// 2026 — ПП от 24.09.2025 № 1466; 2027 — ПП от 17.09.2026 № 1187. Для других лет учитываются только выходные — срок помечается «проверить».

/** Нерабочие будние дни (праздники и перенесённые выходные) */
const HOLIDAYS: Record<number, string[]> = {
  2026: ["01-01", "01-02", "01-05", "01-06", "01-07", "01-08", "01-09", "02-23", "03-09", "05-01", "05-11", "06-12", "11-04", "12-31"],
  2027: ["01-01", "01-04", "01-05", "01-06", "01-07", "01-08", "02-22", "02-23", "03-08", "05-03", "05-10", "06-14", "11-04", "11-05", "12-31"],
};
/** Рабочие субботы и воскресенья (перенос выходного) */
const WORKING_WEEKENDS: Record<number, string[]> = { 2026: [], 2027: ["02-20"] };

export const CALENDAR_YEARS = Object.keys(HOLIDAYS).map(Number);
export const CALENDAR_SOURCE = "производственный календарь РФ: ст. 112 ТК РФ, ПП РФ от 24.09.2025 № 1466 (2026), от 17.09.2026 № 1187 (2027)";

const D = 864e5;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Есть ли у нас календарь на год даты: иначе праздники не учтены */
export const covered = (date: string) => CALENDAR_YEARS.includes(+date.slice(0, 4));

export function isWorkDay(date: string): boolean {
  const y = +date.slice(0, 4), md = date.slice(5, 10);
  if (WORKING_WEEKENDS[y]?.includes(md)) return true;
  const w = new Date(Date.parse(date.slice(0, 10))).getUTCDay();
  if (w === 0 || w === 6) return false;
  return !HOLIDAYS[y]?.includes(md);
}

/** Плюс N рабочих дней (N > 0) */
export function addWorkDays(date: string, n: number): string {
  let t = Date.parse(date.slice(0, 10));
  while (n > 0) { t += D; if (isWorkDay(iso(t))) n--; }
  return iso(t);
}

/** Минус N рабочих дней */
export function minusWorkDays(date: string, n: number): string {
  let t = Date.parse(date.slice(0, 10));
  while (n > 0) { t -= D; if (isWorkDay(iso(t))) n--; }
  return iso(t);
}

/** Если последний день срока нерабочий — срок переносится на ближайший рабочий (ст. 193 ГК РФ) */
export function rollToWorkDay(date: string): string {
  let t = Date.parse(date.slice(0, 10));
  while (!isWorkDay(iso(t))) t += D;
  return iso(t);
}

/** Сколько рабочих дней между датами (не включая первую, включая последнюю) */
export function workDaysBetween(from: string, to: string): number {
  let n = 0, t = Date.parse(from.slice(0, 10));
  const end = Date.parse(to.slice(0, 10));
  while (t < end) { t += D; if (isWorkDay(iso(t))) n++; }
  return n;
}
