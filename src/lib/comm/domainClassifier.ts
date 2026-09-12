// HOMATCH Communications — the real-estate-only boundary.
//
// §6 is a hard product rule: Homatch Communications may only be used for real
// estate and materially adjacent property services. §51 says how to decide,
// and the shape of that answer matters as much as the answer:
//
//   Stage 1  RULE        the campaign's own structure already settles it
//   Stage 2  KEYWORD     weighted evidence for and against, in six languages
//   Stage 3  CLASSIFIER  a cheap local score over that evidence
//   Stage 4  LLM         only what stages 1-3 genuinely could not resolve
//
// Stages 1-3 are in this file and cost nothing. Stage 4 lives in the edge
// function, is reached by a minority of campaigns, and is called only when
// this module returns needsLlm.
//
// WHY THE PROHIBITED LIST OUTRANKS THE PERMITTED ONE
//
// "Invest in our new casino development in Batumi" contains "development",
// "invest" and a city. Every permitted signal fires. It is still a casino. So
// a strong prohibited signal is not outvoted by accumulated property
// vocabulary — it goes straight to BLOCK, and the reason code says which word
// did it. §51 names the mirror case too: "Investment opportunity" on its own
// is NOT evidence of real estate, so `invest` carries almost no weight by
// itself and only counts when a property noun is present.
//
// WHERE THIS RUNS
//
// Both sides. supabase/functions/_shared/comm/domain.ts is a byte-identical
// copy of the exported logic, because the browser needs it to show a live
// verdict in the campaign builder and the SERVER needs it because a frontend
// check is not enforcement (§6). A test asserts the two agree on a shared
// corpus; if they drift, that test fails.

export type DomainVerdict = 'ALLOW' | 'REVIEW' | 'BLOCK';
export type DomainStage = 'RULE' | 'KEYWORD' | 'CLASSIFIER' | 'LLM';

export interface DomainSignal {
  code: string;
  weight: number;
  detail?: string;
}

export interface DomainResult {
  verdict: DomainVerdict;
  stage: DomainStage;
  score: number;
  signals: DomainSignal[];
  /** True when the caller should escalate to stage 4 before trusting REVIEW. */
  needsLlm: boolean;
}

export interface DomainInput {
  /** Free text the user wrote: campaign name, agent purpose, script, message body. */
  text: string;
  /**
   * Structure that is not text. An agent built from the Buyer Qualification
   * template, or a campaign bound to a real property_id, is real estate by
   * construction — stage 1 settles those without reading a word.
   */
  agentTemplate?: string | null;
  hasPropertyContext?: boolean;
  campaignType?: string | null;
}

/**
 * Words that end the conversation. Weighted, because "casino" is not
 * ambiguous and "loan" very much is — a mortgage is a loan and §6 permits
 * mortgage follow-up explicitly.
 */
const PROHIBITED: Array<[string, number, string[]]> = [
  ['GAMBLING', 100, ['casino', 'gambling', 'betting', 'bet365', 'roulette', 'slots', 'poker', 'bookmaker',
    'კაზინო', 'აზარტული', 'ფსონ', 'казино', 'ставки', 'букмекер', 'kumar', 'bahis', 'قمار', 'קזינו']],
  ['ADULT', 100, ['escort', 'adult webcam', 'porn', 'პორნო', 'порно']],
  ['CRYPTO_PROMO', 90, ['crypto pump', 'token presale', 'ico', 'airdrop', 'forex signals', 'binary options',
    'trading signals', 'კრიპტო ინვესტიცია', 'криптовалют', 'форекс', 'kripto yatırım']],
  ['POLITICAL', 90, ['vote for', 'election campaign', 'political party', 'candidate for',
    'აირჩიე', 'საარჩევნო', 'выборы', 'проголосуй', 'seçim kampanya']],
  ['PHARMA', 85, ['viagra', 'weight loss pills', 'cbd oil', 'nootropic', 'похудение таблетки']],
  ['DEBT_COLLECTION', 70, ['debt collection', 'recover your debt', 'outstanding debt',
    'ვალის ამოღება', 'взыскание долга', 'borç tahsilat']],
  ['UNRELATED_ECOM', 65, ['dropshipping', 'online store sale', 'black friday deals', 'discount coupon code',
    'ინტერნეტ მაღაზია', 'интернет-магазин']],
  ['SCAM', 100, ['you have won', 'claim your prize', 'lottery winner', 'verify your account password',
    'send your card details', 'თქვენ მოიგეთ', 'вы выиграли', 'приз']],
  ['MLM', 75, ['network marketing', 'mlm', 'financial freedom opportunity', 'be your own boss',
    'сетевой маркетинг', 'ağ pazarlama']],
];

