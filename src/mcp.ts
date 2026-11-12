// MCP-сервер: Claude Desktop разбирает закупки локальным ядром и отвечает на вопросы с цитатами.
// Документы компании не покидают компьютер — Claude получает только текст закупки и отчёт.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { claimDraft, clarificationDraft, complaintDraft } from "./analyze/drafts.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { draftDocx } from "./export/docx.js";
import { checkOffer } from "./analyze/requirements.js";
import { retrieve } from "./ask.js";
import { EMPTY_PROFILE, loadProfile, saveProfile } from "./config.js";
import { contractPlan } from "./contract.js";
import { locate, fmtSource } from "./docs/quote.js";
import { fetchResults, searchRss } from "./eis.js";
import { customerHistory } from "./analytics.js";
import { toMarkdown } from "./export/text.js";
import { changesMarkdown } from "./changes.js";
import { antidumping, bidSecurity, contractSecurity, supplierFine } from "./law/calc.js";
import { searchRules } from "./law/rules.js";
import { listRuns, loadRun, run } from "./pipeline.js";
import type { Law, Procedure } from "./types.js";
import { VERSION } from "./version.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const RULES = `Правила ответа пользователю (обязательно):
1. Любое утверждение о закупке — с источником: документ и страница/абзац, цитата в кавычках. Утверждение о законе — только из карточек норм (инструмент law_lookup) со ссылкой.
2. Перед ответом проверь свои цитаты инструментом verify_quotes. Не найдена — не используй её.
3. Если данных нет или у нормы статус «проверить» — так и скажи: «проверить», не выдумывай.
4. Ты не подаёшь заявки, не подписываешь документы и не работаешь с ЭЦП и паролями площадок — подаёт человек.
5. В конце: «Это помощник, а не юридическая консультация; финальное решение и проверка — за вами».`;

const DOC_EXT = /\.(pdf|docx|doc|odt|rtf|xlsx|xls|ods|zip|txt|md|png|jpe?g|tiff?|bmp|webp)$/i;
/**
 * Файлы для разбора через MCP: только документы и только не из скрытых и служебных папок.
 * Иначе подсказка, спрятанная в чужом документе, могла бы заставить модель «разобрать» ключи или настройки.
 */
export function assertDocPath(p: string) {
  const parts = p.split(/[\\/]+/);
  if (!DOC_EXT.test(p)) throw new Error(`Не документ закупки: ${parts.at(-1)}. Подойдут PDF, DOCX, DOC, ODT, RTF, XLS/XLSX, ZIP, TXT и сканы`);
  if (parts.some(x => (x.startsWith(".") && x.length > 1 && x !== "..") || /^(AppData|Keychains|ProgramData|System32|etc)$/i.test(x)) || parts.includes(".."))
    throw new Error("Файлы из скрытых и системных папок через Claude не разбираются — скопируйте документ в обычную папку");
}

export function buildServer(): McpServer {
  const s = new McpServer({ name: "tender-pomoshnik", version: VERSION });

  s.registerTool("analyze_tender", {
    title: "Разобрать закупку",
    description: "Разбирает закупку 44-ФЗ/223-ФЗ: по номеру извещения скачивает карточку и документы из открытой части ЕИС, либо читает файлы (PDF, DOCX, DOC, RTF, XLS/XLSX, сканы — OCR локально). Возвращает сведения с цитатами, расчёты обеспечения и антидемпинга, риски, сроки, вердикт по профилю компании и путь к HTML-отчёту.",
    inputSchema: { reg_number: z.string().optional().describe("Номер извещения: 19 цифр (44-ФЗ) или 11 цифр (223-ФЗ)"), files: z.array(z.string()).optional().describe("Полные пути к документам закупки") },
  }, async ({ reg_number, files }) => {
    if (!reg_number && !files?.length) throw new Error("Нужен номер извещения или файлы");
    files?.forEach(assertDocPath);
    const r = await run({ regNumber: reg_number, files });
    return text(`${RULES}\n\nid разбора: ${reg_number ?? r.dir}\nОтчёт: ${r.files.html}\nКалендарь: ${r.files.ics}\nЧерновики: ${r.files.clarification}; ${r.files.complaint}\n\n${toMarkdown(r.report)}`);
  });

  s.registerTool("get_tender_text", {
    title: "Фрагменты документов",
    description: "Ищет в документах разобранной закупки фрагменты по словам (для ответа на вопрос). Каждый фрагмент — с документом и страницей/абзацем.",
    inputSchema: { id: z.string(), query: z.string(), limit: z.number().int().min(1).max(40).optional() },
  }, async ({ id, query, limit }) => {
    const { docs } = loadRun(id);
    const hits = retrieve(docs, query, limit ?? 15);
    return text(hits.length ? hits.map(h => `[${h.d.name}, ${h.d.unit === "page" ? "стр." : "абз."} ${h.p.n}]\n${h.p.text.slice(0, 1500)}`).join("\n\n") : "В документах не найдено — проверить вручную.");
  });

  s.registerTool("verify_quotes", {
    title: "Проверить цитаты",
    description: "Проверяет, что цитаты дословно есть в документах закупки, и возвращает их место. Вызывай перед ответом пользователю.",
    inputSchema: { id: z.string(), quotes: z.array(z.string()).min(1) },
  }, async ({ id, quotes }) => {
    const { docs } = loadRun(id);
    return text(quotes.map(q => { const src = locate(docs, q); return src ? `✓ «${q}» — ${fmtSource(src)}` : `✗ «${q}» — НЕ НАЙДЕНО, не используй`; }).join("\n"));
  });

  s.registerTool("law_lookup", {
    title: "Нормы 44-ФЗ / 223-ФЗ",
    description: "Ищет в базе норм (с редакциями и источниками): обеспечение, антидемпинг, сроки, разъяснения, жалобы, неустойки, нацрежим. Статус «проверить» — сверить с первоисточником.",
    inputSchema: { query: z.string(), date: z.string().optional().describe("Дата извещения ГГГГ-ММ-ДД") },
  }, async ({ query, date }) => {
    const list = searchRules(query, date).slice(0, 8);
    return text(list.length ? list.map(r => `[${r.id}] ${r.act}, ${r.ref} — ${r.title}${r.status === "check" ? " [ПРОВЕРИТЬ]" : ""} (действует с ${r.validFrom})\n${r.summary}\nИсточники: ${r.sources.join(" ; ")}`).join("\n\n") : "В базе норм нет подходящей карточки — ответ «проверить».");
  });

  s.registerTool("calc_security", {
    title: "Расчёт обеспечения и антидемпинга",
    description: "Обеспечение заявки и контракта, антидемпинг (ст. 37) и штраф (ПП № 1042) по 44-ФЗ — с формулами и нормами.",
    inputSchema: { nmck: z.number(), price: z.number().optional(), bid_percent: z.number().optional(), security_percent: z.number().optional(), law: z.enum(["44-ФЗ", "223-ФЗ"]).optional(), procedure: z.enum(["аукцион", "конкурс", "котировки", "запрос предложений", "иное"]).optional(), smp_only: z.boolean().optional() },
  }, async a => {
    const out = [bidSecurity(a.nmck, a.bid_percent ?? null)];
    if (a.security_percent != null) out.push(contractSecurity(a.price ?? a.nmck, a.security_percent));
    if (a.price) out.push(antidumping({ law: (a.law ?? "44-ФЗ") as Law, procedure: (a.procedure ?? "аукцион") as Procedure, nmck: a.nmck, price: a.price, securityPercent: a.security_percent ?? null }));
    out.push(supplierFine(a.price ?? a.nmck, !!a.smp_only));
    return text(out.map(c => `${c.label}: ${c.value}\nРасчёт: ${c.formula}\nНормы: ${c.law.map(l => `${l.act}, ${l.ref}${l.status === "check" ? " [проверить]" : ""} ${l.url}`).join("; ")}`).join("\n\n"));
  });

  s.registerTool("check_application", {
    title: "Проверка заявки по ТЗ",
    description: "Сравнивает значения характеристик, которые участник собирается указать в заявке, с требованиями ТЗ.",
    inputSchema: { id: z.string(), offer: z.record(z.string(), z.string()).describe('{"Ширина стола": "650"}') },
  }, async ({ id, offer }) => {
    const res = checkOffer(loadRun(id).report.requirements, offer);
    return text(res.map(x => `${x.ok === true ? "✓" : x.ok === false ? "✗" : "?"} ${x.name}: ${x.offered || "—"} (ТЗ: ${x.required}) — ${x.reason}${x.source ? ` [${fmtSource(x.source)}]` : ""}`).join("\n"));
  });

  s.registerTool("draft_letter", {
    title: "Черновик запроса или жалобы",
    description: "Черновик запроса на разъяснение или жалобы в ФАС по рискам из разбора. Только черновик: пользователь проверяет и подаёт сам.",
    inputSchema: { id: z.string(), kind: z.enum(["разъяснение", "жалоба"]) },
  }, async ({ id, kind }) => {
    const { report } = loadRun(id);
    const p = loadProfile();
    return text(kind === "жалоба" ? complaintDraft(report, p?.name || undefined) : clarificationDraft(report, p?.name || undefined));
  });

  s.registerTool("company_profile", {
    title: "Профиль компании",
    description: "Показать или сохранить профиль компании (ОКВЭД, МСП, лицензии, СРО, опыт, товары и реестровые номера). Хранится только на этом компьютере.",
    inputSchema: { set: z.record(z.string(), z.any()).optional() },
  }, async ({ set }) => {
    if (set) saveProfile({ ...(loadProfile() ?? EMPTY_PROFILE), ...set } as any);
    return text(JSON.stringify(loadProfile() ?? EMPTY_PROFILE, null, 2));
  });

  s.registerTool("search_tenders", {
    title: "Поиск закупок в ЕИС",
    description: "Поиск закупок на этапе подачи заявок через официальный RSS ЕИС.",
    inputSchema: { text: z.string(), price_from: z.number().optional(), price_to: z.number().optional(), only44: z.boolean().optional(), only223: z.boolean().optional() },
  }, async a => {
    const items = await searchRss({ text: a.text, priceFrom: a.price_from, priceTo: a.price_to, law44: !a.only223, law223: !a.only44 });
    return text(items.length ? items.slice(0, 30).map(i => `${i.regNumber} — ${i.title}\n${i.url}`).join("\n\n") : "Ничего не найдено.");
  });

  s.registerTool("contract_plan", {
    title: "План исполнения контракта",
    description: "После победы: сроки поставки, приёмки и оплаты от даты подписания.",
    inputSchema: { id: z.string(), signed_at: z.string().describe("ГГГГ-ММ-ДД") },
  }, async ({ id, signed_at }) => text(contractPlan(loadRun(id).report, signed_at).map(d => `${d.at} — ${d.title}: ${d.basis}`).join("\n")));

  s.registerTool("draft_claim", {
    title: "Претензия заказчику о просрочке оплаты",
    description: "Черновик претензии с расчётом пени заказчика (1/300 ключевой ставки за день, ч. 5 ст. 34 44-ФЗ). Сохраняет DOCX в папку закупки. Ключевую ставку спросите у пользователя или возьмите с cbr.ru.",
    inputSchema: { id: z.string(), amount: z.number().positive(), due_date: z.string().describe("последний день срока оплаты, ГГГГ-ММ-ДД"), key_rate: z.number().positive(), paid_at: z.string().optional(), contract_number: z.string().optional() },
  }, async a => {
    const { report, dir } = loadRun(a.id);
    const t = claimDraft(report, { amount: a.amount, dueDate: a.due_date, keyRate: a.key_rate, paidAt: a.paid_at, contractNumber: a.contract_number }, loadProfile());
    const f = join(dir, "черновик-претензии.docx");
    writeFileSync(f, await draftDocx(t));
    return text(`${t}\n\nDOCX: ${f}`);
  });

  s.registerTool("customer_history", {
    title: "Аналитика заказчика",
    description: "Последние закупки заказчика в открытой части ЕИС: этапы, доля отмен, типичная НМЦК, частые предметы, а по завершённым закупкам 44-ФЗ — победители и среднее снижение от НМЦК.",
    inputSchema: { customer: z.string().describe("название заказчика, как в извещении") },
  }, async ({ customer }) => text(JSON.stringify(await customerHistory(customer), null, 2)));

  s.registerTool("tender_results", {
    title: "Итоги закупки",
    description: "Итоги закупки 44-ФЗ из открытой части ЕИС: предложения участников, победитель, цена заключённого контракта и снижение от НМЦК.",
    inputSchema: { regNumber: z.string().regex(/^\d{19}$/).describe("номер извещения 44-ФЗ, 19 цифр") },
  }, async ({ regNumber }) => text(JSON.stringify(await fetchResults(regNumber), null, 2)));

  s.registerTool("tender_changes", {
    title: "Что изменилось в закупке",
    description: "Сравнение последнего разбора закупки с прошлым: изменённые сведения (НМЦК, сроки, обеспечение) и пункты документов — добавленные и убранные после изменения извещения или разъяснения. Чтобы сравнение появилось, разберите закупку повторно через analyze_tender.",
    inputSchema: { id: z.string().describe("номер извещения или папка разбора из list_tenders") },
  }, async ({ id }) => {
    const r = loadRun(id).report;
    return text(r.changes ? changesMarkdown(r.changes).join("\n") : "Сравнивать не с чем: закупка разобрана один раз. Разберите её повторно (analyze_tender) после изменения извещения или разъяснения.");
  });

  s.registerTool("list_tenders", { title: "Разобранные закупки", description: "Список ранее разобранных закупок.", inputSchema: {} }, async () => text(listRuns().map(x => `${x.id} · ${x.createdAt.slice(0, 10)} · ${x.title ?? ""}`).join("\n") || "Пока пусто."));

  return s;
}

export async function startMcp() { await buildServer().connect(new StdioServerTransport()); }
