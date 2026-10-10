// PROPERTY CONVERSATIONS — the approved message templates, in all six languages.
//
// ONE TABLE, TWO READERS. The edge function (send-message, action `assist`) fills these
// server-side from verified property data; the browser shows the same words. The table
// is mirrored, key for key, in scripts/property-chat-i18n-data.mjs so the UI bundle
// carries the identical text — src/chat/__tests__/templates.test.mjs fails if the two
// drift apart.
//
// THE RULE THESE FUNCTIONS EXIST TO KEEP: a template is filled ONLY from facts the
// caller passes in, and the caller passes only what the database holds for the
// listing. A missing fact removes its clause; it is never guessed, rounded up, or
// replaced by a plausible default. When all three offer facts exist, the approved
// English sentence comes out verbatim.
//
// Pure: no imports, no I/O. Imported by Deno (edge) and Vite (browser) alike.

export const CHAT_LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;
export type ChatLang = (typeof CHAT_LANGS)[number];

/** [en, ka, ru, tr, ar, he] — the same order as every i18n data file. */
type Six = readonly [string, string, string, string, string, string];

export const CHAT_TEMPLATE_STRINGS = {
  pc_tpl_intro: [
    "Hello! I noticed that your property requirements may align with a listing I have available. I'd be happy to share the details, photos and pricing if you're interested.",
    'გამარჯობა! შევნიშნე, რომ თქვენი მოთხოვნები შესაძლოა ემთხვეოდეს ჩემს ხელთ არსებულ განცხადებას. სიამოვნებით გაგიზიარებთ დეტალებს, ფოტოებსა და ფასს, თუ დაინტერესდებით.',
    'Здравствуйте! Похоже, ваши требования к недвижимости могут совпадать с объектом, который я предлагаю. С удовольствием поделюсь подробностями, фотографиями и ценой, если вам интересно.',
    'Merhaba! Emlak kriterlerinizin elimdeki bir ilanla örtüşebileceğini fark ettim. İlgilenirseniz ayrıntıları, fotoğrafları ve fiyatı memnuniyetle paylaşırım.',
    'مرحبًا! لاحظت أن متطلباتك العقارية قد تتوافق مع عقار متاح لديّ. يسعدني أن أشارك معك التفاصيل والصور والسعر إذا كنت مهتمًا.',
    'שלום! שמתי לב שהדרישות שלך לנכס עשויות להתאים לנכס שיש לי. אשמח לשתף פרטים, תמונות ומחיר אם זה מעניין אותך.',
  ],
  pc_tpl_offer_open: [
    'Hello! I believe this property may be relevant to your search.',
    'გამარჯობა! მიმაჩნია, რომ ეს ქონება შესაძლოა შეესაბამებოდეს თქვენს ძიებას.',
    'Здравствуйте! Думаю, этот объект может подойти под ваш запрос.',
    'Merhaba! Bu mülkün aramanızla ilgili olabileceğini düşünüyorum.',
    'مرحبًا! أعتقد أن هذا العقار قد يناسب ما تبحث عنه.',
    'שלום! נראה לי שהנכס הזה עשוי להתאים לחיפוש שלך.',
  ],
  pc_tpl_offer_all: [
    'It is located in {{location}}, offers {{features}}, and is listed at {{price}}.',
    'მდებარეობა: {{location}}. მახასიათებლები: {{features}}. ფასი: {{price}}.',
    'Расположение — {{location}}, {{features}}, цена — {{price}}.',
    'Mülk {{location}} konumunda yer alıyor, {{features}} sunuyor ve {{price}} fiyatla listeleniyor.',
    'يقع في {{location}}، ويضم {{features}}، ومعروض بسعر {{price}}.',
    'הוא ממוקם ב{{location}}, כולל {{features}}, ומוצע במחיר {{price}}.',
  ],
  pc_tpl_offer_location: [
    'It is located in {{location}}.',
    'მდებარეობა: {{location}}.',
    'Расположение — {{location}}.',
    'Mülk {{location}} konumunda yer alıyor.',
    'يقع في {{location}}.',
    'הוא ממוקם ב{{location}}.',
  ],
  pc_tpl_offer_features: [
    'It offers {{features}}.',
    'მახასიათებლები: {{features}}.',
    'Характеристики: {{features}}.',
    'Mülk {{features}} sunuyor.',
    'يضم العقار {{features}}.',
    'הנכס כולל {{features}}.',
  ],
  pc_tpl_offer_price: [
    'It is listed at {{price}}.',
    'ფასი: {{price}}.',
    'Цена — {{price}}.',
    'Fiyatı {{price}}.',
    'السعر المطلوب {{price}}.',
    'המחיר המבוקש: {{price}}.',
  ],
  pc_tpl_offer_close: [
    "If you'd like, I can share more photos and answer any questions.",
    'სურვილის შემთხვევაში, გაგიზიარებთ მეტ ფოტოს და ვუპასუხებ ნებისმიერ შეკითხვას.',
    'Если хотите, могу прислать больше фотографий и ответить на любые вопросы.',
    'İsterseniz daha fazla fotoğraf paylaşabilir ve sorularınızı yanıtlayabilirim.',
    'إذا رغبت، يمكنني مشاركة المزيد من الصور والإجابة عن أي أسئلة.',
    'אשמח לשלוח תמונות נוספות ולענות על כל שאלה.',
  ],
  pc_tpl_follow_up: [
    "Hello again! I wanted to follow up on the property I shared earlier. Please let me know if you'd like any additional details or if you'd prefer to arrange a viewing.",
    'კვლავ გამარჯობა! მინდოდა, დაგკავშირებოდით ადრე გაზიარებულ ქონებასთან დაკავშირებით. გთხოვთ, შემატყობინოთ, თუ გსურთ დამატებითი დეტალები ან დათვალიერების დანიშვნა.',
    'Здравствуйте ещё раз! Пишу по поводу объекта, отправленного ранее. Дайте знать, если нужны дополнительные подробности или вы хотели бы договориться о просмотре.',
    'Tekrar merhaba! Daha önce paylaştığım mülkle ilgili size dönmek istedim. Ek ayrıntı isterseniz ya da mülkü görmek için bir randevu ayarlamak isterseniz lütfen bana bildirin.',
    'مرحبًا مجددًا! أردت المتابعة بخصوص العقار الذي شاركته سابقًا. يُرجى إعلامي إذا كنت ترغب في أي تفاصيل إضافية أو تفضّل ترتيب موعد للمعاينة.',
    'שלום שוב! רציתי לחזור אליך בנוגע לנכס ששיתפתי קודם. אשמח לדעת אם יש צורך בפרטים נוספים או אם נוח לך לתאם צפייה.',
  ],
  pc_tpl_viewing: [
    "If this property interests you, I'd be happy to discuss a convenient time for a viewing.",
    'თუ ეს ქონება გაინტერესებთ, სიამოვნებით შევათანხმებთ დათვალიერებისთვის მოსახერხებელ დროს.',
    'Если этот объект вас заинтересовал, с удовольствием подберём удобное время для просмотра.',
    'Bu mülk ilginizi çekiyorsa, görmek için size uygun bir zamanı konuşmaktan memnuniyet duyarım.',
    'إذا كان هذا العقار يثير اهتمامك، يسعدني الاتفاق على موعد مناسب للمعاينة.',
    'אם הנכס מעניין אותך, אשמח לתאם מועד נוח לצפייה.',
  ],
  pc_feat_bedrooms_one: ['1 bedroom', '1 საძინებელი', '1 спальня', '1 yatak odası', 'غرفة نوم واحدة', 'חדר שינה אחד'],
  pc_feat_bedrooms: ['{{n}} bedrooms', '{{n}} საძინებელი', 'спален: {{n}}', '{{n}} yatak odası', 'عدد غرف النوم: {{n}}', '{{n}} חדרי שינה'],
  pc_feat_area: ['{{n}} m²', '{{n}} მ²', '{{n}} м²', '{{n}} m²', '{{n}} م²', '{{n}} מ״ר'],

  /* The property-offer notification and email (approved copy). Server-rendered in the
     recipient's own language; the lock screen never carries the message itself. */
  pc_notif_offer_title: ['New Property Message', 'ახალი შეტყობინება ქონებაზე', 'Новое сообщение об объекте', 'Yeni mülk mesajı', 'رسالة عقارية جديدة', 'הודעה חדשה על נכס'],
  pc_notif_offer_body: [
    'You have received a property offer that may match your search preferences. Open HOMATCH to view the details and reply.',
    'თქვენ მიიღეთ ქონების შეთავაზება, რომელიც შესაძლოა ემთხვეოდეს თქვენი ძიების პარამეტრებს. გახსენით HOMATCH დეტალების სანახავად და საპასუხოდ.',
    'Вы получили предложение объекта, который может соответствовать вашим критериям поиска. Откройте HOMATCH, чтобы посмотреть подробности и ответить.',
    "Arama tercihlerinizle eşleşebilecek bir mülk teklifi aldınız. Ayrıntıları görmek ve yanıtlamak için HOMATCH'i açın.",
    'تلقيت عرضًا عقاريًا قد يتوافق مع تفضيلات البحث لديك. افتح HOMATCH لعرض التفاصيل والرد.',
    'קיבלת הצעת נכס שעשויה להתאים להעדפות החיפוש שלך. היכנסו ל-HOMATCH כדי לראות את הפרטים ולהשיב.',
  ],
  pc_notif_offer_cta: ['Open Conversation', 'საუბრის გახსნა', 'Открыть переписку', 'Sohbeti aç', 'فتح المحادثة', 'לפתיחת השיחה'],
  pc_email_offer_subject: [
    'You have a new property message on HOMATCH',
    'HOMATCH-ზე ახალი შეტყობინება გაქვთ ქონების შესახებ',
    'У вас новое сообщение об объекте на HOMATCH',
    "HOMATCH'te yeni bir mülk mesajınız var",
    'لديك رسالة عقارية جديدة على HOMATCH',
    'יש לך הודעה חדשה על נכס ב-HOMATCH',
  ],
  pc_email_offer_heading: [
    'A property offer is waiting for you',
    'ქონების შეთავაზება გელოდებათ',
    'Вас ждёт предложение объекта',
    'Sizi bekleyen bir mülk teklifi var',
    'عرض عقاري بانتظارك',
    'הצעת נכס מחכה לך',
  ],
  pc_email_offer_body: [
    'Someone has shared a property that may match your saved search preferences. Sign in to HOMATCH to review the offer and reply directly.',
    'ვიღაცამ გაგიზიარათ ქონება, რომელიც შესაძლოა ემთხვეოდეს თქვენი შენახული ძიების პარამეტრებს. შედით HOMATCH-ში, რომ განიხილოთ შეთავაზება და უპასუხოთ პირდაპირ.',
    'Вам отправили объект, который может соответствовать вашим сохранённым критериям поиска. Войдите в HOMATCH, чтобы ознакомиться с предложением и ответить напрямую.',
    "Birisi kayıtlı arama tercihlerinizle eşleşebilecek bir mülk paylaştı. Teklifi incelemek ve doğrudan yanıtlamak için HOMATCH'e giriş yapın.",
    'شارك أحدهم عقارًا قد يتوافق مع تفضيلات البحث المحفوظة لديك. سجّل الدخول إلى HOMATCH لمراجعة العرض والرد مباشرة.',
    'מישהו שיתף נכס שעשוי להתאים להעדפות החיפוש השמורות שלך. התחברו ל-HOMATCH כדי לעיין בהצעה ולהשיב ישירות.',
  ],
  pc_email_offer_cta: ['View Property Message', 'შეტყობინების ნახვა', 'Посмотреть сообщение', 'Mülk mesajını görüntüle', 'عرض الرسالة العقارية', 'לצפייה בהודעה'],
  pc_email_offer_footer: [
    'You are receiving this notification based on your HOMATCH communication preferences. You can manage these preferences in your account settings.',
    'ამ შეტყობინებას იღებთ HOMATCH-ის კომუნიკაციის პარამეტრების მიხედვით. მათი მართვა შეგიძლიათ ანგარიშის პარამეტრებში.',
    'Вы получаете это уведомление в соответствии с вашими настройками общения в HOMATCH. Управлять ими можно в настройках аккаунта.',
    'Bu bildirimi HOMATCH iletişim tercihlerinize göre alıyorsunuz. Bu tercihleri hesap ayarlarınızdan yönetebilirsiniz.',
    'تتلقى هذا الإشعار بناءً على تفضيلات التواصل لديك في HOMATCH. يمكنك إدارة هذه التفضيلات من إعدادات حسابك.',
    'קיבלת התראה זו בהתאם להעדפות התקשורת שלך ב-HOMATCH. אפשר לנהל את ההעדפות בהגדרות החשבון.',
  ],
} as const satisfies Record<string, Six>;

