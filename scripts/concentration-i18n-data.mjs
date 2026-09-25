/*
 * Copy for the admin source-concentration tab.
 *
 * The wording matters more than usual here. Every number on that screen has
 * a denominator that was actually counted, and none of them is a share of a
 * market — nobody knows how many properties are for sale in Tbilisi. So the
 * column is "share of held", not "coverage", in all six languages.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const CONCENTRATION_STRINGS = {
  admin_sources_tab_concentration: [
    'Concentration',
    'კონცენტრაცია',
    'Концентрация',
    'Yoğunlaşma',
    'التركّز',
    'ריכוזיות',
  ],
  admin_sources_concentration_note: [
    'Share of the observations Homatch holds — not of the market. "Only here" counts properties no other source reached.',
    'წილი Homatch-ის მიერ შენახულ დაკვირვებებში — არა ბაზარში. „მხოლოდ აქ" ითვლის ქონებას, რომელიც სხვა წყარომ ვერ იპოვა.',
    'Доля от наблюдений, которые хранит Homatch, — не от рынка. «Только здесь» считает объекты, которых не нашёл ни один другой источник.',
    'Homatch\'in elindeki gözlemlerdeki pay — pazardaki değil. "Yalnızca burada", başka hiçbir kaynağın ulaşmadığı mülkleri sayar.',
    'حصة من الملاحظات التي يحتفظ بها Homatch — وليست من السوق. «هنا فقط» تحسب العقارات التي لم يصل إليها أي مصدر آخر.',
    'חלק מתוך התצפיות ש-Homatch מחזיקה — לא מתוך השוק. "רק כאן" סופר נכסים ששום מקור אחר לא הגיע אליהם.',
  ],
  admin_sources_concentration_empty: [
    'No supply observations yet',
    'ჯერ არ არის მიწოდების დაკვირვებები',
    'Пока нет наблюдений предложения',
    'Henüz arz gözlemi yok',
    'لا توجد ملاحظات عرض بعد',
    'אין עדיין תצפיות היצע',
  ],
  admin_sources_family: [
    'Family',
    'ოჯახი',
    'Семейство',
    'Aile',
    'العائلة',
    'משפחה',
  ],
  admin_sources_lifecycle: [
    'Lifecycle',
    'სასიცოცხლო ციკლი',
    'Жизненный цикл',
    'Yaşam döngüsü',
    'دورة الحياة',
    'מחזור חיים',
  ],
  admin_sources_observations: [
    'Observations',
    'დაკვირვებები',
    'Наблюдения',
    'Gözlemler',
    'الملاحظات',
    'תצפיות',
  ],
  admin_sources_share_held: [
    'Share of held',
    'წილი შენახულში',
    'Доля от хранимого',
    'Elde tutulan pay',
    'حصة المحتفظ به',
    'חלק מהמוחזק',
  ],
  admin_sources_priced: [
    'With price',
    'ფასით',
    'С ценой',
    'Fiyatlı',
    'بسعر',
    'עם מחיר',
  ],
  admin_sources_only_here: [
    'Only here',
    'მხოლოდ აქ',
    'Только здесь',
    'Yalnızca burada',
    'هنا فقط',
    'רק כאן',
  ],
  admin_sources_provenance: [
    'Provenance',
    'წარმომავლობა',
    'Происхождение',
    'Köken',
    'المصدر',
    'מקור',
  ],
};
