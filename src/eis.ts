// Открытая часть ЕИС (zakupki.gov.ru): карточка закупки, список документов, RSS-поиск.
// Только публичные страницы, без авторизации и обхода защиты; не чаще 1 запроса в секунду.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { netFetch } from "./net.js";
import type { DocText } from "./types.js";

const BASE = "https://zakupki.gov.ru";
const UA = "TenderPomoshnik/1.0 (+https://github.com/kozhevnikovai/tender-pomoshnik)";
let last = 0;

/** Только сама ЕИС по https: ссылки со страниц и редиректы не могут увести запрос на другой адрес */
export function isEisUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "https:" && (u.hostname === "zakupki.gov.ru" || u.hostname.endsWith(".zakupki.gov.ru")) && !u.username && !u.password; }
  catch { return false; }
}

/** Самый большой документ закупки, который скачиваем */
export const MAX_DOC_BYTES = 100 * 1024 * 1024;

async function get(url: string, redirects = 0): Promise<Response> {
  if (!isEisUrl(url)) throw new Error(`Адрес не относится к ЕИС и не будет открыт: ${url}`);
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const res = await netFetch("eis", url, { headers: { "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (redirects >= 5) throw new Error("ЕИС перенаправляет по кругу — попробуйте позже");
    return get(new URL(res.headers.get("location")!, url).toString(), redirects + 1);
  }
  if (!res.ok) throw new Error(res.status === 404 ? "Страница не найдена в ЕИС — проверьте номер извещения" : res.status >= 500 ? `ЕИС временно недоступна (ошибка ${res.status}) — попробуйте позже` : `ЕИС ответила ${res.status}`);
  return res;
}

/** Читает ответ не больше max байт: огромный файл не съест память */
async function readCapped(res: Response, max = MAX_DOC_BYTES): Promise<Buffer | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) { await res.body?.cancel().catch(() => {}); return null; }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** Имя файла для диска: без путей, точек в начале и зарезервированных имён Windows */
export function safeFileName(title: string, i: number): string {
  let n = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "").slice(0, 120) || "документ";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = "_" + n;
  return `${String(i + 1).padStart(2, "0")} ${n}`;
}

const unesc = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const clean = (s: string) => unesc(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Тип страницы закупки 44-ФЗ по номеру: ea20 — аукцион, ok20 — конкурс, zk20 — котировки и т. д. */
const KINDS_44 = ["ea20", "ok20", "zk20", "ezt20", "zp20", "ep20", "inm111"];

export interface NoticeCard {
  regNumber: string;
  url: string;
  law: "44-ФЗ" | "223-ФЗ";
  fields: [string, string][];
  docs: { title: string; url: string }[];
}

export function cardUrl(regNumber: string, kind = "ea20") {
  return regNumber.length === 11
    ? `${BASE}/epz/order/notice/notice223/common-info.html?regNumber=${regNumber}`
    : `${BASE}/epz/order/notice/${kind}/view/common-info.html?regNumber=${regNumber}`;
}

/** Пары «подпись — значение» из карточки ЕИС */
export function parseCard(html: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /<span class="section__title">\s*([^<]*?)\s*<\/span>\s*<span class="section__info[^"]*">\s*([\s\S]*?)\s*<\/span>\s*(?=<\/section>|<span class="section__title"|<\/div>)/g;
  for (const m of html.matchAll(re)) {
    const k = clean(m[1]), v = clean(m[2]);
    if (k && v && k.length < 300) out.push([k, v]);
  }
  // 223-ФЗ: <div class="common-text__title">…</div><div class="common-text__value[^"]*">…</div>
  for (const m of html.matchAll(/class="common-text__title">\s*([^<]*?)\s*<\/div>\s*<div class="common-text__value[^"]*">\s*([\s\S]*?)\s*<\/div>/g)) {
    const k = clean(m[1]), v = clean(m[2]);
    if (k && v && k.length < 300) out.push([k, v]);
  }
  // таблицы <td>подпись</td><td>значение</td>
  for (const m of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]{2,300}?)<\/td>\s*<td[^>]*>([\s\S]{1,2000}?)<\/td>\s*<\/tr>/g)) {
    const k = clean(m[1]), v = clean(m[2]);
    if (k && v && !out.some(([a]) => a === k) && /[а-я]/i.test(k) && k.length < 200) out.push([k, v]);
  }
  return out;
}

