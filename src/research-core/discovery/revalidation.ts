// HOMATCH RESEARCH CORE — is this still true, and when did we last check?
//
// WHY THIS IS NOT freshness.ts
//
// discovery/freshness.ts answers HOW OLD THE CONTENT IS: a post published
// eleven months ago is outside a thirty-day window whatever we do. That is a
// fact about the author.
//
// This answers HOW OLD OUR KNOWLEDGE IS, which is a fact about us, and the
// two come apart constantly:
//
//   a listing published in March that we re-read yesterday
//       old content, fresh verification, perfectly deliverable
//   a listing published this morning that we saw once and never again
//       fresh content, unverified, and it may already be sold
//
// A customer paying for results is buying the second kind of freshness. "We
// found this six weeks ago" is not the same claim as "we checked this
// yesterday", and presenting one as the other is the quiet failure this
// module exists to prevent.
//
// FIVE TIMESTAMPS THAT MEAN FIVE DIFFERENT THINGS
//
//   first_seen_at       when it entered Homatch. IMMUTABLE. If this moves,
//                       every age calculation in the product is wrong and
//                       nothing says so.
//   last_seen_at        when we last OBSERVED it. A failed fetch does not
//                       advance this: we did not see it, we tried to.
//   last_verified_at    when we last successfully established it is still
//                       true. Advances ONLY on a conclusive revalidation.
//   content_changed_at  when its content last materially changed. Advances
//                       ONLY when the fingerprint actually moved, so "the
//                       price changed" stays distinguishable from "we
//                       re-read it and it said the same thing".
//   expires_at          when this stops being deliverable without a re-check.
//
// The discipline is that each advances for exactly one reason. A single
// `updated_at` collapses all five, and the first question anybody asks —
// "when did we last actually confirm this?" — becomes unanswerable.
//
// WHAT AN INCONCLUSIVE CHECK MUST NOT DO
//
// Count. A revalidation that timed out, hit a wall or returned something we
// could not judge tells us nothing about whether the listing is still there.
// Advancing last_verified_at on it would convert a failure to check into a
// successful check, and the evidence would get FRESHER every time we failed
// to read it. That is the single most dangerous edge in here, and
// applyRevalidation refuses it explicitly.

import { contentHash } from '../normalize/hash.ts';

/* ────────────────────────────────────────────────────────────────────────
 * Outcomes
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What a revalidation attempt established.
 *
 * Three conclusive, three not, and the split is what everything else keys
 * off. Collapsing INACCESSIBLE into REMOVED would delete evidence because a
 * site was briefly down; collapsing it into UNCHANGED_VALID would report a
 * timeout as a confirmation.
 */
export type RevalidationOutcome =
  /** Re-read it; the content is the same and still qualifies. */
  | 'UNCHANGED_VALID'
  /** Re-read it; the content moved but it still qualifies. */
  | 'CHANGED_VALID'
  /** Re-read it; it no longer qualifies. Sold, withdrawn, let. */
  | 'INVALID'
  /** It is gone. 404, 410, or the source says so. */
  | 'REMOVED'
  /** We could not read it. A wall, a block, a timeout. Says nothing. */
  | 'INACCESSIBLE'
  /** We read something and could not judge it. Also says nothing. */
  | 'UNKNOWN';

export const REVALIDATION_OUTCOMES: readonly RevalidationOutcome[] = [
  'UNCHANGED_VALID', 'CHANGED_VALID', 'INVALID', 'REMOVED', 'INACCESSIBLE', 'UNKNOWN',
];

/** Did this attempt actually establish anything? */
export function isConclusive(outcome: RevalidationOutcome): boolean {
  return outcome === 'UNCHANGED_VALID' || outcome === 'CHANGED_VALID'
    || outcome === 'INVALID' || outcome === 'REMOVED';
}

/** Did it establish that the evidence is still GOOD? */
export function confirmsValidity(outcome: RevalidationOutcome): boolean {
  return outcome === 'UNCHANGED_VALID' || outcome === 'CHANGED_VALID';
}

/* ────────────────────────────────────────────────────────────────────────
 * State
 * ──────────────────────────────────────────────────────────────────────── */

