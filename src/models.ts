// Модели скачиваются один раз в папку пользователя: OCR (Tesseract) и локальная языковая модель.
import { checkSpace, DEFAULTS, downloadFiles, getModel, missingFiles, MODELS, totalSize as engineTotal, type ModelFile } from "@kozhevnikovai/local-ai";
import { homedir } from "node:os";
import { join } from "node:path";
import { netFetch } from "./net.js";

export function homeDir(): string {
  if (process.env.TENDER_HOME) return process.env.TENDER_HOME;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "TenderPomoshnik");
  return join(homedir(), ".tender-pomoshnik");
}
/** Папка моделей. На Windows llama.cpp и Tesseract не открывают пути не на латинице — для них общая C:\\ProgramData\\TenderPomoshnik */
export function modelsDir(): string {
  if (process.env.TENDER_MODELS) return process.env.TENDER_MODELS;
  const own = join(homeDir(), "models");
  if (process.platform === "win32" && /[^\x00-\x7F]/.test(own)) return join(process.env.ProgramData || "C:\\ProgramData", "TenderPomoshnik", "models");
  return own;
}

const TESS = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";

/** sha256 — контрольная сумма; файл с другой суммой не принимается */
export type { ModelFile };
export interface ModelPack { id: string; title: string; license: string; files: ModelFile[] }

/** Языковая модель — из общего каталога local-ai: лёгкая или мощная, выбор по железу или в настройках */
function llmPack(id: string): ModelPack {
  const m = getModel(id);
  return { id: "llm", title: `Языковая модель ${m.title} (${m.vendor}) — ${m.note.toLowerCase()}`, license: m.license, files: [m.file] };
}
export const LLM_MODELS = MODELS;
/** Выбрать локальную языковую модель. Неизвестный id — лёгкая модель по умолчанию (подойдёт любому ПК от 8 ГБ). */
export function selectLlm(id?: string): string {
  const ok = id && MODELS.some(m => m.id === id) ? id : DEFAULTS.light;
  PACKS.llm = llmPack(ok);
  return ok;
}

export const PACKS: Record<string, ModelPack> = {
  ocr: {
    id: "ocr", title: "Распознавание сканов Tesseract (русский, английский)", license: "Apache-2.0",
    files: [
      { path: "rus.traineddata", url: `${TESS}/rus.traineddata`, size: 3861738, sha256: "e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225" },
      { path: "eng.traineddata", url: `${TESS}/eng.traineddata`, size: 4113088, sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2" },
    ],
  },
  llm: llmPack(DEFAULTS.light),
};

export const modelPath = (p: string) => join(modelsDir(), p);

export function missing(packs = ["ocr", "llm"]): ModelFile[] {
  return missingFiles(modelsDir(), packs.flatMap(id => PACKS[id].files));
}

/** Что и зачем скачиваем — для экрана настроек */
export function plan(packs = Object.keys(PACKS)) {
  return packs.map(id => ({ id, title: PACKS[id].title, license: PACKS[id].license, size: PACKS[id].files.reduce((a, f) => a + f.size, 0), missing: missing([id]).length > 0 }));
}
export const totalSize = (files: ModelFile[]) => engineTotal(files);
export { checkSpace };

export type Progress = (e: { file: string; done: number; total: number; fileDone: number; fileTotal: number; index: number; count: number }) => void;

/** Скачивает недостающие модели движком local-ai: докачка после обрыва, проверка места и SHA-256, запасной адрес */
export async function download(packs = ["ocr", "llm"], onProgress?: Progress): Promise<void> {
  await downloadFiles(packs.flatMap(id => PACKS[id].files), { dir: modelsDir(), onProgress, fetch: (url, init) => netFetch("model-download", url, init) });
}

/** OCR нужен только для сканов: модель (~2 МБ) докачивается при первом скане */
export async function ensureOcr() { if (missing(["ocr"]).length) await download(["ocr"]); }
