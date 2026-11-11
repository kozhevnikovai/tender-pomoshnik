// Настройки и профиль компании. Всё хранится локально в папке пользователя.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LLMOptions } from "./llm.js";
import { homeDir, selectLlm } from "./models.js";
import type { CompanyProfile } from "./types.js";

export interface MonitorQuery { text: string; minus?: string[]; law44?: boolean; law223?: boolean; priceFrom?: number; priceTo?: number; regions?: string[]; okpd2?: string[] }

export interface Config {
  /** Строгий офлайн: ЕИС, интеграции и облачная модель заблокированы */
  offline: boolean;
  /** Маскировать персональные данные в том, что уходит в облако и интеграции */
  maskOnSend: boolean;
  ocr: boolean;
  llm: LLMOptions;
  outputDir: string;
  monitor: { queries: MonitorQuery[]; aiFilter: boolean };
  telegram?: { botToken: string; chatId: string };
  email?: { host: string; port: number; secure?: boolean; user: string; pass: string; to: string };
  bitrix24?: { webhook: string };
}

export function defaultOutputDir(): string {
  const docs = process.env.USERPROFILE ? join(process.env.USERPROFILE, "Documents") : process.env.HOME ? join(process.env.HOME, "Documents") : homeDir();
  return join(docs, "Тендерный помощник");
}

export const DEFAULTS: Config = { offline: false, maskOnSend: true, ocr: true, llm: { provider: "local" }, outputDir: "", monitor: { queries: [], aiFilter: false } };

export const configFile = () => join(homeDir(), "config.json");
const file = configFile;

// Ключи и пароли. В приложении шифруются средствами ОС (Windows DPAPI / связка ключей macOS): в файле — «enc:…».
// CLI и MCP-сервер берут их из переменных окружения или из незашифрованных значений, заданных через CLI.
export const SECRET_KEYS = ["telegram.botToken", "email.pass", "bitrix24.webhook", "llm.apiKey"] as const;
const ENV: Record<string, string> = { "telegram.botToken": "TENDER_TELEGRAM_TOKEN", "email.pass": "TENDER_SMTP_PASS", "bitrix24.webhook": "TENDER_BITRIX24_WEBHOOK", "llm.apiKey": "TENDER_LLM_KEY" };
let secrets: Record<string, string> = {};
/** Расшифрованные ключи от главного процесса приложения — только в памяти */
export function setSecrets(s: Record<string, string> | undefined) { secrets = s ?? {}; }
export const getPath = (o: any, k: string) => k.split(".").reduce((a, x) => a?.[x], o);
export function setPath(o: any, k: string, v: unknown) {
  const ks = k.split(".");
  let cur = o;
  for (const x of ks.slice(0, -1)) cur = cur[x] ??= {};
  cur[ks.at(-1)!] = v;
}
function resolveSecrets(c: Config): Config {
  for (const k of SECRET_KEYS) {
    const v = getPath(c, k), env = process.env[ENV[k]];
    if (env && getPath(c, k.split(".")[0])) setPath(c, k, env);
    else if (typeof v === "string" && v.startsWith("enc:")) setPath(c, k, secrets[k] ?? "");
  }
  return c;
}
/** Настройки как на диске (ключи — в зашифрованном виде) */
export function rawConfig(): any {
  try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; }
}
const pfile = () => join(homeDir(), "profile.json");

export function loadConfig(): Config {
  try {
    const c = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
    selectLlm(c.llm?.localModel ?? process.env.TENDER_LLM_MODEL); // от выбранной модели зависят «каких файлов не хватает» и загрузка
    return resolveSecrets({ ...DEFAULTS, ...c, llm: { ...DEFAULTS.llm, ...c.llm }, monitor: { ...DEFAULTS.monitor, ...c.monitor }, telegram: c.telegram && { ...c.telegram }, email: c.email && { ...c.email }, bitrix24: c.bitrix24 && { ...c.bitrix24 }, outputDir: c.outputDir || process.env.TENDER_OUT || defaultOutputDir() });
  } catch { return { ...DEFAULTS, outputDir: process.env.TENDER_OUT || defaultOutputDir() }; }
}

/**
 * Сохраняет изменения. Ключи, не переданные в patch (или пустые), остаются как были — их не нужно повторно вводить.
 * Чтобы удалить подключение, передайте группу со значением null: { telegram: null }.
 */
export function saveConfig(c: Partial<Config> | Record<string, any>): Config {
  const raw = rawConfig();
  const next: any = { ...raw, ...c };
  for (const g of ["llm", "monitor", "telegram", "email", "bitrix24"]) {
    if ((c as any)[g] === null) { delete next[g]; continue; }
    if ((c as any)[g] && raw[g]) next[g] = { ...raw[g], ...(c as any)[g] };
  }
  for (const k of SECRET_KEYS) {
    const v = getPath(c, k);
    if ((v === undefined || v === "") && getPath(raw, k) !== undefined && getPath(next, k.split(".")[0])) setPath(next, k, getPath(raw, k));
  }
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return loadConfig();
}

export const EMPTY_PROFILE: CompanyProfile = { name: "", okved: [], msp: true, licenses: [], sro: [], contracts: [], products: [], regions: [] };

export function loadProfile(path?: string): CompanyProfile | null {
  const p = path ?? pfile();
  if (!existsSync(p)) return null;
  return { ...EMPTY_PROFILE, ...JSON.parse(readFileSync(p, "utf8")) };
}

export function saveProfile(p: CompanyProfile) {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(pfile(), JSON.stringify(p, null, 2));
}
