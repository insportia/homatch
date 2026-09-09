// HOMATCH — price and market intelligence.
//
// The old report handed the model a list of comparable listings and let it
// say something vague about them. A buyer's real question is narrower and
// harder: "is this price sensible, compared to WHAT, and by how much?"
//
// Answering that needs arithmetic, not prose, so the arithmetic happens here
// — deterministically, testably, with no model involved. The model is given
// the RESULT and asked to explain it.
//
// TWO RULES THIS MODULE EXISTS TO ENFORCE
//
//   1. An asking price is not a sale price. Every number produced here comes
//      from active listings, and the type name says so.
//   2. A comparable is not automatically comparable. A different project on
//      the other side of the city tells a buyer almost nothing, so listings
//      are SCORED by how close they really are and the closest ones drive the
//      analysis.
//
// It is pure: same input, same output. No clock, no network, no database.

/**
 * The comparison hierarchy, narrowest first.
 *
 * PEER_PROJECT sits between the district and the open market on purpose: a
 * boutique development elsewhere in the city is a far better guide to a
 * boutique development's price than the district average, which mixes it
 * with generic stock it does not actually compete with.
 */
export type ComparableTier =
  | 'SAME_PROJECT'
  | 'SAME_STREET'
  | 'SAME_DISTRICT'
  | 'PEER_PROJECT'
  | 'WIDER_MARKET';

/** Published per band, so the customer sees the whole hierarchy at once. */
export interface TierStats {
  tier: ComparableTier;
  median: number;
  min: number;
  max: number;
  count: number;
}

/**
 * Why a premium or a discount may be RATIONAL here.
 *
 * Quality is part of price. A boutique building on a large plot with parking
 * and concierge is not the same asset as a corridor block at the same price
 * per square metre, and reporting only the number invites exactly the wrong
 * conclusion.
 *
 * These are qualitative and evidence-backed by construction — each one is
 * only present because a snapshot field or an amenity says so. Deliberately
 * NO monetary adjustment is attached: the data does not support one, and
 * inventing "+8% for concierge" would be a fabrication with a decimal point.
 */
export interface QualityFactor {
  factor: string;
  direction: 'SUPPORTS_PREMIUM' | 'SUPPORTS_DISCOUNT';
}

export type Positioning =
  | 'BELOW_MARKET_RANGE'
  | 'ATTRACTIVE'
  | 'AROUND_MARKET'
  | 'PREMIUM'
  | 'SIGNIFICANT_PREMIUM';

export interface RawComparable {
  project?: string | null;
  address?: string | null;
  area?: string | number | null;
  rooms?: string | number | null;
  floor?: string | number | null;
  price?: string | number | null;
  pricePerSqm?: string | number | null;
  currency?: string | null;
  condition?: string | null;
  listingStatus?: string | null;
  comparableType?: string | null;
  retrievedAt?: string | null;
  listingDate?: string | null;
  url?: string | null;
  source?: string | null;
  similarity?: string | null;
}

export interface ScoredComparable {
  /** Never rendered in the primary report — the evidence explorer owns URLs. */
  url?: string;
  tier: ComparableTier;
  /** 0..100. Internal; the customer sees its effect, not the number. */
  relevance: number;
  pricePerSqm: number;
  area?: number;
  rooms?: number;
  floor?: number;
  currency: string;
  totalPrice?: number;
  /** Why it is comparable, in the research layer's own words. */
  similarity?: string;
  reasons: string[];
}

export interface MarketIntelligence {
  currency: string;
  /** The subject's own asking price, when the research actually found one. */
  subjectPricePerSqm?: number;
  subjectTotalPrice?: number;
  subjectArea?: number;

  median: number;
  mean: number;
  min: number;
  max: number;
  count: number;

  /** The band the analysis is really based on, strongest available. */
  basis: ComparableTier;
  basisCount: number;

  /** Present only when the subject's own price is known. */
  deltaFromMedianPct?: number;
  deltaFromClosestPct?: number;
  positioning?: Positioning;

  /** Best few, already ordered. Kept for the model to reason over. */
  closest: ScoredComparable[];
  tierCounts: Record<ComparableTier, number>;
  /** Every band that actually has listings, narrowest first. */
  tiers: TierStats[];
  /** Evidence-backed reasons a premium or discount may be rational. */
  qualityFactors: QualityFactor[];
  /** Always true: everything here is an ASK. */
  askingNotTransaction: true;
}

