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
//   DIRECT   hierarchy levels 1–4: same project, same address/street, peer project
//   CONTEXT  level 5 only (same or adjacent neighbourhood), never the wider city
//
// Nothing is promoted to fill a quota. Two strong local comparables beat
// eight weak ones, and if there are none, the honest output is a market
// context with no direct comparables rather than six strangers wearing the
// word "comparable".

// 2026-10-11 (job 8ba97da9): the "context" bucket used to be WIDER_MARKET —
// Didi Dighomi beside Krtsanisi, labelled as background but still shown. It
// is now the hierarchy's level 5 (same or ADJACENT neighbourhood stock, with
// its reason) and only when levels 1–4 are thin. An unrelated or unknown
// district is never selected, as direct OR as context. Listings that failed
// the customer gate (size band, deal type, class, condition, expired, stale)
// are never selected either.

import type { ComparableTier, ScoredComparable } from './marketIntelligence.ts';
import { MIN_DEFENSIBLE_COMPARABLES } from './marketHierarchy.ts';

/** The bands a customer may be shown as genuinely comparable, hierarchy order. */
const DIRECT_TIERS: readonly ComparableTier[] = [
  'SAME_PROJECT', 'SAME_STREET', 'PEER_PROJECT',
] as const;

/** i18n key for the one-line reason a comparable is relevant. */
export const TIER_REASON_KEY: Record<ComparableTier, string> = {
  SAME_PROJECT: 'cmp_reason_same_project',
  SAME_STREET: 'cmp_reason_same_street',
  SAME_DISTRICT: 'cmp_reason_same_district',
  PEER_PROJECT: 'cmp_reason_peer_project',
  WIDER_MARKET: 'cmp_reason_wider_market',
};

/** Finer reasons from the hierarchy (keys in scripts/verify-p0-market-i18n-data.mjs). */
const HIERARCHY_REASON_KEY: Record<string, string> = {
  SAME_ADDRESS: 'cmp_reason_same_address',
  STREET_BRANCH: 'cmp_reason_street_branch',
  ADJACENT_DISTRICT: 'cmp_reason_adjacent_district',
};

export interface SelectedComparable {
  comparable: ScoredComparable;
  /** Why it is being shown, as an i18n key — never free prose. */
  reasonKey: string;
  tier: ComparableTier;
}

export interface ComparableSelection {
  /** Levels 1–4: what a buyer may read as "similar to yours". Small on purpose. */
  direct: SelectedComparable[];
  /** Level 5 only — the same or an adjacent neighbourhood, never the wider city. */
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

const has = (c: ScoredComparable, r: string) => Array.isArray(c.relevanceReasons) && (c.relevanceReasons as string[]).includes(r);

/** Unrelated/unknown district, or failed the customer gate: never shown. */
function blocked(c: ScoredComparable): boolean {
  if (c.outlier) return true;
  if (Array.isArray(c.exclusions) && c.exclusions.length) return true;
  if (c.level === null) return true;
  // A legacy-shaped entry (no level): the wider market is unrelated by definition.
  return c.level === undefined && c.tier === 'WIDER_MARKET';
}

const isBroaderNearby = (c: ScoredComparable): boolean =>
  c.level === 5 || (c.level === undefined && c.tier === 'SAME_DISTRICT');

function reasonKeyOf(c: ScoredComparable): string {
  if (has(c, 'SAME_ADDRESS')) return HIERARCHY_REASON_KEY.SAME_ADDRESS;
  if (has(c, 'STREET_BRANCH')) return HIERARCHY_REASON_KEY.STREET_BRANCH;
  if (isBroaderNearby(c) && has(c, 'ADJACENT_DISTRICT')) return HIERARCHY_REASON_KEY.ADJACENT_DISTRICT;
  if (isBroaderNearby(c)) return TIER_REASON_KEY.SAME_DISTRICT;
  return TIER_REASON_KEY[c.tier];
}

/**
 * Splits a scored pool into what a customer sees as comparable (levels 1–4)
 * and the broader-nearby stock (level 5) shown only when the first is thin.
 *
 * `maxDirect` is a ceiling, never a target: the function will happily return
 * one comparable, or none.
 */
export function selectComparables(
  scored: ScoredComparable[],
  opts: { maxDirect?: number; maxContext?: number } = {}
): ComparableSelection {
  const maxDirect = opts.maxDirect ?? 4;
  const maxContext = opts.maxContext ?? 2;

  const counts = EMPTY_COUNTS();
  for (const c of scored) {
    if (c && counts[c.tier] !== undefined) counts[c.tier] += 1;
  }

  // Level first (tier order for a legacy entry), then how close within it —
  // the same order the market analysis itself uses.
  const rank = (c: ScoredComparable): number =>
    typeof c.level === 'number' ? c.level : DIRECT_TIERS.indexOf(c.tier) === -1 ? 5 : DIRECT_TIERS.indexOf(c.tier) + 1;
  const byRelevance = (a: ScoredComparable, b: ScoredComparable): number =>
    rank(a) - rank(b) || (b.relevance ?? 0) - (a.relevance ?? 0);

  const shown = scored.filter((c) => c && !blocked(c));
  const toSelected = (comparable: ScoredComparable): SelectedComparable => ({
    comparable,
    tier: comparable.tier,
    reasonKey: reasonKeyOf(comparable),
  });

  const direct = shown
    .filter((c) => !isBroaderNearby(c) && DIRECT_TIERS.includes(c.tier))
    .sort(byRelevance)
    .slice(0, maxDirect)
    .map(toSelected);

  const context = direct.length < MIN_DEFENSIBLE_COMPARABLES
    ? shown.filter(isBroaderNearby).sort(byRelevance).slice(0, maxContext).map(toSelected)
    : [];

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
