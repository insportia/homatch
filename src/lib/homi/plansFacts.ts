/*
 * HOMI knows the real subscription plans (owner, 2026-10-29).
 *
 * Prices and allowances are admin-editable rows (saas_public_plans()), never
 * constants: homatch-ai reads them and this module turns them into the lines
 * a written PLANS answer appends and the fact block the model is given, so a
 * price change in Admin reaches HOMI without a deploy. Pure and runtime-neutral.
 */

export interface PublicPlan {
  code: string;
  name: string;
  priceTetri: number;
  entitlements?: Record<string, { enabled?: boolean; limit?: number | null; unlimited?: boolean }>;
}

type Lang = 'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he';

const COPY: Record<Lang, { month: string; verify: (n: number | null) => string; contracts: (n: number | null) => string; free: string; first: string; pending: string }> = {
  ka: {
    month: '₾ თვეში',
    verify: (n) => (n == null ? 'შეუზღუდავი Verify' : `${n} Verify`),
    contracts: (n) => (n == null ? 'შეუზღუდავი ხელშეკრულების ანალიზი' : `${n} ხელშეკრულების ანალიზი`),
    free: 'ყველა გეგმაში შეუზღუდავია ჩემთან საუბარი, ქონების ძებნა HOMATCH-ზე, მყიდველებისა და მოიჯარეების დამთხვევა და მათი კონტაქტის გახსნა.',
    first: 'პირველი Verify და პირველი ხელშეკრულების ანალიზი ყველა ახალ ანგარიშზე უფასოა.',
    pending: 'ფასები დღგ-ს ჩათვლითაა.',
  },
  en: {
    month: '₾ a month',
    verify: (n) => (n == null ? 'unlimited Verify' : `${n} Verify reports`),
    contracts: (n) => (n == null ? 'unlimited contract analyses' : `${n} contract analyses`),
    free: 'Every plan includes unlimited chat with me, property search on HOMATCH, buyer and tenant matching, and opening their contact details.',
    first: 'The first Verify and the first contract analysis on every new account are free.',
    pending: 'Prices include VAT.',
  },
  ru: {
    month: '₾ в месяц',
    verify: (n) => (n == null ? 'безлимитный Verify' : `${n} отчётов Verify`),
    contracts: (n) => (n == null ? 'безлимитный анализ договоров' : `${n} анализов договоров`),
    free: 'В каждом плане без ограничений: общение со мной, поиск недвижимости на HOMATCH, подбор покупателей и арендаторов и открытие их контактов.',
    first: 'Первый Verify и первый анализ договора на каждом новом аккаунте бесплатны.',
    pending: 'Цены включают НДС.',
  },
  tr: {
    month: '₾ / ay',
    verify: (n) => (n == null ? 'sınırsız Verify' : `${n} Verify raporu`),
    contracts: (n) => (n == null ? 'sınırsız sözleşme analizi' : `${n} sözleşme analizi`),
    free: 'Her planda benimle sohbet, HOMATCH üzerinde mülk arama, alıcı ve kiracı eşleştirme ve iletişim bilgilerini açma sınırsızdır.',
    first: 'Her yeni hesapta ilk Verify ve ilk sözleşme analizi ücretsizdir.',
    pending: 'Fiyatlara KDV dahildir.',
  },
  ar: {
    month: '₾ شهريًا',
    verify: (n) => (n == null ? 'Verify غير محدود' : `${n} تقارير Verify`),
    contracts: (n) => (n == null ? 'تحليل عقود غير محدود' : `${n} تحليلات عقود`),
    free: 'كل خطة تشمل دون حدود: المحادثة معي، والبحث عن العقارات على HOMATCH، ومطابقة المشترين والمستأجرين، وفتح بيانات الاتصال الخاصة بهم.',
    first: 'أول Verify وأول تحليل عقد مجانيان لكل حساب جديد.',
    pending: 'الأسعار شاملة ضريبة القيمة المضافة.',
  },
  he: {
    month: '₾ לחודש',
    verify: (n) => (n == null ? 'Verify ללא הגבלה' : `${n} דוחות Verify`),
    contracts: (n) => (n == null ? 'ניתוח חוזים ללא הגבלה' : `${n} ניתוחי חוזה`),
    free: 'כל תוכנית כוללת ללא הגבלה שיחה איתי, חיפוש נכסים ב-HOMATCH, התאמת קונים ושוכרים ופתיחת פרטי הקשר שלהם.',
    first: 'ה-Verify הראשון וניתוח החוזה הראשון בכל חשבון חדש בחינם.',
    pending: 'המחירים כוללים מע״מ.',
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

/** Validated plans from the RPC answer, or [] (a malformed answer is never shown). */
export function parsePublicPlans(raw: unknown): PublicPlan[] {
  const plans = (raw as { plans?: unknown })?.plans;
  if (!Array.isArray(plans)) return [];
  return plans.filter((p): p is PublicPlan =>
    !!p && typeof (p as PublicPlan).code === 'string' && typeof (p as PublicPlan).name === 'string'
    && Number.isFinite((p as PublicPlan).priceTetri) && (p as PublicPlan).priceTetri > 0);
}

/** The lines a written PLANS answer appends, in the reader's language. */
export function plansAnswerLines(plans: PublicPlan[], lang: string): string {
  if (!plans.length) return '';
  const c = COPY[(lang in COPY ? lang : 'en') as Lang];
  const rows = plans.map((p) =>
    `• **${p.name}**: ${gel(p.priceTetri)} ${c.month}, ${c.verify(quota(p, 'VERIFY'))}, ${c.contracts(quota(p, 'CONTRACT_ANALYSIS'))}`);
  return [...rows, '', c.free, c.first, c.pending].join('\n');
}

/** The fact block the model is given, so a free-form plans question gets the real numbers. */
export function plansPromptBlock(plans: PublicPlan[]): string {
  if (!plans.length) return '';
  const rows = plans.map((p) => {
    const v = quota(p, 'VERIFY');
    const ca = quota(p, 'CONTRACT_ANALYSIS');
    return `  ${p.name} (${p.code}): ${gel(p.priceTetri)} GEL a month, VAT included; Verify ${v == null ? 'unlimited' : `${v} a month`}; contract analysis ${ca == null ? 'unlimited' : `${ca} a month`}.`;
  });
  return [
    'HOMATCH SUBSCRIPTION PLANS (the real, current prices; quote them exactly, never invent others):',
    ...rows,
    '  Every plan: unlimited HOMI chat, unlimited property search on HOMATCH, unlimited buyer and tenant matching, free unlock of HOMATCH members\' contacts.',
    '  Every new account: the first successful Verify and the first contract analysis are free, no card needed.',
    '  Third party costs (advertising budgets, paid external searches) are not included in any plan.',
    '  Online payment is being connected with the bank; until then the Pricing page (/pricing) shows the plans and says payment activation is pending. Send people to /pricing.',
  ].join('\n');
}
