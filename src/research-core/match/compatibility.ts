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
// THE RULE THAT DECIDES EVERYTHING ELSE: FOUR ANSWERS, NOT TWO
//
// Collapsing any part of this produces a product that either shows people what they
// have ruled out or hides what they would have taken:
//
//   AGREE            both stated it, they match
//   CONFLICT         both stated it, they clash, and the demand side REQUIRED it
//   PREFERENCE_MISS  both stated it, they clash, and the demand side PREFERRED it
//   UNKNOWN          one side never said
//
// A CONFLICT disqualifies. A PREFERENCE_MISS does not: it is reported, it ranks the
// pair lower, and it says so in words. "It must be in Saburtalo" and "I would rather
// be in Saburtalo" are different sentences, and before this they were the same one.
//
// UNKNOWN is carried to the end rather than resolved. Real rows are full of holes --
// most intent_profiles have no budget, many supply_observations no district -- and
//
//   UNKNOWN as AGREE    -> every buyer matches every flat
//   UNKNOWN as CONFLICT -> one missing field destroys a real match
//
// Neither is acceptable, so the caller decides how much silence it tolerates via
// minAgreements, and this module refuses to decide it quietly. It is the same
// discipline comparePlaces() already uses, for the same reason.
//
// AND THE ROLES GATE BEFORE ANY OF IT
//
// A landlord and a buyer have nothing to offer each other however well the price and
// district line up. That is a fact about the participants, not a low score, so
// participants.ts answers it first. Keeping "can they transact" apart from "does this
// fit" is what stops "they are both rentals" being mistaken for a reason to show
// somebody a flat.
//
// DETERMINISTIC, AND THEREFORE EXPLAINABLE. Nothing here consults a model. An AI may
// derive the structured demand that goes IN -- that is what a planner is for -- but
// the compatibility decision is arithmetic over stated facts, and every verdict
// carries the sentence that produced it.

import { comparePlaces } from '../normalize/place.ts';
import {
  canTransact,
  dealKindFrom,
  demandRoleFrom,
  type DealKind,
  type DemandRole,
  type SupplyRole,
} from './participants.ts';

export type DimensionVerdict =
  /** Both sides stated it and they agree. */
  | 'AGREE'
  /** Both stated it, they disagree, and the demand side REQUIRED it. */
  | 'CONFLICT'
  /**
   * Both stated it, they disagree, and the demand side only PREFERRED it.
   *
   * The verdict that did not exist and had to. Without it, "I would rather be in
   * Saburtalo" and "it must be in Saburtalo" were the same sentence, so a product
   * either rejected a perfectly good Vake flat or pretended the preference was never
   * expressed. A preference miss is a real, reportable disagreement that does NOT
   * reject -- it ranks lower and says why.
   */
  | 'PREFERENCE_MISS'
  /** One side or the other never said. Not agreement and not disagreement. */
  | 'UNKNOWN';

/**
 * How hard a demand-side constraint is.
 *
 * The distinction the Master Prompt is asking for, and it is not cosmetic: a hard
 * conflict, a preference mismatch, weak evidence and missing information are four
 * different situations with four different right answers, and any product that
 * collapses them either shows people places they have ruled out or hides places
 * they would have taken.
 */
export type ConstraintStrength =
  /** Violating it disqualifies the pair. A tenant cannot buy. */
  | 'REQUIRED'
  /** Violating it is a real miss, reported and ranked down, never disqualifying. */
  | 'PREFERRED'
  /** Stated, and explicitly open. Recorded so nobody re-asks, never scored. */
  | 'FLEXIBLE'
  /** Nothing was said about it at all. */
  | 'UNKNOWN';

export const CONSTRAINT_STRENGTHS: readonly ConstraintStrength[] = [
  'REQUIRED', 'PREFERRED', 'FLEXIBLE', 'UNKNOWN',
];

