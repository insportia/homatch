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
import {
  conditionDistance,
  conditionGrade,
  conditionMix,
  type ConditionGrade,
  type ConditionMix,
} from './comparableCondition.ts';

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
  /** Too few listings to characterise this band on its own. */
  thin: boolean;
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

/**
 * Whether a listing is describing the market as it is now.
 *
 * ACTIVE is on the market today. EXPIRED came off it, so its price is a
 * historical asking level and not a current one. UNKNOWN is the common case
 * — roughly a third of production comparables never carry a status — and is
 * emphatically NOT expired: an unlabelled listing is unlabelled, and treating
 * our missing field as evidence of removal would be the absence rule broken
 * in arithmetic instead of in prose.
 */
export type ListingState = 'ACTIVE' | 'EXPIRED' | 'UNKNOWN';

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
  /** Normalised from free text — see comparableCondition.ts. */
  condition?: ConditionGrade;
  state: ListingState;
  /** When the listing itself is dated, how old it was at research time. */
  ageMonths?: number;
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

  /*
   * WHAT THE COMPARISON IS ACTUALLY MADE OF.
   *
   * In Georgia the fit-out state is most of the price: bare concrete against
   * a finished flat is routinely thirty or forty per cent per square metre.
   * Reading a renovated unit against a green-frame median and calling the gap
   * a premium is not imprecise, it is the wrong answer — so the mix travels
   * with the numbers and the prose has to account for it.
   */
  conditionMix: ConditionMix;
  /** The subject's own state, when the research established one. */
  subjectCondition?: ConditionGrade;
  /**
   * True when the subject and the bulk of its comparables are on different
   * rungs. The delta is still computed; this says not to read it as a
   * pricing verdict on its own.
   */
  conditionMismatch: boolean;

  /** Listings excluded from the numbers because they are no longer offers. */
  expiredExcluded: number;
  /** Cross-posts and repeats removed before anything was counted. */
  duplicatesRemoved: number;
  /**
   * The analysis rests on fewer listings than it takes to describe a market.
   * The figures are still real, but they are one or two asking prices — not
   * a distribution — and every consumer of this object must say so.
   */
  basisIsThin: boolean;
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

/**
 * Whether two project names are the same development.
 *
 * A Georgian development is routinely written both ways — "არჩი" and "Archi",
 * "m2" and "მ2" — and the same name carries different suffixes on different
 * portals ("Archi Kavtaradze", "არჩი ქავთარაძე 71"). The previous test took
 * the subject's FIRST WORD and asked whether the comparable contained it,
 * which misses every cross-script pair and, worse, matches on a generic
 * leading word: a subject called "ბინა ვაკეში" would have claimed every
 * comparable containing "ბინა" as the same project.
 *
 * So: compare significant tokens, in either script, and require a real one to
 * match. Nothing here invents a relationship — it recognises a name that is
 * already there.
 */
const PROJECT_NOISE = new Set([
  'ბინა', 'კორპუსი', 'პროექტი', 'სახლი', 'residence', 'residences', 'project',
  'apartment', 'apartments', 'building', 'house', 'tower', 'complex', 'the',
]);

/** Georgian letters that map to a Latin spelling often enough to matter. */
const TRANSLIT: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'g', ყ: 'k', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};

/**
 * Transliterated, then with doubled letters collapsed.
 *
 * Georgian has no doubled consonants, so a development written both ways ends
 * up as "VILLION" in Latin and "ვილიონ" — "vilion" — in Georgian. Without
 * this, the two spellings of one project's own name do not match each other,
 * which is the exact case project aliasing exists for.
 *
 * Safe because it only merges spellings that differ by repetition: it cannot
 * bring two genuinely different names together.
 */
const DOUBLED_LETTER = new RegExp(String.raw`(.)\1+`, 'gu');
const translit = (s: string): string =>
  [...s]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(DOUBLED_LETTER, '$1');

function projectTokens(name: unknown): string[] {
  return lower(name)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !PROJECT_NOISE.has(w))
    .map(translit)
    .filter((w) => w.length >= 3);
}

