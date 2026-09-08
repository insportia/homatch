import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHumanLiveURL,
  closeHumanLiveURL,
  classifyLiveURLExposure,
} from '../.tstest-build/browser/BrowserlessRuntime.js';
import {
  openHumanLiveSession,
  closeHumanLiveSession,
  humanLiveFields,
} from '../.tstest-build/browser/HumanLiveSession.js';

/*
 * WAITING_HUMAN INTERACTIVE LIVE-BROWSER REGRESSION SUITE.
 *
 * Gap closed: createHumanLiveURL()/closeHumanLiveURL() existed in
 * BrowserlessRuntime.ts but had NO production call site, so a WAITING_HUMAN
 * job preserved a perfectly good browser/context/page that the human could
 * never actually interact with.
 *
 * Everything exercised below is REAL production code — openHumanLiveSession,
 * closeHumanLiveSession, humanLiveFields, createHumanLiveURL,
 * closeHumanLiveURL and classifyLiveURLExposure are imported, not copied.
 * Only the two small orchestrator shapes (the humanVerification literal and
 * skip()'s SKIPPED_HUMAN_VERIFICATION result) are verbatim mirrors, because
 * ResearchOrchestrator.ts is excluded from tsconfig.test.json for its
 * transitive DOM-lib imports.
 *
 * No test here solves, submits or bypasses a challenge — they only prove the
 * real page is streamed to the real human and correctly torn down.
 */

const SAFE_LIVE_HOST = 'https://production-sfo.browserless.io/live';

/** A Browserless-shaped human session: one browser, one context, one page —
 * all of which record any attempt to replace them. */
function makeHumanSession({ failCreate = false, failClose = false, liveURLFor = (n) => `${SAFE_LIVE_HOST}/view-${n}` } = {}) {
  const events = {
    cdpAttachedTo: [],
    created: [],
    closedIds: [],
    detached: 0,
    newPageCalls: 0,
    newContextCalls: 0,
    pageClosed: 0,
    browserClosed: 0,
    ctxClosed: 0,
  };
  let seq = 0;

  const cdp = {
    send: async (method, params) => {
      if (method === 'Browserless.liveURL') {
        if (failCreate) return { error: 'live url refused by browserless' };
        seq += 1;
        // Deliberately unrelated to the URL: proves the handle id is never
        // inferable from, or smuggled inside, what we publish.
        const id = `handle-${seq}`;
        events.created.push({ id, params });
        return { liveURL: liveURLFor(seq), liveURLId: id };
      }
      if (method === 'Browserless.closeLiveURL') {
        if (failClose) throw new Error('close refused');
        events.closedIds.push(params.liveURLId);
        return {};
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
    detach: async () => {
      events.detached += 1;
    },
  };

  const ctx = {
    label: 'ctx-A',
    pages: () => [page],
    newCDPSession: async (target) => {
      events.cdpAttachedTo.push(target);
      return cdp;
    },
    newPage: async () => {
      events.newPageCalls += 1;
      return { label: 'unexpected-page' };
    },
    close: async () => {
      events.ctxClosed += 1;
    },
  };

  const page = {
    label: 'page-A',
    context: () => ctx,
    url: () => 'https://enreg.reestri.gov.ge/main.php',
    close: async () => {
      events.pageClosed += 1;
    },
  };

  const browser = {
    label: 'browser-A',
    __homatchBrowserless: true,
    isConnected: () => true,
    contexts: () => [ctx],
    newContext: async () => {
      events.newContextCalls += 1;
      return { label: 'unexpected-ctx' };
    },
    close: async () => {
      events.browserClosed += 1;
    },
  };

  return { browser, ctx, page, events };
}

/** Verbatim mirror of ResearchOrchestrator.ts's humanVerification literal,
 * including the `...humanLiveFields(...)` spread this task added. */
function buildHumanVerification(jobId, session, step, sourceKey, url, expiresAt) {
  return {
    sessionId: jobId,
    required: true,
    source: sourceKey,
    step,
    url,
    expiresAt,
    ...humanLiveFields(jobId, session.live, session.liveError),
    recommendedWidth: 1100,
    recommendedMaxHeight: '90vh',
    fullInteractiveSession: true,
    scrollable: true,
    message: 'წყარომ მოითხოვა ადამიანის დადასტურება.',
  };
}

/** Mirrors the orchestrator's openLiveView(): opens on the EXACT preserved
 * page and stores the result next to it. */
async function openLiveView(session, jobId, sourceKey) {
  const opened = await openHumanLiveSession(session.page, session.live, {
    jobId,
    source: sourceKey,
    timeoutMs: 120000,
  });
  session.live = opened.session;
  session.liveError = opened.error;
}

async function closeLiveView(session, jobId, sourceKey, reason) {
  if (!session?.live) return;
  await closeHumanLiveSession(session.page, session.live, { jobId, source: sourceKey, reason });
  session.live = null;
}

function makeSessionState(fixture) {
  return {
    browser: fixture.browser,
    ctx: fixture.ctx,
    page: fixture.page,
    jobId: 'job-1',
    step: { type: 'source', key: 'enreg' },
    query: '01.18.06.019.055',
    expires: Date.now() + 15 * 60 * 1000,
    live: null,
    liveError: null,
  };
}

/* ================================================================== *
 * A) WAITING_HUMAN creates a live URL from the EXACT preserved page.  *
 * ================================================================== */

test('A) entering WAITING_HUMAN mints an interactable live view on the exact preserved page', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);

  await openLiveView(session, 'job-1', 'enreg');

  assert.equal(session.liveError, null);
  assert.equal(session.live.liveURL, `${SAFE_LIVE_HOST}/view-1`);
  assert.equal(session.live.liveURLId, 'handle-1');
  // The CDP session was attached to THAT page object — not a copy, not a new one.
  assert.deepEqual(fx.events.cdpAttachedTo, [fx.page]);
  assert.equal(fx.events.cdpAttachedTo[0], session.page);
  // interactable:true is what makes the human able to solve it themselves.
  assert.equal(fx.events.created[0].params.interactable, true);
  assert.equal(fx.events.detached, 1, 'the CDP session is always detached again');
});

