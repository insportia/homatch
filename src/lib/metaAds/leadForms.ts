// META ADS — INSTANT FORMS, THE HOMATCH WAY. The customer ticks the questions
// they want; HOMATCH writes the Meta form in the customer's language. Nothing
// here claims a form exists at Meta — the edge function creates it and only
// Meta's returned id makes it real. Pure.
//
// Contact fields use Meta's prefill types (FULL_NAME, PHONE, EMAIL), which
// Meta fills from the person's profile. Qualifying questions are CUSTOM
// multiple-choice (or short answer for location), keyed so answers map back
// to HOMATCH fields. Only questions the customer includes are asked.

export type FormLocale = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';
export const META_LOCALE: Record<FormLocale, string> = { en: 'en_US', ka: 'ka_GE', ru: 'ru_RU', tr: 'tr_TR', ar: 'ar_AR', he: 'he_IL' };

export type ContactField = 'FULL_NAME' | 'PHONE' | 'EMAIL';
export type QualifyingKey = 'buy_or_rent' | 'budget' | 'preferred_location' | 'property_type' | 'bedrooms' | 'timeframe' | 'agent_contact';

export const CONTACT_FIELDS: ContactField[] = ['FULL_NAME', 'PHONE', 'EMAIL'];
export const QUALIFYING_KEYS: QualifyingKey[] = ['buy_or_rent', 'budget', 'preferred_location', 'property_type', 'bedrooms', 'timeframe', 'agent_contact'];

type L = Record<FormLocale, string>;
interface QuestionDef { label: L; options?: Array<{ key: string; label: L }> }

