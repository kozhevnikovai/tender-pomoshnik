// Локальный OCR (Tesseract, русский + английский). Языковые модели скачиваются один раз в папку моделей.
import { existsSync } from "node:fs";
import { modelsDir, ensureOcr } from "../models.js";

let worker: any = null;

export async function ocrImage(img: Buffer): Promise<string> {
  if (!worker) {
    await ensureOcr();
    const { createWorker } = await import("tesseract.js");
    const langPath = modelsDir();
    if (!existsSync(`${langPath}/rus.traineddata`)) throw new Error("нет модели OCR rus.traineddata");
    worker = await createWorker(["rus", "eng"], 1, { langPath, cachePath: langPath, gzip: false, logger: () => {} });
  }
  const { data } = await worker.recognize(img);
  return data.text as string;
}

export async function closeOcr() { if (worker) { await worker.terminate(); worker = null; } }
