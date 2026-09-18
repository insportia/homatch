/*
 * WHAT A VOICE TURN COST US, AND WHEN WE DO NOT KNOW.
 *
 * COGS ONLY. Nothing in this file is, or may become, what a customer is
 * charged. voice_usage_events says the same thing in its own header and it is
 * worth repeating here, because a cost table that quietly grows a price column
 * is how a business starts billing from its own expenses.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Everything needed to price an AI Talk turn was already in the project and
 * none of it was connected. voice_usage_events has carried cost_usd and
 * cost_basis since it was written; provider_price_book has carried
 * effective-dated rates with exclusion constraints so a correction is a new
 * row rather than an edit; src/verify/cogs.ts already settled what "the rate
 * in force" means. The gap was a function that reads the second and fills in
 * the first. This is that function, and it deliberately mirrors cogs.ts's
 * resolveRate rather than inventing a second set of semantics.
 *
 * THE ONE RULE
 *
 * A rate that is not on file produces NULL, never zero. "$0.00" is a claim
 * that something was free. Making that claim by accident is how a cost centre
 * disappears from a P&L, and voice is the cost centre most able to hide: the
 * expensive parts of a conversation are the two nobody was recording.
 */

// deno-lint-ignore no-explicit-any
type Sb = any;

/** The units voice actually bills in. MONTH is fixed cost, allocated elsewhere. */
export type PriceUnit =
  | 'INPUT_TOKEN' | 'CACHED_INPUT_TOKEN' | 'OUTPUT_TOKEN'
  | 'CHARACTER' | 'AUDIO_SECOND' | 'MONTH';

export interface PriceRow {
  provider: string;
  model: string | null;
  unit: string;
  rate: number;
  per_units: number;
  effective_from: string;
  effective_to: string | null;
}

/*
 * THE BOOK IS SMALL AND READ ON EVERY TURN, SO IT IS READ ONCE A MINUTE.
 *
 * A dozen rows against a warm edge instance. Fetching them per phrase would
 * add a database round trip to the latency path this product spent two passes
 * shortening, and a rate that changed ninety seconds ago being applied
 * ninety seconds late is not a rounding error anyone can find.
 */
let cache: { rows: PriceRow[]; at: number } | null = null;
const CACHE_MS = 60_000;

export async function priceBook(sb: Sb): Promise<PriceRow[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const { data, error } = await sb
      .from('provider_price_book')
      .select('provider, model, unit, rate, per_units, effective_from, effective_to');
    if (error) throw error;
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      provider: String(r.provider),
      model: r.model === null || r.model === undefined ? null : String(r.model),
      unit: String(r.unit),
      rate: Number(r.rate),
      per_units: Number(r.per_units),
      effective_from: String(r.effective_from),
      effective_to: r.effective_to === null || r.effective_to === undefined ? null : String(r.effective_to),
    })) as PriceRow[];
    cache = { rows, at: Date.now() };
    return rows;
  } catch (e) {
    /*
     * A price book we cannot read produces NULL costs, which is correct, and
     * indistinguishable from a book that simply has no rate for this model --
     * which is not. So it is said out loud. Silence here would look exactly
     * like a successfully accounted event with nothing to account.
     */
    console.log(JSON.stringify({
      scope: 'ai-talk', event: 'price_book_unavailable',
      detail: String((e as Error)?.message ?? e).slice(0, 160),
      stale_rows: cache?.rows.length ?? 0,
    }));
    return cache?.rows ?? [];
  }
}

/** Only for tests and for an operator who has just changed a rate. */
export function forgetPriceBook(): void {
  cache = null;
}

/**
 * The rate in force for this provider, model and unit at this moment.
 *
 * Same semantics as src/verify/cogs.ts: a rate for the exact model beats a
 * provider-wide one, the period is half-open so a correction that starts the
 * instant the old one ends is unambiguous, and the most recently started of
 * several overlapping rows wins.
 */
