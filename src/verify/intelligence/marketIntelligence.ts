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
 * The comparison hierarchy, most relevant first (2026-10-10 market gate).
 *
 *   SAME_PROJECT   the same development (same building when a block is known)
 *   SAME_STREET    the immediate micro-location: the same street, or measured
 *                  within 600 m when both sides carry coordinates
 *   PEER_PROJECT   a NAMED comparable development in the SAME or an ADJACENT
 *                  neighbourhood (see marketGeography.ts) whose segment is
 *                  shown to match — price band and/or condition. Unknown
 *                  segment or unknown geography never qualifies.
 *   SAME_DISTRICT  other stock in the same neighbourhood — context only
 *   WIDER_MARKET   everything else in the city — background only
 *
 * Only the first three may ever form the HEADLINE range, and only with at
 * least MIN_RELIABLE_SAMPLE listings after outlier trimming. Production job
 * 220ed087 (Villion Krtsanisi Homes) headlined "$928–3,000/m²" from 39
 * listings in Saburtalo, Navtlughi, Didi Dighomi and Didube labelled
 * PEER_PROJECT merely because they carried a project name. That label no
 * longer means "named, anywhere".
 */
import {
  conditionDistance,
  conditionGrade,
  conditionMix,
  type ConditionGrade,
  type ConditionMix,
} from './comparableCondition.ts';
import { areAdjacent, firstAreaOf, type AreaKey } from './marketGeography.ts';

export type ComparableTier =
  | 'SAME_PROJECT'
  | 'SAME_STREET'
  | 'SAME_DISTRICT'
  | 'PEER_PROJECT'
  | 'WIDER_MARKET';

/** The tiers allowed to form the headline range. Everything else is context. */
export const HEADLINE_TIERS: readonly ComparableTier[] = ['SAME_PROJECT', 'SAME_STREET', 'PEER_PROJECT'];

/** Fewer reliable listings than this and there is no headline range at all. */
export const MIN_RELIABLE_SAMPLE = 3;

/** What the headline is built from, or why there is none. */
export type MarketBasis = ComparableTier | 'EVIDENCE_LIMITED';

/**
 * Short machine-readable reasons a comparable sits where it does.
 * Stable codes — the narrative and Admin read these, never free prose.
 */
export type RelevanceReason =
  | 'SAME_PROJECT'
  | 'SAME_STREET'
  | 'WITHIN_600M'
  | 'SAME_DISTRICT'
  | 'ADJACENT_DISTRICT'
  | 'OTHER_DISTRICT'
  | 'DISTRICT_UNKNOWN'
  | 'DISTRICT_FROM_STREET_NAME'
  | 'NAMED_DEVELOPMENT'
  | 'UNNAMED_STOCK'
  | 'PRICE_BAND_MATCH'
  | 'PRICE_BAND_MISMATCH'
  | 'CONDITION_MATCH'
  | 'CONDITION_MISMATCH'
  | 'SEGMENT_UNKNOWN'
  | 'SIZE_NEAR_IDENTICAL'
  | 'SIZE_SIMILAR'
  | 'SIZE_VERY_DIFFERENT'
  | 'SAME_ROOMS'
  | 'SIMILAR_FLOOR'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'STALE'
  | 'HEADLINE_ELIGIBLE'
  | 'CONTEXT_ONLY'
  | 'OUTLIER_TRIMMED';

/** Published per band, so the customer sees the whole hierarchy at once. */
export interface TierStats {
  tier: ComparableTier;
  /** After outlier trimming (IQR) when the band holds four or more. */
  median: number;
  min: number;
  max: number;
  count: number;
  /** Too few listings to characterise this band on its own. */
  thin: boolean;
  /** SAME_DISTRICT / WIDER_MARKET: background, never this property's value. */
  contextOnly: boolean;
  /** Listings outside the IQR fences, left out of median/min/max. */
  outliersTrimmed: number;
}

/**
 * The project's OWN asking prices — never transactions.
 *
 * A same-project listing, an archived offer for the project, or the
 * developer's marketing "from" price. Kept apart from the headline so a
 * report with no reliable local sample can still say what the project
 * itself asks, labelled as an ask.
 */