export type MatchDimension =
  | 'PARTICIPANTS'
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
  /**
   * How hard the demand side held this one. Reported alongside the verdict because
   * "they disagree" means something different at each strength, and a caller that
   * only saw the verdict would have to guess which.
   */
  strength: ConstraintStrength;
  /** Plain words. Shown to a customer as the reason, so no jargon and no scores. */
  reason: string;
}

/**
 * Which dimensions the demand side holds how hard.
 *
 * Absent means REQUIRED, which is what the product did before this existed -- so
 * omitting it preserves the previous behaviour exactly rather than silently loosening
 * every existing caller.
 */
export type StrengthMap = Partial<Record<MatchDimension, ConstraintStrength>>;

/** What a person is looking for. Shaped after intent_profiles, holes included. */
export interface DemandSide {
  /** BUYER / TENANT / GUEST / INVESTOR, when the row says. */
  role?: DemandRole | null;
  /** intent_profiles.intent_type, so the role can be derived where not explicit. */
  intentType?: string | null;
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
  /** Per-dimension constraint strength. Absent entries are REQUIRED. */
  strength?: StrengthMap;
}

/** What exists. Shaped after supply_observations, holes included. */
export interface SupplySide {
  /** SELLER / LANDLORD / DEVELOPER / AGENCY / BROKER, when the row says. */
  role?: SupplyRole | null;
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
  /** At least one REQUIRED dimension contradicts, or the roles cannot transact. */
  | 'INCOMPATIBLE';

export interface MatchAssessment {
  compatibility: Compatibility;
  /** 0..1, and meaningful ONLY when compatibility is COMPATIBLE. */
  score: number;
  dimensions: DimensionResult[];
  agreed: MatchDimension[];
  conflicted: MatchDimension[];
  /** Real, reported disagreements that did NOT disqualify. */
  preferenceMisses: MatchDimension[];
  unknown: MatchDimension[];
  /**
   * Dimensions the customer explicitly said they are open about.
   *
   * A subset of `unknown` by verdict, and deliberately NOT scored: they answered, and
   * the answer was that it does not matter. Reported so an interface can say "you told
   * us you are flexible on this" rather than asking again.
   */
  flexible: MatchDimension[];
  /** The deal kind both sides are in, when it could be established. */
  deal: DealKind | null;
  roles: { demand: DemandRole | null; supply: SupplyRole | null };
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

/** How hard the demand side holds a dimension. Unstated means REQUIRED. */
function strengthOf(demand: DemandSide, dimension: MatchDimension): ConstraintStrength {
  return demand.strength?.[dimension] ?? 'REQUIRED';
}

/**
 * Turn a real disagreement into the verdict its strength deserves.
 *
 * The single place the strength model bites. Everything else about a dimension is
 * unchanged by it: a disagreement is detected exactly as before, and only what it
 * COSTS depends on how hard the constraint was held.
 */
function disagreement(
  dimension: MatchDimension,
  strength: ConstraintStrength,
  reason: string,
): DimensionResult {
  if (strength === 'FLEXIBLE') {
    /*
     * Explicitly open. Recorded as UNKNOWN rather than as a miss, because the
     * customer told us they do not mind -- counting it against the pair would
     * penalise them for having answered.
     */
    return {
      dimension,
      verdict: 'UNKNOWN',
      strength,
      reason: `${reason}, and they said they are flexible about it`,
    };
  }
  if (strength === 'PREFERRED') {
    return { dimension, verdict: 'PREFERENCE_MISS', strength, reason };
  }
  /* REQUIRED, and an UNKNOWN strength defaults to REQUIRED. */
  return { dimension, verdict: 'CONFLICT', strength, reason };
}

/**
 * Can these two sides do business at all?
 *
 * Asked FIRST and never softened by a strength. Who the parties are is not a
 * preference: a landlord has nothing to sell a buyer, and calling that a near miss
 * would put it in a ranked list.
 */
function compareParticipants(demand: DemandSide, supply: SupplySide): DimensionResult {
  const demandRole = demand.role
    ?? demandRoleFrom({ intentType: demand.intentType, transactionType: demand.transactionType });
  const deal = dealKindFrom({ transaction: supply.transaction, propertyType: supply.propertyType });
  const relationship = canTransact(demandRole, supply.role ?? null, deal);

  if (relationship.verdict === 'CANNOT_TRANSACT') {
    return {
      dimension: 'PARTICIPANTS', verdict: 'CONFLICT', strength: 'REQUIRED',
      reason: relationship.reason,
    };
  }
  if (relationship.verdict === 'UNKNOWN') {
    return {
      dimension: 'PARTICIPANTS', verdict: 'UNKNOWN', strength: 'UNKNOWN',
      reason: relationship.reason,
    };
  }
  return {
    dimension: 'PARTICIPANTS', verdict: 'AGREE', strength: 'REQUIRED',
    reason: relationship.reason,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The dimensions
 * ──────────────────────────────────────────────────────────────────────── */

function compareTransaction(demand: DemandSide, supply: SupplySide): DimensionResult {
  const strength = strengthOf(demand, 'TRANSACTION');
  const wanted = transaction(demand.transactionType);
  const offered = transaction(supply.transaction);
  if (!wanted || !offered) {
    return {
      dimension: 'TRANSACTION',
      verdict: 'UNKNOWN',
      strength,
      reason: !wanted
        ? 'the enquiry does not say whether they want to buy or rent'
        : 'the listing does not say whether it is for sale or to rent',
    };
  }
  if (wanted === offered) {
    return {
      dimension: 'TRANSACTION', verdict: 'AGREE', strength,
      reason: `both are ${wanted.toLowerCase()}`,
    };
  }
  /*
   * AN INVESTOR IS THE ONE EXCEPTION, and it is real rather than a loophole. A
   * tenanted flat sold with its income is a rental asset in a sale, so an investor
   * legitimately transacts across both -- which is exactly the case run-matching-v2
   * already special-cases ("the classifier records transaction_type as either SALE or
   * INVESTMENT for the same buy-to-invest demand"). That knowledge now lives in
   * participants.ts and is applied here.
   */
  const role = demand.role
    ?? demandRoleFrom({ intentType: demand.intentType, transactionType: demand.transactionType });
  if (role === 'INVESTOR') {
    return {
      dimension: 'TRANSACTION', verdict: 'AGREE', strength,
      reason: `an investor transacts in both, and this is ${offered.toLowerCase()}`,
    };
  }
  /*
   * NEVER SOFTENED BELOW REQUIRED. Buying instead of renting is not a preference, so
   * a caller marking TRANSACTION as PREFERRED does not get to show a renter a
   * purchase. The strength is honoured everywhere it is a matter of taste and
   * overridden on the one dimension where it is not.
   */
  return disagreement(
    'TRANSACTION',
    'REQUIRED',
    `they want to ${wanted.toLowerCase()} and this is ${offered.toLowerCase()}`,
  );
}

function comparePlaceDimension(
  dimension: 'CITY' | 'DISTRICT',
  wanted: string | null,
  offered: string | null,
  strength: ConstraintStrength,
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
    return { dimension, verdict, strength, reason: `the same ${label}` };
  }
  if (verdict === 'CONFLICT') {
    return disagreement(dimension, strength, `a different ${label}`);
  }
  return {
    dimension,
    verdict: 'UNKNOWN',
    strength,
    reason: !wanted || !offered
      ? `one side states no ${label}`
      : `the two ${label} names cannot be compared across their scripts`,
  };
}

function comparePropertyType(demand: DemandSide, supply: SupplySide): DimensionResult {
  const strength = strengthOf(demand, 'PROPERTY_TYPE');
  const offered = propertyClass(supply.propertyType);
  const wanted = (demand.propertyTypes ?? [])
    .map(propertyClass)
    .filter((value): value is string => value !== null);

  if (!offered || wanted.length === 0) {
    return {
      dimension: 'PROPERTY_TYPE',
      verdict: 'UNKNOWN',
      strength,
      reason: !offered
        ? 'the listing does not say what kind of property this is'
        : 'the enquiry names no particular kind of property',
    };
  }
  if (wanted.includes(offered)) {
    return {
      dimension: 'PROPERTY_TYPE', verdict: 'AGREE', strength,
      reason: `they are looking for a ${offered.toLowerCase()}`,
    };
  }
  return disagreement(
    'PROPERTY_TYPE',
    strength,
    `this is a ${offered.toLowerCase()} and they want ${wanted.map((w) => w.toLowerCase()).join(' or ')}`,
  );
}

function comparePrice(demand: DemandSide, supply: SupplySide): DimensionResult {
  const strength = strengthOf(demand, 'PRICE');
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
      strength,
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
    return {
      dimension: 'PRICE', verdict: 'UNKNOWN', strength,
      reason: 'one side states no currency',
    };
  }
  if (a !== b) {
    return {
      dimension: 'PRICE',
      verdict: 'UNKNOWN',
      strength,
      reason: `the price is in ${a} and the budget in ${b}, and no rate was supplied to compare them`,
    };
  }

  if (max !== null && amount > max) {
    return disagreement('PRICE', strength, `it costs ${amount} ${a} and their ceiling is ${max}`);
  }
  if (min !== null && amount < min) {
    /*
     * BELOW the floor is a real conflict, not a bargain. A stated minimum usually
     * encodes an expectation about quality or size, and "cheaper than you asked
     * for" is how a matcher fills a list with places somebody has already ruled
     * out.
     */
    return disagreement(
      'PRICE',
      strength,
      `it costs ${amount} ${a}, below the ${min} they said they were looking at`,
    );
  }
  return {
    dimension: 'PRICE', verdict: 'AGREE', strength,
    reason: `${amount} ${a} is within their budget`,
  };
}

function compareRange(
  dimension: 'AREA' | 'BEDROOMS',
  value: number | null,
  min: number | null,
  max: number | null,
  unit: string,
  strength: ConstraintStrength,
): DimensionResult {
  if (value === null || (min === null && max === null)) {
    return {
      dimension,
      verdict: 'UNKNOWN',
      strength,
      reason: value === null
        ? `the listing does not state ${unit}`
        : `the enquiry states no ${unit} requirement`,
    };
  }
  if (max !== null && value > max) {
    return disagreement(dimension, strength, `${value} ${unit} is more than the ${max} they wanted`);
  }
  if (min !== null && value < min) {
    return disagreement(dimension, strength, `${value} ${unit} is fewer than the ${min} they need`);
  }
  return {
    dimension, verdict: 'AGREE', strength,
    reason: `${value} ${unit} fits what they asked for`,
  };
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
  PARTICIPANTS: 0.10,
  TRANSACTION: 0.18,
  CITY: 0.18,
  PRICE: 0.18,
  PROPERTY_TYPE: 0.14,
  BEDROOMS: 0.09,
  AREA: 0.09,
  DISTRICT: 0.04,
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
  const demandRole = demand.role
    ?? demandRoleFrom({ intentType: demand.intentType, transactionType: demand.transactionType });
  const deal = dealKindFrom({ transaction: supply.transaction, propertyType: supply.propertyType });

  const dimensions: DimensionResult[] = [
    /* WHO, before anything about WHAT. A landlord and a buyer never reach the
       price comparison, because there is nothing for them to agree about. */
    compareParticipants(demand, supply),
    compareTransaction(demand, supply),
    comparePlaceDimension('CITY', demand.city, supply.city, strengthOf(demand, 'CITY')),
    comparePlaceDimension('DISTRICT', demand.district, supply.district, strengthOf(demand, 'DISTRICT')),
    comparePropertyType(demand, supply),
    comparePrice(demand, supply),
    compareRange(
      'AREA', positive(supply.areaSqm),
      positive(demand.areaMin), positive(demand.areaMax), 'm²',
      strengthOf(demand, 'AREA'),
    ),
    compareRange(
      'BEDROOMS',
      /* bedrooms where stated, else rooms: a listing that says "2 rooms" and
         nothing about bedrooms is still informative, and refusing to use it would
         discard most of what Georgian portals publish. */
      positive(supply.bedrooms) ?? positive(supply.rooms),
      positive(demand.bedroomsMin),
      positive(demand.bedroomsMax),
      'bedrooms',
      strengthOf(demand, 'BEDROOMS'),
    ),
  ];

  const agreed = dimensions.filter((d) => d.verdict === 'AGREE').map((d) => d.dimension);
  const conflicted = dimensions.filter((d) => d.verdict === 'CONFLICT').map((d) => d.dimension);
  const preferenceMisses = dimensions
    .filter((d) => d.verdict === 'PREFERENCE_MISS').map((d) => d.dimension);
  const unknown = dimensions.filter((d) => d.verdict === 'UNKNOWN').map((d) => d.dimension);
  /*
   * FLEXIBLE IS NOT UNKNOWN, and conflating them was a real error in the first cut of
   * this file.
   *
   * "I do not mind about the district" and "nobody recorded a district" are different
   * facts. UNKNOWN lowers confidence, because an unconfirmed dimension really is
   * unconfirmed. FLEXIBLE lowers nothing: the customer answered, and the answer was
   * that it does not matter. Scoring them alike meant a flexible customer saw LOWER
   * scores than a picky one whose preference happened to be met, which is backwards
   * and penalises people for co-operating.
   *
   * So these are excluded from the score entirely -- neither numerator nor
   * denominator -- and still reported, so nobody asks again.
   */
  const flexible = dimensions
    .filter((d) => d.strength === 'FLEXIBLE' && d.verdict !== 'AGREE')
    .map((d) => d.dimension);
  const flexibleSet = new Set(flexible);

  const base = {
    dimensions, agreed, conflicted, preferenceMisses, unknown, flexible,
    deal, roles: { demand: demandRole, supply: supply.role ?? null },
  };

  /*
   * A CONTRADICTION IS FINAL, and no score outvotes it. A two-bedroom flat is not
   * a 0.7 match for somebody who needs four, however well everything else lines
   * up -- and a weighted average would say exactly that.
   */
  if (conflicted.length > 0) {
    const first = dimensions.find((d) => d.verdict === 'CONFLICT');
    return {
      ...base,
      compatibility: 'INCOMPATIBLE',
      score: 0,
      rationale: first ? first.reason : 'something they required does not match this listing',
    };
  }

  const floor = Math.max(1, Math.trunc(options.minAgreements ?? 2) || 2);
  if (agreed.length < floor) {
    return {
      ...base,
      compatibility: 'INSUFFICIENT_INFORMATION',
      score: 0,
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
  const weightOf = (list: MatchDimension[]) => list.reduce((sum, d) => sum + WEIGHTS[d], 0);
  const agreedWeight = weightOf(agreed);
  /*
   * A PREFERENCE_MISS counts in the denominator and NOT the numerator, so a pair that
   * missed a stated preference ranks below one that did not -- which is the entire
   * point of having recorded the preference rather than ignoring it.
   */
  const inPlay = agreedWeight
    + weightOf(preferenceMisses)
    + weightOf(unknown.filter((d) => !flexibleSet.has(d)));
  const score = inPlay > 0 ? agreedWeight / inPlay : 0;

  const misses = preferenceMisses.length > 0
    ? ` Not what they preferred: ${dimensions
      .filter((d) => d.verdict === 'PREFERENCE_MISS')
      .map((d) => d.reason).join('; ')}.`
    : '';

  return {
    ...base,
    compatibility: 'COMPATIBLE',
    score: Math.round(score * 1000) / 1000,
    rationale: dimensions
      .filter((d) => d.verdict === 'AGREE')
      .map((d) => d.reason)
      .join('; ')
      + misses
      + (unknown.length > 0 ? ` ${unknown.length} detail(s) were not stated.` : ''),
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