export function rateFor(
  rows: readonly PriceRow[],
  q: { provider: string; model?: string | null; unit: PriceUnit; at?: Date },
): PriceRow | null {
  const at = (q.at ?? new Date()).getTime();
  const inForce = rows.filter((r) =>
    r.provider === q.provider
    && r.unit === q.unit
    && Date.parse(r.effective_from) <= at
    && (r.effective_to === null || Date.parse(r.effective_to) > at));
  if (!inForce.length) return null;
  const newest = (list: PriceRow[]) =>
    list.reduce((best, r) => (Date.parse(r.effective_from) > Date.parse(best.effective_from) ? r : best));
  const exact = inForce.filter((r) => q.model != null && r.model === q.model);
  if (exact.length) return newest(exact);
  const wide = inForce.filter((r) => r.model === null || r.model === '');
  return wide.length ? newest(wide) : null;
}

/** Quantity times rate, or null when there is no rate. Never zero for "unknown". */
export function charge(
  rows: readonly PriceRow[],
  q: { provider: string; model?: string | null; unit: PriceUnit; quantity: number; at?: Date },
): number | null {
  if (!Number.isFinite(q.quantity) || q.quantity < 0) return null;
  const rate = rateFor(rows, q);
  if (!rate || !Number.isFinite(rate.rate) || !(rate.per_units > 0)) return null;
  return round6((q.quantity / rate.per_units) * rate.rate);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * What one Luna turn cost.
 *
 * CACHED TOKENS ARE A SUBSET OF INPUT TOKENS, NOT AN ADDITION TO THEM. The
 * provider reports total input and, inside it, how many came from its cache;
 * charging both in full would roughly double the input line. The book has had
 * a cached rate for this model since it was seeded -- one tenth of fresh input
 * -- and nothing could use it, because the usage type in llm.ts narrowed the
 * provider's own usage object to two fields and dropped the cached count at
 * parse time. That is now widened, so this is real money rather than a
 * plausible arithmetic.
 *
 * Any leg without a rate makes the WHOLE turn's cost null: a partial total
 * presented as a total is worse than an honest gap, because it looks complete.
 */
export function llmCost(
  rows: readonly PriceRow[],
  u: { model: string; inputTokens: number; cachedInputTokens: number | null; outputTokens: number; at?: Date },
): number | null {
  const cached = Math.max(0, Math.min(u.cachedInputTokens ?? 0, u.inputTokens));
  const fresh = Math.max(0, u.inputTokens - cached);
  const at = u.at;
  const freshCost = charge(rows, { provider: 'OPENAI', model: u.model, unit: 'INPUT_TOKEN', quantity: fresh, at });
  if (freshCost === null) return null;
  const outCost = charge(rows, { provider: 'OPENAI', model: u.model, unit: 'OUTPUT_TOKEN', quantity: u.outputTokens, at });
  if (outCost === null) return null;
  if (cached === 0) return round6(freshCost + outCost);
  // A model with no cached rate on file is charged its ordinary input rate for
  // them, which is the provider's own behaviour when it does not discount.
  const cachedCost = charge(rows, { provider: 'OPENAI', model: u.model, unit: 'CACHED_INPUT_TOKEN', quantity: cached, at })
    ?? charge(rows, { provider: 'OPENAI', model: u.model, unit: 'INPUT_TOKEN', quantity: cached, at });
  if (cachedCost === null) return null;
  return round6(freshCost + cachedCost + outCost);
}

/** Speech recognition, billed per second of audio STREAMED, per stream. */
export function sttCost(
  rows: readonly PriceRow[],
  u: { provider: string; model: string | null; audioSeconds: number; at?: Date },
): number | null {
  return charge(rows, {
    provider: u.provider, model: u.model, unit: 'AUDIO_SECOND', quantity: u.audioSeconds, at: u.at,
  });
}

/** Synthesis, billed per character SUBMITTED -- including a cancelled request's. */
export function ttsCost(
  rows: readonly PriceRow[],
  u: { provider: string; model: string | null; characters: number; at?: Date },
): number | null {
  return charge(rows, {
    provider: u.provider, model: u.model, unit: 'CHARACTER', quantity: u.characters, at: u.at,
  });
}

/**
 * How many seconds of audio a recogniser was actually sent.
 *
 * The browser knows this and the server cannot: microphone audio goes straight
 * from the page to the Railway worker's socket and never passes through here.
 * Bytes of 16 kHz signed 16-bit mono, which is what the live transcriber is
 * fed, so two bytes a sample and sixteen thousand samples a second.
 */
export const LIVE_BYTES_PER_SECOND = 16_000 * 2;

export function audioSecondsFromBytes(bytes: number): number | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round((bytes / LIVE_BYTES_PER_SECOND) * 1000) / 1000;
}