export const Q: Record<QualifyingKey, QuestionDef> = {
  buy_or_rent: {
    label: { en: 'Are you looking to buy or rent?', ka: 'ყიდვა გსურთ თუ ქირაობა?', ru: 'Вы хотите купить или арендовать?', tr: 'Satın almak mı kiralamak mı istiyorsunuz?', ar: 'هل تبحث عن الشراء أم الإيجار؟', he: 'אתם מחפשים לקנות או לשכור?' },
    options: [
      { key: 'buy', label: { en: 'Buy', ka: 'ყიდვა', ru: 'Купить', tr: 'Satın almak', ar: 'شراء', he: 'לקנות' } },
      { key: 'rent', label: { en: 'Rent', ka: 'ქირაობა', ru: 'Арендовать', tr: 'Kiralamak', ar: 'إيجار', he: 'לשכור' } },
    ],
  },
  budget: {
    label: { en: 'What is your approximate budget?', ka: 'რა არის თქვენი სავარაუდო ბიუჯეტი?', ru: 'Какой у вас примерный бюджет?', tr: 'Yaklaşık bütçeniz nedir?', ar: 'ما هي ميزانيتك التقريبية؟', he: 'מה התקציב המשוער שלכם?' },
    options: [
      { key: 'under_50k', label: { en: 'Under $50,000', ka: '$50,000-მდე', ru: 'До $50 000', tr: '50.000 $ altı', ar: 'أقل من 50,000 $', he: 'עד 50,000$' } },
      { key: '50k_100k', label: { en: '$50,000 – $100,000', ka: '$50,000 – $100,000', ru: '$50 000 – $100 000', tr: '50.000 – 100.000 $', ar: '50,000 – 100,000 $', he: '50,000$ – 100,000$' } },
      { key: '100k_200k', label: { en: '$100,000 – $200,000', ka: '$100,000 – $200,000', ru: '$100 000 – $200 000', tr: '100.000 – 200.000 $', ar: '100,000 – 200,000 $', he: '100,000$ – 200,000$' } },
      { key: 'over_200k', label: { en: 'Over $200,000', ka: '$200,000-ზე მეტი', ru: 'Более $200 000', tr: '200.000 $ üzeri', ar: 'أكثر من 200,000 $', he: 'מעל 200,000$' } },
    ],
  },
  preferred_location: {
    label: { en: 'Which area do you prefer?', ka: 'რომელ უბანს ანიჭებთ უპირატესობას?', ru: 'Какой район вы предпочитаете?', tr: 'Hangi bölgeyi tercih edersiniz?', ar: 'ما المنطقة التي تفضلها؟', he: 'איזה אזור אתם מעדיפים?' },
  },
  property_type: {
    label: { en: 'What type of property?', ka: 'როგორი ტიპის ქონება?', ru: 'Какой тип недвижимости?', tr: 'Ne tür bir mülk?', ar: 'ما نوع العقار؟', he: 'איזה סוג נכס?' },
    options: [
      { key: 'apartment', label: { en: 'Apartment', ka: 'ბინა', ru: 'Квартира', tr: 'Daire', ar: 'شقة', he: 'דירה' } },
      { key: 'house', label: { en: 'House', ka: 'სახლი', ru: 'Дом', tr: 'Ev', ar: 'منزل', he: 'בית' } },
      { key: 'commercial', label: { en: 'Commercial', ka: 'კომერციული', ru: 'Коммерческая', tr: 'Ticari', ar: 'تجاري', he: 'מסחרי' } },
      { key: 'land', label: { en: 'Land', ka: 'მიწა', ru: 'Земля', tr: 'Arsa', ar: 'أرض', he: 'קרקע' } },
    ],
  },
  bedrooms: {
    label: { en: 'How many bedrooms?', ka: 'რამდენი საძინებელი?', ru: 'Сколько спален?', tr: 'Kaç yatak odası?', ar: 'كم عدد غرف النوم؟', he: 'כמה חדרי שינה?' },
    options: [
      { key: 'studio', label: { en: 'Studio', ka: 'სტუდიო', ru: 'Студия', tr: 'Stüdyo', ar: 'استوديو', he: 'סטודיו' } },
      { key: 'one', label: { en: '1', ka: '1', ru: '1', tr: '1', ar: '1', he: '1' } },
      { key: 'two', label: { en: '2', ka: '2', ru: '2', tr: '2', ar: '2', he: '2' } },
      { key: 'three_plus', label: { en: '3 or more', ka: '3 ან მეტი', ru: '3 и более', tr: '3 veya daha fazla', ar: '3 أو أكثر', he: '3 ומעלה' } },
    ],
  },
  timeframe: {
    label: { en: 'When are you planning to buy or move?', ka: 'როდის გეგმავთ ყიდვას ან გადასვლას?', ru: 'Когда вы планируете купить или переехать?', tr: 'Ne zaman satın almayı veya taşınmayı planlıyorsunuz?', ar: 'متى تخطط للشراء أو الانتقال؟', he: 'מתי אתם מתכננים לקנות או לעבור?' },
    options: [
      { key: 'now', label: { en: 'Within a month', ka: 'ერთი თვის განმავლობაში', ru: 'В течение месяца', tr: 'Bir ay içinde', ar: 'خلال شهر', he: 'תוך חודש' } },
      { key: 'three_months', label: { en: 'In 1–3 months', ka: '1–3 თვეში', ru: 'Через 1–3 месяца', tr: '1–3 ay içinde', ar: 'خلال 1–3 أشهر', he: 'בעוד 1–3 חודשים' } },
      { key: 'later', label: { en: 'Later', ka: 'მოგვიანებით', ru: 'Позже', tr: 'Daha sonra', ar: 'لاحقًا', he: 'מאוחר יותר' } },
    ],
  },
  agent_contact: {
    label: { en: 'Would you like an agent to contact you?', ka: 'გსურთ, აგენტი დაგიკავშირდეთ?', ru: 'Хотите, чтобы с вами связался агент?', tr: 'Bir danışmanın sizinle iletişime geçmesini ister misiniz?', ar: 'هل تريد أن يتواصل معك وكيل؟', he: 'תרצו שסוכן ייצור איתכם קשר?' },
    options: [
      { key: 'yes', label: { en: 'Yes', ka: 'დიახ', ru: 'Да', tr: 'Evet', ar: 'نعم', he: 'כן' } },
      { key: 'no', label: { en: 'Not now', ka: 'ახლა არა', ru: 'Не сейчас', tr: 'Şimdi değil', ar: 'ليس الآن', he: 'לא עכשיו' } },
    ],
  },
};

/** Meta's intro screen (context_card): a title and up to five short points. */
export interface LeadFormIntro { title: string; points: string[] }
/** A customer-written multiple-choice question (Meta CUSTOM with options). */
export interface CustomQuestion { label: string; options: string[] }

export interface LeadFormSpec {
  name: string;
  headline?: string | null;
  /** Optional intro screen before the questions. */
  intro?: LeadFormIntro | null;
  /** Shown after submission (Meta's thank-you screen). */
  thankYouTitle?: string | null;
  thankYouMessage?: string | null;
  contactFields: ContactField[];
  questions: QualifyingKey[];
  /** The customer's own multiple-choice questions (Meta CUSTOM). */
  customQuestions?: CustomQuestion[];
  privacyPolicyUrl: string;
  followUpUrl?: string | null;
  locale: FormLocale;
}

