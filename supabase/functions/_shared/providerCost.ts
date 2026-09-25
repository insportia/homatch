// HOMATCH — one place that decides how much a recorded cost figure is worth.
//
// WHAT THE AUDIT FOUND, AND WHAT SURVIVED THE RETIREMENT
//
// The original finding was that 602 of 925 cost_events carried cost_usd = 0,
// and that most of those zeros were Apify and DataForSEO discovery calls
// booked as free. That number is still true and those rows are still there,
// but it is no longer a live defect: both providers are retired, their last
// cost_event was written on 2026-08-29, and production holds
// provider_kill_switch = true with both names in provider_disabled_list. That
// half of the problem is HISTORY. It is preserved, not repaired.
//
// What survived is the part that is still writing rows every day.
//
// THE LIVE DEFECT
//
// research-agent prices each verification stage from provider_price_book at
// measured token counts, and it already knows when it could not: cogs.ts
// returns `priced: false` with the exact dimensions that had no rate. It then
// writes that knowledge into a free-text `source` suffix —
//
//   model=gpt-5.6-terra;unpriced=INPUT_TOKEN+OUTPUT_TOKEN+WEB_SEARCH_CALL
//
// — and writes cost_usd = 0 beside it. Production shows this happening for a
// new model as recently as 2026-09-19: one VERIFY_SYNTHESIS row on
// gpt-6-astra, unpriced, recorded as $0.00. Every reader of this table sums
// cost_usd. None of them parse that string. So a model we have not yet priced
// produces verifications that report as free, and the margin on them reports
// as total.
//
// The knowledge exists. It just has nowhere countable to live.
//
// WHAT "UNKNOWN" HAS TO LOOK LIKE
//
// Not zero. cost_usd stays NOT NULL because every existing reader sums it;
// pricing_state says how much that number is worth:
//
//   ACTUAL      the provider reported this figure itself
//   ESTIMATED   derived from provider_price_book at measured quantities
//   PARTIAL     some dimensions priced and at least one not; the figure is a
//               floor, not a total
//   UNPRICED    nothing could be priced; cost_usd is a placeholder, not spend
//   ZERO_REAL   genuinely free -- a cache hit, or a failure before anything
//               billable ran. The only zero worth trusting.
//
// A cache hit is ZERO_REAL and not UNPRICED on purpose: reuse saving money is
// the thing the discovery economics exist to measure, and it must not be
// indistinguishable from an unknown.
//
// TWO ENTRY POINTS, BECAUSE "CACHED" MEANS TWO DIFFERENT THINGS
//
// resolveProviderCost is for a provider that either reports a dollar figure
// or does not, where a cache hit means the call never happened and cost
// nothing.
//
// pricingStateForDerivedCost is for costs WE compute -- tokens times our own
// rate card. There a cache hit means the provider's prompt cache discounted
// part of the input, which is a cheaper call, not a free one. Routing
// research-agent through the first function would book every partially cached
// verification as ZERO_REAL and wipe out most of the Verify cost base.

export type PricingState = 'ACTUAL' | 'ESTIMATED' | 'PARTIAL' | 'UNPRICED' | 'ZERO_REAL';

export interface ResolvedCost {
  cost_usd: number;
  pricing_state: PricingState;
}

export interface CostInputs {
  /** What the provider itself reported, when it reports anything. */
  actualUsd?: number | null;
  /** From provider_price_book, via provider_estimated_cost_usd(). */
  estimatedUsd?: number | null;
  /** Served from cache: real work, really not paid for. */
  cacheHit?: boolean;
  /** Did the operation do any billable work at all? */
  success?: boolean;
  /**
   * True when a failure still consumed billable provider work. Most failures
   * do not -- a refused connection costs nothing -- but a run that errored
   * halfway has usually already been charged for.
   */
  billedDespiteFailure?: boolean;
}

const money = (n: number) => Math.round(n * 1e6) / 1e6;

/** Present and usable. Zero is a real number here; NaN and null are not. */
function usable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * What this call cost, and how much that figure is worth.
 *
 * For providers that bill per call and either report the amount or do not.
 * The order matters. A cache hit is free even when a price exists, because
 * nothing was bought. A failure that never reached the provider is free for
 * the same reason. Only then does an actual figure beat an estimate, and only
 * then does the absence of both become UNPRICED rather than zero.
 */
