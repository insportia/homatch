// HOMATCH INVESTMENT INTELLIGENCE — assumption against evidence.
//
// THE RULE THIS FILE ENFORCES STRUCTURALLY
//
//   Research NEVER overwrites a user's assumption. It sits beside it.
//
// The investor said $500. A portal sweep found asking rents between $540
// and $590. Both facts are now true and they are different facts: one is
// what they expect to achieve, the other is what other landlords are
// advertising. Replacing the first with the second — even "helpfully", even
// with a note — destroys the investor's own judgement about their own
// property, which may be worse than every comparable for reasons no
// scraper can see.
//
// So the comparison is a VALUE OBJECT with both sides and a set of OFFERS.
// Applying an offer is a separate, explicit act that goes through
// applyPatch with origin RESEARCH, and the provenance panel then shows that
// the number changed and why. Nothing here mutates anything.
//
// ASKING IS NOT ACHIEVED, AND THE BASIS TRAVELS
//
// Every comparison carries the price basis it was observed on, straight
// from the Research Core's own vocabulary. An asking-rent range answers
// "what are people advertising", not "what will I collect", and a yield
// built on it is a gross ASKING yield. That distinction is the whole reason
// the core keeps ASKING_RENT and ACHIEVED_RENT as separate objectives, and
// it would be thrown away here if the basis did not travel with the number.

import type { ContextNumericField, InvestmentContext } from '../consultant/context.ts';

/** Straight from the Research Core's PRICE_BASES. Never widened, never mapped. */
export type EvidencePriceBasis =
  | 'ASKING_SALE_PRICE'
  | 'ASKING_RENT'
  | 'ACHIEVED_RENT'
  | 'TRANSACTION_PRICE'
  | 'DEVELOPER_PRICE'
  | 'UNKNOWN';

export interface EvidenceRange {
  /** The context field this evidence speaks to. */
  field: ContextNumericField;
  basis: EvidencePriceBasis;
  currency: string;
  low: number;
  median: number;
  high: number;
  /** How far from the subject the evidence was observed. Core vocabulary. */
  evidenceLevel: string;
  observationCount: number;
  independentSourceCount: number;
  /** Distinct properties, after cross-posting was collapsed. */
  uniquePropertyCount: number;
  /** Adverts for one property found at two prices. Preserved, never averaged. */
  conflictCount: number;
  /** When the sweep ran. */
  retrievedAt: string;
  /**
   * Set on a rent range when the source did not state the rent PERIOD.
   *
   * ss.ge lists residential rent monthly and does not label it in the record
   * — the adapter says so in its own comment and leaves the field null
   * rather than asserting. Treating those figures as monthly is a modelling
   * choice, so it is carried here and shown to the customer rather than
   * being made silently. A daily short-let rate pooled with monthly rents
   * would produce a yield several times too high, which is the single worst
   * arithmetic error this product could make.
   */
  periodAssumedMonthly?: boolean;
}

export type OfferKind = 'LOW' | 'MEDIAN' | 'HIGH' | 'KEEP_MINE';

export interface EvidenceOffer {
  kind: OfferKind;
  /** null for KEEP_MINE, which changes nothing. */
  value: number | null;
}

export type ComparisonVerdict =
  /** The assumption sits inside the observed range. */
  | 'CONSISTENT'
  /** Below everything observed — conservative, or the property is weaker. */
  | 'BELOW_EVIDENCE'
  /** Above everything observed — optimistic, or the property is stronger. */
  | 'ABOVE_EVIDENCE'
  /** No assumption to compare against yet. */
  | 'NO_ASSUMPTION';

export interface AssumptionComparison {
  field: ContextNumericField;
  /** What the investor (or the property record) currently has. */
  assumption: number | null;
  assumptionOrigin: string | null;
  evidence: EvidenceRange;
  verdict: ComparisonVerdict;
  /**
   * Assumption minus the observed median. Signed, and NEVER described as an
   * error: an investor asking below the market may be pricing for speed.
   */
  differenceVsMedian: number | null;
  offers: EvidenceOffer[];
  /**
   * True when the evidence is too thin to lean on — a single publisher, or
   * fewer observations than the Research Core's own market gate requires.
   * The comparison is still shown; it is shown as weak.
   */
  thin: boolean;
}

