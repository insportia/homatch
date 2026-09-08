import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createHumanLiveURL,
  classifyLiveURLExposure,
  classifyLiveCapabilityExposure,
  isTrustedLiveCapability,
  isAllowedLiveOrigin,
  exposableLiveURL,
} from '../.tstest-build/browser/BrowserlessRuntime.js';
import { openHumanLiveSession, humanLiveFields } from '../.tstest-build/browser/HumanLiveSession.js';
import { createVisualWatch, attachVisualWatch, visualWatchFields } from '../.tstest-build/browser/VisualWatchSession.js';

/*
 * PRODUCTION INCIDENT 2026-09-08 — job 785134fd-5210-4bf2-8315-6a927403c2dd.
 *
 * Railway proved Browserless DID mint a real interactive live view and the
 * watch DID attach:
 *   human_live_url_created  safeToExpose=false exposureReason=credential_query_param hasLiveURLId=true
 *   visual_watch_attached   source=TAS_MAP generation=1 safeToExpose=false
 *
 * The URL Browserless issues is an ephemeral CAPABILITY URL and carries a
 * Browserless-generated auth parameter, which the generic classifier — right,
 * for an arbitrary URL — calls credential_query_param.
 *
 * The fix is a narrow, provenance-based trust boundary. These tests use a
 * capability-shaped URL of exactly the production form.
 */

// The production shape: https, Browserless live-view origin, Browserless's
// own capability/auth parameter.
const BROWSERLESS_CAPABILITY_URL = 'https://production-sfo.browserless.io/devtools/page/9f1c?token=BROWSERLESS-ISSUED-CAPABILITY-abc123';

function makePage({ url = BROWSERLESS_CAPABILITY_URL, timeoutHonoured = true } = {}) {
  const events = { sends: [], newPageCalls: 0, newContextCalls: 0 };
  const cdp = {
    send: async (_method, params) => {
      events.sends.push(params);
      // Models the real plan ceiling: only a timeout ABOVE it is rejected, so
      // the fallback attempt (120000) succeeds exactly as in production.
      if (!timeoutHonoured && params.timeout !== undefined && params.timeout > 120000) {
        return { error: "The 'timeout' value must be a whole number of milliseconds between 1 and 120,000 (your plan's maximum session time). Received \"900000\"." };
      }
      return { liveURL: url, liveURLId: 'handle-1' };
    },
    detach: async () => {},
  };
  const ctx = {
    newCDPSession: async () => cdp,
    newPage: async () => {
      events.newPageCalls += 1;
      return {};
    },
    newContext: async () => {
      events.newContextCalls += 1;
      return {};
    },
  };
  return { page: { context: () => ctx, url: () => 'https://tas.gov.ge/', close: async () => {} }, events };
}

/* ================================================================== *
 * A) The production URL shape, and what the generic classifier says.   *
 * ================================================================== */

test('A) Browserless returns an HTTPS capability URL whose query parameter the GENERIC classifier still calls credential_query_param', async () => {
  const { page } = makePage();
  const { liveURL, liveURLId, capability } = await createHumanLiveURL(page, 900000);

  assert.equal(liveURL, BROWSERLESS_CAPABILITY_URL);
  assert.equal(liveURLId, 'handle-1');
  // Unchanged generic verdict — this is the production log line's reason.
  assert.deepEqual(classifyLiveURLExposure(liveURL), { safe: false, reason: 'credential_query_param' });
  // …and the capability records that fact, as diagnostics only.
  assert.equal(capability.carriesCredentialParam, true);
  assert.equal(capability.origin, 'https://production-sfo.browserless.io');
  assert.equal(typeof capability.expiresAt, 'number');
});

/* ================================================================== *
 * B) Provenance makes it exposable through the authenticated path.    *
 * ================================================================== */

test('B) the same URL, as a capability minted by our own Browserless.liveURL call, IS exposable', async () => {
  const { page } = makePage();
  const { capability } = await createHumanLiveURL(page, 900000);

  assert.equal(isTrustedLiveCapability(capability), true);
  assert.deepEqual(classifyLiveCapabilityExposure(capability), { safe: true, reason: 'trusted_browserless_capability' });
  assert.deepEqual(exposableLiveURL(capability), { liveURL: BROWSERLESS_CAPABILITY_URL, reason: 'trusted_browserless_capability' });
});