export type ProjectAskingOrigin = 'SAME_PROJECT_LISTING' | 'ARCHIVED_OFFER' | 'DEVELOPER_MARKETING';

export interface ProjectAskingEvidence {
  kind: 'ASKING';
  origin: ProjectAskingOrigin;
  pricePerSqm: number;
  currency: string;
  state: ListingState;
  url?: string;
  date?: string;
  /** Always true: an asking price is not a sale price. */
  notTransaction: true;
}

/** The headline range, or the explicit statement that there is none. */
export interface MarketHeadline {
  state: 'RANGE' | 'EVIDENCE_LIMITED';
  basis: MarketBasis;
  /** Which headline-eligible tiers the numbers came from. Empty when limited. */
  tiersUsed: ComparableTier[];
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Listings in the range after trimming; when limited, the eligible listings found. */
  count: number;
  outliersTrimmed: number;
  minimumSample: number;
  trimMethod: 'IQR_1_5' | 'NONE';
}

/** One line of "why these comparables", as a stable code plus a count. */
export interface WhySelected {
  code:
    | 'HEADLINE_FROM_TIER'
    | 'EVIDENCE_LIMITED'
    | 'CONTEXT_ONLY_TIER'
    | 'EXCLUDED_OTHER_DISTRICT'
    | 'EXCLUDED_DISTRICT_UNKNOWN'
    | 'EXCLUDED_SEGMENT_MISMATCH'
    | 'EXCLUDED_SEGMENT_UNKNOWN'
    | 'EXCLUDED_STALE'
    | 'OUTLIERS_TRIMMED'
    | 'DUPLICATES_REMOVED'
    | 'EXPIRED_EXCLUDED'
    | 'PROJECT_ASKING_EVIDENCE';
  count: number;
  tier?: ComparableTier;
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
  /** The neighbourhood the source stated, when it did. */
  district?: string | null;
  /** Measured metres from the subject, only when both had coordinates. */
  distanceM?: number | string | null;
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
  /** Machine-readable: why this listing sits in its tier and how it compares. */
  relevanceReasons: RelevanceReason[];
  /** The neighbourhood it resolved to, when one could be read. */
  district?: AreaKey;
  /** Segment evidence against the subject: MATCH needs a positive signal. */
  segment: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
  /** May contribute to the headline range (tier, freshness, not trimmed). */
  headlineEligible: boolean;
  /** Left out of a range because it fell outside the IQR fences. */
  outlier?: boolean;
}

/**
 * Whether the subject unit can be positioned against the market, and if not,
 * WHY NOT.
 *
 * These are two independent questions and the report kept collapsing them
 * into one sentence. The Villion job carried 43 comparables, 32 of them
 * active, and a median — and still told the reader there was not enough data
 * to assess, because the SUBJECT had no asking price of its own. That is a
 * statement about the subject, not about the market, and printing it as the
 * market's verdict discards a usable comparable set.
 */
export type SubjectValuationState =
  /** Subject price known and a basis exists: a real position can be stated. */
  | 'AVAILABLE'
  /** The market is understood; this specific unit has no price to compare. */
  | 'NO_SUBJECT_PRICE'
  /**
   * Context exists, but fewer than MIN_RELIABLE_SAMPLE eligible local
   * listings: there is no headline range to place this unit against.
   */
  | 'EVIDENCE_LIMITED'
  /** Nothing comparable was found; no market statement can be made at all. */
  | 'NO_COMPARABLE_BASIS';

export interface MarketIntelligence {
  currency: string;
  /** The subject's own asking price, when the research actually found one. */
  subjectPricePerSqm?: number;
  subjectTotalPrice?: number;
  subjectArea?: number;

  /*
   * THE HEADLINE, MIRRORED FROM `headline` FOR EXISTING READERS.
   *
   * Null when the basis is EVIDENCE_LIMITED: no district or city spread is
   * ever substituted for a missing local range.
   */
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Listings behind the headline (eligible listings found, when limited). */
  count: number;
  /** Every priced listing that was scored, whatever its tier. */
  analyzedCount: number;

