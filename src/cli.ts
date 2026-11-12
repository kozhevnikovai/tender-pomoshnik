#!/usr/bin/env node
// Командная строка Тендерного помощника
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkOffer } from "./analyze/requirements.js";
import { ask } from "./ask.js";
import { EMPTY_PROFILE, loadConfig, loadProfile, saveConfig, saveProfile } from "./config.js";
import { contractPlan } from "./contract.js";
import { claimDraft } from "./analyze/drafts.js";
import { draftDocx } from "./export/docx.js";
import { toIcs } from "./export/text.js";
import { antidumping, bidSecurity, contractSecurity, supplierFine } from "./law/calc.js";
import { rules, searchRules } from "./law/rules.js";
import { createLLM } from "./llm.js";
import { detectHardware, recommend } from "@kozhevnikovai/local-ai";
import { download, LLM_MODELS, missing, PACKS, selectLlm } from "./models.js";
import { runMonitor } from "./monitor.js";
import { setWatched } from "./watch.js";
import { customerHistory } from "./analytics.js";
import { setOffline } from "./net.js";
import { listRuns, loadRun, run } from "./pipeline.js";
import type { Law, Procedure } from "./types.js";
import { VERSION } from "./version.js";

const p = new Command("tender").version(VERSION).description("Тендерный помощник: разбор закупок по 44-ФЗ и 223-ФЗ с цитатами и ссылками на закон. Это помощник, а не юридическая консультация.");
p.option("--offline", "строгий офлайн: без ЕИС, интеграций и облака");
p.hook("preAction", () => { if (p.opts().offline || loadConfig().offline) setOffline(true); });

p.command("analyze").argument("<что...>", "номер извещения (19 или 11 цифр) или файлы документов").option("--no-ocr", "не распознавать сканы").option("--profile <файл>", "профиль компании JSON").option("--out <папка>").option("--json", "вывести отчёт JSON")
  .description("Разобрать закупку: требования, сроки, обеспечение, риски, вердикт, черновики")
  .action(async (what: string[], o) => {
    const reg = what.length === 1 && /^\d{11}$|^\d{19}$/.test(what[0]) ? what[0] : undefined;
    const res = await run({ regNumber: reg, files: reg ? [] : what, ocr: o.ocr, outDir: o.out, profile: o.profile ? JSON.parse(readFileSync(o.profile, "utf8")) : undefined, onStep: s => process.stderr.write(`· ${s}\n`) });
    if (o.json) return console.log(JSON.stringify(res.report, null, 2));
    const r = res.report;
    console.log(`\n${r.title ?? "Закупка"}\n№ ${r.noticeNumber ?? "—"} · ${r.law ?? "?"} · ${r.procedure ?? "?"}`);
    if (r.fitSummary) console.log(`Вердикт: ${r.fitSummary.toUpperCase()}`);
    for (const x of r.risks) console.log(`  [${x.severity}] ${x.title}`);
    console.log(`\nОтчёт: ${res.files.html}\nСроки: ${res.files.ics}\nЧерновики: ${res.files.clarification}, ${res.files.complaint}\n\n${r.disclaimer}`);
  });

p.command("ask").argument("<id>", "номер извещения или папка разбора").argument("<вопрос>").description("Вопрос по документам закупки — ответ с цитатами")
  .action(async (id: string, q: string) => {
    const { docs } = loadRun(id, { anyPath: true });
    const llm = await createLLM(loadConfig().llm);
    try {
      const a = await ask(llm, docs, q);
      console.log(a.answer);
      for (const x of a.quotes) console.log(`  «${x.quote}» — ${x.source ? `${x.source.doc}, ${x.source.unit === "page" ? "стр." : "абз."} ${x.source.n}` : "НЕ НАЙДЕНО В ДОКУМЕНТАХ"}`);
      for (const l of a.law) console.log(`  ${l.ref}: ${l.url}`);
    } finally { await llm.dispose(); }
  });

p.command("calc").description("Обеспечение, антидемпинг и штраф по 44-ФЗ").requiredOption("--nmck <₽>", "НМЦК", Number).option("--price <₽>", "ваша цена", Number).option("--bid <%>", "обеспечение заявки, %", Number).option("--security <%>", "обеспечение контракта, %", Number)
  .option("--law <закон>", "44-ФЗ или 223-ФЗ", "44-ФЗ").option("--procedure <способ>", "аукцион, конкурс, котировки", "аукцион").option("--smp", "закупка только для СМП")
  .action(o => {
    const out = [bidSecurity(o.nmck, o.bid ?? null)];
    if (o.security != null) out.push(contractSecurity(o.price ?? o.nmck, o.security));
    if (o.price) out.push(antidumping({ law: o.law as Law, procedure: o.procedure as Procedure, nmck: o.nmck, price: o.price, securityPercent: o.security ?? null }));
    out.push(supplierFine(o.price ?? o.nmck, !!o.smp));
    for (const c of out) console.log(`${c.label}: ${c.value}\n  ${c.formula}\n  ${c.law.map(l => `${l.act}, ${l.ref}${l.status === "check" ? " (проверить)" : ""} ${l.url}`).join("\n  ")}`);
  });

