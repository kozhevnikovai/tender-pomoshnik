// Иконка и обложка в стиле «Чертёж»: белый, тушь #161616, оранжевый сигнал ≤5 %
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
const F = "node_modules/@fontsource";
for (const w of [400, 600]) for (const s of ["cyrillic", "latin"]) GlobalFonts.registerFromPath(`${F}/geologica/files/geologica-${s}-${w}-normal.woff2`, "Geologica");
GlobalFonts.registerFromPath(`${F}/martian-mono/files/martian-mono-latin-400-normal.woff2`, "Martian Mono");

const INK = "#161616", SIG = "#FF5A1F", PEN = "#5C5C5C", AX = "#9C9C9C";

function mark(ctx, x, y, s) {
  // лист документа с загнутым углом, строки, галочка и сигнальная точка
  const lw = Math.max(2, s * 0.055);
  ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = "miter";
  const w = s * 0.62, h = s * 0.78, x0 = x + (s - w) / 2, y0 = y + (s - h) / 2, c = s * 0.16;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w - c, y0); ctx.lineTo(x0 + w, y0 + c); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0 + w - c, y0); ctx.lineTo(x0 + w - c, y0 + c); ctx.lineTo(x0 + w, y0 + c); ctx.stroke();
  ctx.lineWidth = lw * 0.6;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x0 + w * 0.16, y0 + h * (0.24 + i * 0.13)); ctx.lineTo(x0 + w * (i === 2 ? 0.55 : 0.72), y0 + h * (0.24 + i * 0.13)); ctx.stroke(); }
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.2, y0 + h * 0.74); ctx.lineTo(x0 + w * 0.38, y0 + h * 0.86); ctx.lineTo(x0 + w * 0.7, y0 + h * 0.6); ctx.stroke();
  ctx.fillStyle = SIG; ctx.beginPath(); ctx.arc(x0 + w * 0.84, y0 + h * 0.86, s * 0.055, 0, Math.PI * 2); ctx.fill();
}

function icon(size) {
  const cv = createCanvas(size, size), ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = size * 0.06; ctx.strokeStyle = INK; ctx.strokeRect(size * 0.03, size * 0.03, size * 0.94, size * 0.94);
  mark(ctx, size * 0.1, size * 0.1, size * 0.8);
  return cv.toBuffer("image/png");
}

function cover() {
  const W = 1280, H = 640, cv = createCanvas(W, H), ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.setLineDash([6, 6]); ctx.lineWidth = 1; ctx.strokeStyle = AX;
  ctx.beginPath(); ctx.moveTo(64, 470); ctx.lineTo(W - 64, 470); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = SIG; ctx.beginPath(); ctx.arc(72, 92, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PEN; ctx.font = "18px Geologica"; ctx.fillText("№ 004  ·  44-ФЗ  ·  223-ФЗ  ·  ДОКУМЕНТЫ НЕ ПОКИДАЮТ КОМПЬЮТЕР", 90, 99);
  ctx.fillStyle = INK; ctx.font = "600 76px Geologica"; ctx.fillText("Тендерный", 64, 210); ctx.fillText("помощник", 64, 292);
  ctx.fillStyle = PEN; ctx.font = "26px Geologica";
  ctx.fillText("Разбор госзакупки по номеру извещения:", 64, 360);
  ctx.fillText("требования, сроки, обеспечение, риски — с цитатами", 64, 396);
  ctx.fillText("из документов и ссылками на закон.", 64, 432);
  mark(ctx, 880, 90, 330);
  GlobalFonts;
  // штамп
  const cells = [["Разработчик", "kozhevnikovai"], ["Номер", "№ 004"], ["Ядро", "Windows · macOS"], ["Расширение", "Claude Desktop"], ["Лицензия", "MIT"]];
  const cw = (W - 48) / cells.length;
  ctx.lineWidth = 2; ctx.strokeStyle = INK;
  cells.forEach(([k, v], i) => {
    const x = 24 + i * cw; ctx.strokeRect(x, 520, cw, 96);
    ctx.fillStyle = PEN; ctx.font = "15px Geologica"; ctx.fillText(k, x + 18, 556);
    ctx.fillStyle = INK; ctx.font = /[А-Яа-я№]/.test(v) ? "20px Geologica" : "19px 'Martian Mono'"; ctx.fillText(v, x + 18, 592);
  });
  return cv.toBuffer("image/png");
}
mkdirSync("app/build", { recursive: true });
writeFileSync("app/build/icon.png", icon(1024));
writeFileSync("app/ui/icon.png", icon(256));
writeFileSync("docs/img/icon.png", icon(512));
writeFileSync("docs/img/cover.png", cover());
console.log("ok");