/** The Research Core's own market floor: never a market claim on one publisher. */
export const MIN_INDEPENDENT_SOURCES = 2;
export const MIN_OBSERVATIONS = 3;

export function compareAssumption(
  context: InvestmentContext,
  evidence: EvidenceRange,
): AssumptionComparison {
  const entry = context[evidence.field];
  const assumption = entry?.value ?? null;
  const assumptionOrigin = entry?.origin ?? null;

  const verdict: ComparisonVerdict =
    assumption === null
      ? 'NO_ASSUMPTION'
      : assumption < evidence.low
        ? 'BELOW_EVIDENCE'
        : assumption > evidence.high
          ? 'ABOVE_EVIDENCE'
          : 'CONSISTENT';

  return {
    field: evidence.field,
    assumption,
    assumptionOrigin,
    evidence,
    verdict,
    differenceVsMedian:
      assumption === null ? null : Math.round((assumption - evidence.median) * 100) / 100,
    offers: [
      { kind: 'LOW', value: evidence.low },
      { kind: 'MEDIAN', value: evidence.median },
      { kind: 'HIGH', value: evidence.high },
      { kind: 'KEEP_MINE', value: null },
    ],
    thin:
      evidence.independentSourceCount < MIN_INDEPENDENT_SOURCES ||
      evidence.observationCount < MIN_OBSERVATIONS,
  };
}

/**
 * Turn an accepted offer into a patch.
 *
 * Returns the patch rather than applying it, so the ONE door into the
 * context stays applyPatch and the origin stamped there is RESEARCH — set
 * by the caller that knows this came from a sweep, not by anything the
 * model or the client could claim.
 */
export function offerToPatch(
  comparison: AssumptionComparison,
  kind: OfferKind,
): Record<string, number> | null {
  if (kind === 'KEEP_MINE') return null;
  const offer = comparison.offers.find((o) => o.kind === kind);
  if (!offer || offer.value === null) return null;
  return { [comparison.field]: offer.value };
}

/**
 * Which context field an evidence basis is allowed to speak to.
 *
 * An asking SALE price has nothing to say about a monthly rent, and an
 * asking RENT has nothing to say about a purchase price. Enforced as a
 * table rather than left to each call site, because the call sites are the
 * places that will eventually be written in a hurry.
 */
export const BASIS_TO_FIELD: Partial<Record<EvidencePriceBasis, ContextNumericField>> = {
  ASKING_RENT: 'monthlyRent',
  ACHIEVED_RENT: 'monthlyRent',
  ASKING_SALE_PRICE: 'askingPrice',
  TRANSACTION_PRICE: 'askingPrice',
  DEVELOPER_PRICE: 'askingPrice',
};

export function fieldForBasis(basis: EvidencePriceBasis): ContextNumericField | null {
  return BASIS_TO_FIELD[basis] ?? null;
}

/**
 * The one sentence a renderer needs to caption a range honestly, as an
 * i18n key rather than as prose — this module ships no customer text.
 */
export function captionKeyFor(evidence: EvidenceRange): string {
  switch (evidence.basis) {
    case 'ASKING_RENT':
      return 'inv_evidence_caption_asking_rent';
    case 'ACHIEVED_RENT':
      return 'inv_evidence_caption_achieved_rent';
    case 'ASKING_SALE_PRICE':
      return 'inv_evidence_caption_asking_sale';
    case 'TRANSACTION_PRICE':
      return 'inv_evidence_caption_transaction';
    case 'DEVELOPER_PRICE':
      return 'inv_evidence_caption_developer';
    default:
      return 'inv_evidence_caption_unknown';
  }
}
