/*
 * HOMI — VERIFIED, APPROVED ANSWERS THAT NEED NO MODEL.
 *
 * Everything here is written by HOMATCH, not generated. A turn that matches
 * one of these intents is answered from this file: instantly, identically
 * every time, and at zero AI cost. That is the "internal first" rule made
 * literal — the cheapest and most accurate answer to "what is Verify?" is the
 * one HOMATCH already wrote down.
 *
 * Rules for anything added here:
 *   - only claims about products that exist, at routes that exist;
 *   - no prices (each product states its own before anything starts);
 *   - no invented contact details, people, ownership or statistics;
 *   - Georgian first and natural, informal singular ("შენ"), the product's
 *     terminology (see docs/claude/HOMI_GLOSSARY.md).
 *
 * Runtime-neutral: no React, no Deno, no Supabase, explicit .ts imports. The
 * edge function imports this by relative path; the browser and node:test
 * import it directly.
 */

import type { HomiCardRef } from './cards.ts';

export const HOMI_LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
export type HomiLocale = typeof HOMI_LOCALES[number];
export type L6 = Record<HomiLocale, string>;

export function pick(text: L6, locale: string): string {
  return (text as Record<string, string>)[locale] ?? text.ka;
}

/** Every intent HOMI can answer deterministically. A closed set. */
export const HOMI_DETERMINISTIC_INTENTS = [
  'GREETING', 'START', 'IDENTITY', 'MODEL_QUESTION', 'CAPABILITIES', 'THANKS', 'GOODBYE', 'CONTACT',
  'SERVICE_VERIFY', 'SERVICE_MORTGAGE', 'SERVICE_INVESTMENT', 'SERVICE_CONTRACTS', 'SERVICE_EXPATS',
  'SERVICE_FIND_PROPERTY', 'SERVICE_FIND_BUYERS', 'SERVICE_BROKERS',
  'FIND_PROPERTY', 'PROPERTY_PRICE', 'ROI_QUICK', 'MORTGAGE_QUICK', 'MORTGAGE_DOCS',
  'MORTGAGE_DOCS_SALARIED', 'MORTGAGE_DOCS_SELF_EMPLOYED', 'MORTGAGE_DOCS_BUSINESS_OWNER',
  'MORTGAGE_DOCS_FREELANCER', 'MORTGAGE_DOCS_RENTAL', 'MORTGAGE_DOCS_EMIGRANT', 'MORTGAGE_DOCS_FOREIGN_INCOME', 'MORTGAGE_DOCS_FOREIGN_NATIONAL',
  'MORTGAGE_DOCS_CO_BORROWER', 'OTHER_QUESTION', 'PLANS', 'HOMI_FREE',
] as const;
export type HomiDeterministicIntent = typeof HOMI_DETERMINISTIC_INTENTS[number];

export function isHomiIntent(v: unknown): v is HomiDeterministicIntent {
  return typeof v === 'string' && (HOMI_DETERMINISTIC_INTENTS as readonly string[]).includes(v);
}

/** A chip HOMI offers. `intent` routes the click straight back to this file. */
export interface HomiChip { label: L6; intent?: HomiDeterministicIntent }

/** Which character state the reply is spoken in (the avatar, not the model). */
export type HomiMood = 'greeting' | 'happy' | 'explaining' | 'encouraging' | 'pointing' | 'goodbye' | 'listening';

export interface HomiTemplate {
  text: L6;
  chips?: HomiChip[];
  /** Service action IDs from src/lib/ai/serviceActions.ts. */
  actions?: string[];
  cards?: HomiCardRef[];
  mood?: HomiMood;
}

/* ── Authoritative product copy (task specification, 2026-10-24) ─────────── */

export const HOMI_INTRO: L6 = {
  ka: 'გამარჯობა! მე HOMI ვარ, HOMATCH-ის შენი პერსონალური ასისტენტი. 🏡 მითხარი, რაში გჭირდება დახმარება, ან აირჩიე სასურველი მიმართულება.',
  en: "Hi! I'm HOMI, your personal HOMATCH assistant. 🏡 Tell me what you need help with, or choose where you'd like to start.",
  ru: 'Привет! Я HOMI, твой персональный ассистент HOMATCH. 🏡 Расскажи, с чем нужна помощь, или выбери, с чего начать.',
  tr: 'Merhaba! Ben HOMI, kişisel HOMATCH asistanın. 🏡 Neye ihtiyacın olduğunu söyle ya da nereden başlamak istediğini seç.',
  ar: 'مرحبًا! أنا HOMI، مساعدك الشخصي في HOMATCH. 🏡 أخبرني بما تحتاج إليه، أو اختر من أين تريد أن تبدأ.',
  he: 'היי! אני HOMI, העוזר האישי שלך ב-HOMATCH. 🏡 ספר לי במה אפשר לעזור, או בחר מאיפה להתחיל.',
};

export const HOMI_START_TITLE: L6 = {
  ka: 'რით დავიწყოთ?', en: 'Where shall we start?', ru: 'С чего начнём?',
  tr: 'Nereden başlayalım?', ar: 'من أين نبدأ؟', he: 'מאיפה נתחיל?',
};

