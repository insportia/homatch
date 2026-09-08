import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHumanLiveURL,
  exceedsPlanTimeoutLimit,
  planTimeoutLimitMs,
} from '../.tstest-build/browser/BrowserlessRuntime.js';
import { openHumanLiveSession } from '../.tstest-build/browser/HumanLiveSession.js';
import { createVisualWatch, attachVisualWatch } from '../.tstest-build/browser/VisualWatchSession.js';

/*
 * PRODUCTION INCIDENT 2026-09-08 — job aaf11509-391c-4799-b0af-2d074594d49a.
 *
 * Railway proved the sequence: visual_watch_requested -> browser_connected ->
 * before_source(TAS_MAP) -> research_context_ready -> page_created(TAS_MAP)
 * -> human_live_url_failed -> visual_watch_unavailable(generation=0), and
 * POST /research/:id/live then answered 404 for the rest of the job, because
 * no live view had ever been created.
 *
 * The rejection below is the VERBATIM production message. Every test here
 * uses that exact string.
 */
const PLAN_REJECTION =
  'The \'timeout\' value must be a whole number of milliseconds between 1 and 120,000 (your plan\'s maximum session time). Received "900000".';

/** The timeout the orchestrator actually asked for in production: the
 * 15-minute human-session TTL. */
const REQUESTED_MS = 900000;

/**
 * A page whose Browserless rejects any `timeout` above `planLimitMs` with the
 * production message. `rejectVia` models both real failure shapes: Browserless
 * answering `{ error }`, and the CDP call throwing.
 */
function makePage({ planLimitMs = 120000, rejectVia = 'error_payload', failFallback = false } = {}) {
  const events = { sends: [], detaches: 0, newPageCalls: 0, newContextCalls: 0, newCDPSessions: 0 };
  let seq = 0;

  const cdp = {
    send: async (method, params) => {
      assert.equal(method, 'Browserless.liveURL');
      events.sends.push(params);
      const requested = params.timeout;
      if (requested !== undefined && requested > planLimitMs) {
        if (rejectVia === 'throw') throw new Error(PLAN_REJECTION);
        return { error: PLAN_REJECTION };
      }
      if (failFallback) return { error: 'browserless is unavailable' };
      seq += 1;
      return { liveURL: `https://production-sfo.browserless.io/live/view-${seq}`, liveURLId: `handle-${seq}` };
    },
    detach: async () => {
      events.detaches += 1;
    },
  };

  const ctx = {
    newCDPSession: async () => {
      events.newCDPSessions += 1;
      return cdp;
    },
    newPage: async () => {
      events.newPageCalls += 1;
      return {};
    },
    newContext: async () => {
      events.newContextCalls += 1;
      return {};
    },
  };

  const page = { label: 'page-A', context: () => ctx, url: () => 'https://tas.gov.ge/', close: async () => {} };
  return { page, ctx, events };
}

/* ================================================================== *
 * The matcher: the deployed CDP-connection matcher already covers the *
 * liveURL wording, which is why no second matcher was written.        *
 * ================================================================== */

test('the existing exceedsPlanTimeoutLimit() matcher classifies the VERBATIM production liveURL rejection', () => {
  assert.equal(exceedsPlanTimeoutLimit(new Error(PLAN_REJECTION)), true);
  assert.equal(exceedsPlanTimeoutLimit(PLAN_REJECTION), true, 'a bare string message is classified too');
  // And it still refuses to claim ordinary failures are plan problems.
  assert.equal(exceedsPlanTimeoutLimit(new Error('browserless is unavailable')), false);
  assert.equal(exceedsPlanTimeoutLimit(new Error('Target page, context or browser has been closed')), false);
  assert.equal(exceedsPlanTimeoutLimit(new Error('timeout of 30000ms exceeded')), false);
});

