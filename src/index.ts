// Тендерный помощник — публичное API ядра
export * from "./types.js";
export { analyzeDocs, analyzeFiles, DISCLAIMER } from "./analyze/index.js";
export { extractRequirements, checkOffer, parseRequired } from "./analyze/requirements.js";
export { clarificationDraft, complaintDraft } from "./analyze/drafts.js";
export { extractFile, fromPlain } from "./docs/extract.js";
export { locate } from "./docs/quote.js";
export { fetchCard, cardDoc, parseCard, parseDocLinks, searchRss, parseRss } from "./eis.js";
export * from "./law/calc.js";
export { rules, searchRules, ref } from "./law/rules.js";
export { run, loadRun, listRuns } from "./pipeline.js";
export { contractPlan } from "./contract.js";
export { toHtml } from "./export/html.js";
export { toMarkdown, toIcs } from "./export/text.js";
export { VERSION } from "./version.js";
