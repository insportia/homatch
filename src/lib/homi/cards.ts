/*
 * HOMI CARDS — interactive pieces of a conversation that are code, not text.
 *
 * A card is named by type (and an id from a closed list); the browser renders
 * it from HOMATCH's own deterministic engines and copy. The model may ASK for
 * one, but cannot write one: an unknown type or id never survives
 * parseHomiCards(), exactly like service actions.
 *
 * Runtime-neutral (no React, no Deno): shared by the edge function and the app.
 */

import type { L6 } from './content.ts';

export const HOMI_CARD_TYPES = ['START', 'ROI_QUICK', 'MORTGAGE_QUICK', 'CHECKLIST', 'EMPLOYMENT_PICKER'] as const;
export type HomiCardType = typeof HOMI_CARD_TYPES[number];
export interface HomiCardRef { type: HomiCardType; id?: string }

export const MAX_HOMI_CARDS = 2;

/* ── Checklists ────────────────────────────────────────────────────────── */

const COMMON: L6[] = [
  { ka: 'პირადობის მოწმობა ან პასპორტი', en: 'ID card or passport', ru: 'Удостоверение личности или паспорт', tr: 'Kimlik kartı veya pasaport', ar: 'بطاقة الهوية أو جواز السفر', he: 'תעודת זהות או דרכון' },
  { ka: 'თანხმობა საკრედიტო ისტორიის შემოწმებაზე', en: 'Consent to a credit history check', ru: 'Согласие на проверку кредитной истории', tr: 'Kredi geçmişi kontrolüne onay', ar: 'موافقة على فحص السجل الائتماني', he: 'הסכמה לבדיקת היסטוריית אשראי' },
  { ka: 'ქონების დოკუმენტები: საჯარო რეესტრის ამონაწერი და წინასწარი ხელშეკრულება', en: 'Property documents: Public Registry extract and the preliminary agreement', ru: 'Документы на объект: выписка из Публичного реестра и предварительный договор', tr: 'Mülk belgeleri: Kamu Sicili kaydı ve ön sözleşme', ar: 'مستندات العقار: مستخرج السجل العام والاتفاق المبدئي', he: 'מסמכי הנכס: נסח מהמרשם הציבורי והסכם מקדים' },
  { ka: 'ქონების შეფასების დასკვნა, ჩვეულებრივ ბანკის მიერ აღიარებული შემფასებლისგან', en: "A property valuation report, usually from a valuer the bank accepts", ru: 'Отчёт об оценке объекта, обычно от оценщика, которого принимает банк', tr: 'Mülk değerleme raporu, genellikle bankanın kabul ettiği bir eksperden', ar: 'تقرير تقييم العقار، عادة من مقيّم يعتمده البنك', he: 'דוח שמאות לנכס, בדרך כלל משמאי שהבנק מכיר' },
];

