/* Notification copy corrected in the PR #325 notification audit (HOMI workstream). [en, ka, ru, tr, ar, he].
 * Billing is PAYG only (10 Credits = $1): a failed payment is a failed top-up, never a plan
 * that has to renew. These keys already exist in the bundle (from homi-notify-i18n-data.mjs),
 * so this set must be spread AFTER HOMI_NOTIFY_STRINGS to replace them (the apply script
 * splices with overwrite). Informal Georgian, no dashes, no semicolons. */
export const NOTIFY_AUDIT_STRINGS = {
  notif_payment_failed_body: ['Your payment did not go through. Nothing was charged. You can try again.', 'გადახდა ვერ შესრულდა. თანხა არ ჩამოგეჭრათ. შეგიძლიათ სცადოთ ხელახლა.', 'Платёж не прошёл. Ничего не списано. Можно попробовать ещё раз.', 'Ödeme gerçekleşmedi. Ücret alınmadı. Tekrar deneyebilirsiniz.', 'لم تتم عملية الدفع. لم يُخصم أي مبلغ. يمكنك المحاولة مرة أخرى.', 'התשלום לא עבר. לא חויבתם. אפשר לנסות שוב.'],
};
