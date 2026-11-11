// Фоновый процесс: чтение документов, OCR и разбор не тормозят окно.
import * as core from "../dist/index.js";
import { loadConfig, saveConfig, loadProfile, saveProfile, setSecrets, EMPTY_PROFILE } from "../dist/config.js";
import { download, LLM_MODELS, missing, plan, selectLlm, totalSize } from "../dist/models.js";
import { detectHardware, recommend } from "@kozhevnikovai/local-ai";
import { netStats, setOffline } from "../dist/net.js";
import { runMonitor } from "../dist/monitor.js";
import { bitrixDeal, sendEmail, sendTelegram, summaryText } from "../dist/integrations/index.js";

const port = process.parentPort;
const progress = stage => port.postMessage({ type: "progress", stage });
const net = () => port.postMessage({ type: "net", ...netStats() });

let downloading = null;
let hw = null; // характеристики компьютера: llama.cpp определяет видеокарту один раз
/** Выбор языковой модели по железу: при первом запуске рекомендованная сохраняется сама, сменить — в настройках */
async function models() {
  hw ??= await detectHardware();
  const r = recommend(hw);
  let c = loadConfig();
  const first = !c.llm.localModel;
  if (first) { saveConfig({ llm: { localModel: r.model.id } }); c = loadConfig(); }
  return { first, selected: selectLlm(c.llm.localModel), recommended: r.model.id, reason: r.reason, hw,
    options: r.options.map(o => ({ id: o.model.id, tier: o.model.tier, title: o.model.title, vendor: o.model.vendor, note: o.model.note, size: o.model.file.size, ok: o.ok, why: o.why })) };
}
const methods = {
  async status() { const llm = await models(); return { llm, version: core.VERSION, rules: core.rules().rules.length, rulesVersion: core.rules().version, missing: missing().map(f => f.path), left: totalSize(missing()), packs: plan(), downloading: !!downloading, config: loadConfig(), profile: loadProfile() ?? EMPTY_PROFILE, net: netStats() }; },
  /** Сменить локальную языковую модель; файлы другой модели не удаляются */
  async setModel({ id }) {
    if (downloading) throw new Error("Дождитесь окончания загрузки");
    if (!LLM_MODELS.some(m => m.id === id)) throw new Error("Неизвестная модель");
    saveConfig({ llm: { localModel: id } });
    return { llm: await models(), packs: plan(), left: totalSize(missing()) };
  },
  async download() {
    if (downloading) return downloading; // повторный клик не запускает вторую загрузку
    downloading = download(["ocr", "llm"], e => port.postMessage({ type: "progress", stage: "download", ...e })).then(() => true).finally(() => { downloading = null; });
    return downloading;
  },
  /** Проверка подключения из настроек: тестовое сообщение в Telegram / почту, профиль в Битрикс24 */
  async testIntegration({ target }) {
    const c = loadConfig();
    if (c.offline) throw new Error("Включён строгий офлайн — выключите его, чтобы проверить подключение");
    if (target === "telegram") await sendTelegram(c, "Тендерный помощник: проверка подключения ✓");
    if (target === "email") await sendEmail(c, "Тендерный помощник: проверка", "Проверка подключения прошла успешно.");
    if (target === "bitrix24") {
      const { validateBitrixWebhook } = await import("../dist/integrations/index.js");
      const bad = validateBitrixWebhook(c.bitrix24?.webhook ?? "");
      if (bad) throw new Error(bad);
      const r = await fetch(c.bitrix24.webhook.replace(/\/?$/, "/") + "profile.json", { method: "POST", signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => ({}));
      if (j.error || !r.ok) throw new Error(j.error_description || j.error || `портал ответил ${r.status}`);
    }
    return true;
  },
  saveConfig({ patch }) { return saveConfig(patch); },
  saveProfile({ profile }) { saveProfile(profile); return loadProfile(); },
  async analyze({ regNumber, files, ocr }) {
    const r = await core.run({ regNumber, files, ocr, onStep: progress });
    net();
    return { report: r.report, dir: r.dir, files: r.files };
  },
  list() { return core.listRuns(); },
  open({ id }) { const r = core.loadRun(id); return { report: r.report, dir: r.dir, files: { html: `${r.dir}/отчёт.html`, ics: `${r.dir}/сроки.ics`, clarification: `${r.dir}/черновик-запрос-разъяснений.docx`, complaint: `${r.dir}/черновик-жалобы-ФАС.docx` } }; },
  check({ id, offer }) { return core.checkOffer(core.loadRun(id).report.requirements, offer); },
  async monitor({ notify }) { const r = await runMonitor({ notify }); net(); return r; },
  async send({ id, target }) {
    const c = loadConfig();
    const { report } = core.loadRun(id);
    if (target === "telegram") await sendTelegram(c, summaryText(report));
    if (target === "bitrix24") await bitrixDeal(c, report);
    net();
    return true;
  },
};

port.on("message", async e => {
  const { id, method, args } = e.data;
  try {
    setSecrets(e.data.secrets);
    setOffline(loadConfig().offline);
    port.postMessage({ id, result: await methods[method](args ?? {}) });
  } catch (err) { port.postMessage({ id, error: err?.message ?? String(err) }); }
});
