// IS WHAT SOMEBODY WANTS THE SAME AS WHAT EXISTS?
//
// Homatch has had one direction of this since the beginning: run-matching-v2 takes a
// PROPERTY and scores intent_profiles against it. That answers "who wants this
// flat". It cannot answer the other question, and the other question is half the
// product:
//
//   FIND BUYERS    a property exists -> which demand fits it      (had it)
//   FIND PROPERTY  a buyer exists    -> which supply fits them    (did not)
//
// Both are the same comparison read from opposite ends, so there is one function
// here and not two. A second implementation for the reverse direction would drift,
// and the drift would show up as a flat that matches a buyer while the buyer does
// not match the flat.
//
// THE RULE THAT DECIDES EVERYTHING ELSE: THREE ANSWERS, NOT TWO
//
// Every dimension answers AGREE, CONFLICT or UNKNOWN, and UNKNOWN is the one that
// makes this honest. Real rows are full of holes -- production intent_profiles have
// no budget on most rows, supply_observations have no district on many, and
// detected_language is null more often than not.
//
//   treat UNKNOWN as AGREE    and every buyer matches every flat: the match list
//                             fills with nonsense and the customer pays for it
//   treat UNKNOWN as CONFLICT and one missing field destroys a real match: the
//                             product reports an empty market that is not empty
//
// Neither is acceptable, so UNKNOWN is carried through to the end and reported. The
// caller decides how much unstated information it will tolerate; this module
// refuses to decide that silently. It is the same three-valued discipline
// comparePlaces() already uses, for the same reason.
//
// AND A CONFLICT ON ONE DIMENSION IS FINAL
//
// Scores do not outvote contradictions. A two-bedroom flat is not a partial match
// for somebody who needs four, however well the price and district line up, and a
// weighted average would happily call it 0.7. So any CONFLICT makes the pair
// INCOMPATIBLE, and the score only ranks pairs that have no conflict at all.

import { comparePlaces } from '../normalize/place.ts';

export type DimensionVerdict = 'AGREE' | 'CONFLICT' | 'UNKNOWN';

export type MatchDimension =
  | 'TRANSACTION'
  | 'CITY'
  | 'DISTRICT'
  | 'PROPERTY_TYPE'
  | 'PRICE'
  | 'AREA'
  | 'BEDROOMS';

export interface DimensionResult {
  dimension: MatchDimension;
  verdict: DimensionVerdict;
  /** Plain words. Shown to a customer as the reason, so no jargon and no scores. */
  reason: string;
}

/** What a person is looking for. Shaped after intent_profiles, holes included. */
export interface DemandSide {
  transactionType: string | null;
  city: string | null;
  district: string | null;
  /** Several are allowed: somebody may accept a flat or a house. */
  propertyTypes: readonly string[] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  areaMin: number | null;
  areaMax: number | null;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
}

/** What exists. Shaped after supply_observations, holes included. */
export interface SupplySide {
  transaction: string | null;
  city: string | null;
  district: string | null;
  propertyType: string | null;
  saleAmount: number | null;
  saleCurrency: string | null;
  rentAmount: number | null;
  rentCurrency: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  rooms: number | null;
}

export type Compatibility =
  /** No conflicts, and enough agreed on to be worth showing. */
  | 'COMPATIBLE'
  /** No conflicts, but too much is unstated to claim a match. */
  | 'INSUFFICIENT_INFORMATION'
  /** At least one dimension contradicts. */
  | 'INCOMPATIBLE';

export interface MatchAssessment {
  compatibility: Compatibility;
  /** 0..1, and meaningful ONLY when compatibility is COMPATIBLE. */
  score: number;
  dimensions: DimensionResult[];
  agreed: MatchDimension[];
  conflicted: MatchDimension[];
  unknown: MatchDimension[];
  /** One sentence, in a customer's words. */
  rationale: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Normalising the two vocabularies
 * ──────────────────────────────────────────────────────────────────────── */

/** SALE or RENT, or null when the row does not say. Never guessed. */
function transaction(value: string | null | undefined): 'SALE' | 'RENT' | null {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return null;
  if (/RENT|LEASE|LET\b|QIRAVDEBA|АРЕНД|СДА/.test(text)) return 'RENT';
  if (/SALE|SELL|BUY|PURCHASE|IKIDEBA|ПРОДА/.test(text)) return 'SALE';
  return null;
}

/**
 * A coarse property class both sides can be compared in.
 *
 * Deliberately coarse. 'APARTMENT' and 'FLAT' are the same thing to a buyer, and a
 * matcher that separated them would report a conflict where none exists.
 */
function propertyClass(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text || text === 'ANY') return null;
  if (/APART|FLAT|BINA|КВАРТИР/.test(text)) return 'APARTMENT';
  if (/HOUSE|VILLA|COTTAGE|SAHLI|ДОМ/.test(text)) return 'HOUSE';
  if (/LAND|PLOT|AGRICULT|УЧАСТ/.test(text)) return 'LAND';
  if (/COMMERC|OFFICE|RETAIL|WAREHOUSE|ОФИС|КОММЕРЧ/.test(text)) return 'COMMERCIAL';
  return null;
}

