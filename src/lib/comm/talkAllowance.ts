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

export interface GrantInput {
  limits: TalkLimits;
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
}

export function decideGrant(input: GrantInput): GrantDecision {
  const L = input.limits;

  if (!input.enabled) {
    return { granted: false, seconds: 0, reason: 'DISABLED', userMessage: 'UNAVAILABLE' };
  }
  if (input.visitorActiveSessions >= L.perVisitorConcurrent) {
    // Two tabs, or a session the previous page never closed. Neither should
    // get a second grant running.
    return { granted: false, seconds: 0, reason: 'ALREADY_IN_SESSION', userMessage: 'BUSY' };
  }
  if (input.globalActiveSessions >= L.globalConcurrent) {
    return { granted: false, seconds: 0, reason: 'PLATFORM_AT_CAPACITY', userMessage: 'BUSY' };
  }
  if (input.sessionsStartedToday >= L.dailySessions) {
    return { granted: false, seconds: 0, reason: 'TOO_MANY_SESSIONS_TODAY', userMessage: 'LIMIT_REACHED' };
  }

  const remainingToday = L.dailySeconds - Math.max(0, input.consumedTodaySeconds);
  if (remainingToday <= 0) {
    return { granted: false, seconds: 0, reason: 'DAILY_LIMIT_REACHED', userMessage: 'LIMIT_REACHED' };
  }

  const seconds = Math.min(L.sessionSeconds, remainingToday);
  // A grant of eight seconds is worse than no grant: the visitor gets a demo
  // that cuts off mid-sentence and concludes the product is broken.
  if (seconds < 15) {
    return { granted: false, seconds: 0, reason: 'DAILY_LIMIT_REACHED', userMessage: 'LIMIT_REACHED' };
  }

  return { granted: true, seconds };
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
