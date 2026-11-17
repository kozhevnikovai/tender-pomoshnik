// Регрессии по независимому аудиту: TXT с характеристиками на соседних строках и заказчик в отдельной строке.
import { describe, expect, it } from "vitest";
import { fromPlain } from "../src/docs/extract.js";
import { find } from "../src/analyze/fields.js";
import { extractRequirements } from "../src/analyze/requirements.js";

const notice = fromPlain("извещение.txt", [
  "Извещение о проведении электронного аукциона для закупки № 0338200010526000176",
  "",
  "Заказчик: ГБУЗ «Городская клиническая больница № 1»",
  "ИНН 2128000000",
  "Почтовый адрес: 428000, г. Чебоксары",
].join("\n"));
const spec = fromPlain("тз.txt", [
  "Стол медицинский",
  "Длина: от 1800 до 2000 мм",
  "Ширина: 600 мм",
  "Высота — не более 900 мм",
  "Масса — 12,5 кг",
  "НДС: 20 %",
].join("\n"));

describe("TXT: границы строк", () => {
  it("заказчик в отдельной строке извлекается без соседних полей", () => {
    expect(find([notice], "customer")?.value).toBe("ГБУЗ «Городская клиническая больница № 1»");
  });
  it("характеристики на соседних строках не слипаются, точные значения с единицей не теряются", () => {
    const r = extractRequirements([spec]);
    const by = (n: string) => r.find(x => x.name === n);
    expect(by("Длина")).toMatchObject({ op: "range", min: 1800, max: 2000, unit: "мм" });
    expect(by("Ширина")).toMatchObject({ op: "=", min: 600, unit: "мм" });
    expect(by("Высота")).toMatchObject({ op: "<=", max: 900, unit: "мм" });
    expect(by("Масса")).toMatchObject({ op: "=", min: 12.5, unit: "кг" });
    expect(by("НДС")).toBeUndefined();
  });
});

describe("границы требований", () => {
  it("«не более» — верхняя граница, «более» — нижняя", async () => {
    const { parseRequired } = await import("../src/analyze/requirements.js");
    expect(parseRequired("не более 900 мм")).toMatchObject({ op: "<=", max: 900 });
    expect(parseRequired("более 5")).toMatchObject({ op: ">=", min: 5 });
    expect(parseRequired("не выше 40")).toMatchObject({ op: "<=", max: 40 });
    expect(parseRequired("не менее 8 ГБ")).toMatchObject({ op: ">=", min: 8 });
    expect(parseRequired("не менее 2 и не более 4")).toMatchObject({ op: "range", min: 2, max: 4 });
  });
});