export type ValidationState =
  /** Seen once, never re-checked. The state every piece of evidence starts in. */
  | 'UNVERIFIED'
  /** Re-checked and still good. */
  | 'VALID'
  /** Re-checked and no longer qualifies. */
  | 'INVALID'
  /** Gone from its source. */
  | 'REMOVED'
  /** We have tried to re-check and could not. Neither good nor bad. */
  | 'UNVERIFIABLE';

export const VALIDATION_STATES: readonly ValidationState[] = [
  'UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE',
];

export interface EvidenceFreshness {
  /** IMMUTABLE. Set once, when the evidence entered Homatch. */
  firstSeenAt: string;
  /** Last time we OBSERVED it. A failed attempt does not move this. */
  lastSeenAt: string;
  /** Last CONCLUSIVE confirmation that it is still true. */
  lastVerifiedAt: string | null;
  /** Last time the content materially changed. */
  contentChangedAt: string | null;
  /** When it stops being deliverable without a re-check. */
  expiresAt: string | null;
  contentFingerprint: string;
  validationState: ValidationState;
  /** Consecutive inconclusive attempts. Drives back-off, not staleness. */
  failedChecks: number;
}

/**
 * The delivery window: how old a verification may be and still be shown.
 *
 * Seven days by default, and configurable because it is a product decision
 * rather than a physical constant — a rental market moves faster than a land
 * market, and a customer paying more may reasonably expect a tighter one.
 */
export const DEFAULT_DELIVERY_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface FreshnessPolicy {
  /** How old a verification may be. Defaults to seven days. */
  deliveryWindowDays?: number;
  /**
   * Whether evidence that has never been re-checked may be delivered on the
   * strength of its first sighting. True by default and bounded by the same
   * window: something we saw this morning is worth showing, something we saw
   * once a month ago is not.
   */
  allowUnverifiedWithinWindow?: boolean;
}

function windowMs(policy: FreshnessPolicy | undefined): number {
  const days = policy?.deliveryWindowDays;
  const valid = typeof days === 'number' && Number.isFinite(days) && days > 0
    ? days
    : DEFAULT_DELIVERY_WINDOW_DAYS;
  return valid * DAY_MS;
}

/** A newly discovered piece of evidence. Never verified, because it hasn't been. */
export function firstSighting(
  at: string,
  text: string,
  policy?: FreshnessPolicy,
): EvidenceFreshness {
  return {
    firstSeenAt: at,
    lastSeenAt: at,
    /*
     * NULL, not `at`. Seeing something for the first time is not verifying
     * it -- we have one observation and nothing to compare it against. Setting
     * this to the discovery time is how every piece of evidence in a system
     * ends up permanently "verified" the moment it arrives.
     */
    lastVerifiedAt: null,
    contentChangedAt: null,
    expiresAt: new Date(Date.parse(at) + windowMs(policy)).toISOString(),
    contentFingerprint: contentHash(text),
    validationState: 'UNVERIFIED',
    failedChecks: 0,
  };
}

export interface RevalidationInput {
  outcome: RevalidationOutcome;
  /** When the attempt happened. */
  at: string;
  /** The text as re-read. Absent when nothing could be read. */
  text?: string | null;
  policy?: FreshnessPolicy;
}

export interface RevalidationResult {
  freshness: EvidenceFreshness;
  /** True when the fingerprint moved. The caller may need to re-classify. */
  contentChanged: boolean;
  /** Operator-facing. Why each timestamp did or did not move. */
  reason: string;
}

/**
 * Apply one revalidation attempt.
 *
 * Pure, and deliberately unforgiving about which timestamps may move:
 *
 *   firstSeenAt         never
 *   lastSeenAt          only when we actually saw it
 *   lastVerifiedAt      only on a CONCLUSIVE outcome
 *   contentChangedAt    only when the fingerprint actually moved
 *   expiresAt           only alongside lastVerifiedAt
 *
 * The outcome the caller declares is not trusted about the content: a caller
 * that says CHANGED_VALID while handing over identical text gets
 * UNCHANGED_VALID, because the fingerprint is the fact and the label is an
 * opinion.
 */