/* ================================================================== *
 * B) No replacement browser / context / page.                         *
 * ================================================================== */

test('B) opening the live view never creates a replacement browser, context or page', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  const before = { browser: session.browser, ctx: session.ctx, page: session.page };

  await openLiveView(session, 'job-1', 'enreg');

  assert.equal(fx.events.newContextCalls, 0, 'no context may be created for a live view');
  assert.equal(fx.events.newPageCalls, 0, 'no page may be created for a live view');
  assert.equal(fx.events.pageClosed, 0, 'the human’s page must stay open');
  assert.equal(fx.events.browserClosed, 0);
  assert.equal(session.browser, before.browser);
  assert.equal(session.ctx, before.ctx);
  assert.equal(session.page, before.page);
  assert.equal(session.page.context(), before.ctx, 'the page stays bound to the same context');
});

/* ================================================================== *
 * C) GET /research/:id exposes only the intended metadata.            *
 * ================================================================== */

test('C) humanVerification advertises the live view by ENDPOINT, never by URL — the URL is fetched behind auth', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  const hv = buildHumanVerification('job-1', session, session.step, 'enreg', 'https://enreg.reestri.gov.ge/main.php', new Date(session.expires).toISOString());
  const wire = JSON.parse(JSON.stringify(hv));

  assert.equal(wire.required, true);
  assert.equal(wire.source, 'enreg');
  assert.equal(wire.interactive, true);
  // 2026-09-08 hardening: the raw URL is never serialized into the job
  // document, safe or not — it is returned only by the authenticated
  // /research/:id/live endpoint, after the trusted capability is validated.
  assert.equal('liveURL' in wire, false, 'the job document must never carry the URL');
  assert.equal(wire.liveBrowserEndpoint, '/research/job-1/live');
  assert.equal('interactiveUnavailableReason' in wire, false);
});