  /** The band the headline is based on, or EVIDENCE_LIMITED. */
  basis: MarketBasis;
  basisCount: number;
  headline: MarketHeadline;
  /** The project's own asking prices (listings, archived offers, marketing). */
  projectAskingEvidence: ProjectAskingEvidence[];
  /** Summary of projectAskingEvidence; asks, never transactions. */
  projectAskingRange: { min: number; max: number; median: number; count: number; currency: string } | null;
  /** Why the headline is what it is, as stable codes with counts. */
  whySelected: WhySelected[];

  /*
   * MARKET CONTEXT AND SUBJECT VALUATION, ANSWERED SEPARATELY.
   *
   * Computed here rather than left to prose, because prose kept merging them.
   * `contextAvailable` says a reader can be told what this market looks like;
   * `subjectValuation` says whether THIS unit can be placed inside it.
   */
  contextAvailable: boolean;
  subjectValuation: SubjectValuationState;

  /** Present only when the subject's own price is known. */
  deltaFromMedianPct?: number;
  deltaFromClosestPct?: number;
  positioning?: Positioning;

  /** Best few, already ordered. Kept for the model to reason over. */
  closest: ScoredComparable[];
  /*
   * THE WHOLE RANKED POOL, not just the shortlist.
   *
   * `closest` is `scored.slice(0, 5)` and that truncation is safe — the sort
   * is band-first, then relevance within the band, so a stronger
   * same-project or same-street listing can never be cut in favour of a
   * weaker one. What the shortlist CANNOT do is describe the wider market:
   * with five strong local listings there is nothing left in it to label as
   * city context, so that bucket was always empty.
   *
   * Customer selection therefore reads this, and the five-item shortlist
   * stays exactly what it was for the model's prose.
   */
  ranked: ScoredComparable[];
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

/**
 * The Tbilisi district an address names, in Georgian — kept for callers that
 * want a display name. Tiering itself uses marketGeography.areaOf().
 */
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
  /**
   * The neighbourhood/district, when the research resolved one. Preferred
   * over anything read out of the address, because a street NAMED after a
   * neighbourhood ("Krtsanisi St.") is not proof of being in it.
   */
  district?: string;
  area?: number;
  rooms?: number;
  floor?: number;
  pricePerSqm?: number;
  totalPrice?: number;
  currency?: string;
  /** PREMIUM tightens the price band a peer must sit in. */
  segment?: 'PREMIUM' | 'STANDARD';
  /** The project's own asks gathered outside the comparable list. */
  projectAsking?: Array<{
    pricePerSqm: number;
    currency?: string;
    origin: ProjectAskingOrigin;
    url?: string;
    date?: string;
  }>;
}

/** Context the build computes once and every comparable is scored against. */
export interface ScoringContext {
  /**
   * The project's own price level (subject ask, else the median of the
   * project's asks). A peer's price band is judged against this.
   */
  priceAnchor?: number;
}

/** Older than this and a listing is context, never headline. */
const STALE_MONTHS = 18;

/** A peer's price per m² must sit inside anchor × [low, high]. */
const BAND = { low: 0.75, high: 1.33, premiumLow: 0.85 };

/**
 * Whether a comparable is the same KIND of product as the subject.
 *
 * MATCH needs a positive signal — a price band around the project's own
 * level, or a condition on a neighbouring rung. Anything contradicting is a
 * MISMATCH. With no signal at all it is UNKNOWN, and UNKNOWN is never
 * treated as a match.
 */
function segmentOf(
  subject: Subject,
  ppsm: number,
  compCondition: unknown,
  ctx: ScoringContext,
  out: RelevanceReason[],
): 'MATCH' | 'MISMATCH' | 'UNKNOWN' {
  let match = false;
  let mismatch = false;
  const anchor = ctx.priceAnchor;
  if (anchor && anchor > 0) {
    const low = subject.segment === 'PREMIUM' ? BAND.premiumLow : BAND.low;
    const r = ppsm / anchor;
    if (r >= low && r <= BAND.high) { match = true; out.push('PRICE_BAND_MATCH'); }
    else { mismatch = true; out.push('PRICE_BAND_MISMATCH'); }
  }
  const rungs = conditionDistance(subject.condition, compCondition);
  if (rungs !== null) {
    if (rungs <= 1) { match = true; out.push('CONDITION_MATCH'); }
    else { mismatch = true; out.push('CONDITION_MISMATCH'); }
  }
  if (mismatch) return 'MISMATCH';
  if (match) return 'MATCH';
  out.push('SEGMENT_UNKNOWN');
  return 'UNKNOWN';
}