/**
 * Property vocabulary. High weights go to nouns that are only ever real
 * estate; low weights go to words that appear in property work and everywhere
 * else. `invest` deliberately scores 3 — §51's "Investment opportunity" case.
 */
const PERMITTED: Array<[string, number, string[]]> = [
  ['PROPERTY_NOUN', 30, ['apartment', 'flat', 'property', 'house', 'villa', 'penthouse', 'studio apartment',
    'real estate', 'realestate', 'commercial property', 'office space', 'land plot', 'townhouse',
    'ბინა', 'სახლი', 'უძრავი ქონება', 'ქონება', 'აპარტამენტი', 'კოტეჯი', 'მიწის ნაკვეთი',
    'квартир', 'недвижим', 'дом', 'коттедж', 'апартамент', 'участок',
    'daire', 'emlak', 'gayrimenkul', 'konut', 'عقار', 'شقة', 'נדל"ן', 'דירה']],
  ['TRANSACTION', 22, ['buy a property', 'sell your property', 'for sale', 'for rent', 'rental', 'tenant',
    'landlord', 'lease', 'mortgage', 'viewing', 'listing', 'title deed', 'closing',
    'ქირავდება', 'იყიდება', 'გაქირავება', 'ყიდვა', 'გაყიდვა', 'იპოთეკა', 'დათვალიერება', 'მოიჯარე',
    'аренда', 'снять', 'купить', 'продать', 'ипотек', 'просмотр', 'арендатор', 'сдается', 'продается',
    'kiralık', 'satılık', 'ipotek', 'إيجار', 'للبيع', 'رهن', 'להשכרה', 'למכירה', 'משכנתא']],
  ['DEVELOPMENT', 20, ['new development', 'developer', 'off plan', 'residential complex', 'construction project',
    'ახალი პროექტი', 'დეველოპერი', 'საცხოვრებელი კომპლექსი', 'ახალაშენებული',
    'новостройк', 'застройщик', 'жилой комплекс', 'yeni proje', 'müteahhit']],
  ['PROPERTY_SERVICE', 16, ['property management', 'relocation', 'renovation', 'interior design',
    'after sales', 'valuation', 'appraisal', 'surveyor', 'conveyancing',
    'რემონტი', 'ინტერიერი', 'შეფასება', 'ქონების მართვა',
    'ремонт', 'оценка недвижимости', 'управление недвижимостью', 'tadilat', 'ekspertiz']],
  ['ROOMS_AND_SPECS', 14, ['bedroom', 'bedrooms', 'square meter', 'sqm', 'm2', 'floor plan', 'balcony',
    'საძინებელი', 'კვადრატული', 'კვმ', 'სართული', 'აივანი',
    'спальн', 'квадратных метр', 'кв.м', 'этаж', 'балкон', 'yatak odası', 'metrekare']],
  ['LOCATION_TBILISI', 12, ['tbilisi', 'batumi', 'vake', 'saburtalo', 'krtsanisi', 'ortachala', 'didi dighomi',
    'gldani', 'isani', 'mtatsminda', 'chugureti', 'varketili', 'lisi', 'digomi',
    'თბილისი', 'ბათუმი', 'ვაკე', 'საბურთალო', 'კრწანისი', 'ორთაჭალა', 'დიდი დიღომი',
    'გლდანი', 'ისანი', 'მთაწმინდა', 'ჩუღურეთი', 'ვარკეთილი', 'ლისი',
    'тбилиси', 'батуми', 'ваке', 'сабуртало', 'крцаниси', 'ортачала']],
  ['LEAD_INTENT', 10, ['viewing appointment', 'book a viewing', 'schedule a visit', 'qualified buyer',
    'property inquiry', 'looking for a place',
    'დათვალიერების დაჯავშნა', 'ვეძებ ბინას', 'записаться на просмотр', 'ищу квартиру']],
  ['WEAK_FINANCE', 3, ['invest', 'investment', 'investor', 'yield', 'roi', 'portfolio',
    'ინვესტიცია', 'инвестиц', 'yatırım', 'استثمار']],
];