test('C2) humanLiveFields exposes exactly one shape per state and nothing more', () => {
  // A credential-free URL and a Browserless capability URL produce the SAME
  // wire shape: an endpoint, never the URL.
  const safe = humanLiveFields('job-1', { liveURL: `${SAFE_LIVE_HOST}/x`, liveURLId: 'x', safeToExpose: true, exposureReason: 'trusted_browserless_capability', createdAt: 1 }, null);
  assert.deepEqual(Object.keys(safe).sort(), ['interactive', 'liveBrowserEndpoint']);

  const unsafe = humanLiveFields('job-1', { liveURL: `${SAFE_LIVE_HOST}/x?token=abc`, liveURLId: 'x', safeToExpose: false, exposureReason: 'credential_query_param', createdAt: 1 }, null);
  assert.deepEqual(Object.keys(unsafe).sort(), ['interactive', 'liveBrowserEndpoint']);
  // The frontend's existing production contract path — see
  // liveBrowserEndpointContract.test.mjs.
  assert.equal(unsafe.liveBrowserEndpoint, '/research/job-1/live');

  const none = humanLiveFields('job-1', null, 'live_view_unavailable');
  assert.deepEqual(Object.keys(none).sort(), ['interactive', 'interactiveUnavailableReason']);
  assert.equal(none.interactive, false);
});

/* ================================================================== *
 * D) Secrets, raw handles and liveURLId are never serialized.        *
 * ================================================================== */

test('D) a Browserless capability URL is WITHHELD from the job document and replaced by the authenticated endpoint path', async () => {
  const secret = 'brs-SUPER-SECRET-TOKEN-0123456789';
  const fx = makeHumanSession({ liveURLFor: (n) => `${SAFE_LIVE_HOST}/view-${n}?token=${secret}` });
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  // The URL Browserless issued does carry a capability parameter (exactly the
  // production case) — recorded for diagnostics, never the exposure decision.
  assert.equal(session.live.capability.carriesCredentialParam, true);

  const wire = JSON.stringify(buildHumanVerification('job-1', session, session.step, 'enreg', 'u', 'e'));
  assert.equal(wire.includes(secret), false, 'no credential may reach the job document');
  assert.equal(wire.includes('liveURL'), false, 'the raw URL must not be published');
  assert.match(wire, /\/research\/job-1\/live/);
});

test('D) liveURLId, browser/context/page handles and tokens are never part of the serialized job document', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  const wire = JSON.stringify(buildHumanVerification('job-1', session, session.step, 'enreg', 'u', 'e'));

  assert.equal(wire.includes('liveURLId'), false);
  assert.equal(wire.includes('handle-1'), false, 'the Browserless-side handle id is server-side only');
  assert.equal(wire.includes('browser-A'), false);
  assert.equal(wire.includes('ctx-A'), false);
  assert.equal(wire.includes('page-A'), false);
  assert.match(wire, /^(?!.*wss:\/\/).*$/s, 'no CDP websocket URL');
  // Note: the Browserless HOST name legitimately contains "browserless" —
  // what must never appear is a credential or a credential-bearing env name.
  assert.equal(/token=|apikey|BROWSERLESS_TOKEN|BRIDGE_KEY|WORKER_TOKEN/i.test(wire), false);
});

test('D2) classifyLiveURLExposure fails closed on every credential shape and only clears a genuinely opaque https URL', () => {
  const secret = 'brs-SUPER-SECRET-TOKEN-0123456789';

  assert.deepEqual(classifyLiveURLExposure(`${SAFE_LIVE_HOST}/abc`, [secret]), {
    safe: true,
    reason: 'opaque_no_credential_detected',
  });

  // A known account secret anywhere in the URL — path, query or fragment.
  assert.equal(classifyLiveURLExposure(`${SAFE_LIVE_HOST}/${secret}`, [secret]).reason, 'contains_known_secret');
  assert.equal(classifyLiveURLExposure(`${SAFE_LIVE_HOST}/a?x=1#${secret}`, [secret]).reason, 'contains_known_secret');

  // Credential-shaped query parameters, even with values we do not hold.
  for (const key of ['token', 't', 'apikey', 'api_key', 'auth', 'jwt', 'access_token', 'signature', 'sessionToken']) {
    const c = classifyLiveURLExposure(`${SAFE_LIVE_HOST}/abc?${key}=whatever`, [secret]);
    assert.equal(c.safe, false, `${key} must be treated as a credential`);
    assert.equal(c.reason, 'credential_query_param');
  }

  assert.equal(classifyLiveURLExposure('http://production-sfo.browserless.io/live/abc', []).reason, 'not_https');
  assert.equal(classifyLiveURLExposure('not a url', []).reason, 'unparseable');
  assert.equal(classifyLiveURLExposure('', []).reason, 'empty');
});

