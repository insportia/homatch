// HOMI voice messages: the limits on one message, and the per-user burst rate.
//
// FREE AND UNLIMITED IN EVERY PLAN (owner, 2026-10-29). There is no price, no
// consent to a price and no balance check. What stays is technical and
// anti-abuse: two minutes per message, a size ceiling per segment, an
// account, and a burst rate a person speaking never reaches.
//
// The per-minute price this file used to hold (0.3 credits, 2026-10-25) is
// retired; the HOMI_VOICE_MESSAGE product row is kept, pricing inactive, for
// history (migration 20261207130000_homi_unlimited_cost_round).
//
// Pure, no I/O: the edge function and node:test import it.

/** The longest message, in seconds. */
export const MAX_MESSAGE_SECONDS = 120;
/** Google's unary Recognize ceiling: a clip SEGMENT is at most this long. */
export const MAX_SEGMENT_SECONDS = 60;
/** One message is at most this many segments (2 × 60 s = the 2 minute cap). */
export const MAX_SEGMENTS = 2;
/** Per segment, bytes: a minute of Opus is ~0.5 MB; Safari's MP4 runs larger. */
export const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;

export interface VoiceRateLimits { perMinute: number; perHour: number }

/** Far above a person talking (a two minute message takes two minutes to say). */
export const DEFAULT_VOICE_RATE_LIMITS: VoiceRateLimits = Object.freeze({ perMinute: 6, perHour: 60 });

export function voiceRateLimitsFrom(v: Partial<Record<keyof VoiceRateLimits, unknown>>): VoiceRateLimits {
  const pos = (x: unknown, d: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
  return {
    perMinute: pos(v.perMinute, DEFAULT_VOICE_RATE_LIMITS.perMinute),
    perHour: pos(v.perHour, DEFAULT_VOICE_RATE_LIMITS.perHour),
  };
}

/** True when this caller has sent too many voice messages too quickly. */
export function voiceRateExceeded(counts: { minute: number; hour: number }, limits: VoiceRateLimits = DEFAULT_VOICE_RATE_LIMITS): boolean {
  return counts.minute >= limits.perMinute || counts.hour >= limits.perHour;
}

/**
 * How long a message was, for the bubble and for COGS.
 *
 * Google's own billed duration when every segment reported one (the
 * measured fact). Otherwise the length the browser recorded. Never more than
 * the message limit.
 */
export function measuredSeconds(
  segmentBilledSeconds: Array<number | null>,
  recordedSeconds: number,
  maxSeconds = MAX_MESSAGE_SECONDS,
): { seconds: number; source: 'PROVIDER' | 'RECORDED' } {
  const known = segmentBilledSeconds.length > 0
    && segmentBilledSeconds.every((s) => typeof s === 'number' && Number.isFinite(s) && s >= 0);
  const raw = known
    ? (segmentBilledSeconds as number[]).reduce((a, b) => a + b, 0)
    : Math.max(0, Number(recordedSeconds) || 0);
  return { seconds: Math.min(raw, maxSeconds), source: known ? 'PROVIDER' : 'RECORDED' };
}
