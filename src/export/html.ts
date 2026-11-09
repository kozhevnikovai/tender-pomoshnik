// HTML-отчёт по закупке в стиле «Чертёж»: один файл, шрифты встроены, работает без интернета.
// Окно «Главное», вердикт, риски, расчёты, сроки, сведения с цитатами, чек-лист, ТЗ, черновики.
import { fmtSource } from "../docs/quote.js";
import type { LawRef, Report, Source } from "../types.js";
import { VERSION } from "../version.js";
import { fontFaces } from "./fonts.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d8 = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); const t = iso.slice(11, 16); return `${d}.${m}.${y}${t ? " " + t : ""}`; };

const CSS = `
:root{--ink:#161616;--pencil:#5C5C5C;--axis:#9C9C9C;--plate:#E6E6E6;--sig:#FF5A1F;--sigt:#C8410F;--ok:#2F7A4B;--warn:#B07A00}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 Geologica,system-ui,sans-serif}
.sheet{max-width:1080px;margin:32px auto;border:3px solid var(--ink);padding:40px 48px 0}
.mono{font-family:"Martian Mono",ui-monospace,monospace}
.kicker{font:12px "Martian Mono",monospace;color:var(--pencil);letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:10px}
.kicker:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--sig)}
h1{font-size:30px;line-height:1.2;margin:10px 0 6px;font-weight:600}h2{font-size:19px;margin:36px 0 12px;font-weight:600;display:flex;gap:12px;align-items:baseline}
h2 .n{font:12px "Martian Mono",monospace;color:var(--pencil)}
.meta{color:var(--pencil);font-size:14px}.axis{border:0;border-top:1px dashed var(--axis);margin:28px 0}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--ink);padding:7px 10px;text-align:left;vertical-align:top}th{background:var(--plate);font-weight:600;font-size:13px}
.src{font:11px "Martian Mono",monospace;color:var(--pencil);display:block;margin-top:3px}
.q{display:block;font-size:12px;color:var(--pencil);border-left:2px solid var(--axis);padding-left:8px;margin-top:4px}
.law{font:11px "Martian Mono",monospace;background:var(--plate);padding:1px 6px;margin:2px 4px 0 0;display:inline-block;color:var(--ink);text-decoration:none}
.law.check{background:#fff;border:1px solid var(--warn);color:var(--warn)}
.tag{font:12px "Martian Mono",monospace;padding:2px 8px;border:1px solid currentColor;white-space:nowrap}
.v-можем,.s-ok,.sev-низкий{color:var(--ok)}.v-нужно,.s-check,.sev-средний{color:var(--warn)}.v-нельзя,.s-missing,.sev-высокий{color:var(--sigt)}
.main{border:3px solid var(--ink);padding:18px 22px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.main .k{font:11px "Martian Mono",monospace;color:var(--pencil);text-transform:uppercase}.main .v{font-size:20px;font-weight:600}
.verdict{font-size:26px;font-weight:600}
.bar{display:flex;gap:10px;margin:18px 0}.bar button{font:13px Geologica,sans-serif;border:1px solid var(--ink);background:#fff;padding:6px 12px;cursor:pointer}.bar button:hover{background:var(--ink);color:#fff}
pre.draft{white-space:pre-wrap;border:1px dashed var(--axis);padding:14px;font:13px/1.5 Geologica,sans-serif;background:#fff}
.disc{border:1px solid var(--warn);padding:10px 14px;color:var(--ink);font-size:13px}
table.stamp{margin-top:40px;border:3px solid var(--ink);border-bottom:0;width:calc(100% + 96px);margin-left:-48px}
table.stamp td{border:1px solid var(--ink);font-size:12px;padding:6px 10px}table.stamp td b{font:12px "Martian Mono",monospace;display:block}
body.only-problems .okrow{display:none}
@media print{.bar{display:none}.sheet{border:0;margin:0}}
`;

function law(l?: LawRef[]) {
  return (l ?? []).map(x => `<a class="law${x.status === "check" ? " check" : ""}" href="${esc(x.url)}" target="_blank" title="${esc(x.title)}${x.status === "check" ? " — проверить" : ""}">${esc(x.act)}, ${esc(x.ref)}${x.status === "check" ? " · проверить" : ""}</a>`).join("");
}
function src(s?: Source, quote = true) {
  if (!s) return "";
  return `<span class="src">${esc(fmtSource(s))}</span>${quote ? `<span class="q">«${esc(s.quote.slice(0, 260))}»</span>` : ""}`;
}

