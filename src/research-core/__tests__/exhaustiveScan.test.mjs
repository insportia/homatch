// Native matching scans: every row exactly once, deterministic order, bounded
// pages, resumable at a deadline, retried on a transient error — at 500, 5k,
// 10k and 100k rows. The old worker read 500 and retired the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanAll, chunk, withRetry, scanStartedAt, RETIRE_CLOCK_MARGIN_MS } from '../match/exhaustiveScan.ts';

const ids = (n) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(7, '0')}`);
const source = (all, { failEvery = 0 } = {}) => {
  let calls = 0;
  return {
    get calls() { return calls; },
    fetchPage: async (after, size) => {
      calls += 1;
      if (failEvery && calls % failEvery === 0) throw new Error('transient');
      // the same contract as `.gt('id', after).order('id').limit(size)`
      let lo = 0, hi = all.length;
      if (after !== null) { while (lo < hi) { const mid = (lo + hi) >> 1; if (all[mid] <= after) lo = mid + 1; else hi = mid; } } else lo = 0;
      return all.slice(lo, lo + size);
    },
  };
};

for (const n of [0, 1, 499, 500, 501, 5_000, 10_000, 100_000]) {
  test(`${n} rows: each visited exactly once, in order, pages bounded`, async () => {
    const all = ids(n); const seen = [];
    const t0 = performance.now();
    const r = await scanAll({ ...source(all), keyOf: (x) => x, pageSize: 500, onPage: (rows) => { seen.push(...rows); } });
    const ms = performance.now() - t0;
    assert.equal(r.complete, true);
    assert.equal(r.rows, n);
    assert.deepEqual(seen, all);
    assert.ok(r.maxPageRows <= 500);
    if (n === 100_000) console.log(`# benchmark: 100k-row keyset scan in ${ms.toFixed(1)} ms, ${r.pages} pages`);
  });
}

test('a deadline stops between pages; resuming from the cursor finishes with no gap and no duplicate', async () => {
  const all = ids(10_000); const seen = [];
  let clock = 0;
  const src = source(all);
  const first = await scanAll({ ...src, keyOf: (x) => x, pageSize: 500, now: () => clock, deadlineAt: 3,
    onPage: (rows) => { seen.push(...rows); clock += 1; } });
  assert.equal(first.complete, false);
  assert.equal(first.rows, 1_500);
  const second = await scanAll({ ...src, keyOf: (x) => x, pageSize: 500, startAfter: first.cursor, onPage: (rows) => { seen.push(...rows); } });
  assert.equal(second.complete, true);
  assert.deepEqual(seen, all);
});

test('transient page errors are retried; persistent ones throw instead of looking like "no rows"', async () => {
  const all = ids(5_000); const seen = [];
  const r = await scanAll({ ...source(all, { failEvery: 3 }), keyOf: (x) => x, pageSize: 500, sleep: async () => {}, onPage: (rows) => { seen.push(...rows); } });
  assert.equal(r.complete, true);
  assert.ok(r.retried > 0);
  assert.deepEqual(seen, all);
  await assert.rejects(scanAll({ fetchPage: async () => { throw new Error('down'); }, keyOf: (x) => x, onPage: () => {}, sleep: async () => {} }), /down/);
});

test('a page handler failure does not advance the cursor', async () => {
  const all = ids(1_200);
  let n = 0;
  await assert.rejects(scanAll({ ...source(all), keyOf: (x) => x, pageSize: 500, onPage: () => { n += 1; if (n === 2) throw new Error('write failed'); } }), /write failed/);
});

test('non-monotonic keys are refused rather than looping forever', async () => {
  await assert.rejects(scanAll({ fetchPage: async () => ['b', 'a'], keyOf: (x) => x, pageSize: 2, startAfter: 'z', onPage: () => {} }), /strictly increase/);
});

test('chunk bounds `in` lists; retirement clock has a skew margin', async () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(Date.parse(scanStartedAt(1_000_000_000_000)), 1_000_000_000_000 - RETIRE_CLOCK_MARGIN_MS);
  const { value, retried } = await withRetry(async () => 7, 2, async () => {});
  assert.deepEqual([value, retried], [7, 0]);
});

test('a handler that stops mid-page leaves the cursor on the last handled row', async () => {
  const all = ids(1_000); const seen = [];
  const src = source(all);
  const first = await scanAll({ ...src, keyOf: (x) => x, pageSize: 500, onPage: (rows) => { if (seen.length >= 500) { seen.push(...rows.slice(0, 120)); return 120; } seen.push(...rows); } });
  assert.equal(first.complete, false);
  assert.equal(first.cursor, all[619]);
  assert.equal(first.rows, 620);
  const zero = await scanAll({ ...src, keyOf: (x) => x, pageSize: 500, startAfter: first.cursor, onPage: () => 0 });
  assert.equal(zero.cursor, first.cursor, 'nothing handled: cursor unchanged');
  const rest = await scanAll({ ...src, keyOf: (x) => x, pageSize: 500, startAfter: first.cursor, onPage: (rows) => { seen.push(...rows); } });
  assert.equal(rest.complete, true);
  assert.deepEqual(seen, all);
});
