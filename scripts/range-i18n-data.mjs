// HOMATCH — the words an unknown or one-sided number needs.
//
// Order is [en, ka, ru, tr, ar, he].
//
// A missing bound used to be coerced to zero and formatted like a real one,
// so a buyer with a floor and no ceiling read "USD60,000-0". These are the
// three things a range can say instead of inventing a number it never had.

export const RANGE_STRINGS = {
  range_from: [
    'from {{value}}',
    '{{value}}-დან',
    'от {{value}}',
    '{{value}} ve üzeri',
    'من {{value}}',
    'מ-{{value}}',
  ],
  range_up_to: [
    'up to {{value}}',
    '{{value}}-მდე',
    'до {{value}}',
    '{{value}} kadar',
    'حتى {{value}}',
    'עד {{value}}',
  ],
  range_unknown: [
    'Not stated',
    'არ არის მითითებული',
    'Не указано',
    'Belirtilmemiş',
    'غير محدّد',
    'לא צוין',
  ],
};
