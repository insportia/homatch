import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserDisconnectedError, researchContext } from '../.tstest-build/browser/BrowserlessRuntime.js';
import {
  decideBrowserlessReconnect,
  MAX_BROWSERLESS_RECONNECTS_PER_SOURCE_ATTEMPT,
} from '../.tstest-build/browser/BrowserlessRecovery.js';

/*
 * P0 REGRESSION SUITE — job 4d2ec4ba-e0ca-49f8-b7a1-cf1e37e23d44.
 *
 * Production evidence: Browserless sessions were expiring roughly every two
 * minutes. TAS_MAP ran on session A; TAS found A dead, reconnected to B
 * (browser_disconnected_reconnecting attempt=1) and completed; session B then
 * died too, and MyGov/ENREG/RSTAX/DEBTOR were REFUSED a reconnect because the
 * recovery budget was counted once per JOB. All four returned
 * "BrowserDisconnectedError: Browserless browser connection is no longer
 * alive" as a technical failure.
 *
 * The budget is now per INDEPENDENT SOURCE ATTEMPT. decideBrowserlessReconnect()
 * below is NOT a copy: it is the real production policy, imported from
 * src/browser/BrowserlessRecovery.ts, and researchContext() is the real
 * production context/liveness code. Only buildTechnicalFailureResult() (whose
 * home, ResearchOrchestrator.ts, is deliberately excluded from
 * tsconfig.test.json because of its transitive DOM-lib imports) and the shape
 * of runStep()'s page-acquisition block remain verbatim mirrors, kept in sync
 * by hand per the repo's existing convention.
 */

function now() {
  return new Date().toISOString();
}

// Verbatim mirror of ResearchOrchestrator.ts's module-scope
// buildTechnicalFailureResult().
function buildTechnicalFailureResult(key, forEntity, e) {
  return {
    source: key,
    sourceName: key,
    sourceClass: 'OFFICIAL_GOVERNMENT',
    sourceUrl: '',
    startUrl: '',
    finalUrl: null,
    frameUrls: [],
    searchControlUsed: null,
    queryEntered: null,
    submitAction: null,
    resultContext: null,
    resultConfirmed: false,
    noResultConfirmed: false,
    resultValidated: false,
    status: 'FAILED',
    traversal: null,
    retrievedAt: now(),
    documents: [],
    discoveredEntities: [],
    forEntity,
    error: String(e),
  };
}

/* ------------------------------------------------------------------ *
 * Fakes: a Browserless-shaped browser whose session can be expired on *
 * demand, exactly as Browserless's own timeout teardown does.         *
 * ------------------------------------------------------------------ */

function makeBrowserlessSession(label) {
  let connected = true;
  const pages = [];
  const ctx = {
    label,
    pages: () => {
      if (!connected) throw new Error('Protocol error: Target closed');
      return pages;
    },
    newPage: async () => {
      if (!connected) throw new Error('browserContext.newPage: Target page, context or browser has been closed');
      const page = { label, index: pages.length + 1, close: async () => {} };
      pages.push(page);
      return page;
    },
  };
  return {
    label,
    ctx,
    __homatchBrowserless: true,
    isConnected: () => connected,
    contexts: () => (connected ? [ctx] : []),
    newContext: async () => {
      if (!connected) throw new Error('browser.newContext: Target closed');
      return ctx;
    },
    /** Models a Browserless session hitting its lifetime deadline. */
    expireSession: () => {
      connected = false;
    },
  };
}

/**
 * Verbatim-shaped mirror of ResearchOrchestrator.runStep()'s page-acquisition
 * try/catch — the same call order, the same real researchContext(), the same
 * real decideBrowserlessReconnect(), the same single retry — driving the fake
 * sessions above. `world` carries the mutable browser reference the way
 * runStep()/run() hand a possibly-relaunched browser forward.
 */