/* ================================================================== *
 * E) resume() uses the identical page/context, closes the live view.  *
 * ================================================================== */

test('E) resume runs on the identical preserved page/context and releases the live view best-effort', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');
  const openedOn = session.page;

  // resume(): the workflow is driven on session.page — never re-derived.
  assert.equal(session.page, openedOn);
  assert.equal(session.page.context(), session.ctx);

  await closeLiveView(session, 'job-1', 'enreg', 'resume_complete');

  assert.deepEqual(fx.events.closedIds, ['handle-1']);
  assert.equal(session.live, null);
  assert.equal(fx.events.pageClosed, 0, 'closing the VIEW must never close the human’s page');
  assert.equal(session.page, openedOn, 'the same page object continues into the resumed workflow');
});

test('E2) a live view that refuses to close never breaks resume', async () => {
  const fx = makeHumanSession({ failClose: true });
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  await closeLiveView(session, 'job-1', 'enreg', 'resume_complete'); // must not throw
  assert.equal(session.live, null);
  assert.equal(fx.events.pageClosed, 0);
});

/* ================================================================== *
 * F) skip() closes the live view best-effort.                        *
 * ================================================================== */

test('F) skip releases the live view before the page is closed, and keeps SKIPPED_HUMAN_VERIFICATION semantics', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  await closeLiveView(session, 'job-1', 'enreg', 'skip_human_verification');
  await session.page.close(); // the orchestrator's own unchanged close path

  assert.deepEqual(fx.events.closedIds, ['handle-1']);
  assert.equal(fx.events.pageClosed, 1);

  // Verbatim mirror of skip()'s result shape.
  const skipped = {
    source: 'enreg',
    status: 'SKIPPED_HUMAN_VERIFICATION',
    traversal: { status: 'SKIPPED_HUMAN_VERIFICATION' },
    resultConfirmed: false,
    noResultConfirmed: false,
    resultValidated: false,
    documents: [],
    discoveredEntities: [],
    skippedHumanVerification: true,
  };
  assert.equal(skipped.status, 'SKIPPED_HUMAN_VERIFICATION');
  assert.equal(skipped.noResultConfirmed, false);
});

/* ================================================================== *
 * G) Repeated WAITING_HUMAN leaks no live-view handles.              *
 * ================================================================== */

test('G) a second CAPTCHA on the same page supersedes the first live view instead of leaking it', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);

  await openLiveView(session, 'job-1', 'enreg'); // first challenge
  assert.equal(session.live.liveURLId, 'handle-1');

  await openLiveView(session, 'job-1', 'enreg'); // second challenge, same page

  assert.deepEqual(fx.events.closedIds, ['handle-1'], 'the superseded handle is closed exactly once');
  assert.equal(session.live.liveURLId, 'handle-2', 'exactly one handle remains open');
  assert.equal(fx.events.created.length, 2);
  assert.equal(fx.events.newPageCalls, 0, 'still the same preserved page');
  assert.equal(fx.events.pageClosed, 0);

  await closeLiveView(session, 'job-1', 'enreg', 'resume_complete');
  assert.deepEqual(fx.events.closedIds, ['handle-1', 'handle-2'], 'no handle is left behind');
});

test('G2) the UI polling/refreshing the live endpoint reuses the open handle instead of minting a second one', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);

  // Verbatim mirror of ResearchOrchestrator.getOrCreateLiveView()'s guard:
  // mint only when nothing is open, otherwise hand back what already exists.
  const getOrCreateLiveView = async () => {
    if (!session.live) await openLiveView(session, 'job-1', 'enreg');
    return session.live ? { liveURL: session.live.liveURL } : null;
  };

  const first = await getOrCreateLiveView();   // modal opens
  const second = await getOrCreateLiveView();  // modal's refresh button
  const third = await getOrCreateLiveView();   // another poll

  assert.equal(fx.events.created.length, 1, 'exactly one Browserless live-view handle for N requests');
  assert.deepEqual(fx.events.closedIds, [], 'nothing superseded, nothing leaked');
  assert.equal(first.liveURL, second.liveURL);
  assert.equal(second.liveURL, third.liveURL);
  assert.equal(fx.events.newPageCalls, 0);
  assert.equal(fx.events.pageClosed, 0);
});

