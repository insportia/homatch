import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserDisconnectedError } from '../.tstest-build/browser/BrowserlessRuntime.js';

/*
 * ResearchOrchestrator.ts cannot be imported here: it is deliberately
 * excluded from tsconfig.test.json (it, and files it transitively imports
 * such as TasWorkflow.ts -> TasResultExhauster.ts, use the DOM lib that
 * tsconfig.test.json's `lib` intentionally omits — confirmed by trial-adding
 * it to the excludes list, which produced `Cannot find name 'document'` /
 * `window` / `HTMLElement` errors, not any error in ResearchOrchestrator.ts
 * itself). This matches the repo's existing convention (see
 * supabase/functions/tests/*.node-test.mjs) of testing genuinely
 * un-importable pure logic via a verbatim copy, kept in sync by hand.
 *
 * The two blocks below are verbatim copies of:
 *  - buildTechnicalFailureResult() (ResearchOrchestrator.ts, module scope,
 *    just above the `export class ResearchOrchestrator` line)
 *  - the bounded-reconnect decision inside runStep()'s catch block
 *    (ResearchOrchestrator.ts, private async runStep(), the try/catch
 *    around acquirePage())
 *
 * If either changes in ResearchOrchestrator.ts, this copy must be updated
 * to match or these tests will validate the wrong thing.
 */

function now() {
  return new Date().toISOString();
}

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

const MAX_BROWSERLESS_RECONNECTS_PER_JOB = 1;

// Verbatim mirror of runStep()'s catch-block decision: given the current
// per-job reconnect count, an error, and whether this job is on a shared
// Browserless context, decide whether to attempt exactly one reconnect or
// fall straight to a per-source technical failure.
function decideReconnect(reconnectsUsedMap, jobId, sharedBrowserlessContext, error) {
  const reconnectsUsed = reconnectsUsedMap.get(jobId) || 0;
  if (
    sharedBrowserlessContext &&
    error instanceof BrowserDisconnectedError &&
    reconnectsUsed < MAX_BROWSERLESS_RECONNECTS_PER_JOB
  ) {
    reconnectsUsedMap.set(jobId, reconnectsUsed + 1);
    return { shouldReconnect: true, attempt: reconnectsUsed + 1 };
  }
  return { shouldReconnect: false, attempt: reconnectsUsed };
}

test('buildTechnicalFailureResult: status is FAILED at the source level, never a whole-job crash shape, and carries the error message', () => {
  const result = buildTechnicalFailureResult('tas', { name: 'John Doe', idCode: '01008000000' }, new Error('boom'));
  assert.equal(result.source, 'tas');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.resultConfirmed, false);
  assert.equal(result.noResultConfirmed, false);
  assert.equal(result.resultValidated, false);
  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.discoveredEntities, []);
  assert.equal(result.forEntity.idCode, '01008000000');
  assert.match(result.error, /boom/);
  // Critically: this shape carries no confirmed/negative finding about the
  // property itself (mandate: NO EVIDENCE = NO FACT) — it is a statement
  // about the SOURCE failing, not about the property.
  assert.equal('propertyRisk' in result, false);
  assert.equal('verdict' in result, false);
});

test('buildTechnicalFailureResult: works with forEntity = null (cadastral job-query steps, not per-entity steps)', () => {
  const result = buildTechnicalFailureResult('TAS_MAP', null, new Error('context dead'));
  assert.equal(result.forEntity, null);
  assert.equal(result.status, 'FAILED');
});

test('bounded reconnect: a BrowserDisconnectedError on a shared Browserless context gets exactly one reconnect attempt', () => {
  const reconnectsUsedMap = new Map();
  const jobId = 'job-1';
  const decision = decideReconnect(reconnectsUsedMap, jobId, true, new BrowserDisconnectedError('gone'));
  assert.equal(decision.shouldReconnect, true);
  assert.equal(decision.attempt, 1);
  assert.equal(reconnectsUsedMap.get(jobId), 1);
});

test('bounded reconnect: a SECOND BrowserDisconnectedError in the same job is refused — the budget is once per job, not once per source', () => {
  const reconnectsUsedMap = new Map();
  const jobId = 'job-1';
  decideReconnect(reconnectsUsedMap, jobId, true, new BrowserDisconnectedError('gone'));
  const second = decideReconnect(reconnectsUsedMap, jobId, true, new BrowserDisconnectedError('gone again'));
  assert.equal(second.shouldReconnect, false);
  assert.equal(reconnectsUsedMap.get(jobId), 1); // unchanged — no further increment
});

test('bounded reconnect: a non-BrowserDisconnectedError never triggers a reconnect, even with budget remaining (e.g. a workflow-logic exception must not be mistaken for a dead browser)', () => {
  const reconnectsUsedMap = new Map();
  const decision = decideReconnect(reconnectsUsedMap, 'job-2', true, new Error('selector not found'));
  assert.equal(decision.shouldReconnect, false);
  assert.equal(reconnectsUsedMap.has('job-2'), false);
});

test('bounded reconnect: local (non-Browserless) mode never attempts a reconnect even for a BrowserDisconnectedError-shaped error', () => {
  const reconnectsUsedMap = new Map();
  const decision = decideReconnect(reconnectsUsedMap, 'job-3', false, new BrowserDisconnectedError('gone'));
  assert.equal(decision.shouldReconnect, false);
});

test('bounded reconnect: budgets are tracked independently per job id — one job exhausting its budget does not affect another', () => {
  const reconnectsUsedMap = new Map();
  decideReconnect(reconnectsUsedMap, 'job-A', true, new BrowserDisconnectedError('gone'));
  const forJobB = decideReconnect(reconnectsUsedMap, 'job-B', true, new BrowserDisconnectedError('gone'));
  assert.equal(forJobB.shouldReconnect, true);
  assert.equal(reconnectsUsedMap.get('job-A'), 1);
  assert.equal(reconnectsUsedMap.get('job-B'), 1);
});

test('bounded reconnect: job completion clears the budget (Map.delete), so a later job with the same id (should not happen, but must not inherit a stale budget) starts fresh', () => {
  const reconnectsUsedMap = new Map();
  decideReconnect(reconnectsUsedMap, 'job-1', true, new BrowserDisconnectedError('gone'));
  assert.equal(reconnectsUsedMap.get('job-1'), 1);
  reconnectsUsedMap.delete('job-1'); // mirrors run()'s COMPLETE/FAILED branches and the TTL sweep
  assert.equal(reconnectsUsedMap.has('job-1'), false);
  const decision = decideReconnect(reconnectsUsedMap, 'job-1', true, new BrowserDisconnectedError('gone'));
  assert.equal(decision.shouldReconnect, true);
});
