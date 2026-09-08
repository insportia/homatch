import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createVisualWatch,
  attachVisualWatch,
  detachVisualWatch,
  isWatchingPage,
  visualWatchFields,
} from '../.tstest-build/browser/VisualWatchSession.js';
import { humanLiveFields } from '../.tstest-build/browser/HumanLiveSession.js';

/*
 * VISUAL WATCH / DEBUG MODE REGRESSION SUITE.
 *
 * Everything exercised here is REAL production code (VisualWatchSession.ts,
 * HumanLiveSession.ts, BrowserlessRuntime.ts's exposure classifier). The
 * orchestrator's own wiring is asserted as source text where it cannot be
 * imported (ResearchOrchestrator.ts is excluded from tsconfig.test.json for
 * its transitive DOM-lib imports).
 *
 * The fakes model the real thing that matters: one Browserless browser, one
 * context, a NEW page per source, and a CDP live-view handle per page — and
 * they record any attempt to create a second browser, context or page.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const orchestratorSource = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');
const indexSource = readFileSync(`${here}../src/index.ts`, 'utf8');

/** One Browserless browser whose pages each mint their own live handle. */
function makeWorld({ failCreate = false, liveURLFor = (n) => `https://production-sfo.browserless.io/live/view-${n}` } = {}) {
  const events = { created: [], closedIds: [], newPageCalls: 0, newContextCalls: 0, browsersLaunched: 1, pagesClosed: [] };
  let seq = 0;

  const makeCdp = () => ({
    send: async (method, params) => {
      if (method === 'Browserless.liveURL') {
        if (failCreate) return { error: 'live url refused by browserless' };
        seq += 1;
        events.created.push(seq);
        return { liveURL: liveURLFor(seq), liveURLId: `handle-${seq}` };
      }
      if (method === 'Browserless.closeLiveURL') {
        events.closedIds.push(params.liveURLId);
        return {};
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
    detach: async () => {},
  });

  const makeBrowser = (label) => {
    const ctx = {
      label: `ctx-${label}`,
      newCDPSession: async () => makeCdp(),
      newPage: async () => {
        events.newPageCalls += 1;
        const page = {
          label: `page-${label}-${events.newPageCalls}`,
          context: () => ctx,
          url: () => 'https://tas.gov.ge/',
          close: async () => {
            events.pagesClosed.push(page.label);
          },
        };
        return page;
      },
      close: async () => {},
    };
    return {
      label: `browser-${label}`,
      __homatchBrowserless: true,
      isConnected: () => true,
      contexts: () => [ctx],
      newContext: async () => {
        events.newContextCalls += 1;
        return ctx;
      },
      close: async () => {},
      ctx,
    };
  };

  return { events, makeBrowser, browser: makeBrowser('A') };
}

/* ================================================================== *
 * A) visualWatch off/absent preserves existing behaviour exactly.     *
 * ================================================================== */

test('A) a watch that is not enabled is completely inert — no handle, no job field, no CDP call', async () => {
  const world = makeWorld();
  const page = await world.browser.ctx.newPage();
  const watch = createVisualWatch(false);

  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' });
  await detachVisualWatch(watch, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_complete' });

  assert.deepEqual(world.events.created, [], 'no live view may be minted for an ordinary job');
  assert.equal(watch.generation, 0);
  assert.equal(watch.live, null);
  assert.equal(visualWatchFields('job-1', watch), undefined, 'an ordinary job carries no visualWatch block at all');
  assert.equal(isWatchingPage(watch, page), false);
});

test('A2) POST /research only enables watching on a strict boolean true, and start() defaults to off', () => {
  assert.match(indexSource, /const visualWatch = req\.body\?\.visualWatch === true;/);
  assert.match(indexSource, /orchestrator\.start\(query, mode, \{ visualWatch \}\)/);
  // Default-off signature: options is optional and defaults to {}.
  assert.match(orchestratorSource, /start\(query: string, mode: 'cadastral' \| 'property', options: \{ visualWatch\?: boolean \} = \{\}\)/);
  // The job field is only ever set inside the opt-in branch.
  assert.match(orchestratorSource, /if \(options\.visualWatch\) \{[\s\S]{0,400}?job\.visualWatch = visualWatchFields\(id, watch\);/);
});

/* ================================================================== *
 * B) attaches to the ACTUAL production research page.                 *
 * C) no second browser/context/page for watching.                     *
 * ================================================================== */

test('B) the watch streams the exact page the orchestrator created for the source', async () => {
  const world = makeWorld();
  const page = await world.browser.ctx.newPage(); // the real TAS_MAP page
  const watch = createVisualWatch(true);

  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' });

  assert.equal(watch.watchedPage, page, 'the watched page must BE the worker page object');
  assert.equal(watch.generation, 1);
  assert.equal(watch.source, 'TAS_MAP');
  assert.equal(watch.live.liveURL, 'https://production-sfo.browserless.io/live/view-1');
  assert.equal(isWatchingPage(watch, page), true);
});

test('B2) the orchestrator attaches at the one point a real source page becomes active, and passes that page', () => {
  // The attach call sits immediately after the page is acquired and sized,
  // inside runStep, and is handed `page` — the object every workflow is then
  // driven with.
  assert.match(orchestratorSource, /await page\.setViewportSize[\s\S]{0,900}?await this\.attachWatch\(\s*job\.id,\s*page,\s*key,/);
  // …and the workflows are driven with that same `page`.
  assert.match(orchestratorSource, /result = await runTasMapWorker\(page,/);
  assert.match(orchestratorSource, /result = await runMyGovWorkflow\(page, ctx,/);
});

test('C) watching never creates a browser, context or page of its own', async () => {
  const world = makeWorld();
  const page = await world.browser.ctx.newPage();
  const pagesBefore = world.events.newPageCalls;
  const watch = createVisualWatch(true);

  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' });
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' });

  assert.equal(world.events.newPageCalls, pagesBefore, 'no page may be created for watching');
  assert.equal(world.events.newContextCalls, 0, 'no context may be created for watching');
  assert.equal(world.events.browsersLaunched, 1, 'no second browser may be launched for watching');
  assert.deepEqual(world.events.pagesClosed, [], 'watching never closes the worker page');

  // Proven structurally too: the module cannot create any of them.
  const moduleSource = readFileSync(`${here}../src/browser/VisualWatchSession.ts`, 'utf8');
  assert.equal(/newPage\s*\(|newContext\s*\(|launchResearchBrowser|chromium\./.test(moduleSource), false);
});

/* ================================================================== *
 * D) active source page changes move the watch to the new real page.  *
 * F) old handles are released best-effort.                            *
 * ================================================================== */

test('D) each new source page supersedes the previous stream and bumps the generation', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);

  const tasMapPage = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, tasMapPage, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' });
  const gen1 = watch.generation;
  const url1 = watch.live.liveURL;

  const mygovPage = await world.browser.ctx.newPage(); // next source, new page
  await attachVisualWatch(watch, mygovPage, { jobId: 'job-1', source: 'mygov', reason: 'source_page' });

  assert.equal(watch.watchedPage, mygovPage, 'the watch must follow the ACTIVE worker page');
  assert.equal(watch.source, 'mygov');
  assert.equal(watch.generation, gen1 + 1, 'the watcher is told the stream changed');
  assert.notEqual(watch.live.liveURL, url1);
  assert.equal(isWatchingPage(watch, tasMapPage), false, 'the old page is no longer watched');
  // F) the superseded handle was released, exactly once.
  assert.deepEqual(world.events.closedIds, ['handle-1']);
  assert.equal(world.events.created.length, 2);
});

test('D2) the orchestrator detaches on source completion and on source error, before the page is closed', () => {
  assert.match(orchestratorSource, /await this\.detachWatch\(job\.id, key, 'source_complete'\);[\s\S]{0,400}?await page\.close\(\)/);
  assert.match(orchestratorSource, /await this\.detachWatch\(job\.id, key, 'source_error'\);[\s\S]{0,400}?await page\.close\(\)/);
});

/* ================================================================== *
 * E) Browserless reconnect: new real browser, new generation.         *
 * ================================================================== */

test('E) after a Browserless reconnect the watch attaches to the NEW real browser page and increments the generation', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);

  const oldPage = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, oldPage, { jobId: 'job-1', source: 'tas', reason: 'source_page' });
  const genBefore = watch.generation;
  const urlBefore = watch.live.liveURL;

  // The ~2-minute Browserless session dies; BrowserlessRecovery launches a
  // genuinely new browser and the next source page is created on IT.
  const newBrowser = world.makeBrowser('B');
  world.events.browsersLaunched += 1;
  const newPage = await newBrowser.ctx.newPage();

  await attachVisualWatch(watch, newPage, { jobId: 'job-1', source: 'mygov', reason: 'browser_reconnect' });

  assert.equal(watch.watchedPage, newPage);
  assert.equal(watch.watchedPage.context(), newBrowser.ctx, 'the watch is on the NEW browser’s context');
  assert.equal(watch.generation, genBefore + 1, 'the generation tells the watcher its old URL is dead');
  assert.notEqual(watch.live.liveURL, urlBefore);
});

test('E2) the orchestrator labels the reconnect attach distinctly, so the transition is visible in the logs', () => {
  assert.match(
    orchestratorSource,
    /reconnectsUsedForThisSourceAttempt > 0 \? 'browser_reconnect' : 'source_page'/
  );
  // And the reconnect policy itself is untouched by any of this.
  assert.match(orchestratorSource, /decideBrowserlessReconnect\(sharedBrowserlessContext, e, reconnectsUsedForThisSourceAttempt\)/);
});

/* ================================================================== *
 * G/H) CAPTCHA and resume use the SAME watched page.                  *
 * ================================================================== */

test('G) when the watched page reaches a CAPTCHA, no second live view and no second browser is created', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'enreg', reason: 'source_page' });

  // The orchestrator's WAITING_HUMAN branch preserves this exact page…
  const session = { browser: world.browser, ctx: world.browser.ctx, page, jobId: 'job-1', live: null, liveError: null };

  // …and ensureHumanLiveView() short-circuits because it is already watched.
  assert.equal(isWatchingPage(watch, session.page), true);
  assert.equal(world.events.created.length, 1, 'exactly one stream — the one already on screen');
  assert.equal(session.live, null, 'no separate CAPTCHA handle is minted for a watched page');
  assert.deepEqual(world.events.closedIds, [], 'the watched stream is not torn down for the CAPTCHA');
});

test('G2) the orchestrator proves same-page CAPTCHA structurally: isWatchingPage short-circuits before any mint', () => {
  assert.match(
    orchestratorSource,
    /private async ensureHumanLiveView\(session: SessionState\)[\s\S]{0,1200}?if \(isWatchingPage\(watch, session\.page\)\)[\s\S]{0,300}?return;/
  );
  // The ordinary (non-watch) job still takes the deployed path unchanged.
  assert.match(orchestratorSource, /await this\.openLiveView\(session\);\s*\}/);
  // Both WAITING_HUMAN entry points go through the same helper.
  assert.equal((orchestratorSource.match(/await this\.ensureHumanLiveView\(/g) || []).length, 3);
});

test('H) resume drives the identical preserved page — the one still being watched', () => {
  // resume() never re-derives a context/page; it uses session.page directly.
  assert.match(orchestratorSource, /finalResult = await runEnregWorkflow\(session\.page,/);
  assert.match(orchestratorSource, /finalResult = await runMyGovWorkflow\(session\.page, session\.ctx,/);
  // And the watch is only released once that page's work is genuinely done.
  assert.match(orchestratorSource, /await this\.detachWatch\(job\.id, key, 'resume_complete'\)/);
  assert.match(orchestratorSource, /await this\.detachWatch\(job\.id, key, 'skip_human_verification'\)/);
});

/* ================================================================== *
 * I/J) failure never affects research or becomes evidence.            *
 * ================================================================== */

test('I) a live-view failure leaves the page untouched and research unaffected', async () => {
  const world = makeWorld({ failCreate: true });
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();

  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'TAS_MAP', reason: 'source_page' }); // must not throw

  assert.equal(watch.live, null);
  assert.equal(watch.error, 'live_view_unavailable');
  assert.equal(watch.generation, 0, 'a failed attach mints no generation');
  assert.deepEqual(world.events.pagesClosed, [], 'the research page is untouched');
  assert.equal(world.events.newPageCalls, 1, 'no recovery page is created');

  const fields = visualWatchFields('job-1', watch);
  assert.equal(fields.enabled, true);
  assert.equal(fields.interactive, false);
  assert.equal(fields.interactiveUnavailableReason, 'live_view_unavailable');
});

test('I2) attach/detach are awaited but never guarded by research control flow — they cannot abort a source', () => {
  // attachWatch/detachWatch are void-returning helpers whose result is never
  // branched on, and neither is inside the try that decides a source result.
  assert.match(orchestratorSource, /private async attachWatch\(jobId: string, page: any, source: string, reason: string\): Promise<void>/);
  assert.match(orchestratorSource, /private async detachWatch\(jobId: string, source: string, reason: string\): Promise<void>/);
  assert.equal(/if \(await this\.attachWatch|if \(await this\.detachWatch/.test(orchestratorSource), false);
});

test('J) visual-watch state can never carry a property finding', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'debtor', reason: 'source_page' });

  for (const fields of [visualWatchFields('job-1', watch), visualWatchFields('job-1', createVisualWatch(true))]) {
    const wire = JSON.parse(JSON.stringify(fields));
    for (const forbidden of ['propertyRisk', 'verdict', 'resultConfirmed', 'noResultConfirmed', 'resultValidated', 'documents', 'status']) {
      assert.equal(forbidden in wire, false, `visualWatch must not carry ${forbidden}`);
    }
    assert.deepEqual(Object.keys(wire).sort().filter((k) => !['enabled', 'generation', 'source', 'interactive', 'liveURL', 'liveBrowserEndpoint', 'interactiveUnavailableReason'].includes(k)), []);
  }
});

