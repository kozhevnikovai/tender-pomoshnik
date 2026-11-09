// Расчёты по 44-ФЗ: обеспечение заявки и контракта, антидемпинг, неустойки, маржа.
// Каждое число сопровождается формулой и ссылкой на норму. Для 223-ФЗ — только с оговоркой.
import type { Calc, Law, Procedure } from "../types.js";
import { ref, rule } from "./rules.js";

export const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
const pct = (n: number) => `${String(+n.toFixed(2)).replace(".", ",")}%`;

/** Допустимый диапазон обеспечения заявки по ч. 2 ст. 44 */
export function bidSecurityRange(nmck: number) {
  const bands = rule("44-44-2").params.bands as { upTo: number | null; min: number; max: number }[];
  const b = bands.find(x => x.upTo == null || nmck <= x.upTo)!;
  return { min: b.min, max: b.max, mandatory: nmck > rule("44-44-1").params.mandatoryAbove };
}

export function bidSecurity(nmck: number, percent: number | null): Calc {
  const r = bidSecurityRange(nmck);
  if (percent == null) {
    return { label: "Обеспечение заявки", value: r.mandatory ? `обязательно, ${pct(r.min)}–${pct(r.max)} НМЦК: ${rub(nmck * r.min / 100)}–${rub(nmck * r.max / 100)}` : "заказчик вправе не требовать (НМЦК ≤ 1 млн ₽)", formula: "НМЦК × процент из извещения", law: [ref("44-44-1"), ref("44-44-2")], status: "check" };
  }
  const ok = percent >= r.min && percent <= r.max;
  return { label: "Обеспечение заявки", value: `${rub(nmck * percent / 100)} (${pct(percent)} НМЦК)`, formula: `${rub(nmck)} × ${pct(percent)}`, law: [ref("44-44-2")], status: ok ? "ok" : "check" };
}

export function contractSecurity(price: number, percent: number, advance = 0): Calc {
  let v = price * percent / 100;
  let formula = `${rub(price)} × ${pct(percent)}`;
  if (advance > v) { formula += `; не меньше аванса ${rub(advance)}`; v = advance; }
  return { label: "Обеспечение исполнения контракта", value: rub(v), formula, law: [ref("44-96-6"), ref("44-96-6-base")], status: "check" };
}

export interface DumpingInput { law: Law | null; procedure: Procedure | null; nmck: number; price: number; securityPercent: number | null }

/** Антидемпинг по ст. 37: включается при снижении на 25% и более в аукционе или конкурсе */
export function antidumping(i: DumpingInput): Calc {
  const scope = rule("44-37-scope").params;
  const drop = (1 - i.price / i.nmck) * 100;
  const law = [ref("44-37-scope")];
  if (i.law === "223-ФЗ") return { label: "Антидемпинг", value: "по 223-ФЗ — по положению о закупке заказчика", formula: `снижение ${pct(drop)}`, law: [ref("223-polozhenie")], status: "check" };
  if (drop < scope.threshold) return { label: "Антидемпинг", value: `не применяется: снижение ${pct(drop)} < ${scope.threshold}%`, formula: `(1 − ${rub(i.price)} / ${rub(i.nmck)}) × 100%`, law, status: "ok" };
  if (i.procedure && !scope.procedures.includes(i.procedure)) return { label: "Антидемпинг", value: `снижение ${pct(drop)}, но в процедуре «${i.procedure}» ст. 37 не применяется`, formula: "", law, status: "ok" };
  const base = i.securityPercent != null ? i.price * i.securityPercent / 100 : null;
  const big = i.nmck > rule("44-37-1").params.above;
  if (big) {
    return { label: "Антидемпинг", value: base != null ? `полуторное обеспечение: ${rub(base * 1.5)}; аванса не будет` : "полуторное обеспечение контракта; аванса не будет", formula: base != null ? `${rub(base)} × 1,5` : "обеспечение × 1,5", law: [...law, ref("44-37-1"), ref("44-37-avans")], status: "ok" };
  }
  if (i.securityPercent == null) {
    return { label: "Антидемпинг", value: "в извещении нет обеспечения контракта — подтвердите добросовестность: 3 контракта за 3 года без неустоек; аванса не будет", formula: `снижение ${pct(drop)}`, law: [...law, ref("44-37-484"), ref("44-37-avans")], status: "check" };
  }
  return { label: "Антидемпинг", value: `на выбор: полуторное обеспечение ${rub(base! * 1.5)} или обычное ${rub(base!)} + 3 контракта за 3 года без неустоек; аванса не будет`, formula: `${rub(base!)} × 1,5`, law: [...law, ref("44-37-2"), ref("44-37-avans")], status: "ok" };
}

/** Штраф поставщика по п. 3–4 Правил № 1042 */
export function supplierFine(price: number, smpOnly: boolean): Calc {
  if (smpOnly) {
    const p = rule("1042-4").params;
    const v = Math.min(p.max, Math.max(p.min, price * p.pct / 100));
    return { label: "Штраф поставщика (СМП)", value: rub(v), formula: `1% × ${rub(price)}, в пределах 1 000–5 000 ₽`, law: [ref("1042-4")], status: "ok" };
  }
  const bands = rule("1042-3").params.bands as { upTo: number; pct: number }[];
  const b = bands.find(x => price <= x.upTo);
  if (!b) return { label: "Штраф поставщика", value: "для контрактов дороже 100 млн ₽ — проверить п. 3 Правил", formula: "", law: [ref("1042-3")], status: "check" };
  return { label: "Штраф поставщика", value: `${rub(price * b.pct / 100)} (${pct(b.pct)})`, formula: `${rub(price)} × ${pct(b.pct)}`, law: [ref("1042-3")], status: "ok" };
}

/** Пеня за день просрочки по ч. 7 ст. 34 */
export function dailyPenalty(price: number, done: number, keyRate: number): Calc {
  const v = (price - done) * keyRate / 100 / rule("44-34-7").params.fraction;
  return { label: "Пеня за 1 день просрочки", value: rub(v), formula: `(${rub(price)} − ${rub(done)}) × ${pct(keyRate)} / 300`, law: [ref("44-34-7")], status: keyRate > 0 ? "ok" : "check" };
}

export interface MarginInput { price: number; cost: number; bidSecurity: number; contractSecurity: number; guaranteeFeePct?: number; days?: number; vatIncluded?: boolean }

/** Маржа с учётом стоимости денег под обеспечение (банковская гарантия) */
export function margin(m: MarginInput): Calc {
  const fee = ((m.guaranteeFeePct ?? 0) / 100) * (m.contractSecurity) * ((m.days ?? 60) / 365);
  const profit = m.price - m.cost - fee;
  return { label: "Маржа", value: `${rub(profit)} (${pct(profit / m.price * 100)})`, formula: `${rub(m.price)} − себестоимость ${rub(m.cost)} − стоимость гарантии ${rub(fee)}`, law: [], status: "ok" };
}

/** Минимальная цена, ниже которой включится антидемпинг */
export function dumpingThreshold(nmck: number) {
  return nmck * (1 - rule("44-37-scope").params.threshold / 100);
}