/**
 * How comparable a listing really is.
 *
 * Deliberately dominated by LOCATION, because a same-project unit two floors
 * up is a far better guide than a same-sized flat across the city. Area and
 * room similarity refine within that; recency and an active listing state add
 * a little confidence. A generic city-wide listing can never outscore a
 * same-project one.
 *
 * The research layer's own label is trusted only where it cannot overstate:
 * SAME_PROJECT (identity) and a measured distance. A PEER_PROJECT or
 * MICRO_LOCATION label alone proves nothing about where a listing is.
 */
export function scoreComparable(subject: Subject, c: RawComparable, ctx: ScoringContext = {}): ScoredComparable | null {
  const pps = num(c.pricePerSqm);
  const area = num(c.area);
  const total = num(c.price);
  const derived = pps ?? (total && area && area > 0 ? total / area : undefined);
  if (!derived || derived <= 0) return null;

  const reasons: string[] = [];
  const why: RelevanceReason[] = [];
  let tier: ComparableTier = 'WIDER_MARKET';
  /*
   * THE BASE LEAVES ROOM FOR THE REFINEMENTS.
   *
   * These used to start at 100 for a same-project listing, against a 0..100
   * clamp — so every refinement above it was discarded, and two flats in the
   * same building both scored 100 whether one was bare concrete and the other
   * finished. The bands still dominate, and the tier-first sort below makes
   * that structural rather than arithmetic.
   */
  let score = 16;

  const state: ListingState =
    lower(c.listingStatus) === 'active'
      ? 'ACTIVE'
      : /expired|removed|sold|inactive|withdrawn|archiv|დასრულებ|წაშლილ/.test(lower(c.listingStatus))
        ? 'EXPIRED'
        : 'UNKNOWN';

  const label = lower(c.comparableType);
  const sameProject =
    label === 'same_project' ||
    // Both addresses, so a shared district name is recognised as a place
    // rather than as a shared identity.
    sameProjectName(subject.project, c.project, `${text(subject.address)} ${text(c.address)}`);
  const sameStreet =
    !!subject.address && !!c.address && streetKey(subject.address) !== '' &&
    streetKey(subject.address) === streetKey(c.address);
  const distance = num(c.distanceM);
  const measuredNear = distance !== undefined && distance >= 0 && distance <= 600;

  const subjArea = firstAreaOf(subject.district, subject.address);
  const compArea = firstAreaOf(c.district, c.address);
  const relation: 'SAME' | 'ADJACENT' | 'OTHER' | 'UNKNOWN' =
    !subjArea || !compArea
      ? 'UNKNOWN'
      : subjArea.area === compArea.area
        ? 'SAME'
        : areAdjacent(subjArea.area, compArea.area)
          ? 'ADJACENT'
          : 'OTHER';
  const named = !!text(c.project) || label === 'peer_project';

  if (sameProject) {
    tier = 'SAME_PROJECT';
    score = 76;
    reasons.push('same project');
    why.push('SAME_PROJECT');
  } else if (sameStreet || measuredNear) {
    tier = 'SAME_STREET';
    score = 60;
    reasons.push('same street');
    why.push(sameStreet ? 'SAME_STREET' : 'WITHIN_600M');
  } else {
    why.push(
      relation === 'SAME' ? 'SAME_DISTRICT'
        : relation === 'ADJACENT' ? 'ADJACENT_DISTRICT'
          : relation === 'OTHER' ? 'OTHER_DISTRICT'
            : 'DISTRICT_UNKNOWN',
    );
    if (compArea?.viaStreetName || (relation !== 'UNKNOWN' && subjArea?.viaStreetName)) why.push('DISTRICT_FROM_STREET_NAME');
    why.push(named ? 'NAMED_DEVELOPMENT' : 'UNNAMED_STOCK');
    // Segment is only asked of a candidate peer: nearby and named.
    const nearby = relation === 'SAME' || relation === 'ADJACENT';
    const segment = nearby && named ? segmentOf(subject, derived, c.condition, ctx, why) : 'UNKNOWN';
    if (nearby && named && segment === 'MATCH') {
      /*
       * A NAMED DEVELOPMENT NEARBY, IN THE SAME SEGMENT, IS A PEER.
       *
       * Strict on purpose. A name alone used to be enough — anywhere in the
       * city — and that is how 39 listings from Saburtalo and Didi Dighomi
       * became the "peer" basis of a Krtsanisi valuation.
       */
      tier = 'PEER_PROJECT';
      score = 50;
      reasons.push('comparable development nearby');
    } else if (relation === 'SAME' || (relation === 'UNKNOWN' && label === 'same_district')) {
      tier = 'SAME_DISTRICT';
      score = 40;
      reasons.push('same district');
    }
  }

  const rooms = num(c.rooms);
  const floor = num(c.floor);

  if (subject.area && area) {
    const diff = Math.abs(area - subject.area) / subject.area;
    if (diff <= 0.08) { score += 12; reasons.push('near-identical size'); why.push('SIZE_NEAR_IDENTICAL'); }
    else if (diff <= 0.2) { score += 6; reasons.push('similar size'); why.push('SIZE_SIMILAR'); }
    else if (diff > 0.5) { score -= 10; reasons.push('very different size'); why.push('SIZE_VERY_DIFFERENT'); }
  }
  if (subject.rooms && rooms && rooms === subject.rooms) { score += 5; reasons.push('same room count'); why.push('SAME_ROOMS'); }
  if (subject.floor && floor && Math.abs(floor - subject.floor) <= 1) { score += 3; reasons.push('similar floor'); why.push('SIMILAR_FLOOR'); }
  if (state === 'ACTIVE') { score += 4; reasons.push('currently listed'); why.push('ACTIVE'); }
  // A price that came off the market is weaker evidence of today's market,
  // even where it is still allowed to inform the picture.
  if (state === 'EXPIRED') { score -= 8; reasons.push('no longer listed'); why.push('EXPIRED'); }

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
  const stale = ageMonths !== undefined && ageMonths > STALE_MONTHS;
  if (stale) why.push('STALE');

  const segment: ScoredComparable['segment'] =
    why.includes('PRICE_BAND_MISMATCH') || why.includes('CONDITION_MISMATCH')
      ? 'MISMATCH'
      : why.includes('PRICE_BAND_MATCH') || why.includes('CONDITION_MATCH')
        ? 'MATCH'
        : 'UNKNOWN';
  const headlineEligible = HEADLINE_TIERS.includes(tier) && !stale;
  why.push(headlineEligible ? 'HEADLINE_ELIGIBLE' : 'CONTEXT_ONLY');

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
    relevanceReasons: why,
    district: compArea?.area,
    segment,
    headlineEligible,
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

/*
 * Most relevant first. A strict PEER_PROJECT (named, nearby, same segment)
 * now outranks generic same-district stock: it is the closer product.
 */
export const TIER_ORDER: ComparableTier[] = [
  'SAME_PROJECT', 'SAME_STREET', 'PEER_PROJECT', 'SAME_DISTRICT', 'WIDER_MARKET',
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

/**
 * Tukey fences (1.5 × IQR) on price per m².
 *
 * Nothing is trimmed below four listings: with three, "the odd one out" is a
 * matter of opinion, and the range already says how wide it is.
 */
export function trimOutliers<T>(items: T[], value: (t: T) => number): { kept: T[]; trimmed: T[] } {
  if (items.length < 4) return { kept: items.slice(), trimmed: [] };
  const s = items.map(value).sort((a, b) => a - b);
  const q = (p: number): number => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const kept: T[] = [];
  const trimmed: T[] = [];
  for (const t of items) (value(t) >= low && value(t) <= high ? kept : trimmed).push(t);
  return { kept, trimmed };
}

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

const ARCHIVE_HINT = /archiv|არქივ|wayback|web\.archive/i;

/**
 * The project's own asking prices, from what the research recorded.
 *
 * Same-project listings (live or archived) and the developer's marketing
 * "from" price. Every entry is kind ASKING: none of them is what a flat sold
 * for, and the type cannot say otherwise.
 */
function projectAskingFrom(
  subject: Subject,
  sameProject: ScoredComparable[],
): ProjectAskingEvidence[] {
  const out: ProjectAskingEvidence[] = [];
  const seen = new Set<string>();
  const push = (e: ProjectAskingEvidence) => {
    const key = `${e.origin}|${Math.round(e.pricePerSqm)}|${(e.url ?? '').toLowerCase().replace(/[?#].*$/, '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  for (const a of subject.projectAsking ?? []) {
    const p = num(a?.pricePerSqm);
    if (!p || p <= 0) continue;
    push({
      kind: 'ASKING',
      origin: a.origin,
      pricePerSqm: Math.round(p),
      currency: text(a.currency) || subject.currency || 'USD',
      state: a.origin === 'ARCHIVED_OFFER' ? 'EXPIRED' : 'UNKNOWN',
      ...(a.url ? { url: a.url } : {}),
      ...(a.date ? { date: a.date } : {}),
      notTransaction: true,
    });
  }
  for (const c of sameProject) {
    const archived = c.state === 'EXPIRED' || ARCHIVE_HINT.test(`${c.similarity ?? ''} ${c.url ?? ''}`);
    push({
      kind: 'ASKING',
      origin: archived ? 'ARCHIVED_OFFER' : 'SAME_PROJECT_LISTING',
      pricePerSqm: Math.round(c.pricePerSqm),
      currency: c.currency,
      state: c.state,
      ...(c.url ? { url: c.url } : {}),
      notTransaction: true,
    });
  }
  return out;
}

const CONTEXT_TIERS: readonly ComparableTier[] = ['SAME_DISTRICT', 'WIDER_MARKET'];

/**
 * THE ONE PLACE THE MARKET HEADLINE IS COMPUTED.
 *
 * Called at synthesis (bundle.ts → verify-synthesis), after acquisition has
 * finished, over every comparable the run gathered. The model is handed the
 * result; it never computes or widens a range itself.
 *
 *   1. score every comparable (tier, segment, freshness, reasons);
 *   2. dedupe, and drop expired listings while current ones exist;
 *   3. headline = the most relevant HEADLINE tier holding ≥ 3 listings after
 *      IQR trimming, else all headline-eligible listings together if they
 *      reach 3 (labelled with the widest tier used), else EVIDENCE_LIMITED
 *      with NO median/min/max — a district or city spread is never put in
 *      its place;
 *   4. district and city bands are published as context only;
 *   5. the project's own asks travel separately as ASKING evidence.
 */
export function buildMarketIntelligence(
  subject: Subject,
  raw: RawComparable[],
  /** Snapshot signals, so the price can be read against the product. */
  quality: QualityFactor[] = []
): MarketIntelligence | null {
  /*
   * THE PROJECT'S OWN PRICE LEVEL, FOR THE PEER PRICE BAND.
   *
   * The subject's own ask when it has one; otherwise what the project itself
   * asks (marketing price, archived offers, same-project listings). Without
   * any of these, a peer can still match on condition — never on nothing.
   */
  const firstPass = raw
    .map((c) => scoreComparable(subject, c))
    .filter((c): c is ScoredComparable => !!c);
  const projectLevels = [
    ...(subject.projectAsking ?? []).map((a) => num(a?.pricePerSqm)).filter((n): n is number => !!n && n > 0),
    ...firstPass.filter((c) => c.tier === 'SAME_PROJECT').map((c) => c.pricePerSqm),
  ];
  const priceAnchor = subject.pricePerSqm || (projectLevels.length ? median(projectLevels) : undefined);

  const all = raw
    .map((c) => scoreComparable(subject, c, { priceAnchor }))
    .filter((c): c is ScoredComparable => !!c)
    /*
     * BAND FIRST, THEN HOW CLOSE WITHIN IT.
     *
     * Sorting on the score alone made 'a peer project never outranks a
     * location match' an arithmetic accident. Making it the primary key
     * states the rule instead of hoping for it.
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
   * Dropped only when there is still something current to compare against,
   * and UNKNOWN is never treated as expired. An expired same-project offer
   * is still kept as the project's own ASKING evidence below.
   */
  const current = unique.filter((c) => c.state !== 'EXPIRED');
  const expiredExcluded = current.length ? unique.length - current.length : 0;
  const scored = current.length ? current : unique;

  if (!scored.length) return null;

  const tierCounts = TIER_ORDER.reduce(
    (acc, t) => ({ ...acc, [t]: scored.filter((c) => c.tier === t).length }),
    {} as Record<ComparableTier, number>
  );

  /* ---- the headline: eligible tiers only, trimmed, at least three ---- */

  const eligible = scored.filter((c) => c.headlineEligible);
  let chosen: ScoredComparable[] | null = null;
  let trimmedOut: ScoredComparable[] = [];
  let tiersUsed: ComparableTier[] = [];
  for (const t of HEADLINE_TIERS) {
    const { kept, trimmed } = trimOutliers(eligible.filter((c) => c.tier === t), (c) => c.pricePerSqm);
    if (kept.length >= MIN_RELIABLE_SAMPLE) {
      chosen = kept;
      trimmedOut = trimmed;
      tiersUsed = [t];
      break;
    }
  }
  if (!chosen) {
    /*
     * No single tier is deep enough, but the eligible tiers together may be:
     * two same-project asks and two named developments next door are four
     * local listings. Labelled with the WIDEST tier used — never a narrower
     * one the numbers did not come from.
     */
    const { kept, trimmed } = trimOutliers(eligible, (c) => c.pricePerSqm);
    if (kept.length >= MIN_RELIABLE_SAMPLE) {
      chosen = kept;
      trimmedOut = trimmed;
      tiersUsed = HEADLINE_TIERS.filter((t) => kept.some((c) => c.tier === t));
    }
  }
  for (const c of trimmedOut) {
    c.outlier = true;
    c.relevanceReasons.push('OUTLIER_TRIMMED');
  }

  const limited = !chosen;
  const basis: MarketBasis = limited ? 'EVIDENCE_LIMITED' : tiersUsed[tiersUsed.length - 1];
  const values = (chosen ?? []).map((c) => c.pricePerSqm);
  const med = values.length ? median(values) : 0;
  const headline: MarketHeadline = {
    state: limited ? 'EVIDENCE_LIMITED' : 'RANGE',
    basis,
    tiersUsed,
    median: limited ? null : Math.round(med),
    mean: limited ? null : Math.round(mean(values)),
    min: limited ? null : Math.round(Math.min(...values)),
    max: limited ? null : Math.round(Math.max(...values)),
    count: limited ? eligible.length : values.length,
    outliersTrimmed: trimmedOut.length,
    minimumSample: MIN_RELIABLE_SAMPLE,
    trimMethod: trimmedOut.length ? 'IQR_1_5' : 'NONE',
  };

  const closest = scored.slice(0, 5);
  // Same ordering, no truncation: selection needs the bands the shortlist
  // cannot reach.
  const ranked = scored;

  const mix = conditionMix((chosen ?? []).map((c) => c.condition));
  const subjectGrade = conditionGrade(subject.condition);
  /*
   * The comparison is between different products. Only claimed when BOTH
   * sides are actually known and the headline set has a clear centre.
   */
  const conditionMismatch = !!subjectGrade && !!mix.dominant && subjectGrade !== mix.dominant;

  /*
   * MARKET CONTEXT AND SUBJECT VALUATION, ANSWERED SEPARATELY.
   *
   * Context exists whenever priced listings were gathered — even when none
   * of them may headline. Valuation needs a headline range.
   */
  const contextAvailable = scored.length > 0;
  const subjectValuation: SubjectValuationState = !contextAvailable
    ? 'NO_COMPARABLE_BASIS'
    : limited
      ? 'EVIDENCE_LIMITED'
      : subject.pricePerSqm
        ? 'AVAILABLE'
        : 'NO_SUBJECT_PRICE';

  const projectAskingEvidence = projectAskingFrom(subject, unique.filter((c) => c.tier === 'SAME_PROJECT'));
  const askVals = projectAskingEvidence.map((e) => e.pricePerSqm);
  const projectAskingRange = askVals.length
    ? {
        min: Math.min(...askVals),
        max: Math.max(...askVals),
        median: Math.round(median(askVals)),
        count: askVals.length,
        currency: projectAskingEvidence[0].currency,
      }
    : null;

  /* ---- why: stable codes with counts, for the narrative and Admin ---- */

  const whySelected: WhySelected[] = [];
  const add = (code: WhySelected['code'], count: number, tier?: ComparableTier) => {
    if (count > 0 || code === 'EVIDENCE_LIMITED') whySelected.push({ code, count, ...(tier ? { tier } : {}) });
  };
  if (limited) add('EVIDENCE_LIMITED', eligible.length);
  else for (const t of tiersUsed) add('HEADLINE_FROM_TIER', (chosen ?? []).filter((c) => c.tier === t).length, t);
  for (const t of CONTEXT_TIERS) add('CONTEXT_ONLY_TIER', tierCounts[t], t);
  const has = (c: ScoredComparable, r: RelevanceReason) => c.relevanceReasons.includes(r);
  const notHeadline = scored.filter((c) => !HEADLINE_TIERS.includes(c.tier));
  add('EXCLUDED_OTHER_DISTRICT', notHeadline.filter((c) => has(c, 'OTHER_DISTRICT')).length);
  add('EXCLUDED_DISTRICT_UNKNOWN', notHeadline.filter((c) => has(c, 'DISTRICT_UNKNOWN')).length);
  add('EXCLUDED_SEGMENT_MISMATCH', notHeadline.filter((c) => c.segment === 'MISMATCH').length);
  add('EXCLUDED_SEGMENT_UNKNOWN', notHeadline.filter((c) => has(c, 'SEGMENT_UNKNOWN')).length);
  add('EXCLUDED_STALE', scored.filter((c) => HEADLINE_TIERS.includes(c.tier) && has(c, 'STALE')).length);
  add('OUTLIERS_TRIMMED', trimmedOut.length);
  add('DUPLICATES_REMOVED', duplicatesRemoved);
  add('EXPIRED_EXCLUDED', expiredExcluded);
  add('PROJECT_ASKING_EVIDENCE', projectAskingEvidence.length);

  const out: MarketIntelligence = {
    contextAvailable,
    subjectValuation,
    currency: chosen?.[0]?.currency ?? scored[0]?.currency ?? subject.currency ?? 'USD',
    subjectPricePerSqm: subject.pricePerSqm,
    subjectTotalPrice: subject.totalPrice,
    subjectArea: subject.area,
    median: headline.median,
    mean: headline.mean,
    min: headline.min,
    max: headline.max,
    count: headline.count,
    analyzedCount: scored.length,
    basis,
    basisCount: headline.count,
    headline,
    projectAskingEvidence,
    projectAskingRange,
    whySelected,
    closest,
    ranked,
    tierCounts,
    // Every populated band, most relevant first, trimmed the same way. A
    // single listing is still worth showing as context — it is only barred
    // from CARRYING the analysis.
    tiers: TIER_ORDER.map((t) => {
      const inTier = scored.filter((c) => c.tier === t);
      if (!inTier.length) return null;
      const { kept, trimmed } = trimOutliers(inTier, (c) => c.pricePerSqm);
      const vs = kept.map((c) => c.pricePerSqm);
      return {
        tier: t,
        median: Math.round(median(vs)),
        min: Math.round(Math.min(...vs)),
        max: Math.round(Math.max(...vs)),
        count: inTier.length,
        thin: inTier.length < MIN_RELIABLE_SAMPLE,
        contextOnly: !HEADLINE_TIERS.includes(t),
        outliersTrimmed: trimmed.length,
      };
    }).filter((x): x is TierStats => x !== null),
    qualityFactors: quality,
    basisIsThin: limited,
    askingNotTransaction: true,
    duplicatesRemoved,
    expiredExcluded,
    /*
     * Computed over the HEADLINE set, not over everything: the mix has to
     * describe the set the median actually came from.
     */
    conditionMix: mix,
    subjectCondition: subjectGrade ?? undefined,
    conditionMismatch,
  };

  // Positioning only exists when the subject has a price of its own AND a
  // headline range exists. Inventing either would be the fabrication this
  // product refuses.
  if (!limited && subject.pricePerSqm && med > 0) {
    const delta = ((subject.pricePerSqm - med) / med) * 100;
    out.deltaFromMedianPct = round1(delta);
    out.positioning = positioningFor(delta);

    const closestMed = median((chosen ?? []).slice(0, 5).map((c) => c.pricePerSqm));
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
