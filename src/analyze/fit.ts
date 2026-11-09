// «Подходит ли нам»: профиль компании против требований закупки → можем / нельзя / нужно.
import { ref } from "../law/rules.js";
import { rub } from "../law/calc.js";
import type { CompanyProfile, FitItem, Law, Verdict } from "../types.js";
import type { flags as flagsFn } from "./fields.js";

type Flags = ReturnType<typeof flagsFn>;

export interface FitInput {
  law: Law | null;
  nmck: number | null;
  bidSecurity: number | null;
  contractSecurity: number | null;
  okpd2: string | null;
  place: string | null;
  flags: Flags;
  profile: CompanyProfile;
}

export function assessFit(i: FitInput): { items: FitItem[]; summary: Verdict } {
  const p = i.profile;
  const items: FitItem[] = [];
  const add = (requirement: string, verdict: Verdict, reason: string, extra: Partial<FitItem> = {}) => items.push({ requirement, verdict, reason, ...extra });

  if (i.flags.smpOnly) {
    add("Закупка только для СМП и СОНКО", p.msp ? "можем" : "нельзя", p.msp ? "Компания отмечена как субъект МСП — нужна декларация в заявке; проверьте запись в реестре МСП (ofd.nalog.ru)" : "Компании нет в реестре МСП по профилю — участвовать нельзя", { source: i.flags.smpOnly, law: [ref("44-30-1")] });
  }
  if (i.flags.license) {
    add("Лицензия", p.licenses.length ? "нужно" : "нельзя", p.licenses.length ? `Сверьте вид деятельности лицензии с объектом закупки: ${p.licenses.join("; ")}` : "В документах требуется лицензия, а в профиле лицензий нет", { source: i.flags.license, law: [ref("44-31")] });
  }
  if (i.flags.sro) {
    add("Членство в СРО", p.sro.length ? "нужно" : "нельзя", p.sro.length ? `Проверьте уровень ответственности и взнос СРО: ${p.sro.join("; ")}` : "Требуется членство в СРО, в профиле его нет", { source: i.flags.sro, law: [ref("44-31")] });
  }
  if (i.flags.experience) {
    const best = [...p.contracts].sort((a, b) => b.price - a.price)[0];
    add("Опыт исполнения контракта (доп. требования)", best ? "нужно" : "нельзя", best ? `Самый крупный контракт в профиле — ${rub(best.price)} (${best.finishedAt}). Сверьте с требованием к опыту в извещении` : "Требуется опыт, а исполненных контрактов в профиле нет", { source: i.flags.experience, law: [ref("44-31")] });
  }
  if (i.flags.ban || i.flags.limit) {
    const ru = p.products.filter(x => /росси|рф|еаэс|беларус|казах|армени|киргиз/i.test(x.country));
    const withReg = ru.filter(x => x.registry);
    const src = i.flags.ban ?? i.flags.limit;
    if (!p.products.length) add("Национальный режим (запрет/ограничение)", "нужно", "Укажите в профиле товары, страну происхождения и номера реестровых записей", { source: src, law: [ref("1875-mech"), ref("1875-proof")] });
    else add("Национальный режим (запрет/ограничение)", withReg.length ? "можем" : ru.length ? "нужно" : "нельзя", withReg.length ? `Есть товары с реестровыми записями: ${withReg.map(x => `${x.name} (${x.registry})`).join(", ")}` : ru.length ? "Товары российские, но без номера реестровой записи — без него заявку посчитают предложением иностранного товара" : "Товары в профиле иностранные — при запрете участвовать нельзя", { source: src, law: [ref("1875-mech"), ref("1875-proof")] });
  } else if (i.flags.pref) {
    add("Национальный режим (преимущество 15%)", "нужно", "Без подтверждения российского происхождения к вашей цене при оценке прибавят 15%", { source: i.flags.pref, law: [ref("1875-mech")] });
  }
  const sec = (i.bidSecurity ?? 0) + (i.contractSecurity ?? 0);
  if (p.maxSecurity != null && sec > 0) {
    add("Деньги под обеспечение", sec <= p.maxSecurity ? "можем" : "нужно", `Заявка + контракт: ${rub(sec)}, лимит компании ${rub(p.maxSecurity)}${sec > p.maxSecurity ? " — нужна банковская гарантия" : ""}`, { law: [ref("44-44-2"), ref("44-96-6")] });
  }
  if (i.place && p.regions.length) {
    const near = p.regions.some(r => i.place!.toLowerCase().includes(r.toLowerCase().slice(0, 6)));
    add("Регион поставки", near ? "можем" : "нужно", near ? `Регион в списке компании: ${i.place}` : `Поставка в «${i.place.slice(0, 80)}» — проверьте логистику`);
  }
  if (i.okpd2 && p.okved.length) {
    const ok = p.okved.some(o => o.slice(0, 2) === i.okpd2!.slice(0, 2));
    add("Профиль деятельности", ok ? "можем" : "нужно", ok ? `ОКВЭД компании совпадает с классом ОКПД2 ${i.okpd2}` : `Класс ОКПД2 ${i.okpd2} не совпадает с ОКВЭД ${p.okved.join(", ")}. Обычно это не причина отказа, но проверьте лицензируемые виды`);
  }
  const fair = p.contracts.filter(c => !c.penalties && Date.now() - Date.parse(c.finishedAt) < 3 * 365.25 * 864e5).length;
  if (i.law === "44-ФЗ") add("Антидемпинг: подтверждение добросовестности", fair >= 3 ? "можем" : "нужно", fair >= 3 ? `${fair} контракта за 3 года без неустоек — при снижении ≥25% и НМЦК ≤ 15 млн ₽ можно не вносить полуторное обеспечение` : `Контрактов без неустоек за 3 года: ${fair} из 3 — при снижении ≥25% понадобится полуторное обеспечение`, { law: [ref("44-37-2")] });
  if (i.law === "44-ФЗ") add("Единые требования (ст. 31)", "нужно", "Декларируются в заявке: нет в РНП, нет ликвидации и банкротства, нет недоимок и конфликта интересов. Проверьте себя перед подачей", { law: [ref("44-31")] });

  const summary: Verdict = items.some(x => x.verdict === "нельзя") ? "нельзя" : items.some(x => x.verdict === "нужно") ? "нужно" : "можем";
  return { items, summary };
}
