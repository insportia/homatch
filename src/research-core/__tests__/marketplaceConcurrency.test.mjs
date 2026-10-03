// MARKETPLACE SEARCH — concurrent orchestration and complete result access.
//
// Workers run in PARALLEL with independent leases, retries and failure
// boundaries, inside per-provider and global bounds; results become visible as
// each worker finishes; and ranking never hides a valid matching property.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  claimSlots, inFlight, leaseUntil, reapDecision, retryDecision,
  DEFAULT_MAX_ATTEMPTS,
} from '../marketplace/dispatch.ts';
import { deriveSearchStatus } from '../marketplace/lifecycle.ts';
import { pageResults, processSearch, RESULT_GROUPS } from '../marketplace/pipeline.ts';
import { buildFactSheets, RESULTS_INTELLIGENCE_LIMIT } from '../marketplace/results-intelligence.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

const NOW = F.FIXTURE_NOW;
const at = (s) => new Date(NOW.getTime() + s * 1000).toISOString();
const run = (over) => ({ id: 'r', workerId: 'w', status: 'SEARCHING', attempts: 1, returnedCount: 0, leaseExpiresAt: at(60), deadlineAt: at(600), ...over });

test('claim slots never exceed the per-provider or the global bound, and are never negative', () => {
  assert.equal(claimSlots({ requested: 5, workerLimit: 2, workerInFlight: 0, globalLimit: 40, globalInFlight: 0 }), 2);
  assert.equal(claimSlots({ requested: 5, workerLimit: 2, workerInFlight: 2, globalLimit: 40, globalInFlight: 2 }), 0);
  assert.equal(claimSlots({ requested: 5, workerLimit: 10, workerInFlight: 0, globalLimit: 3, globalInFlight: 2 }), 1);
  assert.equal(claimSlots({ requested: 5, workerLimit: 10, workerInFlight: 0, globalLimit: 3, globalInFlight: 9 }), 0);
  assert.equal(claimSlots({ requested: 999, workerLimit: 50, workerInFlight: 0, globalLimit: 100, globalInFlight: 0 }), 20);
});

test('only live leases count as in flight', () => {
  const f = inFlight([
    run({ id: 'a', workerId: 'w1' }), run({ id: 'b', workerId: 'w1', leaseExpiresAt: at(-1) }),
    run({ id: 'c', workerId: 'w2', status: 'RESULTS_RECEIVED' }), run({ id: 'd', workerId: 'w2', status: 'COMPLETE' }), run({ id: 'e', workerId: 'w3', status: 'QUEUED', leaseExpiresAt: null }),
  ], NOW);
  assert.equal(f.global, 2);
  assert.equal(f.byWorker.get('w1'), 1);
  assert.equal(f.byWorker.get('w2'), 1);
});

test('independent failure boundaries: expired lease retries, keeps delivered results, closes at the deadline', () => {
  assert.equal(reapDecision(run({}), NOW), null, 'a live lease is left alone');
  assert.deepEqual(reapDecision(run({ leaseExpiresAt: at(-1), attempts: 1 }), NOW), { action: 'REQUEUE' });
  assert.equal(reapDecision(run({ leaseExpiresAt: at(-1), attempts: DEFAULT_MAX_ATTEMPTS }), NOW).status, 'FAILED');
  assert.equal(reapDecision(run({ leaseExpiresAt: at(-1), returnedCount: 7 }), NOW).status, 'PARTIAL', 'delivered results are never thrown away');
  assert.equal(reapDecision(run({ deadlineAt: at(-1) }), NOW).status, 'TIMED_OUT');
  assert.equal(reapDecision(run({ deadlineAt: at(-1), returnedCount: 3 }), NOW).status, 'PARTIAL');
  assert.equal(reapDecision(run({ status: 'COMPLETE', leaseExpiresAt: at(-100) }), NOW), null);
  assert.equal(reapDecision(run({ status: 'QUEUED', leaseExpiresAt: null }), NOW), null, 'queued in time is not a failure');
});

