// Мост между интерфейсом и главным процессом: только перечисленные методы, без доступа к Node.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("tp", {
  core: (method, args) => ipcRenderer.invoke("core", method, args),
  pickFiles: () => ipcRenderer.invoke("pick-files"),
  pickDir: () => ipcRenderer.invoke("pick-dir"),
  open: p => ipcRenderer.invoke("open", p),
  openUrl: u => ipcRenderer.invoke("open-url", u),
  pathOf: file => webUtils.getPathForFile(file),
  version: () => ipcRenderer.invoke("version"),
  on: (ch, fn) => { if (["progress", "net", "auto-monitor", "goto"].includes(ch)) ipcRenderer.on(ch, (_e, m) => fn(m)); },
});