export const MAX_QUESTIONS = 5;
export const MAX_INTRO_POINTS = 5;

/*
 * Topics Meta does not allow a lead form to ask about without its own special
 * question types (or at all): health, religion, sexual orientation, politics,
 * criminal history, trade-union membership, finances/IDs. A customer question
 * that names one is refused here, in six languages — HOMATCH never sends it.
 */
const SENSITIVE_EN = /\b(health|medical|diseases?|disabled|disability|pregnan\w*|religion|religious|church|mosque|faith|sexual|orientation|gay|lesbian|political|politics|vote|criminal|convicted|arrested|ethnic|ethnicity|race|racial|nationality|passport|social security|national id|id number|credit card|bank account|iban|salary|income|debts?|credit score|age|date of birth|born)\b/i;
const SENSITIVE_OTHER = /(ჯანმრთ|დაავად|რელიგ|სექსუალ|პოლიტიკ|ნასამართლ|ეთნიკ|ეროვნებ|პასპორტ|პირადი ნომ|ბარათ|ხელფას|შემოსავ|ასაკ|здоров|болезн|инвалид|беремен|религ|сексуал|ориентац|политич|судим|этнич|национальн|паспорт|номер карт|банковск|зарплат|доход|долг|возраст|sağlık|hastal|engelli|hamile|dini|cinsel|siyasi|sabıka|etnik|uyruk|pasaport|kimlik numar|kart numar|maaş|gelir|borç|yaşınız|صحة|مرض|إعاقة|حمل|ديانة|جنسي|سياس|سجل جنائي|عرق|جنسية|جواز|بطاقة ائتمان|راتب|دخل|ديون|عمرك|בריאות|מחלה|נכות|הריון|דת|מיני|פוליטי|פלילי|מוצא|לאום|דרכון|תעודת זהות|כרטיס אשראי|משכורת|הכנסה|חוב|גילך)/iu;

export function isSensitiveQuestion(text: string): boolean {
  const t = String(text ?? '');
  return SENSITIVE_EN.test(t) || SENSITIVE_OTHER.test(t);
}

export interface LeadFormIssue { code: string; field: string }

export function validateLeadFormSpec(spec: LeadFormSpec): LeadFormIssue[] {
  const issues: LeadFormIssue[] = [];
  const name = String(spec.name ?? '').trim();
  if (!name || name.length > 100) issues.push({ code: 'FORM_NAME_REQUIRED', field: 'name' });
  if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(String(spec.privacyPolicyUrl ?? ''))) issues.push({ code: 'PRIVACY_URL_REQUIRED', field: 'privacyPolicyUrl' });
  if (spec.followUpUrl && !/^https:\/\/[^\s]+\.[^\s]+$/.test(spec.followUpUrl)) issues.push({ code: 'FOLLOW_UP_URL_INVALID', field: 'followUpUrl' });
  const contacts = (spec.contactFields ?? []).filter((f) => CONTACT_FIELDS.includes(f));
  if (!contacts.includes('PHONE') && !contacts.includes('EMAIL')) issues.push({ code: 'CONTACT_FIELD_REQUIRED', field: 'contactFields' });
  if ((spec.questions ?? []).some((q) => !QUALIFYING_KEYS.includes(q))) issues.push({ code: 'QUESTION_UNKNOWN', field: 'questions' });
  const custom = spec.customQuestions ?? [];
  if ((spec.questions ?? []).length + custom.length > MAX_QUESTIONS) issues.push({ code: 'TOO_MANY_QUESTIONS', field: 'questions' });
  for (const c of custom) {
    const label = String(c?.label ?? '').trim();
    const options = (c?.options ?? []).map((o) => String(o ?? '').trim()).filter(Boolean);
    if (!label || label.length > 80) issues.push({ code: 'CUSTOM_QUESTION_LABEL', field: 'customQuestions' });
    if (options.length < 2 || options.length > 6 || options.some((o) => o.length > 50) || new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      issues.push({ code: 'CUSTOM_QUESTION_OPTIONS', field: 'customQuestions' });
    }
    if (isSensitiveQuestion(label) || options.some(isSensitiveQuestion)) issues.push({ code: 'QUESTION_SENSITIVE', field: 'customQuestions' });
  }
  if (spec.intro) {
    const title = String(spec.intro.title ?? '').trim();
    const points = (spec.intro.points ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
    if (!title || title.length > 60) issues.push({ code: 'INTRO_TITLE', field: 'intro' });
    if (!points.length || points.length > MAX_INTRO_POINTS || points.some((x) => x.length > 80)) issues.push({ code: 'INTRO_POINTS', field: 'intro' });
  }
  if (String(spec.thankYouTitle ?? '').length > 60) issues.push({ code: 'THANKS_TITLE_TOO_LONG', field: 'thankYouTitle' });
  if (String(spec.headline ?? '').length > 60) issues.push({ code: 'HEADLINE_TOO_LONG', field: 'headline' });
  if (String(spec.thankYouMessage ?? '').length > 500) issues.push({ code: 'MESSAGE_TOO_LONG', field: 'thankYouMessage' });
  if (!(spec.locale in META_LOCALE)) issues.push({ code: 'LOCALE_UNSUPPORTED', field: 'locale' });
  return issues;
}

