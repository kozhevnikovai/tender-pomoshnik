// Модели скачиваются один раз в папку пользователя: OCR (Tesseract) и локальная языковая модель.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statfsSync, statSync, unlinkSync } from "node:fs";
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
/** Папка моделей. На Windows llama.cpp и Tesseract не открывают пути не на латинице — для них общая C:\\ProgramData\\TenderPomoshnik */
export function modelsDir(): string {
  if (process.env.TENDER_MODELS) return process.env.TENDER_MODELS;
  const own = join(homeDir(), "models");
  if (process.platform === "win32" && /[^\x00-\x7F]/.test(own)) return join(process.env.ProgramData || "C:\\ProgramData", "TenderPomoshnik", "models");
  return own;
}

const HF = "https://huggingface.co";
const TESS = "https://github.com/tesseract-ocr/tessdata_fast/raw/main";

/** sha256 — контрольная сумма; файл с другой суммой не принимается */
export interface ModelFile { path: string; url: string; size: number; sha256: string }
export interface ModelPack { id: string; title: string; license: string; files: ModelFile[] }

export const PACKS: Record<string, ModelPack> = {
  ocr: {
    id: "ocr", title: "Распознавание сканов Tesseract (русский, английский)", license: "Apache-2.0",
    files: [
      { path: "rus.traineddata", url: `${TESS}/rus.traineddata`, size: 3861738, sha256: "e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225" },
      { path: "eng.traineddata", url: `${TESS}/eng.traineddata`, size: 4113088, sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2" },
    ],
  },
  llm: {
    id: "llm", title: "Языковая модель Qwen3 4B Instruct (Q4_K_M) — работает без видеокарты", license: "Apache-2.0",
    files: [{ path: "llm/qwen3-4b-instruct-2507-q4_k_m.gguf", url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, size: 2497281120, sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597" }],
  },
  "llm-8b": {
    id: "llm-8b", title: "Языковая модель Qwen3 8B (Q4_K_M) — точнее, нужна видеокарта от 8 ГБ", license: "Apache-2.0",
    files: [{ path: "llm/qwen3-8b-q4_k_m.gguf", url: `${HF}/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf`, size: 5027784512, sha256: "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4" }],
  },
};

export const modelPath = (p: string) => join(modelsDir(), p);

export function missing(packs = ["ocr", "llm"]): ModelFile[] {
  return packs.flatMap(id => PACKS[id].files).filter(f => {
    const p = modelPath(f.path);
    return !existsSync(p) || statSync(p).size !== f.size;
  });
}

/** Что и зачем скачиваем — для экрана настроек */
export function plan(packs = Object.keys(PACKS)) {
  return packs.map(id => ({ id, title: PACKS[id].title, license: PACKS[id].license, size: PACKS[id].files.reduce((a, f) => a + f.size, 0), missing: missing([id]).length > 0 }));
}
export const totalSize = (files: ModelFile[]) => files.reduce((a, f) => a + f.size, 0);

/** Запасной адрес, если huggingface.co недоступен */
const mirrors = (url: string) => [url, url.replace("https://huggingface.co/", "https://hf-mirror.com/")].filter((u, i, a) => a.indexOf(u) === i);

export type Progress = (e: { file: string; done: number; total: number; fileDone: number; fileTotal: number; index: number; count: number }) => void;

async function sha256(p: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(p), h);
  return h.digest("hex");
}

/** Есть ли место: нужно на 200 МБ больше, чем осталось скачать */
export function checkSpace(dir: string, need: number) {
  mkdirSync(dir, { recursive: true });
  try {
    const st = statfsSync(dir);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < need + 200 * 1048576) throw new Error(`Не хватает места на диске: нужно ${(need / 1073741824).toFixed(1)} ГБ, свободно ${(free / 1073741824).toFixed(1)} ГБ. Освободите место и запустите загрузку ещё раз.`);
  } catch (e) { if ((e as Error).message.startsWith("Не хватает")) throw e; }
}

/** Скачивает недостающие модели: докачка после обрыва, проверка места и SHA-256, запасной адрес */
export async function download(packs = ["ocr", "llm"], onProgress?: Progress): Promise<void> {
  const todo = missing(packs);
  const total = totalSize(todo);
  const partSize = (f: ModelFile) => { const p = modelPath(f.path) + ".part"; return existsSync(p) ? statSync(p).size : 0; };
  checkSpace(modelsDir(), total - todo.reduce((a, f) => a + partSize(f), 0));
  let before = 0;
  for (const [index, f] of todo.entries()) {
    const dest = modelPath(f.path);
    const part = dest + ".part";
    mkdirSync(dirname(dest), { recursive: true });
    let lastErr: Error | null = null;
    for (const url of mirrors(f.url)) {
      try {
        let have = partSize(f);
        if (have > f.size) { unlinkSync(part); have = 0; }
        if (have < f.size) {
          const res = await netFetch("model-download", url, { redirect: "follow", headers: have ? { Range: `bytes=${have}-` } : {}, signal: AbortSignal.timeout(2 * 60 * 60_000) });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          if (have && res.status !== 206) have = 0;
          let done = have;
          const src = Readable.fromWeb(res.body as any);
          src.on("data", (c: Buffer) => { done += c.length; onProgress?.({ file: f.path, fileDone: done, fileTotal: f.size, done: before + done, total, index, count: todo.length }); });
          await pipeline(src, createWriteStream(part, { flags: have ? "a" : "w" }));
        }
        if (statSync(part).size !== f.size) throw new Error("файл скачан не полностью — запустите загрузку ещё раз, она продолжится");
        if ((await sha256(part)) !== f.sha256) { unlinkSync(part); throw new Error("контрольная сумма не совпала, файл удалён — скачайте ещё раз"); }
        renameSync(part, dest);
        lastErr = null;
        break;
      } catch (e) { lastErr = e as Error; }
    }
    if (lastErr) throw new Error(`Не удалось скачать ${f.path}: ${lastErr.message}`);
    before += f.size;
  }
}

/** OCR нужен только для сканов: модель (~2 МБ) докачивается при первом скане */
export async function ensureOcr() { if (missing(["ocr"]).length) await download(["ocr"]); }