async function acquirePageForSource(world, sourceKey) {
  let sharedBrowserlessContext = !!world.browser.__homatchBrowserless;
  let reconnectsUsedForThisSourceAttempt = 0;

  const acquirePage = async () => {
    const c = await researchContext(world.browser);
    const p = await c.newPage();
    return { c, p };
  };

  try {
    const acquired = await acquirePage();
    return { ok: true, ctx: acquired.c, page: acquired.p };
  } catch (e) {
    const decision = decideBrowserlessReconnect(sharedBrowserlessContext, e, reconnectsUsedForThisSourceAttempt);
    if (decision.shouldReconnect) {
      reconnectsUsedForThisSourceAttempt = decision.attempt;
      world.log.push({ event: 'browser_disconnected_reconnecting', source: sourceKey, attempt: decision.attempt });
      try {
        world.browser = world.launch();
        sharedBrowserlessContext = !!world.browser.__homatchBrowserless;
        const acquired = await acquirePage();
        return { ok: true, ctx: acquired.c, page: acquired.p };
      } catch (e2) {
        world.log.push({ event: 'browser_reconnect_failed', source: sourceKey });
        return { ok: false, result: buildTechnicalFailureResult(sourceKey, null, e2) };
      }
    }
    world.log.push({ event: 'page_acquisition_failed', source: sourceKey });
    return { ok: false, result: buildTechnicalFailureResult(sourceKey, null, e) };
  }
}

function makeWorld(sessionFactory = makeBrowserlessSession) {
  const launched = [];
  const world = {
    log: [],
    launched,
    launch: () => {
      const s = sessionFactory(String.fromCharCode(65 + launched.length)); // A, B, C, ...
      launched.push(s);
      return s;
    },
  };
  world.browser = world.launch();
  return world;
}

/* ------------------------------------------------------------------ *
 * A) A source can reconnect after its browser dies.                   *
 * ------------------------------------------------------------------ */

test('A) TAS_MAP runs on session A; when A has expired, TAS gets one reconnect to a fresh session B and acquires its page', async () => {
  const world = makeWorld();

  const tasMap = await acquirePageForSource(world, 'TAS_MAP');
  assert.equal(tasMap.ok, true);
  assert.equal(tasMap.page.label, 'A');

  world.browser.expireSession(); // Browserless kills session A between sources

  const tas = await acquirePageForSource(world, 'tas');
  assert.equal(tas.ok, true, 'TAS must recover, not fail technically');
  assert.equal(tas.page.label, 'B', 'TAS must run on the fresh session B');
  assert.equal(world.browser.label, 'B', 'the relaunched browser must be handed forward to later steps');
  assert.deepEqual(
    world.log.filter((l) => l.event === 'browser_disconnected_reconnecting'),
    [{ event: 'browser_disconnected_reconnecting', source: 'tas', attempt: 1 }]
  );
});

/* ------------------------------------------------------------------ *
 * B) A LATER, INDEPENDENT source can ALSO reconnect. This is the      *
 *    exact production regression.                                     *
 * ------------------------------------------------------------------ */

test('B) after TAS already used a reconnect, MyGov can STILL reconnect when session B independently expires (the exact job 4d2ec4ba regression)', async () => {
  const world = makeWorld();

  assert.equal((await acquirePageForSource(world, 'TAS_MAP')).page.label, 'A');

  world.browser.expireSession();
  const tas = await acquirePageForSource(world, 'tas');
  assert.equal(tas.page.label, 'B');

  world.browser.expireSession(); // session B dies too — a SEPARATE expiration
  const mygov = await acquirePageForSource(world, 'mygov');

  assert.equal(mygov.ok, true, 'MyGov must not inherit TAS’s exhausted budget');
  assert.equal(mygov.page.label, 'C', 'MyGov must run on a fresh session C');
  assert.deepEqual(
    world.log.filter((l) => l.event === 'browser_disconnected_reconnecting').map((l) => `${l.source}#${l.attempt}`),
    ['tas#1', 'mygov#1'],
    'each source attempt gets its own attempt=1, independently'
  );
  assert.equal(
    world.log.some((l) => l.event === 'page_acquisition_failed'),
    false,
    'no source may be refused recovery merely because an earlier one recovered'
  );
});