const C = {
  findProperty: { ka: 'ბინის მოძებნა', en: 'Find a home', ru: 'Найти жильё', tr: 'Ev bul', ar: 'ابحث عن منزل', he: 'למצוא דירה' },
  verify: { ka: 'ქონების შემოწმება', en: 'Check a property', ru: 'Проверить недвижимость', tr: 'Mülkü kontrol et', ar: 'فحص عقار', he: 'לבדוק נכס' },
  investment: { ka: 'ინვესტიციის შეფასება', en: 'Assess an investment', ru: 'Оценить инвестицию', tr: 'Yatırımı değerlendir', ar: 'تقييم الاستثمار', he: 'להעריך השקעה' },
  mortgage: { ka: 'იპოთეკის გამოთვლა', en: 'Calculate a mortgage', ru: 'Рассчитать ипотеку', tr: 'Konut kredisi hesapla', ar: 'احسب الرهن العقاري', he: 'לחשב משכנתא' },
  contract: { ka: 'ხელშეკრულების შემოწმება', en: 'Check a contract', ru: 'Проверить договор', tr: 'Sözleşmeyi kontrol et', ar: 'فحص عقد', he: 'לבדוק חוזה' },
  expat: { ka: 'საქართველოში გადმოსვლა', en: 'Moving to Georgia', ru: 'Переезд в Грузию', tr: "Gürcistan'a taşınma", ar: 'الانتقال إلى جورجيا', he: 'מעבר לגאורגיה' },
  other: { ka: 'სხვა კითხვა მაქვს', en: 'I have another question', ru: 'У меня другой вопрос', tr: 'Başka bir sorum var', ar: 'لدي سؤال آخر', he: 'יש לי שאלה אחרת' },
  helpChoose: { ka: 'დამეხმარე არჩევაში', en: 'Help me choose', ru: 'Помоги выбрать', tr: 'Seçmeme yardım et', ar: 'ساعدني في الاختيار', he: 'עזור לי לבחור' },
  simpler: { ka: 'უფრო მარტივად ამიხსენი', en: 'Explain it more simply', ru: 'Объясни проще', tr: 'Daha basit anlat', ar: 'اشرح بشكل أبسط', he: 'תסביר יותר פשוט' },
  more: { ka: 'მეტი დეტალი', en: 'More detail', ru: 'Подробнее', tr: 'Daha fazla ayrıntı', ar: 'تفاصيل أكثر', he: 'עוד פרטים' },
  docs: { ka: 'რა დოკუმენტები დამჭირდება?', en: 'What documents will I need?', ru: 'Какие документы понадобятся?', tr: 'Hangi belgeler gerekecek?', ar: 'ما المستندات التي سأحتاجها؟', he: 'אילו מסמכים אצטרך?' },
  monthly: { ka: 'ჩემი სავარაუდო ყოველთვიური შენატანი', en: 'My estimated monthly payment', ru: 'Мой примерный ежемесячный платёж', tr: 'Tahmini aylık taksitim', ar: 'قسطي الشهري التقديري', he: 'ההחזר החודשי המשוער שלי' },
  showOptions: { ka: 'მაჩვენე ვარიანტები', en: 'Show me the options', ru: 'Покажи варианты', tr: 'Seçenekleri göster', ar: 'أرني الخيارات', he: 'תראה לי אפשרויות' },
  nextStep: { ka: 'შემდეგი ნაბიჯი', en: 'Next step', ru: 'Следующий шаг', tr: 'Sonraki adım', ar: 'الخطوة التالية', he: 'השלב הבא' },
  prevStep: { ka: 'წინა ნაბიჯი', en: 'Previous step', ru: 'Предыдущий шаг', tr: 'Önceki adım', ar: 'الخطوة السابقة', he: 'השלב הקודם' },
  coBorrower: { ka: 'რა არის თანამსესხებელი?', en: 'What is a co-borrower?', ru: 'Кто такой созаёмщик?', tr: 'Ortak borçlu nedir?', ar: 'من هو المقترض المشارك؟', he: 'מה זה לווה נוסף?' },
} satisfies Record<string, L6>;

/** The seven starting directions (a START card, never more than one per reply). */
export const HOMI_START_OPTIONS: HomiChip[] = [
  { label: C.findProperty, intent: 'FIND_PROPERTY' },
  { label: C.verify, intent: 'SERVICE_VERIFY' },
  { label: C.investment, intent: 'ROI_QUICK' },
  { label: C.mortgage, intent: 'SERVICE_MORTGAGE' },
  { label: C.contract, intent: 'SERVICE_CONTRACTS' },
  { label: C.expat, intent: 'SERVICE_EXPATS' },
  { label: C.other, intent: 'OTHER_QUESTION' },
];

export const EMPLOYMENT_PROFILES = [
  'SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER', 'FREELANCER', 'RENTAL', 'EMIGRANT', 'FOREIGN_INCOME', 'FOREIGN_NATIONAL', 'CO_BORROWER',
] as const;
export type EmploymentProfile = typeof EMPLOYMENT_PROFILES[number];

export const EMPLOYMENT_LABEL: Record<EmploymentProfile, L6> = {
  SALARIED: { ka: 'ხელფასს ვიღებ', en: 'I receive a salary', ru: 'Получаю зарплату', tr: 'Maaş alıyorum', ar: 'أتقاضى راتبًا', he: 'אני שכיר' },
  SELF_EMPLOYED: { ka: 'თვითდასაქმებული ვარ', en: "I'm self-employed", ru: 'Я самозанятый', tr: 'Serbest çalışıyorum', ar: 'أعمل لحسابي', he: 'אני עצמאי' },
  BUSINESS_OWNER: { ka: 'ბიზნესის მფლობელი ვარ', en: 'I own a business', ru: 'У меня свой бизнес', tr: 'İşletme sahibiyim', ar: 'أملك شركة', he: 'יש לי עסק' },
  FREELANCER: { ka: 'ფრილანსერი ვარ', en: "I'm a freelancer", ru: 'Я фрилансер', tr: 'Freelancer’ım', ar: 'أعمل بشكل مستقل', he: 'אני פרילנסר' },
  RENTAL: { ka: 'ქირიდან მაქვს შემოსავალი', en: 'My income is from rent', ru: 'Мой доход от аренды', tr: 'Gelirim kiradan', ar: 'دخلي من الإيجار', he: 'ההכנסה שלי משכירות' },
  EMIGRANT: { ka: 'საზღვარგარეთ ვმუშაობ', en: 'I work abroad', ru: 'Работаю за границей', tr: 'Yurt dışında çalışıyorum', ar: 'أعمل في الخارج', he: 'אני עובד בחו״ל' },
  FOREIGN_INCOME: { ka: 'შემოსავალს საზღვარგარეთიდან ვიღებ', en: 'My income comes from abroad', ru: 'Мой доход поступает из-за границы', tr: 'Gelirim yurt dışından geliyor', ar: 'دخلي يأتي من الخارج', he: 'ההכנסה שלי מגיעה מחו״ל' },
  FOREIGN_NATIONAL: { ka: 'უცხო ქვეყნის მოქალაქე ვარ', en: "I'm a foreign national", ru: 'Я иностранный гражданин', tr: 'Yabancı uyrukluyum', ar: 'أنا مواطن أجنبي', he: 'אני אזרח זר' },
  CO_BORROWER: { ka: 'თანამსესხებელი მყავს', en: 'I have a co-borrower', ru: 'У меня есть созаёмщик', tr: 'Ortak borçlum var', ar: 'لدي مقترض مشارك', he: 'יש לי לווה נוסף' },
};

const DOCS_DISCLAIMER: L6 = {
  ka: 'ეს ზოგადი ჩამონათვალია. ზუსტ სიას ყოველი ბანკი თავად ადგენს, ამიტომ განაცხადამდე ბანკთან გადაამოწმე.',
  en: 'This is a general list. Each bank sets its own exact requirements, so confirm with the bank before you apply.',
  ru: 'Это общий список. Точные требования устанавливает каждый банк, поэтому уточни их в банке перед подачей заявки.',
  tr: 'Bu genel bir listedir. Kesin şartları her banka kendisi belirler, başvurmadan önce bankayla teyit et.',
  ar: 'هذه قائمة عامة، ويحدد كل بنك متطلباته الدقيقة، لذا تحقق منها مع البنك قبل التقديم.',
  he: 'זו רשימה כללית. כל בנק קובע את הדרישות המדויקות שלו, אז כדאי לוודא מולו לפני הגשת הבקשה.',
};

