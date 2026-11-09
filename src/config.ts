// Настройки и профиль компании. Всё хранится локально в папке пользователя.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LLMOptions } from "./llm.js";
import { homeDir } from "./models.js";
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

const file = () => join(homeDir(), "config.json");
const pfile = () => join(homeDir(), "profile.json");

export function loadConfig(): Config {
  try {
    const c = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
    return { ...DEFAULTS, ...c, llm: { ...DEFAULTS.llm, ...c.llm }, monitor: { ...DEFAULTS.monitor, ...c.monitor }, outputDir: c.outputDir || process.env.TENDER_OUT || defaultOutputDir() };
  } catch { return { ...DEFAULTS, outputDir: process.env.TENDER_OUT || defaultOutputDir() }; }
}

export function saveConfig(c: Partial<Config>): Config {
  const next = { ...loadConfig(), ...c };
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
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
