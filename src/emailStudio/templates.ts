// HOMATCH EMAIL STUDIO — the four approved templates.
//
// Pure (no React, no Deno) so the browser editor, the edge renderer and node:test
// all read the same definitions. The approved English copy is the source; the
// other five languages are its translation. A template is a LOOK (theme) plus a
// default block order and default copy — never facts. Everything factual in an
// email comes from the seller's own listing, loaded on the server.

export type TemplateId = 'PROPERTY_INTRODUCTION' | 'MODERN_RESIDENCE' | 'PREMIUM_PROPERTY' | 'PERSONAL_FOLLOW_UP';
export type EmailLang = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';

export const EMAIL_LANGS: readonly EmailLang[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
export const TEMPLATE_IDS: readonly TemplateId[] = [
  'PROPERTY_INTRODUCTION', 'MODERN_RESIDENCE', 'PREMIUM_PROPERTY', 'PERSONAL_FOLLOW_UP',
];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export function asEmailLang(value: unknown): EmailLang {
  return typeof value === 'string' && (EMAIL_LANGS as readonly string[]).includes(value) ? value as EmailLang : 'en';
}

export function isRtlLang(lang: string): boolean {
  return lang === 'ar' || lang === 'he';
}

export interface TemplateCopy {
  headline: string;
  body: string;
  cta: string;
}

/** Approved copy. en is verbatim; the rest are translations of it. */
export const TEMPLATE_COPY: Record<TemplateId, Record<EmailLang, TemplateCopy>> = {
  PROPERTY_INTRODUCTION: {
    en: { headline: 'A Property Worth Exploring', body: 'Discover a property that may fit your location, budget and lifestyle preferences.', cta: 'View Property' },
    ka: { headline: 'ქონება, რომლის გაცნობაც ღირს', body: 'გაეცანით ქონებას, რომელიც შესაძლოა შეესაბამებოდეს თქვენთვის სასურველ მდებარეობას, ბიუჯეტსა და ცხოვრების სტილს.', cta: 'ქონების ნახვა' },
    ru: { headline: 'Объект, который стоит посмотреть', body: 'Познакомьтесь с объектом, который может соответствовать вашим предпочтениям по расположению, бюджету и образу жизни.', cta: 'Посмотреть объект' },
    tr: { headline: 'Keşfetmeye Değer Bir Mülk', body: 'Konum, bütçe ve yaşam tarzı tercihlerinize uygun olabilecek bir mülkü keşfedin.', cta: 'Mülkü Görüntüle' },
    ar: { headline: 'عقار يستحق الاستكشاف', body: 'اكتشف عقارًا قد يناسب تفضيلاتك من حيث الموقع والميزانية ونمط الحياة.', cta: 'عرض العقار' },
    he: { headline: 'נכס שכדאי להכיר', body: 'גלו נכס שעשוי להתאים להעדפות שלכם מבחינת מיקום, תקציב וסגנון חיים.', cta: 'לצפייה בנכס' },
  },
  MODERN_RESIDENCE: {
    en: { headline: 'Discover Your Next Home', body: 'Explore the details, photos and features of a property selected for its relevance to your search.', cta: 'Explore the Listing' },
    ka: { headline: 'აღმოაჩინეთ თქვენი შემდეგი სახლი', body: 'გაეცანით ქონების დეტალებს, ფოტოებსა და მახასიათებლებს — ის შერჩეულია თქვენი ძიების შესაბამისად.', cta: 'განცხადების ნახვა' },
    ru: { headline: 'Ваш следующий дом', body: 'Изучите детали, фотографии и особенности объекта, выбранного с учётом вашего поиска.', cta: 'Открыть объявление' },
    tr: { headline: 'Bir Sonraki Evinizi Keşfedin', body: 'Aramanızla ilgili olduğu için seçilen bir mülkün ayrıntılarını, fotoğraflarını ve özelliklerini inceleyin.', cta: 'İlanı İncele' },
    ar: { headline: 'اكتشف منزلك القادم', body: 'استكشف تفاصيل وصور ومزايا عقار تم اختياره لملاءمته لبحثك.', cta: 'استكشف الإعلان' },
    he: { headline: 'גלו את הבית הבא שלכם', body: 'עיינו בפרטים, בתמונות ובמאפיינים של נכס שנבחר בזכות הרלוונטיות שלו לחיפוש שלכם.', cta: 'לצפייה במודעה' },
  },
  PREMIUM_PROPERTY: {
    en: { headline: 'An Exceptional Property Opportunity', body: 'Take a closer look at a distinctive property and discover whether it meets your expectations.', cta: 'View Property Details' },
    ka: { headline: 'გამორჩეული ქონების შესაძლებლობა', body: 'უფრო ახლოს გაეცანით გამორჩეულ ქონებას და გაარკვიეთ, აკმაყოფილებს თუ არა ის თქვენს მოლოდინებს.', cta: 'ქონების დეტალების ნახვა' },
    ru: { headline: 'Исключительное предложение', body: 'Присмотритесь к особенному объекту и узнайте, соответствует ли он вашим ожиданиям.', cta: 'Подробнее об объекте' },
    tr: { headline: 'Olağanüstü Bir Mülk Fırsatı', body: 'Kendine özgü bir mülke daha yakından bakın ve beklentilerinizi karşılayıp karşılamadığını keşfedin.', cta: 'Mülk Ayrıntılarını Görüntüle' },
    ar: { headline: 'فرصة عقارية استثنائية', body: 'ألقِ نظرة أقرب على عقار مميز واكتشف ما إذا كان يلبّي توقعاتك.', cta: 'عرض تفاصيل العقار' },
    he: { headline: 'הזדמנות נדל״ן יוצאת דופן', body: 'הביטו מקרוב בנכס ייחודי וגלו אם הוא עונה על הציפיות שלכם.', cta: 'לפרטי הנכס' },
  },
  PERSONAL_FOLLOW_UP: {
    en: { headline: 'Following Up on Your Property Search', body: 'I wanted to share this property with you in case it is relevant to your current search. I’d be happy to provide additional details or arrange a conversation.', cta: 'Let’s Connect' },
    ka: { headline: 'თქვენი ქონების ძიების გაგრძელებად', body: 'მინდოდა, გაგიზიაროთ ეს ქონება, თუ ის თქვენს ამჟამინდელ ძიებას შეესაბამება. სიამოვნებით მოგაწვდით დამატებით ინფორმაციას ან შევთანხმდებით საუბარზე.', cta: 'დავუკავშირდეთ' },
    ru: { headline: 'По поводу вашего поиска недвижимости', body: 'Хочу поделиться с вами этим объектом — возможно, он подходит для вашего текущего поиска. С удовольствием расскажу подробнее или договорюсь о разговоре.', cta: 'Давайте свяжемся' },
    tr: { headline: 'Mülk Aramanızla İlgili', body: 'Mevcut aramanızla ilgili olabileceğini düşündüğüm için bu mülkü sizinle paylaşmak istedim. Ek bilgi vermekten veya bir görüşme ayarlamaktan memnuniyet duyarım.', cta: 'İletişime Geçelim' },
    ar: { headline: 'متابعةً لبحثك عن عقار', body: 'أردت مشاركة هذا العقار معك في حال كان مناسبًا لبحثك الحالي. يسعدني تقديم تفاصيل إضافية أو ترتيب محادثة.', cta: 'لنتواصل' },
    he: { headline: 'בהמשך לחיפוש הנכס שלכם', body: 'רציתי לשתף אתכם בנכס הזה, למקרה שהוא רלוונטי לחיפוש הנוכחי שלכם. אשמח לספק פרטים נוספים או לתאם שיחה.', cta: 'בואו נדבר' },
  },
};

export interface TemplateTheme {
  canvas: string;
  surface: string;
  ink: string;
  muted: string;
  hairline: string;
  accent: string;
  headerBg: string;
  headerInk: string;
  ctaBg: string;
  ctaInk: string;
  headlineSize: number;
  /** Hero image corner radius (px); 0 = full-bleed. */
  heroRadius: number;
  /** Letter style: the text leads, photos follow. */
  letter: boolean;
}

const NAVY = '#14213A';
const GOLD = '#C9973A';

export const TEMPLATE_THEME: Record<TemplateId, TemplateTheme> = {
  PROPERTY_INTRODUCTION: {
    canvas: '#F6F3EC', surface: '#FFFFFF', ink: NAVY, muted: '#5A6478', hairline: '#E7E1D3',
    accent: GOLD, headerBg: NAVY, headerInk: '#F3D58C', ctaBg: '#F2A93B', ctaInk: '#161309',
    headlineSize: 26, heroRadius: 10, letter: false,
  },
  MODERN_RESIDENCE: {
    canvas: '#F3F4F6', surface: '#FFFFFF', ink: '#111827', muted: '#4B5563', hairline: '#E5E7EB',
    accent: NAVY, headerBg: '#FFFFFF', headerInk: NAVY, ctaBg: NAVY, ctaInk: '#FFFFFF',
    headlineSize: 28, heroRadius: 0, letter: false,
  },
  PREMIUM_PROPERTY: {
    canvas: '#0F1726', surface: '#FFFFFF', ink: NAVY, muted: '#5A6478', hairline: '#E9DFC8',
    accent: GOLD, headerBg: '#0C1119', headerInk: '#E8C77A', ctaBg: NAVY, ctaInk: '#F3D58C',
    headlineSize: 28, heroRadius: 0, letter: false,
  },
  PERSONAL_FOLLOW_UP: {
    canvas: '#FAF8F4', surface: '#FFFFFF', ink: '#1F2937', muted: '#4B5563', hairline: '#ECE7DD',
    accent: GOLD, headerBg: '#FFFFFF', headerInk: NAVY, ctaBg: NAVY, ctaInk: '#FFFFFF',
    headlineSize: 22, heroRadius: 8, letter: true,
  },
};

/** i18n keys for the gallery cards (see scripts/email-studio-i18n-data.mjs). */
export const TEMPLATE_NAME_KEY: Record<TemplateId, string> = {
  PROPERTY_INTRODUCTION: 'es_tpl_intro_name',
  MODERN_RESIDENCE: 'es_tpl_modern_name',
  PREMIUM_PROPERTY: 'es_tpl_premium_name',
  PERSONAL_FOLLOW_UP: 'es_tpl_followup_name',
};

/**
 * Whether a template may be used for a listing. Premium Property claims a premium
 * listing, so it is offered only when HOMATCH's own market segmentation says so —
 * never on the seller's word, and never invented.
 */
export function templateAvailability(id: TemplateId, segment: string | null | undefined):
  { available: true } | { available: false; reason: 'NOT_PREMIUM_SEGMENT' } {
  if (id === 'PREMIUM_PROPERTY' && segment !== 'PREMIUM') return { available: false, reason: 'NOT_PREMIUM_SEGMENT' };
  return { available: true };
}