export function toHtml(r: Report, drafts?: { clarification: string; complaint: string }): string {
  const f = (k: string) => r.fields.find(x => x.key === k)?.value;
  const nm = f("nmck") as number | null;
  const dl = f("deadline") as string | null;
  const high = r.risks.filter(x => x.severity === "высокий").length;
  const main = [
    ["НМЦК", nm ? `${nm.toLocaleString("ru-RU")} ₽` : "—"],
    ["Подача до", dl ? d8(dl) : "—"],
    ["Вердикт", r.fitSummary ? `<span class="v-${r.fitSummary}">${r.fitSummary}</span>` : "нет профиля"],
    ["Риски", `${r.risks.length}${high ? ` · <span class="sev-высокий">${high} высоких</span>` : ""}`],
  ];
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Закупка ${esc(r.noticeNumber ?? "")} — Тендерный помощник</title><style>${fontFaces()}${CSS}</style></head><body><div class="sheet">
<div class="kicker">Тендерный помощник · ${esc(r.law ?? "закон не определён")} · ${esc(r.procedure ?? "способ не определён")}</div>
<h1>${esc(r.title ?? "Закупка")}</h1>
<div class="meta mono">№ ${esc(r.noticeNumber ?? "—")} · отчёт ${esc(d8(r.createdAt))} · база норм ${esc(r.rulesVersion)}</div>
<div class="bar"><button onclick="document.body.classList.toggle('only-problems')">Только проблемы</button><button onclick="window.print()">Печать / PDF</button></div>
<div class="main">${main.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
<p class="disc">${esc(r.disclaimer)}</p>

${r.fit.length ? `<h2><span class="n">01</span>Подходит ли нам: <span class="v-${r.fitSummary}">${r.fitSummary}</span></h2>
<table><tr><th>Требование</th><th>Вердикт</th><th>Почему</th></tr>${r.fit.map(x => `<tr class="${x.verdict === "можем" ? "okrow" : ""}"><td>${esc(x.requirement)}${src(x.source, false)}</td><td><span class="tag v-${x.verdict}">${x.verdict}</span></td><td>${esc(x.reason)}${src(x.source)}<div>${law(x.law)}</div></td></tr>`).join("")}</table>` : `<h2><span class="n">01</span>Подходит ли нам</h2><p class="meta">Заполните профиль компании — и помощник сравнит его с требованиями закупки.</p>`}

<h2><span class="n">02</span>Риски</h2>
${r.risks.length ? `<table><tr><th>Риск</th><th>Уровень</th><th>Подробно и источник</th></tr>${r.risks.map(x => `<tr><td>${esc(x.title)}</td><td><span class="tag sev-${x.severity}">${x.severity}</span></td><td>${esc(x.detail)}${src(x.source)}<div>${law(x.law)}</div></td></tr>`).join("")}</table>` : `<p class="meta">Явных рисков по проверяемым правилам не найдено. Это не гарантия: прочитайте проект контракта.</p>`}

<h2><span class="n">03</span>Деньги: обеспечение, антидемпинг, штрафы</h2>
${r.calcs.length ? `<table><tr><th>Что</th><th>Значение</th><th>Как считали</th></tr>${r.calcs.map(c => `<tr class="${c.status === "ok" ? "okrow" : ""}"><td>${esc(c.label)}</td><td><b>${esc(c.value)}</b></td><td class="mono" style="font-size:12px">${esc(c.formula)}<div>${law(c.law)}</div></td></tr>`).join("")}</table>` : `<p class="meta">Нет данных для расчёта.</p>`}

<h2><span class="n">04</span>Сроки</h2>
<table><tr><th>Дата</th><th>Что</th><th>Основание</th></tr>${r.deadlines.map(d => `<tr><td class="mono">${esc(d8(d.at))}</td><td>${esc(d.title)}</td><td>${esc(d.basis)}${src(d.source, false)}<div>${law(d.law)}</div></td></tr>`).join("")}</table>

<h2><span class="n">05</span>Сведения о закупке</h2>
<table><tr><th>Поле</th><th>Значение</th><th>Источник</th></tr>${r.fields.map(x => `<tr class="${x.status === "ok" ? "okrow" : ""}"><td>${esc(x.label)}</td><td class="s-${x.status}">${x.value == null ? "не найдено" : esc(x.value)}</td><td>${src(x.source)}${law(x.law)}</td></tr>`).join("")}</table>

<h2><span class="n">06</span>Чек-лист заявки</h2>
<ol>${r.checklist.map(c => `<li>${esc(c.item)}${src(c.source, false)} ${law(c.law)}</li>`).join("")}</ol>

${r.requirements.length ? `<h2><span class="n">07</span>Характеристики из ТЗ (${r.requirements.length})</h2>
<table><tr><th>Позиция</th><th>Характеристика</th><th>Требование</th><th>Источник</th></tr>${r.requirements.slice(0, 200).map(q => `<tr><td>${esc(q.item)}</td><td>${esc(q.name)}</td><td class="mono" style="font-size:12px">${esc(q.required)}${q.unit ? " " + esc(q.unit) : ""}</td><td>${src(q.source, false)}</td></tr>`).join("")}</table>` : ""}

${drafts ? `<h2><span class="n">08</span>Черновик запроса на разъяснение</h2><pre class="draft">${esc(drafts.clarification)}</pre>
<h2><span class="n">09</span>Черновик жалобы в ФАС</h2><pre class="draft">${esc(drafts.complaint)}</pre>` : ""}

${r.warnings.length ? `<h2><span class="n">10</span>Что не удалось проверить</h2><ul>${r.warnings.map(w => `<li class="meta">${esc(w)}</li>`).join("")}</ul>` : ""}
<h2><span class="n">11</span>Документы</h2><ul>${r.docs.map(d => `<li>${esc(d.name)} <span class="meta mono">${d.unit === "page" ? "стр." : "абз."} ${d.parts}${d.ocrParts ? ` · OCR ${d.ocrParts}` : ""}</span></li>`).join("")}</ul>

<table class="stamp"><tr><td>Разработчик<b>kozhevnikovai</b></td><td>Номер<b>№ 004</b></td><td>Количество норм в базе<b>${r.rulesCount}</b></td><td>Версия<b>${VERSION}</b></td><td>Лицензия<b>MIT</b></td></tr></table>
</div></body></html>`;
}