export type ChatTemplateKey = keyof typeof CHAT_TEMPLATE_STRINGS;

export function isChatLang(value: unknown): value is ChatLang {
  return typeof value === 'string' && (CHAT_LANGS as readonly string[]).includes(value);
}

/** A language the table covers; anything else reads English. */
export function chatLang(value: unknown): ChatLang {
  const short = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 2) : '';
  return isChatLang(short) ? short : 'en';
}

/** One string, with {{var}} holes filled. An unfilled hole is left visible, never blanked. */
export function chatString(key: ChatTemplateKey, lang: unknown, vars: Record<string, string | number> = {}): string {
  const row = CHAT_TEMPLATE_STRINGS[key] as Six;
  const text = row[CHAT_LANGS.indexOf(chatLang(lang))] ?? row[0];
  return text.replace(/\{\{(\w+)\}\}/g, (hole, name: string) => (name in vars ? String(vars[name]) : hole));
}

const INTL_LOCALE: Record<ChatLang, string> = {
  en: 'en-US', ka: 'ka-GE', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', he: 'he-IL',
};

/**
 * The verified facts a property offer may cite. Every field is optional because the
 * listing may not hold it — and an absent field must stay absent in the text.
 */
export interface OfferFacts {
  city?: string | null;
  district?: string | null;
  bedrooms?: number | null;
  area?: number | null;
  price?: number | null;
  currency?: string | null;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const positive = (n: unknown): number | null => {
  const v = typeof n === 'number' ? n : typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** "Krtsanisi, Tbilisi" — district then city, each only if recorded, never repeated. */
export function offerLocation(f: OfferFacts): string | null {
  const parts = [clean(f.district), clean(f.city)].filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.length ? unique.join(', ') : null;
}

/** "2 bedrooms, 85 m²" — only the features the listing records. */
export function offerFeatures(f: OfferFacts, lang: unknown): string | null {
  const l = chatLang(lang);
  const fmt = new Intl.NumberFormat(INTL_LOCALE[l], { maximumFractionDigits: 1 });
  const out: string[] = [];
  const beds = positive(f.bedrooms);
  if (beds !== null && Number.isInteger(beds)) {
    out.push(beds === 1 ? chatString('pc_feat_bedrooms_one', l) : chatString('pc_feat_bedrooms', l, { n: fmt.format(beds) }));
  }
  const area = positive(f.area);
  if (area !== null) out.push(chatString('pc_feat_area', l, { n: fmt.format(area) }));
  return out.length ? out.join(l === 'ar' ? '، ' : ', ') : null;
}

/** "$185,000" in the reader's locale; a price without a currency is not quoted at all. */
export function offerPrice(f: OfferFacts, lang: unknown): string | null {
  const amount = positive(f.price);
  const currency = clean(f.currency).toUpperCase();
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) return null;
  const locale = INTL_LOCALE[chatLang(lang)];
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
  }
}

