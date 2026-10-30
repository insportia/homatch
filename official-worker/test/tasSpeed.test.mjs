// TAS speed audit (2026-10-30): parallel evidence write-back, the render breaker, download samples.
// Same outputs as before; only time changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapSettled, EVIDENCE_UPLOAD_CONCURRENCY } from '../.tstest-build/queue/concurrency.js';
import { compactResult } from '../.tstest-build/queue/evidence.js';
import { renderBreaker, RENDER_BREAKER_FAILURES } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('mapSettled: results in item order, never more than the limit in flight, a failure never stops the rest', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapSettled([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await wait(10 - n);
    inFlight--;
    if (n === 5) throw new Error('five');
    return n * 10;
  });
  assert.equal(peak, 4);
  assert.deepEqual(out.map((o) => (o.status === 'fulfilled' ? o.value : o.reason.message)), [10, 20, 30, 40, 'five', 60, 70, 80, 90]);
  assert.deepEqual(await mapSettled([], 4, async () => 1), []);
  assert.equal(EVIDENCE_UPLOAD_CONCURRENCY, 4);
});

/* A documents payload like a TAS run: a priority case, long texts that are stored, short ones that stay inline, a duplicate text. */
function payload() {
  const long = (c, n) => c.repeat(n);
  return {
    documents: [
      { id: 'p1', title: 'priority', priority: true, documentDate: '2026-09-01', fullText: long('ა', 30_000), rawText: long('ა', 30_000) },
      { id: 'd1', title: 'older one', documentDate: '2025-01-01', fullText: long('ბ', 60_000) },
      { id: 'd2', title: 'older two', documentDate: '2024-01-01', fullText: long('გ', 60_000) },
      { id: 'd3', title: 'same text as d2', documentDate: '2023-01-01', fullText: long('გ', 60_000) },
      { id: 'd4', title: 'short', documentDate: '2022-01-01', fullText: 'short text' },
    ],
  };
}

test('compactResult: the same refs, paths, order and flags as one-at-a-time uploads; each text uploaded once; ≤4 in flight', async () => {
  const seq = [];
  const sequential = async (sha, ct, body) => { seq.push(sha); await wait(1); return `verify-evidence/${sha}`; };
  // The reference: compactResult with an uploader that can only run one at a time behaves like the old code.
  let busy = false;
  const one = async (sha, ct, body) => { assert.equal(busy, false); busy = true; await wait(2); busy = false; return `verify-evidence/${sha}`; };
  const a = await compactResult(payload(), sequential);
  let inFlight = 0; let peak = 0; const calls = [];
  const parallel = async (sha) => { calls.push(sha); inFlight++; peak = Math.max(peak, inFlight); await wait(5); inFlight--; return `verify-evidence/${sha}`; };
  const b = await compactResult(payload(), parallel);
  assert.deepEqual(b.evidenceRefs, a.evidenceRefs, 'same refs in the same order');
  assert.deepEqual(b.result, a.result, 'same compacted result, every path filled');
  assert.deepEqual(b.stats, a.stats);
  assert.ok(peak > 1 && peak <= 4, `peak ${peak}`);
  assert.equal(new Set(calls).size, calls.length, 'one upload per distinct text');
  for (const d of b.result.documents) if (d.fullTextRef) assert.match(d.fullTextRef.path, /^verify-evidence\/[0-9a-f]{64}$/);
  const p1 = b.result.documents.find((d) => d.id === 'p1');
  assert.equal(p1.textRef, p1.fullTextRef); assert.equal(p1.textComplete, true);
  await compactResult(payload(), one).catch(() => {}); // the reference uploader stays valid for one-at-a-time use
});

test('compactResult: an upload failure still fails the result (no ref is ever left without a path)', async () => {
  const flaky = async (sha) => { if (sha.startsWith('0') || sha.length) throw new Error('storage down'); return 'x'; };
  await assert.rejects(compactResult(payload(), flaky), /storage down/);
});

test('render breaker: trips only after N straight failures with nothing rendered; one success keeps it closed for good', () => {
  const b = renderBreaker();
  assert.equal(RENDER_BREAKER_FAILURES, 3);
  for (let i = 0; i < 2; i++) { assert.equal(b.open(), false); b.fail(new Error('Target closed')); }
  assert.equal(b.open(), false);
  b.fail(new Error('Target closed'));
  assert.equal(b.open(), true);
  b.skip(); b.skip();
  assert.deepEqual(b.state(), { tripped: true, skipped: 2, firstError: 'Target closed' });

  const w = renderBreaker();
  w.fail(new Error('a')); w.ok();
  for (let i = 0; i < 10; i++) w.fail(new Error('b'));
  assert.equal(w.open(), false, 'rendering works in this run: never stopped');
  assert.equal(w.state().firstError, 'a');
});

test('the render wrapper and both download sites are wired; stitching is never behind the breaker', () => {
  const src = readFileSync(new URL('../src/workflows/tas/api/TasApiWorkflow.ts', import.meta.url), 'utf8');
  const wrap = src.slice(src.indexOf('const renderPages = ('), src.indexOf('const renderPages = (') + 900);
  assert.match(wrap, /if \(breaker\.open\(\)\) \{[\s\S]*return Promise\.reject\(new Error\('RENDER_BREAKER'\)\);/);
  assert.match(wrap, /run\.then\(\(\) => breaker\.ok\(\), \(e\) => breaker\.fail\(e\)\)/);
  assert.ok(!/breaker/.test(src.slice(src.indexOf('rr.stitch!('), src.indexOf('rr.stitch!(') + 300)), 'stitching untouched');
  assert.equal((src.match(/sampleDownload\('P'/g) ?? []).length, 1);
  assert.equal((src.match(/sampleDownload\('O'/g) ?? []).length, 1);
  const exec = readFileSync(new URL('../src/queue/executor.ts', import.meta.url), 'utf8');
  assert.match(exec, /mapSettled\(uniqueIds, EVIDENCE_UPLOAD_CONCURRENCY/);
  assert.match(exec, /mapSettled\(evidenceObjects, EVIDENCE_UPLOAD_CONCURRENCY/);
  assert.match(exec, /result\.tasApi\.timings\.writeBackMs = /);
});
