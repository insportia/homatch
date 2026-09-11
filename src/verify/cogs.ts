// HOMATCH — what a verification actually costs us.
//
// Audited before writing any of this. The finding was specific:
//
//   cost_events holds 607 rows and $25.24 of recorded spend, from discovery,
//   matching and signal classification. NOT ONE of them comes from Verify.
//   Every one of the 41 completed verifications carries per-stage token
//   counts in result_json.costUsage — identity, official_collection,
//   public_research, market, synthesis, with cached_tokens broken out — and
//   none of it has ever been turned into dollars or written anywhere it can
//   be counted.
//
// So the product with the highest per-unit cost in the system is the one with
// no cost accounting at all. Everything downstream of this — knowing whether
// reuse actually saved anything, whether a cheaper model degraded quality for
// nothing, whether a verification costs $0.20 or $2.00 — is guesswork until
// the spend is recorded per job.
//
// This module is the pure half: tokens in, priced stages out. It performs no
// I/O, so it can be tested exactly, and it is the only place that knows how
// to turn a usage block into money.
//
// NONE OF THIS IS EVER SHOWN TO A CUSTOMER. What Homatch pays to produce a
// report is not a fact about their property, and a report is not cheaper to
// buy because it was cheaper to make.

/** Per million tokens, in USD. Cached input is billed at a lower rate. */
export interface ModelRate {
  input: number;
  output: number;
  /** Rate for input tokens served from the provider's cache. */
  cachedInput?: number;
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

export interface StageCost {
  /** Lowercase stage name as persisted: identity, market, synthesis, … */
  stage: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /**
   * False when no rate is configured for this model.
   *
   * The consumption is still recorded — tokens are the fact, dollars are the
   * interpretation — and costUsd stays 0 rather than being guessed. A COGS
   * figure invented from a plausible-looking rate is worse than a visible
   * gap, because it stops anyone asking.
   */
  priced: boolean;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/**
 * Reads the rate table from configuration.
 *
 * Rates live in the environment rather than in this file because they change
 * without the code changing, and a stale hardcoded price produces confident
 * wrong numbers. Shape: {"model-name": {"input": 1.25, "output": 10,
 * "cachedInput": 0.125}} in USD per million tokens.
 *
 * An unparseable value yields an empty table, not a crash and not a default
 * price: recording tokens with no dollars is a recoverable state, and every
 * row says which it is.
 */
export function parseRateTable(raw: string | null | undefined): Record<string, ModelRate> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ModelRate> = {};
    for (const [model, rate] of Object.entries(parsed ?? {})) {
      if (!rate || typeof rate !== 'object') continue;
      const r = rate as Record<string, unknown>;
      const input = n(r.input);
      const output = n(r.output);
      if (!input && !output) continue;
      out[model] = {
        input,
        output,
        ...(n(r.cachedInput) ? { cachedInput: n(r.cachedInput) } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * What one stage cost.
 *
 * Cached input is subtracted from the billed input rather than counted twice:
 * the provider reports cached_tokens as a SUBSET of input_tokens, so pricing
 * both at the full rate would overstate every reused prompt — which would
 * make the reuse work look like it had achieved nothing.
 */
export function priceStage(
  stage: string,
  usage: StageUsage | null | undefined,
  model: string,
  rates: Record<string, ModelRate>
): StageCost | null {
  if (!usage || typeof usage !== 'object') return null;

  const inputTokens = n(usage.input_tokens);
  const outputTokens = n(usage.output_tokens);
  const totalTokens = n(usage.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens) return null;

  const cachedInputTokens = Math.min(n(usage.input_tokens_details?.cached_tokens), inputTokens);
  const freshInputTokens = inputTokens - cachedInputTokens;

  const rate = rates[model];
  if (!rate) {
    return {
      stage, model, inputTokens, cachedInputTokens, outputTokens, totalTokens,
      costUsd: 0, priced: false,
    };
  }

  // A model with no separate cached rate bills cached input at the full rate,
  // which is the conservative reading — never the cheaper one we would prefer.
  const cachedRate = rate.cachedInput ?? rate.input;
  const costUsd =
    (freshInputTokens / 1_000_000) * rate.input +
    (cachedInputTokens / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * rate.output;

  return {
    stage, model, inputTokens, cachedInputTokens, outputTokens, totalTokens,
    // Eight decimal places: a single stage can genuinely cost fractions of a
    // cent, and rounding those to zero would make a cheap job look free.
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    priced: true,
  };
}

/**
 * Every stage of one verification, priced.
 *
 * `modelForStage` exists because the stages do not all run on the same model:
 * the four research stages use OPENAI_RESEARCH_MODEL and the report is
 * written by verify-synthesis on its own. Pricing them as one model would
 * quietly misattribute whichever is the expensive half.
 */
export function priceVerification(
  costUsage: Record<string, StageUsage | null> | null | undefined,
  modelForStage: (stage: string) => string,
  rates: Record<string, ModelRate>
): StageCost[] {
  if (!costUsage || typeof costUsage !== 'object') return [];
  const out: StageCost[] = [];
  for (const [stage, usage] of Object.entries(costUsage)) {
    const priced = priceStage(stage, usage, modelForStage(stage), rates);
    if (priced) out.push(priced);
  }
  return out;
}

export interface VerificationCost {
  stages: StageCost[];
  totalUsd: number;
  totalTokens: number;
  cachedInputTokens: number;
  /** False when any stage ran on a model with no configured rate. */
  fullyPriced: boolean;
}

export function totalVerificationCost(stages: StageCost[]): VerificationCost {
  return {
    stages,
    totalUsd: Math.round(stages.reduce((a, s) => a + s.costUsd, 0) * 1e8) / 1e8,
    totalTokens: stages.reduce((a, s) => a + s.totalTokens, 0),
    cachedInputTokens: stages.reduce((a, s) => a + s.cachedInputTokens, 0),
    fullyPriced: stages.length > 0 && stages.every((s) => s.priced),
  };
}

/** The operation_type a stage is recorded under in cost_events. */
export function costOperationFor(stage: string): string {
  return `VERIFY_${String(stage).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}
