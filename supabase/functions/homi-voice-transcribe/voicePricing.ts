// HOMI voice messages — the price of one message, and the limits on it.
//
// Pure arithmetic, no I/O, so the browser preview, the edge function and the
// tests can never disagree. The NUMBERS come from billable_products
// (HOMI_VOICE_MESSAGE.config, migration 20261204105000); the defaults below
// are the owner's decision (2026-10-25) and apply only when a row is missing a
// field.
//
// THE RULE
//
//   0.3 credits per minute ($0.03), billed per STARTED 10 seconds:
//   one step = 0.05 credits. 1 s → 0.05, 10 s → 0.05, 11 s → 0.10,
//   60 s → 0.30, 120 s → 0.60. Nothing recorded → nothing charged.
//
// Credits are computed in integer hundredths so 0.1 + 0.2 floating error can
// never round a customer's charge up by a step.

export interface VoicePricing {
  creditsPerMinute: number;
  incrementSeconds: number;
  maxSeconds: number;
}

export const DEFAULT_VOICE_PRICING: VoicePricing = {
  creditsPerMinute: 0.3,
  incrementSeconds: 10,
  maxSeconds: 120,
};

/** Google's unary Recognize ceiling: a clip SEGMENT is at most this long. */
export const MAX_SEGMENT_SECONDS = 60;
/** One message is at most this many segments (2 × 60 s = the 2 minute cap). */
export const MAX_SEGMENTS = 2;
/** Per segment, bytes: a minute of Opus is ~0.5 MB; Safari's MP4 runs larger. */
export const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;

function positive(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** Read the pricing from a billable_products.config object. */
export function voicePricingFrom(config: unknown): VoicePricing {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  return {
    creditsPerMinute: positive(c.price_credits_per_minute, DEFAULT_VOICE_PRICING.creditsPerMinute),
    incrementSeconds: Math.round(positive(c.billing_increment_seconds, DEFAULT_VOICE_PRICING.incrementSeconds)),
    maxSeconds: Math.round(positive(c.max_message_seconds, DEFAULT_VOICE_PRICING.maxSeconds)),
  };
}

/** Credits for one step (e.g. 10 s at 0.3/min = 0.05), in hundredths. */
function stepHundredths(p: VoicePricing): number {
  return Math.round(p.creditsPerMinute * 100 * p.incrementSeconds / 60);
}

/** Billable seconds, capped at the message limit and rounded UP to the step. */
export function billableSeconds(seconds: number, p: VoicePricing = DEFAULT_VOICE_PRICING): number {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const capped = Math.min(s, p.maxSeconds);
  return Math.ceil(capped / p.incrementSeconds - 1e-9) * p.incrementSeconds;
}

/** The charge, in credits, for a message of this many seconds. */
export function priceForSeconds(seconds: number, p: VoicePricing = DEFAULT_VOICE_PRICING): number {
  const steps = billableSeconds(seconds, p) / p.incrementSeconds;
  return (steps * stepHundredths(p)) / 100;
}

/** The cheapest possible message: one step. */
export function minimumCredits(p: VoicePricing = DEFAULT_VOICE_PRICING): number {
  return stepHundredths(p) / 100;
}

/**
 * How long a message this balance can pay for, in whole steps, capped at the
 * message limit. 0 means the balance cannot cover even one step.
 */
export function affordableSeconds(balance: number, p: VoicePricing = DEFAULT_VOICE_PRICING): number {
  const b = Number(balance);
  const step = stepHundredths(p);
  if (!Number.isFinite(b) || b <= 0 || step <= 0) return 0;
  const steps = Math.floor(Math.round(b * 100) / step);
  return Math.min(steps * p.incrementSeconds, p.maxSeconds);
}

/**
 * The seconds a settled message is charged for.
 *
 * Google's own billed duration when every segment reported one (the
 * measured fact). Otherwise the length the browser recorded, which the
 * customer saw on the timer. Never more than the message limit.
 */
export function chargedSeconds(
  segmentBilledSeconds: Array<number | null>,
  recordedSeconds: number,
  p: VoicePricing = DEFAULT_VOICE_PRICING,
): { seconds: number; source: 'PROVIDER' | 'RECORDED' } {
  const known = segmentBilledSeconds.length > 0
    && segmentBilledSeconds.every((s) => typeof s === 'number' && Number.isFinite(s) && s >= 0);
  const raw = known
    ? (segmentBilledSeconds as number[]).reduce((a, b) => a + b, 0)
    : Math.max(0, Number(recordedSeconds) || 0);
  return { seconds: Math.min(raw, p.maxSeconds), source: known ? 'PROVIDER' : 'RECORDED' };
}