/** A finite positive number, or null. Zero is not a price or an area. */
function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The dimensions
 * ──────────────────────────────────────────────────────────────────────── */

function compareTransaction(demand: DemandSide, supply: SupplySide): DimensionResult {
  const wanted = transaction(demand.transactionType);
  const offered = transaction(supply.transaction);
  if (!wanted || !offered) {
    return {
      dimension: 'TRANSACTION',
      verdict: 'UNKNOWN',
      reason: !wanted
        ? 'the enquiry does not say whether they want to buy or rent'
        : 'the listing does not say whether it is for sale or to rent',
    };
  }
  return wanted === offered
    ? { dimension: 'TRANSACTION', verdict: 'AGREE', reason: `both are ${wanted.toLowerCase()}` }
    : {
      dimension: 'TRANSACTION',
      verdict: 'CONFLICT',
      /*
       * The one conflict nobody would ever accept, and worth naming plainly: a
       * renter shown a purchase is not a near miss, it is the wrong product.
       */
      reason: `they want to ${wanted.toLowerCase()} and this is ${offered.toLowerCase()}`,
    };
}

function comparePlaceDimension(
  dimension: 'CITY' | 'DISTRICT',
  wanted: string | null,
  offered: string | null,
): DimensionResult {
  /*
   * comparePlaces() rather than string equality, because production holds one city
   * as 'Tbilisi', 'tbilisi' and 'თბილისი'. It answers UNKNOWN across scripts it
   * cannot resolve, and UNKNOWN is carried through rather than folded into either
   * side -- an unmade comparison is not a disagreement.
   */
  const verdict = comparePlaces(wanted, offered);
  const label = dimension === 'CITY' ? 'city' : 'district';
  if (verdict === 'AGREE') {
    return { dimension, verdict, reason: `the same ${label}` };
  }
  if (verdict === 'CONFLICT') {
    return { dimension, verdict, reason: `a different ${label}` };
  }
  return {
    dimension,
    verdict: 'UNKNOWN',
    reason: !wanted || !offered
      ? `one side states no ${label}`
      : `the two ${label} names cannot be compared across their scripts`,
  };
}

function comparePropertyType(demand: DemandSide, supply: SupplySide): DimensionResult {
  const offered = propertyClass(supply.propertyType);
  const wanted = (demand.propertyTypes ?? [])
    .map(propertyClass)
    .filter((value): value is string => value !== null);

  if (!offered || wanted.length === 0) {
    return {
      dimension: 'PROPERTY_TYPE',
      verdict: 'UNKNOWN',
      reason: !offered
        ? 'the listing does not say what kind of property this is'
        : 'the enquiry names no particular kind of property',
    };
  }
  return wanted.includes(offered)
    ? { dimension: 'PROPERTY_TYPE', verdict: 'AGREE', reason: `they are looking for a ${offered.toLowerCase()}` }
    : {
      dimension: 'PROPERTY_TYPE',
      verdict: 'CONFLICT',
      reason: `this is a ${offered.toLowerCase()} and they want ${wanted.map((w) => w.toLowerCase()).join(' or ')}`,
    };
}

