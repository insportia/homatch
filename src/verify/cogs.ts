// HOMATCH — what a verification actually costs us.
//
// Audited before any of this was written. The finding was specific:
//
//   cost_events held 607 rows and $25.24 of recorded spend, from discovery,
//   matching and signal classification. NOT ONE from Verify. Meanwhile every
//   completed verification already carried per-stage token counts in
//   result_json.costUsage — identity, official_collection, public_research,
//   market, synthesis, with cached_tokens broken out — and none of it had ever
//   been turned into money or written anywhere countable.
//
// So the product with the highest per-unit cost in the system was the one with
// no cost accounting at all. Everything downstream of this — whether reuse
// saved anything, whether a cheaper model degraded quality for nothing,
// whether a verification costs $0.20 or $2.00 — is guesswork until the spend
// is recorded per job.
//
// This module is the pure half: consumption in, priced stages out. No I/O, so
// it can be tested exactly, and it is the only place that knows how to turn
// usage into money.
//
// RATES ARE NOT IN THIS FILE. They live in provider_price_book, effective
// dated and attributed, because a price has a date and a cost figure nobody
// can trace is a number nobody can defend. This module is handed the rows and
// decides which apply.
//
// NONE OF IT IS EVER SHOWN TO A CUSTOMER. What Homatch pays to produce a
// report is not a fact about their property, and a report is not cheaper to
// buy for having been cheaper to make.

/** The billing dimensions the price book knows about. */
export const PRICE_UNITS = [
  'INPUT_TOKEN',
  'CACHED_INPUT_TOKEN',
  'OUTPUT_TOKEN',
  'REASONING_TOKEN',
  'WEB_SEARCH_CALL',
  'TOOL_CALL',
  'PROVIDER_CALL',
] as const;

export type PriceUnit = (typeof PRICE_UNITS)[number];

/** One effective-dated rate, exactly as provider_price_book stores it. */
export interface PriceRow {
  provider: string;
  model?: string | null;
  unit: PriceUnit | string;
  rate: number | string;
  per_units?: number | string | null;
  currency?: string | null;
  effective_from: string;
  effective_to?: string | null;
}

/**
 * A stage's token usage, in the shape the OpenAI Responses API returns and
 * research-agent persists verbatim.
 */
export interface StageUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

/** What one stage of a verification consumed. */
export interface StageConsumption {
  stage: string;
  model: string;
  usage: StageUsage | null | undefined;
  /** Web searches the stage performed, where we counted them. */
  webSearches?: number;
  /** Other billable tool calls, where the provider bills per call. */
  toolCalls?: number;
}

export interface StageCost {
  /** Lowercase stage name as persisted: identity, market, synthesis, … */
  stage: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearches: number;
  toolCalls: number;

  /** Model tokens only. */
  modelCostUsd: number;
  /** Web search and other per-call tool charges. */
  searchCostUsd: number;
  costUsd: number;
  currency: string;

  /**
   * What the provider's prompt cache saved on this stage, where both rates are
   * known. Deliberately narrow: this is a measured difference between two
   * rates we hold, not an estimate of what a rewritten pipeline might save.
   */
  cacheSavingUsd: number;

  /**
   * False when something this stage consumed has no rate.
   *
   * The consumption is still recorded — tokens are the fact, dollars are the
   * interpretation — and the missing part contributes 0 rather than a guess.
   * A COGS figure invented from a plausible-looking rate is worse than a
   * visible gap, because it stops anyone asking.
   */
  priced: boolean;
  /** Exactly which dimensions had no rate, so the gap is actionable. */
  unpricedUnits: PriceUnit[];
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

const round8 = (x: number): number => Math.round(x * 1e8) / 1e8;

/**
 * The rate in force for one thing at one moment, or null.
 *
 * A rate for the exact MODEL beats a provider-wide rate, so a per-request
 * search charge can sit alongside per-model token prices without either
 * shadowing the other.
 *
 * The period is half-open — [from, to) — matching the exclusion constraint in
 * the migration, so a rate that ends the instant its replacement begins is
 * unambiguous rather than briefly both.
 */
export function resolveRate(
  rows: readonly PriceRow[] | null | undefined,
  q: { provider: string; model?: string | null; unit: PriceUnit; at?: Date | string | number }
): PriceRow | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  const at = q.at === undefined ? Date.now() : new Date(q.at).getTime();
  if (!Number.isFinite(at)) return null;

