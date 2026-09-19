import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveJobDestination, normalizeResultRef, isKnownRoute,
} from '../destination.ts';

/*
 * WHERE A TASK IN THE DRAWER GOES.
 *
 * The drawer's only navigation was `navigate(job.resultRef)` behind a
 * COMPLETED/PARTIAL gate. Two production consequences, both covered here:
 *
 *   - a RUNNING task offered no way back to its own workspace at all;
 *   - FIND_CLIENTS rows carry `/properties/<id>/matches`, which is not a
 *     registered route, so every finished client search navigated to the
 *     404 page. Nothing validated the stored path, so nothing caught it.
 *
 * These tests are the validation that was missing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_SRC = fs.readFileSync(path.resolve(here, '../../routes.tsx'), 'utf8');

const job = (over = {}) => ({
  productType: 'VERIFY',
  subjectType: 'RESEARCH_JOB',
  subjectId: 'job-1',
  state: 'COMPLETED',
  resultRef: null,
  ...over,
});

/* ------------------------------------------------------------------ *
 * The allowlist must describe routes that really exist.               *
 * ------------------------------------------------------------------ */

test('every route the resolver can navigate to is registered in routes.tsx', () => {
  // Same guard notificationProducts.test.mjs applies to notification deep
  // links, now covering task destinations — which previously had none.
  const registered = new Set(
    [...ROUTES_SRC.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
  );
  // Probe each pattern through the resolver's own matcher.
  const probes = [
    '/verify', '/verify/abc', '/investment', '/mortgage',
    '/property/abc', '/property/abc/matches', '/dashboard',
    '/activity', '/outreach', '/outreach/email', '/outreach/calls',
    '/active-search',
  ];
  for (const p of probes) {
    assert.equal(isKnownRoute(p), true, `${p} must be recognised by the resolver`);
    // …and the corresponding pattern must exist in the real router.
    const pattern = p.replace(/\/abc/g, '/:id');
    const ok = registered.has(pattern) || registered.has(p);
    assert.equal(ok, true, `${pattern} must be a registered route`);
  }
});

test('a path that is not a registered route is refused', () => {
  assert.equal(isKnownRoute('/properties/abc/matches'), false);
  assert.equal(isKnownRoute('/verify/abc/extra'), false);
  assert.equal(isKnownRoute('/nope'), false);
  assert.equal(normalizeResultRef('/nope'), null);
});

/* ------------------------------------------------------------------ *
 * The stored ref: repaired, validated, or refused.                    *
 * ------------------------------------------------------------------ */

test('the legacy plural client-search path is rewritten, not followed', () => {
  // The exact string production wrote for every FIND_CLIENTS job.
  assert.equal(
    normalizeResultRef('/properties/11111111-2222-3333-4444-555555555555/matches'),
    '/property/11111111-2222-3333-4444-555555555555/matches'
  );
  const d = resolveJobDestination(job({
    productType: 'FIND_CLIENTS', subjectType: 'PROPERTY', subjectId: 'p1',
    state: 'COMPLETED', resultRef: '/properties/p1/matches',
  }));
  assert.equal(d.to, '/property/p1/matches');
  assert.equal(d.kind, 'RESULT');
  assert.equal(d.labelKey, 'job_open_result');
});

test('a query string on a valid ref is preserved', () => {
  assert.equal(
    normalizeResultRef('/verify/case-9?tab=documents&doc=d1'),
    '/verify/case-9?tab=documents&doc=d1'
  );
});

test('an off-site or protocol-relative ref can never reach navigate()', () => {
  for (const evil of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', '', '   ']) {
    assert.equal(normalizeResultRef(evil), null, `${JSON.stringify(evil)} must be refused`);
  }
});

/* ------------------------------------------------------------------ *
 * Priority: result → workspace → service → generic.                   *
 * ------------------------------------------------------------------ */

test('a finished job with a valid ref offers the exact result', () => {
  const d = resolveJobDestination(job({ state: 'COMPLETED', resultRef: '/verify?job=abc' }));
  assert.equal(d.to, '/verify?job=abc');
  assert.equal(d.kind, 'RESULT');
  assert.equal(d.labelKey, 'job_open_result');
});

test('a PARTIAL job is readable and therefore offers its result', () => {
  const d = resolveJobDestination(job({ state: 'PARTIAL', resultRef: '/verify?job=abc' }));
  assert.equal(d.kind, 'RESULT');
  assert.equal(d.labelKey, 'job_open_result');
});

test('a RUNNING job offers its workspace — the case that had no button at all', () => {
  for (const state of ['QUEUED', 'STARTING', 'CANCELLABLE', 'COMMITTED', 'PROCESSING']) {
    const d = resolveJobDestination(job({ state, resultRef: '/verify?job=abc' }));
    assert.ok(d, `${state} must offer a destination`);
    assert.equal(d.to, '/verify?job=abc');
    assert.equal(d.kind, 'WORKSPACE');
    assert.equal(d.labelKey, 'job_open_workspace');
  }
});

test('a running job with no stored ref is rebuilt from its own subject', () => {
  const d = resolveJobDestination(job({ state: 'PROCESSING', resultRef: null, subjectId: 'r-7' }));
  assert.equal(d.to, '/verify?job=r-7');
  assert.equal(d.kind, 'WORKSPACE');
});

test('a document job rebuilds to its case, and a property job to its matches', () => {
  assert.equal(
    resolveJobDestination(job({
      productType: 'CONTRACT_ANALYSIS', subjectType: 'DEAL_ROOM', subjectId: 'case-3',
      state: 'PROCESSING', resultRef: null,
    })).to,
    '/verify/case-3'
  );
  assert.equal(
    resolveJobDestination(job({
      productType: 'FIND_CLIENTS', subjectType: 'PROPERTY', subjectId: 'p-4',
      state: 'PROCESSING', resultRef: null,
    })).to,
    '/property/p-4/matches'
  );
});

test('a document id alone is never turned into a path', () => {
  // DOCUMENT cannot address a page without its case id; the resolver must
  // fall through to the owning service rather than invent /document/<id>.
  const d = resolveJobDestination(job({
    productType: 'DOCUMENT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'PROCESSING', resultRef: null,
  }));
  assert.equal(d.to, '/verify');
  assert.equal(d.kind, 'SERVICE');
});

/* ------------------------------------------------------------------ *
 * Every registered product has an owning service.                     *
 * ------------------------------------------------------------------ */

test('each product type falls back to its own service, never to another product', () => {
  const expected = {
    VERIFY: '/verify',
    DOCUMENT_ANALYSIS: '/verify',
    CONTRACT_ANALYSIS: '/verify',
    MARKET_RESEARCH: '/verify',
    LOCATION_RESEARCH: '/verify',
    FIND_CLIENTS: '/dashboard',
    AI_ENRICHMENT: '/outreach',
    EMAIL_CAMPAIGN: '/outreach/email',
    AI_CALL: '/outreach/calls',
  };
  for (const [product, to] of Object.entries(expected)) {
    const d = resolveJobDestination(job({
      productType: product, subjectType: null, subjectId: null,
      state: 'PROCESSING', resultRef: null,
    }));
    assert.ok(d, `${product} must resolve somewhere`);
    assert.equal(d.to, to, `${product} must go to its own service`);
    assert.equal(d.kind, 'SERVICE');
  }
});

/* ------------------------------------------------------------------ *
 * Unknown, cancelled, failed.                                         *
 * ------------------------------------------------------------------ */

test('an unknown product never guesses — running gets no button, finished gets activity', () => {
  assert.equal(
    resolveJobDestination(job({
      productType: 'SOME_FUTURE_PRODUCT', subjectType: null, subjectId: null,
      state: 'PROCESSING', resultRef: null,
    })),
    null,
    'a running unknown task must offer nothing rather than a guess'
  );
  const finished = resolveJobDestination(job({
    productType: 'SOME_FUTURE_PRODUCT', subjectType: null, subjectId: null,
    state: 'COMPLETED', resultRef: null,
  }));
  assert.equal(finished.to, '/activity');
  assert.equal(finished.kind, 'GENERIC');
  assert.equal(finished.labelKey, 'job_open_activity');
});

test('a cancelled job never offers a button', () => {
  for (const ref of ['/verify?job=abc', null]) {
    assert.equal(resolveJobDestination(job({ state: 'CANCELLED', resultRef: ref })), null);
  }
});

test('a failed job offers retry only where the destination can recover', () => {
  const recoverable = resolveJobDestination(job({ state: 'FAILED', resultRef: '/verify?job=abc' }));
  assert.equal(recoverable.labelKey, 'job_review_retry');
  // A bare service landing page cannot retry anything, so no button.
  assert.equal(
    resolveJobDestination(job({
      productType: 'AI_CALL', subjectType: null, subjectId: null,
      state: 'FAILED', resultRef: null,
    })),
    null
  );
});

/* ------------------------------------------------------------------ *
 * The real cases named in the brief.                                  *
 * ------------------------------------------------------------------ */

test('the Villion cadastral verification is one click from the drawer', () => {
  // The row production writes: VerifyPage.tsx start → resultRef /verify?job=<id>
  const d = resolveJobDestination({
    productType: 'VERIFY',
    subjectType: 'RESEARCH_JOB',
    subjectId: 'e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c',
    state: 'COMPLETED',
    resultRef: '/verify?job=e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c',
  });
  assert.equal(d.to, '/verify?job=e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c');
  assert.equal(d.kind, 'RESULT');
  assert.equal(d.labelKey, 'job_open_result');
});

test('a contract analysis is one click while running and when finished', () => {
  const ref = '/verify/case-1?tab=documents&doc=doc-1';
  const running = resolveJobDestination({
    productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'PROCESSING', resultRef: ref,
  });
  assert.equal(running.to, ref);
  assert.equal(running.labelKey, 'job_open_workspace');

  const done = resolveJobDestination({
    productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'COMPLETED', resultRef: ref,
  });
  assert.equal(done.to, ref, 'the CTA must return to this exact contract');
  assert.equal(done.labelKey, 'job_open_result');
});

/* ------------------------------------------------------------------ *
 * The drawer must use the resolver, not its own navigation.           *
 * ------------------------------------------------------------------ */

test('JobCenter navigates through the resolver and nothing else', () => {
  const src = fs.readFileSync(path.resolve(here, '../../components/jobs/JobCenter.tsx'), 'utf8');
  assert.match(src, /resolveJobDestination\(job\)/);
  // Comments explain the old behaviour; only executable code is checked.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /navigate\(job\.resultRef\)/.test(code), false,
    'the raw stored ref must never be navigated to directly'
  );
  assert.match(src, /navigate\(destination\.to\)/);
});