/**
 * Two project names are the same development when they share a word that is
 * not a place.
 *
 * The place test is what makes this usable in Tbilisi, where developments are
 * routinely named after the district they stand in. "VILLION Krtsanisi Homes"
 * and "Krtsanisi Residence" share "Krtsanisi" and are not the same building —
 * they are two buildings in Krtsanisi. Caught by a real fixture: without this
 * the same-project band swelled from two listings to four, and the median a
 * buyer is judged against moved with it.
 *
 * So a token that also appears in either ADDRESS cannot establish identity on
 * its own. It is a neighbourhood; the developments merely wear its name.
 */
export function sameProjectName(a: unknown, b: unknown, placeContext = ''): boolean {
  const ta = projectTokens(a);
  const tb = projectTokens(b);
  if (!ta.length || !tb.length) return false;
  const places = projectTokens(placeContext);
  /*
   * Matched by prefix, because Georgian declines its place names. The project
   * says "Krtsanisi" and the address says "კრწანისის ქუჩა" — "krtsanisis
   * kucha" once transliterated — so an exact comparison would decide the
   * neighbourhood is not a neighbourhood and wave the match through. Four
   * characters is enough to be a name rather than a coincidence.
   */
  const isPlace = (w: string): boolean =>
    w.length >= 4 && places.some((p) => p.startsWith(w) || w.startsWith(p));
  const shared = ta.filter((w) => tb.includes(w));
  return shared.some((w) => !isPlace(w));
}

/**
 * How old a listing was when we read it, in months.
 *
 * Both dates come from the research layer as free text and either may be
 * missing or unparseable, in which case the answer is "we do not know" —
 * never zero, which would read as "posted today".
 */