test('planTimeoutLimitMs() reads the plan ceiling out of Browserless’s own message — 120000 is never hardcoded as universal', () => {
  assert.equal(planTimeoutLimitMs(new Error(PLAN_REJECTION)), 120000);
  // A different plan reports a different ceiling, and the code follows it.
  assert.equal(
    planTimeoutLimitMs(new Error("The 'timeout' value must be a whole number of milliseconds between 1 and 900,000 (your plan's maximum session time).")),
    900000
  );
  // Unparseable -> null, which makes the caller omit the field entirely.
  assert.equal(planTimeoutLimitMs(new Error('exceeds the maximum allowed limit')), null);
  assert.equal(planTimeoutLimitMs(null), null);
});

/* ================================================================== *
 * A-E) createHumanLiveURL's bounded fallback.                         *
 * ================================================================== */

test('A+B+C+D) the plan rejection triggers EXACTLY ONE fallback, which succeeds and returns the fallback URL', async () => {
  const { page, events } = makePage();

  const result = await createHumanLiveURL(page, REQUESTED_MS);

  // A) the first attempt asked for exactly what production asked for
  assert.equal(events.sends[0].timeout, REQUESTED_MS);
  // B) exactly two sends: the rejected one and one fallback. No loop.
  assert.equal(events.sends.length, 2, 'exactly one fallback attempt');
  // The fallback used the plan's own reported maximum.
  assert.equal(events.sends[1].timeout, 120000);
  // D) the caller gets the fallback's result.
  assert.equal(result.liveURL, 'https://production-sfo.browserless.io/live/view-1');
  assert.equal(result.liveURLId, 'handle-1');
  // C) no browser, context or page was created to recover.
  assert.equal(events.newPageCalls, 0);
  assert.equal(events.newContextCalls, 0);
  assert.equal(events.newCDPSessions, 1, 'the retry reuses the same CDP session on the same page');
  assert.equal(events.detaches, 1, 'the CDP session is still detached exactly once');
  // Interactivity is preserved on the fallback attempt — the human must still
  // be able to solve the challenge themselves.
  assert.equal(events.sends[1].interactable, true);
});

test('A2) the same fallback happens when Browserless THROWS the rejection instead of returning an { error } payload', async () => {
  const { page, events } = makePage({ rejectVia: 'throw' });

  const result = await createHumanLiveURL(page, REQUESTED_MS);

  assert.equal(events.sends.length, 2);
  assert.equal(events.sends[1].timeout, 120000);
  assert.match(result.liveURL, /\/live\/view-1$/);
});

test('B2) a plan whose message carries no parseable ceiling falls back to OMITTING the timeout field entirely', async () => {
  const { page, events } = makePage();
  // Reject the first attempt with the other documented plan wording, which
  // states no number at all.
  const cdpPage = {
    ...page,
    context: () => ({
      newCDPSession: async () => ({
        send: async (_m, params) => {
          events.sends.push(params);
          if (params.timeout !== undefined) return { error: 'Reconnect timeout (900000ms) exceeds the maximum allowed limit' };
          return { liveURL: 'https://production-sfo.browserless.io/live/view-default', liveURLId: 'handle-default' };
        },
        detach: async () => {},
      }),
    }),
  };

  const result = await createHumanLiveURL(cdpPage, REQUESTED_MS);

  assert.equal(events.sends.length, 2);
  assert.equal('timeout' in events.sends[1], false, 'the field is omitted so Browserless applies its own default');
  assert.equal(result.liveURL, 'https://production-sfo.browserless.io/live/view-default');
});

test('E) an ordinary (non-plan) failure never retries — it fails closed on the first attempt', async () => {
  const events = { sends: [], detaches: 0 };
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (_m, params) => {
          events.sends.push(params);
          return { error: 'browserless is unavailable' };
        },
        detach: async () => {
          events.detaches += 1;
        },
      }),
    }),
  };

  await assert.rejects(() => createHumanLiveURL(page, REQUESTED_MS), /browserless is unavailable/);
  assert.equal(events.sends.length, 1, 'no retry for a failure that is not a plan-timeout rejection');
  assert.equal(events.detaches, 1);
});