export type AssistTemplateMode = 'introduction' | 'offer' | 'follow_up' | 'viewing';
export const ASSIST_TEMPLATE_MODES: readonly AssistTemplateMode[] = ['introduction', 'offer', 'follow_up', 'viewing'];

/**
 * The property offer, from verified facts only. All three facts present → the approved
 * sentence verbatim. Some missing → one short sentence per fact that exists. None → the
 * opening and closing alone, which still says nothing untrue.
 */
export function fillOfferTemplate(facts: OfferFacts, lang: unknown): string {
  const l = chatLang(lang);
  const location = offerLocation(facts);
  const features = offerFeatures(facts, l);
  const price = offerPrice(facts, l);
  const middle: string[] = [];
  if (location && features && price) {
    middle.push(chatString('pc_tpl_offer_all', l, { location, features, price }));
  } else {
    if (location) middle.push(chatString('pc_tpl_offer_location', l, { location }));
    if (features) middle.push(chatString('pc_tpl_offer_features', l, { features }));
    if (price) middle.push(chatString('pc_tpl_offer_price', l, { price }));
  }
  return [chatString('pc_tpl_offer_open', l), ...middle, chatString('pc_tpl_offer_close', l)].join(' ');
}

/** Any template mode. `offer` needs facts; the others never cite any. */
export function fillTemplate(mode: AssistTemplateMode, lang: unknown, facts: OfferFacts | null = null): string {
  switch (mode) {
    case 'introduction': return chatString('pc_tpl_intro', lang);
    case 'follow_up': return chatString('pc_tpl_follow_up', lang);
    case 'viewing': return chatString('pc_tpl_viewing', lang);
    case 'offer': return fillOfferTemplate(facts ?? {}, lang);
  }
}
