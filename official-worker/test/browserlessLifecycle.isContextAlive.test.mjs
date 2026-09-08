import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isContextAlive,
  exceedsPlanTimeoutLimit,
  researchContext,
  BrowserDisconnectedError,
} from '../.tstest-build/browser/BrowserlessRuntime.js';

// These tests exercise isContextAlive()'s three independent liveness checks
// in isolation (mandate: "A cached object reference does NOT prove that the
// remote BrowserContext is alive" — prove each failure mode separately, do
// not stop at correlation).

test('isContextAlive: no cached context at all is not alive', async () => {
  const browser = { isConnected: () => true, contexts: () => [] };
  assert.equal(await isContextAlive(browser, null), false);
  assert.equal(await isContextAlive(browser, undefined), false);
});

test('isContextAlive: a disconnected browser fails the FIRST check, before ever touching the context', async () => {
  let pagesCalled = false;
  const ctx = { pages: () => { pagesCalled = true; return []; } };
  const browser = {
    isConnected: () => false, // the whole CDP connection is gone
    contexts: () => [ctx],
  };
  assert.equal(await isContextAlive(browser, ctx), false);
  // Proves the check is ordered cheapest-first and short-circuits: a fully
  // dead browser must never require a round-trip against the context to be
  // detected.
  assert.equal(pagesCalled, false);
});

test('isContextAlive: a context missing from browser.contexts() fails the SECOND check', async () => {
  const ctx = { pages: () => [] };
  const otherCtx = { pages: () => [] };
  const browser = {
    isConnected: () => true,
    contexts: () => [otherCtx], // our cached ctx was torn down/replaced
  };
  assert.equal(await isContextAlive(browser, ctx), false);
});

test('isContextAlive: ctx.pages() throwing (a dead round-trip) fails the THIRD check even though the browser is connected and the context object is still cached', async () => {
  const ctx = {
    pages: () => {
      throw new Error('Protocol error: Target closed');
    },
  };
  const browser = {
    isConnected: () => true,
    contexts: () => [ctx],
  };
  assert.equal(await isContextAlive(browser, ctx), false);
});

test('isContextAlive: a live context reporting ZERO open pages is alive — pages().length === 0 must never be read as death', async () => {
  const ctx = { pages: () => [] };
  const browser = {
    isConnected: () => true,
    contexts: () => [ctx],
  };
  assert.equal(await isContextAlive(browser, ctx), true);
});

test('isContextAlive: a live context with open pages is alive', async () => {
  const ctx = { pages: () => [{ id: 1 }, { id: 2 }] };
  const browser = {
    isConnected: () => true,
    contexts: () => [ctx],
  };
  assert.equal(await isContextAlive(browser, ctx), true);
});

test('isContextAlive: tolerates a browser with no isConnected() method (treated as connected, matching researchContext()\'s own fallback)', async () => {
  const ctx = { pages: () => [] };
  const browser = {
    contexts: () => [ctx],
  };
  assert.equal(await isContextAlive(browser, ctx), true);
});

// exceedsPlanTimeoutLimit(): must match Browserless's own documented wording
// narrowly, so a genuine outage/network error still fails closed instead of
// silently retrying forever under the wrong branch.

test('exceedsPlanTimeoutLimit: matches Browserless\'s documented plan-cap rejection message', () => {
  const e = new Error('Reconnect timeout (600000ms) exceeds the maximum allowed limit (900000ms)');
  assert.equal(exceedsPlanTimeoutLimit(e), true);
});

test('exceedsPlanTimeoutLimit: does not match an unrelated connection error (must fail closed, not silently retry as a plan-cap case)', () => {
  const e = new Error('getaddrinfo ENOTFOUND chrome.browserless.io');
  assert.equal(exceedsPlanTimeoutLimit(e), false);
});

