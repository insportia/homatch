import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimatedPercent, formatElapsed } from "../progressEstimate.ts";

/*
 * THE BAR MUST NOT LIE.
 *
 * A progress indicator that reaches 100% before the work is finished teaches
 * customers that Homatch's numbers are decorative. These tests exist so that
 * cannot be reintroduced by a later "let's make it feel faster" change.
 */

test('only a finished analysis can fill the bar', () => {
  // Ten minutes of waiting still does not reach 100%.
  for (const ms of [0, 1_000, 28_000, 60_000, 600_000, 86_400_000]) {
    assert.ok(
      estimatedPercent(ms, 'RUNNING') < 100,
      `RUNNING at ${ms}ms must stay below 100%`
    );
    assert.ok(estimatedPercent(ms, 'QUEUED') < 100);
  }
  assert.equal(estimatedPercent(1, 'DONE'), 100, 'DONE is the only 100%');
  assert.equal(estimatedPercent(0, 'DONE'), 100, 'and it does not depend on elapsed time');
});

test('progress only ever moves forward while the work runs', () => {
  let previous = -1;
  for (let ms = 0; ms <= 300_000; ms += 2_500) {
    const p = estimatedPercent(ms, 'RUNNING');
    assert.ok(p >= previous, `went backwards at ${ms}ms: ${previous} -> ${p}`);
    previous = p;
  }
});

test('it slows down rather than stalling', () => {
  // The first ten seconds must deliver more than the ten seconds after two
  // minutes: that deceleration is what makes a long wait feel honest rather
  // than frozen.
  const early = estimatedPercent(10_000, 'RUNNING') - estimatedPercent(0, 'RUNNING');
  const late = estimatedPercent(130_000, 'RUNNING') - estimatedPercent(120_000, 'RUNNING');
  assert.ok(early > late, 'the curve must decelerate');
  assert.ok(early > 0, 'and it must actually move at the start');
});

test('a failed analysis claims no progress at all', () => {
  for (const state of ['FAILED', 'UNSUPPORTED', 'REQUIRES_OCR']) {
    assert.equal(estimatedPercent(60_000, state), 0, `${state} must not show progress`);
  }
});

test('elapsed time reads as minutes and seconds', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(9_000), '0:09');
  assert.equal(formatElapsed(59_999), '0:59');
  assert.equal(formatElapsed(60_000), '1:00');
  assert.equal(formatElapsed(605_000), '10:05');
  assert.equal(formatElapsed(-5), '0:00', 'a clock skew must not render a negative time');
});
