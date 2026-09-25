/*
 * Copy for a result the campaign already paid for.
 *
 * WHAT THIS REPLACES
 *
 * A match carrying unlock_included_reservation_id costs zero credits to
 * reveal, because the Find Clients search that produced it was already paid
 * for. The interface still showed it blurred, behind a lock, under a button
 * reading "Unlock · 0.00 CR" — an offer to sell something at no price, which
 * reads either as a mistake or as a trick.
 *
 * So the copy here is not "unlock for free". It says the campaign covered
 * it, because that is what happened and it is the thing the customer paid
 * to be true.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const INCLUDED_UNLOCK_STRINGS = {
  /* A badge on the card. Short: it sits beside the score. */
  matches_included_badge: [
    'Included',
    'შედის',
    'Включено',
    'Dahil',
    'مشمول',
    'כלול',
  ],
  /* Replaces the lock hint under the excerpt. */
  matches_included_hint: [
    'Your campaign already paid for this result',
    'თქვენმა კამპანიამ უკვე გადაიხადა ამ შედეგისთვის',
    'Ваша кампания уже оплатила этот результат',
    'Kampanyanız bu sonucun ücretini zaten ödedi',
    'لقد دفعت حملتك بالفعل مقابل هذه النتيجة',
    'הקמפיין שלך כבר שילם עבור תוצאה זו',
  ],
  /* The action in place of the price. Opening it costs nothing. */
  matches_included_view_btn: [
    'View contact',
    'კონტაქტის ნახვა',
    'Посмотреть контакт',
    'İletişimi görüntüle',
    'عرض جهة الاتصال',
    'הצג איש קשר',
  ],
};
