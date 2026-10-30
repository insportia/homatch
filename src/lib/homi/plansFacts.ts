/*
 * HOMI knows the real subscription plans (owner, 2026-10-29; copy 2026-10-30).
 *
 * Prices and allowances are admin-editable rows (saas_public_plans()), never
 * constants: homatch-ai reads them and this module turns them into the written
 * PLANS answer and the fact block the model is given, so a price change in
 * Admin reaches HOMI without a deploy. Pure and runtime-neutral.
 *
 * The answer opens with the shape the owner wrote ("we have three subscription
 * plans: Standard, VIP and Unlimited; prices start at 9.90 GEL a month; each
 * differs by its property check and contract analysis allowances"), but the
 * count, the names and the cheapest price are read from the rows. It says
 * honestly whether online payment can be used yet, and states the first-use
 * rule correctly: the first property check and the first contract analysis
 * on an account are free once, not every month.
 */

export interface PublicPlan {
  code: string;
  name: string;
  priceTetri: number;
  vatInclusive?: boolean;
  entitlements?: Record<string, { enabled?: boolean; limit?: number | null; unlimited?: boolean }>;
}

export interface PlansAnswerOptions {
  /** Features with a first-use trial (saas_public_plans().trials). Unknown → the trial line is left out. */
  trials?: string[];
  /** Whether online payment works. Unknown (undefined) → the payment line is left out. */
  paymentsConnected?: boolean;
}

type Lang = 'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he';

interface Copy {
  intro: (count: number, names: string, from: string) => string;
  month: string;
  verify: (n: number | null) => string;
  contracts: (n: number | null) => string;
  included: string;
  firstBoth: string;
  firstVerify: string;
  firstContract: string;
  vat: string;
  pending: string;
  open: string;
  and: string;
}

const KA_COUNT = ['', 'ერთი', 'ორი', 'სამი', 'ოთხი', 'ხუთი'];

