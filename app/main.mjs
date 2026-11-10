// Тендерный помощник — настольное приложение (Electron). Главный процесс: окно и фоновый обработчик.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess } from "electron";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Одна копия приложения: вторая просто показывает окно первой
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
// Windows: своя иконка и группа в панели задач
if (process.platform === "win32") app.setAppUserModelId("ai.kozhevnikov.tender");

// ── Ключи и пароли: шифруются средствами ОС, расшифровываются только в памяти
const SECRET_KEYS = ["telegram.botToken", "email.pass", "bitrix24.webhook", "llm.apiKey"];
const getPath = (o, k) => k.split(".").reduce((a, x) => a?.[x], o);
const home = () => process.env.TENDER_HOME || (process.platform === "win32" && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "TenderPomoshnik") : join(homedir(), ".tender-pomoshnik"));
const cfgFile = () => join(home(), "config.json");
const raw = () => { try { return JSON.parse(readFileSync(cfgFile(), "utf8")); } catch { return {}; } };
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const enc = v => (v && canEncrypt() ? "enc:" + safeStorage.encryptString(v).toString("base64") : v);
function secrets() {
  const c = raw(), out = {};
  for (const k of SECRET_KEYS) { const v = getPath(c, k); if (typeof v === "string" && v.startsWith("enc:")) { try { out[k] = safeStorage.decryptString(Buffer.from(v.slice(4), "base64")); } catch { out[k] = ""; } } }
  return out;
}
function migrateSecrets() {
  if (!existsSync(cfgFile()) || !canEncrypt()) return;
  const c = raw();
  let changed = false;
  for (const k of SECRET_KEYS) { const [g, f] = k.split("."); const v = c[g]?.[f]; if (typeof v === "string" && v && !v.startsWith("enc:")) { c[g][f] = enc(v); changed = true; } }
  if (changed) writeFileSync(cfgFile(), JSON.stringify(c, null, 2));
}
/** В окно ключи не отдаём — только «задан / не задан» */
function mask(c) {
  if (!c) return c;
  const set = {};
  for (const k of SECRET_KEYS) { const [g, f] = k.split("."); set[k] = !!c[g]?.[f]; if (c[g]?.[f]) c[g][f] = ""; }
  return { ...c, secretsSet: set };
}
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
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args, secrets: secrets() }); });
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
  // только https: file:, javascript: и прочие схемы из документа не открываются
  const external = url => { if (/^https:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  win.webContents.on("will-frame-navigate", e => { if (!e.url.startsWith("file:")) { e.preventDefault(); external(e.url); } });
  win.webContents.on("will-navigate", e => { if (!e.url.startsWith("file:")) e.preventDefault(); });
}

ipcMain.handle("core", async (_e, method, args) => {
  if (method === "saveConfig") {
    const patch = structuredClone(args?.patch ?? {});
    for (const k of SECRET_KEYS) { const [g, f] = k.split("."); const v = patch?.[g]?.[f]; if (typeof v === "string" && v) patch[g][f] = enc(v); }
    return mask(await call("saveConfig", { patch }));
  }
  const r = await call(method, args);
  if (method === "status") r.config = mask(r.config);
  return r;
});
ipcMain.handle("version", () => app.getVersion());
ipcMain.handle("pick-files", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], filters: [{ name: "Документы закупки", extensions: ["pdf", "docx", "doc", "odt", "zip", "txt", "png", "jpg", "jpeg", "tif", "tiff"] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("pick-dir", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
/** Открываем только папки и документы: исполняемый файл из папки отчётов или архива закупки не запустится */
const OPENABLE = new Set([".html", ".docx", ".doc", ".odt", ".pdf", ".md", ".json", ".txt", ".ics", ".csv", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"]);
ipcMain.handle("open", (_e, p) => {
  try {
    if (typeof p !== "string" || !existsSync(p)) return "Файл не найден";
    if (statSync(p).isDirectory() || OPENABLE.has(extname(p).toLowerCase())) return shell.openPath(p);
    return "Этот тип файла приложение не открывает";
  } catch (e) { return e.message; }
});
ipcMain.handle("open-url", (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });

app.whenReady().then(() => { if (!gotLock) return; migrateSecrets(); createWindow(); if (process.env.TENDER_SMOKE) smoke(process.env.TENDER_SMOKE); });

// Самопроверка собранного приложения (CI): окно, фоновый обработчик, разбор файлов, отчёт, скриншот
async function smoke(files) {
  const fail = e => { console.error("SMOKE FAIL", e?.message ?? e); app.exit(1); };
  setTimeout(() => fail("таймаут"), 300_000);
  try {
    await new Promise(r => win.webContents.once("did-finish-load", r));
    const st = await call("status", {});
    const r = await call("analyze", { files: files.split(";").map(f => resolve(f)), ocr: false });
    await win.webContents.executeJavaScript(`window.showReport && window.showReport(${JSON.stringify(r)})`);
    await new Promise(r => setTimeout(r, 1500));
    // скриншот — по возможности (на серверах без видеокарты захват окна бывает недоступен)
    try { const png = await win.webContents.capturePage(); writeFileSync(join(process.env.TENDER_SMOKE_OUT ?? tmpdir(), "smoke.png"), png.toPNG()); } catch (e) { console.log("скриншот недоступен:", e.message); }
    console.log("SMOKE OK", JSON.stringify({ version: st.version, rules: st.rules, risks: r.report.risks.length, fields: r.report.fields.filter(f => f.value != null).length }));
    app.exit(0);
  } catch (e) { fail(e); }
}
app.on("window-all-closed", () => { worker?.kill(); app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