export function parseDocLinks(html: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  // 44-ФЗ: href … title="имя"; 223-ФЗ: href … data-tooltip='<span class="custom-tooltiptext">имя</span>'
  const res = [/href="([^"]*filestore[^"]*)"[^>]*?title="([^"]+)"/g, /href="([^"]*filestore[^"]*)"\s*data-tooltip='<span class="custom-tooltiptext">([^<]+)<\/span>/g];
  for (const m of res.flatMap(re => [...html.matchAll(re)])) {
    let url: string;
    try { url = new URL(unesc(m[1]), BASE + "/").toString(); } catch { continue; }
    if (!isEisUrl(url)) continue; // ссылки на сторонние сайты не скачиваем
    if (!out.some(d => d.url === url)) out.push({ title: unesc(m[2]).trim(), url });
  }
  return out;
}

export async function fetchCard(regNumber: string): Promise<NoticeCard> {
  if (!/^\d{11}$|^\d{19}$/.test(regNumber)) throw new Error("Номер извещения: 19 цифр (44-ФЗ) или 11 цифр (223-ФЗ)");
  const law = regNumber.length === 11 ? "223-ФЗ" : "44-ФЗ";
  let html = "", url = "", kind = "ea20";
  for (const k of law === "223-ФЗ" ? ["223"] : KINDS_44) {
    url = cardUrl(regNumber, k);
    html = await (await get(url)).text();
    if (/section__title|common-text__title/.test(html)) { kind = k; break; }
  }
  const fields = parseCard(html);
  if (!fields.length) throw new Error(`Карточка закупки ${regNumber} не найдена в ЕИС`);
  const d223 = html.match(/documents\.html\?purchaseNoticeNumber=[^"']+/)?.[0]?.replace(/&amp;/g, "&");
  const docsUrl = law === "223-ФЗ" ? `${BASE}/epz/order/notice/notice223/${d223 ?? `documents.html?purchaseNoticeNumber=${regNumber}`}` : `${BASE}/epz/order/notice/${kind}/view/documents.html?regNumber=${regNumber}`;
  const docs = parseDocLinks(await (await get(docsUrl)).text());
  return { regNumber, url, law, fields, docs };
}

/** Карточка как «документ» — чтобы на её строки можно было ссылаться: «Карточка ЕИС, абз. 17» */
export function cardDoc(c: NoticeCard): DocText {
  const parts = [{ n: 1, text: `Извещение № ${c.regNumber} (${c.law}). Источник: ${c.url}` }, ...c.fields.map(([k, v], i) => ({ n: i + 2, text: `${k}: ${v}` }))];
  return { name: `Карточка ЕИС ${c.regNumber}`, kind: "txt", unit: "para", parts, tables: [], warnings: [] };
}

/** Скачивает документы закупки в папку; возвращает пути */
export async function downloadDocs(c: NoticeCard, dir: string, limit = 20, warnings: string[] = []): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const [i, d] of c.docs.slice(0, limit).entries()) {
    try {
      const buf = await readCapped(await get(d.url));
      if (!buf) { warnings.push(`«${d.title}» больше 100 МБ — не скачан, откройте его в ЕИС`); continue; }
      const p = join(dir, safeFileName(d.title, i));
      writeFileSync(p, buf);
      paths.push(p);
    } catch (e) { warnings.push(`«${d.title}» не скачан: ${(e as Error).message}`); }
  }
  if (c.docs.length > limit) warnings.push(`Документов ${c.docs.length}, скачаны первые ${limit}`);
  return paths;
}

export interface SearchQuery { text: string; law44?: boolean; law223?: boolean; priceFrom?: number; priceTo?: number; regions?: string[]; okpd2?: string[] }
export interface SearchItem { regNumber: string; title: string; url: string; description: string; published?: string }

/** Поиск по реестру закупок через официальный RSS ЕИС (этап «Подача заявок») */
export async function searchRss(q: SearchQuery): Promise<SearchItem[]> {
  const p = new URLSearchParams({ searchString: q.text, morphology: "on", af: "on", recordsPerPage: "_50", sortBy: "PUBLISH_DATE", sortDirection: "false" });
  if (q.law44 !== false) p.set("fz44", "on");
  if (q.law223 !== false) p.set("fz223", "on");
  if (q.priceFrom) p.set("priceFromGeneral", String(q.priceFrom));
  if (q.priceTo) p.set("priceToGeneral", String(q.priceTo));
  const xml = await (await get(`${BASE}/epz/order/extendedsearch/rss.html?${p}`)).text();
  return parseRss(xml);
}

export function parseRss(xml: string): SearchItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const x = m[1];
    const tag = (t: string) => unesc(x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "").trim();
    const link = tag("link");
    const desc = clean(unesc(tag("description")));
    return { regNumber: link.match(/regNumber=(\d+)/)?.[1] ?? tag("title").match(/(\d{11,19})/)?.[1] ?? "", title: tag("title"), url: link, description: desc, published: tag("pubDate") || undefined };
  }).filter(i => i.regNumber);
}
