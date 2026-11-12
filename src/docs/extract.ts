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

/** Файл внутри архива: объявленный размер и чтение по требованию */
interface ArchiveEntry { name: string; size: number; read: () => Promise<Buffer> }

/** Общая обработка содержимого архива: лимиты, вложенность, склейка в один документ */
async function fromArchive(name: string, entriesAll: ArchiveEntry[], opts: ExtractOpts, depth: number): Promise<DocText> {
  const out: DocText = { name, kind: "docx", unit: "para", parts: [], tables: [], warnings: [] };
  if (entriesAll.length > ZIP_LIMITS.entries) out.warnings.push(`В архиве ${entriesAll.length} файлов, прочитаны первые ${ZIP_LIMITS.entries}`);
  const entries = entriesAll.slice(0, ZIP_LIMITS.entries);
  let total = 0;
  for (const f of entries) {
    // размер после распаковки объявлен в архиве: «бомбу» не распаковываем вовсе
    if (f.size > ZIP_LIMITS.entryBytes || total + f.size > ZIP_LIMITS.totalBytes) { out.warnings.push(`${f.name}: слишком большой после распаковки — пропущен`); continue; }
    let data: Buffer;
    try { data = await f.read(); } catch (e) { out.warnings.push(`${f.name}: не распакован (${(e as Error).message.slice(0, 120)})`); continue; }
    total += data.length;
    if (data.length > ZIP_LIMITS.entryBytes || total > ZIP_LIMITS.totalBytes) { out.warnings.push("Архив слишком большой после распаковки — остальные файлы пропущены"); break; }
    let inner: DocText;
    try { inner = await extractBuffer(f.name.split(/[\\/]/).pop()!, data, { ...opts, depth }); }
    catch (e) { out.warnings.push(`${f.name}: не прочитан (${(e as Error).message.slice(0, 120)})`); continue; }
    if (entries.length === 1) return { ...inner, name: `${name} → ${inner.name}`, warnings: [...out.warnings, ...inner.warnings] };
    out.warnings.push(...inner.warnings.map(w => `${inner.name}: ${w}`));
    for (const p of inner.parts) out.parts.push({ n: out.parts.length + 1, text: p.text, ocr: p.ocr });
    out.tables.push(...inner.tables);
  }
  return out;
}

const tooDeep = (name: string): DocText => ({ name, kind: "docx", unit: "para", parts: [], tables: [], warnings: ["Архив внутри архива внутри архива — не распаковываем, откройте вручную"] });

/** Архивы ZIP (в ЕИС документы часто упакованы): все поддерживаемые файлы внутри склеиваются в один документ */
async function extractZip(name: string, buf: Buffer, opts: ExtractOpts): Promise<DocText> {
  const depth = (opts.depth ?? 0) + 1;
  if (depth > ZIP_LIMITS.depth) return tooDeep(name);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf).catch(() => { throw new Error("архив повреждён или защищён паролем"); });
  const entries = Object.values(zip.files).filter(f => !f.dir)
    .map(f => ({ name: f.name, size: Number((f as any)._data?.uncompressedSize ?? 0), read: async () => Buffer.from(await f.async("uint8array")) }));
  return fromArchive(name, entries, opts, depth);
}

/** Строки «Ключ = значение» из `7z l -slt` → записи архива */
export function parseSevenZipList(lines: string[]): { path: string; size: number; dir: boolean; encrypted: boolean }[] {
  const out: { path: string; size: number; dir: boolean; encrypted: boolean }[] = [];
  let cur: Record<string, string> | null = null;
  const push = () => { if (cur?.Path !== undefined) out.push({ path: cur.Path, size: Number(cur.Size) || 0, dir: cur.Folder === "+" || /^D/.test(cur.Attributes ?? ""), encrypted: cur.Encrypted === "+" }); };
  for (const raw of lines.join("\n").split(/\r?\n/)) {
    const i = raw.indexOf("Path = ");
    if (i >= 0) { push(); cur = { Path: raw.slice(i + 7) }; continue; }
    const m = raw.match(/^([A-Za-z ]+?) = (.*)$/);
    if (m && cur) cur[m[1]] = m[2];
  }
  push();
  return out;
}

