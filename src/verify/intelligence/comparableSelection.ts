// HOMATCH — which comparables a BUYER is shown, and which are only context.
//
// THE COMPLAINT THIS ANSWERS
//
// The live Villion report surfaced one listing from the immediate area and
// then filled the section with Didi Dighomi, Gldani, Lilo, Varketili,
// Saburtalo and Vake. Those are residential listings in the same city and
// almost nothing else: presenting them beside a Krtsanisi flat as though they
// were comparable is not imprecision, it is the wrong answer, and a buyer who
// notices stops trusting the number above them.
//
// The RAW pool is allowed to be broad — breadth is what makes a median
// meaningful. What must be strict is the set a customer reads as "similar to
// yours".
//
// HOW IT DECIDES
//
// It does not re-score anything. scoreComparable() already assigns the band
// (same project, same street, same district, peer project, wider market) and
// this only decides what to DO with those bands:
//
//   DIRECT   same project, same street, same district, peer project
//   CONTEXT  wider market, and only ever labelled as the wider market
//
// Nothing is promoted to fill a quota. Two strong local comparables beat
// eight weak ones, and if there are none, the honest output is a market
// context with no direct comparables rather than six strangers wearing the
// word "comparable".

import type { ComparableTier, ScoredComparable } from './marketIntelligence.ts';

/** The bands a customer may be shown as genuinely comparable. */
const DIRECT_TIERS: readonly ComparableTier[] = [
  'SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT',
] as const;

/** i18n key for the one-line reason a comparable is relevant. */
export const TIER_REASON_KEY: Record<ComparableTier, string> = {
  SAME_PROJECT: 'cmp_reason_same_project',
  SAME_STREET: 'cmp_reason_same_street',
  SAME_DISTRICT: 'cmp_reason_same_district',
  PEER_PROJECT: 'cmp_reason_peer_project',
  WIDER_MARKET: 'cmp_reason_wider_market',
};

export interface SelectedComparable {
  comparable: ScoredComparable;
  /** Why it is being shown, as an i18n key — never free prose. */
  reasonKey: string;
  tier: ComparableTier;
}

export interface ComparableSelection {
  /** What a buyer may read as "similar to yours". Small on purpose. */
  direct: SelectedComparable[];
  /** Explicitly the wider city, never mixed into `direct`. */
  context: SelectedComparable[];
  /** Everything the research actually gathered. */
  rawCount: number;
  /** Per-band counts, for a report that wants to state its own basis. */
  counts: Record<ComparableTier, number>;
  /**
   * True when the direct set is thin enough that the report should say so
   * rather than implying a confident local comparison.
   */
  directIsThin: boolean;
}

const EMPTY_COUNTS = (): Record<ComparableTier, number> => ({
  SAME_PROJECT: 0, SAME_STREET: 0, SAME_DISTRICT: 0, PEER_PROJECT: 0, WIDER_MARKET: 0,
});

/**
 * Splits a scored pool into what a customer sees and what is only context.
 *
 * `maxDirect` is a ceiling, never a target: the function will happily return
 * one comparable, or none.
 */
export function selectComparables(
  scored: ScoredComparable[],
  opts: { maxDirect?: number; maxContext?: number } = {}
): ComparableSelection {
  const maxDirect = opts.maxDirect ?? 4;
  const maxContext = opts.maxContext ?? 3;

  const counts = EMPTY_COUNTS();
  for (const c of scored) {
    if (c && counts[c.tier] !== undefined) counts[c.tier] += 1;
  }

  // Band first, then how close within it — the same order the market
  // analysis itself uses, so the two can never disagree about which listing
  // is the strongest.
  const rank = (t: ComparableTier): number => {
    const i = DIRECT_TIERS.indexOf(t);
    return i === -1 ? DIRECT_TIERS.length : i;
  };
  const byRelevance = (a: ScoredComparable, b: ScoredComparable): number =>
    rank(a.tier) - rank(b.tier) || (b.relevance ?? 0) - (a.relevance ?? 0);

  const direct = scored
    .filter((c) => DIRECT_TIERS.includes(c.tier))
    .sort(byRelevance)
    .slice(0, maxDirect)
    .map((comparable) => ({
      comparable,
      tier: comparable.tier,
      reasonKey: TIER_REASON_KEY[comparable.tier],
    }));

  const context = scored
    .filter((c) => c.tier === 'WIDER_MARKET')
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
    .slice(0, maxContext)
    .map((comparable) => ({
      comparable,
      tier: comparable.tier,
      reasonKey: TIER_REASON_KEY.WIDER_MARKET,
    }));

  return {
    direct,
    context,
    rawCount: scored.length,
    counts,
    // One listing is an anecdote, not a comparison. Saying so is more useful
    // than quietly presenting it as a local price picture.
    directIsThin: direct.length < 2,
  };
}