const SPECIFIC: Record<string, L6[]> = {
  salaried: [
    { ka: 'ცნობა სამსახურიდან: თანამდებობა, სტაჟი და ხელფასი', en: 'Employer letter: position, length of service and salary', ru: 'Справка с работы: должность, стаж и зарплата', tr: 'İşveren yazısı: pozisyon, çalışma süresi ve maaş', ar: 'خطاب من جهة العمل: المسمى الوظيفي ومدة الخدمة والراتب', he: 'אישור מהמעסיק: תפקיד, ותק ומשכורת' },
    { ka: 'საბანკო ამონაწერი, სადაც ხელფასის ჩარიცხვა ჩანს (ჩვეულებრივ 6-დან 12 თვემდე)', en: 'Bank statement showing salary payments (usually 6 to 12 months)', ru: 'Банковская выписка с зачислением зарплаты (обычно за 6–12 месяцев)', tr: 'Maaş yatışlarını gösteren banka dökümü (genellikle 6–12 ay)', ar: 'كشف حساب بنكي يُظهر تحويل الراتب (عادة من 6 إلى 12 شهرًا)', he: 'דף חשבון בנק שמראה הפקדות משכורת (בדרך כלל 6 עד 12 חודשים)' },
  ],
  self_employed: [
    { ka: 'ინდივიდუალურ მეწარმედ რეგისტრაციის ამონაწერი', en: 'Individual entrepreneur registration extract', ru: 'Выписка о регистрации индивидуальным предпринимателем', tr: 'Şahıs işletmesi kayıt belgesi', ar: 'مستخرج تسجيل كرائد أعمال فردي', he: 'אישור רישום כעוסק עצמאי' },
    { ka: 'საგადასახადო დეკლარაციები rs.ge-დან, ჩვეულებრივ ბოლო 1-2 წლის', en: 'Tax declarations from rs.ge, usually for the last 1–2 years', ru: 'Налоговые декларации с rs.ge, обычно за последние 1–2 года', tr: 'rs.ge’den vergi beyannameleri, genellikle son 1–2 yıl', ar: 'الإقرارات الضريبية من rs.ge، عادة لآخر سنة أو سنتين', he: 'הצהרות מס מ-rs.ge, בדרך כלל לשנה-שנתיים האחרונות' },
    { ka: 'საბანკო ამონაწერები, სადაც შემოსავლის მიღება ჩანს', en: 'Bank statements showing your income coming in', ru: 'Банковские выписки, где видны поступления дохода', tr: 'Gelir girişlerini gösteren banka dökümleri', ar: 'كشوف حساب تُظهر دخول الإيرادات', he: 'דפי חשבון שמראים את כניסת ההכנסות' },
    { ka: 'ხელშეკრულებები ან ინვოისები კლიენტებთან', en: 'Contracts or invoices with clients', ru: 'Договоры или счета с клиентами', tr: 'Müşterilerle sözleşmeler veya faturalar', ar: 'عقود أو فواتير مع العملاء', he: 'חוזים או חשבוניות מול לקוחות' },
  ],
  business_owner: [
    { ka: 'კომპანიის ამონაწერი მეწარმეთა რეესტრიდან', en: 'Company extract from the Registry of Entrepreneurs', ru: 'Выписка о компании из Реестра предпринимателей', tr: 'Girişimciler Sicili’nden şirket kaydı', ar: 'مستخرج الشركة من سجل رواد الأعمال', he: 'נסח חברה ממרשם היזמים' },
    { ka: 'კომპანიის ფინანსური ანგარიშგება და საგადასახადო დეკლარაციები', en: "The company's financial statements and tax declarations", ru: 'Финансовая отчётность и налоговые декларации компании', tr: 'Şirketin mali tabloları ve vergi beyannameleri', ar: 'القوائم المالية والإقرارات الضريبية للشركة', he: 'הדוחות הכספיים והצהרות המס של החברה' },
    { ka: 'დივიდენდის ან ხელფასის მიღების დამადასტურებელი ამონაწერები', en: 'Statements proving dividends or salary you receive', ru: 'Выписки, подтверждающие получение дивидендов или зарплаты', tr: 'Aldığın temettü veya maaşı gösteren dökümler', ar: 'كشوف تثبت ما تتلقاه من أرباح أو راتب', he: 'דפי חשבון שמוכיחים דיבידנדים או משכורת שאתה מקבל' },
  ],
  freelancer: [
    { ka: 'შემოსავლის საბანკო ამონაწერები, მაგალითად ბოლო 12 თვის', en: 'Bank statements of your income, for example for the last 12 months', ru: 'Банковские выписки с доходом, например за последние 12 месяцев', tr: 'Gelirini gösteren banka dökümleri, örneğin son 12 ay', ar: 'كشوف حساب بدخلك، مثلًا لآخر 12 شهرًا', he: 'דפי חשבון עם ההכנסות שלך, למשל ל-12 החודשים האחרונים' },
    { ka: 'ხელშეკრულებები ან ინვოისები დამკვეთებთან', en: 'Contracts or invoices with your clients', ru: 'Договоры или счета с заказчиками', tr: 'Müşterilerinle sözleşmeler veya faturalar', ar: 'عقود أو فواتير مع عملائك', he: 'חוזים או חשבוניות מול הלקוחות שלך' },
    { ka: 'რეგისტრაციის და დეკლარაციების დოკუმენტები, თუ მეწარმედ ხარ რეგისტრირებული', en: 'Registration and tax declaration documents, if you are registered as an entrepreneur', ru: 'Документы о регистрации и декларации, если ты зарегистрирован как предприниматель', tr: 'Girişimci olarak kayıtlıysan kayıt ve beyanname belgeleri', ar: 'مستندات التسجيل والإقرارات إن كنت مسجلًا كرائد أعمال', he: 'מסמכי רישום והצהרות מס, אם אתה רשום כעוסק' },
  ],
  rental: [
    { ka: 'მოქმედი იჯარის ხელშეკრულებები', en: 'Current lease agreements', ru: 'Действующие договоры аренды', tr: 'Geçerli kira sözleşmeleri', ar: 'عقود الإيجار السارية', he: 'חוזי שכירות בתוקף' },
    { ka: 'საბანკო ამონაწერები, სადაც ქირის მიღება ჩანს', en: 'Bank statements showing the rent coming in', ru: 'Банковские выписки, где видны поступления аренды', tr: 'Kira girişlerini gösteren banka dökümleri', ar: 'كشوف حساب تُظهر استلام الإيجار', he: 'דפי חשבון שמראים את קבלת דמי השכירות' },
    { ka: 'ქირის შემოსავლის საგადასახადო დეკლარაციები', en: 'Tax declarations for the rental income', ru: 'Налоговые декларации по доходу от аренды', tr: 'Kira geliri için vergi beyannameleri', ar: 'الإقرارات الضريبية لدخل الإيجار', he: 'הצהרות מס על הכנסה משכירות' },
  ],
  emigrant: [
    { ka: 'შრომითი ხელშეკრულება საზღვარგარეთ და ხელფასის ფურცლები ან ცნობა', en: 'Your employment contract abroad and payslips or an employer letter', ru: 'Трудовой договор за границей и расчётные листки или справка', tr: 'Yurt dışındaki iş sözleşmen ve maaş bordroları veya işveren yazısı', ar: 'عقد عملك في الخارج وقسائم الراتب أو خطاب من جهة العمل', he: 'חוזה העבודה בחו״ל ותלושי שכר או אישור מעסיק' },
    { ka: 'უცხოური ბანკის ამონაწერი', en: 'Statements from your foreign bank', ru: 'Выписки из иностранного банка', tr: 'Yabancı bankandan hesap dökümleri', ar: 'كشوف حساب من بنكك في الخارج', he: 'דפי חשבון מהבנק בחו״ל' },
    { ka: 'დოკუმენტების ნოტარიულად დამოწმებული თარგმანი; ზოგი ბანკი აპოსტილსაც ითხოვს', en: 'Notarised translations of documents; some banks also ask for an apostille', ru: 'Нотариально заверенные переводы документов; некоторые банки просят и апостиль', tr: 'Belgelerin noter onaylı çevirileri; bazı bankalar apostil de ister', ar: 'ترجمات موثقة للمستندات؛ وبعض البنوك تطلب الأبوستيل أيضًا', he: 'תרגומים נוטריוניים של המסמכים; חלק מהבנקים מבקשים גם אפוסטיל' },
    { ka: 'თუ საქართველოში არ ხარ, შეიძლება მინდობილობა ან ადგილზე მყოფი თანამსესხებელი დაგჭირდეს', en: "If you're not in Georgia, you may need a power of attorney or a co-borrower who is", ru: 'Если ты не в Грузии, может понадобиться доверенность или созаёмщик на месте', tr: 'Gürcistan’da değilsen vekâletname veya orada bulunan bir ortak borçlu gerekebilir', ar: 'إن لم تكن في جورجيا فقد تحتاج إلى توكيل أو مقترض مشارك موجود هناك', he: 'אם אתה לא בגאורגיה, ייתכן שתצטרך ייפוי כוח או לווה נוסף שנמצא שם' },
  ],
  foreign_national: [
    { ka: 'ბინადრობის ნებართვა, თუ გაქვს', en: 'Residence permit, if you have one', ru: 'Вид на жительство, если есть', tr: 'Varsa oturma izni', ar: 'تصريح الإقامة إن وُجد', he: 'היתר שהייה, אם יש' },
    { ka: 'შემოსავლის დამადასტურებელი დოკუმენტები ნოტარიულად დამოწმებული თარგმანით', en: 'Proof of income with notarised translations', ru: 'Подтверждение дохода с нотариальным переводом', tr: 'Noter onaylı çevirileriyle gelir belgeleri', ar: 'إثبات الدخل مع ترجمات موثقة', he: 'הוכחת הכנסה עם תרגום נוטריוני' },
    { ka: 'ზოგი ბანკი უცხოელებს მხოლოდ კონკრეტულ პროდუქტებს სთავაზობს ან მეტ პირველად შენატანს ითხოვს', en: 'Some banks offer foreigners only certain products or ask for a larger down payment', ru: 'Некоторые банки предлагают иностранцам только отдельные продукты или просят больший первоначальный взнос', tr: 'Bazı bankalar yabancılara yalnızca belirli ürünler sunar veya daha yüksek peşinat ister', ar: 'بعض البنوك تقدّم للأجانب منتجات محددة فقط أو تطلب دفعة أولى أكبر', he: 'חלק מהבנקים מציעים לזרים רק מוצרים מסוימים או מבקשים הון עצמי גבוה יותר' },
  ],
  co_borrower: [
    { ka: 'თანამსესხებლის პირადობის დოკუმენტი და შემოსავლის დოკუმენტები', en: "The co-borrower's ID and income documents", ru: 'Удостоверение личности и документы о доходе созаёмщика', tr: 'Ortak borçlunun kimliği ve gelir belgeleri', ar: 'هوية المقترض المشارك ومستندات دخله', he: 'תעודה מזהה ומסמכי הכנסה של הלווה הנוסף' },
    { ka: 'თანამსესხებლის თანხმობა საკრედიტო ისტორიის შემოწმებაზე', en: "The co-borrower's consent to a credit check", ru: 'Согласие созаёмщика на проверку кредитной истории', tr: 'Ortak borçlunun kredi kontrolüne onayı', ar: 'موافقة المقترض المشارك على الفحص الائتماني', he: 'הסכמת הלווה הנוסף לבדיקת אשראי' },
    { ka: 'გახსოვდეს: თანამსესხებელი სესხზე ისევე პასუხისმგებელია, როგორც შენ', en: 'Remember: a co-borrower is as responsible for the loan as you are', ru: 'Помни: созаёмщик отвечает по кредиту так же, как и ты', tr: 'Unutma: ortak borçlu kredi için senin kadar sorumludur', ar: 'تذكّر: المقترض المشارك مسؤول عن القرض مثلك تمامًا', he: 'חשוב לזכור: לווה נוסף אחראי להלוואה בדיוק כמוך' },
  ],
};