function comparePrice(demand: DemandSide, supply: SupplySide): DimensionResult {
  const wanted = transaction(demand.transactionType) ?? transaction(supply.transaction);
  const amount = wanted === 'RENT'
    ? positive(supply.rentAmount)
    : wanted === 'SALE' ? positive(supply.saleAmount) : null;
  const listingCurrency = wanted === 'RENT' ? supply.rentCurrency : supply.saleCurrency;

  const min = positive(demand.budgetMin);
  const max = positive(demand.budgetMax);

  if (amount === null || (min === null && max === null)) {
    return {
      dimension: 'PRICE',
      verdict: 'UNKNOWN',
      reason: amount === null
        ? 'the listing states no price for what they are asking about'
        : 'the enquiry states no budget',
    };
  }

  /*
   * CURRENCIES MUST MATCH, AND MISMATCH IS UNKNOWN RATHER THAN CONFLICT.
   *
   * 800 GEL and 800 USD are different amounts and comparing the numbers would be
   * a fabrication. Converting them needs a rate this module does not hold and
   * must not invent -- so it declines to answer rather than answering wrongly, and
   * a caller that has a rate can convert before calling.
   */
  const a = String(listingCurrency ?? '').trim().toUpperCase();
  const b = String(demand.currency ?? '').trim().toUpperCase();
  if (!a || !b) {
    return { dimension: 'PRICE', verdict: 'UNKNOWN', reason: 'one side states no currency' };
  }
  if (a !== b) {
    return {
      dimension: 'PRICE',
      verdict: 'UNKNOWN',
      reason: `the price is in ${a} and the budget in ${b}, and no rate was supplied to compare them`,
    };
  }

  if (max !== null && amount > max) {
    return {
      dimension: 'PRICE',
      verdict: 'CONFLICT',
      reason: `it costs ${amount} ${a} and their ceiling is ${max}`,
    };
  }
  if (min !== null && amount < min) {
    /*
     * BELOW the floor is a real conflict, not a bargain. A stated minimum usually
     * encodes an expectation about quality or size, and "cheaper than you asked
     * for" is how a matcher fills a list with places somebody has already ruled
     * out.
     */
    return {
      dimension: 'PRICE',
      verdict: 'CONFLICT',
      reason: `it costs ${amount} ${a}, below the ${min} they said they were looking at`,
    };
  }
  return { dimension: 'PRICE', verdict: 'AGREE', reason: `${amount} ${a} is within their budget` };
}

function compareRange(
  dimension: 'AREA' | 'BEDROOMS',
  value: number | null,
  min: number | null,
  max: number | null,
  unit: string,
): DimensionResult {
  if (value === null || (min === null && max === null)) {
    return {
      dimension,
      verdict: 'UNKNOWN',
      reason: value === null
        ? `the listing does not state ${unit}`
        : `the enquiry states no ${unit} requirement`,
    };
  }
  if (max !== null && value > max) {
    return { dimension, verdict: 'CONFLICT', reason: `${value} ${unit} is more than the ${max} they wanted` };
  }
  if (min !== null && value < min) {
    return { dimension, verdict: 'CONFLICT', reason: `${value} ${unit} is fewer than the ${min} they need` };
  }
  return { dimension, verdict: 'AGREE', reason: `${value} ${unit} fits what they asked for` };
}

/* ────────────────────────────────────────────────────────────────────────
 * The one comparison, read from either end
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How much each agreeing dimension contributes to the ranking score.
 *
 * Ranking only. These weights never decide COMPATIBLE vs INCOMPATIBLE -- a
 * conflict does that, on its own, whatever the weights say. They exist so that
 * among pairs that all genuinely fit, the ones agreeing on the things a person
 * actually cares about come first.
 */
const WEIGHTS: Readonly<Record<MatchDimension, number>> = {
  TRANSACTION: 0.20,
  CITY: 0.20,
  PRICE: 0.20,
  PROPERTY_TYPE: 0.15,
  BEDROOMS: 0.10,
  AREA: 0.10,
  DISTRICT: 0.05,
};

export interface MatchOptions {
  /**
   * How many dimensions must AGREE before a pair may be called COMPATIBLE.
   *
   * Two by default. One agreeing dimension and six unknowns is not a match, it is
   * a coincidence -- and on rows as sparse as production's, a floor of one would
   * pair every Tbilisi enquiry with every Tbilisi listing.
   */
  minAgreements?: number;
}

/**
 * Assess one demand against one supply.
 *
 * The SAME function serves both products. FIND BUYERS iterates demand for a fixed
 * supply; FIND PROPERTY iterates supply for a fixed demand. There is no second
 * implementation and no reversed copy, so the two directions cannot disagree about
 * the same pair.
 */