/* ================================================================== *
 * C) visualWatch generation 1 can hand the URL to /live.              *
 * ================================================================== */

test('C) visualWatch attaches at generation 1 and its capability resolves to the live URL for the authenticated endpoint', async () => {
  const { page, events } = makePage({ timeoutHonoured: false }); // the real plan rejection too
  const watch = createVisualWatch(true);

  await attachVisualWatch(watch, page, { jobId: '785134fd', source: 'TAS_MAP', reason: 'source_page', timeoutMs: 900000 });

  assert.equal(watch.generation, 1);
  assert.equal(events.sends.length, 2, 'plan fallback still happens first');
  // What getOrCreateLiveView() resolves for the endpoint response.
  const exposed = exposableLiveURL(watch.live.capability);
  assert.equal(exposed.liveURL, BROWSERLESS_CAPABILITY_URL);
  assert.equal(watch.live.capability.expiresAt - watch.live.capability.issuedAt, 120000, 'the deadline follows the ACCEPTED timeout');
  assert.equal(events.newPageCalls, 0);
  assert.equal(events.newContextCalls, 0);
});

/* ================================================================== *
 * D-G) Everything untrusted still fails closed.                       *
 * ================================================================== */

test('D) the SAME naked URL string, injected from anywhere untrusted, is refused', () => {
  const injected = exposableLiveURL(BROWSERLESS_CAPABILITY_URL);
  assert.equal(injected.liveURL, null);
  assert.equal(injected.reason, 'untrusted_credential_query_param');

  // A hand-built look-alike object — e.g. parsed back out of JSON, a DB row,
  // or a job document — has no provenance and is refused too.
  const forged = { liveURL: BROWSERLESS_CAPABILITY_URL, liveURLId: 'handle-1', origin: 'https://production-sfo.browserless.io', issuedAt: Date.now(), expiresAt: Date.now() + 120000, carriesCredentialParam: true };
  assert.equal(isTrustedLiveCapability(forged), false);
  assert.equal(exposableLiveURL(forged).liveURL, null);
  assert.equal(classifyLiveCapabilityExposure(forged).reason, 'untrusted_provenance');
});

test('E) the same capability parameter on a NON-Browserless origin is refused even with provenance', async () => {
  const { page } = makePage({ url: 'https://evil.example.com/devtools/page/9f1c?token=BROWSERLESS-ISSUED-CAPABILITY-abc123' });
  const { capability } = await createHumanLiveURL(page, 120000);

  assert.equal(isTrustedLiveCapability(capability), true, 'provenance alone is not enough');
  assert.deepEqual(classifyLiveCapabilityExposure(capability), { safe: false, reason: 'origin_not_allowed' });
  assert.equal(exposableLiveURL(capability).liveURL, null);
  assert.equal(isAllowedLiveOrigin(new URL('https://evil.example.com/x')), false);
  assert.equal(isAllowedLiveOrigin(new URL('https://production-sfo.browserless.io/x')), true);
});

test('F) an http (non-HTTPS) live URL is refused even with provenance and an allowed host', async () => {
  const { page } = makePage({ url: 'http://production-sfo.browserless.io/devtools/page/9f1c?token=abc' });
  const { capability } = await createHumanLiveURL(page, 120000);

  assert.equal(isTrustedLiveCapability(capability), true);
  assert.deepEqual(classifyLiveCapabilityExposure(capability), { safe: false, reason: 'not_https' });
  assert.equal(exposableLiveURL(capability).liveURL, null);
});

test('G) an expired capability is refused — the URL is never returned after its deadline', async () => {
  const { page } = makePage();
  const { capability } = await createHumanLiveURL(page, 120000);

  const justBefore = capability.expiresAt - 1;
  const atDeadline = capability.expiresAt;
  assert.equal(classifyLiveCapabilityExposure(capability, justBefore).safe, true);
  assert.deepEqual(classifyLiveCapabilityExposure(capability, atDeadline), { safe: false, reason: 'expired' });
  assert.equal(exposableLiveURL(capability, atDeadline + 60000).liveURL, null);
});

