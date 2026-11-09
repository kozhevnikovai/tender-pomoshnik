// Тендерный помощник — настольное приложение (Electron). Главный процесс: окно и фоновый обработчик.
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let win, worker;
const pending = new Map();
let seq = 0;

function startWorker() {
  worker = utilityProcess.fork(join(here, "worker.mjs"), [], { serviceName: "Тендерный помощник: разбор", stdio: "inherit" });
  worker.on("message", m => {
    if (m.type === "progress" || m.type === "net") return win?.webContents.send(m.type, m);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  });
  worker.on("exit", () => { for (const p of pending.values()) p.reject(new Error("Обработчик завершился — попробуйте ещё раз")); pending.clear(); worker = null; });
}
function call(method, args) {
  if (!worker) startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 960, minHeight: 640, title: "Тендерный помощник", backgroundColor: "#FFFFFF",
    icon: join(here, "ui", "icon.png"),
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(join(here, "ui", "index.html"));
  // ссылки из отчёта (нормы, ЕИС) — во внешнем браузере
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-frame-navigate", e => { if (/^https?:/.test(e.url)) { e.preventDefault(); shell.openExternal(e.url); } });
}

ipcMain.handle("core", (_e, method, args) => call(method, args));
ipcMain.handle("pick-files", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], filters: [{ name: "Документы закупки", extensions: ["pdf", "docx", "doc", "odt", "zip", "txt", "png", "jpg", "jpeg", "tif", "tiff"] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("pick-dir", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("open", (_e, p) => shell.openPath(p));
ipcMain.handle("open-url", (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });

app.whenReady().then(() => { createWindow(); if (process.env.TENDER_SMOKE) smoke(process.env.TENDER_SMOKE); });

// Самопроверка собранного приложения (CI): окно, фоновый обработчик, разбор файлов, отчёт, скриншот
async function smoke(files) {
  const fail = e => { console.error("SMOKE FAIL", e?.message ?? e); app.exit(1); };
  setTimeout(() => fail("таймаут"), 300_000);
  try {
    await new Promise(r => win.webContents.once("did-finish-load", r));
    const st = await call("status", {});
    const r = await call("analyze", { files: files.split(";"), ocr: false });
    await win.webContents.executeJavaScript(`window.showReport && window.showReport(${JSON.stringify(r)})`);
    await new Promise(r => setTimeout(r, 1500));
    const png = await win.webContents.capturePage();
    writeFileSync(join(process.env.TENDER_SMOKE_OUT ?? tmpdir(), "smoke.png"), png.toPNG());
    console.log("SMOKE OK", JSON.stringify({ version: st.version, rules: st.rules, risks: r.report.risks.length, fields: r.report.fields.filter(f => f.value != null).length }));
    app.exit(0);
  } catch (e) { fail(e); }
}
app.on("window-all-closed", () => { worker?.kill(); app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
