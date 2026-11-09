// Общие типы Тендерного помощника. Главный принцип: у каждого утверждения есть источник —
// цитата из документа закупки (Source) и/или карточка нормы закона (LawRef).

export type Law = "44-ФЗ" | "223-ФЗ";
export type Procedure = "аукцион" | "конкурс" | "котировки" | "запрос предложений" | "иное";

/** Текст одного документа закупки по страницам (PDF, скан) или абзацам (DOCX, TXT) */
export interface DocText {
  name: string;
  kind: "pdf" | "docx" | "txt" | "image";
  /** page — страницы PDF/скана; para — абзацы DOCX/TXT (у DOCX нет страниц) */
  unit: "page" | "para";
  parts: { n: number; text: string; ocr?: boolean }[];
  tables: string[][][];
  warnings: string[];
}

/** Где в документах закупки найдено утверждение */
export interface Source {
  doc: string;
  unit: "page" | "para";
  n: number;
  quote: string;
}

/** Ссылка на норму из базы правил */
export interface LawRef {
  id: string;
  act: string;
  ref: string;
  title: string;
  url: string;
  status: "verified" | "check";
}

export type Status = "ok" | "check" | "missing";

/** Одно извлечённое сведение о закупке */
export interface Field {
  key: string;
  label: string;
  value: string | number | null;
  source?: Source;
  law?: LawRef[];
  status: Status;
  note?: string;
}

export type Verdict = "можем" | "нельзя" | "нужно";

export interface FitItem {
  requirement: string;
  verdict: Verdict;
  reason: string;
  source?: Source;
  law?: LawRef[];
}

export type Severity = "высокий" | "средний" | "низкий";

export interface Risk {
  id: string;
  title: string;
  severity: Severity;
  detail: string;
  source?: Source;
  law?: LawRef[];
  /** вопрос заказчику для черновика запроса на разъяснение */
  question?: string;
  /** можно ли обжаловать (только черновик жалобы) */
  complaint?: boolean;
}

export interface Calc {
  label: string;
  value: string;
  formula: string;
  law: LawRef[];
  status: Status;
}

export interface Deadline {
  title: string;
  at: string;
  basis: string;
  law?: LawRef[];
  source?: Source;
}

export interface Requirement {
  /** позиция ТЗ: наименование товара и характеристика */
  item: string;
  name: string;
  /** как задано в ТЗ: «не менее 8», «от 2 до 4», «белый» */
  required: string;
  unit?: string;
  op: ">=" | "<=" | "range" | "=" | "text";
  min?: number;
  max?: number;
  text?: string;
  source?: Source;
}

/** Профиль компании — хранится только локально */
export interface CompanyProfile {
  name: string;
  inn?: string;
  okved: string[];
  msp: boolean;
  /** «Лицензия МЧС на монтаж пожарной сигнализации», «СРО строителей» */
  licenses: string[];
  sro: string[];
  /** исполненные контракты для опыта и подтверждения добросовестности */
  contracts: { number?: string; price: number; finishedAt: string; penalties: boolean; subject?: string }[];
  /** товары, которые поставляем: страна и номер реестровой записи (нацрежим) */
  products: { name: string; country: string; registry?: string; okpd2?: string }[];
  regions: string[];
  /** сколько можно заморозить под обеспечение, ₽ */
  maxSecurity?: number;
}

export interface Report {
  version: string;
  createdAt: string;
  rulesVersion: string;
  rulesCount: number;
  law: Law | null;
  procedure: Procedure | null;
  noticeNumber: string | null;
  title: string | null;
  docs: { name: string; kind: string; unit: string; parts: number; ocrParts: number; warnings: string[] }[];
  fields: Field[];
  calcs: Calc[];
  fit: FitItem[];
  fitSummary: Verdict | null;
  risks: Risk[];
  deadlines: Deadline[];
  requirements: Requirement[];
  checklist: { item: string; source?: Source; law?: LawRef[] }[];
  warnings: string[];
  disclaimer: string;
}
