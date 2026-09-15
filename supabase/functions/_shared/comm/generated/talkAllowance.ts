// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/talkAllowance.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH — AI Talk, the public homepage demo, and what stops it costing money.
//
// §28: browser realtime audio only, no PSTN, roughly 60-90 seconds per
// anonymous session, admin-configurable, and — the sentence that decides the
// design — "Do not depend on simplistic client timers for billing limits."
//
// A client timer is not a control. The browser holds a short-lived provider
// token; a page that keeps talking past its own countdown keeps costing money
// until something server-side revokes the grant. So the grant is issued with a
// server-computed expiry, the session row is the ledger, and the runtime
// reports consumption back. The countdown on screen is a courtesy.
//
// Everything here is pure so the allowance rules can be tested without a
// database, and the same functions run in the edge function that issues grants.

export interface TalkLimits {
  /** Seconds granted to one anonymous session. */
  sessionSeconds: number;
  /** Total seconds one anonymous visitor may use in a rolling day. */
  dailySeconds: number;
  /** How many anonymous sessions may be live across the whole platform at once. */
  globalConcurrent: number;
  /** How many a single visitor may have live at once. Effectively always 1. */
  perVisitorConcurrent: number;
  /** Sessions one visitor may start in a rolling day, however short. */
  dailySessions: number;
}

/**
 * Shipped defaults. Every one of these is overridable from Admin (§59); they
 * live here so a missing settings row degrades to something safe rather than
 * to unlimited.
 */
export const DEFAULT_TALK_LIMITS: TalkLimits = {
  sessionSeconds: 75,
  dailySeconds: 240,
  globalConcurrent: 25,
  perVisitorConcurrent: 1,
  dailySessions: 6,
};

export type TalkDenyReason =
  | 'SESSION_LIMIT_REACHED'
  | 'DAILY_LIMIT_REACHED'
  | 'TOO_MANY_SESSIONS_TODAY'
  | 'ALREADY_IN_SESSION'
  | 'PLATFORM_AT_CAPACITY'
  | 'DISABLED';

/**
 * Who is asking, as far as the SERVER has verified.
 *
 *   ANONYMOUS        no token, or one that did not verify
 *   STANDARD         a verified account, held to exactly the anonymous rules
 *   ADMIN_UNLIMITED  a verified account whose identity Postgres reports as an
 *                    administrator — public.is_admin() evaluated for the
 *                    token's own auth.uid(), never a claim in a request body
 *
 * The tier is an INPUT here. This module cannot verify anything; it only
 * promises what it will do once somebody who can has said which tier applies.
 */
export type UsageTier = 'ANONYMOUS' | 'STANDARD' | 'ADMIN_UNLIMITED';

/**
 * How long an administrator's testing session may run.
 *
 * The ordinary session cap is a product decision about a demo. This is the
 * TECHNICAL ceiling underneath it: the same fifteen minutes the speech worker
 * enforces on its own socket, after which a session is a leak rather than a
 * conversation. Product allowance is bypassed for an administrator; this is
 * not, because it is not an allowance.
 */
export const ADMIN_SESSION_SECONDS = 900;

export interface GrantInput {
  limits: TalkLimits;
  /** Verified server-side. Absent means anonymous. */
  usageTier?: UsageTier;
  /** Seconds this visitor has already consumed in the rolling day. */
  consumedTodaySeconds: number;
  sessionsStartedToday: number;
  visitorActiveSessions: number;
  globalActiveSessions: number;
  enabled: boolean;
}

export interface GrantDecision {
  granted: boolean;
  seconds: number;
  reason?: TalkDenyReason;
  /**
   * What to tell the visitor. Never the internal threshold (§28's CTA should
   * be tasteful, and §131's principle applies to anonymous users too).
   */
  userMessage?: 'LIMIT_REACHED' | 'BUSY' | 'UNAVAILABLE';
  /** The tier the decision was made for. */
  usageTier: UsageTier;
  /** Which product limits were set aside, if any, and on whose authority. */
  limitBypassed: boolean;
  bypassReason?: 'VERIFIED_ADMIN_ENTITLEMENT';
}