/** Agent templates that are real estate by construction. */
const REAL_ESTATE_TEMPLATES = new Set([
  'BUYER_QUALIFICATION', 'SELLER_QUALIFICATION', 'PROPERTY_FOLLOWUP', 'VIEWING_CONFIRMATION',
  'COLD_REACTIVATION', 'DEVELOPER_SALES', 'RENTAL_INQUIRY', 'MORTGAGE_FOLLOWUP',
  'INVESTOR_QUALIFICATION',
]);

/**
 * Lowercase and strip the characters people use to dodge a word filter
 * ("c-a-s-i-n-o", "саsino" with a Cyrillic а). Homoglyph folding is
 * deliberately limited to the Latin/Cyrillic pairs that are actually
 * identical on screen; going further would start damaging genuine Georgian
 * and Arabic text.
 */
export function foldForMatching(text: string): string {
  const HOMOGLYPHS: Record<string, string> = {
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', в: 'b', м: 'm', т: 't', н: 'h',
    А: 'a', Е: 'e', О: 'o', Р: 'p', С: 'c', У: 'y', Х: 'x', К: 'k', В: 'b', М: 'm', Т: 't', Н: 'h',
  };
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[а-яА-Я]/g, (ch) => HOMOGLYPHS[ch] ?? ch)
    // "c-a-s-i-n-o" and "c a s i n o": collapse single characters separated by
    // one separator. Applied only to runs of 4+ so ordinary hyphenation and
    // Georgian text survive.
    .replace(/\b(?:\w[\s.\-_*]){3,}\w\b/g, (run) => run.replace(/[\s.\-_*]/g, ''));
}

function countHits(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const needle of needles) {
    const n = foldForMatching(needle);
    if (n && haystack.includes(n)) found.push(needle);
  }
  return found;
}

/**
 * Stages 1 to 3. Never calls anything, never costs anything, always returns.
 */
