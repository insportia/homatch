// HOMATCH RESEARCH CORE — a listing is not a property.
//
// The same flat is on ss.ge at $150,000, on an agency site at $162,000 and on
// a portal at $155,000. Three observations, one property — and the fact that
// they disagree is one of the more interesting things Homatch can know. A
// resolver that merges them into "a flat at $155,667" has destroyed the
// question a customer would actually ask.
//
// So this decides WHETHER two observations are about the same property, and
// it never decides what the answer is. Merging is somebody else's job and it
// happens only on a verdict this module is confident about.
//
// FIVE VERDICTS, AND THE TWO THAT MATTER MOST ARE THE CAUTIOUS ONES
//
//   EXACT_DUPLICATE     the same listing, seen twice. Same source and id, or
//                       the same canonical URL. Not a judgement at all.
//   LIKELY_SAME_ENTITY  different sources, and enough agrees that one
//                       property is the better explanation.
//   RELATED             plainly connected and not the same — two units in one
//                       building, the same flat listed for sale and for rent.
//   DISTINCT            something disagrees that cannot disagree.
//   UNRESOLVED          not enough to say. THE DEFAULT, and the one that
//                       keeps two rows two rows.
//
// WHY UNRESOLVED IS THE DEFAULT
//
// Because the cost is asymmetric and permanent. Two entities that should have
// been one is a duplicate a customer sees and a human can merge later. One
// entity that should have been two is two properties' evidence fused into a
// record describing neither, and the observations that would prove it wrong
// have been attributed to the wrong thing. The first is untidy; the second is
// unrecoverable.
//
// WHAT COUNTS AS A CONTRADICTION
//
// A contradiction is not a difference. Two sources listing the same flat WILL
// disagree about price — that is the normal case and the reason this exists.
// What cannot disagree is physics: a 45 m² flat and a 120 m² flat in the same
// building are not the same flat however similar everything else looks.
//
// AI IS NOT ADMITTED HERE
//
// Nothing in this file calls a model, and the decision is a pure function of
// stated fields. A semantic similarity score may be offered as one SIGNAL by
// a caller, but it cannot by itself reach LIKELY_SAME_ENTITY: an irreversible
// merge decided by something that cannot be re-derived is a merge nobody can
// audit.

export type ResolutionVerdict =
  | 'EXACT_DUPLICATE'
  | 'LIKELY_SAME_ENTITY'
  | 'RELATED'
  | 'DISTINCT'
  | 'UNRESOLVED';

/** One observation, in the shape resolution needs and nothing more. */
export interface ResolvableObservation {
  id: string;
  sourceId: string;
  adapterId: string;
  externalId: string | null;
  canonicalUrl: string | null;

  countryCode: string | null;
  city: string | null;
  district: string | null;
  transaction: string | null;
  propertyType: string | null;

  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;

  saleAmount: number | null;
  saleCurrency: string | null;

  contentFingerprint: string | null;
  /** 0..1 from structuredQuality. Whose statement is better evidence. */
  quality: number;
  /**
   * Optional, and never sufficient on its own. A caller may supply a
   * semantic similarity from a model; it can raise confidence within a band
   * the deterministic signals already reached, and cannot create one.
   */
  semanticSimilarity?: number | null;
}

export interface ResolutionSignal {
  name: string;
  /** Positive pulls toward one entity, negative pushes apart. */
  weight: number;
  detail: string;
}

export interface ResolutionDecision {
  verdict: ResolutionVerdict;
  /** 0..1. What the signals added up to, not how the answer feels. */
  confidence: number;
  signals: ResolutionSignal[];
  reason: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Comparisons
 * ──────────────────────────────────────────────────────────────────────── */

const norm = (v: string | null | undefined) =>
  String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Both present and equal. Absent is not agreement. */
function agrees(a: string | null, b: string | null): boolean {
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}

/** Both present and different. Absent is not disagreement either. */
function conflicts(a: string | null, b: string | null): boolean {
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && right.length > 0 && left !== right;
}

/**
 * Two areas describing the same flat, within measurement noise.
 *
 * Portals round, include or exclude balconies, and occasionally publish the
 * built area where another publishes the usable one. Three percent absorbs
 * that and nothing larger: a 45 m² flat and a 120 m² flat are not the same
 * flat however similar everything else looks.
 */
const AREA_TOLERANCE = 0.03;

function areaAgrees(a: number | null, b: number | null): 'AGREE' | 'CONFLICT' | 'UNKNOWN' {
  if (a === null || b === null || a <= 0 || b <= 0) return 'UNKNOWN';
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff <= AREA_TOLERANCE) return 'AGREE';
  return 'CONFLICT';
}

/**
 * How far apart two asking prices are, as a fraction.
 *
 * NEVER a contradiction. Two sources listing the same flat routinely differ
 * by ten percent — a stale listing, a negotiated reduction, an agency's own
 * margin — and treating that as evidence of two properties would split
 * exactly the case this module exists to find.
 */
