// HTML-отчёт по закупке в светлом стиле приложений kozhevnikovai: один файл, шрифты встроены, работает без интернета.
// Окно «Главное», вердикт, риски, расчёты, сроки, сведения с цитатами, чек-лист, ТЗ, черновики.
import { hasChanges, type Changes } from "../changes.js";
import { fmtSource } from "../docs/quote.js";
import type { LawRef, Report, Source } from "../types.js";
import { VERSION } from "../version.js";
import { fontFaces } from "./fonts.js";

function changesHtml(c: Changes): string {
  const head = `<h2><span class="n">00</span>Что изменилось с прошлого разбора</h2><p class="meta">Прошлый разбор: ${esc(c.since.slice(0, 16).replace("T", " "))}</p>`;
  if (!hasChanges(c)) return head + `<p>Изменений в сведениях и тексте документов нет.</p>`;
  return head + (c.fields.length ? `<table><tr><th>Сведение</th><th>Было</th><th>Стало</th></tr>${c.fields.map(f => `<tr><td>${esc(f.label)}</td><td>${esc(f.was)}</td><td><b>${esc(f.now)}</b></td></tr>`).join("")}</table>` : "") +
    c.docs.map(d => `<details open><summary><b>${esc(d.doc)}</b> — ${esc(d.status)}</summary>${d.added.map(t => `<p class="diff-add">+ ${esc(t.slice(0, 600))}</p>`).join("")}${d.removed.map(t => `<p class="diff-del">− ${esc(t.slice(0, 600))}</p>`).join("")}</details>`).join("");
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const d8 = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); const t = iso.slice(11, 16); return `${d}.${m}.${y}${t ? " " + t : ""}`; };

const CSS = `.diff-add{background:#E7F3EC;border-radius:6px;padding:4px 8px;margin:4px 0}.diff-del{background:#FCE9E7;border-radius:6px;padding:4px 8px;margin:4px 0;text-decoration:line-through;color:#5C5C57}

:root{--bg:#FBFBFA;--card:#fff;--ink:#1A1A19;--pencil:#5C5C57;--line:#E8E8E5;--plate:#F1F1EE;--acc:#C2410C;--ok:#1F7A4A;--okbg:#E7F3EC;--warn:#9A5B00;--warnbg:#FFF3DF;--bad:#B3261E;--badbg:#FCE9E7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Geologica,"Segoe UI",system-ui,sans-serif}
.sheet{max-width:1040px;margin:32px auto;padding:0 20px 40px}
.mono{font-variant-numeric:tabular-nums}
.kicker{font-size:13px;font-weight:600;color:var(--acc)}
h1{font-size:28px;line-height:1.25;margin:8px 0 6px;font-weight:600;letter-spacing:-.01em}h2{font-size:18px;margin:32px 0 12px;font-weight:600}h2 .n{display:none}
.meta{color:var(--pencil);font-size:14px}.axis{display:none}
table{border-collapse:separate;border-spacing:0;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}th{background:var(--plate);color:var(--pencil);font-weight:600;font-size:13px}tr:last-child td{border-bottom:0}
.src{font-size:12px;color:var(--pencil);display:block;margin-top:3px}
.q{display:block;font-size:12px;color:var(--pencil);border-left:2px solid var(--line);padding-left:8px;margin-top:4px}
.law{font-size:12px;background:var(--plate);border-radius:999px;padding:1px 8px;margin:4px 4px 0 0;display:inline-block;color:var(--ink);text-decoration:none}.law:hover{background:#E6E6E2}
.law.check{background:var(--warnbg);color:var(--warn)}
.tag{font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;white-space:nowrap}
.v-можем,.s-ok,.sev-низкий{color:var(--ok)}.v-нужно,.s-check,.sev-средний{color:var(--warn)}.v-нельзя,.s-missing,.sev-высокий{color:var(--bad)}
.tag.v-можем,.tag.sev-низкий{background:var(--okbg)}.tag.v-нужно,.tag.sev-средний{background:var(--warnbg)}.tag.v-нельзя,.tag.sev-высокий{background:var(--badbg)}
.main{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}
.main>div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.main .k{font-size:13px;color:var(--pencil)}.main .v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.verdict{font-size:26px;font-weight:600}
.bar{display:flex;gap:8px;margin:16px 0}.bar button{font:500 14px Geologica,system-ui,sans-serif;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px 14px;cursor:pointer;color:var(--ink)}.bar button:hover{background:var(--plate)}
button:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
pre.draft{white-space:pre-wrap;border:1px solid var(--line);border-radius:12px;padding:16px;font:14px/1.55 Geologica,sans-serif;background:var(--card)}
ol,ul{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px 14px 36px}li{margin:4px 0}
.disc{background:var(--warnbg);border-radius:12px;padding:10px 14px;color:var(--ink);font-size:13px}
.foot{margin-top:32px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--pencil)}
body.only-problems .okrow{display:none}
@media print{body{background:#fff}.bar{display:none}.sheet{margin:0;padding:0}table,.main>div{break-inside:avoid}}
@media (max-width:700px){.sheet{margin:0;padding:14px}th,td{padding:8px}}
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
${r.changes ? changesHtml(r.changes) : ""}

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

<div class="foot">Тендерный помощник ${VERSION} · норм в базе: ${r.rulesCount} · kozhevnikovai · MIT</div>
</div></body></html>`;
}