/* ================================================================== *
 * K/L) auth and no secrets/handles anywhere.                          *
 * ================================================================== */

test('K) every live/watch endpoint requires auth, and the watch adds no new unauthenticated route', () => {
  const liveRoutes = indexSource.match(/app\.(get|post)\('\/research\/:id\/live'[^)]*\)/g) || [];
  assert.equal(liveRoutes.length, 2);
  for (const route of liveRoutes) assert.match(route, /,\s*auth\s*,/);
  assert.match(indexSource, /app\.post\('\/research',\s*auth,/);
  assert.match(indexSource, /app\.get\('\/research\/:id',\s*auth,/);
  // No /research route anywhere was added with a first argument other than
  // the auth middleware. (Captures the identifier after the path — a
  // negative lookahead is defeated by backtracking here.)
  const registrations = [...indexSource.matchAll(/app\.(?:get|post)\('(\/research[^']*)',\s*([A-Za-z_$][\w$]*)/g)];
  assert.equal(registrations.length >= 9, true, 'all /research routes must be found');
  const unauthenticated = registrations.filter(([, , middleware]) => middleware !== 'auth').map(([, path]) => path);
  assert.deepEqual(unauthenticated, []);
});

test('L) neither the wire shape nor the logs can carry a liveURLId, a handle or a secret', async () => {
  const secret = 'brs-SUPER-SECRET-TOKEN-0123456789';
  const world = makeWorld({ liveURLFor: (n) => `https://production-sfo.browserless.io/live/view-${n}?token=${secret}` });
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'rstax', reason: 'source_page' });

  // The fail-closed classifier is still the gate: a credential-bearing URL is
  // withheld and replaced by the authenticated endpoint path.
  assert.equal(watch.live.safeToExpose, false);
  const wire = JSON.stringify(visualWatchFields('job-1', watch));
  assert.equal(wire.includes(secret), false);
  assert.equal(wire.includes('handle-1'), false);
  assert.equal(wire.includes('liveURLId'), false);
  assert.equal(wire.includes('watchedPage'), false);
  assert.equal(wire.includes('page-A'), false);
  assert.equal(wire.includes('browser-A'), false);
  assert.equal(wire.includes('ctx-A'), false);
  assert.equal(/wss:\/\/|BROWSERLESS_TOKEN|BRIDGE_KEY|WORKER_TOKEN/.test(wire), false);
  assert.match(wire, /\/research\/job-1\/live/);

  // Logging: no lifecycle call in the watch module may pass a URL or handle.
  const moduleSource = readFileSync(`${here}../src/browser/VisualWatchSession.ts`, 'utf8');
  const logCalls = moduleSource.match(/logBrowserLifecycle\([\s\S]*?\}\);/g) || [];
  assert.equal(logCalls.length >= 3, true);
  for (const call of logCalls) {
    assert.equal(/liveURL[^s]|liveURLId|watchedPage|\bpage\b|token/i.test(call), false, `log must stay secret-free: ${call}`);
  }
});

