// Скачивает документы закупок для evals из открытой части ЕИС (документы в репозиторий не кладём:
// в них контакты заказчиков). Нужен доступ к zakupki.gov.ru (из РФ). 1 запрос в 1,5 с.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { downloadDocs, fetchCard } from "../dist/eis.js";
const DATA = process.env.EVAL_DATA ?? "evals/data";
const sets = ["evals/cases", "evals/holdout"];
const picked = [];
for (const s of sets) for (const f of readdirSync(s)) {
  const c = JSON.parse(readFileSync(`${s}/${f}`, "utf8"));
  if (c.skip) continue;
  const dir = `${DATA}/${c.reg}`;
  if (!existsSync(`${dir}/card.html`)) {
    mkdirSync(dir, { recursive: true });
    const card = await fetchCard(c.reg);
    const res = await fetch(card.url, { headers: { "user-agent": "TenderPomoshnik-evals" } });
    writeFileSync(`${dir}/card.html`, await res.text());
    await downloadDocs(card, dir);
    console.log("ok", c.reg);
  }
  picked.push({ reg: c.reg, title: c.title, url: c.url, files: readdirSync(dir) });
}
writeFileSync(`${DATA}/picked.json`, JSON.stringify(picked, null, 1));
