// Языковые модели для протокола.
// По умолчанию — локальная модель через llama.cpp: ничего не уходит в сеть.
// Облачная модель (OpenAI-совместимый API: YandexGPT, OpenRouter, свой сервер) — только если пользователь включил её сам.
import { netFetch } from "./net.js";
import { getModel, loadLocalLLM } from "@kozhevnikovai/local-ai";
import { missing, modelPath, PACKS, selectLlm } from "./models.js";
import { maskText } from "./privacy.js";

export interface LLM {
  name: string;
  /** Ответ строго по JSON-схеме */
  json<T>(system: string, user: string, schema: object, maxTokens?: number): Promise<T>;
  dispose(): Promise<void>;
}

export interface LLMOptions {
  provider?: "local" | "claude" | "openai";
  /** Маскировать персональные данные перед отправкой в облако (по умолчанию да) */
  mask?: boolean;
  /** Модель из каталога local-ai: qwen3-4b (лёгкая) или qwen3-14b (мощная) */
  localModel?: string;
  /** Путь к своей GGUF-модели (local) */
  modelFile?: string;
  /** Размер контекста, токенов (local) */
  contextSize?: number;
  /** OpenAI-совместимый API */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** "auto" | "cpu" | "cuda" | "vulkan" | "metal" */
  gpu?: string;
}

export async function createLLM(o: LLMOptions = {}): Promise<LLM> {
  return o.provider === "openai" ? openai(o) : o.provider === "claude" ? claude(o) : local(o);
}

async function local(o: LLMOptions): Promise<LLM> {
  const id = selectLlm(o.localModel ?? process.env.TENDER_LLM_MODEL);
  const file = o.modelFile ?? modelPath(PACKS.llm.files[0].path);
  if (!o.modelFile && missing(["llm"]).length) throw new Error("Нет языковой модели. Запустите: tender models");
  const m = await loadLocalLLM({ modelFile: file, gpu: o.gpu ?? process.env.TENDER_GPU ?? "auto", contextSize: o.contextSize ?? 12288 });
  return { name: o.modelFile ? m.name : `${getModel(id).title} · ${m.device}`, json: m.json, dispose: m.dispose };
}

function openai(o: LLMOptions): LLM {
  if (!o.baseUrl || !o.model) throw new Error("Для облачной модели нужны адрес API и название модели");
  const url = o.baseUrl.replace(/\/$/, "") + "/chat/completions";
  return {
    name: `${o.model} · облако (${new URL(url).host})`,
    async json<T>(system: string, user: string, schema: object, maxTokens = 3000) {
      const body = JSON.stringify({
        model: o.model, temperature: 0.1, max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\n\nОтветь только JSON по схеме:\n${JSON.stringify(schema)}` },
          { role: "user", content: o.mask === false ? user : maskText(user) },
        ],
      });
      const res = await netFetch("cloud-llm", url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey ?? ""}` }, body });
      if (!res.ok) throw new Error(`Облачная модель ответила ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data: any = await res.json();
      const text: string = data.choices?.[0]?.message?.content ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Облачная модель вернула не JSON");
      return JSON.parse(m[0]) as T;
    },
    async dispose() {},
  };
}

/** Claude (Anthropic API) со своим ключом. Включается только явно; текст маскируется. */
function claude(o: LLMOptions): LLM {
  if (!o.apiKey) throw new Error("Для Claude нужен ключ API (настройки → Модель)");
  const model = o.model ?? "claude-sonnet-5-5";
  return {
    name: `${model} · облако (api.anthropic.com)`,
    async json<T>(system: string, user: string, schema: object, maxTokens = 3000) {
      const body = JSON.stringify({
        model, max_tokens: maxTokens, temperature: 0,
        system: `${system}\n\nОтветь только JSON по схеме:\n${JSON.stringify(schema)}`,
        messages: [{ role: "user", content: o.mask === false ? user : maskText(user) }],
      });
      const res = await netFetch("cloud-llm", "https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": o.apiKey!, "anthropic-version": "2023-06-01" }, body });
      if (!res.ok) throw new Error(`Claude ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data: any = await res.json();
      const text: string = data.content?.map((c: any) => c.text ?? "").join("") ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Claude вернул не JSON");
      return JSON.parse(m[0]) as T;
    },
    async dispose() {},
  };
}