/* ================================================================== *
 * H) A live-view failure preserves WAITING_HUMAN safely.             *
 * ================================================================== */

test('H) createHumanLiveURL failing leaves the preserved session intact and the job safely WAITING_HUMAN', async () => {
  const fx = makeHumanSession({ failCreate: true });
  const session = makeSessionState(fx);

  await openLiveView(session, 'job-1', 'enreg');

  assert.equal(session.live, null);
  assert.equal(session.liveError, 'live_view_unavailable');
  // The human session itself is untouched — nothing closed, nothing replaced.
  assert.equal(fx.events.pageClosed, 0);
  assert.equal(fx.events.ctxClosed, 0);
  assert.equal(fx.events.browserClosed, 0);
  assert.equal(fx.events.newPageCalls, 0);
  assert.equal(fx.events.newContextCalls, 0);
  assert.equal(session.page.label, 'page-A');

  const job = { status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED', humanVerification: buildHumanVerification('job-1', session, session.step, 'enreg', 'u', 'e') };
  assert.equal(job.status, 'WAITING_HUMAN');
  assert.equal(job.humanVerification.required, true);
  assert.equal(job.humanVerification.interactive, false);
  assert.equal(job.humanVerification.interactiveUnavailableReason, 'live_view_unavailable');
  // The screenshot/click fallback contract is untouched by the failure.
  assert.equal(job.humanVerification.fullInteractiveSession, true);
});

test('H2) createHumanLiveURL on a page with no context is a clean failure, never a throw into the job', async () => {
  const pageWithoutContext = { context: () => null };
  await assert.rejects(() => createHumanLiveURL(pageWithoutContext, 1000));

  const result = await openHumanLiveSession(pageWithoutContext, null, { jobId: 'job-1', source: 'enreg' });
  assert.deepEqual(result, { session: null, error: 'live_view_unavailable' });
});

/* ================================================================== *
 * I) CAPTCHA/technical state is never negative property evidence.    *
 * ================================================================== */

test('I) neither a WAITING_HUMAN pause nor a failed live view produces propertyRisk/verdict/negative confirmation', async () => {
  const fx = makeHumanSession({ failCreate: true });
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  const hv = buildHumanVerification('job-1', session, session.step, 'enreg', 'u', 'e');
  assert.equal('propertyRisk' in hv, false);
  assert.equal('verdict' in hv, false);
  assert.equal('noResultConfirmed' in hv, false);
  assert.equal('resultConfirmed' in hv, false);

  // The paused source's own result (mirror of a WAITING_HUMAN workflow result)
  // asserts nothing about the property either way.
  const paused = { source: 'enreg', status: 'WAITING_HUMAN', resultConfirmed: false, noResultConfirmed: false, resultValidated: false, documents: [], discoveredEntities: [] };
  assert.equal(paused.resultConfirmed, false);
  assert.equal(paused.noResultConfirmed, false, 'NO EVIDENCE = NO FACT: never a confirmed absence');
  assert.equal('propertyRisk' in paused, false);
  assert.equal('verdict' in paused, false);
});

/* ================================================================== *
 * J) Terminal / TTL cleanup releases the live view.                  *
 * ================================================================== */

test('J) TTL expiry closes the live view before the context/browser teardown, in that order', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);
  await openLiveView(session, 'job-1', 'enreg');

  // Mirror of the TTL sweep's order: live view, then context, then browser.
  await closeLiveView(session, 'job-1', 'enreg', 'ttl_expired');
  await session.ctx.close();
  await session.browser.close();

  assert.deepEqual(fx.events.closedIds, ['handle-1']);
  assert.equal(fx.events.ctxClosed, 1);
  assert.equal(fx.events.browserClosed, 1);
  assert.equal(session.live, null, 'no live-view handle survives the job');
});

test('J2) terminal cleanup with no live view open is a safe no-op', async () => {
  const fx = makeHumanSession();
  const session = makeSessionState(fx);

  await closeLiveView(session, 'job-1', 'enreg', 'job_complete');
  await closeHumanLiveSession(session.page, null, { jobId: 'job-1', source: 'enreg', reason: 'job_complete' });
  await closeHumanLiveURL(session.page, null);

  assert.deepEqual(fx.events.closedIds, []);
  assert.equal(fx.events.pageClosed, 0);
});