const PRIVACY_LINK_TEXT: L = { en: 'Privacy policy', ka: 'კონფიდენციალურობის პოლიტიკა', ru: 'Политика конфиденциальности', tr: 'Gizlilik politikası', ar: 'سياسة الخصوصية', he: 'מדיניות פרטיות' };
const THANKS_TITLE: L = { en: 'Thank you', ka: 'გმადლობთ', ru: 'Спасибо', tr: 'Teşekkürler', ar: 'شكرًا لك', he: 'תודה' };
const THANKS_BODY: L = { en: 'We will contact you soon.', ka: 'მალე დაგიკავშირდებით.', ru: 'Мы скоро с вами свяжемся.', tr: 'Yakında sizinle iletişime geçeceğiz.', ar: 'سنتواصل معك قريبًا.', he: 'ניצור איתכם קשר בקרוב.' };
const VISIT: L = { en: 'Visit website', ka: 'ვებსაიტის ნახვა', ru: 'Перейти на сайт', tr: 'Web sitesini ziyaret et', ar: 'زيارة الموقع', he: 'לאתר' };

/** The exact POST /{page}/leadgen_forms parameters. */
export function leadFormPayload(spec: LeadFormSpec): Record<string, unknown> {
  const loc = spec.locale;
  const questions: Array<Record<string, unknown>> = spec.contactFields.filter((f) => CONTACT_FIELDS.includes(f)).map((type) => ({ type }));
  for (const key of spec.questions) {
    const def = Q[key];
    const q: Record<string, unknown> = { type: 'CUSTOM', key, label: def.label[loc] };
    if (def.options) q.options = def.options.map((o) => ({ key: o.key, value: o.label[loc] }));
    questions.push(q);
  }
  (spec.customQuestions ?? []).forEach((c, i) => {
    const options = c.options.map((o) => o.trim()).filter(Boolean);
    questions.push({ type: 'CUSTOM', key: `custom_${i + 1}`, label: c.label.trim(), options: options.map((o, j) => ({ key: `custom_${i + 1}_${j + 1}`, value: o })) });
  });
  const thanksTitle = String(spec.thankYouTitle || THANKS_TITLE[loc]).slice(0, 60);
  const payload: Record<string, unknown> = {
    name: spec.name.trim().slice(0, 100),
    locale: META_LOCALE[loc],
    questions: JSON.stringify(questions),
    privacy_policy: JSON.stringify({ url: spec.privacyPolicyUrl, link_text: PRIVACY_LINK_TEXT[loc] }),
    thank_you_page: JSON.stringify(spec.followUpUrl
      ? { title: thanksTitle, body: String(spec.thankYouMessage || THANKS_BODY[loc]).slice(0, 500), button_type: 'VIEW_WEBSITE', button_text: VISIT[loc], website_url: spec.followUpUrl }
      : { title: thanksTitle, body: String(spec.thankYouMessage || THANKS_BODY[loc]).slice(0, 500), button_type: 'NONE' }),
  };
  if (spec.intro) {
    payload.context_card = JSON.stringify({ title: spec.intro.title.trim().slice(0, 60), style: 'LIST_STYLE', content: spec.intro.points.map((x) => x.trim()).filter(Boolean).slice(0, MAX_INTRO_POINTS) });
  }
  if (spec.headline) payload.question_page_custom_headline = spec.headline.slice(0, 60);
  if (spec.followUpUrl) payload.follow_up_action_url = spec.followUpUrl;
  return payload;
}