test('E2) a fallback that itself fails is not retried again — bounded at one, then fail closed', async () => {
  const { page, events } = makePage({ failFallback: true });

  await assert.rejects(() => createHumanLiveURL(page, REQUESTED_MS), /browserless is unavailable/);
  assert.equal(events.sends.length, 2, 'the rejected attempt plus exactly one fallback, then stop');
  assert.equal(events.detaches, 1);
});

/* ================================================================== *
 * F+G) The two real callers both recover.                             *
 * ================================================================== */

test('F) visualWatch reaches generation 1 through the fallback — the exact production failure is gone', async () => {
  const { page, events } = makePage();
  const watch = createVisualWatch(true);

  // The exact call the orchestrator makes for TAS_MAP's first page, with the
  // production 15-minute TTL.
  await attachVisualWatch(watch, page, { jobId: 'aaf11509', source: 'TAS_MAP', reason: 'source_page', timeoutMs: REQUESTED_MS });

  assert.equal(watch.generation, 1, 'production saw generation=0 / visual_watch_unavailable here');
  assert.equal(watch.live.liveURL, 'https://production-sfo.browserless.io/live/view-1');
  assert.equal(watch.watchedPage, page, 'still the exact worker page — no replacement');
  assert.equal(watch.error, null);
  assert.equal(events.newPageCalls, 0);
  assert.equal(events.newContextCalls, 0);
});

test('G) the WAITING_HUMAN CAPTCHA path gets identical plan-safe behaviour on the same preserved page', async () => {
  const { page, events } = makePage();

  const opened = await openHumanLiveSession(page, null, { jobId: 'aaf11509', source: 'mygov', timeoutMs: REQUESTED_MS });

  assert.equal(opened.error, null);
  assert.equal(opened.session.liveURL, 'https://production-sfo.browserless.io/live/view-1');
  assert.equal(events.sends.length, 2, 'one rejection, one fallback — same policy as the watch path');
  assert.equal(events.newPageCalls, 0, 'the human’s page is never replaced');
  assert.equal(events.newContextCalls, 0);
});

test('G2) both callers still fail SAFELY (research continues, no evidence impact) when the fallback cannot help', async () => {
  const { page } = makePage({ failFallback: true });
  const watch = createVisualWatch(true);

  await attachVisualWatch(watch, page, { jobId: 'aaf11509', source: 'TAS_MAP', reason: 'source_page', timeoutMs: REQUESTED_MS });
  assert.equal(watch.live, null);
  assert.equal(watch.error, 'live_view_unavailable');
  assert.equal(watch.generation, 0);

  const opened = await openHumanLiveSession(page, null, { jobId: 'aaf11509', source: 'mygov', timeoutMs: REQUESTED_MS });
  assert.deepEqual(opened, { session: null, error: 'live_view_unavailable' });
});

/* ================================================================== *
 * H) No secret / URL logging regression.                              *
 * ================================================================== */

test('H) the plan-fallback log line carries only numbers — never the liveURL, liveURLId, token or CDP URL', async (t) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
  });

  const { page } = makePage();
  await createHumanLiveURL(page, REQUESTED_MS);

  console.log = originalLog;

  const fallbackLines = lines.filter((l) => l.includes('live_url_timeout_rejected_by_plan'));
  assert.equal(fallbackLines.length, 1, 'the plan fallback is visible in production logs');
  const entry = JSON.parse(fallbackLines[0]);
  assert.equal(entry.scope, 'browserless_lifecycle');
  assert.equal(entry.requestedMs, REQUESTED_MS);
  assert.equal(entry.fallbackMs, 120000);
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'event', 'fallbackMs', 'requestedMs', 'scope']);

  const allLogs = lines.join('\n');
  assert.equal(/browserless\.io\/live\/|liveURLId|handle-1|wss:\/\/|token/i.test(allLogs), false, 'no URL, handle or credential may be logged');
});