const COPY: Record<Lang, Copy> = {
  ka: {
    intro: (n, names, from) => `გვაქვს ${KA_COUNT[n] ?? String(n)} გამოწერის გეგმა: ${names}. ფასები იწყება ${from} ლარიდან თვეში. თითოეული გეგმა განსხვავდება ქონების შემოწმებისა და ხელშეკრულების ანალიზის ლიმიტებით.`,
    month: '₾ თვეში',
    verify: (n) => (n == null ? 'ქონების შეუზღუდავი შემოწმება' : `${n} ქონების შემოწმება`),
    contracts: (n) => (n == null ? 'ხელშეკრულებების შეუზღუდავი ანალიზი' : `${n} ხელშეკრულების ანალიზი`),
    included: 'ყველა გეგმაში შეუზღუდავია ჩემთან საუბარი, ქონების ძიება HOMATCH-ზე, მყიდველებისა და მოიჯარეების დამთხვევა და მათი კონტაქტის ნახვა.',
    firstBoth: 'პირველი ქონების შემოწმება და პირველი ხელშეკრულების ანალიზი უფასოა. გამოსაცდელად საბანკო ბარათი არ გჭირდება.',
    firstVerify: 'პირველი ქონების შემოწმება უფასოა. გამოსაცდელად საბანკო ბარათი არ გჭირდება.',
    firstContract: 'პირველი ხელშეკრულების ანალიზი უფასოა. გამოსაცდელად საბანკო ბარათი არ გჭირდება.',
    vat: 'ფასები დღგ-ს ჩათვლითაა.',
    pending: 'ონლაინ გადახდის დამატებაზე ვმუშაობთ. გამოწერის გააქტიურება მალე იქნება შესაძლებელი.',
    open: 'გამოწერის გააქტიურება **ფასების** გვერდიდან შეგიძლია.',
    and: 'და',
  },
  en: {
    intro: (n, names, from) => `We have ${n} subscription plan${n === 1 ? '' : 's'}: ${names}. Prices start at ${from} GEL a month. The plans differ in how many property checks and contract analyses they include.`,
    month: '₾ a month',
    verify: (n) => (n == null ? 'unlimited property checks' : `${n} property checks`),
    contracts: (n) => (n == null ? 'unlimited contract analyses' : `${n} contract analyses`),
    included: 'Every plan includes unlimited chat with me, property search on HOMATCH, buyer and tenant matching, and access to their contact details.',
    firstBoth: 'Your first property check and your first contract analysis are free. No bank card is needed to try them.',
    firstVerify: 'Your first property check is free. No bank card is needed to try it.',
    firstContract: 'Your first contract analysis is free. No bank card is needed to try it.',
    vat: 'Prices include VAT.',
    pending: 'We are adding online payment. You will be able to activate a subscription soon.',
    open: 'You can activate a subscription on the **Pricing** page.',
    and: 'and',
  },
  ru: {
    intro: (n, names, from) => `У нас ${n} тарифа подписки: ${names}. Цены начинаются от ${from} лари в месяц. Тарифы отличаются лимитами проверок недвижимости и анализов договоров.`,
    month: '₾ в месяц',
    verify: (n) => (n == null ? 'безлимитная проверка недвижимости' : `${n} проверок недвижимости`),
    contracts: (n) => (n == null ? 'безлимитный анализ договоров' : `${n} анализов договоров`),
    included: 'В каждом тарифе без ограничений: общение со мной, поиск недвижимости на HOMATCH, подбор покупателей и арендаторов и доступ к их контактам.',
    firstBoth: 'Первая проверка недвижимости и первый анализ договора бесплатны. Банковская карта для этого не нужна.',
    firstVerify: 'Первая проверка недвижимости бесплатна. Банковская карта для этого не нужна.',
    firstContract: 'Первый анализ договора бесплатен. Банковская карта для этого не нужна.',
    vat: 'Цены включают НДС.',
    pending: 'Мы подключаем онлайн-оплату. Активировать подписку можно будет совсем скоро.',
    open: 'Активировать подписку можно на странице **Цены**.',
    and: 'и',
  },
  tr: {
    intro: (n, names, from) => `${n} abonelik planımız var: ${names}. Fiyatlar aylık ${from} lariden başlar. Planlar, mülk kontrolü ve sözleşme analizi limitleriyle ayrılır.`,
    month: '₾ / ay',
    verify: (n) => (n == null ? 'sınırsız mülk kontrolü' : `${n} mülk kontrolü`),
    contracts: (n) => (n == null ? 'sınırsız sözleşme analizi' : `${n} sözleşme analizi`),
    included: 'Her planda benimle sohbet, HOMATCH üzerinde mülk arama, alıcı ve kiracı eşleştirme ve iletişim bilgilerine erişim sınırsızdır.',
    firstBoth: 'İlk mülk kontrolün ve ilk sözleşme analizin ücretsizdir. Denemek için banka kartı gerekmez.',
    firstVerify: 'İlk mülk kontrolün ücretsizdir. Denemek için banka kartı gerekmez.',
    firstContract: 'İlk sözleşme analizin ücretsizdir. Denemek için banka kartı gerekmez.',
    vat: 'Fiyatlara KDV dahildir.',
    pending: 'Online ödemeyi ekliyoruz. Aboneliği yakında etkinleştirebileceksin.',
    open: 'Aboneliği **Fiyatlar** sayfasından etkinleştirebilirsin.',
    and: 've',
  },
  ar: {
    intro: (n, names, from) => `لدينا ${n} خطط اشتراك: ${names}. تبدأ الأسعار من ${from} لاري شهريًا. تختلف الخطط في عدد فحوصات العقارات وتحليلات العقود المشمولة.`,
    month: '₾ شهريًا',
    verify: (n) => (n == null ? 'فحص عقارات غير محدود' : `${n} فحوصات عقار`),
    contracts: (n) => (n == null ? 'تحليل عقود غير محدود' : `${n} تحليلات عقود`),
    included: 'كل خطة تشمل دون حدود: المحادثة معي، والبحث عن العقارات على HOMATCH، ومطابقة المشترين والمستأجرين، والوصول إلى بيانات الاتصال الخاصة بهم.',
    firstBoth: 'أول فحص عقار وأول تحليل عقد مجانيان. لا تحتاج إلى بطاقة مصرفية للتجربة.',
    firstVerify: 'أول فحص عقار مجاني. لا تحتاج إلى بطاقة مصرفية للتجربة.',
    firstContract: 'أول تحليل عقد مجاني. لا تحتاج إلى بطاقة مصرفية للتجربة.',
    vat: 'الأسعار شاملة ضريبة القيمة المضافة.',
    pending: 'نعمل على إضافة الدفع الإلكتروني. ستتمكن من تفعيل الاشتراك قريبًا.',
    open: 'يمكنك تفعيل الاشتراك من صفحة **الأسعار**.',
    and: 'و',
  },
  he: {
    intro: (n, names, from) => `יש לנו ${n} תוכניות מנוי: ${names}. המחירים מתחילים מ-${from} לארי לחודש. התוכניות נבדלות במספר בדיקות הנכס וניתוחי החוזה הכלולים בהן.`,
    month: '₾ לחודש',
    verify: (n) => (n == null ? 'בדיקות נכס ללא הגבלה' : `${n} בדיקות נכס`),
    contracts: (n) => (n == null ? 'ניתוחי חוזה ללא הגבלה' : `${n} ניתוחי חוזה`),
    included: 'כל תוכנית כוללת ללא הגבלה שיחה איתי, חיפוש נכסים ב-HOMATCH, התאמת קונים ושוכרים וגישה לפרטי הקשר שלהם.',
    firstBoth: 'בדיקת הנכס הראשונה וניתוח החוזה הראשון בחינם. לא צריך כרטיס אשראי כדי לנסות.',
    firstVerify: 'בדיקת הנכס הראשונה בחינם. לא צריך כרטיס אשראי כדי לנסות.',
    firstContract: 'ניתוח החוזה הראשון בחינם. לא צריך כרטיס אשראי כדי לנסות.',
    vat: 'המחירים כוללים מע״מ.',
    pending: 'אנחנו מוסיפים תשלום מקוון. בקרוב אפשר יהיה להפעיל מנוי.',
    open: 'אפשר להפעיל מנוי בעמוד **מחירים**.',
    and: 'ו',
  },
};

