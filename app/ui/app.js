// Интерфейс Тендерного помощника. Вся работа — в фоновом процессе через window.tp.core.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let files = [], current = null, state = null;

document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll("main section").forEach(s => s.classList.toggle("hidden", s.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === "archive") loadArchive();
  if (b.dataset.tab === "monitor") renderQueries();
});

tp.on("progress", m => { $("progress").textContent = `· ${m.stage}`; $("m-msg").textContent = `· ${m.stage}`; });
tp.on("net", m => { $("netInfo").textContent = `в облако: ${m.sentBytes} байт`; $("net").classList.toggle("sent", m.sentBytes > 0); });

// Файлы
const showFiles = () => { $("files").textContent = files.map(f => f.split(/[\\/]/).pop()).join(" · "); };
$("pick").onclick = async e => { e.preventDefault(); files = [...files, ...await tp.pickFiles()]; showFiles(); };
const drop = $("drop");
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); files = [...files, ...[...e.dataTransfer.files].map(f => tp.pathOf(f))]; showFiles(); };

window.showReport = r => {
  current = r;
  $("result").classList.remove("hidden");
  $("report").src = "file://" + r.files.html.replace(/\\/g, "/");
};

$("go").onclick = async () => {
  const reg = $("reg").value.replace(/\D/g, "");
  $("err").textContent = "";
  if (!reg && !files.length) return ($("err").textContent = "Введите номер извещения или добавьте файлы");
  if (reg && !/^\d{11}$|^\d{19}$/.test(reg)) return ($("err").textContent = "Номер извещения — 19 цифр (44-ФЗ) или 11 цифр (223-ФЗ)");
  $("go").disabled = true;
  try { showReport(await tp.core("analyze", { regNumber: reg || undefined, files, ocr: $("ocr").checked })); $("progress").textContent = "Готово"; }
  catch (e) { $("err").textContent = e.message.replace(/^Error invoking remote method 'core': Error: /, ""); }
  finally { $("go").disabled = false; }
};
document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => current && tp.open(b.dataset.open === "dir" ? current.dir : current.files[b.dataset.open]));
document.querySelectorAll("[data-send]").forEach(b => b.onclick = async () => {
  if (!current) return;
  try { await tp.core("send", { id: current.dir, target: b.dataset.send }); $("progress").textContent = `Отправлено: ${b.textContent}`; }
  catch (e) { $("err").textContent = e.message.replace(/^Error invoking remote method 'core': Error: /, ""); }
});

// Профиль
const lines = s => s.split("\n").map(x => x.trim()).filter(Boolean);
const csv = s => s.split(",").map(x => x.trim()).filter(Boolean);
function fillProfile(p) {
  $("p-name").value = p.name ?? ""; $("p-inn").value = p.inn ?? ""; $("p-okved").value = (p.okved ?? []).join(", "); $("p-regions").value = (p.regions ?? []).join(", ");
  $("p-sec").value = p.maxSecurity ?? ""; $("p-msp").checked = !!p.msp; $("p-lic").value = (p.licenses ?? []).join("\n"); $("p-sro").value = (p.sro ?? []).join("\n");
  $("p-contracts").value = (p.contracts ?? []).map(c => [c.price, c.finishedAt, c.penalties ? "да" : "нет", c.subject ?? ""].join("; ")).join("\n");
  $("p-products").value = (p.products ?? []).map(x => [x.name, x.country, x.registry ?? ""].join("; ")).join("\n");
}
$("p-save").onclick = async () => {
  const profile = {
    name: $("p-name").value.trim(), inn: $("p-inn").value.trim() || undefined, okved: csv($("p-okved").value), regions: csv($("p-regions").value), msp: $("p-msp").checked,
    maxSecurity: $("p-sec").value ? +$("p-sec").value : undefined, licenses: lines($("p-lic").value), sro: lines($("p-sro").value),
    contracts: lines($("p-contracts").value).map(l => { const [price, finishedAt, pen, subject] = l.split(";").map(x => x.trim()); return { price: +price.replace(/\s/g, ""), finishedAt, penalties: /да/i.test(pen ?? ""), subject }; }).filter(c => c.price > 0),
    products: lines($("p-products").value).map(l => { const [name, country, registry] = l.split(";").map(x => x.trim()); return { name, country: country ?? "", registry: registry || undefined }; }),
  };
  await tp.core("saveProfile", { profile });
  $("p-msg").textContent = "Профиль сохранён";
};