export function applyRevalidation(
  current: EvidenceFreshness,
  input: RevalidationInput,
): RevalidationResult {
  const { outcome, at } = input;
  const fingerprint = typeof input.text === 'string' ? contentHash(input.text) : null;

  /*
   * NOTHING WAS ESTABLISHED.
   *
   * A timeout, a wall, or something we could not judge. The evidence is
   * neither confirmed nor refuted, so the ONLY thing that moves is the
   * failure counter. Advancing lastVerifiedAt here would make evidence get
   * fresher every time we failed to read it.
   */
  if (!isConclusive(outcome)) {
    return {
      freshness: {
        ...current,
        failedChecks: current.failedChecks + 1,
        // UNVERIFIABLE is a statement about our access, so it replaces
        // UNVERIFIED but never overwrites a conclusive verdict we already
        // hold: a listing we know is REMOVED does not become "we're not sure"
        // because a later fetch timed out.
        validationState: current.validationState === 'UNVERIFIED' ? 'UNVERIFIABLE' : current.validationState,
      },
      contentChanged: false,
      reason: `${outcome}: nothing was established, so no timestamp advanced`,
    };
  }

  if (outcome === 'REMOVED') {
    return {
      freshness: {
        ...current,
        // We DID observe it -- we observed that it is gone, which is a real
        // observation and the reason we can stop showing it.
        lastSeenAt: at,
        lastVerifiedAt: at,
        validationState: 'REMOVED',
        // Nothing removed is ever deliverable again, so there is no window.
        expiresAt: at,
        failedChecks: 0,
      },
      contentChanged: false,
      reason: 'the source no longer holds it',
    };
  }

  if (outcome === 'INVALID') {
    return {
      freshness: {
        ...current,
        lastSeenAt: at,
        lastVerifiedAt: at,
        validationState: 'INVALID',
        expiresAt: at,
        failedChecks: 0,
        ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
      },
      contentChanged: fingerprint !== null && fingerprint !== current.contentFingerprint,
      reason: 're-read and it no longer qualifies',
    };
  }

  /*
   * Still valid. Whether the CONTENT moved is decided by the fingerprint and
   * not by what the caller called it: a caller claiming CHANGED_VALID over
   * identical text is wrong about the content, and the fingerprint is the
   * thing that can be checked.
   */
  const changed = fingerprint !== null && fingerprint !== current.contentFingerprint;
  const verifiedAt = at;

  return {
    freshness: {
      ...current,
      lastSeenAt: at,
      lastVerifiedAt: verifiedAt,
      contentChangedAt: changed ? at : current.contentChangedAt,
      contentFingerprint: fingerprint ?? current.contentFingerprint,
      expiresAt: new Date(Date.parse(verifiedAt) + windowMs(input.policy)).toISOString(),
      validationState: 'VALID',
      failedChecks: 0,
    },
    contentChanged: changed,
    reason: changed
      ? 're-read, the content moved, and it still qualifies'
      : 're-read and unchanged',
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * May this be shown to a customer?
 * ──────────────────────────────────────────────────────────────────────── */

export type DeliveryVerdict =
  /** Verified inside the window. */
  | 'FRESH'
  /** Never re-checked, but first seen inside the window. */
  | 'NEW_UNVERIFIED'
  /** Was verified, and that verification is now too old. */
  | 'NEEDS_REVALIDATION'
  /** Re-checked and no longer qualifies. */
  | 'INVALID'
  /** Gone. */
  | 'REMOVED'
  /** We have tried and cannot read it. */
  | 'UNVERIFIABLE';

export interface DeliveryDecision {
  verdict: DeliveryVerdict;
  /** May it be put in front of a customer as it stands? */
  deliverable: boolean;
  /** Should it be re-checked before anyone is shown it? */
  needsRevalidation: boolean;
  /** How old the freshest thing we know about it is, in ms. */
  ageMs: number | null;
  reason: string;
}

/**
 * Whether a piece of evidence may be delivered, and what to do if not.
 *
 * The two rules a customer is paying for:
 *
 *   evidence older than the window is REVALIDATED before it is shown, not
 *   shown with a caveat
 *   evidence we could not re-check is not shown as though we had
 *
 * NEW_UNVERIFIED is deliverable and deliberately NOT called fresh: it is one
 * sighting inside the window, which is genuinely worth showing and is a
 * weaker claim than a confirmation. The caller can render the difference; it
 * must not be given a single boolean that hides it.
 */
export function judgeDelivery(
  freshness: EvidenceFreshness,
  options: { now?: number; policy?: FreshnessPolicy } = {},
): DeliveryDecision {
  const now = options.now ?? Date.now();
  const window = windowMs(options.policy);

  if (freshness.validationState === 'REMOVED') {
    return {
      verdict: 'REMOVED', deliverable: false, needsRevalidation: false, ageMs: null,
      reason: 'the source no longer holds it',
    };
  }
  if (freshness.validationState === 'INVALID') {
    return {
      verdict: 'INVALID', deliverable: false, needsRevalidation: false, ageMs: null,
      reason: 're-read and it no longer qualifies',
    };
  }

  const verifiedAt = freshness.lastVerifiedAt ? Date.parse(freshness.lastVerifiedAt) : Number.NaN;
  if (Number.isFinite(verifiedAt)) {
    const age = Math.max(0, now - verifiedAt);
    if (age <= window) {
      return {
        verdict: 'FRESH', deliverable: true, needsRevalidation: false, ageMs: age,
        reason: `verified ${Math.round(age / DAY_MS)} day(s) ago`,
      };
    }
    return {
      verdict: 'NEEDS_REVALIDATION', deliverable: false, needsRevalidation: true, ageMs: age,
      reason: `last verified ${Math.round(age / DAY_MS)} day(s) ago, outside the window`,
    };
  }

  /*
   * Never conclusively verified. UNVERIFIABLE means we have already tried and
   * failed, which is a weaker position than never having tried -- so it is
   * reported as its own verdict rather than folded into the unverified case.
   */
  if (freshness.validationState === 'UNVERIFIABLE') {
    return {
      verdict: 'UNVERIFIABLE', deliverable: false, needsRevalidation: true, ageMs: null,
      reason: `${freshness.failedChecks} attempt(s) could not read it`,
    };
  }

  const firstSeen = Date.parse(freshness.firstSeenAt);
  const age = Number.isFinite(firstSeen) ? Math.max(0, now - firstSeen) : null;
  const allowNew = options.policy?.allowUnverifiedWithinWindow !== false;

  if (allowNew && age !== null && age <= window) {
    return {
      verdict: 'NEW_UNVERIFIED', deliverable: true, needsRevalidation: false, ageMs: age,
      reason: `first seen ${Math.round(age / DAY_MS)} day(s) ago and not re-checked since`,
    };
  }

  return {
    verdict: 'NEEDS_REVALIDATION', deliverable: false, needsRevalidation: true, ageMs: age,
    reason: age === null
      ? 'no readable first-seen date'
      : `first seen ${Math.round(age / DAY_MS)} day(s) ago and never verified`,
  };
}

/**
 * What to re-check first, when there is a budget for some of it.
 *
 * Oldest verification first, because that is where the risk of showing
 * something untrue is greatest. Evidence we have repeatedly failed to read is
 * pushed DOWN rather than dropped: it is still owed a look, and spending the
 * whole budget on a source that is refusing us means everything else goes
 * unchecked.
 */
export function revalidationPriority(
  items: ReadonlyArray<{ id: string; freshness: EvidenceFreshness }>,
  options: { now?: number; policy?: FreshnessPolicy; limit?: number } = {},
): string[] {
  const now = options.now ?? Date.now();

  const scored = items
    .map((item) => ({ item, decision: judgeDelivery(item.freshness, { now, policy: options.policy }) }))
    .filter(({ decision }) => decision.needsRevalidation)
    .map(({ item, decision }) => ({
      id: item.id,
      // Back-off: each consecutive failure halves its place in the queue.
      score: (decision.ageMs ?? 0) / 2 ** Math.min(item.freshness.failedChecks, 6),
    }));

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const limit = options.limit ?? scored.length;
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.id);
}

/**
 * A one-line account for an operator. Never a percentage, and never a claim
 * of verification that did not happen.
 */
export function describeFreshness(
  freshness: EvidenceFreshness,
  options: { now?: number; policy?: FreshnessPolicy } = {},
): string {
  const decision = judgeDelivery(freshness, options);
  const days = decision.ageMs === null ? null : Math.round(decision.ageMs / DAY_MS);
  switch (decision.verdict) {
    case 'FRESH': return `Verified ${days} day(s) ago.`;
    case 'NEW_UNVERIFIED': return `Found ${days} day(s) ago, not re-checked.`;
    case 'NEEDS_REVALIDATION': return `Needs re-checking: ${decision.reason}.`;
    case 'UNVERIFIABLE': return `Could not be re-read (${freshness.failedChecks} attempts).`;
    case 'INVALID': return 'Re-read and no longer valid.';
    case 'REMOVED': return 'Removed from its source.';
  }
}