export function resolveProviderCost(inputs: CostInputs): ResolvedCost {
  const { actualUsd, estimatedUsd, cacheHit = false, success = true, billedDespiteFailure = false } = inputs;

  /* Served from cache: nothing was bought, and saying so is the point. */
  if (cacheHit) return { cost_usd: 0, pricing_state: 'ZERO_REAL' };

  /*
   * Failed without consuming billable work. An actual figure still wins if
   * the provider sent one -- some charge for the attempt -- but the default
   * for a failure is a real zero rather than an unknown.
   */
  if (!success && !billedDespiteFailure) {
    if (usable(actualUsd) && actualUsd > 0) return { cost_usd: money(actualUsd), pricing_state: 'ACTUAL' };
    return { cost_usd: 0, pricing_state: 'ZERO_REAL' };
  }

  /*
   * An actual of exactly 0 from a provider that reports costs is a real zero,
   * not a missing value -- which is why this tests for presence rather than
   * truthiness. `!actual` would throw away every genuinely free call.
   */
  if (usable(actualUsd)) {
    return { cost_usd: money(actualUsd), pricing_state: actualUsd === 0 ? 'ZERO_REAL' : 'ACTUAL' };
  }

  if (usable(estimatedUsd)) {
    return { cost_usd: money(estimatedUsd), pricing_state: 'ESTIMATED' };
  }

  /*
   * Neither. cost_usd carries 0 because the column is NOT NULL and every
   * reader sums it, but pricing_state says the number means nothing -- so
   * analytics can exclude it from margin instead of booking free work.
   */
  return { cost_usd: 0, pricing_state: 'UNPRICED' };
}

export interface DerivedCostInputs {
  /** What our own rate card made of the measured quantities. */
  costUsd: number | null | undefined;
  /** False when any dimension the call consumed had no rate. */
  fullyPriced: boolean;
  /**
   * True when the call consumed nothing billable at all -- not when a cache
   * discounted it. A stage with zero tokens and zero searches is ZERO_REAL;
   * a stage whose input was 90% cached is a cheaper ESTIMATED.
   */
  consumedNothing?: boolean;
}

/**
 * How much a cost WE calculated is worth.
 *
 * The provider never named a dollar figure here: we multiplied measured
 * quantities by rates from provider_price_book, so even a complete answer is
 * ESTIMATED rather than ACTUAL. What matters is the gap between a total and a
 * floor:
 *
 *   fullyPriced, > 0          ESTIMATED  -- every dimension had a rate
 *   not fullyPriced, > 0      PARTIAL    -- a floor; real spend is higher
 *   not fullyPriced, 0        UNPRICED   -- nothing could be priced
 *   consumed nothing          ZERO_REAL  -- there was nothing to charge for
 *
 * PARTIAL is the one that would otherwise be lost. A stage whose tokens are
 * priced but whose web searches are not produces a real, non-zero, and
 * understated number; calling it ESTIMATED asserts a total we do not have,
 * and calling it UNPRICED throws away spend we do.
 */
export function pricingStateForDerivedCost(inputs: DerivedCostInputs): ResolvedCost {
  const { fullyPriced, consumedNothing = false } = inputs;
  const raw = inputs.costUsd;
  const cost = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? money(raw) : 0;

  if (consumedNothing) return { cost_usd: 0, pricing_state: 'ZERO_REAL' };
  if (fullyPriced) {
    /*
     * Priced against every dimension, and it came to nothing -- which happens
     * only when the quantities were all zero. A real zero, not an unknown.
     */
    return { cost_usd: cost, pricing_state: cost > 0 ? 'ESTIMATED' : 'ZERO_REAL' };
  }
  return cost > 0
    ? { cost_usd: cost, pricing_state: 'PARTIAL' }
    : { cost_usd: 0, pricing_state: 'UNPRICED' };
}

/**
 * The configured price for an operation, or null when there is none.
 *
 * Deliberately returns null rather than 0: null is what makes UNPRICED
 * distinguishable from a genuinely free call at the call site.
 */
export async function estimatedProviderCost(
  db: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  args: { provider: string; unit: string; units: number; model?: string | null },
): Promise<number | null> {
  try {
    const { data, error } = await db.rpc('provider_estimated_cost_usd', {
      p_provider: args.provider,
      p_unit: args.unit,
      p_units: args.units,
      p_model: args.model ?? null,
    });
    if (error) return null;
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  } catch {
    /* The price book being unreachable is not evidence that a call was free. */
    return null;
  }
}
