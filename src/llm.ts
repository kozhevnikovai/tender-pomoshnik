// Языковые модели для протокола.
// По умолчанию — локальная модель через llama.cpp: ничего не уходит в сеть.
// Облачная модель (OpenAI-совместимый API: YandexGPT, OpenRouter, свой сервер) — только если пользователь включил её сам.
import { netFetch } from "./net.js";
import { missing, modelPath, PACKS } from "./models.js";
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
  const big = !o.modelFile && !missing(["llm-8b"]).length;
  const file = o.modelFile ?? modelPath((big ? PACKS["llm-8b"] : PACKS.llm).files[0].path);
  if (!o.modelFile && !big && missing(["llm"]).length) throw new Error("Нет языковой модели. Запустите: tender models");
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  const gpu = (o.gpu ?? process.env.TENDER_GPU ?? "auto") as any;
  const llama = await getLlama({ gpu: gpu === "cpu" ? false : gpu, logLevel: "error" as any });
  const model = await llama.loadModel({ modelPath: file });
  const context = await model.createContext({ contextSize: { max: o.contextSize ?? 12288 } });
  const sequence = context.getSequence();
  const device = llama.gpu ? `GPU (${llama.gpu})` : "CPU";
  return {
    name: `${file.split(/[\\/]/).pop()} · ${device}`,
    async json<T>(system: string, user: string, schema: object, maxTokens = 3000) {
      const grammar = await llama.createGrammarForJsonSchema(schema as any);
      // маленькая модель иногда зацикливается внутри строки — штраф за повторы, при сбое вторая попытка строже
      for (const [i, penalty] of [1.1, 1.25].entries()) {
        await sequence.clearHistory();
        const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system, autoDisposeSequence: false });
        try {
          const res = await session.prompt(user, { grammar, temperature: i ? 0 : 0.1, maxTokens, repeatPenalty: { penalty, lastTokens: 128, frequencyPenalty: 0.1 } });
          return grammar.parse(res) as T;
        } catch (e) {
          if (i) throw new Error(`Модель не смогла выдать корректный ответ: ${(e as Error).message}`);
        } finally { session.dispose({ disposeSequence: false }); }
      }
      throw new Error("недостижимо");
    },
    async dispose() { await context.dispose(); await model.dispose(); await llama.dispose(); },
  };
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
