// Интеграции: Telegram, почта, Битрикс24 (сделка), реестр закупок CSV (Excel / Google Таблицы).
// Включаются пользователем; персональные данные маскируются; в строгом офлайне отключены.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import { netFetch } from "../net.js";
import { maskText } from "../privacy.js";
import type { Report } from "../types.js";

export function summaryText(r: Report, link?: string): string {
  const f = (k: string) => r.fields.find(x => x.key === k)?.value;
  const nm = f("nmck") as number | null;
  return [
    `Закупка № ${r.noticeNumber ?? "—"} (${r.law ?? ""})`,
    r.title ?? "",
    nm ? `НМЦК: ${nm.toLocaleString("ru-RU")} ₽` : "",
    f("deadline") ? `Подача до: ${String(f("deadline")).replace("T", " ").slice(0, 16)}` : "",
    r.fitSummary ? `Вердикт: ${r.fitSummary}` : "",
    r.risks.length ? `Риски: ${r.risks.slice(0, 4).map(x => x.title).join("; ")}` : "Рисков по правилам не найдено",
    link ?? (r.noticeNumber ? `https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=${r.noticeNumber}` : ""),
  ].filter(Boolean).join("\n");
}

export async function sendTelegram(c: Config, text: string) {
  if (!c.telegram?.botToken || !c.telegram.chatId) throw new Error("Telegram не настроен: нужен токен бота и chat id");
  const body = JSON.stringify({ chat_id: c.telegram.chatId, text: c.maskOnSend ? maskText(text) : text, disable_web_page_preview: true });
  const res = await netFetch("integration", `https://api.telegram.org/bot${c.telegram.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(e => { throw new Error(`Telegram: ${friendly(e)}`); });
  if (!res.ok) {
    const d: any = await res.json().catch(() => ({}));
    throw new Error(`Telegram: ${res.status === 401 ? "токен бота не подходит — проверьте его у @BotFather" : /chat not found/i.test(d.description ?? "") ? "бот не видит чат: напишите боту /start или добавьте его в группу" : d.description ?? res.status}`);
  }
}

export async function sendEmail(c: Config, subject: string, text: string) {
  if (!c.email) throw new Error("Почта не настроена (SMTP)");
  const { isOffline } = await import("../net.js");
  if (isOffline()) throw new Error("Строгий офлайн-режим: отправка почты отключена");
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({ host: c.email.host, port: c.email.port, secure: c.email.secure ?? c.email.port === 465, auth: { user: c.email.user, pass: c.email.pass }, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000 });
  await t.sendMail({ from: c.email.user, to: c.email.to, subject, text: c.maskOnSend ? maskText(text) : text }).catch(e => { throw new Error(`Почта: ${friendly(e)}`); });
}

/** Битрикс24: сделка по входящему вебхуку (crm.deal.add) */
export async function bitrixDeal(c: Config, r: Report): Promise<number> {
  if (!c.bitrix24?.webhook) throw new Error("Битрикс24 не настроен: нужен входящий вебхук с правом crm");
  const bad = validateBitrixWebhook(c.bitrix24.webhook);
  if (bad) throw new Error(`Битрикс24: ${bad}`);
  const nm = r.fields.find(x => x.key === "nmck")?.value as number | null;
  const body = JSON.stringify({ fields: { TITLE: `Тендер ${r.noticeNumber ?? ""}: ${(r.title ?? "").slice(0, 150)}`, OPPORTUNITY: nm ?? 0, CURRENCY_ID: "RUB", COMMENTS: html(summaryText(r)).replace(/\n/g, "<br>") } });
  const res = await netFetch("integration", c.bitrix24.webhook.replace(/\/$/, "") + "/crm.deal.add.json", { method: "POST", headers: { "content-type": "application/json" }, body }).catch(e => { throw new Error(`Битрикс24: ${friendly(e)}`); });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.result) throw new Error(`Битрикс24: ${data.error_description ?? res.status}`);
  return data.result;
}

/** Ячейка CSV. Текст из закупки, начинающийся с = + - @, Excel выполнил бы как формулу — экранируем апострофом */
export const csv = (v: unknown) => {
  let t = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
};
const html = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Вебхук Битрикс24: только https и только адрес портала, не локальная сеть */
export function validateBitrixWebhook(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "Это не адрес. Скопируйте вебхук целиком: https://ваш-портал.bitrix24.ru/rest/1/код/"; }
  if (u.protocol !== "https:") return "Вебхук должен начинаться с https://";
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)|^172\.(1[6-9]|2\d|3[01])\./i.test(u.hostname)) return "Адрес в локальной сети не подходит — нужен адрес вашего портала Битрикс24";
  if (!/\/rest\/\d+\/[^/]+\/?$/.test(u.pathname)) return "Похоже на неполный вебхук: в конце должно быть /rest/номер/код/";
  return null;
}

/** Понятный текст сетевой ошибки */
export function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  const code = (e as any)?.cause?.code ?? (e as any)?.code ?? "";
  if ((e as any)?.name === "TimeoutError" || /timeout|ETIMEDOUT/i.test(m + code)) return "сервис не ответил вовремя — проверьте интернет";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return "адрес не найден — проверьте настройки и интернет";
  if (/ECONNREFUSED|ECONNRESET|fetch failed/.test(code + m)) return "нет соединения с сервисом — проверьте интернет";
  if (/EAUTH|Invalid login|535/.test(code + m)) return "почтовый сервер не принял логин или пароль (для Яндекса и Mail.ru нужен пароль приложения)";
  return m;
}

/** Реестр закупок: одна строка на закупку. Открывается в Excel и импортируется в Google Таблицы. */
export function appendRegistry(path: string, r: Report, reportPath: string) {
  mkdirSync(dirname(path), { recursive: true });
  const f = (k: string) => r.fields.find(x => x.key === k)?.value;
  if (!existsSync(path)) appendFileSync(path, "﻿" + ["Дата разбора", "Номер", "Закон", "Способ", "Объект", "Заказчик", "НМЦК", "Подача до", "Вердикт", "Высоких рисков", "Рисков", "Отчёт"].map(csv).join(";") + "\n");
  appendFileSync(path, [r.createdAt.slice(0, 10), r.noticeNumber, r.law, r.procedure, r.title, f("customer"), f("nmck"), f("deadline"), r.fitSummary ?? "", r.risks.filter(x => x.severity === "высокий").length, r.risks.length, reportPath].map(csv).join(";") + "\n");
}
