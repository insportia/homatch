// COMMUNITY EVIDENCE — PublicSignal, EXTENDED, NEVER EDITED.
//
// WHY THIS IS AN EXTENSION AND NOT A CHANGE TO PublicSignal
//
// PublicSignal is reached by src/verify through adapters/portal/types.ts and
// discovery/adapter.ts, and Verify is a frozen product. I had already begun
// adding these fields to PublicSignal as REQUIRED members before checking who
// consumed it — which would have changed an approved product to suit new work,
// and would have broken every existing constructor besides. Reverted, and the
// rule it taught is the one at the top of this file: when new work conflicts with
// a protected contract, the NEW work moves.
//
// So `CommunityEvidence extends PublicSignal`. Every existing field keeps its
// meaning, every existing consumer keeps compiling, and nothing here can reach
// Verify: Verify consumes PublicSignal, and a PublicSignal is never widened into
// one of these by accident — it takes an explicit call to `asCommunityEvidence`.
//
// WHAT WAS ALREADY THERE, AND IS DELIBERATELY NOT REDEFINED
//
// The audit of raw_signals found the time model almost complete: published_at,
// discovered_at, last_seen_at, last_verified_at, content_changed_at,
// content_fingerprint, validation_state, expires_at. And
// raw_signals_platform_external_id_key is already a UNIQUE index on
// (platform, external_id) — the same native object is already one row by
// database constraint.
//
// This file therefore adds the eight things that were genuinely missing and
// renames nothing. A second `firstSeenAt` beside the existing `discoveredAt`
// would be the exact duplication the brief forbids.
//
// THE ONE RULE THAT PROTECTS MONEY
//
// Identity comes from signals/identity.ts, which refuses to build an id from
// anything but platform-native ids. `contentFingerprint` answers "has the text
// changed"; the id answers "is this the same item". An edit therefore arrives as
// the same id with a new fingerprint and is recorded as a NEW VERSION of one
// lead — not as a second lead. adapters/meta-platform.ts still has the old
// `contentUrl ?? contentHash(text)` fallback and is wired to no worker; nothing
// may be wired to it until it comes through here.

import type { PublicSignal, SignalPlatform } from './types.ts';
import { compareSighting, stableParentId, stableSignalId, type PlatformIdentity } from './identity.ts';

/** How the evidence was legitimately obtained. Mirrors social/acquisition.ts. */
export type EvidenceAcquisitionMode =
  | 'OFFICIAL_API'
  | 'BUSINESS_API'
  | 'AUTHORIZED_ACCOUNT'
  | 'PUBLIC_WEB'
  | 'PUBLIC_FEED'
  | 'WEBHOOK';

/**
 * Whether the content is still there.
 *
 * REMOVED and INACCESSIBLE are separate because one is a fact about the author
 * and the other is a fact about us. A token that expired must never be recorded
 * as somebody withdrawing their requirement — the evidence would then drop out of
 * a customer's results for entirely the wrong reason.
 */
export type EvidenceAvailability =
  | 'AVAILABLE'
  | 'REMOVED'
  | 'INACCESSIBLE'
  | 'UNKNOWN';

export interface CommunityEvidence extends PublicSignal {
  /* ── platform-native identity, beyond the id itself ─────────────────────── */

  /** The group / subreddit / channel / board, as the platform ids it. */
  communityId: string;
  /** The platform's own id for this item, verbatim. Never tidied. */
  externalContentId: string;
  /** The platform's id for the item this answers. Null for a top-level post. */
  parentContentId: string | null;
  /** The conversation, where the platform models one apart from the parent. */
  threadId: string | null;

  /* ── provenance of the read ─────────────────────────────────────────────── */

  acquisitionMode: EvidenceAcquisitionMode;
  /** The authorized connection used, or null for public access. An id, never a token. */
  connectionId: string | null;
  /** The community_targets row. Carries no intent: a community holds both sides. */
  targetId: string | null;

  /* ── time the existing model did not cover ──────────────────────────────── */