function docsTemplate(profile: EmploymentProfile): HomiTemplate {
  const lead: L6 = {
    ka: `აი, დოკუმენტების ჩვეულებრივი ჩამონათვალი შენი შემთხვევისთვის. ${DOCS_DISCLAIMER.ka}`,
    en: `Here's the usual document list for your situation. ${DOCS_DISCLAIMER.en}`,
    ru: `Вот обычный список документов для твоей ситуации. ${DOCS_DISCLAIMER.ru}`,
    tr: `Durumun için olağan belge listesi burada. ${DOCS_DISCLAIMER.tr}`,
    ar: `إليك قائمة المستندات المعتادة لحالتك. ${DOCS_DISCLAIMER.ar}`,
    he: `הנה רשימת המסמכים הרגילה למצב שלך. ${DOCS_DISCLAIMER.he}`,
  };
  return {
    text: lead,
    cards: [{ type: 'CHECKLIST', id: `mortgage_docs_${profile.toLowerCase()}` }],
    actions: ['MORTGAGE'],
    chips: [{ label: C.prevStep, intent: 'MORTGAGE_DOCS' }, { label: C.nextStep, intent: 'MORTGAGE_QUICK' }, { label: C.coBorrower }],
    mood: 'explaining',
  };
}

export const HOMI_TEMPLATES: Record<HomiDeterministicIntent, HomiTemplate> = {
  GREETING: { text: HOMI_INTRO, cards: [{ type: 'START' }], mood: 'greeting' },
  START: { text: HOMI_INTRO, cards: [{ type: 'START' }], mood: 'greeting' },

  IDENTITY: {
    text: {
      ka: 'მე HOMI ვარ, HOMATCH-ის ასისტენტი. ხელოვნური ინტელექტი ვარ და არა ადამიანი. 🙂 შემქმნეს HOMATCH-ის მომხმარებლებისთვის, რომ უძრავ ქონებასთან დაკავშირებული გადაწყვეტილებები უფრო მარტივად მიიღონ. რით დავიწყოთ?',
      en: "I'm HOMI, HOMATCH's assistant. I'm an AI, not a person. 🙂 I was made for HOMATCH users, to make real estate decisions easier. Where shall we start?",
      ru: 'Я HOMI, ассистент HOMATCH. Я искусственный интеллект, а не человек. 🙂 Меня создали для пользователей HOMATCH, чтобы решения о недвижимости давались проще. С чего начнём?',
      tr: 'Ben HOMI, HOMATCH’in asistanıyım. Bir yapay zekâyım, insan değilim. 🙂 Emlak kararlarını kolaylaştırmak için HOMATCH kullanıcıları için yaratıldım. Nereden başlayalım?',
      ar: 'أنا HOMI، مساعد HOMATCH. أنا ذكاء اصطناعي ولست إنسانًا. 🙂 صُممت لمستخدمي HOMATCH لتسهيل قراراتهم العقارية. من أين نبدأ؟',
      he: 'אני HOMI, העוזר של HOMATCH. אני בינה מלאכותית, לא בן אדם. 🙂 נוצרתי בשביל משתמשי HOMATCH, כדי שיהיה קל יותר לקבל החלטות בנדל״ן. מאיפה נתחיל?',
    },
    cards: [{ type: 'START' }],
    mood: 'happy',
  },

  MODEL_QUESTION: {
    text: {
      ka: 'HOMI თანამედროვე ხელოვნური ინტელექტის ტექნოლოგიებზეა აგებული. კონკრეტული მოდელები შეიძლება შეიცვალოს, რადგან HOMATCH თითოეული ამოცანისთვის საუკეთესო სისტემას ირჩევს. მთავარი კი ისაა, რომ HOMATCH-ის ინსტრუმენტებთან და მონაცემებთან ვმუშაობ. რაში დაგეხმარო?',
      en: "HOMI is built on modern AI technology. The specific models can change, because HOMATCH picks the best system for each task. What matters is that I work with HOMATCH's own tools and data. What can I help with?",
      ru: 'HOMI построен на современных технологиях ИИ. Конкретные модели могут меняться: HOMATCH выбирает лучшую систему для каждой задачи. Главное, что я работаю с инструментами и данными HOMATCH. Чем помочь?',
      tr: 'HOMI modern yapay zekâ teknolojileri üzerine kurulu. Kullanılan modeller değişebilir, çünkü HOMATCH her iş için en iyi sistemi seçer. Önemli olan, HOMATCH’in kendi araçları ve verileriyle çalışmam. Nasıl yardımcı olabilirim?',
      ar: 'HOMI مبني على تقنيات الذكاء الاصطناعي الحديثة. قد تتغير النماذج المستخدمة، إذ تختار HOMATCH أفضل نظام لكل مهمة. المهم أنني أعمل بأدوات HOMATCH وبياناتها. كيف أساعدك؟',
      he: 'HOMI בנוי על טכנולוגיות בינה מלאכותית מודרניות. המודלים עצמם יכולים להשתנות, כי HOMATCH בוחרת את המערכת הטובה ביותר לכל משימה. מה שחשוב הוא שאני עובד עם הכלים והנתונים של HOMATCH. במה אפשר לעזור?',
    },
    cards: [{ type: 'START' }],
    mood: 'explaining',
  },

  CAPABILITIES: {
    text: {
      ka: 'აი, რაში შემიძლია დაგეხმარო:\n\n- **ქონების მოძებნა**: აღწერე, რას ეძებ, და მოძებნის გეგმას ერთად ავაწყობთ\n- **ქონების შემოწმება**: მესაკუთრე, იპოთეკა, შეზღუდვები და დეველოპერი ოფიციალური წყაროებით\n- **საინვესტიციო შეფასება**: შემოსავალი, ხარჯები და უკუგება სხვადასხვა სცენარით\n- **იპოთეკის კონსულტანტი**: ყოველთვიური შენატანი და სესხისთვის მზადყოფნა\n- **ხელშეკრულების ანალიზი**: რისკიანი პირობები და უფრო უსაფრთხო ფორმულირებები\n- **საქართველოში გადმოსვლა**: შენი პირადი გეგმა ნაბიჯ-ნაბიჯ',
      en: "Here's what I can help with:\n\n- **Finding a property**: describe what you're after and we'll build a search plan together\n- **Property check**: owner, mortgage, restrictions and developer, from official sources\n- **Investment analysis**: income, expenses and return across scenarios\n- **Mortgage Consultant**: monthly payment and loan readiness\n- **Contract analysis**: risky terms and safer wording\n- **Moving to Georgia**: your own step-by-step plan",
      ru: 'Вот с чем я могу помочь:\n\n- **Поиск недвижимости**: опиши, что ищешь, и мы вместе составим план поиска\n- **Проверка недвижимости**: собственник, ипотека, ограничения и застройщик по официальным источникам\n- **Инвестиционный анализ**: доход, расходы и доходность в разных сценариях\n- **Ипотечный консультант**: ежемесячный платёж и готовность к кредиту\n- **Анализ договора**: рискованные условия и более безопасные формулировки\n- **Переезд в Грузию**: твой личный пошаговый план',
      tr: 'Sana şu konularda yardımcı olabilirim:\n\n- **Mülk arama**: ne aradığını anlat, arama planını birlikte kuralım\n- **Mülk kontrolü**: resmî kaynaklardan malik, ipotek, kısıtlamalar ve geliştirici\n- **Yatırım analizi**: farklı senaryolarda gelir, gider ve getiri\n- **Konut kredisi danışmanı**: aylık taksit ve krediye hazırlık\n- **Sözleşme analizi**: riskli maddeler ve daha güvenli ifadeler\n- **Gürcistan’a taşınma**: adım adım kişisel planın',
      ar: 'إليك ما يمكنني مساعدتك فيه:\n\n- **البحث عن عقار**: صف ما تبحث عنه وسنضع خطة البحث معًا\n- **فحص العقار**: المالك والرهن والقيود والمطوّر من مصادر رسمية\n- **تحليل الاستثمار**: الدخل والمصاريف والعائد في سيناريوهات مختلفة\n- **مستشار الرهن العقاري**: القسط الشهري ومدى الجاهزية للقرض\n- **تحليل العقود**: الشروط الخطرة وصياغات أكثر أمانًا\n- **الانتقال إلى جورجيا**: خطتك الشخصية خطوة بخطوة',
      he: 'הנה במה אני יכול לעזור:\n\n- **חיפוש נכס**: תאר מה אתה מחפש ונבנה יחד תוכנית חיפוש\n- **בדיקת נכס**: בעלים, משכנתא, הגבלות ויזם, ממקורות רשמיים\n- **ניתוח השקעה**: הכנסה, הוצאות ותשואה בתרחישים שונים\n- **יועץ משכנתאות**: החזר חודשי ומוכנות להלוואה\n- **ניתוח חוזה**: סעיפים מסוכנים וניסוחים בטוחים יותר\n- **מעבר לגאורגיה**: התוכנית האישית שלך, צעד אחר צעד',
    },
    cards: [{ type: 'START' }],
    mood: 'explaining',
  },

  THANKS: {
    text: {
      ka: 'სიამოვნებით! 😊 კიდევ რამე თუ დაგჭირდება, აქ ვარ.',
      en: "Any time! 😊 I'm here if you need anything else.",
      ru: 'Всегда пожалуйста! 😊 Если что-то ещё понадобится, я здесь.',
      tr: 'Rica ederim! 😊 Başka bir şeye ihtiyacın olursa buradayım.',
      ar: 'على الرحب والسعة! 😊 أنا هنا إن احتجت أي شيء آخر.',
      he: 'בכיף! 😊 אני כאן אם תצטרך עוד משהו.',
    },
    chips: [{ label: C.showOptions, intent: 'START' }, { label: C.other, intent: 'OTHER_QUESTION' }, { label: C.helpChoose, intent: 'START' }],
    mood: 'happy',
  },

  GOODBYE: {
    text: {
      ka: 'კარგად იყავი! 👋 როცა დაგჭირდები, აქ ვიქნები.',
      en: "Take care! 👋 I'll be here whenever you need me.",
      ru: 'Всего доброго! 👋 Я буду здесь, когда понадоблюсь.',
      tr: 'Kendine iyi bak! 👋 İhtiyacın olduğunda buradayım.',
      ar: 'إلى اللقاء! 👋 سأكون هنا متى احتجتني.',
      he: 'להתראות! 👋 אני כאן מתי שתצטרך.',
    },
    mood: 'goodbye',
  },

  CONTACT: {
    text: {
      ka: 'HOMATCH-ის გუნდს საკონტაქტო გვერდიდან მისწერე და შეტყობინება პირდაპირ გუნდთან მივა. 📬',
      en: 'You can write to the HOMATCH team from the contact page, and your message goes straight to the team. 📬',
      ru: 'Написать команде HOMATCH можно со страницы контактов, и сообщение придёт прямо команде. 📬',
      tr: 'HOMATCH ekibine iletişim sayfasından yazabilirsin, mesajın doğrudan ekibe ulaşır. 📬',
      ar: 'يمكنك مراسلة فريق HOMATCH من صفحة التواصل، وستصل رسالتك مباشرة إلى الفريق. 📬',
      he: 'אפשר לכתוב לצוות HOMATCH מעמוד יצירת הקשר, וההודעה מגיעה ישירות לצוות. 📬',
    },
    actions: ['CONTACT'],
    mood: 'pointing',
  },

  SERVICE_VERIFY: {
    text: {
      ka: '**ქონების შემოწმება (Verify)** ერთ კონკრეტულ ქონებას ოფიციალურ რეესტრებსა და საჯარო წყაროებში იკვლევს და მყიდველისთვის ანგარიშს ამზადებს: ვინ არის მესაკუთრე, აქვს თუ არა იპოთეკა ან შეზღუდვა, ნამდვილია თუ არა დეველოპერი და რამდენად ლოგიკურია ფასი. დასაწყებად საკადასტრო კოდი ან მისამართი საკმარისია, ფასს კი დაწყებამდე სერვისის გვერდზე ნახავ.',
      en: "**Property check (Verify)** researches one specific property across official registries and public sources and prepares a buyer's report: who owns it, whether there's a mortgage or restriction, whether the developer is real and whether the price makes sense. A cadastral code or address is enough to start, and you'll see the price on the service page before anything begins.",
      ru: '**Проверка недвижимости (Verify)** исследует один конкретный объект по официальным реестрам и открытым источникам и готовит отчёт для покупателя: кто собственник, есть ли ипотека или ограничения, реален ли застройщик и обоснована ли цена. Для начала достаточно кадастрового кода или адреса, а цену ты увидишь на странице сервиса до запуска.',
      tr: '**Mülk kontrolü (Verify)** tek bir mülkü resmî siciller ve açık kaynaklarda araştırır ve alıcı raporu hazırlar: malik kim, ipotek veya kısıtlama var mı, geliştirici gerçek mi ve fiyat mantıklı mı. Başlamak için ada-parsel kodu ya da adres yeterli; fiyatı başlamadan önce hizmet sayfasında görürsün.',
      ar: '**فحص العقار (Verify)** يبحث في عقار محدد عبر السجلات الرسمية والمصادر العامة ويعدّ تقريرًا للمشتري: من المالك، وهل يوجد رهن أو قيد، وهل المطوّر حقيقي، وهل السعر منطقي. يكفي الرمز المساحي أو العنوان للبدء، وسترى السعر في صفحة الخدمة قبل أي خطوة.',
      he: '**בדיקת נכס (Verify)** חוקרת נכס מסוים במרשמים רשמיים ובמקורות פתוחים ומכינה דוח לקונה: מי הבעלים, האם יש משכנתא או הגבלה, האם היזם אמיתי והאם המחיר הגיוני. מספיק קוד קדסטרלי או כתובת כדי להתחיל, ואת המחיר תראה בעמוד השירות לפני שמשהו מתחיל.',
    },
    actions: ['VERIFY'],
    chips: [{ label: C.simpler }, { label: C.more }, { label: C.other, intent: 'OTHER_QUESTION' }],
    mood: 'explaining',
  },

  SERVICE_MORTGAGE: {
    text: {
      ka: '**იპოთეკის კონსულტანტი** გაჩვენებს რეალურ ყოველთვიურ შენატანს და სრულ ღირებულებას, იმ ხარჯების ჩათვლით, რომლებსაც ბანკის შეთავაზება ხშირად არ აჩვენებს. ასევე შეგიძლია შეამოწმო, რამდენად მზად ხარ სესხისთვის ეროვნული ბანკის მოქმედი წესების მიხედვით. ეს ბანკის გადაწყვეტილება არ არის, მაგრამ კარგად გაჩვენებს, სად დგახარ.',
      en: "**Mortgage Consultant** shows the real monthly payment and total cost, including the fees a bank quote often leaves out. You can also check how ready you are for a loan under the National Bank of Georgia's current rules. It isn't a bank decision, but it shows clearly where you stand.",
      ru: '**Ипотечный консультант** покажет реальный ежемесячный платёж и полную стоимость, включая расходы, которые банк в предложении часто не показывает. Также можно проверить готовность к кредиту по действующим правилам Национального банка Грузии. Это не решение банка, но хорошо показывает, где ты сейчас.',
      tr: '**Konut kredisi danışmanı** gerçek aylık taksiti ve toplam maliyeti, banka teklifinin çoğu zaman göstermediği masraflar dahil gösterir. Gürcistan Ulusal Bankası’nın yürürlükteki kurallarına göre krediye ne kadar hazır olduğunu da kontrol edebilirsin. Bu bir banka kararı değil ama nerede durduğunu net gösterir.',
      ar: '**مستشار الرهن العقاري** يعرض القسط الشهري الحقيقي والتكلفة الكاملة، بما فيها الرسوم التي لا يظهرها عرض البنك غالبًا. ويمكنك أيضًا معرفة مدى جاهزيتك للقرض وفق القواعد السارية للبنك الوطني الجورجي. هذا ليس قرار البنك، لكنه يوضح موقفك بدقة.',
      he: '**יועץ המשכנתאות** מציג את ההחזר החודשי האמיתי ואת העלות הכוללת, כולל עמלות שהצעת הבנק לא תמיד מראה. אפשר גם לבדוק עד כמה אתה מוכן להלוואה לפי הכללים התקפים של הבנק הלאומי של גאורגיה. זו לא החלטת בנק, אבל זה מראה בבירור איפה אתה עומד.',
    },
    actions: ['MORTGAGE'],
    chips: [{ label: C.monthly, intent: 'MORTGAGE_QUICK' }, { label: C.docs, intent: 'MORTGAGE_DOCS' }, { label: C.coBorrower }],
    mood: 'explaining',
  },

  SERVICE_INVESTMENT: {
    text: {
      ka: '**საინვესტიციო შეფასება** გაჩვენებს, რამდენის მოტანა შეუძლია ქონებას: ქირის შემოსავალი, ხარჯები, წმინდა შემოსავალი, უკუგება და სხვადასხვა სცენარი. ყველა დაშვება ცალკეა მონიშნული, ასე რომ, ხედავ, რა არის ფაქტი და რა შეფასება. სწრაფი გამოთვლა აქვე შეგვიძლია.',
      en: "**Investment analysis** shows what a property could earn: rental income, expenses, net income, return and different scenarios. Every assumption is labelled, so you can see what's fact and what's an estimate. We can run a quick calculation right here.",
      ru: '**Инвестиционный анализ** покажет, сколько может приносить объект: арендный доход, расходы, чистый доход, доходность и разные сценарии. Все допущения отмечены отдельно, так что видно, где факт, а где оценка. Быстрый расчёт можно сделать прямо здесь.',
      tr: '**Yatırım analizi** bir mülkün ne kazandırabileceğini gösterir: kira geliri, giderler, net gelir, getiri ve farklı senaryolar. Her varsayım ayrıca işaretlidir; neyin gerçek, neyin tahmin olduğunu görürsün. Hızlı bir hesabı burada yapabiliriz.',
      ar: '**تحليل الاستثمار** يوضح ما يمكن أن يدرّه العقار: دخل الإيجار والمصاريف وصافي الدخل والعائد وسيناريوهات مختلفة. كل افتراض موسوم بوضوح، فترى ما هو حقيقة وما هو تقدير. يمكننا إجراء حساب سريع هنا.',
      he: '**ניתוח השקעה** מראה כמה נכס יכול להכניס: הכנסה משכירות, הוצאות, הכנסה נטו, תשואה ותרחישים שונים. כל הנחה מסומנת, כך שרואים מה עובדה ומה הערכה. אפשר לעשות חישוב מהיר כאן.',
    },
    actions: ['INVESTMENT'],
    cards: [{ type: 'ROI_QUICK' }],
    mood: 'explaining',
  },

  SERVICE_CONTRACTS: {
    text: {
      ka: '**ხელშეკრულების ანალიზი**: ატვირთე ნასყიდობის ან ქირავნობის ხელშეკრულება (PDF ან DOCX) და აგიხსნი, რას ამბობს სინამდვილეში: ვალდებულებები, რისკიანი პირობები, ფინანსური დეტალები და ვადები. თითოეულ რისკიან მუხლზე შემოგთავაზებ უფრო უსაფრთხო ფორმულირებას, მიღებას კი შენ გადაწყვეტ. ეს იურიდიული კონსულტაცია არ არის.',
      en: "**Contract analysis**: upload a purchase or rental contract (PDF or DOCX) and I'll explain what it actually says: obligations, risky terms, financial details and deadlines. For each risky clause I'll suggest safer wording, and you decide what to accept. This isn't legal advice.",
      ru: '**Анализ договора**: загрузи договор купли-продажи или аренды (PDF или DOCX), и я объясню, что в нём на самом деле написано: обязательства, рискованные условия, финансовые детали и сроки. Для каждого рискованного пункта предложу более безопасную формулировку, а что принять, решаешь ты. Это не юридическая консультация.',
      tr: '**Sözleşme analizi**: satış veya kira sözleşmesini (PDF ya da DOCX) yükle, gerçekte ne dediğini açıklayayım: yükümlülükler, riskli maddeler, mali ayrıntılar ve süreler. Her riskli madde için daha güvenli bir ifade öneririm, neyi kabul edeceğine sen karar verirsin. Bu hukuki danışmanlık değildir.',
      ar: '**تحليل العقود**: ارفع عقد بيع أو إيجار (PDF أو DOCX) وسأشرح ما يقوله فعلًا: الالتزامات والشروط الخطرة والتفاصيل المالية والمواعيد. لكل بند خطر سأقترح صياغة أكثر أمانًا، والقرار في القبول لك. هذه ليست استشارة قانونية.',
      he: '**ניתוח חוזה**: העלה חוזה מכר או שכירות (PDF או DOCX) ואסביר מה הוא אומר באמת: התחייבויות, תנאים מסוכנים, פרטים כספיים ומועדים. לכל סעיף מסוכן אציע ניסוח בטוח יותר, ואתה מחליט מה לקבל. זה לא ייעוץ משפטי.',
    },
    actions: ['CONTRACT_INTELLIGENCE'],
    mood: 'explaining',
  },

  SERVICE_EXPATS: {
    text: {
      ka: '**საქართველოში გადმოსვლის გზამკვლევი** დაგეხმარება, შენი პირადი გეგმა შეადგინო. რამდენიმე მარტივ კითხვას უპასუხებ და მიიღებ ნაბიჯ-ნაბიჯ ჩამონათვალს: საცხოვრებელი, დოკუმენტები, ბანკი და ყოველდღიური ცხოვრება. პროგრესი ინახება, ამიტომ ნებისმიერ დროს შეგიძლია გააგრძელო.',
      en: '**Moving to Georgia guide** helps you build your own plan. Answer a few simple questions and get a step-by-step checklist: housing, documents, banking and everyday life. Your progress is saved, so you can continue any time.',
      ru: '**Гид по переезду в Грузию** поможет составить твой личный план. Ответь на несколько простых вопросов и получи пошаговый чек-лист: жильё, документы, банк и повседневная жизнь. Прогресс сохраняется, так что продолжить можно в любой момент.',
      tr: '**Gürcistan’a taşınma rehberi** kendi planını oluşturmana yardım eder. Birkaç basit soruyu yanıtla, adım adım bir liste al: konut, belgeler, banka ve günlük yaşam. İlerlemen kaydedilir, istediğin zaman devam edebilirsin.',
      ar: '**دليل الانتقال إلى جورجيا** يساعدك على إعداد خطتك الخاصة. أجب عن بضعة أسئلة بسيطة واحصل على قائمة خطوة بخطوة: السكن والمستندات والبنك والحياة اليومية. يُحفظ تقدّمك، فيمكنك المتابعة في أي وقت.',
      he: '**המדריך למעבר לגאורגיה** עוזר לבנות תוכנית אישית. עונים על כמה שאלות פשוטות ומקבלים רשימה צעד אחר צעד: דיור, מסמכים, בנק וחיי היום-יום. ההתקדמות נשמרת, כך שאפשר להמשיך בכל זמן.',
    },
    actions: ['FOR_EXPATS'],
    mood: 'encouraging',
  },

  SERVICE_FIND_PROPERTY: {
    text: {
      ka: '**ქონების მოძებნაში** ჩვეულებრივი სიტყვებით აღწერ, რას ეძებ (უბანი, ბიუჯეტი, ოთახები), და HOMATCH ამას მოძებნის გეგმად აქცევს, რომელსაც შემდეგ თავად შეცვლი, მერე კი რეალურად ეძებს. ფასს დაწყებამდე ნახავ.',
      en: "**Find Property**: describe what you're looking for in plain words (area, budget, rooms) and HOMATCH turns it into a search plan you can edit, then actually searches. You'll see the price before it starts.",
      ru: '**Поиск недвижимости**: опиши обычными словами, что ищешь (район, бюджет, комнаты), и HOMATCH превратит это в план поиска, который можно изменить, а затем действительно найдёт. Цену увидишь до запуска.',
      tr: '**Mülk arama**: ne aradığını kendi kelimelerinle anlat (semt, bütçe, oda sayısı), HOMATCH bunu düzenleyebileceğin bir arama planına çevirir ve gerçekten arar. Fiyatı başlamadan önce görürsün.',
      ar: '**البحث عن عقار**: صف بكلماتك ما تبحث عنه (الحي والميزانية وعدد الغرف) وتحوّله HOMATCH إلى خطة بحث يمكنك تعديلها ثم تبحث فعلًا. سترى السعر قبل البدء.',
      he: '**חיפוש נכס**: מתארים במילים פשוטות מה מחפשים (שכונה, תקציב, חדרים) ו-HOMATCH הופכת את זה לתוכנית חיפוש שאפשר לערוך, ואז מחפשת בפועל. את המחיר רואים לפני שמתחילים.',
    },
    actions: ['FIND_PROPERTY'],
    mood: 'pointing',
  },

  SERVICE_FIND_BUYERS: {
    text: {
      ka: '**მყიდველის ან მოიჯარის მოძებნა**: დაამატე შენი ქონება და HOMATCH მოძებნის ადამიანებს, რომლებიც უკვე ეძებენ მსგავს ქონებას, ანუ პოტენციურად დაინტერესებულ პირებს. თითოეულ დამთხვევას თავისი მიზეზით ნახავ.',
      en: '**Find buyers or tenants**: add your property and HOMATCH looks for people already searching for something like it: potentially interested people. You see each match with its reasons.',
      ru: '**Поиск покупателя или арендатора**: добавь свой объект, и HOMATCH найдёт людей, которые уже ищут похожее, то есть потенциально заинтересованных лиц. Каждое совпадение показано с причинами.',
      tr: '**Alıcı veya kiracı bul**: mülkünü ekle, HOMATCH benzerini arayan kişileri, yani potansiyel olarak ilgilenen kişileri bulsun. Her eşleşmeyi gerekçesiyle görürsün.',
      ar: '**ابحث عن مشترٍ أو مستأجر**: أضف عقارك وستبحث HOMATCH عن أشخاص يبحثون بالفعل عن عقار مشابه، أي أشخاص قد يكونون مهتمين. ترى كل تطابق مع أسبابه.',
      he: '**מציאת קונים או שוכרים**: מוסיפים את הנכס ו-HOMATCH מחפשת אנשים שכבר מחפשים משהו דומה, כלומר אנשים שעשויים להתעניין. כל התאמה מוצגת עם הסיבות שלה.',
    },
    actions: ['FIND_BUYERS_TENANTS'],
    mood: 'pointing',
  },

  SERVICE_BROKERS: {
    text: {
      ka: '**ბროკერების კატალოგში** პროფესიონალს ბაზრისა და ენის მიხედვით იპოვი.',
      en: '**Brokers directory**: find a professional by market and language.',
      ru: '**Каталог брокеров**: найди специалиста по рынку и языку.',
      tr: '**Emlakçı rehberi**: pazara ve dile göre bir uzman bul.',
      ar: '**دليل الوسطاء**: ابحث عن مختص حسب السوق واللغة.',
      he: '**מדריך המתווכים**: מוצאים איש מקצוע לפי שוק ושפה.',
    },
    actions: ['BROKERS'],
    mood: 'pointing',
  },

  FIND_PROPERTY: {
    text: {
      ka: 'მოდი, ერთად მოვძებნოთ! 🏡 ქონების მოძებნაში უბრალოდ აღწერე, რას ეძებ (უბანი, მაქსიმალური ბიუჯეტი, ოთახების რაოდენობა), და მოძებნის გეგმას ავაწყობ, რომელსაც შემდეგ თავად შეცვლი. უფრო იაფ ვარიანტს თუ ეძებ, ბიუჯეტის ზღვრით დაიწყე.',
      en: "Let's find it together! 🏡 In Find Property, just describe what you want (area, maximum budget, number of rooms) and I'll build a search plan you can then adjust. Looking for something cheaper? Start with a budget limit.",
      ru: 'Давай поищем вместе! 🏡 В поиске недвижимости просто опиши, что нужно (район, максимальный бюджет, количество комнат), и я составлю план поиска, который потом можно поправить. Ищешь вариант подешевле? Начни с ограничения бюджета.',
      tr: 'Birlikte bulalım! 🏡 Mülk aramada ne istediğini anlat (semt, en yüksek bütçe, oda sayısı), sonra düzenleyebileceğin bir arama planı kurayım. Daha ucuz bir seçenek mi arıyorsun? Bütçe sınırıyla başla.',
      ar: 'لنبحث معًا! 🏡 في البحث عن عقار صف ما تريد (الحي والحد الأقصى للميزانية وعدد الغرف) وسأبني خطة بحث يمكنك تعديلها لاحقًا. تبحث عن خيار أرخص؟ ابدأ بحد للميزانية.',
      he: 'בוא נמצא את זה יחד! 🏡 בחיפוש נכס פשוט תאר מה אתה רוצה (שכונה, תקציב מקסימלי, מספר חדרים) ואבנה תוכנית חיפוש שתוכל לשנות. מחפש משהו זול יותר? תתחיל מתקרת תקציב.',
    },
    actions: ['FIND_PROPERTY'],
    chips: [{ label: C.showOptions, intent: 'START' }, { label: C.helpChoose, intent: 'START' }, { label: C.other, intent: 'OTHER_QUESTION' }],
    mood: 'pointing',
  },

  ROI_QUICK: {
    text: {
      ka: 'მოდი, სწრაფად გამოვთვალოთ. 📊 შეიყვანე ფასი, მოსალოდნელი ქირა და ხარჯები, შედეგი კი მაშინვე გამოჩნდება. ქირა და დაკავებულობა შენი დაშვებებია, ამიტომ რამდენიმე ვარიანტი სცადე.',
      en: "Let's do a quick calculation. 📊 Enter the price, expected rent and expenses, and the result appears straight away. Rent and occupancy are your assumptions, so try a few values.",
      ru: 'Давай быстро посчитаем. 📊 Введи цену, ожидаемую аренду и расходы, и результат появится сразу. Аренда и заполняемость это твои допущения, так что попробуй несколько вариантов.',
      tr: 'Hızlıca hesaplayalım. 📊 Fiyatı, beklenen kirayı ve giderleri gir, sonuç hemen görünsün. Kira ve doluluk senin varsayımların, birkaç değer dene.',
      ar: 'لنحسبها بسرعة. 📊 أدخل السعر والإيجار المتوقع والمصاريف وستظهر النتيجة فورًا. الإيجار ونسبة الإشغال افتراضاتك أنت، فجرّب عدة قيم.',
      he: 'בוא נחשב מהר. 📊 הכנס מחיר, שכירות צפויה והוצאות, והתוצאה תופיע מיד. השכירות והתפוסה הן ההנחות שלך, אז נסה כמה ערכים.',
    },
    cards: [{ type: 'ROI_QUICK' }],
    actions: ['INVESTMENT'],
    mood: 'encouraging',
  },

  MORTGAGE_QUICK: {
    text: {
      ka: 'მოდი, დავთვალოთ. 🧮 გადაწიე სლაიდერები და ყოველთვიური შენატანი მაშინვე შეიცვლება. სრული სურათისთვის, ხარჯებითა და მზადყოფნის შეფასებით, იპოთეკის კონსულტანტი გახსენი.',
      en: "Let's work it out. 🧮 Move the sliders and the monthly payment updates instantly. For the full picture, with fees and a readiness check, open the Mortgage Consultant.",
      ru: 'Давай посчитаем. 🧮 Двигай ползунки, и ежемесячный платёж сразу изменится. Полная картина с расходами и оценкой готовности есть в ипотечном консультанте.',
      tr: 'Hesaplayalım. 🧮 Kaydırıcıları oynat, aylık taksit anında güncellenir. Masraflar ve hazırlık değerlendirmesiyle tam tablo için konut kredisi danışmanını aç.',
      ar: 'لنحسبها. 🧮 حرّك المؤشرات وسيتغير القسط الشهري فورًا. للصورة الكاملة مع الرسوم وتقييم الجاهزية افتح مستشار الرهن العقاري.',
      he: 'בוא נחשב. 🧮 הזז את המחוונים וההחזר החודשי מתעדכן מיד. לתמונה המלאה, עם עמלות ובדיקת מוכנות, פתח את יועץ המשכנתאות.',
    },
    cards: [{ type: 'MORTGAGE_QUICK' }],
    actions: ['MORTGAGE'],
    chips: [{ label: C.prevStep, intent: 'SERVICE_MORTGAGE' }, { label: C.docs, intent: 'MORTGAGE_DOCS' }, { label: C.coBorrower }],
    mood: 'encouraging',
  },

  MORTGAGE_DOCS: {
    text: {
      ka: 'დოკუმენტები იმაზეა დამოკიდებული, საიდან იღებ შემოსავალს. აირჩიე შენი შემთხვევა და ჩამონათვალს გაჩვენებ:',
      en: 'The documents depend on where your income comes from. Pick your situation and I’ll show you the list:',
      ru: 'Документы зависят от того, откуда твой доход. Выбери свою ситуацию, и я покажу список:',
      tr: 'Belgeler gelirinin nereden geldiğine bağlı. Durumunu seç, listeyi göstereyim:',
      ar: 'تعتمد المستندات على مصدر دخلك. اختر حالتك وسأعرض لك القائمة:',
      he: 'המסמכים תלויים במקור ההכנסה שלך. בחר את המצב שלך ואראה לך את הרשימה:',
    },
    cards: [{ type: 'EMPLOYMENT_PICKER' }],
    mood: 'listening',
  },

  MORTGAGE_DOCS_SALARIED: docsTemplate('SALARIED'),
  MORTGAGE_DOCS_SELF_EMPLOYED: docsTemplate('SELF_EMPLOYED'),
  MORTGAGE_DOCS_BUSINESS_OWNER: docsTemplate('BUSINESS_OWNER'),
  MORTGAGE_DOCS_FREELANCER: docsTemplate('FREELANCER'),
  MORTGAGE_DOCS_RENTAL: docsTemplate('RENTAL'),
  MORTGAGE_DOCS_EMIGRANT: docsTemplate('EMIGRANT'),
  MORTGAGE_DOCS_FOREIGN_INCOME: docsTemplate('FOREIGN_INCOME'),
  MORTGAGE_DOCS_FOREIGN_NATIONAL: docsTemplate('FOREIGN_NATIONAL'),
  MORTGAGE_DOCS_CO_BORROWER: docsTemplate('CO_BORROWER'),

  OTHER_QUESTION: {
    text: {
      ka: 'რა თქმა უნდა! მკითხე, რაც გაინტერესებს: ქონება, უბანი, ფასი, ხელშეკრულება თუ სხვა რამ. ✍️',
      en: 'Of course! Ask me anything: a property, a neighbourhood, a price, a contract or something else. ✍️',
      ru: 'Конечно! Спрашивай что угодно: про объект, район, цену, договор или что-то ещё. ✍️',
      tr: 'Elbette! Ne merak ediyorsan sor: bir mülk, semt, fiyat, sözleşme ya da başka bir şey. ✍️',
      ar: 'بالتأكيد! اسألني عن أي شيء: عقار أو حي أو سعر أو عقد أو غير ذلك. ✍️',
      he: 'בטח! תשאל מה שמעניין אותך: נכס, שכונה, מחיר, חוזה או כל דבר אחר. ✍️',
    },
    chips: [{ label: C.showOptions, intent: 'START' }],
    mood: 'happy',
  },
  PROPERTY_PRICE: {
    text: {
      ka: 'ფასს ორი გზით შეგიძლია მიუახლოვდე. **ქონების შემოწმება (Verify)** კონკრეტულ ბინას ამოწმებს და აჩვენებს, რამდენად ლოგიკურია ფასი უბნის ბაზრის მონაცემებთან შედარებით. **ინვესტიციის შეფასება** კი გაჩვენებს, რა ღირს ქონება შენთვის შემოსავლისა და ზრდის მიხედვით. ზუსტ ფასს მე ვერ დავასახელებ, რეალური მონაცემების გარეშე ეს მხოლოდ გამოცნობა იქნებოდა. 🏡',
      en: "There are two ways to get at a price. **Property check (Verify)** looks at one specific property and shows how its price compares with the market in that area. **Investment assessment** shows what the property is worth to you in income and growth. I won't name a figure myself: without real data that would only be a guess. 🏡",
      ru: 'К цене можно подойти двумя путями. **Проверка недвижимости (Verify)** изучает конкретный объект и показывает, насколько цена соответствует рынку района. **Оценка инвестиции** показывает, чего стоит объект для тебя с точки зрения дохода и роста. Сам я цену называть не буду: без реальных данных это было бы гаданием. 🏡',
      tr: 'Fiyata iki yoldan ulaşabilirsin. **Mülk kontrolü (Verify)** belirli bir mülkü inceler ve fiyatının semt piyasasıyla nasıl karşılaştırıldığını gösterir. **Yatırım değerlendirmesi** ise mülkün gelir ve değer artışı açısından senin için ne ettiğini gösterir. Kendim bir rakam söylemem: gerçek veri olmadan bu sadece tahmin olur. 🏡',
      ar: 'يمكنك الوصول إلى السعر بطريقتين. **فحص العقار (Verify)** يدرس عقارًا محددًا ويبيّن كيف يقارن سعره بسوق المنطقة. و**تقييم الاستثمار** يوضح قيمة العقار لك من حيث الدخل والنمو. لن أذكر رقمًا بنفسي، فبدون بيانات حقيقية سيكون مجرد تخمين. 🏡',
      he: 'אפשר להגיע למחיר בשתי דרכים. **בדיקת נכס (Verify)** בודקת נכס מסוים ומראה איך המחיר שלו עומד מול השוק באזור. **הערכת השקעה** מראה כמה הנכס שווה לך מבחינת הכנסה וצמיחה. אני לא אנקוב בסכום בעצמי: בלי נתונים אמיתיים זה היה רק ניחוש. 🏡',
    },
    actions: ['VERIFY', 'INVESTMENT'],
    chips: [{ label: C.simpler }, { label: C.showOptions, intent: 'START' }],
    mood: 'explaining',
  },

  /* Plans: generic on purpose. The numbers live in Admin (subscription
     settings) and on the Pricing page, never in a written answer that could
     drift from them. */
  PLANS: {
    text: {
      ka: 'HOMATCH ყოველთვიური გეგმებით მუშაობს. ჩემთან საუბარი ყველა გეგმაში შეუზღუდავია. თითოეულ გეგმაში რა შედის და რა ღირს, **ფასების** გვერდზე ნახავ, ნებისმიერი სერვისი კი ფასს დაწყებამდე გაჩვენებს. 🙂',
      en: "HOMATCH works with monthly plans. Talking to me is unlimited in every plan. The **Pricing** page shows what each plan includes and what it costs, and every service shows its price before anything starts. 🙂",
      ru: 'HOMATCH работает по ежемесячным планам. Общение со мной безлимитно в любом плане. Что входит в каждый план и сколько он стоит, смотри на странице **Цены**, а любой сервис показывает цену до начала работы. 🙂',
      tr: 'HOMATCH aylık planlarla çalışır. Benimle konuşmak her planda sınırsızdır. Her planın neleri kapsadığını ve fiyatını **Fiyatlar** sayfasında görebilirsin; her hizmet de başlamadan önce fiyatını gösterir. 🙂',
      ar: 'تعمل HOMATCH بخطط شهرية. التحدث معي غير محدود في كل الخطط. تجد في صفحة **الأسعار** ما تتضمنه كل خطة وسعرها، وكل خدمة تعرض سعرها قبل أن تبدأ. 🙂',
      he: 'HOMATCH עובדת עם תוכניות חודשיות. השיחה איתי ללא הגבלה בכל תוכנית. בעמוד **מחירים** תמצא מה כלול בכל תוכנית וכמה היא עולה, וכל שירות מציג את המחיר שלו לפני שמתחילים. 🙂',
    },
    chips: [{ label: C.showOptions, intent: 'START' }, { label: C.other, intent: 'OTHER_QUESTION' }],
    mood: 'explaining',
  },

  HOMI_FREE: {
    text: {
      ka: 'ჩემთან საუბარი შეუზღუდავია ყველა გეგმაში. ლიმიტს არ ვითვლი, ამიტომ მკითხე იმდენი, რამდენიც დაგჭირდება. 🙂',
      en: "Talking to me is unlimited in every plan. There's no message count, so ask as much as you need. 🙂",
      ru: 'Общение со мной безлимитно в любом плане. Счётчика сообщений нет, так что спрашивай сколько нужно. 🙂',
      tr: 'Benimle konuşmak her planda sınırsız. Mesaj sayacı yok, istediğin kadar sorabilirsin. 🙂',
      ar: 'التحدث معي غير محدود في كل الخطط. لا يوجد عدّاد للرسائل، فاسأل بقدر ما تحتاج. 🙂',
      he: 'השיחה איתי ללא הגבלה בכל תוכנית. אין מונה הודעות, אז תשאל כמה שצריך. 🙂',
    },
    chips: [{ label: C.showOptions, intent: 'START' }, { label: C.other, intent: 'OTHER_QUESTION' }],
    mood: 'happy',
  },
};

export { C as HOMI_CHIP_LABELS };
