/*
 * Copy for the Verify market location hierarchy (P0, job 8ba97da9,
 * 2026-10-11): the finer reasons a comparable is shown
 * (src/verify/intelligence/comparableSelection.ts HIERARCHY_REASON_KEY).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * Not yet applied to src/i18n/translations.ts: the lead applies it with the
 * idempotent apply-script pattern.
 */
export const VERIFY_P0_MARKET_STRINGS = {
  cmp_reason_same_address: ['Same building address', 'იგივე მისამართი', 'Тот же адрес', 'Aynı bina adresi', 'عنوان المبنى نفسه', 'אותה כתובת בניין'],
  cmp_reason_street_branch: ['A lane off the same street', 'იგივე ქუჩის შესახვევი', 'Переулок той же улицы', 'Aynı sokağın ara sokağı', 'زقاق متفرع من الشارع نفسه', 'סמטה היוצאת מאותו רחוב'],
  cmp_reason_adjacent_district: ['Neighbouring area — background only', 'მეზობელი უბანი — მხოლოდ ფონისთვის', 'Соседний район — только для фона', 'Komşu semt — yalnızca arka plan', 'حي مجاور — للخلفية فقط', 'שכונה סמוכה — רקע בלבד'],
};
