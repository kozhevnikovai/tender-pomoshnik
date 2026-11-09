// Сетевой учёт: Тендерный помощник считает каждый байт, который отправляет наружу.
// Обычная работа (разбор закупки, проверка, черновики) — 0 байт. Сеть нужна только
// для загрузки моделей, чтения открытых данных ЕИС и интеграций, которые пользователь включил сам.

export interface NetStats {
  /** Отправлено данных компании и закупок наружу (интеграции, облачная модель), байт */
  sentBytes: number;
  requests: { kind: NetKind; host: string; bytes: number; at: string }[];
}
export type NetKind = "model-download" | "eis" | "integration" | "cloud-llm";

const stats: NetStats = { sentBytes: 0, requests: [] };
let offline = process.env.TENDER_OFFLINE === "1";

/** Строгий офлайн: любые запросы, кроме загрузки моделей, запрещены */
export function setOffline(v: boolean) { offline = v; }
export function isOffline() { return offline; }
export function netStats(): NetStats { return { sentBytes: stats.sentBytes, requests: [...stats.requests] }; }

export class OfflineError extends Error {
  constructor(what: string) { super(`Строгий офлайн-режим: ${what} отключено. Выключите офлайн-режим в настройках, чтобы отправить данные.`); }
}

/** Единственная точка выхода в сеть для всего кода */
export async function netFetch(kind: NetKind, url: string, init: RequestInit = {}): Promise<Response> {
  if (offline && kind !== "model-download") throw new OfflineError(kind === "integration" ? "отправка в интеграции" : kind === "eis" ? "загрузка из ЕИС" : "облачная модель");
  const body = init.body;
  const bytes = sizeOf(body);
  const host = new URL(url).host;
  if (kind !== "model-download") stats.sentBytes += bytes;
  stats.requests.push({ kind, host, bytes, at: new Date().toISOString() });
  return fetch(url, init);
}

function sizeOf(b: unknown): number {
  if (b == null) return 0;
  if (typeof b === "string") return Buffer.byteLength(b);
  if (b instanceof Uint8Array) return b.byteLength;
  if (b instanceof Blob) return b.size;
  if (b instanceof FormData) { let n = 0; for (const [, v] of b) n += sizeOf(v); return n; }
  return 0;
}
