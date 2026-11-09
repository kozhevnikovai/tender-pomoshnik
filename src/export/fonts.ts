// Шрифты «Чертёж» (Geologica, Martian Mono) встраиваются в HTML — отчёт работает без интернета.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function fontFaces(): string {
  const CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116", LAT = "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-2193";
  const f: [string, string, string, number, string][] = [
    ["Geologica", "@fontsource/geologica", "geologica-cyrillic-400-normal.woff2", 400, CYR], ["Geologica", "@fontsource/geologica", "geologica-latin-400-normal.woff2", 400, LAT],
    ["Geologica", "@fontsource/geologica", "geologica-cyrillic-600-normal.woff2", 600, CYR], ["Geologica", "@fontsource/geologica", "geologica-latin-600-normal.woff2", 600, LAT],
    ["Martian Mono", "@fontsource/martian-mono", "martian-mono-cyrillic-400-normal.woff2", 400, CYR], ["Martian Mono", "@fontsource/martian-mono", "martian-mono-latin-400-normal.woff2", 400, LAT],
  ];
  return f.map(([fam, pkg, file, w, r]) => {
    try { return `@font-face{font-family:"${fam}";font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(require.resolve(`${pkg}/files/${file}`)).toString("base64")}) format("woff2");unicode-range:${r}}`; } catch { return ""; }
  }).join("\n");
}
