// Markdown-отчёт и календарь сроков (.ics)
import { changesMarkdown } from "../changes.js";
import { fmtSource } from "../docs/quote.js";
import type { LawRef, Report } from "../types.js";

const lawMd = (l?: LawRef[]) => (l ?? []).map(x => `[${x.act}, ${x.ref}${x.status === "check" ? " — проверить" : ""}](${x.url})`).join("; ");

export function toMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# ${r.title ?? "Закупка"}`, "", `№ ${r.noticeNumber ?? "—"} · ${r.law ?? "закон не определён"} · ${r.procedure ?? "способ не определён"}`, "", `> ${r.disclaimer}`, "");
  if (r.fitSummary) {
    L.push(`## Подходит ли нам: ${r.fitSummary}`, "");
    for (const x of r.fit) L.push(`- **${x.verdict}** — ${x.requirement}: ${x.reason}${x.source ? ` (${fmtSource(x.source)})` : ""}${x.law?.length ? ` — ${lawMd(x.law)}` : ""}`);
    L.push("");
  }
  if (r.changes) L.push(...changesMarkdown(r.changes));
  L.push("## Риски", "");
  if (!r.risks.length) L.push("Явных рисков по проверяемым правилам не найдено.");
  for (const x of r.risks) L.push(`- **${x.severity}** — ${x.title}. ${x.detail}${x.source ? `\n  > «${x.source.quote}» — ${fmtSource(x.source)}` : ""}${x.law?.length ? `\n  ${lawMd(x.law)}` : ""}`);
  L.push("", "## Деньги", "", "| Что | Значение | Расчёт | Норма |", "|---|---|---|---|");
  for (const c of r.calcs) L.push(`| ${c.label} | ${c.value} | ${c.formula} | ${lawMd(c.law)} |`);
  L.push("", "## Сроки", "", "| Дата | Что | Основание |", "|---|---|---|");
  for (const d of r.deadlines) L.push(`| ${d.at.replace("T", " ").slice(0, 16)} | ${d.title} | ${d.basis} ${lawMd(d.law)} |`);
  L.push("", "## Сведения", "", "| Поле | Значение | Источник |", "|---|---|---|");
  for (const f of r.fields) L.push(`| ${f.label} | ${f.value ?? "не найдено"} | ${f.source ? `${fmtSource(f.source)}: «${f.source.quote.slice(0, 120).replace(/\|/g, "/")}»` : ""} |`);
  L.push("", "## Чек-лист заявки", "");
  r.checklist.forEach((c, i) => L.push(`${i + 1}. ${c.item}${c.law?.length ? ` — ${lawMd(c.law)}` : ""}`));
  if (r.warnings.length) { L.push("", "## Не удалось проверить", ""); for (const w of r.warnings) L.push(`- ${w}`); }
  return L.join("\n") + "\n";
}

const icsEsc = (s: string) => s.replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
function icsDate(iso: string): string {
  if (iso.length <= 10) return `;VALUE=DATE:${iso.replace(/-/g, "")}`;
  const t = new Date(iso);
  return `:${t.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** Календарь сроков: каждая дата — событие с напоминанием за сутки */
export function toIcs(r: Report): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = r.deadlines.map((d, i) => [
    "BEGIN:VEVENT", `UID:${r.noticeNumber ?? "tender"}-${i}@tender-pomoshnik`, `DTSTAMP:${now}`, `DTSTART${icsDate(d.at)}`,
    `SUMMARY:${icsEsc(`${d.title} — № ${r.noticeNumber ?? ""}`)}`, `DESCRIPTION:${icsEsc(`${r.title ?? ""}\n${d.basis}${d.law?.length ? `\n${d.law.map(l => `${l.act}, ${l.ref}`).join("; ")}` : ""}`)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(d.title)}`, "END:VALARM", "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kozhevnikovai//Тендерный помощник//RU", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR", ""].join("\r\n");
}