export function assessMatch(
  demand: DemandSide,
  supply: SupplySide,
  options: MatchOptions = {},
): MatchAssessment {
  const dimensions: DimensionResult[] = [
    compareTransaction(demand, supply),
    comparePlaceDimension('CITY', demand.city, supply.city),
    comparePlaceDimension('DISTRICT', demand.district, supply.district),
    comparePropertyType(demand, supply),
    comparePrice(demand, supply),
    compareRange('AREA', positive(supply.areaSqm), positive(demand.areaMin), positive(demand.areaMax), 'm²'),
    compareRange(
      'BEDROOMS',
      /* bedrooms where stated, else rooms: a listing that says "2 rooms" and
         nothing about bedrooms is still informative, and refusing to use it would
         discard most of what Georgian portals publish. */
      positive(supply.bedrooms) ?? positive(supply.rooms),
      positive(demand.bedroomsMin),
      positive(demand.bedroomsMax),
      'bedrooms',
    ),
  ];

  const agreed = dimensions.filter((d) => d.verdict === 'AGREE').map((d) => d.dimension);
  const conflicted = dimensions.filter((d) => d.verdict === 'CONFLICT').map((d) => d.dimension);
  const unknown = dimensions.filter((d) => d.verdict === 'UNKNOWN').map((d) => d.dimension);

  /*
   * A CONTRADICTION IS FINAL, and no score outvotes it. A two-bedroom flat is not
   * a 0.7 match for somebody who needs four, however well everything else lines
   * up -- and a weighted average would say exactly that.
   */
  if (conflicted.length > 0) {
    const first = dimensions.find((d) => d.verdict === 'CONFLICT');
    return {
      compatibility: 'INCOMPATIBLE',
      score: 0,
      dimensions,
      agreed,
      conflicted,
      unknown,
      rationale: first ? first.reason : 'something they asked for does not match this listing',
    };
  }

  const floor = Math.max(1, Math.trunc(options.minAgreements ?? 2) || 2);
  if (agreed.length < floor) {
    return {
      compatibility: 'INSUFFICIENT_INFORMATION',
      score: 0,
      dimensions,
      agreed,
      conflicted,
      unknown,
      rationale: `nothing contradicts, and only ${agreed.length} thing(s) are known to match. `
        + `${unknown.length} detail(s) are unstated on one side or the other, so this is not `
        + 'presented as a match',
    };
  }

  /*
   * THE SCORE IS HOW WELL CORROBORATED THE MATCH IS, not how good the property is.
   *
   * Agreed weight over the whole weight. Since a conflict returned INCOMPATIBLE
   * above, everything not agreed is UNKNOWN -- so an unstated dimension does lower
   * the score, and that is deliberate rather than incidental.
   *
   * I first wrote this dividing by "agreed + unknown" and told myself it avoided
   * punishing a pair for facts nobody recorded. It does not: with no conflicts,
   * agreed + unknown IS the total, so the two formulas are the same expression. The
   * question is therefore not how to avoid the penalty but whether the penalty is
   * right, and it is: a pair confirmed on all seven dimensions is stronger evidence
   * than one confirmed on four with three unstated, and showing the better-evidenced
   * pair first is what a customer wants.
   *
   * What the penalty must NOT do is decide compatibility, and it cannot -- that was
   * settled by the conflict check and the agreement floor before any weight was
   * added up.
   */
  const agreedWeight = agreed.reduce((sum, d) => sum + WEIGHTS[d], 0);
  const totalWeight = agreedWeight + unknown.reduce((sum, d) => sum + WEIGHTS[d], 0);
  const score = totalWeight > 0 ? agreedWeight / totalWeight : 0;

  return {
    compatibility: 'COMPATIBLE',
    score: Math.round(score * 1000) / 1000,
    dimensions,
    agreed,
    conflicted,
    unknown,
    rationale: dimensions
      .filter((d) => d.verdict === 'AGREE')
      .map((d) => d.reason)
      .join('; ')
      + (unknown.length > 0 ? `. ${unknown.length} detail(s) were not stated` : ''),
  };
}

/**
 * FIND BUYERS: one property, many enquiries, best first.
 *
 * A thin ordering over assessMatch(). It exists so the two products call the same
 * comparison by name rather than each writing its own loop and its own idea of
 * what counts.
 */
export function rankDemandForSupply<T>(
  supply: SupplySide,
  candidates: readonly { key: T; demand: DemandSide }[],
  options: MatchOptions = {},
): { key: T; assessment: MatchAssessment }[] {
  return candidates
    .map((candidate) => ({ key: candidate.key, assessment: assessMatch(candidate.demand, supply, options) }))
    .filter((entry) => entry.assessment.compatibility === 'COMPATIBLE')
    .sort((a, b) => b.assessment.score - a.assessment.score);
}

/** FIND PROPERTY: one enquiry, many listings, best first. The same comparison. */
export function rankSupplyForDemand<T>(
  demand: DemandSide,
  candidates: readonly { key: T; supply: SupplySide }[],
  options: MatchOptions = {},
): { key: T; assessment: MatchAssessment }[] {
  return candidates
    .map((candidate) => ({ key: candidate.key, assessment: assessMatch(demand, candidate.supply, options) }))
    .filter((entry) => entry.assessment.compatibility === 'COMPATIBLE')
    .sort((a, b) => b.assessment.score - a.assessment.score);
}