test('exceedsPlanTimeoutLimit: does not match a generic timeout error that is not the plan-cap wording', () => {
  const e = new Error('Timeout 30000ms exceeded while connecting');
  assert.equal(exceedsPlanTimeoutLimit(e), false);
});

test('exceedsPlanTimeoutLimit: handles non-Error thrown values without throwing itself', () => {
  assert.equal(exceedsPlanTimeoutLimit('exceeds the maximum allowed limit'), true);
  assert.equal(exceedsPlanTimeoutLimit(undefined), false);
  assert.equal(exceedsPlanTimeoutLimit(null), false);
  assert.equal(exceedsPlanTimeoutLimit({ weird: 'object' }), false);
});

// researchContext() end-to-end: a cached context that DIES between two
// sources must be invalidated and replaced exactly once — this is the exact
// TAS_MAP -> TAS boundary from the production incident (job
// 61496cf0-36de-4da9-acf7-7e2a75728043), reproduced with a context that is
// live on call 1 and reports itself as torn down by call 2.

test('researchContext: TAS_MAP -> TAS boundary — a context that dies between sources is invalidated and replaced exactly once, never silently reused', async () => {
  const deadCtx = { name: 'tas_map_context', pages: () => [] };
  const freshCtx = { name: 'tas_context', pages: () => [] };
  let newContextCalls = 0;
  let contextIsDead = false; // flips to simulate Browserless tearing down the context after TAS_MAP finishes

  const browser = {
    __homatchBrowserless: true,
    isConnected: () => true,
    // Once the fresh context is created it persists (a real recovered
    // Browserless context does not spontaneously vanish again); before that,
    // it's either the original context or, once it dies, nothing.
    contexts: () => (newContextCalls > 0 ? [freshCtx] : contextIsDead ? [] : [deadCtx]),
    newContext: async () => {
      newContextCalls++;
      return freshCtx;
    },
  };

  // Source #1 (TAS_MAP): adopts the existing context.
  const forTasMap = await researchContext(browser);
  assert.equal(forTasMap, deadCtx);
  assert.equal(newContextCalls, 0);

  // Between sources, the remote context dies (this is the exact production
  // failure mode: `browserContext.newPage: Target page, context or browser
  // has been closed`).
  contextIsDead = true;

  // Source #2 (TAS): must detect the death, invalidate the cache, and
  // recover with a fresh context — not throw, and not silently keep
  // returning the dead reference.
  const forTas = await researchContext(browser);
  assert.equal(forTas, freshCtx);
  assert.equal(newContextCalls, 1);
  assert.equal(browser.__homatchResearchContext, freshCtx);

  // Source #3 (mygov): must reuse the now-live fresh context, not create yet
  // another one.
  const forMygov = await researchContext(browser);
  assert.equal(forMygov, freshCtx);
  assert.equal(newContextCalls, 1);
});

test('researchContext: a dead cached context with a fully disconnected browser throws BrowserDisconnectedError instead of silently creating a new context', async () => {
  const deadCtx = { pages: () => [] };
  const browser = {
    __homatchBrowserless: true,
    isConnected: () => false, // the CDP connection itself is gone, not just the context
    contexts: () => [deadCtx],
    newContext: async () => {
      throw new Error('newContext must never be attempted once the browser itself is confirmed dead');
    },
  };
  browser.__homatchResearchContext = deadCtx;

  await assert.rejects(() => researchContext(browser), BrowserDisconnectedError);
});

test('researchContext: a live cached context is returned without ever calling newContext', async () => {
  const ctx = { pages: () => [] };
  let newContextCalls = 0;
  const browser = {
    __homatchBrowserless: true,
    isConnected: () => true,
    contexts: () => [ctx],
    newContext: async () => {
      newContextCalls++;
      return ctx;
    },
  };
  browser.__homatchResearchContext = ctx;

  const result = await researchContext(browser);
  assert.equal(result, ctx);
  assert.equal(newContextCalls, 0);
});
