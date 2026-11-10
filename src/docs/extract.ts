// Извлечение текста документов закупки: PDF (по страницам), DOCX (по абзацам, с таблицами),
// TXT, сканы и картинки — через локальный OCR. Ничего не отправляется в сеть.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { DocText } from "../types.js";
import { ocrImage } from "./ocr.js";

/** Страница PDF с меньшим числом букв считается сканом и уходит в OCR */
const SCAN_THRESHOLD = 40;

interface ExtractOpts { ocr?: boolean; depth?: number }

export async function extractFile(path: string, opts: { ocr?: boolean } = {}): Promise<DocText> {
  return extractBuffer(basename(path), readFileSync(path), opts);
}

/** Ограничения для архивов: защита от «zip-бомб» и бесконечной вложенности */
export const ZIP_LIMITS = { entries: 30, entryBytes: 100 * 1024 * 1024, totalBytes: 300 * 1024 * 1024, depth: 2 };
/** Больше стольких страниц-сканов не распознаём: OCR медленный */
export const OCR_MAX_PAGES = 60;

/** Архивы ZIP (в ЕИС документы часто упакованы): все поддерживаемые файлы внутри склеиваются в один документ */
async function extractZip(name: string, buf: Buffer, opts: ExtractOpts): Promise<DocText> {
  const out: DocText = { name, kind: "docx", unit: "para", parts: [], tables: [], warnings: [] };
  const depth = (opts.depth ?? 0) + 1;
  if (depth > ZIP_LIMITS.depth) return { ...out, warnings: ["Архив внутри архива внутри архива — не распаковываем, откройте вручную"] };
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf).catch(() => { throw new Error("архив повреждён или защищён паролем"); });
  const all = Object.values(zip.files).filter(f => !f.dir);
  if (all.length > ZIP_LIMITS.entries) out.warnings.push(`В архиве ${all.length} файлов, прочитаны первые ${ZIP_LIMITS.entries}`);
  const entries = all.slice(0, ZIP_LIMITS.entries);
  let total = 0;
  for (const f of entries) {
    // размер после распаковки объявлен в архиве: «бомбу» не распаковываем вовсе
    const size = Number((f as any)._data?.uncompressedSize ?? 0);
    if (size > ZIP_LIMITS.entryBytes || total + size > ZIP_LIMITS.totalBytes) { out.warnings.push(`${f.name}: слишком большой после распаковки — пропущен`); continue; }
    const data = Buffer.from(await f.async("uint8array"));
    total += data.length;
    if (total > ZIP_LIMITS.totalBytes) { out.warnings.push("Архив слишком большой после распаковки — остальные файлы пропущены"); break; }
    let inner: DocText;
    try { inner = await extractBuffer(f.name.split("/").pop()!, data, { ...opts, depth }); }
    catch (e) { out.warnings.push(`${f.name}: не прочитан (${(e as Error).message.slice(0, 120)})`); continue; }
    if (entries.length === 1) return { ...inner, name: `${name} → ${inner.name}` };
    out.warnings.push(...inner.warnings.map(w => `${inner.name}: ${w}`));
    for (const p of inner.parts) out.parts.push({ n: out.parts.length + 1, text: p.text, ocr: p.ocr });
    out.tables.push(...inner.tables);
  }
  return out;
}

/** DOCX и ODT — тоже архивы: «бомбу» (маленький файл, сотни мегабайт после распаковки) не открываем */
export const OFFICE_MAX_BYTES = 150 * 1024 * 1024;
async function assertOfficeSize(buf: Buffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf).catch(() => { throw new Error("файл повреждён"); });
  const total = Object.values(zip.files).reduce((a, f) => a + Number((f as any)._data?.uncompressedSize ?? 0), 0);
  if (total > OFFICE_MAX_BYTES) throw new Error("документ слишком большой после распаковки — откройте его вручную");
  return zip;
}

/** OpenDocument (.odt): текст из content.xml */
async function extractOdt(name: string, buf: Buffer): Promise<DocText> {
  const xml = await (await assertOfficeSize(buf)).file("content.xml")?.async("string") ?? "";
  const html = xml.replace(/<table:table-row[^>]*>/g, "<tr>").replace(/<\/table:table-row>/g, "</tr>").replace(/<table:table-cell[^>]*>/g, "<td>").replace(/<\/table:table-cell>/g, "</td>").replace(/<table:table [^>]*>/g, "<table>").replace(/<\/table:table>/g, "</table>").replace(/<\/text:(?:p|h)>/g, "</p>");
  return fromHtml(name, html);
}

export async function extractBuffer(name: string, buf: Buffer, opts: ExtractOpts = {}): Promise<DocText> {
  const ext = extname(name).toLowerCase();
  if (ext === ".zip") return extractZip(name.replace(/\.zip$/i, ""), buf, opts);
  if (ext === ".odt") return extractOdt(name, buf);
  if (ext === ".pdf") return extractPdf(name, buf, opts.ocr !== false);
  if (ext === ".docx") return extractDocx(name, buf);
  if (ext === ".txt" || ext === ".md") return fromPlain(name, buf.toString("utf8"));
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"].includes(ext)) {
    if (opts.ocr === false) return { name, kind: "image", unit: "page", parts: [], tables: [], warnings: ["Картинка пропущена: распознавание (OCR) выключено"] };
    if (buf.length > 40 * 1024 * 1024) return { name, kind: "image", unit: "page", parts: [], tables: [], warnings: ["Картинка больше 40 МБ — не распознаётся, откройте вручную"] };
    const text = await ocrImage(buf);
    return { name, kind: "image", unit: "page", parts: [{ n: 1, text, ocr: true }], tables: [], warnings: [] };
  }
  if (ext === ".doc") return extractDoc(name, buf);
  if (ext === ".rtf" || ext === ".xls" || ext === ".xlsx" || ext === ".rar" || ext === ".7z") {
    return { name, kind: "txt", unit: "para", parts: [], tables: [], warnings: [`Формат ${ext} пока не читается: сохраните файл как PDF или DOCX`] };
  }
  return { name, kind: "txt", unit: "para", parts: [], tables: [], warnings: [`Неизвестный формат ${ext}`] };
}

