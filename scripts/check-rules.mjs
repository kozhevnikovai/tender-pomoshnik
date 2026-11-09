// Проверка базы норм: источник, редакция, статус; подтверждённые — минимум два источника
import { readFileSync } from "node:fs";
const b = JSON.parse(readFileSync("rules/rules.json", "utf8"));
const bad = [];
const ids = new Set();
for (const r of b.rules) {
  if (ids.has(r.id)) bad.push(`${r.id}: повтор id`); ids.add(r.id);
  if (!r.sources?.length || r.sources.some(u => !/^https:\/\//.test(u))) bad.push(`${r.id}: нет источника`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.validFrom)) bad.push(`${r.id}: нет даты начала действия`);
  if (!["verified", "check"].includes(r.status)) bad.push(`${r.id}: статус`);
  if (r.status === "verified" && r.sources.length < 2) bad.push(`${r.id}: подтверждённой норме нужно 2 источника`);
}
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
console.log(`База норм ${b.version}: ${b.rules.length} карточек, подтверждено ${b.rules.filter(r => r.status === "verified").length}, проверить ${b.rules.filter(r => r.status === "check").length}`);