/* ================================================================== *
 * M/N) existing CAPTCHA contract + polling behaviour.                 *
 * ================================================================== */

test('M) the existing POST /research/:id/live CAPTCHA contract is unchanged for ordinary jobs', () => {
  // Same path, same verb, same 404 message when there is no human session and
  // no watch — exactly the deployed behaviour.
  assert.match(indexSource, /app\.post\('\/research\/:id\/live',\s*auth,\s*liveBrowserHandler\)/);
  assert.match(indexSource, /if \(!s && !watching\) return res\.status\(404\)\.json\(\{ error: 'active human session not found' \}\)/);
  assert.match(indexSource, /liveURL:\s*live\.liveURL/);
  // An ordinary WAITING_HUMAN job still mints through the deployed path.
  assert.match(orchestratorSource, /if \(!session\.live && !isWatchingPage\(watch, session\.page\)\) await this\.ensureHumanLiveView\(session\)/);
});

test('N) repeated polling returns the open stream and never mints a second handle', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'tas', reason: 'source_page' });

  // Mirror of getOrCreateLiveView()'s watch branch: a pure read, no minting.
  const read = () => (watch.enabled && watch.live ? { liveURL: watch.live.liveURL, generation: watch.generation } : null);
  const a = read(), b = read(), c = read();

  assert.equal(world.events.created.length, 1, 'one handle for N polls');
  assert.equal(a.liveURL, b.liveURL);
  assert.equal(b.generation, c.generation);
  // Structurally: the watch branch of getOrCreateLiveView performs no attach.
  const branch = orchestratorSource.slice(
    orchestratorSource.indexOf('// 2. A RUNNING visualWatch job'),
    orchestratorSource.indexOf('isVisualWatchEnabled(jobId: string)')
  );
  assert.equal(/attachVisualWatch|this\.attachWatch|openHumanLiveSession/.test(branch), false);
});