test('B2) ENREG, RSTAX and DEBTOR each reuse a healthy session, and each recovers independently from its own separate expiration', async () => {
  const world = makeWorld();

  // Healthy session is REUSED, never replaced, across consecutive sources.
  const enreg = await acquirePageForSource(world, 'enreg');
  const rstax = await acquirePageForSource(world, 'rstax');
  assert.equal(enreg.ok && rstax.ok, true);
  assert.equal(enreg.ctx, rstax.ctx, 'a healthy context must be reused, preserving cookies/session');
  assert.equal(world.launched.length, 1, 'no reconnect may happen while the session is alive');

  // Now a separate expiration before the third source.
  world.browser.expireSession();
  const debtor = await acquirePageForSource(world, 'debtor');
  assert.equal(debtor.ok, true);
  assert.equal(debtor.page.label, 'B');
  assert.equal(world.launched.length, 2);
});

/* ------------------------------------------------------------------ *
 * C) Recovery stays bounded — one reconnect per source attempt.       *
 * ------------------------------------------------------------------ */

test('C) a single source attempt reconnects at most ONCE: if the fresh session is also dead it fails technically instead of looping', async () => {
  // Every session this world launches is born already expired — the shape
  // that would spin forever under an unbounded policy.
  const world = makeWorld((label) => {
    const s = makeBrowserlessSession(label);
    s.expireSession();
    return s;
  });

  const mygov = await acquirePageForSource(world, 'mygov');

  assert.equal(mygov.ok, false);
  assert.equal(mygov.result.status, 'FAILED');
  assert.equal(
    world.log.filter((l) => l.event === 'browser_disconnected_reconnecting').length,
    MAX_BROWSERLESS_RECONNECTS_PER_SOURCE_ATTEMPT,
    'exactly one recovery attempt for this source attempt — never a retry of the retry'
  );
  assert.equal(world.launched.length, 2, 'the initial session plus exactly one replacement');
  assert.equal(world.log.filter((l) => l.event === 'browser_reconnect_failed').length, 1);
});

test('C2) decideBrowserlessReconnect: the budget is spent after one use WITHIN a source attempt, and is not incremented by a refusal', () => {
  const first = decideBrowserlessReconnect(true, new BrowserDisconnectedError('gone'), 0);
  assert.deepEqual(first, { shouldReconnect: true, attempt: 1 });

  const second = decideBrowserlessReconnect(true, new BrowserDisconnectedError('gone again'), first.attempt);
  assert.equal(second.shouldReconnect, false);
  assert.equal(second.attempt, 1, 'a refused decision must not be logged as a spent attempt');
});

test('C3) decideBrowserlessReconnect: a non-BrowserDisconnectedError never triggers or consumes recovery (a selector timeout is not a dead browser)', () => {
  const decision = decideBrowserlessReconnect(true, new Error('selector not found'), 0);
  assert.deepEqual(decision, { shouldReconnect: false, attempt: 0 });
});

test('C4) decideBrowserlessReconnect: local (non-Browserless) mode is never silently swapped for a different browser', () => {
  const decision = decideBrowserlessReconnect(false, new BrowserDisconnectedError('gone'), 0);
  assert.equal(decision.shouldReconnect, false);
});

/* ------------------------------------------------------------------ *
 * D) WAITING_HUMAN preserves the exact browser/context/page.          *
 * ------------------------------------------------------------------ */