  const inForce = rows.filter((r) => {
    if (!r || r.provider !== q.provider || r.unit !== q.unit) return false;
    const from = new Date(r.effective_from).getTime();
    if (!Number.isFinite(from) || at < from) return false;
    if (!r.effective_to) return true;
    const to = new Date(r.effective_to).getTime();
    return Number.isFinite(to) && at < to;
  });
  if (!inForce.length) return null;

  const exact = inForce.filter((r) => q.model != null && r.model === q.model);
  if (exact.length) return mostRecent(exact);
  const wide = inForce.filter((r) => r.model == null || r.model === '');
  return wide.length ? mostRecent(wide) : null;
}

/** The latest applicable row, when history has left more than one candidate. */
function mostRecent(rows: PriceRow[]): PriceRow {
  return rows.reduce((best, r) =>
    new Date(r.effective_from).getTime() > new Date(best.effective_from).getTime() ? r : best
  );
}

/** Cost of `quantity` units at a rate, or null when there is no rate. */
function charge(rate: PriceRow | null, quantity: number): number | null {
  if (!rate) return null;
  if (quantity <= 0) return 0;
  const per = n(rate.per_units) || 1;
  return (quantity / per) * n(rate.rate);
}

export interface PricingContext {
  provider: string;
  rows: readonly PriceRow[] | null | undefined;
  /** When the spend happened. Last month's job is priced at last month's rate. */
  at?: Date | string | number;
}

/**
 * What one stage cost.
 *
 * Cached input is subtracted from the billed input rather than counted twice:
 * the provider reports cached_tokens as a SUBSET of input_tokens, so pricing
 * both at the full rate would overstate every reused prompt — which would make
 * the reuse work look like it had achieved nothing.
 *
 * Reasoning tokens are charged ONLY when the price book carries a rate for
 * them. Where a provider folds reasoning into output, leaving that unit
 * unpriced is correct: the tokens are already inside output_tokens, and
 * pricing both double-charges every run.
 */
export function priceStage(c: StageConsumption, ctx: PricingContext): StageCost | null {
  const usage = c.usage;
  const webSearches = Math.max(0, Math.trunc(n(c.webSearches)));
  const toolCalls = Math.max(0, Math.trunc(n(c.toolCalls)));

  const inputTokens = n(usage?.input_tokens);
  const outputTokens = n(usage?.output_tokens);
  const totalTokens = n(usage?.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens && !webSearches && !toolCalls) return null;

  const cachedInputTokens = Math.min(n(usage?.input_tokens_details?.cached_tokens), inputTokens);
  const freshInputTokens = inputTokens - cachedInputTokens;
  const reasoningTokens = n(usage?.output_tokens_details?.reasoning_tokens);

  const rate = (unit: PriceUnit, model?: string | null) =>
    resolveRate(ctx.rows, { provider: ctx.provider, model, unit, at: ctx.at });

  const inputRate = rate('INPUT_TOKEN', c.model);
  // A model with no separate cached rate bills cached input at the full rate,
  // which is the conservative reading — never the cheaper one we would prefer.
  const cachedRate = rate('CACHED_INPUT_TOKEN', c.model) ?? inputRate;
  const outputRate = rate('OUTPUT_TOKEN', c.model);
  const reasoningRate = rate('REASONING_TOKEN', c.model);
  const searchRate = rate('WEB_SEARCH_CALL', c.model);
  const toolRate = rate('TOOL_CALL', c.model);

  const unpriced: PriceUnit[] = [];
  const part = (unit: PriceUnit, r: PriceRow | null, quantity: number): number => {
    if (quantity <= 0) return 0;
    const amount = charge(r, quantity);
    if (amount === null) { unpriced.push(unit); return 0; }
    return amount;
  };

  const modelCostUsd =
    part('INPUT_TOKEN', inputRate, freshInputTokens) +
    part('CACHED_INPUT_TOKEN', cachedRate, cachedInputTokens) +
    part('OUTPUT_TOKEN', outputRate, outputTokens) +
    // Only when separately billed. No rate means "included in output", not
    // "free", and adding it to `unpriced` here would report a false gap.
    (reasoningRate ? (charge(reasoningRate, reasoningTokens) ?? 0) : 0);

  const searchCostUsd =
    part('WEB_SEARCH_CALL', searchRate, webSearches) +
    part('TOOL_CALL', toolRate, toolCalls);

  // What the cache actually saved: the same tokens, at the difference between
  // the two rates we hold. Zero when either rate is missing — an unmeasurable
  // saving is not a saving of zero, but reporting it as anything else would be
  // inventing a number.
  const cacheSavingUsd =
    inputRate && cachedRate && cachedRate !== inputRate && cachedInputTokens > 0
      ? Math.max(0, (charge(inputRate, cachedInputTokens) ?? 0) - (charge(cachedRate, cachedInputTokens) ?? 0))
      : 0;

  const currency = String(inputRate?.currency ?? outputRate?.currency ?? searchRate?.currency ?? 'USD');

  return {
    stage: c.stage,
    model: c.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    webSearches,
    toolCalls,
    // Eight decimal places: a single stage can genuinely cost fractions of a
    // cent, and rounding those to zero would make a cheap job look free.
    modelCostUsd: round8(modelCostUsd),
    searchCostUsd: round8(searchCostUsd),
    costUsd: round8(modelCostUsd + searchCostUsd),
    currency,
    cacheSavingUsd: round8(cacheSavingUsd),
    priced: unpriced.length === 0,
    unpricedUnits: [...new Set(unpriced)],
  };
}