p.command("check").argument("<id>").argument("<предложение.json>", "{\"Ширина стола\": \"650\", ...}").description("Проверить характеристики заявки по ТЗ")
  .action((id: string, file: string) => {
    const { report } = loadRun(id, { anyPath: true });
    const res = checkOffer(report.requirements, JSON.parse(readFileSync(file, "utf8")));
    for (const x of res) console.log(`${x.ok === true ? "✓" : x.ok === false ? "✗" : "?"} ${x.name}: ${x.offered || "—"} (ТЗ: ${x.required}) — ${x.reason}`);
    const bad = res.filter(x => x.ok === false).length;
    console.log(bad ? `\nНе соответствует или не заполнено: ${bad}` : "\nВсе числовые характеристики соответствуют ТЗ. Текстовые проверьте вручную.");
    process.exitCode = bad ? 1 : 0;
  });

p.command("claim").argument("<id>").requiredOption("--amount <₽>", "не уплаченная в срок сумма").requiredOption("--due <ГГГГ-ММ-ДД>", "последний день срока оплаты").requiredOption("--rate <%>", "ключевая ставка ЦБ, %").option("--paid <ГГГГ-ММ-ДД>", "дата оплаты (без неё — расчёт на сегодня)").option("--contract <номер>").option("--contract-date <ГГГГ-ММ-ДД>")
  .description("Претензия заказчику о просрочке оплаты с расчётом пени (DOCX)")
  .action(async (id: string, o) => {
    const { report, dir } = loadRun(id, { anyPath: true });
    const t = claimDraft(report, { amount: Number(String(o.amount).replace(/\s/g, "").replace(",", ".")), dueDate: o.due, paidAt: o.paid, keyRate: Number(String(o.rate).replace(",", ".")), contractNumber: o.contract, contractDate: o.contractDate }, loadProfile());
    const f = join(dir, "черновик-претензии.docx");
    writeFileSync(f, await draftDocx(t));
    console.log(t.split("\n").find(l => l.includes(" / 300 ×")));
    console.log(`Черновик: ${f}`);
  });

p.command("contract").argument("<id>").requiredOption("--signed <ГГГГ-ММ-ДД>").description("План исполнения контракта после победы (.ics)")
  .action((id: string, o) => {
    const { report, dir } = loadRun(id, { anyPath: true });
    const plan = contractPlan(report, o.signed);
    for (const d of plan) console.log(`${d.at}  ${d.title} — ${d.basis}`);
    const f = join(dir, "исполнение-контракта.ics");
    writeFileSync(f, toIcs({ ...report, deadlines: plan }));
    console.log(`\nКалендарь: ${f}`);
  });

p.command("list").description("Разобранные закупки").action(() => { for (const x of listRuns()) console.log(`${x.id}  ${x.createdAt.slice(0, 10)}  ${x.title ?? ""}`); });

const prof = p.command("profile").description("Профиль компании (хранится только на этом компьютере)");
prof.command("show").action(() => console.log(JSON.stringify(loadProfile() ?? EMPTY_PROFILE, null, 2)));
prof.command("set").argument("<файл.json>").action((f: string) => { saveProfile({ ...EMPTY_PROFILE, ...JSON.parse(readFileSync(f, "utf8")) }); console.log("Профиль сохранён"); });
prof.command("template").action(() => console.log(JSON.stringify({ ...EMPTY_PROFILE, name: "ООО «Пример»", inn: "0000000000", okved: ["47.62"], licenses: [], contracts: [{ price: 450000, finishedAt: "2026-03-15", penalties: false, subject: "канцтовары" }], products: [{ name: "Бумага А4", country: "Россия", registry: "10123456/2026" }], regions: ["Чувашская Республика"], maxSecurity: 300000 }, null, 2)));

