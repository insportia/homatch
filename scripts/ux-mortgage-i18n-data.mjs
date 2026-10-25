// UX MORTGAGE workstream copy: the glossary term pages, multi-currency entry,
// the "my mortgages" flow and the questionnaire option cards.
//
// The long copy lives one language per file in scripts/ux-mortgage-i18n/,
// all with exactly the same keys, so each language can be reviewed on its
// own. Here they are zipped into the shared [en, ka, ru, tr, ar, he] shape
// that scripts/lib/i18nSplice.mjs validates and splices.
import { EN } from './ux-mortgage-i18n/en.mjs';
import { KA } from './ux-mortgage-i18n/ka.mjs';
import { RU } from './ux-mortgage-i18n/ru.mjs';
import { TR } from './ux-mortgage-i18n/tr.mjs';
import { AR } from './ux-mortgage-i18n/ar.mjs';
import { HE } from './ux-mortgage-i18n/he.mjs';

const BUNDLES = [EN, KA, RU, TR, AR, HE];

/** Short strings added after the long files, written as six-language rows. */
const EXTRA = {
  mortgage_tp_live_title: ['The limits today', 'ლიმიტები დღეს', 'Лимиты сегодня', 'Bugünkü limitler', 'الحدود اليوم', 'המגבלות היום'],
  mortgage_tp_live_gel: ['Loan in lari', 'სესხი ლარში', 'Кредит в лари', 'Lari cinsinden kredi', 'قرض باللاري', 'הלוואה בלארי'],
  mortgage_tp_live_fx: ['Loan in foreign currency', 'სესხი უცხოურ ვალუტაში', 'Кредит в иностранной валюте', 'Döviz cinsinden kredi', 'قرض بعملة أجنبية', 'הלוואה במטבע חוץ'],
  mortgage_tp_live_income_below: ['income under {{amount}} lari', 'შემოსავალი {{amount}} ლარამდე', 'доход до {{amount}} лари', 'gelir {{amount}} larinin altında', 'دخل أقل من {{amount}} لاري', 'הכנסה מתחת ל־{{amount}} לארי'],
  mortgage_tp_live_income_above: ['income {{amount}} lari or more', 'შემოსავალი {{amount}} ლარი ან მეტი', 'доход от {{amount}} лари', 'gelir {{amount}} lari veya üzeri', 'دخل {{amount}} لاري أو أكثر', 'הכנסה של {{amount}} לארי ומעלה'],
  mortgage_tp_live_any_income: ['any income', 'ნებისმიერი შემოსავალი', 'любой доход', 'her gelir', 'أي دخل', 'כל הכנסה'],
};

function zip() {
  const out = {};
  for (const key of Object.keys(EN)) {
    out[key] = BUNDLES.map((bundle, i) => {
      if (!(key in bundle)) throw new Error(`ux-mortgage: ${key} missing in bundle #${i}`);
      return bundle[key];
    });
  }
  for (const bundle of BUNDLES) {
    for (const key of Object.keys(bundle)) if (!(key in EN)) throw new Error(`ux-mortgage: ${key} is not in the English master`);
  }
  return { ...out, ...EXTRA };
}

export const UX_MORTGAGE_STRINGS = zip();
