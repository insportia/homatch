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
    /* No price-book row comes back as NULL, and Number(null) is 0: a missing price was booked as
       a $0 ESTIMATED cost (Find Property, 2026-10-19). NULL is UNPRICED, never zero. */
    if (error || data === null || data === undefined || data === '') return null;
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  } catch {
    /* The price book being unreachable is not evidence that a call was free. */
    return null;
  }
}

// ── Finance V2.1: one recorder for every metered provider call ─────────────
//
// Every paid call that had no cost row (find-property-plan, deal-room-ai, investment-consultant,
// social-post-generate, comm-agent, …) records through here: the usage the provider itself
// returned, priced dimension by dimension from provider_price_book, written once per
// idempotency key. Nothing is invented: no usage in the response means units unknown and
// UNPRICED, never an assumed token count. A missing rate is UNPRICED / PARTIAL, never $0.

/** Token usage as the provider reported it. Null when the response carried none. */
export interface TokenUsage { input: number; cached: number; output: number }

const nonNeg = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * OpenAI Chat Completions (`prompt_tokens`), OpenAI Responses (`input_tokens`) and Gemini
 * (`usageMetadata.promptTokenCount`). Cached tokens are a SUBSET of input (both APIs).
 */
export function tokenUsage(body: unknown): TokenUsage | null {
  const b = (body ?? {}) as Record<string, any>;
  const u = b.usage ?? null;
  if (u && (u.prompt_tokens != null || u.completion_tokens != null)) {
    const input = nonNeg(u.prompt_tokens) ?? 0, output = nonNeg(u.completion_tokens) ?? 0;
    const cached = Math.min(input, nonNeg(u.prompt_tokens_details?.cached_tokens) ?? 0);
    return { input, cached, output };
  }
  if (u && (u.input_tokens != null || u.output_tokens != null)) {
    const input = nonNeg(u.input_tokens) ?? 0, output = nonNeg(u.output_tokens) ?? 0;
    const cached = Math.min(input, nonNeg(u.input_tokens_details?.cached_tokens) ?? 0);
    return { input, cached, output };
  }
  const g = b.usageMetadata ?? null;
  if (g && (g.promptTokenCount != null || g.candidatesTokenCount != null)) {
    const input = nonNeg(g.promptTokenCount) ?? 0;
    const output = (nonNeg(g.candidatesTokenCount) ?? 0) + (nonNeg(g.thoughtsTokenCount) ?? 0);
    const cached = Math.min(input, nonNeg(g.cachedContentTokenCount) ?? 0);
    return { input, cached, output };
  }
  return null;
}

export interface UsageCostInput {
  /** cost_events.provider (cost_provider enum). */
  provider: string;
  /** cost_events.operation_type, e.g. FIND_PROPERTY_PLAN. */
  operation: string;
  /** Finance V2 service key (finance_services). */
  service?: string | null;
  model?: string | null;
  /** The execution this cost belongs to (search id, deal room id, session id, …). */
  correlationId?: string | null;
  /** Same key → one row, however many retries, callbacks or replays. */
  idempotencyKey?: string | null;
  source?: string | null;
  /** Tokens from tokenUsage(); null = the provider reported none (units unknown). */
  tokens?: TokenUsage | null;
  /** Non-token dimensions, e.g. [{ unit: 'CHARACTER', units: 412 }]. */
  dimensions?: Array<{ unit: string; units: number | null }>;
  /** A dollar figure the provider itself reported. */
  actualUsd?: number | null;
  success?: boolean;
  jobId?: string | null;
  propertyId?: string | null;
}

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (t: string) => any;
};

/** Price the call. Pure apart from the price-book lookups; exported for tests. */
export async function priceUsage(db: Db, u: UsageCostInput): Promise<ResolvedCost & { unitsTotal: number | null }> {
  const dims: Array<{ unit: string; units: number }> = [];
  let unknownUnits = false;
  if (u.tokens === null) unknownUnits = true;
  if (u.tokens) {
    const fresh = Math.max(0, u.tokens.input - u.tokens.cached);
    if (fresh > 0) dims.push({ unit: 'INPUT_TOKEN', units: fresh });
    if (u.tokens.cached > 0) dims.push({ unit: 'CACHED_INPUT_TOKEN', units: u.tokens.cached });
    if (u.tokens.output > 0) dims.push({ unit: 'OUTPUT_TOKEN', units: u.tokens.output });
  }
  for (const d of u.dimensions ?? []) {
    if (d.units == null || !Number.isFinite(d.units)) { unknownUnits = true; continue; }
    if (d.units > 0) dims.push({ unit: d.unit, units: d.units });
  }
  const unitsTotal = unknownUnits && dims.length === 0 ? null : dims.reduce((s, d) => s + d.units, 0);

  if (usable(u.actualUsd)) {
    return { ...resolveProviderCost({ actualUsd: u.actualUsd, success: u.success ?? true }), unitsTotal };
  }
  if (u.success === false && dims.length === 0) return { cost_usd: 0, pricing_state: 'ZERO_REAL', unitsTotal };
  if (dims.length === 0) {
    /* Nothing measurable came back: unknown, not free (unless the call provably consumed nothing). */
    return unknownUnits ? { cost_usd: 0, pricing_state: 'UNPRICED', unitsTotal } : { cost_usd: 0, pricing_state: 'ZERO_REAL', unitsTotal };
  }
  let sum = 0; let fullyPriced = !unknownUnits;
  for (const d of dims) {
    const usd = await estimatedProviderCost(db, { provider: u.provider, unit: d.unit, units: d.units, model: u.model ?? null });
    if (usd == null) fullyPriced = false; else sum += usd;
  }
  return { ...pricingStateForDerivedCost({ costUsd: sum, fullyPriced }), unitsTotal };
}

/**
 * Record one metered call in cost_events. Never throws (a cost write must not break the
 * customer's request); returns what was recorded, or null when the write failed.
 */
export async function recordUsageCost(db: Db, u: UsageCostInput): Promise<(ResolvedCost & { duplicate?: boolean }) | null> {
  try {
    const priced = await priceUsage(db, u);
    const row: Record<string, unknown> = {
      provider: u.provider,
      operation_type: u.operation,
      service_key: u.service ?? null,
      source: u.source ?? null,
      units: priced.unitsTotal,
      cost_usd: priced.cost_usd, // NOT NULL column: 0 placeholder when UNPRICED, pricing_state says so
      pricing_state: priced.pricing_state,
      success: u.success ?? true,
      cache_hit: false,
      model: u.model ?? null,
      input_tokens: u.tokens ? u.tokens.input : null,
      cached_input_tokens: u.tokens ? u.tokens.cached : null,
      output_tokens: u.tokens ? u.tokens.output : null,
      correlation_id: u.correlationId ?? null,
      idempotency_key: u.idempotencyKey ?? null,
      job_id: u.jobId ?? null,
      property_id: u.propertyId ?? null,
    };
    const q = u.idempotencyKey
      ? db.from('cost_events').upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      : db.from('cost_events').insert(row);
    const { error } = await q;
    if (error) { console.error('[cost] cost_events write failed', u.operation, (error as any)?.message ?? error); return null; }
    return { cost_usd: priced.cost_usd, pricing_state: priced.pricing_state };
  } catch (e) {
    console.error('[cost] recordUsageCost failed', u.operation, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Run a cost write after the response without holding it: EdgeRuntime.waitUntil keeps the
 * isolate alive for it, so user-facing latency is unchanged (AI Talk, chat, plan drafts).
 */
export function deferCost(work: Promise<unknown>): void {
  const settled = work.catch(() => undefined);
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(settled);
}
