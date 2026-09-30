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

const Q: Record<QualifyingKey, QuestionDef> = {
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

export interface LeadFormSpec {
  name: string;
  headline?: string | null;
  /** Shown after submission (Meta's thank-you screen). */
  thankYouMessage?: string | null;
  contactFields: ContactField[];
  questions: QualifyingKey[];
  privacyPolicyUrl: string;
  followUpUrl?: string | null;
  locale: FormLocale;
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
  if ((spec.questions ?? []).length > 5) issues.push({ code: 'TOO_MANY_QUESTIONS', field: 'questions' });
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
  const payload: Record<string, unknown> = {
    name: spec.name.trim().slice(0, 100),
    locale: META_LOCALE[loc],
    questions: JSON.stringify(questions),
    privacy_policy: JSON.stringify({ url: spec.privacyPolicyUrl, link_text: PRIVACY_LINK_TEXT[loc] }),
    thank_you_page: JSON.stringify(spec.followUpUrl
      ? { title: THANKS_TITLE[loc], body: String(spec.thankYouMessage || THANKS_BODY[loc]).slice(0, 500), button_type: 'VIEW_WEBSITE', button_text: VISIT[loc], website_url: spec.followUpUrl }
      : { title: THANKS_TITLE[loc], body: String(spec.thankYouMessage || THANKS_BODY[loc]).slice(0, 500), button_type: 'NONE' }),
  };
  if (spec.headline) payload.question_page_custom_headline = spec.headline.slice(0, 60);
  if (spec.followUpUrl) payload.follow_up_action_url = spec.followUpUrl;
  return payload;
}

/** The preview the builder shows — the same labels Meta will show. */
export function leadFormPreview(spec: LeadFormSpec) {
  const loc = spec.locale;
  return {
    headline: spec.headline ?? null,
    contact: spec.contactFields,
    questions: spec.questions.map((k) => ({ key: k, label: Q[k].label[loc], options: Q[k].options?.map((o) => o.label[loc]) ?? null })),
    thankYou: { title: THANKS_TITLE[loc], body: spec.thankYouMessage || THANKS_BODY[loc] },
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
