// Фоновый процесс: чтение документов, OCR и разбор не тормозят окно.
import * as core from "../dist/index.js";
import { loadConfig, saveConfig, loadProfile, saveProfile, EMPTY_PROFILE } from "../dist/config.js";
import { download, missing, PACKS } from "../dist/models.js";
import { netStats, setOffline } from "../dist/net.js";
import { runMonitor } from "../dist/monitor.js";
import { bitrixDeal, sendTelegram, summaryText } from "../dist/integrations/index.js";

const port = process.parentPort;
const progress = stage => port.postMessage({ type: "progress", stage });
const net = () => port.postMessage({ type: "net", ...netStats() });

const methods = {
  status() { return { version: core.VERSION, rules: core.rules().rules.length, rulesVersion: core.rules().version, missing: missing().map(f => f.path), packs: Object.values(PACKS).map(p => ({ id: p.id, title: p.title, license: p.license })), config: loadConfig(), profile: loadProfile() ?? EMPTY_PROFILE, net: netStats() }; },
  async download({ big }) { await download(["ocr", "llm", ...(big ? ["llm-8b"] : [])], e => progress(`Загрузка ${e.file}: ${Math.round(e.done / e.total * 100)}%`)); return true; },
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
    setOffline(loadConfig().offline);
    port.postMessage({ id, result: await methods[method](args ?? {}) });
  } catch (err) { port.postMessage({ id, error: err?.message ?? String(err) }); }
});
