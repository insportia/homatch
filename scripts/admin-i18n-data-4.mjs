// HOMATCH Admin copy, part 4 — the consequence, in the reader's language.
//
// Order is [en, ka, ru, tr, ar, he].
//
// WHY THESE EXIST AT ALL
//
// comm-provider-status writes its diagnostics in English and names
// environment variables inside them — "META_WHATSAPP_APP_SECRET is
// unset, so an inbound WhatsApp delivery cannot be verified and is
// refused." That is exactly right for the person who has to go and set
// one, and exactly wrong as the first thing a Georgian reader meets.
//
// These sentences are derived from the SAME readiness verdict, not a
// second opinion about it: `ready` is true or it is not, and there are
// two sentences. The provider's own words stay on the page, unchanged,
// under a heading that says whose words they are.

export const ADMIN_STRINGS_4 = {
  wa_status_ready: [
    'Homatch can message people on WhatsApp.',
    'Homatch-ს WhatsApp-ით ადამიანებისთვის მიწერა შეუძლია.',
    'Homatch может писать людям в WhatsApp.',
    'Homatch, WhatsApp üzerinden mesaj gönderebiliyor.',
    'يستطيع Homatch مراسلة الناس عبر واتساب.',
    'Homatch יכול לשלוח הודעות לאנשים בוואטסאפ.',
  ],
  wa_status_blocked: [
    'Homatch cannot message people on WhatsApp yet.',
    'Homatch-ს ჯერ არ შეუძლია WhatsApp-ით ადამიანებისთვის მიწერა.',
    'Homatch пока не может писать людям в WhatsApp.',
    'Homatch henüz WhatsApp üzerinden mesaj gönderemiyor.',
    'لا يستطيع Homatch بعد مراسلة الناس عبر واتساب.',
    'Homatch עדיין אינו יכול לשלוח הודעות בוואטסאפ.',
  ],
  cc_status_ready: [
    'Homatch can make and answer phone calls.',
    'Homatch-ს ზარების განხორციელება და პასუხი შეუძლია.',
    'Homatch может звонить и отвечать на звонки.',
    'Homatch telefon araması yapabiliyor ve yanıtlayabiliyor.',
    'يستطيع Homatch إجراء المكالمات والرد عليها.',
    'Homatch יכול לבצע שיחות ולענות להן.',
  ],
  cc_status_blocked: [
    'Homatch cannot make phone calls yet.',
    'Homatch-ს ჯერ არ შეუძლია ზარების განხორციელება.',
    'Homatch пока не может звонить.',
    'Homatch henüz telefon araması yapamıyor.',
    'لا يستطيع Homatch بعد إجراء المكالمات.',
    'Homatch עדיין אינו יכול לבצע שיחות.',
  ],
  admin_provider_says: [
    'What the provider reported',
    'რას იუწყება მომწოდებელი',
    'Что сообщает поставщик',
    'Sağlayıcının bildirdiği',
    'ما أبلغ عنه المزوّد',
    'מה שהספק דיווח',
  ],
};
