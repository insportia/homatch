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
  // Verify reads its stored report from the query string, so losing it would
  // land the customer on the search box instead of their report.
  assert.equal(normalizeResultRef('/verify?job=job-9'), '/verify?job=job-9');
});

test('the retired Documents-tab ref is repaired into the contract it names', () => {
  /*
   * Every contract analysis ever queued wrote `/verify/<case>?tab=documents
   * &doc=<id>`, and those refs are in the database — 2 of the 7 production
   * jobs carry one, both contract analyses. Rewriting only the producer
   * would leave every existing contract task opening the retired workspace,
   * so history is repaired on read.
   */
  assert.equal(
    normalizeResultRef('/verify/case-9?tab=documents&doc=d1'),
    '/contracts/d1'
  );
  // Order of the query parameters is not something a stored ref guarantees.
  assert.equal(
    normalizeResultRef('/verify/case-9?doc=d2&tab=documents'),
    '/contracts/d2'
  );
  // A case ref that is NOT a document ref still opens the case: the route
  // survives for compatibility and old links must not break.
  assert.equal(normalizeResultRef('/verify/case-9'), '/verify/case-9');
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

test('a container subject never reopens the workspace, and a property job goes to its matches', () => {
  // DEAL_ROOM is a storage container, not a destination. Nothing writes this
  // subject type (0 rows in production), but a historical row must still not
  // send a customer into the retired workspace.
  assert.equal(
    resolveJobDestination(job({
      productType: 'CONTRACT_ANALYSIS', subjectType: 'DEAL_ROOM', subjectId: 'case-3',
      state: 'PROCESSING', resultRef: null,
    })).to,
    '/verify'
  );
  assert.equal(
    resolveJobDestination(job({
      productType: 'FIND_CLIENTS', subjectType: 'PROPERTY', subjectId: 'p-4',
      state: 'PROCESSING', resultRef: null,
    })).to,
    '/property/p-4/matches'
  );
});

test('a document id alone IS an address now, because a contract has its own page', () => {
  /*
   * THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, ON PURPOSE.
   *
   * It read "a document id alone is never turned into a path", because the
   * reader opened inside a verification case and the case id lived only on
   * the stored ref — so a document id could not name a page and inventing
   * /document/<id> would have been a guess.
   *
   * Contracts is a product now and /contracts/:id is a real route, so the
   * subject id is a complete address and a job whose ref was lost is
   * recoverable instead of being dumped at a product's front door.
   */
  const d = resolveJobDestination(job({
    productType: 'DOCUMENT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'PROCESSING', resultRef: null,
  }));
  assert.equal(d.to, '/contracts/doc-1');
  assert.equal(d.kind, 'WORKSPACE');

  // Still never a guess: an id that cannot be encoded is still an id.
  assert.equal(
    resolveJobDestination(job({
      productType: 'DOCUMENT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: '  ',
      state: 'PROCESSING', resultRef: null,
    })).to,
    '/contracts'
  );
});

/* ------------------------------------------------------------------ *
 * Every registered product has an owning service.                     *
 * ------------------------------------------------------------------ */

test('each product type falls back to its own service, never to another product', () => {
  const expected = {
    VERIFY: '/verify',
    // Contracts owns contract analysis. These pointed at Verify when a
    // contract was something that happened inside a verification case.
    DOCUMENT_ANALYSIS: '/contracts',
    CONTRACT_ANALYSIS: '/contracts',
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
  // The ref as it is stored in the database today — the retired shape — so
  // this exercises the repair a real production job depends on.
  const stored = '/verify/case-1?tab=documents&doc=doc-1';
  const expected = '/contracts/doc-1';

  const running = resolveJobDestination({
    productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'PROCESSING', resultRef: stored,
  });
  assert.equal(running.to, expected, 'a running contract opens where it will finish');
  assert.equal(running.labelKey, 'job_open_workspace');

  const done = resolveJobDestination({
    productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
    state: 'COMPLETED', resultRef: stored,
  });
  assert.equal(done.to, expected, 'the CTA must return to this exact contract');
  assert.equal(done.labelKey, 'job_open_result');

  // And a ref written since the change needs no repair at all.
  assert.equal(
    resolveJobDestination({
      productType: 'CONTRACT_ANALYSIS', subjectType: 'DOCUMENT', subjectId: 'doc-1',
      state: 'COMPLETED', resultRef: expected,
    }).to,
    expected
  );
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
  // Bounded by the next top-level declaration, so removing any one
  // neighbouring function cannot silently empty this slice.
  const body = code.slice(start, code.indexOf('\nconst ', start + 1));

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

test('a finished verification always offers a next step, and never fails silently', () => {
  const page = fs.readFileSync(path.resolve(here, '../../pages/VerifyPage.tsx'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* ------------------------------------------------------------------ *
   * WHAT THIS TEST USED TO GUARD, AND WHY IT MOVED.                     *
   *                                                                     *
   * It asserted a "Continue Verification" button that navigated to      *
   * /verify/:id — the Verification Case, the customer-facing Deal Room. *
   * That workspace is no longer part of the customer journey: a         *
   * verification persists by itself, so there was never anything for    *
   * the customer to file, and contracts are their own product now.      *
   *                                                                     *
   * The REQUIREMENT behind the old assertion is unchanged and is        *
   * asserted below in its new home: a completed report must end with a  *
   * concrete next step, and a failed save must still reach the screen   *
   * rather than dying in a silent catch.                                *
   * ------------------------------------------------------------------ */

  // The next step is the contract for the property just verified, and it
  // carries the property with it — a handoff that dropped the context would
  // make Contracts read the document in isolation, which is the whole point
  // of connecting the two products.
  // The report's next step is the contract for this property, and it is
  // offered ONCE: the report's own upload card, which attaches the document
  // to this verification's container and opens it in Contracts. A second
  // button beside it was the duplication this product keeps growing back.
  const upload = fs.readFileSync(
    path.resolve(here, '../../components/verify/ContractUpload.tsx'), 'utf8');
  assert.match(upload, /navigate\(`\/contracts\/\$\{documentId\}`/,
    'a contract must open in Contracts, not in the retired workspace');
  assert.equal(
    /\/verify\/\$\{targetCase\}\?tab=documents/.test(upload), false,
    'the Documents tab is a surface the customer no longer sees'
  );

  // A save that fails still says so, in the same place it always did.
  // Matched on the requirement, not the punctuation around it: the
  // condition in front of this has changed twice already.
  assert.match(code, /caseErr\?<p role="alert"/,
    'a save failure must remain visible');

  // And the automatic save stays the silent one: the customer is not asked
  // to file anything, so it must never interrupt them.
  assert.match(code, /void saveCase\(id,data\.result_json,\{silent:true\}\)/,
    'the background save must stay silent');

  // The retired destination must not come back by accident.
  assert.equal(
    /continueCase/.test(code), false,
    'the Verification Case button belonged to a surface the customer no longer sees'
  );
});
