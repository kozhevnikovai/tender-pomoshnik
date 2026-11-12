// Электронная площадка и номер процедуры из документов. Коммерческие площадки (B2B-Center, коммерческие секции
// Сбербанк-АСТ и РТС-тендер) не дают читать процедуры без входа — разбираем файлы, которые пользователь скачал сам.
import type { DocText } from "../types.js";

export interface PlatformInfo { name: string; url: string; procedureNumber: string | null }

const PLATFORMS: { name: string; url: string; re: RegExp }[] = [
  { name: "B2B-Center", url: "https://www.b2b-center.ru", re: /b2b-center|b2b центр|центр развития экономики/i },
  { name: "Сбербанк-АСТ", url: "https://www.sberbank-ast.ru", re: /сбербанк-аст|sberbank-ast|utp\.sberbank/i },
  { name: "РТС-тендер", url: "https://www.rts-tender.ru", re: /ртс-тендер|ртс тендер|rts-tender/i },
  { name: "Росэлторг", url: "https://www.roseltorg.ru", re: /росэлторг|roseltorg|единая электронная торговая площадка/i },
  { name: "ЭТП ГПБ", url: "https://etpgpb.ru", re: /етп газпромбанка|этп гпб|etpgpb/i },
  { name: "ТЭК-Торг", url: "https://www.tektorg.ru", re: /тэк-торг|tektorg/i },
  { name: "Фабрикант", url: "https://www.fabrikant.ru", re: /фабрикант|fabrikant\.ru/i },
  { name: "ZakazRF", url: "https://zakazrf.ru", re: /zakazrf|агз рт/i },
  { name: "АСТ ГОЗ", url: "https://www.astgoz.ru", re: /аст гоз|astgoz/i },
  { name: "ЭТС (НЭП)", url: "https://www.etp-ets.ru", re: /etp-ets|национальная электронная площадка/i },
];

export function detectPlatform(docs: DocText[]): PlatformInfo | null {
  const head = docs.flatMap(d => d.parts.slice(0, 80).map(p => p.text)).join("\n").slice(0, 200_000);
  const hits = PLATFORMS.map(p => ({ p, n: head.match(new RegExp(p.re.source, "gi"))?.length ?? 0 })).filter(x => x.n).sort((a, b) => b.n - a.n);
  if (!hits.length) return null;
  const num = head.match(/(?:процедур[аы]|закупк[аи]|лот[ау]?|извещени[ея])\s*(?:№|N|номер)\s*:?\s*([A-ZА-Я]{0,4}[-\d]{5,20})/i)?.[1] ?? null;
  return { name: hits[0].p.name, url: hits[0].p.url, procedureNumber: num && !/^\d{11}$|^\d{19}$/.test(num) ? num : null };
}