export function decideGrant(input: GrantInput): GrantDecision {
  const L = input.limits;
  const tier: UsageTier = input.usageTier ?? 'ANONYMOUS';
  const admin = tier === 'ADMIN_UNLIMITED';
  const refuse = (reason: TalkDenyReason, userMessage: GrantDecision['userMessage']): GrantDecision =>
    ({ granted: false, seconds: 0, reason, userMessage, usageTier: tier, limitBypassed: false });

  /*
   * WHAT AN ADMINISTRATOR DOES NOT GET TO SKIP.
   *
   * The three checks before the product caps are not allowances. The kill
   * switch is an operator deciding the feature is off; a second concurrent
   * session from one visitor is two tabs fighting over one microphone; and
   * platform concurrency is what stops a busy afternoon from taking the
   * providers down. None of those is a quota, so none of them is bypassed —
   * for anybody.
   */
  if (!input.enabled) return refuse('DISABLED', 'UNAVAILABLE');
  if (input.visitorActiveSessions >= L.perVisitorConcurrent) {
    // Two tabs, or a session the previous page never closed. Neither should
    // get a second grant running.
    return refuse('ALREADY_IN_SESSION', 'BUSY');
  }
  if (input.globalActiveSessions >= L.globalConcurrent) return refuse('PLATFORM_AT_CAPACITY', 'BUSY');

  /*
   * WHAT AN ADMINISTRATOR DOES SKIP: the product's own demo quota.
   *
   * Sessions per rolling day, seconds per rolling day, and the length of one
   * session exist to bound what an anonymous visitor can cost. They also
   * bound engineering verification to six or sixty sessions a day from one
   * office IP, which is how a day of live testing ended with
   * TOO_MANY_SESSIONS_TODAY. The tier is decided by the server from a
   * verified token; there is no field in any request that can set it.
   */
  if (admin) {
    return {
      granted: true,
      seconds: ADMIN_SESSION_SECONDS,
      usageTier: tier,
      limitBypassed: true,
      bypassReason: 'VERIFIED_ADMIN_ENTITLEMENT',
    };
  }

  if (input.sessionsStartedToday >= L.dailySessions) return refuse('TOO_MANY_SESSIONS_TODAY', 'LIMIT_REACHED');

  const remainingToday = L.dailySeconds - Math.max(0, input.consumedTodaySeconds);
  if (remainingToday <= 0) return refuse('DAILY_LIMIT_REACHED', 'LIMIT_REACHED');

  const seconds = Math.min(L.sessionSeconds, remainingToday);
  // A grant of eight seconds is worse than no grant: the visitor gets a demo
  // that cuts off mid-sentence and concludes the product is broken.
  if (seconds < 15) return refuse('DAILY_LIMIT_REACHED', 'LIMIT_REACHED');

  return { granted: true, seconds, usageTier: tier, limitBypassed: false };
}

/**
 * How long a grant is valid on the wall clock.
 *
 * Deliberately longer than the granted talk time. Connecting, negotiating
 * audio and the visitor's own thinking pauses all happen inside the window,
 * and a grant that expires while the visitor is mid-sentence looks like a
 * crash. The talk-seconds ceiling is what actually limits cost.
 */
export function grantExpiry(seconds: number, now = new Date()): Date {
  const slackMs = 45_000;
  return new Date(now.getTime() + seconds * 1000 + slackMs);
}

export interface ConsumptionInput {
  grantedSeconds: number;
  consumedSeconds: number;
  startedAt: string | Date;
  expiresAt: string | Date;
  now?: Date;
}

export type TalkEndReason = 'COMPLETED' | 'ALLOWANCE_EXHAUSTED' | 'WINDOW_EXPIRED' | null;

/**
 * Should this session stop, and why?
 *
 * Checked on every consumption report from the runtime AND by a sweep over
 * stale ACTIVE rows, because the one failure mode that matters is a browser
 * that stops reporting while the provider connection stays open.
 */
export function shouldEndSession(input: ConsumptionInput): { end: boolean; reason: TalkEndReason; remainingSeconds: number } {
  const now = input.now ?? new Date();
  const remaining = Math.max(0, input.grantedSeconds - Math.max(0, input.consumedSeconds));

  if (new Date(input.expiresAt).getTime() <= now.getTime()) {
    return { end: true, reason: 'WINDOW_EXPIRED', remainingSeconds: 0 };
  }
  if (remaining <= 0) {
    return { end: true, reason: 'ALLOWANCE_EXHAUSTED', remainingSeconds: 0 };
  }
  return { end: false, reason: null, remainingSeconds: remaining };
}

/**
 * A stable, non-identifying key for one visitor.
 *
 * §74 and §90: rate limiting needs to recognise a returning visitor and must
 * not build a profile of one. The anonymous session id is the primary key and
 * the IP is only ever a salted hash, so the stored value cannot be reversed
 * and cannot be joined to anything else Homatch holds.
 */
export async function hashVisitor(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
