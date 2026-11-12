import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractBuffer, parseSevenZipList, ZIP_LIMITS } from "../src/docs/extract.js";

async function make7z(files: Record<string, string | Uint8Array>, extra: string[] = []): Promise<Buffer> {
  const mod: any = await import("7z-wasm");
  const SevenZip = typeof mod.default === "function" ? mod.default : mod.default.default;
  const z = await SevenZip({ print: () => {}, printErr: () => {} });
  z.FS.mkdir("/src"); z.FS.chdir("/src");
  for (const [n, d] of Object.entries(files)) z.FS.writeFile(n, d);
  z.callMain(["a", "-t7z", "/a.7z", "-sccUTF-8", ...extra, ...Object.keys(files)]);
  return Buffer.from(z.FS.readFile("/a.7z"));
}

describe("архивы RAR и 7z", () => {
  it("7z: читаются все файлы, имена по-русски", async () => {
    const buf = await make7z({ "ТЗ.txt": "Поставка бумаги А4, 500 пачек.\n\nСрок поставки — 10 рабочих дней.", "проект-контракта.txt": "Оплата в течение 7 рабочих дней." });
    const d = await extractBuffer("документы.7z", buf);
    const text = d.parts.map(p => p.text).join(" ");
    expect(text).toContain("500 пачек");
    expect(text).toContain("7 рабочих дней");
    expect(d.warnings).toEqual([]);
  });
  it("RAR: распаковывается", async () => {
    const d = await extractBuffer("закупка.rar", readFileSync(new URL("./fixtures/sample.rar", import.meta.url)));
    expect(d.parts.map(p => p.text).join(" ")).toContain("test text document");
  });
  it("архив с паролем — понятная ошибка", async () => {
    const buf = await make7z({ "a.txt": "секрет" }, ["-pПароль1"]);
    await expect(extractBuffer("x.7z", buf)).rejects.toThrow(/парол/);
  });
  it("«бомба»: огромный файл внутри не распаковывается", async () => {
    const buf = await make7z({ "big.txt": new Uint8Array(ZIP_LIMITS.entryBytes + 1024) });
    expect(buf.length).toBeLessThan(1024 * 1024);
    const d = await extractBuffer("bomb.7z", buf);
    expect(d.parts).toHaveLength(0);
    expect(d.warnings.join(" ")).toContain("слишком большой");
  }, 60000);
  it("вложенность ограничена", async () => {
    let buf = await make7z({ "a.txt": "глубоко" });
    for (let i = 0; i < ZIP_LIMITS.depth; i++) buf = await make7z({ [`l${i}.7z`]: buf });
    const d = await extractBuffer("x.7z", buf);
    expect(d.parts.map(p => p.text).join(" ")).not.toContain("глубоко");
    expect(d.warnings.join(" ")).toContain("Архив внутри архива");
  });
  it("повреждённый архив — ошибка, а не зависание", async () => {
    await expect(extractBuffer("x.7z", Buffer.from("7z¼¯'\u001c не архив"))).rejects.toThrow();
  });
  it("разбор списка 7-Zip", () => {
    const l = parseSevenZipList(["0M Scan /in/   Path = a/б.docx", "Size = 10", "Encrypted = -", "", "Path = a", "Size = 0", "Folder = +", "Encrypted = -"]);
    expect(l).toEqual([{ path: "a/б.docx", size: 10, dir: false, encrypted: false }, { path: "a", size: 0, dir: true, encrypted: false }]);
  });
});

import { mkdtempSync, writeFileSync as wf, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archivePrevious, compareRuns, docKey } from "../src/changes.js";
import { parseCsv, writeRegistryXlsx, appendRegistry } from "../src/integrations/index.js";
import type { DocText, Report } from "../src/types.js";

const doc = (name: string, paras: string[]): DocText => ({ name, kind: "docx", unit: "para", parts: paras.map((text, i) => ({ n: i + 1, text })), tables: [], warnings: [] });
const rep = (fields: [string, string, string | number | null][], createdAt = "2026-11-10T10:00:00Z"): Report => ({ version: "1", createdAt, rulesVersion: "x", rulesCount: 1, law: "44-ФЗ", procedure: null, noticeNumber: "0373100000126000001", title: "Бумага", docs: [], fields: fields.map(([key, label, value]) => ({ key, label, value, status: "ok" as any })), calcs: [], fit: [], fitSummary: null, risks: [], deadlines: [], requirements: [], checklist: [], warnings: [], disclaimer: "" });