export const HOMI_CHECKLISTS: Record<string, { items: L6[] }> = Object.fromEntries(
  Object.entries(SPECIFIC).map(([profile, items]) => [`mortgage_docs_${profile}`, { items: [...COMMON, ...items] }]),
);

/** Model output → card refs. Unknown types or checklist ids are dropped. */
export function parseHomiCards(raw: unknown): HomiCardRef[] {
  if (!Array.isArray(raw)) return [];
  const out: HomiCardRef[] = [];
  for (const item of raw) {
    const type = typeof item === 'string' ? item : (item as { type?: unknown })?.type;
    if (typeof type !== 'string') continue;
    const upper = type.trim().toUpperCase() as HomiCardType;
    if (!(HOMI_CARD_TYPES as readonly string[]).includes(upper)) continue;
    const rawId = typeof item === 'object' && item ? (item as { id?: unknown }).id : undefined;
    let ref: HomiCardRef;
    if (upper === 'CHECKLIST') {
      if (typeof rawId !== 'string' || !HOMI_CHECKLISTS[rawId]) continue;
      ref = { type: upper, id: rawId };
    } else {
      ref = { type: upper };
    }
    if (out.some((c) => c.type === ref.type && c.id === ref.id)) continue;
    out.push(ref);
    if (out.length >= MAX_HOMI_CARDS) break;
  }
  return out;
}

/** The instruction appended to the model's JSON contract. Generated from the same catalogue. */
export const HOMI_CARDS_INSTRUCTION = [
  'INTERACTIVE CARDS',
  'In the same JSON block you may also return "cards": at most two of these, only when one genuinely helps the person act now:',
  '"MORTGAGE_QUICK" (a monthly-payment calculator with sliders), "ROI_QUICK" (a rental return calculator),',
  `{"type":"CHECKLIST","id":one of ${Object.keys(HOMI_CHECKLISTS).map((k) => `"${k}"`).join(', ')}} (mortgage documents by income type),`,
  '"EMPLOYMENT_PICKER" (lets them choose their income type), "START" (the main menu).',
  'The card computes its own numbers from HOMATCH engines — never repeat or invent figures for it. Usually return [].',
].join('\n');