test('retries: only transient, only within budget and deadline, never after results', () => {
  const r = { attempts: 1, deadlineAt: at(300), returnedCount: 0 };
  assert.equal(retryDecision(r, true, NOW), 'REQUEUE');
  assert.equal(retryDecision(r, false, NOW), 'FAIL');
  assert.equal(retryDecision({ ...r, attempts: DEFAULT_MAX_ATTEMPTS }, true, NOW), 'FAIL');
  assert.equal(retryDecision({ ...r, deadlineAt: at(-1) }, true, NOW), 'FAIL');
  assert.equal(retryDecision({ ...r, returnedCount: 2 }, true, NOW), 'FAIL');
  assert.equal(leaseUntil(NOW, at(30), 120), at(30), 'a lease never outlives the run');
});

/*
 * A deterministic scheduler over the policy: five searches × four workers, each
 * worker with its own speed and fate. Every tick, every worker claims what the
 * bounds allow; nobody waits for anybody else.
 */
test('simulation: all eligible workers run in parallel within bounds; a slow, blocked or failing worker never delays the others', () => {
  const workers = {
    fast: { limit: 2, ticks: 1, fate: 'COMPLETE' },
    slow: { limit: 2, ticks: 6, fate: 'COMPLETE' },
    blocked: { limit: 1, ticks: Infinity, fate: 'BLOCKED' },
    flaky: { limit: 2, ticks: 2, fate: 'FAILED_ONCE' },
  };
  const GLOBAL = 6;
  const runs = [];
  for (let s = 0; s < 5; s++) for (const w of Object.keys(workers)) runs.push({ id: `${s}-${w}`, search: s, workerId: w, status: 'QUEUED', attempts: 0, startedAt: null, finishedAt: null, failedOnce: false });
  let maxGlobal = 0;
  const maxPer = {};
  for (let tick = 0; tick < 40 && runs.some((r) => r.status === 'QUEUED' || r.status === 'SEARCHING'); tick++) {
    for (const r of runs.filter((x) => x.status === 'SEARCHING')) {
      const w = workers[r.workerId];
      if (tick - r.startedAt < w.ticks) continue;
      if (w.fate === 'FAILED_ONCE' && !r.failedOnce) { r.failedOnce = true; r.status = 'QUEUED'; continue; }
      r.status = 'COMPLETE';
      r.finishedAt = tick;
    }
    for (const [id, w] of Object.entries(workers)) {
      const live = runs.filter((x) => x.status === 'SEARCHING');
      const slots = claimSlots({ requested: 5, workerLimit: w.limit, workerInFlight: live.filter((x) => x.workerId === id).length, globalLimit: GLOBAL, globalInFlight: live.length });
      for (const r of runs.filter((x) => x.workerId === id && x.status === 'QUEUED').slice(0, slots)) {
        r.status = 'SEARCHING'; r.startedAt = tick; r.firstStartedAt ??= tick; r.attempts += 1;
      }
    }
    const live = runs.filter((x) => x.status === 'SEARCHING');
    maxGlobal = Math.max(maxGlobal, live.length);
    for (const id of Object.keys(workers)) maxPer[id] = Math.max(maxPer[id] ?? 0, live.filter((x) => x.workerId === id).length);
  }
  assert.ok(maxGlobal <= GLOBAL, `global bound ${maxGlobal}`);
  for (const [id, w] of Object.entries(workers)) assert.ok(maxPer[id] <= w.limit, `${id} bound ${maxPer[id]}`);
  const startedAtZero = new Set(runs.filter((r) => r.firstStartedAt === 0).map((r) => r.workerId));
  assert.deepEqual([...startedAtZero].sort(), ['blocked', 'fast', 'flaky', 'slow'], 'every worker starts at once; none waits for another');
  for (let s = 0; s < 5; s++) {
    const fast = runs.find((r) => r.search === s && r.workerId === 'fast');
    const slow = runs.find((r) => r.search === s && r.workerId === 'slow');
    assert.ok(fast.finishedAt < slow.finishedAt, 'the fast worker finishes first in every search');
  }
  assert.ok(runs.filter((r) => r.workerId === 'blocked').every((r) => r.status !== 'COMPLETE'), 'the blocked worker never completes');
  assert.ok(runs.filter((r) => r.workerId === 'flaky').every((r) => r.status === 'COMPLETE' && r.attempts === 2), 'the transient failure was retried');
});