const quota = (p: PublicPlan, feature: string): number | null => {
  const e = p.entitlements?.[feature];
  if (!e || e.enabled === false) return 0;
  return e.unlimited ? null : Number(e.limit ?? 0);
};

const gel = (tetri: number): string => {
  const v = tetri / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const BOOLEAN_INCLUDED = ['HOMI_UNLIMITED', 'INTERNAL_SEARCH', 'INTERNAL_MATCHING', 'INTERNAL_UNLOCK_FREE'];

/** "A, B and C" in the reader's language (Arabic and Hebrew join the conjunction to the last word). */
function joinNames(names: string[], c: Copy, lang: Lang): string {
  if (names.length <= 1) return names.join('');
  const head = names.slice(0, -1).join(', ');
  const last = names[names.length - 1];
  return lang === 'he' || lang === 'ar' ? `${head} ${c.and}${last}` : `${head} ${c.and} ${last}`;
}

/** Validated plans from the RPC answer, or [] (a malformed answer is never shown). */
export function parsePublicPlans(raw: unknown): PublicPlan[] {
  const plans = (raw as { plans?: unknown })?.plans;
  if (!Array.isArray(plans)) return [];
  return plans.filter((p): p is PublicPlan =>
    !!p && typeof (p as PublicPlan).code === 'string' && typeof (p as PublicPlan).name === 'string'
    && Number.isFinite((p as PublicPlan).priceTetri) && (p as PublicPlan).priceTetri > 0);
}

/** The first-use trial features from the RPC answer, or [] when absent or malformed. */
export function parsePlanTrials(raw: unknown): string[] {
  const trials = (raw as { trials?: unknown })?.trials;
  return Array.isArray(trials) ? trials.filter((f): f is string => typeof f === 'string') : [];
}

/** The plan list lines, in the reader's language. */
export function plansAnswerLines(plans: PublicPlan[], lang: string, opts: PlansAnswerOptions = {}): string {
  if (!plans.length) return '';
  const l = (lang in COPY ? lang : 'en') as Lang;
  const c = COPY[l];
  const rows = plans.map((p) =>
    `• **${p.name}**: ${gel(p.priceTetri)} ${c.month}, ${c.verify(quota(p, 'VERIFY'))}, ${c.contracts(quota(p, 'CONTRACT_ANALYSIS'))}`);
  const tail: string[] = [];
  if (plans.every((p) => BOOLEAN_INCLUDED.every((f) => p.entitlements?.[f]?.enabled === true))) tail.push(c.included);
  if (opts.trials) {
    const v = opts.trials.includes('VERIFY');
    const ca = opts.trials.includes('CONTRACT_ANALYSIS');
    if (v && ca) tail.push(c.firstBoth);
    else if (v) tail.push(c.firstVerify);
    else if (ca) tail.push(c.firstContract);
  }
  if (plans.every((p) => p.vatInclusive !== false)) tail.push(c.vat);
  if (opts.paymentsConnected === false) tail.push(c.pending);
  else if (opts.paymentsConnected === true) tail.push(c.open);
  return [...rows, ...(tail.length ? ['', ...tail] : [])].join('\n');
}

/**
 * The whole written PLANS answer built from the rows: the owner's opening
 * (count, names and the cheapest price, all from data), then the plan list.
 */
export function plansAnswerText(plans: PublicPlan[], lang: string, opts: PlansAnswerOptions = {}): string {
  if (!plans.length) return '';
  const l = (lang in COPY ? lang : 'en') as Lang;
  const c = COPY[l];
  const cheapest = Math.min(...plans.map((p) => p.priceTetri));
  const intro = c.intro(plans.length, joinNames(plans.map((p) => p.name), c, l), gel(cheapest));
  return `${intro}\n\n${plansAnswerLines(plans, lang, opts)}`;
}

/** The fact block the model is given, so a free-form plans question gets the real numbers. */
export function plansPromptBlock(plans: PublicPlan[], opts: PlansAnswerOptions = {}): string {
  if (!plans.length) return '';
  const rows = plans.map((p) => {
    const v = quota(p, 'VERIFY');
    const ca = quota(p, 'CONTRACT_ANALYSIS');
    return `  ${p.name} (${p.code}): ${gel(p.priceTetri)} GEL a month, VAT included; property check (Verify) ${v == null ? 'unlimited' : `${v} a month`}; contract analysis ${ca == null ? 'unlimited' : `${ca} a month`}.`;
  });
  const payment = opts.paymentsConnected === true
    ? '  Online payment works: people activate a subscription on the Pricing page (/pricing).'
    : '  Online payment is not available yet (it is being added); say so plainly. The Pricing page (/pricing) shows the plans; activation becomes possible once payment is connected. Never say a plan can be bought today.';
  return [
    'HOMATCH SUBSCRIPTION PLANS (the real, current prices; quote them exactly, never invent others):',
    ...rows,
    '  Every plan: unlimited HOMI chat, unlimited property search on HOMATCH, unlimited buyer and tenant matching, free unlock of HOMATCH members\' contacts.',
    '  Every account: the FIRST successful property check (Verify) and the FIRST contract analysis are free, once per account (NOT every month), no card needed. After that a subscription is needed.',
    '  There is no per-report price and new credits are not sold. Never mention voice messages.',
    '  Third party costs (advertising budgets, paid external searches) are not included in any plan.',
    payment,
  ].join('\n');
}
