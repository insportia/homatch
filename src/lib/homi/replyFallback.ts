/*
 * SUGGESTED REPLIES, EVERY TIME.
 *
 * The owner wants the conversation to be clickable after EVERY answer, so a
 * person rarely has to type. The model is asked for three or four likely
 * replies; when it returns fewer than two (or the block is malformed), the
 * server fills in this deterministic, code-owned set instead, chosen by the
 * service the turn is about. They are the PERSON's words, never navigation,
 * and they go through the same validator as the model's.
 *
 * Pure and runtime-neutral.
 */

import { pick, type L6 } from './content.ts';
import { parseSuggestedReplies, type SuggestedReply } from '../ai/suggestedReplies.ts';
import type { ServiceActionId } from '../ai/serviceActions.ts';
import { ALL_VISIBLE, filterReplies, type ServiceVisibility } from './serviceVisibility.ts';

const l = (ka: string, en: string, ru: string, tr: string, ar: string, he: string): L6 => ({ ka, en, ru, tr, ar, he });

const GENERIC: L6[] = [
  l('უფრო მარტივად ამიხსენი', 'Explain it more simply', 'Объясни проще', 'Daha basit anlat', 'اشرحها ببساطة أكثر', 'תסביר יותר פשוט'),
  l('მაგალითით მაჩვენე', 'Show me an example', 'Покажи на примере', 'Bir örnekle göster', 'أرني مثالًا', 'תן לי דוגמה'),
  l('შემდეგი ნაბიჯი რა არის?', 'What is the next step?', 'Какой следующий шаг?', 'Sonraki adım ne?', 'ما الخطوة التالية؟', 'מה הצעד הבא?'),
  l('გასაგებია, მადლობა', 'Got it, thanks', 'Понятно, спасибо', 'Anladım, teşekkürler', 'فهمت، شكرًا', 'הבנתי, תודה'),
];

