/*
 * Copy for the per-result freshness note on the customer's matches screen.
 *
 * The backend has carried matches.evidence_freshness since the seven-day rule
 * was wired -- NEW_UNVERIFIED, NEEDS_REVALIDATION, FRESH, UNVERIFIABLE -- and
 * the screen showed none of it, so a customer whose search returned fewer
 * results because 106 profiles were awaiting re-checking had no way to know
 * that was why.
 *
 * THREE RULES THESE STRINGS FOLLOW.
 *
 * No enum reaches the customer. NEW_UNVERIFIED is our word.
 *
 * No percentage. There is no measured number behind "80% fresh", so there is
 * no honest way to print one.
 *
 * No promise. "Being re-checked" is true and says nothing about the outcome;
 * "will be confirmed shortly" would be a claim about a fetch that has not
 * happened.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const FRESHNESS_UX_STRINGS = {
  matches_freshness_new: [
    'Just found',
    'ახლად ნაპოვნი',
    'Только что найдено',
    'Yeni bulundu',
    'تم العثور عليه للتو',
    'נמצא כרגע',
  ],
  matches_freshness_rechecking: [
    'Being re-checked',
    'ხელახლა მოწმდება',
    'Проверяется повторно',
    'Yeniden kontrol ediliyor',
    'قيد إعادة التحقق',
    'נבדק מחדש',
  ],
  matches_freshness_verified: [
    'Recently verified',
    'ბოლოს დადასტურებული',
    'Недавно подтверждено',
    'Kısa süre önce doğrulandı',
    'تم التحقق مؤخرًا',
    'אומת לאחרונה',
  ],
  matches_freshness_unconfirmed: [
    'Could not be re-checked',
    'ვერ შემოწმდა ხელახლა',
    'Не удалось перепроверить',
    'Yeniden kontrol edilemedi',
    'لم يتمكن من إعادة التحقق',
    'לא ניתן היה לבדוק מחדש',
  ],
};
