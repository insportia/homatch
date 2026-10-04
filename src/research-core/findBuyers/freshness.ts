// THE 30-DAY RULE for FIND BUYERS / FIND TENANTS — enforced at ingest.
//
// Content older than 30 days (or with no readable date) never enters HOMATCH:
// it is dropped BEFORE persistence, classification or any model call, and is
// never shown, scored or counted as demand. Same window as the platform's
// active-demand rule (discovery_freshness_policy: 30 days, undated ineligible).
//
// A comment rarely carries its own date in some Actor outputs. It cannot be
// older than the post it answers, so an undated comment is admitted only under
// a parent post that is itself dated and fresh.

export const MAX_SIGNAL_AGE_DAYS = 30;
const DAY = 86_400_000;
/** A timestamp more than a day in the future is a parsing error, not news. */
const FUTURE_SLACK_MS = DAY;

export type FreshnessReason = 'FRESH' | 'FRESH_BY_PARENT' | 'STALE' | 'UNDATED' | 'INVALID_DATE' | 'NOT_CONTENT';

export interface FreshnessVerdict { keep: boolean; reason: FreshnessReason; ageDays: number | null }

function age(iso: string | null | undefined, now: number): number | null | 'invalid' {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'invalid';
  if (t - now > FUTURE_SLACK_MS) return 'invalid';
  return Math.max(0, (now - t) / DAY);
}

export function judgeFreshness(
  item: { kind: string; publishedAt: string | null },
  parentPublishedAt: string | null,
  opts: { now?: number; maxDays?: number } = {},
): FreshnessVerdict {
  const now = opts.now ?? Date.now();
  const max = opts.maxDays ?? MAX_SIGNAL_AGE_DAYS;
  if (item.kind === 'GROUP' || item.kind === 'PROFILE') return { keep: true, reason: 'NOT_CONTENT', ageDays: null };
  const own = age(item.publishedAt, now);
  if (own === 'invalid') return { keep: false, reason: 'INVALID_DATE', ageDays: null };
  if (own != null) return own <= max ? { keep: true, reason: 'FRESH', ageDays: own } : { keep: false, reason: 'STALE', ageDays: own };
  if (item.kind === 'COMMENT') {
    const p = age(parentPublishedAt, now);
    if (typeof p === 'number' && p <= max) return { keep: true, reason: 'FRESH_BY_PARENT', ageDays: p };
  }
  return { keep: false, reason: 'UNDATED', ageDays: null };
}

/** The oldest date an Actor should return (for incremental, date-filtered runs). */
export function sinceFloor(now = Date.now(), maxDays = MAX_SIGNAL_AGE_DAYS): string {
  return new Date(now - maxDays * DAY).toISOString();
}
