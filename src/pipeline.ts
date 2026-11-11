// Разбор закупки целиком: по номеру извещения (карточка и документы из ЕИС) или по файлам.
// Результат — папка с отчётом HTML/MD/JSON, календарём .ics и черновиками писем.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { clarificationDraft, complaintDraft, declarationsDraft } from "./analyze/drafts.js";
import { analyzeDocs } from "./analyze/index.js";
import { extractFile } from "./docs/extract.js";
import { loadConfig, loadProfile } from "./config.js";
import { closeOcr } from "./docs/ocr.js";
import { cardDoc, downloadDocs, fetchCard } from "./eis.js";
import { draftDocx } from "./export/docx.js";
import { toHtml } from "./export/html.js";
import { toIcs, toMarkdown } from "./export/text.js";
import { appendRegistry } from "./integrations/index.js";
import type { CompanyProfile, DocText, Report } from "./types.js";

export interface RunInput { regNumber?: string; files?: string[]; profile?: CompanyProfile | null; outDir?: string; ocr?: boolean; onStep?: (s: string) => void }
export interface RunResult { report: Report; dir: string; files: Record<string, string>; docs: DocText[] }

export async function run(i: RunInput): Promise<RunResult> {
  const c = loadConfig();
  const step = i.onStep ?? (() => {});
  const files = [...(i.files ?? [])];
  const extra = [];
  const id = i.regNumber ?? `файлы-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  const dir = i.outDir ?? join(c.outputDir, id);
  mkdirSync(dir, { recursive: true });
  const dlWarnings: string[] = [];
  if (i.regNumber) {
    step("Карточка закупки в ЕИС");
    const card = await fetchCard(i.regNumber);
    extra.push(cardDoc(card));
    writeFileSync(join(dir, "карточка-еис.json"), JSON.stringify(card, null, 2));
    step(`Документы закупки: ${card.docs.length}`);
    files.push(...await downloadDocs(card, join(dir, "документы"), 20, dlWarnings));
  }
  step("Разбор документов");
  const profile = i.profile === undefined ? loadProfile() : i.profile;
  const docs = [...extra];
  for (const f of files) {
    const name = f.split(/[\\/]/).pop()!;
    step(`Читаю ${name}`);
    // один битый или защищённый паролем файл не должен ломать весь разбор
    try { docs.push(await extractFile(f, { ocr: i.ocr ?? c.ocr })); }
    catch (e) { docs.push({ name, kind: "txt", unit: "para", parts: [], tables: [], warnings: [`Файл не прочитан: ${(e as any).code === "ENOENT" ? "файл не найден (перемещён или удалён)" : (e as any).code === "EACCES" || (e as any).code === "EPERM" ? "нет доступа к файлу" : (e as Error).message.slice(0, 200)}. Откройте его вручную`] }); }
  }
  await closeOcr();
  const report = analyzeDocs(docs, { profile: profile ?? undefined });
  report.warnings.push(...dlWarnings);
  writeFileSync(join(dir, "тексты.json"), JSON.stringify(docs));
  step("Отчёт и черновики");
  const drafts = { clarification: clarificationDraft(report, profile?.name || undefined), complaint: complaintDraft(report, profile?.name ? `${profile.name}${profile.inn ? `, ИНН ${profile.inn}` : ""}` : undefined) };
  const out: Record<string, string> = {
    html: join(dir, "отчёт.html"), md: join(dir, "отчёт.md"), json: join(dir, "отчёт.json"), ics: join(dir, "сроки.ics"),
    clarification: join(dir, "черновик-запрос-разъяснений.docx"), complaint: join(dir, "черновик-жалобы-ФАС.docx"),
    declarations: join(dir, "черновик-декларации.docx"),
  };
  writeFileSync(out.html, toHtml(report, drafts));
  writeFileSync(out.md, toMarkdown(report));
  writeFileSync(out.json, JSON.stringify(report, null, 2));
  writeFileSync(out.ics, toIcs(report));
  writeFileSync(out.clarification, await draftDocx(drafts.clarification));
  writeFileSync(out.complaint, await draftDocx(drafts.complaint));
  writeFileSync(out.declarations, await draftDocx(declarationsDraft(report, profile ?? null)));
  appendRegistry(join(c.outputDir, "реестр-закупок.csv"), report, out.html);
  return { report, dir, files: out, docs };
}

/** Загрузка ранее разобранной закупки по номеру или пути к папке */
/** anyPath — для командной строки: свой путь вне папки отчётов. MCP и приложение открывают только папку отчётов. */
export function loadRun(id: string, o: { anyPath?: boolean } = {}): { report: Report; docs: DocText[]; dir: string } {
  const c = loadConfig();
  if (o.anyPath && isAbsolute(id) && existsSync(join(id, "отчёт.json"))) return readRun(id);
  const notFound = new Error(`Разбор «${id}» не найден. Сначала: tender analyze ${id}`);
  if (!existsSync(c.outputDir)) throw notFound;
  const base = realpathSync(c.outputDir);
  const cand = isAbsolute(id) ? id : join(base, id);
  if (!existsSync(join(cand, "отчёт.json"))) throw notFound;
  // только разборы из папки отчётов: «../» и чужие папки не открываются
  const dir = realpathSync(cand);
  const rel = relative(base, dir);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Можно открывать только разборы из папки отчётов");
  return readRun(dir);
}
function readRun(dir: string): { report: Report; docs: DocText[]; dir: string } {
  return { report: JSON.parse(readFileSync(join(dir, "отчёт.json"), "utf8")), docs: existsSync(join(dir, "тексты.json")) ? JSON.parse(readFileSync(join(dir, "тексты.json"), "utf8")) : [], dir };
}

export interface RunItem { id: string; title: string | null; createdAt: string; deadline: string | null; fit: string | null; highRisks: number }
/** Разобранные закупки для архива: с ближайшим сроком подачи сверху; повреждённый отчёт не ломает список */
export function listRuns(): RunItem[] {
  const c = loadConfig();
  if (!existsSync(c.outputDir)) return [];
  const out: RunItem[] = [];
  for (const d of readdirSync(c.outputDir)) {
    const f = join(c.outputDir, d, "отчёт.json");
    if (!existsSync(f)) continue;
    try {
      const r: Report = JSON.parse(readFileSync(f, "utf8"));
      const dl = r.fields?.find(x => x.key === "deadline")?.value;
      out.push({ id: d, title: r.title ?? null, createdAt: r.createdAt ?? "", deadline: typeof dl === "string" ? dl : null, fit: r.fitSummary ?? null, highRisks: (r.risks ?? []).filter(x => x.severity === "высокий").length });
    } catch { /* файл повреждён — пропускаем */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