test('no producer writes the plural client-search path any more', () => {
  const api = fs.readFileSync(path.resolve(here, '../../services/api.ts'), 'utf8');
  const worker = fs.readFileSync(
    path.resolve(here, '../../../supabase/functions/jobs-worker/index.ts'), 'utf8'
  );
  for (const [name, src] of [['api.ts', api], ['jobs-worker', worker]]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /`\/properties\/\$\{/.test(code), false,
      `${name} must not write the plural /properties/ result ref`
    );
  }
});

/* ------------------------------------------------------------------ *
 * CONTINUE VERIFICATION — P0 from the live Villion report.            *
 *                                                                     *
 * The customer pressed it and nothing happened. saveCase()'s catch    *
 * block was empty apart from a comment claiming the failure was       *
 * "left to the explicit button below" — but that button calls the     *
 * same function, so the explicit press failed identically and just as *
 * silently. No error, no state change, the button re-enabled itself.  *
 * ------------------------------------------------------------------ */

test('saving a verification can never fail silently', () => {
  const page = fs.readFileSync(path.resolve(here, '../../pages/VerifyPage.tsx'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const start = code.indexOf('const saveCase=');
  assert.notEqual(start, -1, 'saveCase must exist');
  const body = code.slice(start, code.indexOf('const continueCase=', start));

  // The exact shape of the defect: a catch that does nothing at all.
  assert.equal(
    /catch\s*\{\s*\}/.test(body), false,
    'an empty catch is what produced the silent click'
  );
  assert.match(body, /setCaseErr\(/, 'a failure must reach the screen');
  // A background save stays quiet; an explicit one reports.
  assert.match(body, /opts\?\.silent/, 'the automatic save must be distinguishable');
  // One press, one case.
  assert.match(body, /savingRef\.current/, 'a double press must not create two cases');
});

test('the continue action always produces a visible outcome', () => {
  const page = fs.readFileSync(path.resolve(here, '../../pages/VerifyPage.tsx'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const start = code.indexOf('const continueCase=');
  assert.notEqual(start, -1, 'continueCase must exist');
  const body = code.slice(start, start + 400);
  // Existing case → go there. No case → create it, then go.
  assert.match(body, /if\(caseId\)\{nav\(`\/verify\/\$\{caseId\}`\)/);
  assert.match(body, /await saveCase\(undefined,undefined,\{silent:false\}\)/);
  assert.match(body, /if\(id\)nav\(`\/verify\/\$\{id\}`\)/);

  // The button is bound to it, is disabled while busy, and renders the error.
  assert.match(code, /onClick=\{\(\)=>\{void continueCase\(\)\}\}/);
  assert.match(code, /disabled=\{savingCase\}/);
  assert.match(code, /\{caseErr\?<p role="alert"/);
  // And the automatic save is the silent one.
  assert.match(code, /void saveCase\(id,data\.result_json,\{silent:true\}\)/);
});