function priceSpread(a: ResolvableObservation, b: ResolvableObservation): number | null {
  if (a.saleAmount === null || b.saleAmount === null) return null;
  if (a.saleAmount <= 0 || b.saleAmount <= 0) return null;
  // Different currencies are not comparable without a rate, and there is no
  // rate in this module on purpose.
  if (conflicts(a.saleCurrency, b.saleCurrency)) return null;
  return Math.abs(a.saleAmount - b.saleAmount) / Math.max(a.saleAmount, b.saleAmount);
}

/* ────────────────────────────────────────────────────────────────────────
 * The decision
 * ──────────────────────────────────────────────────────────────────────── */

/** Enough agreement to call it one property. */
export const LIKELY_THRESHOLD = 0.7;
/** Enough to be worth a human's attention, and not enough to merge. */
export const RELATED_THRESHOLD = 0.4;

export function resolve(
  a: ResolvableObservation,
  b: ResolvableObservation,
): ResolutionDecision {
  const signals: ResolutionSignal[] = [];
  const say = (name: string, weight: number, detail: string) => {
    signals.push({ name, weight, detail });
  };

  if (a.id === b.id) {
    return { verdict: 'EXACT_DUPLICATE', confidence: 1, signals, reason: 'the same observation' };
  }

  /*
   * THE SAME LISTING, SEEN TWICE. Not a judgement: one source cannot publish
   * the same id for two properties, and if it does its id is not an identity
   * and everything downstream is already wrong.
   */
  if (a.sourceId === b.sourceId && a.externalId && agrees(a.externalId, b.externalId)) {
    say('same source id', 1, `${a.adapterId}:${a.externalId}`);
    return { verdict: 'EXACT_DUPLICATE', confidence: 1, signals, reason: 'the same listing on the same source' };
  }
  if (a.canonicalUrl && agrees(a.canonicalUrl, b.canonicalUrl)) {
    say('same canonical url', 1, String(a.canonicalUrl));
    return { verdict: 'EXACT_DUPLICATE', confidence: 1, signals, reason: 'the same canonical URL' };
  }

  /*
   * IDENTICAL TEXT ACROSS SOURCES. Cross-posting is routine — an agency
   * publishes the same description on three portals — and identical prose is
   * very strong evidence of one property. Strong, not conclusive: a
   * developer's boilerplate can be identical across genuinely different
   * units in one building, which is why this reaches LIKELY and not EXACT.
   */
  let score = 0;
  if (a.contentFingerprint && agrees(a.contentFingerprint, b.contentFingerprint)) {
    say('identical content', 0.6, 'the same text on two sources');
    score += 0.6;
  }

  /* ── contradictions first ──────────────────────────────────────────── */

  const area = areaAgrees(a.areaSqm, b.areaSqm);
  if (area === 'CONFLICT') {
    say('area conflict', -1, `${a.areaSqm} m² vs ${b.areaSqm} m²`);
    return {
      verdict: 'DISTINCT',
      confidence: 0.9,
      signals,
      // Physics, not preference. Everything else can differ; this cannot.
      reason: 'the stated areas cannot describe one property',
    };
  }

  if (conflicts(a.city, b.city)) {
    say('city conflict', -1, `${a.city} vs ${b.city}`);
    return { verdict: 'DISTINCT', confidence: 0.85, signals, reason: 'different cities' };
  }

  if (conflicts(a.propertyType, b.propertyType)) {
    say('property type conflict', -0.8, `${a.propertyType} vs ${b.propertyType}`);
    return { verdict: 'DISTINCT', confidence: 0.75, signals, reason: 'different property types' };
  }

  /*
   * A ROOM COUNT IS NOT PHYSICS. Sources count a studio as 0, 1 and
   * "open-plan", and some count bedrooms where others count rooms. A
   * difference of one is noise; more than one is a real disagreement and
   * still only a push, not a verdict.
   */
  if (a.rooms !== null && b.rooms !== null && Math.abs(a.rooms - b.rooms) > 1) {
    say('room count', -0.4, `${a.rooms} vs ${b.rooms}`);
    score -= 0.4;
  }

  /* ── agreements ────────────────────────────────────────────────────── */

  if (area === 'AGREE') {
    say('area agrees', 0.45, `${a.areaSqm} m² and ${b.areaSqm} m² within ${AREA_TOLERANCE * 100}%`);
    score += 0.45;
  }
  if (agrees(a.district, b.district)) {
    say('same district', 0.2, String(a.district));
    score += 0.2;
  } else if (agrees(a.city, b.city)) {
    say('same city', 0.1, String(a.city));
    score += 0.1;
  }
  if (a.rooms !== null && a.rooms === b.rooms) {
    say('same room count', 0.15, String(a.rooms));
    score += 0.15;
  }
  if (a.floor !== null && a.floor === b.floor) {
    say('same floor', 0.1, String(a.floor));
    score += 0.1;
  }

  /*
   * PRICE AGREEMENT IS WEAK EVIDENCE AND DISAGREEMENT IS NONE AT ALL.
   *
   * Two flats of the same size in the same district have similar prices
   * because that is what a market is — so a close price says little. And a
   * 10% gap between two listings of one flat is the normal case, which is
   * why it subtracts nothing.
   */
  const spread = priceSpread(a, b);
  if (spread !== null && spread <= 0.02) {
    say('price agrees', 0.15, `${(spread * 100).toFixed(1)}% apart`);
    score += 0.15;
  } else if (spread !== null) {
    say('price differs', 0, `${(spread * 100).toFixed(0)}% apart — expected between sources, not evidence either way`);
  }

  /*
   * A MODEL MAY RAISE CONFIDENCE, NEVER CREATE IT.
   *
   * Capped at a small bonus and applied only where the deterministic signals
   * already reached the RELATED band. An irreversible merge decided by
   * something that cannot be re-derived is a merge nobody can audit.
   */
  const semantic = a.semanticSimilarity ?? b.semanticSimilarity ?? null;
  if (semantic !== null && semantic > 0.85 && score >= RELATED_THRESHOLD) {
    say('semantic similarity', 0.1, `${semantic.toFixed(2)} — a signal, never the decision`);
    score += 0.1;
  }

  const confidence = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  /*
   * THE SAME PROPERTY LISTED BOTH FOR SALE AND FOR RENT IS RELATED, NOT ONE
   * ENTITY. It is one flat and two offers, and fusing them would make a
   * monthly rent and a purchase price properties of the same record.
   */
  if (confidence >= LIKELY_THRESHOLD && conflicts(a.transaction, b.transaction)) {
    return {
      verdict: 'RELATED',
      confidence,
      signals,
      reason: 'the same property offered on different terms — one flat, two offers',
    };
  }

  if (confidence >= LIKELY_THRESHOLD) {
    return { verdict: 'LIKELY_SAME_ENTITY', confidence, signals, reason: describe(signals) };
  }
  if (confidence >= RELATED_THRESHOLD) {
    return { verdict: 'RELATED', confidence, signals, reason: `some agreement, not enough to merge: ${describe(signals)}` };
  }

  /*
   * THE DEFAULT. Two entities that should have been one is a duplicate
   * somebody can merge later; one entity that should have been two is two
   * properties' evidence fused into a record describing neither.
   */
  return {
    verdict: 'UNRESOLVED',
    confidence,
    signals,
    reason: signals.length ? `too little agreement: ${describe(signals)}` : 'nothing comparable was published',
  };
}