export function classifyDomain(input: DomainInput): DomainResult {
  const signals: DomainSignal[] = [];
  const text = foldForMatching(input.text ?? '');

  // ── Stage 1: structure ───────────────────────────────────────────────────
  // A campaign bound to a Homatch property, or built on a real-estate agent
  // template, is real estate by construction. It still runs the prohibited
  // check below, because a legitimate template with a casino script in it is
  // exactly the abuse this gate is for.
  const structural = Boolean(
    (input.agentTemplate && REAL_ESTATE_TEMPLATES.has(input.agentTemplate)) || input.hasPropertyContext,
  );

  // ── Prohibited, at any stage ─────────────────────────────────────────────
  let worstProhibited = 0;
  for (const [code, weight, needles] of PROHIBITED) {
    const hits = countHits(text, needles);
    if (hits.length) {
      signals.push({ code: `PROHIBITED_${code}`, weight, detail: hits.slice(0, 3).join(', ') });
      worstProhibited = Math.max(worstProhibited, weight);
    }
  }

  if (worstProhibited >= 85) {
    return { verdict: 'BLOCK', stage: 'RULE', score: -worstProhibited, signals, needsLlm: false };
  }

  if (structural && worstProhibited === 0) {
    signals.push({
      code: 'STRUCTURAL_REAL_ESTATE',
      weight: 40,
      detail: input.hasPropertyContext ? 'bound to a Homatch property' : `agent template ${input.agentTemplate}`,
    });
    return { verdict: 'ALLOW', stage: 'RULE', score: 100, signals, needsLlm: false };
  }

  // ── Stage 2: keyword evidence ────────────────────────────────────────────
  let positive = 0;
  let distinctFields = 0;
  for (const [code, weight, needles] of PERMITTED) {
    const hits = countHits(text, needles);
    if (hits.length) {
      // Repeating "apartment" eleven times is not eleven times the evidence.
      // Each category contributes once, at its own weight.
      positive += weight;
      distinctFields += 1;
      signals.push({ code: `PROPERTY_${code}`, weight, detail: hits.slice(0, 3).join(', ') });
    }
  }

  // §51: "invest" alone proves nothing. If the ONLY positive evidence is the
  // weak-finance category, discard it and treat the text as having none.
  const onlyWeakFinance = distinctFields === 1 && signals.some((s) => s.code === 'PROPERTY_WEAK_FINANCE');
  if (onlyWeakFinance) {
    positive = 0;
    signals.push({ code: 'WEAK_FINANCE_ONLY', weight: 0, detail: 'investment language with no property noun' });
  }

  // ── Stage 3: score it ────────────────────────────────────────────────────
  const score = positive - worstProhibited;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (worstProhibited >= 60) {
    // Prohibited but not conclusive — debt collection, unrelated e-commerce,
    // MLM. §6 permits property-related debt and property-related relocation,
    // so a human decides rather than a word list.
    return { verdict: 'REVIEW', stage: 'CLASSIFIER', score, signals, needsLlm: true };
  }

  if (score >= 40 && distinctFields >= 2) {
    return { verdict: 'ALLOW', stage: 'KEYWORD', score, signals, needsLlm: false };
  }

  if (wordCount < 3) {
    signals.push({ code: 'TOO_SHORT_TO_JUDGE', weight: 0, detail: `${wordCount} words` });
    return { verdict: 'REVIEW', stage: 'RULE', score, signals, needsLlm: true };
  }

  if (score >= 20) {
    // Some property evidence, not enough to be sure. Stage 4 decides.
    return { verdict: 'REVIEW', stage: 'CLASSIFIER', score, signals, needsLlm: true };
  }

  // No property evidence at all in a campaign that is about to dial strangers.
  signals.push({ code: 'NO_PROPERTY_EVIDENCE', weight: 0 });
  return { verdict: 'REVIEW', stage: 'CLASSIFIER', score, signals, needsLlm: true };
}

/**
 * Fold stage 4's answer into the deterministic one.
 *
 * The LLM can resolve an ambiguous REVIEW in either direction, and it can
 * raise a BLOCK. It can NOT overturn a deterministic BLOCK: a rule that a
 * model can talk its way past is not a rule, and prompt injection through a
 * campaign description is a real attack surface here.
 */
export function applyLlmVerdict(
  deterministic: DomainResult,
  llm: { verdict: DomainVerdict; reason?: string; confidence?: number },
): DomainResult {
  if (deterministic.verdict === 'BLOCK') return deterministic;

  const signals = [
    ...deterministic.signals,
    {
      code: `LLM_${llm.verdict}`,
      weight: Math.round((llm.confidence ?? 0.5) * 100),
      detail: llm.reason?.slice(0, 300),
    },
  ];

  // A low-confidence model answer is not enough to clear a campaign for
  // automatic execution; it leaves it for a human.
  if (llm.verdict === 'ALLOW' && (llm.confidence ?? 0) < 0.6) {
    return { ...deterministic, verdict: 'REVIEW', stage: 'LLM', signals, needsLlm: false };
  }

  return { ...deterministic, verdict: llm.verdict, stage: 'LLM', signals, needsLlm: false };
}
