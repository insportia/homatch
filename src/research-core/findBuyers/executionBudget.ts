// FIND BUYERS / FIND TENANTS — spending the campaign's execution budget well. Pure.
//
// The execution budget is NOT computed here. It is the provider share the central paid
// discovery policy (research-core/billing/paidDiscoveryPolicy.ts, the seam Global Finance
// V2 owns) stamps on the campaign at start: find_buyers_campaigns.provider_budget_micros.
// Everything below only spends INSIDE that number:
//
//   - every directly attributable cost counts against it: memo23 Actor runs (reserved
//     atomically by find_buyers_reserve_actor_run) AND the OpenAI calls that plan the
//     search and classify what it found;
//   - an OpenAI call starts only when the budget left still covers its worst case
//     (aiCallCeilingMicros), so classification can never push a campaign past its ceiling —
//     items it cannot afford are left UNVERIFIED, never guessed;
//   - the first probes go to the Actors that have actually produced qualified people per
//     dollar (actorYieldPrior), measured across past campaigns, never assumed.

export interface TokenPrices { inputPerMTokMicros: number; outputPerMTokMicros: number }

/** Fixed prompt overhead of one classification call (system prompt + property brief), in tokens. */
export const AI_CALL_BASE_INPUT_TOKENS = 900;
/** Per classified item: ≤ 700 chars of text + ≤ 300 of parent post + author (≈ 300 tokens). */
export const AI_ITEM_INPUT_TOKENS = 300;

/**
 * The most one structured OpenAI call can cost: input estimated from what is sent, output
 * bounded by the call's own max_tokens (the model cannot bill past it). Rounded up.
 */
export function aiCallCeilingMicros(book: TokenPrices, inputTokens: number, maxOutputTokens: number): number {
  const i = Math.max(0, Math.ceil(inputTokens)) * Math.max(0, book.inputPerMTokMicros);
  const o = Math.max(0, Math.ceil(maxOutputTokens)) * Math.max(0, book.outputPerMTokMicros);
  return Math.ceil((i + o) / 1_000_000);
}

/** Worst case of classifying `items` in one call (max_tokens = 300 + 180 per item, aiClassify.ts). */
export function classifyCallCeilingMicros(book: TokenPrices, items: number): number {
  const n = Math.max(0, Math.floor(items));
  return aiCallCeilingMicros(book, AI_CALL_BASE_INPUT_TOKENS + n * AI_ITEM_INPUT_TOKENS, 300 + n * 180);
}

/**
 * What the campaign may still spend: its execution budget minus everything already
 * committed (Actor reservations and actuals, plus every OpenAI cost booked). Never negative.
 */
export function executionHeadroomMicros(budgetMicros: number, committedMicros: number): number {
  const b = Number.isFinite(budgetMicros) ? budgetMicros : 0;
  const c = Number.isFinite(committedMicros) ? committedMicros : 0;
  return Math.max(0, Math.floor(b - c));
}

/**
 * A running ledger of the headroom inside one worker invocation. A call is admitted only
 * when its ceiling fits; what it actually cost is then taken off. With no headroom known
 * (a campaign-less call, e.g. an admin replay) the gate is open.
 */
export class AiSpendGate {
  private left: number | null;
  refused = 0;
  constructor(headroomMicros: number | null) {
    this.left = headroomMicros == null || !Number.isFinite(headroomMicros) ? null : Math.max(0, Math.floor(headroomMicros));
  }
  get remainingMicros(): number | null { return this.left; }
  /** May a call whose worst case is `ceilingMicros` start? */
  admit(ceilingMicros: number): boolean {
    if (this.left == null) return true;
    if (ceilingMicros <= this.left) return true;
    this.refused++;
    return false;
  }
  /** Book what the admitted call cost (its measured tokens × the price book). */
  spend(actualMicros: number) {
    if (this.left == null) return;
    this.left = Math.max(0, this.left - Math.max(0, Math.ceil(actualMicros || 0)));
  }
}

/** Default OpenAI classification headroom held per item an Actor run may return (µ$). */
export const DEFAULT_AI_HEADROOM_PER_ITEM_MICROS = 250;

export interface ActorRecord { bookedRuns: number; qualified: number; spentMicros?: number }

/** Finished paid runs an Actor needs before its measured yield moves its priority. */
export const YIELD_PRIOR_MIN_RUNS = 5;
/** The largest boost a measured yield can give a first probe. */
export const YIELD_PRIOR_MAX = 10;

/**
 * Priority boost for an Actor's FIRST probes from what it actually produced: qualified
 * people per provider dollar over finished paid runs (production 2026-10-19: Facebook
 * group posts 37 qualified / $6.62 ≈ 5.6 per $; every other Actor 0). No record, too few
 * runs or no qualified person → 0: no boost is invented, and zero-yield Actors are already
 * demoted by applyDepth's exploration rule, not here.
 */
export function actorYieldPrior(record: ActorRecord | null | undefined): number {
  if (!record || record.bookedRuns < YIELD_PRIOR_MIN_RUNS || record.qualified <= 0) return 0;
  const usd = Number(record.spentMicros ?? 0) / 1_000_000;
  if (!(usd > 0)) return 0;
  return Math.min(YIELD_PRIOR_MAX, Math.round(record.qualified / usd));
}