  /**
   * When the PLATFORM says it was edited. Distinct from the inherited
   * `lastSeenAt` and from content_changed_at: null means "not exposed", never
   * "not edited".
   */
  sourceUpdatedAt: string | null;
  /** When it went away. Null while available. */
  becameUnavailableAt: string | null;

  availability: EvidenceAvailability;
  /** Increments on each observed edit of the same identity. Starts at 1. */
  contentVersion: number;
}

export interface CommunityEvidenceInput {
  identity: PlatformIdentity;
  acquisitionMode: EvidenceAcquisitionMode;
  connectionId?: string | null;
  targetId?: string | null;
  sourceUpdatedAt?: string | null;
  availability?: EvidenceAvailability;
  contentVersion?: number;
}

/**
 * Widen a PublicSignal into CommunityEvidence, deriving the id from native ids.
 *
 * THROWS when the identity is incomplete, via stableSignalId. That is the point:
 * an adapter that cannot supply native ids must be fixed, not quietly given a
 * hash of the text. The `id` on the incoming signal is overwritten precisely
 * because meta-platform.ts still computes one the wrong way — passing through
 * whatever it produced would carry the defect into the store.
 */
export function asCommunityEvidence(
  signal: PublicSignal,
  input: CommunityEvidenceInput,
): CommunityEvidence {
  const id = stableSignalId(input.identity);

  return {
    ...signal,
    id,
    platform: input.identity.platform,
    communityId: input.identity.communityId,
    externalContentId: input.identity.externalContentId,
    parentContentId: input.identity.parentContentId ?? null,
    threadId: input.identity.threadId ?? null,
    acquisitionMode: input.acquisitionMode,
    connectionId: input.connectionId ?? null,
    targetId: input.targetId ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    becameUnavailableAt: null,
    availability: input.availability ?? 'AVAILABLE',
    contentVersion: Math.max(1, Math.trunc(input.contentVersion ?? 1)),
  };
}