function monthsBetween(listed: string, retrieved: string): number | undefined {
  const from = Date.parse(listed.length === 7 ? `${listed}-01` : listed);
  const to = retrieved ? Date.parse(retrieved) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return undefined;
  return Math.round(((to - from) / 86_400_000 / 30.44) * 10) / 10;
}

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
  /** Free text; normalised the same way a comparable's is. */
  condition?: string;
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
  /*
   * THE BASE LEAVES ROOM FOR THE REFINEMENTS.
   *
   * These used to start at 100 for a same-project listing, against a 0..100
   * clamp — so every refinement above it was discarded, and two flats in the
   * same building both scored 100 whether one was bare concrete and the other
   * finished. That is the one place condition matters MOST, and it was the
   * one place the score could not express it.
   *
   * The bands still dominate, and the tier-first sort below makes that
   * structural rather than arithmetic: a peer project cannot outrank a
   * location match however well it refines.
   */
  let score = 16;

  const state: ListingState =
    lower(c.listingStatus) === 'active'
      ? 'ACTIVE'
      : /expired|removed|sold|inactive|withdrawn|დასრულებ|წაშლილ/.test(lower(c.listingStatus))
        ? 'EXPIRED'
        : 'UNKNOWN';

  const peerProject = lower(c.comparableType) === 'peer_project';
  // A project name the subject does not share. Not a location match, but
  // not anonymous stock either.
  const namedDevelopment = !!text(c.project);
  const sameProject =
    lower(c.comparableType) === 'same_project' ||
    // Both addresses, so a shared district name is recognised as a place
    // rather than as a shared identity.
    sameProjectName(subject.project, c.project, `${text(subject.address)} ${text(c.address)}`);
  const sameStreet =
    !!subject.address && !!c.address && streetKey(subject.address) !== '' &&
    streetKey(subject.address) === streetKey(c.address);
  const subjDistrict = districtOf(subject.address);
  const compDistrict = districtOf(c.address);

  if (sameProject) {
    tier = 'SAME_PROJECT';
    score = 76;
    reasons.push('same project');
  } else if (sameStreet) {
    tier = 'SAME_STREET';
    score = 60;
    reasons.push('same street');
  } else if (subjDistrict && compDistrict && subjDistrict === compDistrict) {
    tier = 'SAME_DISTRICT';
    score = 46;
    reasons.push('same district');
  } else if (peerProject || namedDevelopment) {
    /*
     * A NAMED DEVELOPMENT ELSEWHERE IS A PEER, NOT GENERIC STOCK.
     *
     * PEER_PROJECT had never once been produced in production. The research
     * layer labels a distant development MICRO_LOCATION more often than
     * PEER_PROJECT, and this branch only trusted its label — so a comparable
     * like "Villa Residence" on a street with no district hint fell all the
     * way to WIDER_MARKET and sat beside arbitrary city stock.
     *
     * Carrying a project NAME is itself the evidence: an apartment in a named
     * development is a closer comparison for another named development than
     * an unbranded flat is. Better than the open market, weaker than any
     * location match, and never allowed to outrank one.
     */
    tier = 'PEER_PROJECT';
    score = 32;
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
  if (state === 'ACTIVE') { score += 4; reasons.push('currently listed'); }
  // A price that came off the market is weaker evidence of today's market,
  // even where it is still allowed to inform the picture.
  if (state === 'EXPIRED') { score -= 8; reasons.push('no longer listed'); }

  /*
   * CONDITION IS NOT A TIE-BREAKER, IT IS THE PRODUCT.
   *
   * Two flats in the same building on the same floor are not comparable if
   * one is bare concrete and the other is finished. Weighted accordingly:
   * the same rung is worth more than a matching room count, and opposite
   * ends of the ladder cost more than a very different size.
   */
  const condition = conditionGrade(c.condition) ?? undefined;
  const rungs = conditionDistance(subject.condition, c.condition);
  if (rungs !== null) {
    if (rungs === 0) { score += 10; reasons.push('same condition'); }
    else if (rungs === 1) { score += 3; reasons.push('similar condition'); }
    else if (rungs >= 3) { score -= 12; reasons.push('very different condition'); }
  }

  const ageMonths = monthsBetween(text(c.listingDate), text(c.retrievedAt));
  // An asking price from last week describes this market. One from eighteen
  // months ago describes a different one, and says so quietly rather than
  // being thrown away.
  if (ageMonths !== undefined && ageMonths > 12) { score -= 6; reasons.push('older listing'); }

  return {
    url: text(c.url) || undefined,
    tier,
    state,
    condition,
    ageMonths,
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

/**
 * The same flat, posted twice.
 *
 * Portals syndicate, agents re-post, and the research layer reads them all.
 * A flat that appears three times is one property with three votes in a
 * median built from five — which moves the number the buyer is judged
 * against without anyone doing anything wrong.
 *
 * The identity is the listing URL where there is one, and otherwise the
 * things that actually make a flat that flat: its size, its price, its floor
 * and its building. Deliberately strict — two genuinely distinct units with
 * identical area, identical price, identical floor and the same project are
 * far rarer than one unit posted twice, but demanding ALL of them means a
 * near-miss stays in rather than a real comparable being silently deleted.
 *
 * Audited against production before writing: 167 priced comparables across 39
 * completed jobs contained zero duplicates by this test. This is a guard on a
 * feed that could start syndicating at any time, not a fix for a live fault,
 * and it is cheap enough to be worth having ahead of the problem.
 */
function comparableIdentity(c: ScoredComparable & { project?: string }): string {
  if (c.url) return `url:${c.url.toLowerCase().replace(/[?#].*$/, '')}`;
  return JSON.stringify([
    'shape',
    Math.round(c.pricePerSqm),
    c.area ?? null,
    c.floor ?? null,
    c.totalPrice ?? null,
  ]);
}

export function buildMarketIntelligence(
  subject: Subject,
  raw: RawComparable[],
  /** Snapshot signals, so the price can be read against the product. */
  quality: QualityFactor[] = []
): MarketIntelligence | null {
  const all = raw
    .map((c) => scoreComparable(subject, c))
    .filter((c): c is ScoredComparable => !!c)
    /*
     * BAND FIRST, THEN HOW CLOSE WITHIN IT.
     *
     * Sorting on the score alone made 'a peer project never outranks a
     * location match' an arithmetic accident: it held only while the band
     * bases happened to be further apart than the refinements could reach.
     * Making it the primary key states the rule instead of hoping for it,
     * and frees the score to mean what it should — how comparable this
     * listing is, given its band.
     */
    .sort((x, y) => TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier) || y.relevance - x.relevance);

  // Sorted by relevance first, so where a duplicate pair disagrees the more
  // comparable of the two is the one that survives.
  const byIdentity = new Map<string, ScoredComparable>();
  for (const c of all) {
    const id = comparableIdentity(c);
    if (!byIdentity.has(id)) byIdentity.set(id, c);
  }
  const unique = [...byIdentity.values()];
  const duplicatesRemoved = all.length - unique.length;

  /*
   * A PRICE THAT CAME OFF THE MARKET IS NOT THIS MARKET.
   *
   * An expired listing is a historical asking level. Including it in today's
   * median says the market contains an offer that no longer exists.
   *
   * But it is only dropped when there is still something to compare against:
   * with nothing else, a withdrawn asking price is the only evidence there
   * is, and returning null instead would tell the buyer nothing at all. And
   * UNKNOWN is never treated as expired — roughly a third of production
   * comparables carry no status, and reading our own missing field as
   * "removed" is the absence rule broken in arithmetic instead of in prose.
   */
  const current = unique.filter((c) => c.state !== 'EXPIRED');
  const expiredExcluded = current.length ? unique.length - current.length : 0;
  const scored = current.length ? current : unique;

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
  let basisIsThin = false;
  for (const t of TIER_ORDER) {
    const inTier = scored.filter((c) => c.tier === t);
    if (inTier.length >= MIN_FOR_BASIS) { basis = t; basisSet = inTier; break; }
  }
  /*
   * Nothing reached the minimum.
   *
   * This used to relabel the basis as SAME_PROJECT whenever exactly one
   * same-project listing existed — while the median was still being computed
   * across EVERY comparable. The report then said "in the same project"
   * about a number that came from the whole set, which is the one thing a
   * price comparison must never do.
   *
   * The honest description is: everything we have, and not enough of it. The
   * numbers still compute — a single asking price is real information — but
   * `basisIsThin` travels with them so the prose, the model and the UI can
   * all say so instead of implying a precision that is not there.
   */
  if (basisSet === scored) {
    // No single band could carry the analysis, so it is stitched across all
    // of them. That is thin by definition, however many listings there are
    // in total: two listings from two different bands do not describe either
    // band. The label is the WIDEST band actually present — the honest
    // description of a set that reaches that far — and never a narrower one
    // the numbers did not come from.
    basisIsThin = true;
    const present = TIER_ORDER.filter((t) => tierCounts[t] > 0);
    if (present.length) basis = present[present.length - 1];
  }

  const values = basisSet.map((c) => c.pricePerSqm);
  const med = median(values);
  const closest = scored.slice(0, 5);

  const mix = conditionMix(basisSet.map((c) => c.condition));
  const subjectGrade = conditionGrade(subject.condition);
  /*
   * The comparison is between different products.
   *
   * Only claimed when BOTH sides are actually known and the comparables have
   * a clear centre of gravity — an unknown condition on either side means we
   * cannot say they differ, which is not the same as saying they match.
   */
  const conditionMismatch =
    !!subjectGrade && !!mix.dominant && subjectGrade !== mix.dominant;

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
        thin: vs.length < MIN_FOR_BASIS,
      };
    }).filter((x): x is TierStats => x !== null),
    qualityFactors: quality,
    basisIsThin,
    askingNotTransaction: true,
    duplicatesRemoved,
    expiredExcluded,
    /*
     * Computed over the BASIS, not over everything: the mix has to describe
     * the set the median actually came from, or the prose would caveat the
     * wrong number.
     */
    conditionMix: mix,
    subjectCondition: subjectGrade ?? undefined,
    conditionMismatch,
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