describe("что изменилось с прошлого разбора", () => {
  it("имя документа без пометок версии", () => {
    expect(docKey("ТЗ (изм. 1).docx")).toBe(docKey("ТЗ.docx"));
    expect(docKey("Проект контракта от 05.11.2026.pdf")).toBe(docKey("Проект контракта.pdf"));
  });
  it("сведения и пункты документов: добавлены, убраны, новые и убранные файлы", () => {
    const prev = { report: rep([["nmck", "НМЦК", 100000], ["deadline", "Подача до", "2026-11-20"]]), docs: [doc("ТЗ.docx", ["Бумага А4, 500 пачек.", "Срок поставки 10 дней."]), doc("Старое.pdf", ["x y z w"])] };
    const cur = { report: rep([["nmck", "НМЦК", 95000], ["deadline", "Подача до", "2026-11-20"]], "2026-11-12T10:00:00Z"), docs: [doc("ТЗ (изм. 1).docx", ["Бумага А4, 500 пачек.", "Срок поставки 5 рабочих дней."]), doc("Разъяснение.pdf", ["Поставка допускается частями."])] };
    const c = compareRuns(prev, cur);
    expect(c.fields).toEqual([{ label: "НМЦК", was: "100000", now: "95000" }]);
    const tz = c.docs.find(d => d.doc.startsWith("ТЗ"))!;
    expect(tz).toMatchObject({ status: "изменён", added: ["Срок поставки 5 рабочих дней."], removed: ["Срок поставки 10 дней."] });
    expect(c.docs.find(d => d.doc === "Разъяснение.pdf")!.status).toBe("новый");
    expect(c.docs.find(d => d.doc === "Старое.pdf")!.status).toBe("убран");
  });
  it("без изменений — пусто; прошлый разбор уходит в историю", () => {
    const dir = mkdtempSync(join(tmpdir(), "tp13-"));
    const r = rep([["nmck", "НМЦК", 1]]);
    wf(join(dir, "отчёт.json"), JSON.stringify(r));
    wf(join(dir, "тексты.json"), JSON.stringify([doc("a.txt", ["один два три"])]));
    const prev = archivePrevious(dir)!;
    expect(existsSync(join(dir, "история", "2026-11-10-10-00-00", "отчёт.json"))).toBe(true);
    const c = compareRuns(prev, { report: r, docs: [doc("a.txt", ["Один,  два три"])] });
    expect(c.fields).toEqual([]);
    expect(c.docs).toEqual([]);
    expect(archivePrevious(mkdtempSync(join(tmpdir(), "tp13-")))).toBeNull();
  });
});

describe("реестр в Excel", () => {
  it("CSV → XLSX: числа числами, «формулы» — текстом", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp13x-"));
    const csvPath = join(dir, "реестр-закупок.csv");
    const r = rep([["nmck", "НМЦК", 125000], ["customer", "Заказчик", "=HYPERLINK(\"http://evil\")"]]);
    appendRegistry(csvPath, r, "C:\\отчёт.html");
    appendRegistry(csvPath, { ...r, title: "Бумага; \"офисная\"" }, "C:\\отчёт2.html");
    expect(parseCsv('"a";"b""c"\n"1;2";"x"\n')).toEqual([["a", 'b"c'], ["1;2", "x"]]);
    const out = await writeRegistryXlsx(csvPath);
    const XLSX: any = await import("xlsx");
    const ws = XLSX.read(readFileSync(out)).Sheets["Реестр закупок"];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    expect(rows).toHaveLength(3);
    expect(rows[1][6]).toBe(125000);
    expect(rows[2][4]).toBe('Бумага; "офисная"');
    expect(rows[1][5]).toBe('=HYPERLINK("http://evil")');
    expect(Object.values(ws).some((c: any) => c && c.f)).toBe(false);
  });
});

import { cellText, money, parseResults, reduction, winnerOf } from "../src/results.js";
import { withResults, summarize } from "../src/analytics.js";

describe("итоги закупки из ЕИС", () => {
  const html = readFileSync(new URL("./fixtures/supplier-results.html", import.meta.url), "utf8");
  it("победитель, цена контракта и снижение — по реальной странице ЕИС", () => {
    const r = parseResults(html);
    expect(r.offers).toEqual([{ participant: "26", place: "1 - Победитель", price: 1446321.57 }]);
    expect(r.contracts).toEqual([{ reestr: "2410103915326000676", supplier: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ЛИДЕР"', price: 1663269.81, placed: "13.11.2026 11:27" }]);
    expect(reduction(2742362.36, winnerOf(r)!.price)).toBe(39.3);
  });
  it("числа, текст ячеек и защита от мусора", () => {
    expect(money("1&nbsp;663&nbsp;269,81".replace(/&nbsp;/g, " "))).toBe(1663269.81);
    expect(money("договорная")).toBeNull();
    expect(cellText("<b>ООО &laquo;Ромашка&raquo;</b>")).toBe("ООО «Ромашка»");
    expect(reduction(100, 1000)).toBeNull(); // цена выше НМЦК в разы — ошибка данных, не снижение
    expect(parseResults("<table><tr><td>" + "<".repeat(100000))).toEqual({ offers: [], contracts: [] });
    const t0 = Date.now(); parseResults("<table><th>Поставщик</th><th>Цена контракта</th>" + "<tr><td>1</td>".repeat(20000) + "</table>"); expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("аналитика заказчика: кто выигрывает и среднее снижение", () => {
    const item = (n: string, price: string) => ({ regNumber: n, title: `Поставка ${n}`, url: "u", description: `Начальная цена контракта: ${price} Этап размещения: Определение поставщика завершено Размещено: 01.11.2026` });
    const st = summarize("ГБУЗ Больница", [item("1".repeat(19), "100000.00"), item("2".repeat(19), "200000.00"), item("3".repeat(19), "100000.00")]);
    const res = (n: string, sup: string, price: number, red: number) => ({ regNumber: n, url: "", offers: [], contracts: [{ reestr: "9".repeat(19), supplier: sup, price, placed: null }], nmck: null, reduction: red });
    const s = withResults(st, [res("1".repeat(19), "ООО Лидер", 80000, 20), res("2".repeat(19), "ООО Лидер", 190000, 5), res("3".repeat(19), "ИП Петров", 90000, 10)]);
    expect(s.winners).toEqual([{ name: "ООО Лидер", wins: 2 }, { name: "ИП Петров", wins: 1 }]);
    expect(s.avgReduction).toBe(11.7);
    expect(s.notes.some(n => /больше половины/.test(n))).toBe(true);
  });
});
