// Модели скачиваются один раз в папку пользователя: OCR (Tesseract) и локальная языковая модель.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { netFetch } from "./net.js";

export function homeDir(): string {
  if (process.env.TENDER_HOME) return process.env.TENDER_HOME;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "TenderPomoshnik");
  return join(homedir(), ".tender-pomoshnik");
}
export const modelsDir = () => join(homeDir(), "models");

const HF = "https://huggingface.co";
const TESS = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";

export interface ModelFile { path: string; url: string; size: number }
export interface ModelPack { id: string; title: string; license: string; files: ModelFile[] }

/** size 0 — размер берётся из ответа сервера */
export const PACKS: Record<string, ModelPack> = {
  ocr: {
    id: "ocr", title: "Распознавание сканов Tesseract (русский, английский)", license: "Apache-2.0",
    files: [
      { path: "rus.traineddata", url: `${TESS}/rus.traineddata`, size: 0 },
      { path: "eng.traineddata", url: `${TESS}/eng.traineddata`, size: 0 },
    ],
  },
  llm: {
    id: "llm", title: "Языковая модель Qwen3 4B Instruct (Q4_K_M) — работает без видеокарты", license: "Apache-2.0",
    files: [{ path: "llm/qwen3-4b-instruct-2507-q4_k_m.gguf", url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, size: 2497281120 }],
  },
  "llm-8b": {
    id: "llm-8b", title: "Языковая модель Qwen3 8B (Q4_K_M) — точнее, нужна видеокарта от 8 ГБ", license: "Apache-2.0",
    files: [{ path: "llm/qwen3-8b-q4_k_m.gguf", url: `${HF}/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf`, size: 0 }],
  },
};

export const modelPath = (p: string) => join(modelsDir(), p);

export function missing(packs = ["ocr", "llm"]): ModelFile[] {
  return packs.flatMap(id => PACKS[id].files).filter(f => {
    const p = modelPath(f.path);
    return !existsSync(p) || (f.size > 0 && statSync(p).size !== f.size);
  });
}

export type Progress = (e: { file: string; done: number; total: number }) => void;

export async function download(packs = ["ocr", "llm"], onProgress?: Progress): Promise<void> {
  for (const f of missing(packs)) {
    const dest = modelPath(f.path);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await netFetch("model-download", f.url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${f.path}: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || f.size;
    let done = 0;
    const src = Readable.fromWeb(res.body as any);
    src.on("data", (c: Buffer) => { done += c.length; onProgress?.({ file: f.path, done, total }); });
    await pipeline(src, createWriteStream(dest + ".part"));
    const got = statSync(dest + ".part").size;
    if ((f.size > 0 && got !== f.size) || (total > 0 && got !== total)) throw new Error(`Файл ${f.path} скачан не полностью — запустите загрузку ещё раз`);
    renameSync(dest + ".part", dest);
  }
}

/** OCR нужен только для сканов: модель (~2 МБ) докачивается при первом скане */
export async function ensureOcr() { if (missing(["ocr"]).length) await download(["ocr"]); }