export function fromPlain(name: string, text: string): DocText {
  const paras = text.split(/\r?\n\s*\r?\n|\r?\n(?=\s*\d+(?:\.\d+)*[.)]\s)/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { name, kind: "txt", unit: "para", parts: paras.map((t, i) => ({ n: i + 1, text: t })), tables: [], warnings: [] };
}

async function extractPdf(name: string, buf: Buffer, ocr: boolean): Promise<DocText> {
  const { getDocumentProxy, extractText, renderPageAsImage } = await import("unpdf");
  const data = new Uint8Array(buf);
  const pdf = await getDocumentProxy(data, { verbosity: 0 } as any).catch((e: Error) => { throw new Error(/password/i.test(e.message) ? "PDF защищён паролем" : "PDF повреждён"); });
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ n: i + 1, text: tidy(t), ocr: false as boolean }));
  const warnings: string[] = [];
  const scans = pages.filter(p => letters(p.text) < SCAN_THRESHOLD);
  if (scans.length && !ocr) warnings.push(`${scans.length} стр. похожи на скан, а OCR выключен — эти страницы не прочитаны`);
  if (scans.length > OCR_MAX_PAGES && ocr) warnings.push(`Сканов ${scans.length} стр., распознаны первые ${OCR_MAX_PAGES} — остальные проверьте вручную`);
  if (scans.length && ocr) {
    for (const p of scans.slice(0, OCR_MAX_PAGES)) {
      try {
        const png = await renderPageAsImage(new Uint8Array(buf), p.n, { canvasImport: () => import("@napi-rs/canvas"), scale: 2.5 });
        p.text = tidy(await ocrImage(Buffer.from(png)));
        p.ocr = true;
      } catch (e) {
        warnings.push(`Стр. ${p.n}: не удалось распознать скан (${(e as Error).message})`);
      }
    }
    warnings.push(`Распознано OCR: ${scans.map(p => p.n).join(", ")} — сверяйте цифры с оригиналом`);
  }
  return { name, kind: "pdf", unit: "page", parts: pages, tables: [], warnings };
}

/** Старый формат Word (.doc): текст без таблиц-структуры, ячейки разделены табуляцией */
async function extractDoc(name: string, buf: Buffer): Promise<DocText> {
  const WordExtractor = (await import("word-extractor")).default as any;
  const doc = await new WordExtractor().extract(buf);
  const body: string = doc.getBody();
  const tables: string[][][] = [];
  const parts: DocText["parts"] = [];
  let table: string[][] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\u0007/g, "\t").trim();
    if (!line) { if (table.length) { tables.push(table); table = []; } continue; }
    const cells = line.split("\t").map(c => tidy(c)).filter(Boolean);
    if (cells.length > 1) table.push(cells); else if (table.length) { tables.push(table); table = []; }
    parts.push({ n: parts.length + 1, text: cells.join(cells.length > 1 ? " | " : "") });
  }
  if (table.length) tables.push(table);
  return { name, kind: "docx", unit: "para", parts, tables, warnings: [] };
}

async function extractDocx(name: string, buf: Buffer): Promise<DocText> {
  await assertOfficeSize(buf);
  const mammoth = (await import("mammoth")).default;
  const { value: html } = await mammoth.convertToHtml({ buffer: buf }).catch(() => { throw new Error("документ Word повреждён или в неподдерживаемом формате"); });
  return fromHtml(name, html);
}

function fromHtml(name: string, html: string): DocText {
  const parts: DocText["parts"] = [];
  const tables: string[][][] = [];
  // Таблицы ТЗ — главный источник характеристик: строки таблицы тоже становятся абзацами,
  // чтобы на них можно было сослаться («абз. 42»).
  const blocks = html.split(/(<table[\s\S]*?<\/table>)/);
  for (const b of blocks) {
    if (b.startsWith("<table")) {
      const rows = [...b.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(r => [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => strip(c[1])));
      tables.push(rows);
      for (const r of rows) { const t = r.filter(Boolean).join(" | "); if (t) parts.push({ n: parts.length + 1, text: t }); }
    } else {
      for (const p of b.split(/<\/(?:p|h\d|li)>/)) { const t = strip(p); if (t) parts.push({ n: parts.length + 1, text: t }); }
    }
  }
  return { name, kind: "docx", unit: "para", parts, tables, warnings: [] };
}

function strip(html: string) {
  return tidy(html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)));
}
export function tidy(s: string) { return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim(); }
const letters = (s: string) => (s.match(/[A-Za-zА-Яа-яЁё]/g) ?? []).length;
