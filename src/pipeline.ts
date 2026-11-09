// Разбор закупки целиком: по номеру извещения (карточка и документы из ЕИС) или по файлам.
// Результат — папка с отчётом HTML/MD/JSON, календарём .ics и черновиками писем.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clarificationDraft, complaintDraft } from "./analyze/drafts.js";
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
  if (i.regNumber) {
    step("Карточка закупки в ЕИС");
    const card = await fetchCard(i.regNumber);
    extra.push(cardDoc(card));
    writeFileSync(join(dir, "карточка-еис.json"), JSON.stringify(card, null, 2));
    step(`Документы закупки: ${card.docs.length}`);
    files.push(...await downloadDocs(card, join(dir, "документы")));
  }
  step("Разбор документов");
  const profile = i.profile === undefined ? loadProfile() : i.profile;
  const docs = [...extra];
  for (const f of files) { step(`Читаю ${f.split(/[\\/]/).pop()}`); docs.push(await extractFile(f, { ocr: i.ocr ?? c.ocr })); }
  await closeOcr();
  const report = analyzeDocs(docs, { profile: profile ?? undefined });
  writeFileSync(join(dir, "тексты.json"), JSON.stringify(docs));
  step("Отчёт и черновики");
  const drafts = { clarification: clarificationDraft(report, profile?.name || undefined), complaint: complaintDraft(report, profile?.name ? `${profile.name}${profile.inn ? `, ИНН ${profile.inn}` : ""}` : undefined) };
  const out: Record<string, string> = {
    html: join(dir, "отчёт.html"), md: join(dir, "отчёт.md"), json: join(dir, "отчёт.json"), ics: join(dir, "сроки.ics"),
    clarification: join(dir, "черновик-запрос-разъяснений.docx"), complaint: join(dir, "черновик-жалобы-ФАС.docx"),
  };
  writeFileSync(out.html, toHtml(report, drafts));
  writeFileSync(out.md, toMarkdown(report));
  writeFileSync(out.json, JSON.stringify(report, null, 2));
  writeFileSync(out.ics, toIcs(report));
  writeFileSync(out.clarification, await draftDocx(drafts.clarification));
  writeFileSync(out.complaint, await draftDocx(drafts.complaint));
  appendRegistry(join(c.outputDir, "реестр-закупок.csv"), report, out.html);
  return { report, dir, files: out, docs };
}

/** Загрузка ранее разобранной закупки по номеру или пути к папке */
export function loadRun(id: string): { report: Report; docs: DocText[]; dir: string } {
  const c = loadConfig();
  const dir = existsSync(join(id, "отчёт.json")) ? id : join(c.outputDir, id);
  if (!existsSync(join(dir, "отчёт.json"))) throw new Error(`Разбор «${id}» не найден. Сначала: tender analyze ${id}`);
  return { report: JSON.parse(readFileSync(join(dir, "отчёт.json"), "utf8")), docs: existsSync(join(dir, "тексты.json")) ? JSON.parse(readFileSync(join(dir, "тексты.json"), "utf8")) : [], dir };
}

export function listRuns(): { id: string; title: string | null; createdAt: string }[] {
  const c = loadConfig();
  if (!existsSync(c.outputDir)) return [];
  return readdirSync(c.outputDir).filter(d => existsSync(join(c.outputDir, d, "отчёт.json"))).map(d => { const r: Report = JSON.parse(readFileSync(join(c.outputDir, d, "отчёт.json"), "utf8")); return { id: d, title: r.title, createdAt: r.createdAt }; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