function describe(signals: ResolutionSignal[]): string {
  const positive = signals.filter((s) => s.weight > 0).map((s) => s.name);
  return positive.length ? positive.join(', ') : 'no positive signal';
}

/** May this verdict put two observations on one entity? */
export function mergesEntity(verdict: ResolutionVerdict): boolean {
  return verdict === 'EXACT_DUPLICATE' || verdict === 'LIKELY_SAME_ENTITY';
}

/**
 * The observation whose statement should represent the entity.
 *
 * The highest provenance wins, and ties go to the one that published more.
 * Deliberately NOT an average: an average of three asking prices is a number
 * no source published, and a customer shown it could not be told where it
 * came from.
 */
export function representative(
  observations: readonly ResolvableObservation[],
): ResolvableObservation | null {
  if (!observations.length) return null;
  return [...observations].sort((a, b) =>
    b.quality - a.quality
    || filled(b) - filled(a)
    || a.id.localeCompare(b.id))[0];
}

function filled(o: ResolvableObservation): number {
  return [o.areaSqm, o.rooms, o.bedrooms, o.floor, o.saleAmount, o.city, o.district]
    .filter((v) => v !== null && v !== undefined).length;
}

/**
 * What a set of observations says about one entity's price.
 *
 * The RANGE, not a figure. "Four sources, $150,000 to $162,000" is a true
 * sentence that preserves the disagreement; "$155,667" is a number nobody
 * published and that no source would recognise.
 */
export function priceRange(
  observations: readonly ResolvableObservation[],
): { min: number; max: number; currency: string; spread: number } | null {
  const priced = observations.filter((o) => o.saleAmount !== null && o.saleAmount > 0 && o.saleCurrency);
  if (!priced.length) return null;

  // One currency at a time. Converting would need a rate, and a rate has a
  // date and a source that this module does not have.
  const currency = String(priced[0].saleCurrency);
  const sameCurrency = priced.filter((o) => norm(o.saleCurrency) === norm(currency));
  if (!sameCurrency.length) return null;

  const amounts = sameCurrency.map((o) => Number(o.saleAmount));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return { min, max, currency, spread: max > 0 ? Number(((max - min) / max).toFixed(4)) : 0 };
}
