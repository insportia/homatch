/* Notification copy corrected in the PR #325 notification audit (HOMI workstream). [en, ka, ru, tr, ar, he].
 * Billing is PAYG only (10 Credits = $1): a failed payment is a failed top-up, never a plan
 * that has to renew. These keys already exist in the bundle (from homi-notify-i18n-data.mjs),
 * so this set must be spread AFTER HOMI_NOTIFY_STRINGS to replace them (the apply script
 * splices with overwrite). Informal Georgian, no dashes, no semicolons. */
export const NOTIFY_AUDIT_STRINGS = {
  notif_payment_failed_body: [
    'Your top-up did not go through. No Credits were added. You can try again.',
    'ბალანსის შევსება ვერ შესრულდა. კრედიტები არ დაგერიცხა. შეგიძლია ხელახლა სცადო.',
    'Пополнение не прошло. Кредиты не начислены. Можно попробовать снова.',
    'Bakiye yüklemen gerçekleşmedi. Kredi eklenmedi. Tekrar deneyebilirsin.',
    'لم تكتمل عملية شحن الرصيد. لم تتم إضافة أي أرصدة. يمكنك المحاولة مرة أخرى.',
    'טעינת היתרה לא הושלמה. לא נוספו קרדיטים. אפשר לנסות שוב.',
  ],
};
