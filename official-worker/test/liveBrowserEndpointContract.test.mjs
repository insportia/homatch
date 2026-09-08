import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { humanLiveFields } from '../.tstest-build/browser/HumanLiveSession.js';

/*
 * LIVE-BROWSER ENDPOINT CONTRACT — frontend vs worker.
 *
 * This suite exists because the two halves of the interactive live-browser
 * feature were briefly written against DIFFERENT contracts: the shipped
 * frontend (ResearchCaptchaModal.tsx, rendered by VerifyPage.tsx) has always
 * called POST /research/:id/live, while a newly added worker route exposed
 * GET /research/:id/live-browser. Nothing in the worker's own unit tests
 * could catch that mismatch, because neither side referenced the other.
 *
 * These assertions read BOTH files off disk and pin them to one contract, so
 * renaming or re-versing the endpoint on either side fails the worker suite.
 * index.ts cannot be imported (it is excluded from tsconfig.test.json and
 * starts a listening server on import), so it is asserted as source text —
 * deliberately narrow, structural assertions, not a full parse.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const WORKER_INDEX = `${here}../src/index.ts`;
const MODAL = `${here}../../src/components/research/ResearchCaptchaModal.tsx`;

const workerSource = readFileSync(WORKER_INDEX, 'utf8');

test('the shipped frontend modal exists and is the contract of record', () => {
  assert.equal(existsSync(MODAL), true, 'ResearchCaptchaModal.tsx must exist — it is the live-view client');
});

const modalSource = readFileSync(MODAL, 'utf8');

test('frontend contract: ResearchCaptchaModal POSTs /research/:id/live with auth headers and reads liveURL', () => {
  // Method + path, exactly as shipped.
  assert.match(modalSource, /fetch\(`\$\{WORKER\}\/research\/\$\{jobId\}\/live`,\s*\{\s*method:\s*'POST'/);
  // Authenticated: a Supabase bearer token plus the apikey header.
  assert.match(modalSource, /Authorization:\s*`Bearer \$\{session\.access_token\}`/);
  assert.match(modalSource, /apikey:\s*API_KEY/);
  // Response shape it depends on: liveURL required, error surfaced on failure.
  assert.match(modalSource, /if\(!r\.ok\|\|!d\?\.liveURL\)throw new Error\(d\?\.error/);
  // It renders the URL directly; it never receives or uses a liveURLId.
  assert.equal(modalSource.includes('liveURLId'), false);
});

test('worker matches the frontend: POST /research/:id/live is registered, and the old /live-browser path is gone', () => {
  assert.match(workerSource, /app\.post\('\/research\/:id\/live',\s*auth,\s*liveBrowserHandler\)/);
  assert.equal(workerSource.includes('/research/:id/live-browser'), false, 'no second, incompatible path may survive');
});

test('worker registers GET on the SAME path and the SAME handler — one implementation, no divergent copy', () => {
  assert.match(workerSource, /app\.get\('\/research\/:id\/live',\s*auth,\s*liveBrowserHandler\)/);
  // Exactly one handler definition backs both verbs.
  assert.equal((workerSource.match(/async function liveBrowserHandler\(/g) || []).length, 1);
});

test('every live route is authenticated — an unauthenticated caller can never obtain a live URL', () => {
  const liveRoutes = workerSource.match(/app\.(get|post)\('\/research\/:id\/live'[^)]*\)/g) || [];
  assert.equal(liveRoutes.length, 2, 'exactly the two verbs on the one live path');
  for (const route of liveRoutes) {
    assert.match(route, /,\s*auth\s*,/, `live route must be behind auth: ${route}`);
  }
});

test('the live handler owns no live-session creation logic of its own — it delegates to the single orchestrator implementation', () => {
  const handler = workerSource.slice(
    workerSource.indexOf('async function liveBrowserHandler('),
    workerSource.indexOf("app.post('/research/:id/live'")
  );
  assert.match(handler, /orchestrator\.getOrCreateLiveView\(req\.params\.id\)/);
  // No duplicated CDP/liveURL minting anywhere in the HTTP layer. Matched as
  // CALL syntax (a quoted CDP method name, an actual invocation) so the
  // explanatory prose above the handler does not count as an implementation.
  assert.equal(/['"`]Browserless\.liveURL['"`]/.test(workerSource), false, 'the HTTP layer must not send the CDP command itself');
  assert.equal(/newCDPSession\s*\(/.test(workerSource), false, 'the HTTP layer must not attach its own CDP session');
});

test('the live response carries liveURL for the frontend and never a liveURLId or raw handle', () => {
  const handler = workerSource.slice(
    workerSource.indexOf('async function liveBrowserHandler('),
    workerSource.indexOf("app.post('/research/:id/live'")
  );
  assert.match(handler, /liveURL:\s*live\.liveURL/);
  assert.equal(handler.includes('liveURLId'), false);
  assert.equal(handler.includes('s.page,'), false, 'no page/context/browser handle may be serialized');
  assert.equal(handler.includes('s.browser'), false);
  assert.equal(handler.includes('s.ctx'), false);
  // Failure is reported with the `error` string the modal displays.
  assert.match(handler, /status\(503\)\.json\(\{\s*interactive:\s*false,\s*error:/);
  assert.match(handler, /status\(404\)\.json\(\{\s*error:\s*'active human session not found'/);
});

test('humanVerification.liveBrowserEndpoint points at the exact path the frontend already calls', () => {
  const fields = humanLiveFields('abc-123', {
    liveURL: 'https://production-sfo.browserless.io/live/view-1?token=x',
    liveURLId: 'handle-1',
    safeToExpose: false,
    exposureReason: 'credential_query_param',
    createdAt: 1,
  }, null);

  assert.equal(fields.liveBrowserEndpoint, '/research/abc-123/live');
  // And that path is the one the modal builds, with the job id substituted.
  const modalPath = '/research/${jobId}/live';
  assert.equal(modalSource.includes(modalPath), true);
  assert.equal(fields.liveBrowserEndpoint, modalPath.replace('${jobId}', 'abc-123'));
});

test('the screenshot/action fallback the modal falls back to remains registered and authenticated', () => {
  assert.match(workerSource, /app\.get\('\/research\/:id\/screenshot',\s*auth,/);
  assert.match(workerSource, /app\.post\('\/research\/:id\/action',\s*auth,/);
  assert.match(workerSource, /app\.post\('\/research\/:id\/resume',\s*auth,/);
  assert.match(workerSource, /app\.post\('\/research\/:id\/skip',\s*auth,/);
});

test('the modal continues to drive resume on the same job — the live view never resumes or solves anything itself', () => {
  assert.match(modalSource, /\/research\/\$\{jobId\}\/resume`,\s*\{\s*method:\s*'POST'/);
  // No solver/bypass anywhere in the live path, on either side.
  for (const source of [workerSource, modalSource]) {
    assert.equal(/solveCaptcha|captchaSolver|2captcha|anticaptcha|bypassCaptcha/i.test(source), false);
  }
});