test('D) WAITING_HUMAN preserves the EXACT browser, context and page, and a healthy paused session is never replaced or re-derived', async () => {
  const world = makeWorld();

  const acquired = await acquirePageForSource(world, 'mygov');
  assert.equal(acquired.ok, true);

  // runStep()'s WAITING_HUMAN branch: the session is stored by reference and
  // the page is NOT closed.
  const session = { browser: world.browser, ctx: acquired.ctx, page: acquired.page };

  // While paused, the session stays healthy. researchContext() must hand back
  // the identical context object — a CAPTCHA solved in this context must
  // never be stranded in a replaced one.
  const reDerived = await researchContext(session.browser);
  assert.equal(reDerived, session.ctx, 'the exact BrowserContext must be preserved');
  assert.equal(session.browser.__homatchResearchContext, session.ctx, 'the cached context must not be invalidated while alive');
  assert.equal(session.browser.label, 'A');
  assert.equal(world.launched.length, 1, 'a healthy paused human session must never trigger a relaunch');

  // resume() continues on session.page directly — same object, same session,
  // still open (no CAPTCHA solver, no bypass: only the human's own state).
  assert.equal(session.page.label, 'A');
  assert.equal(session.ctx.pages().includes(session.page), true, 'the human’s page must still be open on resume');
  assert.equal(
    world.log.some((l) => l.event === 'browser_disconnected_reconnecting'),
    false
  );
});

test('D2) a genuinely expired human session is reported as unavailable, never silently continued on a different browser', async () => {
  const world = makeWorld();
  const acquired = await acquirePageForSource(world, 'mygov');
  const session = { browser: world.browser, ctx: acquired.ctx, page: acquired.page };

  session.browser.expireSession(); // the preserved session really did expire

  // resume() never re-derives a context; the preserved reference is simply
  // dead, and the existing technical unavailable/skip policy applies. What
  // must NOT happen is a different browser quietly taking its place.
  await assert.rejects(() => researchContext(session.browser), BrowserDisconnectedError);
  assert.equal(world.launched.length, 1, 'no replacement session may be launched behind a human session');
});

/* ------------------------------------------------------------------ *
 * E) A Browserless failure stays TECHNICAL, never negative evidence.  *
 * ------------------------------------------------------------------ */

test('E) a BrowserDisconnectedError becomes a source-level TECHNICAL failure carrying no finding about the property', () => {
  const result = buildTechnicalFailureResult(
    'debtor',
    { name: 'John Doe', idCode: '01008000000' },
    new BrowserDisconnectedError('Browserless browser connection is no longer alive')
  );

  assert.equal(result.source, 'debtor');
  assert.equal(result.status, 'FAILED');
  // NO EVIDENCE = NO FACT: neither a confirmed finding NOR a confirmed absence.
  assert.equal(result.resultConfirmed, false);
  assert.equal(result.noResultConfirmed, false);
  assert.equal(result.resultValidated, false);
  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.discoveredEntities, []);
  assert.equal('propertyRisk' in result, false);
  assert.equal('verdict' in result, false);
  assert.match(result.error, /no longer alive/);
});

test('E2) a whole-job crash is never the outcome: the failing source yields a result object while other sources keep theirs', async () => {
  const world = makeWorld((label) => {
    const s = makeBrowserlessSession(label);
    if (label !== 'A') s.expireSession(); // every REPLACEMENT session is dead
    return s;
  });

  const jobResults = [];
  const tasMap = await acquirePageForSource(world, 'TAS_MAP');
  assert.equal(tasMap.ok, true);
  jobResults.push({ source: 'TAS_MAP', status: 'COMPLETE', resultConfirmed: true });

  world.browser.expireSession();
  const mygov = await acquirePageForSource(world, 'mygov');
  assert.equal(mygov.ok, false);
  jobResults.push(mygov.result);

  assert.equal(jobResults.length, 2);
  assert.equal(jobResults[0].resultConfirmed, true, 'an earlier source’s real evidence must survive');
  assert.equal(jobResults[1].status, 'FAILED');
  assert.equal(jobResults[1].noResultConfirmed, false);
});

test('E3) buildTechnicalFailureResult: works with forEntity = null (cadastral job-query steps, not per-entity steps)', () => {
  const result = buildTechnicalFailureResult('TAS_MAP', null, new Error('context dead'));
  assert.equal(result.forEntity, null);
  assert.equal(result.status, 'FAILED');
});