const BY_SERVICE: Partial<Record<ServiceActionId, L6[]>> = {
  FIND_PROPERTY: [
    l('თბილისში ვეძებ', 'In Tbilisi', 'В Тбилиси', 'Tiflis’te', 'في تبليسي', 'בטביליסי'),
    l('ბათუმში ვეძებ', 'In Batumi', 'В Батуми', 'Batum’da', 'في باتومي', 'בבטומי'),
    l('ქირით მინდა', 'I want to rent', 'Хочу снять', 'Kiralamak istiyorum', 'أريد الاستئجار', 'אני רוצה לשכור'),
    l('ყიდვა მინდა', 'I want to buy', 'Хочу купить', 'Satın almak istiyorum', 'أريد الشراء', 'אני רוצה לקנות'),
  ],
  FIND_BUYERS_TENANTS: [
    l('გაყიდვა მინდა', 'I want to sell', 'Хочу продать', 'Satmak istiyorum', 'أريد البيع', 'אני רוצה למכור'),
    l('გაქირავება მინდა', 'I want to rent it out', 'Хочу сдать', 'Kiraya vermek istiyorum', 'أريد التأجير', 'אני רוצה להשכיר'),
    l('როგორ მუშაობს?', 'How does it work?', 'Как это работает?', 'Nasıl çalışıyor?', 'كيف يعمل؟', 'איך זה עובד?'),
    l('რა მჭირდება დასაწყებად?', 'What do I need to start?', 'Что нужно для начала?', 'Başlamak için ne gerekli?', 'ماذا أحتاج للبدء؟', 'מה צריך כדי להתחיל?'),
  ],
  VERIFY: [
    l('რას ამოწმებს?', 'What does it check?', 'Что проверяется?', 'Neyi kontrol ediyor?', 'ماذا يفحص؟', 'מה זה בודק?'),
    l('საკადასტრო კოდი მაქვს', 'I have the cadastral code', 'У меня есть кадастровый код', 'Kadastro kodum var', 'لدي الرمز العقاري', 'יש לי את מספר הקדסטר'),
    l('მხოლოდ მისამართი ვიცი', 'I only know the address', 'Знаю только адрес', 'Sadece adresi biliyorum', 'أعرف العنوان فقط', 'אני יודע רק את הכתובת'),
    l('რამდენ ხანს გრძელდება?', 'How long does it take?', 'Сколько это занимает?', 'Ne kadar sürer?', 'كم يستغرق؟', 'כמה זמן זה לוקח?'),
  ],
  MORTGAGE: [
    l('ყოველთვიური შენატანი დამითვალე', 'Work out my monthly payment', 'Посчитай ежемесячный платёж', 'Aylık taksitimi hesapla', 'احسب قسطي الشهري', 'חשב לי את ההחזר החודשי'),
    l('რა დოკუმენტები მჭირდება?', 'Which documents do I need?', 'Какие документы нужны?', 'Hangi belgeler gerekli?', 'ما المستندات المطلوبة؟', 'אילו מסמכים צריך?'),
    l('რამდენი უნდა იყოს პირველადი შენატანი?', 'How big a down payment?', 'Какой нужен первый взнос?', 'Peşinat ne kadar olmalı?', 'كم يجب أن تكون الدفعة الأولى؟', 'כמה הון עצמי צריך?'),
    l('გასაგებია, მადლობა', 'Got it, thanks', 'Понятно, спасибо', 'Anladım, teşekkürler', 'فهمت، شكرًا', 'הבנתי, תודה'),
  ],
  CONTRACT_INTELLIGENCE: [
    l('რას მივაქციო ყურადღება?', 'What should I watch for?', 'На что обратить внимание?', 'Neye dikkat etmeliyim?', 'ما الذي يجب أن أنتبه له؟', 'למה לשים לב?'),
    l('ხელშეკრულება მაქვს, ავტვირთავ', 'I have the contract to upload', 'У меня есть договор, загружу', 'Sözleşmem var, yükleyeceğim', 'لدي العقد وسأرفعه', 'יש לי חוזה להעלות'),
    l('რა რისკებია?', 'What are the risks?', 'Какие есть риски?', 'Riskler neler?', 'ما المخاطر؟', 'מה הסיכונים?'),
    l('გასაგებია, მადლობა', 'Got it, thanks', 'Понятно, спасибо', 'Anladım, teşekkürler', 'فهمت، شكرًا', 'הבנתי, תודה'),
  ],
  INVESTMENT: [
    l('გაქირავებით რამდენს მივიღებ?', 'What would renting it out bring?', 'Сколько принесёт аренда?', 'Kira ne kadar getirir?', 'كم سيدر الإيجار؟', 'כמה תכניס השכרה?'),
    l('რისკები რა არის?', 'What are the risks?', 'Какие риски?', 'Riskler neler?', 'ما المخاطر؟', 'מה הסיכונים?'),
    l('რომელი უბანი ჯობია?', 'Which district is better?', 'Какой район лучше?', 'Hangi semt daha iyi?', 'أي حي أفضل؟', 'איזו שכונה עדיפה?'),
    l('გასაგებია, მადლობა', 'Got it, thanks', 'Понятно, спасибо', 'Anladım, teşekkürler', 'فهمت، شكرًا', 'הבנתי, תודה'),
  ],
  FOR_EXPATS: [
    l('საიდან დავიწყო?', 'Where do I start?', 'С чего начать?', 'Nereden başlamalıyım?', 'من أين أبدأ؟', 'מאיפה להתחיל?'),
    l('ბინის ქირაობა მინდა', 'I want to rent a flat', 'Хочу снять квартиру', 'Daire kiralamak istiyorum', 'أريد استئجار شقة', 'אני רוצה לשכור דירה'),
    l('ბინის ყიდვა მინდა', 'I want to buy a flat', 'Хочу купить квартиру', 'Daire almak istiyorum', 'أريد شراء شقة', 'אני רוצה לקנות דירה'),
    l('ბინადრობის ნებართვა', 'Residence permit', 'Вид на жительство', 'Oturma izni', 'تصريح الإقامة', 'אשרת שהייה'),
  ],
};

/** The deterministic chips for a turn about `service` (or a general turn). */
export function fallbackReplies(locale: string, service: ServiceActionId | null, vis: ServiceVisibility = ALL_VISIBLE): SuggestedReply[] {
  /* A hidden service gets no chips of its own, and no chip may lead to one. */
  const set = (service && vis.isVisible(service) && BY_SERVICE[service]) || GENERIC;
  const chips = filterReplies(parseSuggestedReplies(set.map((t) => pick(t, locale))), vis);
  const out = chips.length >= 2 ? chips : filterReplies(parseSuggestedReplies(GENERIC.map((t) => pick(t, locale))), vis);
  return out.map((r, i) => ({ ...r, id: `f${i + 1}` }));
}

/** The model's chips when there are enough of them, otherwise the fallback. */
export function ensureReplies(replies: SuggestedReply[], locale: string, service: ServiceActionId | null, vis: ServiceVisibility = ALL_VISIBLE): SuggestedReply[] {
  const allowed = filterReplies(replies, vis);
  return allowed.length >= 2 ? allowed : fallbackReplies(locale, service, vis);
}

/** Overrides the shared "may return an empty array" for HOMI's own chat. */
export const HOMI_ALWAYS_REPLIES_INSTRUCTION = [
  'IN THIS CHAT, ALWAYS OFFER REPLIES. Return three or four "suggested_replies" after every answer: the things this person',
  'would most likely type next, so they can tap instead of typing. When you asked a question, they are its likely answers.',
].join('\n');
