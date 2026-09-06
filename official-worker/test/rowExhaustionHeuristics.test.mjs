// rowExhaustionHeuristics.test.mjs — regression test for the confirmed
// live TAS bug (job 197b4520-2446-4f3d-8688-54a8229db3b3, cadastral code
// 01.18.06.019.055.03.01.603): TAS's own result counter reported 24
// results, but the anchor-based row selector (now in TAS's own
// workflows/tas/TasResultExhauster.ts, forked from the former shared
// browser/ResultRowExhauster.ts) matched only the site's 13-item top nav
// menu (an incidental `<ul><li><a>` structure — TAS's real ExtJS grid
// renders with NO <a> anywhere, see workflows/tas/selectors.ts) and
// returned that as "the results, fully visited," reading zero real
// documents from any of them.
//
// anchorPassLooksReal is the gate that must now reject that exact shape of
// pass (some rows "visited," no real documents, far short of the source's
// own reported count) so exhaustTasResultRows/exhaustMygovResultRows fall
// through to the ExtJS grid-row strategy instead of reporting nav-menu
// noise as complete research.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorPassLooksReal } from '../.tstest-build/browser/RowExhaustionHeuristics.js';

test('anchorPassLooksReal: THE PRODUCTION BUG — 13 "visited" nav-menu rows, 0 documents, 24 actually discovered -> rejected', () => {
  assert.equal(anchorPassLooksReal(13, 0, 24), false);
});

test('anchorPassLooksReal: zero documents read is always rejected, whatever the visited count', () => {
  assert.equal(anchorPassLooksReal(24, 0, 24), false);
  assert.equal(anchorPassLooksReal(24, 0, null), false);
});

test('anchorPassLooksReal: a genuine anchor-based result list (real documents, close to the reported count) is accepted', () => {
  assert.equal(anchorPassLooksReal(24, 24, 24), true);
  assert.equal(anchorPassLooksReal(20, 18, 24), true); // >= 50% of 24
});

test('anchorPassLooksReal: real documents but far short of the reported count is rejected (still likely wrong selector)', () => {
  assert.equal(anchorPassLooksReal(3, 3, 24), false); // 3 of 24 is well under the 50% floor
});

test('anchorPassLooksReal: unknown expected count (source counter unavailable) falls back to "did we get any real document at all"', () => {
  assert.equal(anchorPassLooksReal(2, 1, null), true);
  assert.equal(anchorPassLooksReal(2, 0, undefined), false);
});

test('anchorPassLooksReal: expectedCount of 0 or negative is treated as unknown, never as "expects nothing"', () => {
  assert.equal(anchorPassLooksReal(1, 1, 0), true);
  assert.equal(anchorPassLooksReal(1, 1, -5), true);
});