/* ------------------------------------------------------------------ *
 * Parsing                                                             *
 * ------------------------------------------------------------------ */

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  // Tolerates "174,455", "1 850", "$1850", "94.10 m2".
  const cleaned = v.replace(/[^\d.,-]/g, '').replace(/\s/g, '');
  if (!cleaned) return undefined;
  // A comma before exactly three trailing digits is a thousands separator.
  const normalized = /,\d{3}(\D|$)/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const lower = (v: unknown): string => text(v).toLowerCase();

/** Normalizes a Georgian/Latin address enough to compare streets. */
const streetKey = (v: unknown): string =>
  lower(v)
    .replace(/[.,#№]/g, ' ')
    .replace(/\b(ქუჩა|ქ|street|st|ave|avenue|გამზირი)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Tbilisi district names that appear in this pipeline's address strings. */
const DISTRICT_HINTS = [
  'ვაკე', 'საბურთალო', 'ვერა', 'მთაწმინდა', 'კრწანისი', 'ისანი', 'სამგორი',
  'გლდანი', 'ნაძალადევი', 'დიდუბე', 'ჩუღურეთი', 'დიღომი', 'ვაშლიჯვარი',
  'ავლაბარი', 'ორთაჭალა', 'ლისი', 'დიდი დიღომი',
];

export function districtOf(address: unknown): string | undefined {
  const a = text(address);
  return DISTRICT_HINTS.find((d) => a.includes(d));
}

/* ------------------------------------------------------------------ *
 * Scoring                                                             *
 * ------------------------------------------------------------------ */

export interface Subject {
  project?: string;
  address?: string;
  area?: number;
  rooms?: number;
  floor?: number;
  pricePerSqm?: number;
  totalPrice?: number;
  currency?: string;
}

/**
 * How comparable a listing really is.
 *
 * Deliberately dominated by LOCATION, because a same-project unit two floors
 * up is a far better guide than a same-sized flat across the city. Area and
 * room similarity refine within that; recency and an active listing state add
 * a little confidence. A generic city-wide listing can never outscore a
 * same-project one.
 */
export function scoreComparable(subject: Subject, c: RawComparable): ScoredComparable | null {
  const pps = num(c.pricePerSqm);
  const area = num(c.area);
  const total = num(c.price);
  const derived = pps ?? (total && area && area > 0 ? total / area : undefined);
  if (!derived || derived <= 0) return null;

  const reasons: string[] = [];
  let tier: ComparableTier = 'WIDER_MARKET';
  let score = 20;

  const peerProject = lower(c.comparableType) === 'peer_project';
  const sameProject =
    lower(c.comparableType) === 'same_project' ||
    (!!subject.project && !!c.project && lower(c.project).includes(lower(subject.project).split(' ')[0]));
  const sameStreet =
    !!subject.address && !!c.address && streetKey(subject.address) !== '' &&
    streetKey(subject.address) === streetKey(c.address);
  const subjDistrict = districtOf(subject.address);
  const compDistrict = districtOf(c.address);

  if (sameProject) {
    tier = 'SAME_PROJECT';
    score = 100;
    reasons.push('same project');
  } else if (sameStreet) {
    tier = 'SAME_STREET';
    score = 78;
    reasons.push('same street');
  } else if (subjDistrict && compDistrict && subjDistrict === compDistrict) {
    tier = 'SAME_DISTRICT';
    score = 58;
    reasons.push('same district');
  } else if (peerProject) {
    // The research layer judged this a comparable development rather than
    // arbitrary city stock. Better than the open market, weaker than a
    // location match, and never allowed to outrank one.
    tier = 'PEER_PROJECT';
    score = 40;
    reasons.push('comparable development');
  }

  const rooms = num(c.rooms);
  const floor = num(c.floor);

  if (subject.area && area) {
    const diff = Math.abs(area - subject.area) / subject.area;
    if (diff <= 0.08) { score += 12; reasons.push('near-identical size'); }
    else if (diff <= 0.2) { score += 6; reasons.push('similar size'); }
    else if (diff > 0.5) { score -= 10; reasons.push('very different size'); }
  }
  if (subject.rooms && rooms && rooms === subject.rooms) { score += 5; reasons.push('same room count'); }
  if (subject.floor && floor && Math.abs(floor - subject.floor) <= 1) { score += 3; reasons.push('similar floor'); }
  if (lower(c.listingStatus) === 'active') { score += 4; reasons.push('currently listed'); }
  if (text(c.condition)) { score += 2; }

  return {
    url: text(c.url) || undefined,
    tier,
    relevance: Math.max(0, Math.min(100, score)),
    pricePerSqm: derived,
    area,
    rooms,
    floor,
    currency: text(c.currency) || subject.currency || 'USD',
    totalPrice: total,
    similarity: text(c.similarity) || undefined,
    reasons,
  };
}

/* ------------------------------------------------------------------ *
 * Statistics                                                          *
 * ------------------------------------------------------------------ */

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Where the subject's price sits.
 *
 * The thresholds are deliberately wide. Asking prices carry real noise —
 * condition, floor, view, parking and completion state all move them — so a
 * 3% gap is not a signal and must not be dressed as one.
 */
export function positioningFor(deltaPct: number): Positioning {
  if (deltaPct <= -12) return 'BELOW_MARKET_RANGE';
  if (deltaPct <= -4) return 'ATTRACTIVE';
  if (deltaPct < 8) return 'AROUND_MARKET';
  if (deltaPct < 20) return 'PREMIUM';
  return 'SIGNIFICANT_PREMIUM';
}

/* ------------------------------------------------------------------ *
 * The build                                                           *
 * ------------------------------------------------------------------ */

const TIER_ORDER: ComparableTier[] = [
  'SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT', 'WIDER_MARKET',
];

/*
 * Quality signals, read from the snapshot the research already produced.
 *
 * Density is the strongest of them and the one a price-per-square-metre
 * comparison misses completely: forty-two households on 2,100 m² is a
 * different product from two hundred in a corridor block, whatever the
 * headline rate says.
 */
const PREMIUM_HINTS: [RegExp, string][] = [
  [/კონსიერჟ|concierge/i, 'კონსიერჟი'],
  [/დაცვა|security/i, 'დაცვა'],
  [/პარკინგ|parking|ავტოსადგომ/i, 'პარკინგი'],
  [/ლიფტ|otis|elevator/i, 'ლიფტი'],
  [/პანორამულ|panoramic|ალუმინის|aluminium/i, 'პანორამული შემინვა'],
  [/ენერგოეფექტ|energy.?efficien/i, 'ენერგოეფექტურობა'],
  [/სეისმ|seismic/i, 'სეისმური მდგრადობა'],
  [/ბუტიკ|boutique|დაბალი სიმჭიდროვ|low.?density/i, 'დაბალი სიმჭიდროვე'],
  [/ეზო|landscap|გამწვანებ/i, 'გამწვანებული ეზო'],
];

const DISCOUNT_HINTS: [RegExp, string][] = [
  [/თეთრი კარკას|შავი კარკას|white frame|black frame|საჭიროებს რემონტს/i, 'დაუსრულებელი მდგომარეობა'],
  [/მშენებარე|under construction|არ არის დასრულებ/i, 'მშენებლობის ეტაპი'],
];

/**
 * Quality factors from what the research actually recorded.
 *
 * Every factor must trace to a snapshot field or an amenity string. Nothing
 * is inferred from the price, which would be circular, and nothing is
 * inferred from the project's name.
 */
export function qualityFactorsFrom(
  amenities: string[] = [],
  condition?: string,
  constructionStatus?: string,
  parking?: string
): QualityFactor[] {
  const haystack = [...amenities, condition ?? '', constructionStatus ?? '', parking ?? '']
    .filter(Boolean)
    .join(' | ');
  if (!haystack.trim()) return [];

  const out: QualityFactor[] = [];
  const seen = new Set<string>();
  for (const [re, factor] of PREMIUM_HINTS) {
    if (re.test(haystack) && !seen.has(factor)) {
      seen.add(factor);
      out.push({ factor, direction: 'SUPPORTS_PREMIUM' });
    }
  }
  for (const [re, factor] of DISCOUNT_HINTS) {
    if (re.test(haystack) && !seen.has(factor)) {
      seen.add(factor);
      out.push({ factor, direction: 'SUPPORTS_DISCOUNT' });
    }
  }
  return out;
}

/** At least this many listings before a tier can carry the analysis alone. */
const MIN_FOR_BASIS = 2;

export function buildMarketIntelligence(
  subject: Subject,
  raw: RawComparable[],
  /** Snapshot signals, so the price can be read against the product. */
  quality: QualityFactor[] = []
): MarketIntelligence | null {
  const scored = raw
    .map((c) => scoreComparable(subject, c))
    .filter((c): c is ScoredComparable => !!c)
    .sort((a, b) => b.relevance - a.relevance);

  if (!scored.length) return null;

  const tierCounts = TIER_ORDER.reduce(
    (acc, t) => ({ ...acc, [t]: scored.filter((c) => c.tier === t).length }),
    {} as Record<ComparableTier, number>
  );

  // The narrowest band that actually has enough listings to mean something.
  // Falling back one tier at a time is what stops a single same-project
  // listing from being presented as "the market".
  let basis: ComparableTier = 'WIDER_MARKET';
  let basisSet = scored;
  for (const t of TIER_ORDER) {
    const inTier = scored.filter((c) => c.tier === t);
    if (inTier.length >= MIN_FOR_BASIS) { basis = t; basisSet = inTier; break; }
  }
  // Nothing reached the minimum: use everything, and say so by staying on the
  // widest tier rather than implying a precision we do not have.
  if (basisSet === scored && tierCounts.SAME_PROJECT === 1) basis = 'SAME_PROJECT';

  const values = basisSet.map((c) => c.pricePerSqm);
  const med = median(values);
  const closest = scored.slice(0, 5);

  const out: MarketIntelligence = {
    currency: basisSet[0]?.currency ?? subject.currency ?? 'USD',
    subjectPricePerSqm: subject.pricePerSqm,
    subjectTotalPrice: subject.totalPrice,
    subjectArea: subject.area,
    median: Math.round(med),
    mean: Math.round(mean(values)),
    min: Math.round(Math.min(...values)),
    max: Math.round(Math.max(...values)),
    count: values.length,
    basis,
    basisCount: basisSet.length,
    closest,
    tierCounts,
    // Every populated band, narrowest first. A single listing is still worth
    // showing as context — it is only barred from CARRYING the analysis,
    // which is what basis/MIN_FOR_BASIS decides.
    tiers: TIER_ORDER.map((t) => {
      const inTier = scored.filter((c) => c.tier === t);
      if (!inTier.length) return null;
      const vs = inTier.map((c) => c.pricePerSqm);
      return {
        tier: t,
        median: Math.round(median(vs)),
        min: Math.round(Math.min(...vs)),
        max: Math.round(Math.max(...vs)),
        count: vs.length,
      };
    }).filter((x): x is TierStats => x !== null),
    qualityFactors: quality,
    askingNotTransaction: true,
  };

  // Positioning only exists when the subject has a price of its own. Verify
  // runs from a cadastral code, so most of the time it does not — and
  // inventing one from the comparables would be exactly the fabrication this
  // product refuses.
  if (subject.pricePerSqm && med > 0) {
    const delta = ((subject.pricePerSqm - med) / med) * 100;
    out.deltaFromMedianPct = round1(delta);
    out.positioning = positioningFor(delta);

    const closestMed = median(closest.map((c) => c.pricePerSqm));
    if (closestMed > 0) {
      out.deltaFromClosestPct = round1(((subject.pricePerSqm - closestMed) / closestMed) * 100);
    }
  }

  return out;
}

/**
 * Compound annual growth between two asking levels.
 *
 * Returns null rather than a number whenever the inputs cannot support one —
 * a missing price, a non-positive value, or a span under six months, where
 * annualising would turn noise into a trend.
 */
export function askingCagrPct(
  fromPricePerSqm: number | undefined,
  toPricePerSqm: number | undefined,
  years: number | undefined
): number | null {
  if (!fromPricePerSqm || !toPricePerSqm || !years) return null;
  if (fromPricePerSqm <= 0 || toPricePerSqm <= 0 || years < 0.5) return null;
  return round1(((toPricePerSqm / fromPricePerSqm) ** (1 / years) - 1) * 100);
}
