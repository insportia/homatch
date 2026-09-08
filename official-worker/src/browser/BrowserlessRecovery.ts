// BrowserlessRecovery.ts — the bounded Browserless reconnect POLICY, kept in
// its own module purely so it can be imported and proven directly by the
// regression suite (ResearchOrchestrator.ts itself is excluded from
// tsconfig.test.json because of its transitive DOM-lib imports, so policy
// living inside it could only ever be tested through a hand-copied mirror).
//
// P0 INCIDENT 2026-09-08 (job 4d2ec4ba-e0ca-49f8-b7a1-cf1e37e23d44) — ROOT
// CAUSE. Browserless sessions in production were expiring after roughly two
// minutes, i.e. MULTIPLE times over the life of one multi-source research
// job. The previous recovery budget was `MAX_BROWSERLESS_RECONNECTS_PER_JOB
// = 1`, counted in a per-JOB Map keyed by job.id. Observed consequence:
//
//   TAS_MAP  — ran on session A.
//   TAS      — session A had expired; the job's ONE reconnect was spent
//              here (browser_disconnected_reconnecting attempt=1), session B
//              was launched and TAS completed.
//   MYGOV    — session B had since expired too, but the job-wide budget was
//              already exhausted, so no reconnect was even attempted.
//   MYGOV/ENREG/RSTAX/DEBTOR — all returned a technical failure carrying
//              "BrowserDisconnectedError: Browserless browser connection is
//              no longer alive".
//
// A session expiring during source N is an event completely independent of a
// session expiring during source N-1: it is a new session, dying of its own
// new deadline. Charging both to one shared budget makes every source after
// the first expiration unrecoverable, which is exactly what production showed.
//
// The budget is therefore scoped to ONE INDEPENDENT SOURCE ATTEMPT: each
// source attempt may replace a confirmed-dead browser at most once and then
// retry page acquisition exactly once. That keeps recovery genuinely bounded
// (no loop, no retry-of-a-retry, and a job with a permanently broken
// Browserless still terminates — every source simply fails technically after
// its single attempt) while never letting an earlier source's recovery
// disqualify a later source from recovering from a separate expiration.
import { BrowserDisconnectedError } from './BrowserlessRuntime.js';

/** One — and only one — browser replacement per independent source attempt.
 * Deliberately NOT per job (see the module header: that was the bug) and
 * deliberately not unbounded (a source attempt that cannot acquire a page
 * even on a freshly launched session must fall through to a clean per-source
 * TECHNICAL failure rather than reconnecting forever). */
export const MAX_BROWSERLESS_RECONNECTS_PER_SOURCE_ATTEMPT = 1;

export type ReconnectDecision = {
  /** Whether the caller should launch one fresh Browserless session and retry
   * page acquisition exactly once for THIS source attempt. */
  shouldReconnect: boolean;
  /** The 1-based reconnect attempt number within this source attempt, for
   * lifecycle logging. Unchanged from the input when shouldReconnect is
   * false, so a refused decision can never be logged as a spent attempt. */
  attempt: number;
};

/**
 * Pure decision function mirroring nothing: this IS the production policy,
 * called directly by ResearchOrchestrator.runStep()'s page-acquisition catch.
 *
 * Reconnects only when all three hold:
 *  1. the job is running on a shared Browserless session (a local/dev browser
 *     is never silently swapped for a different one mid-job);
 *  2. the failure is a CONFIRMED-dead browser/CDP connection — a
 *     BrowserDisconnectedError, which researchContext() raises only after
 *     browser.isConnected() itself reports false. A merely dead cached
 *     CONTEXT never reaches here: researchContext() already invalidates and
 *     recreates that on its own while the browser lives. Any other error (a
 *     selector timeout, a workflow bug) is NOT a browser-death signal and
 *     must not consume or trigger recovery;
 *  3. this source attempt has not already used its single recovery.
 */
export function decideBrowserlessReconnect(
  sharedBrowserlessContext: boolean,
  error: unknown,
  reconnectsUsedForThisSourceAttempt: number
): ReconnectDecision {
  if (
    sharedBrowserlessContext &&
    error instanceof BrowserDisconnectedError &&
    reconnectsUsedForThisSourceAttempt < MAX_BROWSERLESS_RECONNECTS_PER_SOURCE_ATTEMPT
  ) {
    return { shouldReconnect: true, attempt: reconnectsUsedForThisSourceAttempt + 1 };
  }
  return { shouldReconnect: false, attempt: reconnectsUsedForThisSourceAttempt };
}