/** Every stage of one verification, priced. */
export function priceVerification(
  consumption: readonly StageConsumption[] | null | undefined,
  ctx: PricingContext
): StageCost[] {
  if (!Array.isArray(consumption)) return [];
  const out: StageCost[] = [];
  for (const c of consumption) {
    if (!c || typeof c.stage !== 'string') continue;
    const priced = priceStage(c, ctx);
    if (priced) out.push(priced);
  }
  return out;
}

export type CogsState = 'PRICED' | 'PARTIALLY_PRICED' | 'UNPRICED';

export interface VerificationCost {
  stages: StageCost[];
  totalUsd: number;
  modelCostUsd: number;
  searchCostUsd: number;
  totalTokens: number;
  cachedInputTokens: number;
  webSearches: number;
  cacheSavingUsd: number;
  currency: string;
  /**
   * PRICED only when every dimension of every stage had a rate. A total that
   * silently omits a stage reads as a cheaper job, so the state travels with
   * the number and the caller has to look at it.
   */
  state: CogsState;
  unpricedUnits: PriceUnit[];
}

export function totalVerificationCost(stages: StageCost[]): VerificationCost {
  const sum = (f: (s: StageCost) => number) => round8(stages.reduce((a, s) => a + f(s), 0));
  const unpriced = [...new Set(stages.flatMap((s) => s.unpricedUnits))];
  const anyPriced = stages.some((s) => s.priced || s.costUsd > 0);

  return {
    stages,
    totalUsd: sum((s) => s.costUsd),
    modelCostUsd: sum((s) => s.modelCostUsd),
    searchCostUsd: sum((s) => s.searchCostUsd),
    totalTokens: stages.reduce((a, s) => a + s.totalTokens, 0),
    cachedInputTokens: stages.reduce((a, s) => a + s.cachedInputTokens, 0),
    webSearches: stages.reduce((a, s) => a + s.webSearches, 0),
    cacheSavingUsd: sum((s) => s.cacheSavingUsd),
    currency: stages.find((s) => s.priced)?.currency ?? stages[0]?.currency ?? 'USD',
    state: !stages.length || !anyPriced ? 'UNPRICED' : unpriced.length ? 'PARTIALLY_PRICED' : 'PRICED',
    unpricedUnits: unpriced,
  };
}

/** The operation_type a stage is recorded under in cost_events. */
export function costOperationFor(stage: string): string {
  return `VERIFY_${String(stage).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Turns the persisted costUsage block into per-stage consumption.
 *
 * `modelForStage` exists because the stages do not all run on the same model:
 * the four research stages use the research model and the report is written by
 * verify-synthesis on its own. Pricing them as one would quietly misattribute
 * whichever is the expensive half.
 */
export function consumptionFromUsage(
  costUsage: Record<string, StageUsage | null> | null | undefined,
  modelForStage: (stage: string) => string,
  searchesForStage?: (stage: string) => number
): StageConsumption[] {
  if (!costUsage || typeof costUsage !== 'object') return [];
  const out: StageConsumption[] = [];
  for (const [stage, usage] of Object.entries(costUsage)) {
    if (!usage || typeof usage !== 'object') continue;
    out.push({
      stage,
      model: modelForStage(stage),
      usage,
      webSearches: searchesForStage ? searchesForStage(stage) : 0,
    });
  }
  return out;
}
