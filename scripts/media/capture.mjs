// Съёмка настоящей работы Тендерного помощника: открытые документы закупки из ЕИС (scripts/media/source) → разбор.
// Окно выбора файлов подменяется в главном процессе (на ПК человек выбирает файлы сам).
import { _electron as electron } from "playwright-core";
import { readdirSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
const OUT = "media", RAW = "media/raw"; mkdirSync(RAW, { recursive: true });
const SRC = resolve("scripts/media/source/0338200010526000176");
const files = readdirSync(SRC).filter(f => f.endsWith(".txt")).map(f => join(SRC, f));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const app = await electron.launch({ args: ["--no-sandbox", "app/main.mjs"], env: { ...process.env }, recordVideo: { dir: RAW, size: { width: 1280, height: 800 } } });
await app.evaluate(({ BrowserWindow, dialog }, files) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 800); w.center(); w.show(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
const win = await app.firstWindow(); await win.waitForTimeout(2500);
const snap = async name => { await win.waitForTimeout(500); try { await win.screenshot({ path: join(OUT, name + ".png") }); } catch { const b = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")); writeFileSync(join(OUT, name + ".png"), Buffer.from(b, "base64")); } log("снимок", name); };
const tab = async t => { await win.click(`[data-tab="${t}"]`); await win.waitForTimeout(900); };
// профиль компании — образец из приложения (поставщик медицинской мебели — вымышленная компания, поля помечены как пример)
await tab("profile"); await win.fill("#p-name", "ООО «Пример»").catch(() => {}); await win.fill("#p-okved", "32.50, 46.46").catch(() => {}); await win.fill("#p-regions", "Камчатский край").catch(() => {}); await snap("app-profile");
await win.click("#p-save").catch(() => {});
await tab("tender"); await snap("app-start");
await win.click("#pick"); await win.waitForTimeout(800); await snap("app-files");
await win.click("#go"); const t0 = Date.now();
await win.waitForTimeout(6000); await snap("app-progress");
await win.waitForSelector("#result:not(.hidden)", { timeout: 60 * 60e3 }); log("разбор, с", (Date.now() - t0) / 1000);
await win.waitForTimeout(3000); await snap("app-result");
const fr = win.frameLocator("#report");
for (const [i, y] of [[1, 700], [2, 1500], [3, 2400]]) { await win.evaluate(y => { const f = document.getElementById("report"); f.contentWindow.scrollTo({ top: y, behavior: "smooth" }); }, y); await win.waitForTimeout(1500); await snap("app-report-" + i); }
await tab("monitor"); await snap("app-monitor");
await tab("archive"); await snap("app-archive");
await tab("settings"); await snap("app-settings");
const v = win.video(); await app.close(); copyFileSync(await v.path(), join(RAW, "app.webm"));
writeFileSync(join(RAW, "timing.json"), JSON.stringify({ analyzeSec: (Date.now() - t0) / 1000 }));