const mon = p.command("monitor").description("Мониторинг новых закупок в ЕИС");
mon.command("add").argument("<слова>").option("--minus <слова>", "через запятую").option("--price-from <₽>", "", Number).option("--price-to <₽>", "", Number).option("--only44").option("--only223")
  .action((text: string, o) => { const c = loadConfig(); c.monitor.queries.push({ text, minus: o.minus?.split(",").map((s: string) => s.trim()), priceFrom: o.priceFrom, priceTo: o.priceTo, law44: !o.only223, law223: !o.only44 }); saveConfig(c); console.log(`Запросов: ${c.monitor.queries.length}`); });
mon.command("list").action(() => console.log(JSON.stringify(loadConfig().monitor, null, 2)));
mon.command("run").option("--notify", "отправить в Telegram/почту").action(async o => {
  const r = await runMonitor({ notify: o.notify });
  for (const x of r.changes) console.log(`* ${x.regNumber}  ${x.title ?? ""}\n${x.changes.map(c => `  — ${c}`).join("\n")}`);
  for (const x of r.found) console.log(`+ ${x.regNumber}  ${x.title}\n  ${x.url}`);
  for (const e of r.errors) console.log(`! ${e}`);
  console.log(`\nНовых: ${r.found.length}, отсеяно: ${r.skipped.length}, изменений в избранных: ${r.changes.length}`);
});
mon.command("watch").argument("<номер>").option("--off", "перестать следить").description("Следить за изменениями закупки: новые документы, разъяснения, протоколы, сроки")
  .action((reg: string, o) => { const l = setWatched(reg.replace(/\D/g, ""), !o.off); console.log(`Избранных закупок: ${l.length}`); });

p.command("customer").argument("<название...>").description("Аналитика заказчика: последние закупки в ЕИС, этапы, отмены, типичная цена")
  .action(async (w: string[]) => {
    const s = await customerHistory(w.join(" "));
    console.log(`${s.customer}: закупок ${s.total}${s.medianPrice ? `, медианная НМЦК ${s.medianPrice.toLocaleString("ru-RU")} ₽` : ""}${s.cancelledShare != null ? `, отменено ${s.cancelledShare}%` : ""}`);
    console.log(`Этапы: ${Object.entries(s.byStage).map(([k, v]) => `${k} — ${v}`).join("; ")}`);
    if (s.topWords.length) console.log(`Чаще всего закупает: ${s.topWords.join(", ")}`);
    for (const r of s.recent.slice(0, 10)) console.log(`  ${r.published?.slice(0, 16) ?? ""}  ${r.regNumber}  ${r.title.slice(0, 80)}${r.price ? ` · ${r.price.toLocaleString("ru-RU")} ₽` : ""}`);
    for (const n of s.notes) console.log(`ℹ ${n}`);
  });

p.command("rules").argument("[слова...]").option("--all").description("База норм: поиск по словам").action((w: string[], o) => {
  const list = o.all || !w.length ? rules().rules : searchRules(w.join(" "));
  console.log(`База норм ${rules().version}, карточек: ${rules().rules.length}\n`);
  for (const r of list) console.log(`${r.act}, ${r.ref} — ${r.title}${r.status === "check" ? " [проверить]" : ""}\n  ${r.summary}\n  ${r.sources.join("\n  ")}\n`);
});

p.command("models").option("--model <id>", `языковая модель: ${LLM_MODELS.map(m => `${m.id} (${m.title})`).join(", ")}`).option("--no-llm", "только OCR, без языковой модели").description("Скачать модели: OCR и локальную языковую модель (выбирается по компьютеру)").action(async o => {
  let id: string | undefined = o.model ?? loadConfig().llm.localModel;
  if (!id && o.llm !== false) {
    const r = recommend(await detectHardware());
    console.log(r.reason);
    id = r.model.id;
  }
  if (id && o.llm !== false) { const ok = selectLlm(id); if (ok !== loadConfig().llm.localModel) saveConfig({ llm: { localModel: ok } }); }
  const packs = o.llm === false ? ["ocr"] : ["ocr", "llm"];
  if (!missing(packs).length) return console.log("Модели уже скачаны");
  for (const id of packs) console.log(`• ${PACKS[id].title} — ${PACKS[id].license}`);
  await download(packs, e => process.stderr.write(`\r${e.file}: ${Math.round(e.done / e.total * 100)}%   `));
  console.log("\nГотово. Дальше разбор работает без интернета.");
});

p.command("mcp").description("MCP-сервер для Claude Desktop и других клиентов").action(async () => { const { startMcp } = await import("./mcp.js"); await startMcp(); });

p.parseAsync().catch(e => { console.error(`Ошибка: ${e.message}`); process.exit(1); });
