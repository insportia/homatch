// HOMATCH RESEARCH CORE — how recent is recent enough?
//
// For discovery, freshness is not a tuning parameter, it is most of the
// value. A buyer who posted "looking for a 2BR in Vake" an hour ago is a
// lead; the same post from fourteen months ago is a person who already
// bought. Both match every keyword equally well, so a ranker that does not
// understand time will happily put the second one first.
//
// THE RULE THAT MATTERS MOST
//
// Never fabricate a publication time. A post whose date we could not read is
// UNDATED, and undated is not "now" — it is a separate, honest state that a
// window can include or exclude deliberately. Substituting the time we
// happened to crawl it would turn "we found this today" into "this was posted
// today", which is a different claim and a false one.
//
// This is DISCOVERY freshness — how old the underlying post is. It is not
// document-cache freshness (SourcePolicy.cacheTtlMs, "may we reuse these
// bytes") and it is not fact freshness (intelligence_freshness_policy, "is
// what it said still true"). Three different questions; conflating any two of
// them produces a confident wrong answer.

export type FreshnessWindow =
  | 'LAST_HOUR'
  | 'TODAY'
  | 'LAST_2_DAYS'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'ANY';

export const FRESHNESS_WINDOWS: readonly FreshnessWindow[] = [
  'LAST_HOUR',
  'TODAY',
  'LAST_2_DAYS',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'ANY',
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const WINDOW_MS: Record<Exclude<FreshnessWindow, 'ANY' | 'TODAY'>, number> = {
  LAST_HOUR: HOUR,
  LAST_2_DAYS: 2 * DAY,
  LAST_7_DAYS: 7 * DAY,
  LAST_14_DAYS: 14 * DAY,
  LAST_30_DAYS: 30 * DAY,
};

/**
 * A window, or an explicit custom span in milliseconds.
 *
 * `TODAY` is deliberately not "the last 24 hours": a customer who asks for
 * today means since midnight, and on a Monday morning those are very
 * different sets. It needs a timezone offset to mean anything, which the
 * caller supplies, because the core has no locale.
 */
export interface FreshnessSpec {
  window: FreshnessWindow;
  /** Only for a custom span. Overrides `window` when set. */
  customMs?: number | null;
  /** Minutes east of UTC, for TODAY. Tbilisi is +240. Defaults to UTC. */
  utcOffsetMinutes?: number;
  /**
   * Whether a post whose date could not be read may still be returned.
   *
   * Defaults to false for narrow windows and is forced false for LAST_HOUR
   * and TODAY: "posted in the last hour, we think, but we could not read the
   * date" is not a claim worth making.
   */
  includeUndated?: boolean;
}

export interface FreshnessVerdict {
  /** Inside the window. */
  inWindow: boolean;
  /** Null when the post carried no readable date. */
  ageMs: number | null;
  undated: boolean;
  /**
   * 0..1, for ranking. 1 is brand new, decaying over the window. An undated
   * post scores low rather than zero — it is worth less, not worthless.
   */
  score: number;
}

/** The oldest timestamp still inside the window, or null for ANY. */
export function windowStart(spec: FreshnessSpec, now: number): number | null {
  if (spec.customMs !== null && spec.customMs !== undefined) {
    return now - Math.max(0, spec.customMs);
  }
  if (spec.window === 'ANY') return null;
  if (spec.window === 'TODAY') {
    const offsetMs = (spec.utcOffsetMinutes ?? 0) * 60_000;
    const local = now + offsetMs;
    const midnightLocal = Math.floor(local / DAY) * DAY;
    return midnightLocal - offsetMs;
  }
  return now - WINDOW_MS[spec.window];
}

export function judgeFreshness(
  publishedAtIso: string | null | undefined,
  spec: FreshnessSpec,
  now: number = Date.now(),
): FreshnessVerdict {
  const start = windowStart(spec, now);

  const parsed = publishedAtIso ? Date.parse(publishedAtIso) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    // Undated. Never treated as "now".
    const allowed = spec.window === 'ANY'
      ? true
      : narrowWindow(spec)
        ? false
        : spec.includeUndated === true;
    return { inWindow: allowed, ageMs: null, undated: true, score: allowed ? 0.15 : 0 };
  }

  // A timestamp in the future is a source's clock problem, not evidence of
  // freshness. Clamp to zero age rather than scoring it above everything.
  const ageMs = Math.max(0, now - parsed);

  if (start === null) return { inWindow: true, ageMs, undated: false, score: decay(ageMs, 30 * DAY) };

  const span = Math.max(1, now - start);
  const inWindow = parsed >= start;
  return { inWindow, ageMs, undated: false, score: inWindow ? decay(ageMs, span) : 0 };
}

/** LAST_HOUR and TODAY never admit an undated post, whatever the caller asks. */
function narrowWindow(spec: FreshnessSpec): boolean {
  if (spec.customMs !== null && spec.customMs !== undefined) return spec.customMs <= DAY;
  return spec.window === 'LAST_HOUR' || spec.window === 'TODAY';
}

/** Linear decay across the window. Simple on purpose: it has to be explicable. */
function decay(ageMs: number, spanMs: number): number {
  const ratio = 1 - ageMs / Math.max(1, spanMs);
  return Math.min(1, Math.max(0, Math.round(ratio * 100) / 100));
}

/**
 * Whether an incremental scan can skip everything older than the cursor.
 *
 * Only true when the source orders by time and we hold a cursor. A source
 * that reorders by engagement — which most social feeds do — cannot be
 * incrementally trusted this way, and saying otherwise silently drops new
 * posts that appear below old ones.
 */
export function canSkipOlderThanCursor(source: {
  chronological: boolean;
  cursorIso: string | null;
}): boolean {
  return source.chronological && !!source.cursorIso;
}