test('G2) a capability containing one of THIS account’s own secrets is refused, trusted or not', async () => {
  const secret = 'brs-OUR-OWN-ACCOUNT-TOKEN-0123456789';
  process.env.WORKER_TOKEN = secret;
  try {
    const { page } = makePage({ url: `https://production-sfo.browserless.io/devtools/page/9f1c?token=${secret}` });
    const { capability } = await createHumanLiveURL(page, 120000);
    assert.deepEqual(classifyLiveCapabilityExposure(capability), { safe: false, reason: 'contains_known_secret' });
  } finally {
    delete process.env.WORKER_TOKEN;
  }
});

/* ================================================================== *
 * H-J) Auth, job document and logs.                                   *
 * ================================================================== */

const here = fileURLToPath(new URL('.', import.meta.url));
const indexSource = readFileSync(`${here}../src/index.ts`, 'utf8');
const orchestratorSource = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');

test('H) both live verbs stay behind auth, so an unauthenticated caller can never reach the capability', () => {
  const routes = indexSource.match(/app\.(get|post)\('\/research\/:id\/live'[^)]*\)/g) || [];
  assert.equal(routes.length, 2);
  for (const route of routes) assert.match(route, /,\s*auth\s*,/);
  // The handler is reached only through those two registrations.
  assert.equal((indexSource.match(/liveBrowserHandler/g) || []).length, 3);
});

test('I) the normal job document can never carry the URL, the capability value, a liveURLId or a handle', async () => {
  const { page } = makePage();
  const watch = createVisualWatch(true);
  await attachVisualWatch(watch, page, { jobId: '785134fd', source: 'TAS_MAP', reason: 'source_page', timeoutMs: 120000 });

  const jobDocument = {
    id: '785134fd',
    status: 'RUNNING',
    visualWatch: visualWatchFields('785134fd', watch),
    humanVerification: { sessionId: '785134fd', required: true, source: 'TAS_MAP', ...humanLiveFields('785134fd', watch.live, null) },
  };
  const wire = JSON.stringify(jobDocument);

  assert.equal(wire.includes('BROWSERLESS-ISSUED-CAPABILITY'), false, 'the capability value must never be serialized');
  assert.equal(wire.includes('devtools/page'), false);
  assert.equal(wire.includes('liveURL'), false, 'no liveURL field at all');
  assert.equal(wire.includes('liveURLId'), false);
  assert.equal(wire.includes('handle-1'), false);
  assert.equal(wire.includes('capability'), false, 'the capability object itself is never serialized');
  assert.equal(/wss:\/\/|watchedPage|BROWSERLESS_TOKEN|WORKER_TOKEN/.test(wire), false);
  // It advertises the authenticated endpoint instead.
  assert.equal(jobDocument.visualWatch.interactive, true);
  assert.equal(jobDocument.visualWatch.liveBrowserEndpoint, '/research/785134fd/live');
});

test('J) logs carry booleans and reason codes only — never the URL or the capability value', async (t) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  t.after(() => {
    console.log = originalLog;
  });

  const { page } = makePage({ timeoutHonoured: false });
  await openHumanLiveSession(page, null, { jobId: '785134fd', source: 'TAS_MAP', timeoutMs: 900000 });

  console.log = originalLog;
  const all = lines.join('\n');

  assert.equal(all.includes('BROWSERLESS-ISSUED-CAPABILITY'), false);
  assert.equal(all.includes('devtools/page'), false);
  assert.equal(all.includes('browserless.io/'), false);
  assert.equal(all.includes('handle-1'), false);

  const created = JSON.parse(lines.find((l) => l.includes('human_live_url_created')));
  assert.equal(created.trustedCapability, true);
  assert.equal(created.safeToExpose, true, 'the trusted capability is exposable — the production blocker is gone');
  assert.equal(created.exposureReason, 'trusted_browserless_capability');
  assert.equal(created.carriesCredentialParam, true);
  assert.equal(created.hasLiveURLId, true);
});