/** RAR и 7z — через 7-Zip, собранный в WebAssembly: всё в памяти, на диск ничего не пишется */
async function extract7z(name: string, buf: Buffer, ext: string, opts: ExtractOpts): Promise<DocText> {
  const depth = (opts.depth ?? 0) + 1;
  if (depth > ZIP_LIMITS.depth) return tooDeep(name);
  const mod: any = await import("7z-wasm");
  const SevenZip = typeof mod.default === "function" ? mod.default : mod.default?.default ?? mod;
  const lines: string[] = [];
  const z = await SevenZip({ print: (l: string) => lines.push(l), printErr: (l: string) => lines.push(l) });
  const arc = `/in/archive${ext}`;
  z.FS.mkdir("/in"); z.FS.mkdir("/out");
  z.FS.writeFile(arc, buf);
  // -p- — без пароля: защищённый архив не «зависнет» на запросе пароля
  if (z.callMain(["l", "-slt", "-ba", "-bd", "-p-", "-sccUTF-8", arc]) !== 0) throw new Error("архив повреждён или защищён паролем");
  const list = parseSevenZipList(lines).filter(e => !e.dir);
  if (list.some(e => e.encrypted)) throw new Error("архив защищён паролем — распакуйте его вручную");
  const entries: ArchiveEntry[] = list.map(e => ({
    name: e.path, size: e.size,
    read: async () => {
      lines.length = 0;
      if (z.callMain(["x", arc, "-o/out", "-y", "-bd", "-p-", "-sccUTF-8", "-scsUTF-8", "--", e.path]) !== 0) throw new Error(lines.filter(Boolean).slice(-1)[0] ?? "ошибка распаковки");
      const p = "/out/" + e.path.replace(/\\/g, "/");
      const data = Buffer.from(z.FS.readFile(p));
      try { z.FS.unlink(p); } catch { /* уже нет */ }
      return data;
    },
  }));
  return fromArchive(name, entries, opts, depth);
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
  if (ext === ".xlsx" || ext === ".xls" || ext === ".ods") return extractSheet(name, buf, ext);
  if (ext === ".rtf") return fromPlain(name, rtfToText(buf));
  if (ext === ".rar" || ext === ".7z") return extract7z(name.slice(0, -ext.length), buf, ext, opts);
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

/** Таблицы Excel (.xlsx, .xls, .ods): обоснование НМЦК, спецификации, сметы. Каждая строка — абзац «A | B | C», ссылка «Лист, стр. N» */
export const SHEET_LIMITS = { rows: 5000, cols: 60 };
async function extractSheet(name: string, buf: Buffer, ext: string): Promise<DocText> {
  if (ext !== ".xls") await assertOfficeSize(buf); // .xlsx и .ods — zip-архивы
  const XLSX = await import("xlsx");
  let wb: any;
  try { wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellFormula: false, cellHTML: false, sheetStubs: false }); }
  catch { throw new Error("таблица повреждена или защищена паролем"); }
  const out: DocText = { name, kind: "docx", unit: "para", parts: [], tables: [], warnings: [] };
  for (const sheetName of wb.SheetNames as string[]) {
    const ws = wb.Sheets[sheetName];
    if (!ws?.["!ref"]) continue;
    const rows: string[][] = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: "" }) as unknown[][])
      .map(r => r.slice(0, SHEET_LIMITS.cols).map(c => tidy(String(c ?? ""))));
    const kept = rows.filter(r => r.some(Boolean));
    if (!kept.length) continue;
    if (kept.length > SHEET_LIMITS.rows) out.warnings.push(`${sheetName}: прочитаны первые ${SHEET_LIMITS.rows} строк из ${kept.length}`);
    const table = kept.slice(0, SHEET_LIMITS.rows);
    out.tables.push(table);
    if (wb.SheetNames.length > 1) out.parts.push({ n: out.parts.length + 1, text: `Лист «${sheetName}»` });
    for (const r of table) out.parts.push({ n: out.parts.length + 1, text: r.filter(Boolean).join(" | ") });
  }
  if (!out.parts.length) out.warnings.push("В таблице нет данных");
  return out;
}

/** Пустые ячейки в конце строки таблицы: «A | B |  | » → «A | B» (без регулярного выражения — строка из файла) */
function trimCells(l: string) { let e = l.length; while (e > 0 && (l[e - 1] === "|" || l[e - 1] === " " || l[e - 1] === "\t")) e--; return l.slice(0, e); }

/** RTF → текст без сторонних библиотек: кодовая страница из \ansicpg (обычно 1251), \uN, таблицы через « | » */
export function rtfToText(buf: Buffer): string {
  const src = buf.toString("latin1");
  if (!src.startsWith("{\\rtf")) throw new Error("файл не похож на RTF");
  const cp = src.match(/\\ansicpg(\d+)/)?.[1] ?? "1251";
  let dec: TextDecoder;
  try { dec = new TextDecoder(`windows-${cp}`); } catch { dec = new TextDecoder("windows-1251"); }
  // служебные группы, текст которых не показывается
  const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "generator", "filetbl", "revtbl"]);
  const out: string[] = [];
  let bytes: number[] = [];
  const flush = () => { if (bytes.length) { out.push(dec.decode(Uint8Array.from(bytes))); bytes = []; } };
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false, uc = 1, pendingSkip = 0, i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") { stack.push({ skip, uc }); i++; continue; }
    if (ch === "}") { flush(); const st = stack.pop(); if (st) { skip = st.skip; uc = st.uc; } i++; continue; }
    if (ch === "\\") {
      const nx = src[i + 1];
      if (nx === "'") { // байт в кодовой странице
        const h = parseInt(src.substr(i + 2, 2), 16); i += 4;
        if (pendingSkip > 0) { pendingSkip--; continue; }
        if (!skip && !Number.isNaN(h)) bytes.push(h);
        continue;
      }
      if (nx === "\\" || nx === "{" || nx === "}") { if (!skip) bytes.push(nx.charCodeAt(0)); i += 2; continue; }
      if (nx === "*") { skip = true; i += 2; continue; }
      if (nx === "~") { if (!skip) bytes.push(0xa0); i += 2; continue; }
      if (nx === "-" || nx === "_") { if (!skip && nx === "_") bytes.push(0x2d); i += 2; continue; }
      const m = /^([a-z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      const word = m[1], arg = m[2] !== undefined ? +m[2] : null;
      if (SKIP.has(word)) { skip = true; continue; }
      if (skip) continue;
      if (word === "uc" && arg !== null) { uc = arg; continue; }
      if (word === "u" && arg !== null) { flush(); out.push(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); pendingSkip = uc; continue; }
      if (word === "par" || word === "line" || word === "row" || word === "sect" || word === "page") { flush(); out.push("\n"); continue; }
      if (word === "cell") { flush(); out.push(" | "); continue; }
      if (word === "tab") { bytes.push(9); continue; }
      continue;
    }
    if (ch === "\r" || ch === "\n") { i++; continue; }
    if (pendingSkip > 0) { pendingSkip--; i++; continue; }
    if (!skip) bytes.push(ch.charCodeAt(0) & 0xff);
    i++;
  }
  flush();
  return out.join("").split("\n").map(l => tidy(trimCells(l))).filter(Boolean).join("\n\n");
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
