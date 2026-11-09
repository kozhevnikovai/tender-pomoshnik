// Evals Тендерного помощника на реальных закупках ЕИС.
// Эталон: evals/cases/*.json (поля из карточки ЕИС + ручная разметка условий контракта).
// Документы не хранятся в репозитории (в них персональные данные): node evals/fetch.mjs скачивает их из открытой части ЕИС.
// Два режима: «по номеру» (карточка ЕИС + документы) и «только файлы» (как будто пользователь загрузил документы сам).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { analyzeDocs } from "../dist/analyze/index.js";
import { extractFile } from "../dist/docs/extract.js";
import { locate } from "../dist/docs/quote.js";
import { cardDoc, parseCard } from "../dist/eis.js";
import { money } from "../dist/analyze/fields.js";

const DATA = process.env.EVAL_DATA ?? "evals/data";
const CASES = process.env.EVAL_CASES ?? "evals/cases";
const cases = readdirSync(CASES).map(f => JSON.parse(readFileSync(`${CASES}/${f}`, "utf8"))).filter(c => !c.skip);
const NOW = new Date("2026-11-09T12:00:00+03:00");
const score = {}; const rows = [];
const hit = (mode, k, ok) => { const s = (score[`${mode}:${k}`] ??= { ok: 0, n: 0 }); s.n++; if (ok) s.ok++; };
let quotesTotal = 0, quotesOk = 0;

const val = (r, k) => r.fields.find(f => f.key === k)?.value ?? null;
const day = s => s ? String(s).slice(0, 16).replace(/:00\+\d\d:\d\d$|[+-]\d\d:\d\d$/, "") : null;
const num = v => typeof v === "number" ? v : v == null ? null : money(String(v));

for (const c of cases) {
  const dir = `${DATA}/${c.reg}`;
  if (!existsSync(dir)) { console.log(`нет данных ${c.reg}`); continue; }
  const files = readdirSync(dir).filter(f => f !== "card.html");
  const docs = [];
  for (const f of files) { try { docs.push(await extractFile(`${dir}/${f}`, { ocr: false })); } catch (e) { console.log(`  ${c.reg}/${f}: ${e.message}`); } }
  const card = cardDoc({ regNumber: c.reg, url: c.url, law: c.expected.law, fields: parseCard(readFileSync(`${dir}/card.html`, "utf8")), docs: [] });
  for (const [mode, input] of [["номер", [card, ...docs]], ["файлы", docs]]) {
    const r = analyzeDocs(input, { now: NOW });
    const e = c.expected;
    const fl = { smp: r.checklist.some(x => /СМП/.test(x.item)), ban: r.checklist.some(x => /реестровых записей/.test(x.item)) };
    const checks = {
      law: r.law === e.law,
      procedure: e.procedure === "иное" ? null : r.procedure === e.procedure,
      noticeNumber: mode === "файлы" ? null : r.noticeNumber === e.noticeNumber,
      nmck: (c.manual.nmck ?? e.nmck) == null ? null : Math.abs((num(val(r, "nmck")) ?? -1) - (c.manual.nmck ?? e.nmck)) < 1,
      deadline: e.deadline == null ? null : day(val(r, "deadline")) === e.deadline,
      results: e.results == null ? null : day(val(r, "results")) === e.results,
      bidSecurity: e.bidSecurity == null ? null : Math.abs((num(val(r, "bidSecurity")) ?? -1) - e.bidSecurity) < 1,
      contractSecurity: e.contractSecurity == null ? null : Math.abs((num(val(r, "contractSecurity")) ?? -1) - e.contractSecurity.value) < 0.01 * Math.max(1, e.contractSecurity.value),
      smpOnly: fl.smp === e.smpOnly,
      nationalBan: e.nationalBan ? fl.ban : null,
      payDays: c.manual.payDays == null ? null : String(val(r, "payDays") ?? "").trim() === c.manual.payDays,
      deliveryDays: c.manual.deliveryDays == null ? null : String(val(r, "deliveryDays") ?? "").trim() === c.manual.deliveryDays,
      finePct: c.manual.finePct == null ? null : num(val(r, "finePct")) === c.manual.finePct,
      advance: c.manual.advance == null ? null : val(r, "advance") === c.manual.advance,
    };
    for (const [k, ok] of Object.entries(checks)) if (ok !== null) hit(mode, k, ok);
    const fails = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k);
    // каждая цитата отчёта должна находиться в документах дословно
    for (const f of r.fields) if (f.source) { quotesTotal++; if (locate(input, f.source.quote)) quotesOk++; }
    for (const x of r.risks) if (x.source) { quotesTotal++; if (locate(input, x.source.quote)) quotesOk++; }
    rows.push({ reg: c.reg, mode, fails, risks: r.risks.map(x => x.id), reqs: r.requirements.length });
  }
}

const fields = [...new Set(Object.keys(score).map(k => k.split(":")[1]))];
const pct = s => s ? `${Math.round(s.ok / s.n * 100)}% (${s.ok}/${s.n})` : "—";
const lines = ["# Evals: Тендерный помощник", "", `Закупок: ${cases.length} (44-ФЗ: ${cases.filter(c => c.reg.length === 19).length}, 223-ФЗ: ${cases.filter(c => c.reg.length === 11).length}), реальные извещения ЕИС на 09.11.2026. Без OCR и без языковой модели — только правила.`, "", "| Поле | По номеру (карточка + документы) | Только файлы |", "|---|---|---|"];
for (const k of fields) lines.push(`| ${k} | ${pct(score[`номер:${k}`])} | ${pct(score[`файлы:${k}`])} |`);
const tot = m => { const s = Object.entries(score).filter(([k]) => k.startsWith(m)).reduce((a, [, v]) => ({ ok: a.ok + v.ok, n: a.n + v.n }), { ok: 0, n: 0 }); return pct(s); };
lines.push(`| **Итого** | **${tot("номер:")}** | **${tot("файлы:")}** |`, "", `Цитаты в отчётах найдены в документах дословно: ${pct({ ok: quotesOk, n: quotesTotal })}.`, "", "## Ошибки по закупкам", "");
for (const r of rows) if (r.fails.length) lines.push(`- ${r.reg} (${r.mode}): ${r.fails.join(", ")}`);
lines.push("", "## Найденные риски (режим «по номеру»)", "");
for (const r of rows.filter(r => r.mode === "номер")) lines.push(`- ${r.reg}: ${r.risks.join(", ") || "—"}; характеристик ТЗ: ${r.reqs}`);
writeFileSync(process.env.EVAL_OUT ? `${process.env.EVAL_OUT}.md` : "evals/results.md", lines.join("\n") + "\n");
writeFileSync(process.env.EVAL_OUT ? `${process.env.EVAL_OUT}.json` : "evals/results.json", JSON.stringify({ score, quotes: { ok: quotesOk, total: quotesTotal }, rows }, null, 2));
console.log(lines.slice(0, 26).join("\n"));