/** The preview the builder shows — the same labels Meta will show. */
export function leadFormPreview(spec: LeadFormSpec) {
  const loc = spec.locale;
  return {
    headline: spec.headline ?? null,
    intro: spec.intro ? { title: spec.intro.title, points: spec.intro.points.filter((x) => x.trim()) } : null,
    contact: spec.contactFields,
    questions: [
      ...spec.questions.map((k) => ({ key: k as string, label: Q[k].label[loc], options: Q[k].options?.map((o) => o.label[loc]) ?? null })),
      ...(spec.customQuestions ?? []).map((c, i) => ({ key: `custom_${i + 1}`, label: c.label, options: c.options.filter((o) => o.trim()) })),
    ],
    thankYou: { title: spec.thankYouTitle || THANKS_TITLE[loc], body: spec.thankYouMessage || THANKS_BODY[loc] },
    privacyLinkText: PRIVACY_LINK_TEXT[loc],
  };
}

/** A Meta lead's answers → HOMATCH fields, first value each. */
export function mapLeadAnswers(fieldData: Array<{ name?: string; values?: string[] }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    const name = String(f.name ?? '').toLowerCase();
    const v = String(f.values?.[0] ?? '');
    if (!name || !v) continue;
    const std = name === 'full_name' ? 'name' : name === 'phone_number' ? 'phone' : name;
    out[std] = v.slice(0, 500);
  }
  return out;
}

/* ── GUIDANCE: what HOMATCH suggests, from the campaign's own context ── */

export interface FormContext {
  /** The campaign advertises a property (HOMATCH listing or a property offer). */
  isProperty: boolean;
  /** SALE / RENT_LONG / RENT_SHORT / COMMERCIAL … (the offer's deal kind). */
  dealKind?: string | null;
  /** HOMATCH property type, when known (apartment, house, land, commercial…). */
  propertyType?: string | null;
}

/**
 * The questions HOMATCH proposes for this campaign — never applied without the
 * owner. A property: the questions that tell a serious buyer or tenant apart,
 * for the deal at hand. A service around property (renovation, design…):
 * contact details only — HOMATCH does not guess a service's questions.
 */
export function suggestLeadQuestions(ctx: FormContext): QualifyingKey[] {
  if (!ctx.isProperty) return [];
  const deal = String(ctx.dealKind ?? '').toUpperCase();
  const type = String(ctx.propertyType ?? '').toLowerCase();
  const out: QualifyingKey[] = [];
  if (!deal || deal === 'OTHER') out.push('buy_or_rent');
  if (deal !== 'RENT_SHORT') out.push('timeframe');
  if (deal === 'SALE' || !deal) out.push('budget');
  if (!type || type === 'apartment' || type === 'house') out.push('agent_contact');
  return [...new Set(out)].slice(0, MAX_QUESTIONS);
}

export type ReadinessState = 'ok' | 'warn' | 'todo';
export interface ReadinessItem { key: 'basics' | 'contact' | 'questions' | 'privacy' | 'completion' | 'meta'; state: ReadinessState; code?: string }

/** HOMATCH's own privacy policy page — it covers HOMATCH, not the advertiser's business. */
export const HOMATCH_PRIVACY_HOST = /(^|\.)homatch\.live$/i;

export function privacyIsHomatch(url: string | null | undefined): boolean {
  try { return HOMATCH_PRIVACY_HOST.test(new URL(String(url ?? '')).hostname); } catch { return false; }
}

/** The readiness summary the owner reads before anything is sent to Meta. */
export function leadFormReadiness(spec: LeadFormSpec): ReadinessItem[] {
  const issues = validateLeadFormSpec(spec);
  const has = (field: string) => issues.some((i) => i.field === field);
  const nQuestions = spec.questions.length + (spec.customQuestions ?? []).length;
  return [
    { key: 'basics', state: has('name') || has('locale') || has('headline') || has('intro') ? 'todo' : 'ok' },
    { key: 'contact', state: has('contactFields') ? 'todo' : 'ok' },
    { key: 'questions', state: has('questions') || has('customQuestions') ? 'todo' : nQuestions === 0 ? 'warn' : 'ok', code: nQuestions === 0 ? 'NO_QUESTIONS' : undefined },
    { key: 'privacy', state: has('privacyPolicyUrl') ? 'todo' : privacyIsHomatch(spec.privacyPolicyUrl) ? 'warn' : 'ok', code: privacyIsHomatch(spec.privacyPolicyUrl) ? 'PRIVACY_IS_HOMATCH' : undefined },
    { key: 'completion', state: has('thankYouMessage') || has('thankYouTitle') || has('followUpUrl') ? 'todo' : 'ok' },
    { key: 'meta', state: issues.length ? 'todo' : 'ok' },
  ];
}