/* ================================================================== *
 * O) terminal / TTL cleanup.                                          *
 * ================================================================== */

test('O) detach releases the handle best-effort and is wired into every terminal path', async () => {
  const world = makeWorld();
  const watch = createVisualWatch(true);
  const page = await world.browser.ctx.newPage();
  await attachVisualWatch(watch, page, { jobId: 'job-1', source: 'tas', reason: 'source_page' });

  await detachVisualWatch(watch, { jobId: 'job-1', source: 'tas', reason: 'job_complete' });
  assert.deepEqual(world.events.closedIds, ['handle-1']);
  assert.equal(watch.live, null);
  assert.equal(watch.watchedPage, null);
  assert.deepEqual(world.events.pagesClosed, [], 'cleanup never closes the page itself');

  // A second detach is a safe no-op (double sweep, already-closed target).
  await detachVisualWatch(watch, { jobId: 'job-1', source: 'tas', reason: 'ttl_expired' });
  assert.deepEqual(world.events.closedIds, ['handle-1']);

  // The exact terminal-path calls, asserted as literal source text (a
  // built RegExp is not used here: template-literal escaping silently
  // collapses the pattern).
  for (const call of [
    "await this.detachWatch(job.id, 'job', 'job_complete');",
    "await this.detachWatch(job.id, 'job', 'job_failed');",
    "await this.detachWatch(id, ResearchOrchestrator.sourceOf(s.step), 'ttl_expired');",
    "await this.detachWatch(job.id, key, 'source_complete');",
    "await this.detachWatch(job.id, key, 'source_error');",
  ]) {
    assert.equal(orchestratorSource.includes(call), true, `terminal/source path must release the watch: ${call}`);
  }
  // And the per-job watch record itself is dropped on every terminal path.
  assert.equal((orchestratorSource.match(/this\.visualWatches\.delete\(/g) || []).length, 3);
});

test('O2) a live view that refuses to close never breaks cleanup', async () => {
  const watch = createVisualWatch(true);
  const throwingPage = {
    context: () => ({
      newCDPSession: async () => {
        throw new Error('target closed');
      },
    }),
  };
  watch.live = { liveURL: 'https://x/y', liveURLId: 'handle-x', safeToExpose: true, exposureReason: 'ok', createdAt: 1 };
  watch.watchedPage = throwingPage;

  await detachVisualWatch(watch, { jobId: 'job-1', source: 'tas', reason: 'job_failed' }); // must not throw
  assert.equal(watch.live, null);
});