/** The parent's stable id, for linking a comment to its post. */
export function parentEvidenceId(evidence: CommunityEvidence): string | null {
  return stableParentId({
    platform: evidence.platform,
    communityId: evidence.communityId,
    externalContentId: evidence.externalContentId,
    parentContentId: evidence.parentContentId,
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * Re-observing something we already hold
 * ──────────────────────────────────────────────────────────────────────── */

export interface StoredEvidence {
  id: string;
  contentFingerprint: string | null;
  contentVersion: number;
  lastSeenAt: string;
  availability: EvidenceAvailability;
  /**
   * When it FIRST went away, if it already had.
   *
   * Carried so a second failed read does not overwrite it. Re-checking a deleted
   * post every hour must not keep moving the moment it disappeared to now —
   * "gone since Tuesday" is the useful fact, and "gone since a minute ago" is
   * what a naive update would record forever.
   */
  becameUnavailableAt: string | null;
}

export type ObservationAction =
  /** Not seen before. Insert. */
  | 'INSERT'
  /** Same id, same text. Move lastSeenAt only. */
  | 'TOUCH'
  /** Same id, different text. One lead, new version. */
  | 'VERSION'
  /** It is gone. Record when, keep the row. */
  | 'MARK_UNAVAILABLE';

export interface ObservationPlan {
  action: ObservationAction;
  /** The version to store. Unchanged on TOUCH, incremented on VERSION. */
  contentVersion: number;
  availability: EvidenceAvailability;
  /** Set only on MARK_UNAVAILABLE. */
  becameUnavailableAt: string | null;
  /** Plain words. This decides whether a customer sees new evidence. */
  reason: string;
}

/**
 * Decide what to do with a fresh observation of a native object.
 *
 * THE DEFECT THIS PREVENTS is the one that already cost money once, in a
 * different table: run-matching-v2 keyed duplicate detection on
 * intent_profile_id, an id that does not survive re-classification, so forum.ge
 * post 14328580 came back with a new id and one buyer was offered for sale twice
 * — 35 credits paid, 20 more asked.
 *
 * Here the same trap is text: if identity came from a hash of the content, an
 * edited post would be a new id and therefore a new lead. Because identity is
 * platform-native, an edit is the SAME id with a different fingerprint, and the
 * only correct answer is VERSION — one person, one lead, updated evidence.
 */
export function planObservation(
  known: StoredEvidence | null,
  fresh: { contentFingerprint: string; availability?: EvidenceAvailability },
  now: string,
): ObservationPlan {
  const availability = fresh.availability ?? 'AVAILABLE';

  if (availability === 'REMOVED' || availability === 'INACCESSIBLE') {
    return {
      action: 'MARK_UNAVAILABLE',
      contentVersion: known?.contentVersion ?? 1,
      availability,
      becameUnavailableAt: known?.becameUnavailableAt ?? now,
      reason: availability === 'REMOVED'
        ? 'the platform says this is gone. The row stays as historical intelligence and stops '
          + 'being presented as freshly verified; it is never deleted.'
        : 'we could not reach it. That is a fact about our access, not about the author '
          + 'withdrawing — recorded as INACCESSIBLE so an expired token is never mistaken for '
          + 'somebody changing their mind.',
    };
  }

  const sighting = compareSighting(known, fresh);

  if (sighting.verdict === 'NEW') {
    return {
      action: 'INSERT',
      contentVersion: 1,
      availability: 'AVAILABLE',
      becameUnavailableAt: null,
      reason: sighting.detail,
    };
  }

  if (sighting.verdict === 'UNCHANGED') {
    return {
      action: 'TOUCH',
      contentVersion: known?.contentVersion ?? 1,
      availability: 'AVAILABLE',
      becameUnavailableAt: null,
      reason: 'same platform id, identical text: only lastSeenAt moves. Re-scanning must not '
        + 'produce a second lead.',
    };
  }

  return {
    action: 'VERSION',
    contentVersion: (known?.contentVersion ?? 1) + 1,
    availability: 'AVAILABLE',
    becameUnavailableAt: null,
    reason: 'same platform id, different text: the author edited it. One lead, next version — '
      + 'never a second purchasable lead, which is what a text-derived identity would have '
      + 'produced.',
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Time windows — real query bounds, not frontend labels
 * ──────────────────────────────────────────────────────────────────────── */

export type TimeWindow =
  | 'LAST_HOUR' | 'TODAY' | 'YESTERDAY' | 'LAST_24H'
  | 'THIS_WEEK' | 'LAST_7D' | 'THIS_MONTH' | 'LAST_30D' | 'CUSTOM';

export interface TimeBounds {
  /** Inclusive lower bound, ISO. */
  from: string;
  /** Exclusive upper bound, ISO. */
  to: string;
  /**
   * Which column the bound applies to.
   *
   * `published_at` is when the AUTHOR posted; `discovered_at` is when WE found
   * it. "Buyers who posted today" and "buyers we found today" are different
   * questions and answering the wrong one silently is the whole reason this is a
   * field rather than an assumption. published_at is nullable — a source that
   * stated no date has none — so a published_at window legitimately excludes
   * rows a discovered_at window would include.
   */
  column: 'published_at' | 'discovered_at' | 'last_verified_at';
}

export interface TimeWindowRequest {
  window: TimeWindow;
  column?: TimeBounds['column'];
  /** Required for CUSTOM. */
  from?: string;
  to?: string;
  /** Minutes east of UTC. Calendar windows are local; durations are not. */
  tzOffsetMinutes?: number;
}

/**
 * Turn a window into bounds a database can index-scan.
 *
 * CALENDAR WINDOWS ARE LOCAL, DURATIONS ARE NOT. "Today" means the operator's
 * today — a Tbilisi operator at 01:00 asking for today does not mean "since
 * 04:00 yesterday UTC". "Last 24 hours" means 24 hours, in any timezone. Getting
 * this backwards produces an off-by-one-day report that looks plausible, which is
 * the worst kind.
 *
 * Storage stays UTC throughout; the offset only decides where a calendar boundary
 * falls.
 */
export function timeBounds(request: TimeWindowRequest, now: Date = new Date()): TimeBounds {
  const column = request.column ?? 'discovered_at';
  const offsetMs = (request.tzOffsetMinutes ?? 0) * 60_000;
  const iso = (d: Date) => new Date(d.getTime()).toISOString();

  /** Local midnight, expressed as a UTC instant. */
  const localMidnight = (daysBack: number): Date => {
    const local = new Date(now.getTime() + offsetMs);
    local.setUTCHours(0, 0, 0, 0);
    local.setUTCDate(local.getUTCDate() - daysBack);
    return new Date(local.getTime() - offsetMs);
  };

  switch (request.window) {
    case 'LAST_HOUR':
      return { from: iso(new Date(now.getTime() - 3_600_000)), to: iso(now), column };
    case 'LAST_24H':
      return { from: iso(new Date(now.getTime() - 86_400_000)), to: iso(now), column };
    case 'LAST_7D':
      return { from: iso(new Date(now.getTime() - 7 * 86_400_000)), to: iso(now), column };
    case 'LAST_30D':
      return { from: iso(new Date(now.getTime() - 30 * 86_400_000)), to: iso(now), column };
    case 'TODAY':
      return { from: iso(localMidnight(0)), to: iso(now), column };
    case 'YESTERDAY':
      return { from: iso(localMidnight(1)), to: iso(localMidnight(0)), column };
    case 'THIS_WEEK': {
      /* ISO week: Monday is day 1. getUTCDay() makes Sunday 0, so Sunday is 6
         days into the week, not the start of the next one. */
      const local = new Date(now.getTime() + offsetMs);
      const dayOfWeek = (local.getUTCDay() + 6) % 7;
      return { from: iso(localMidnight(dayOfWeek)), to: iso(now), column };
    }
    case 'THIS_MONTH': {
      const local = new Date(now.getTime() + offsetMs);
      return { from: iso(localMidnight(local.getUTCDate() - 1)), to: iso(now), column };
    }
    case 'CUSTOM': {
      if (!request.from || !request.to) {
        throw new Error('a CUSTOM window needs both from and to');
      }
      const from = new Date(request.from);
      const to = new Date(request.to);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
        throw new Error('a CUSTOM window needs two parseable timestamps');
      }
      if (from.getTime() > to.getTime()) {
        throw new Error('a CUSTOM window cannot start after it ends');
      }
      return { from: iso(from), to: iso(to), column };
    }
    default:
      throw new Error(`unknown time window: ${String(request.window)}`);
  }
}

export type TimeBucket = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';

/**
 * The Postgres `date_trunc` unit for a bucket.
 *
 * Returned as a validated constant rather than interpolated from caller input:
 * a bucket name reaching SQL unchecked is an injection, and an allowlist that
 * returns a literal is the cheapest possible defence.
 */
export function truncUnit(bucket: TimeBucket): 'hour' | 'day' | 'week' | 'month' {
  switch (bucket) {
    case 'HOUR': return 'hour';
    case 'DAY': return 'day';
    case 'WEEK': return 'week';
    case 'MONTH': return 'month';
    default: throw new Error(`unknown time bucket: ${String(bucket)}`);
  }
}

/**
 * How many buckets a window would produce.
 *
 * So a caller can refuse an absurd request — thirty days bucketed by hour is 720
 * rows, which is fine, but a five-year custom range by hour is 43,800 and is a
 * chart nobody reads and a query nobody should run.
 */
export function bucketCount(bounds: TimeBounds, bucket: TimeBucket): number {
  const ms = Date.parse(bounds.to) - Date.parse(bounds.from);
  const per: Record<TimeBucket, number> = {
    HOUR: 3_600_000,
    DAY: 86_400_000,
    WEEK: 7 * 86_400_000,
    MONTH: 30 * 86_400_000,
  };
  return Math.max(1, Math.ceil(ms / per[bucket]));
}