// Мониторинг
function renderQueries() {
  const q = state?.config.monitor.queries ?? [];
  $("m-queries").innerHTML = q.map((x, i) => `<div><span>${esc(x.text)}${x.minus?.length ? ` <small>−${esc(x.minus.join(", "))}</small>` : ""}${x.priceTo ? ` <small>до ${x.priceTo} ₽</small>` : ""}</span><button class="ghost" data-del="${i}">Удалить</button></div>`).join("") || "<div><small>Запросов пока нет</small></div>";
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { q.splice(+b.dataset.del, 1); state.config = await tp.core("saveConfig", { patch: { monitor: { ...state.config.monitor, queries: q } } }); renderQueries(); });
}
$("m-add").onclick = async () => {
  const text = $("m-text").value.trim(); if (!text) return;
  const q = [...state.config.monitor.queries, { text, minus: csv($("m-minus").value), priceFrom: +$("m-from").value || undefined, priceTo: +$("m-to").value || undefined }];
  state.config = await tp.core("saveConfig", { patch: { monitor: { ...state.config.monitor, queries: q } } });
  $("m-text").value = ""; renderQueries();
};
$("m-run").onclick = async () => {
  $("m-msg").textContent = "· проверяю ЕИС…";
  try {
    const r = await tp.core("monitor", { notify: $("m-notify").checked });
    $("m-msg").textContent = `Новых: ${r.found.length}, отсеяно: ${r.skipped.length}`;
    $("m-found").innerHTML = r.found.map(x => `<div><span>${esc(x.title)}<br><small>${esc(x.regNumber)}</small></span><button class="ghost" data-reg="${esc(x.regNumber)}">Разобрать</button></div>`).join("");
    document.querySelectorAll("[data-reg]").forEach(b => b.onclick = () => { $("reg").value = b.dataset.reg; document.querySelector('[data-tab="tender"]').click(); $("go").click(); });
  } catch (e) { $("m-msg").textContent = e.message.replace(/^Error invoking remote method 'core': Error: /, ""); }
};

// Архив
async function loadArchive() {
  const list = await tp.core("list", {});
  $("archive").innerHTML = list.map(x => `<div><span>${esc(x.title ?? x.id)}<br><small>${esc(x.id)} · ${esc(x.createdAt.slice(0, 10))}</small></span><button class="ghost" data-id="${esc(x.id)}">Открыть</button></div>`).join("") || "<div><small>Пока пусто</small></div>";
  document.querySelectorAll("[data-id]").forEach(b => b.onclick = async () => { showReport(await tp.core("open", { id: b.dataset.id })); document.querySelector('[data-tab="tender"]').click(); });
}

// Настройки
function fillSettings(c) {
  $("s-offline").checked = c.offline; $("s-provider").value = c.llm.provider ?? "local"; $("s-key").value = c.llm.apiKey ?? ""; $("s-model").value = c.llm.model ?? c.llm.baseUrl ?? "";
  $("s-tg-token").value = c.telegram?.botToken ?? ""; $("s-tg-chat").value = c.telegram?.chatId ?? ""; $("s-b24").value = c.bitrix24?.webhook ?? "";
  $("s-smtp").value = c.email ? `${c.email.host}:${c.email.port}` : ""; $("s-mail-user").value = c.email?.user ?? ""; $("s-mail-pass").value = c.email?.pass ?? ""; $("s-mail-to").value = c.email?.to ?? ""; $("s-out").value = c.outputDir;
}
$("s-save").onclick = async () => {
  const [host, port] = $("s-smtp").value.split(":");
  const provider = $("s-provider").value, m = $("s-model").value.trim();
  const patch = {
    offline: $("s-offline").checked, outputDir: $("s-out").value.trim(),
    llm: { provider, apiKey: $("s-key").value.trim() || undefined, ...(provider === "openai" ? { baseUrl: m.startsWith("http") ? m : undefined, model: m.startsWith("http") ? undefined : m } : { model: m || undefined }) },
    telegram: $("s-tg-token").value ? { botToken: $("s-tg-token").value.trim(), chatId: $("s-tg-chat").value.trim() } : undefined,
    bitrix24: $("s-b24").value ? { webhook: $("s-b24").value.trim() } : undefined,
    email: host ? { host, port: +port || 465, user: $("s-mail-user").value.trim(), pass: $("s-mail-pass").value, to: $("s-mail-to").value.trim() } : undefined,
  };
  state.config = await tp.core("saveConfig", { patch });
  $("s-msg").textContent = "Сохранено";
};
const dl = big => async () => { $("s-msg").textContent = "· загрузка…"; try { await tp.core("download", { big }); $("s-msg").textContent = "Модели скачаны"; } catch (e) { $("s-msg").textContent = e.message; } };
$("s-models").onclick = dl(false); $("s-models8").onclick = dl(true);

(async () => {
  state = await tp.core("status", {});
  fillProfile(state.profile); fillSettings(state.config);
  $("s-about").textContent = `Версия ${state.version} · база норм ${state.rulesVersion}, карточек: ${state.rules} · MIT · github.com/kozhevnikovai/tender-pomoshnik`;
})();