test('progressive: the first worker’s results are processed and visible while others are still searching or blocked', () => {
  const fastOnly = F.SAME_PROPERTY_THREE_SOURCES.slice(0, 1);
  const out = processSearch({ request: { ...F.FIXTURE_REQUEST, priceMaxUsd: 190000 }, candidates: F.fixtureCandidates(fastOnly), now: NOW });
  const status = deriveSearchStatus('SEARCHING', [
    { workerId: 'fast', status: 'COMPLETE', deadlineAt: at(300), returnedCount: 1 },
    { workerId: 'slow', status: 'SEARCHING', deadlineAt: at(300), returnedCount: 0 },
    { workerId: 'blocked', status: 'BLOCKED', deadlineAt: at(300), returnedCount: 0 },
  ], { properties: out.properties.length, strongMatches: out.stats.strongMatches });
  assert.equal(out.properties.length, 1);
  assert.equal(status.status, 'RESULTS_AVAILABLE');
  /* When the slow worker reports, the same property gains its other listings: merged, not duplicated. */
  const later = processSearch({ request: { ...F.FIXTURE_REQUEST, priceMaxUsd: 190000 }, candidates: F.fixtureCandidates(F.SAME_PROPERTY_THREE_SOURCES), now: NOW });
  assert.equal(later.properties.length, 1);
  assert.equal(later.properties[0].listings.length, 3);
});

/* 800 distinct flats that all fit the request (one source, so none can merge unseen). */
const manyValid = (n) => Array.from({ length: n }, (_, i) => F.listing({
  source: 'source-a', sourceListingId: `v${i}`, price: 130000 + (i * 37) % 40000, areaSqm: 80 + (i % 30), floor: 1 + (i % 25),
  seller: { publicPhone: `+995 5${String(20000000 + i)}`, declaredType: i % 7 === 0 ? 'OWNER' : null, sourceListingCount: i % 7 === 0 ? 1 : null },
}));

for (const n of [7, 100, 800]) {
  test(`ranking is not hiding: ${n} valid matching properties are all reachable through the pages`, () => {
    const out = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(manyValid(n)), now: NOW });
    assert.equal(out.stats.uniqueProperties, n, 'no genuine duplicates to merge');
    assert.equal(out.excluded.length, 0);
    const seen = new Set();
    for (const g of RESULT_GROUPS) {
      let offset = 0;
      for (;;) {
        const page = pageResults(out, g, offset, 24);
        for (const p of page.items) seen.add(p.key);
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
    }
    assert.equal(seen.size, n, 'every valid property is in some group and every group pages to the end');
    assert.ok(out.properties.filter((p) => p.group === 'BEST').length <= 6, 'Best matches is a ranking layer on top of the full set');
    assert.ok(buildFactSheets(out.properties).length <= RESULTS_INTELLIGENCE_LIMIT, 'OpenAI sees a few; the customer sees all');
  });
}

test('genuinely nonmatching records are the only ones filtered: wrong district, above the 10% ceiling, outside area', () => {
  const out = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(), now: NOW });
  assert.deepEqual(out.excluded.map((e) => e.reason).sort(), ['AREA', 'DISTRICT', 'PRICE_ABOVE_CEILING']);
  const valid = out.properties.length;
  assert.equal(valid + out.excluded.length, out.stats.uniqueProperties);
});

test('heartbeat extends the run’s own lease, capped at its deadline', () => {
  const first = leaseUntil(NOW, at(600), 120);
  const later = leaseUntil(new Date(NOW.getTime() + 90_000), at(600), 120);
  assert.ok(Date.parse(later) > Date.parse(first), 'a heartbeat 90 s later moves the lease forward');
  assert.equal(reapDecision(run({ leaseExpiresAt: later }), new Date(NOW.getTime() + 150_000)), null, 'the extended lease is still live after the original expiry');
  assert.equal(leaseUntil(NOW, at(60), 120), at(60));
});

test('a failed worker never suppresses another worker’s results', () => {
  const out = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(F.OTHER_LISTINGS.slice(0, 3)), now: NOW });
  const status = deriveSearchStatus('SEARCHING', [
    { workerId: 'ok', status: 'COMPLETE', deadlineAt: at(300), returnedCount: 3 },
    { workerId: 'broken', status: 'FAILED', deadlineAt: at(300), returnedCount: 0 },
    { workerId: 'late', status: 'TIMED_OUT', deadlineAt: at(-1), returnedCount: 0 },
  ], { properties: out.properties.length, strongMatches: out.stats.strongMatches });
  assert.equal(status.status, 'PARTIAL_COMPLETE');
  assert.ok(out.properties.length >= 3, 'the successful worker’s properties are all there');
});
