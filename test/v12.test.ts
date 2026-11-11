import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractBuffer, rtfToText } from "../src/docs/extract.js";
import { addWorkDays, covered, isWorkDay, minusWorkDays, rollToWorkDay, workDaysBetween } from "../src/law/calendar.js";

describe("Excel и RTF", () => {
  const book = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["№", "Наименование", "Кол-во", "Цена"], [1, "Бумага А4, 80 г/м2", 900, 412.5], [], [2, "Ручка шариковая", 600, 18]]), "Спецификация");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["НМЦК", 486300]]), "Обоснование");
    return wb;
  };
  it("xlsx: строки — абзацы, листы подписаны, таблицы сохранены", async () => {
    const d = await extractBuffer("спецификация.xlsx", XLSX.write(book(), { type: "buffer", bookType: "xlsx" }));
    const text = d.parts.map(p => p.text);
    expect(text).toContain("Лист «Спецификация»");
    expect(text).toContain("1 | Бумага А4, 80 г/м2 | 900 | 412.5");
    expect(text.some(t => t.includes("486300"))).toBe(true);
    expect(d.tables.length).toBe(2);
  });
  it("xls (BIFF8) читается так же", async () => {
    const d = await extractBuffer("смета.xls", XLSX.write(book(), { type: "buffer", bookType: "biff8" }));
    expect(d.parts.some(p => p.text.includes("Ручка шариковая"))).toBe(true);
  });
  it("повреждённая таблица — понятная ошибка", async () => {
    await expect(extractBuffer("x.xlsx", Buffer.from("not a zip"))).rejects.toThrow();
  });
  it("rtf: кириллица cp1251, \\u, таблицы, служебные группы пропущены", () => {
    const head = "{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Times New Roman;}}{\\*\\generator Word;}{\\info{\\author Иванов}}";
    // «Оплата» в cp1251: CE EF EB E0 F2 E0
    const body = "\\pard \\'ce\\'ef\\'eb\\'e0\\'f2\\'e0 7 \\u1088?\\u1072?\\u1073?. \\'e4\\'ed.\\par\\trowd A1\\cell B1\\cell\\row }";
    const t = rtfToText(Buffer.from(head + body, "latin1"));
    expect(t).toContain("Оплата 7 раб. дн.");
    expect(t).toContain("A1 | B1");
    expect(t).not.toMatch(/Times|Word|Иванов/);
  });
  it("не RTF — ошибка", () => { expect(() => rtfToText(Buffer.from("hello"))).toThrow(); });
  it("rtf через extractBuffer", async () => {
    const d = await extractBuffer("контракт.rtf", Buffer.from("{\\rtf1\\ansi\\ansicpg1251 \\'d1\\'f0\\'ee\\'ea 10 \\'e4\\'ed\\'e5\\'e9\\par}", "latin1"));
    expect(d.parts[0].text).toBe("Срок 10 дней");
  });
});

describe("Производственный календарь РФ", () => {
  it("праздники и переносы 2026–2027", () => {
    expect(isWorkDay("2026-01-09")).toBe(false); // перенос с 3 января
    expect(isWorkDay("2026-01-12")).toBe(true);
    expect(isWorkDay("2026-11-04")).toBe(false);
    expect(isWorkDay("2026-12-31")).toBe(false);
    expect(isWorkDay("2027-02-20")).toBe(true); // рабочая суббота
    expect(isWorkDay("2027-02-22")).toBe(false);
    expect(isWorkDay("2027-11-05")).toBe(false);
    expect(covered("2026-05-01")).toBe(true);
    expect(covered("2030-05-01")).toBe(false);
  });
  it("рабочие дни через праздники", () => {
    expect(addWorkDays("2026-12-30", 1)).toBe("2027-01-11"); // 31.12 и каникулы
    expect(minusWorkDays("2026-11-06", 3)).toBe("2026-11-02"); // 5, 3, 2 ноября; 4-е — праздник
    expect(addWorkDays("2026-04-30", 1)).toBe("2026-05-04");
    expect(rollToWorkDay("2026-06-13")).toBe("2026-06-15");
    expect(workDaysBetween("2026-12-25", "2027-01-12")).toBe(5); // 28, 29, 30 дек, 11, 12 янв
  });
});