/* ================================================================== *
 * K-M) CAPTCHA parity, generation handoff, fail-closed errors.        *
 * ================================================================== */

test('K) the WAITING_HUMAN CAPTCHA path gets the identical trusted-capability treatment', async () => {
  const { page, events } = makePage();
  const opened = await openHumanLiveSession(page, null, { jobId: '785134fd', source: 'mygov', timeoutMs: 120000 });

  assert.equal(opened.error, null);
  assert.equal(isTrustedLiveCapability(opened.session.capability), true);
  assert.equal(opened.session.safeToExpose, true);
  assert.equal(exposableLiveURL(opened.session.capability).liveURL, BROWSERLESS_CAPABILITY_URL);
  assert.equal(events.newPageCalls, 0, 'same preserved page — no second browser/context/page');
});

test('L) a new generation replaces the capability — only the CURRENT one can be retrieved', async () => {
  const first = makePage({ url: 'https://production-sfo.browserless.io/devtools/page/aaa?token=CAP-ONE' });
  const watch = createVisualWatch(true);
  await attachVisualWatch(watch, first.page, { jobId: '785134fd', source: 'TAS_MAP', reason: 'source_page', timeoutMs: 120000 });
  const oldCapability = watch.live.capability;

  // Browserless session died; recovery launched a new browser and a new page.
  const second = makePage({ url: 'https://production-sfo.browserless.io/devtools/page/bbb?token=CAP-TWO' });
  await attachVisualWatch(watch, second.page, { jobId: '785134fd', source: 'mygov', reason: 'browser_reconnect', timeoutMs: 120000 });

  assert.equal(watch.generation, 2);
  assert.notEqual(watch.live.capability, oldCapability);
  assert.equal(exposableLiveURL(watch.live.capability).liveURL, 'https://production-sfo.browserless.io/devtools/page/bbb?token=CAP-TWO');
  // The superseded capability is no longer what the endpoint serves; the
  // watch holds exactly one, and the watcher is told by the generation.
  assert.equal(watch.live.capability.liveURL.includes('CAP-ONE'), false);
});

test('M) ordinary failures stay fail-closed: no capability, no URL, research unaffected', async () => {
  const page = {
    context: () => ({
      newCDPSession: async () => ({ send: async () => ({ error: 'browserless is unavailable' }), detach: async () => {} }),
    }),
  };
  const opened = await openHumanLiveSession(page, null, { jobId: '785134fd', source: 'enreg', timeoutMs: 120000 });
  assert.deepEqual(opened, { session: null, error: 'live_view_unavailable' });
  assert.deepEqual(humanLiveFields('785134fd', null, 'live_view_unavailable'), {
    interactive: false,
    interactiveUnavailableReason: 'live_view_unavailable',
  });
});

test('M2) the endpoint fails closed on a withheld capability, and a known watch job never 404s just because its record was swept', () => {
  // getOrCreateLiveView returns null when exposure is refused -> 503, not a URL.
  assert.match(orchestratorSource, /const exposed = this\.exposeLiveURL\(jobId, watch\.live, watch\.source \|\| 'visual_watch'\);\s*\n\s*if \(!exposed\) return null;/);
  assert.match(orchestratorSource, /const decision = exposableLiveURL\(live\.capability\);/);
  // The withholding reason is logged; the URL is not.
  assert.match(orchestratorSource, /logBrowserLifecycle\('live_url_withheld', \{ jobId, source, reason: decision\.reason \}\)/);
  // A watch job whose in-memory record was dropped at a terminal state still
  // reports as a watch job, so the endpoint answers 503 rather than a
  // misleading 404.
  assert.match(orchestratorSource, /return this\.jobs\.get\(jobId\)\?\.visualWatch\?\.enabled === true;/);
  // An id this worker never had is still an honest 404.
  assert.match(indexSource, /if \(!orchestrator\.getJob\(req\.params\.id\)\) return res\.status\(404\)\.json\(\{ error: 'not found' \}\)/);
});
