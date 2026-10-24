// handoffLocation.test.mjs — production Verify 9f49e7e3 (2026-10-24): the TAS_MAP result was refused as too large
// (HTTP 413) and the trimmed hand-off kept scalars only, so the parcel's own map views (frameUrls) — the only official
// coordinates a TAS_MAP result carries — never reached the report. The trimmed hand-off now keeps them, bounded.
// Fixture: src/verify/__tests__/fixtures/job-9f49e7e3-land-location.json (one labelled synthetic view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handoffMinimum, HANDOFF_MIN_BYTES } from '../.tstest-build/queue/evidence.js';

const F = JSON.parse(readFileSync(new URL('../../src/verify/__tests__/fixtures/job-9f49e7e3-land-location.json', import.meta.url), 'utf8'));
const DEFAULT_VIEW = 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19';

/** The TAS_MAP worker's result shape (TasMapWorker.ts): start view constant, parcel views in frameUrls. */
function workerResult({ docs = 20, textChars = 60_000 } = {}) {
  return {
    ...F.storedTasMap,
    handoffMinimum: undefined,
    startUrl: DEFAULT_VIEW,
    frameUrls: F.workerFrameUrls,
    traversal: { records: Array.from({ length: 40 }, (_, i) => ({ i, note: 'x'.repeat(2000) })) },
    documents: Array.from({ length: docs }, (_, i) => ({ id: `d${i}`, title: 'NAPR registration', source: 'TAS_MAP_NAPR_REGISTRATION', rawText: 'ტ'.repeat(textChars), documentDate: `2026-09-${String(10 + (i % 18)).padStart(2, '0')}` })),
  };
}

test('the trimmed hand-off keeps the parcel map views (job 9f49e7e3 lost them)', () => {
  const out = handoffMinimum(workerResult());
  assert.equal(out.handoffMinimum, true);
  assert.deepEqual(out.frameUrls, F.workerFrameUrls);
  assert.equal(out.startUrl, DEFAULT_VIEW, 'scalars still travel as before');
  assert.equal(out.queryEntered, F.cadastralCode);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= HANDOFF_MIN_BYTES, 'still always accepted by the queue');
});

test('the views are bounded and map views come first; anything else is dropped', () => {
  const noise = Array.from({ length: 30 }, (_, i) => `https://example.test/frame/${i}`);
  const r = { ...workerResult({ docs: 1, textChars: 10 }), frameUrls: [...noise, F.workerFrameUrls[0], 42, null, 'x'.repeat(5000), F.workerFrameUrls[0]] };
  const out = handoffMinimum(r);
  assert.equal(out.frameUrls[0], F.workerFrameUrls[0], 'the map view leads');
  assert.equal(out.frameUrls.length, 12);
  assert.ok(out.frameUrls.every((u) => typeof u === 'string' && u.length <= 600));
  assert.equal(out.frameUrls.filter((u) => u === F.workerFrameUrls[0]).length, 1, 'deduplicated');
});

test('a result without views gains nothing (no location is ever invented)', () => {
  const { frameUrls: _f, ...noViews } = workerResult({ docs: 1, textChars: 10 });
  assert.equal('frameUrls' in handoffMinimum(noViews), false);
  // A malformed (non-list) value travels as any scalar always did; no URL list is ever made from it.
  assert.equal(Array.isArray(handoffMinimum({ ...noViews, frameUrls: 'not-a-list' }).frameUrls), false);
});
