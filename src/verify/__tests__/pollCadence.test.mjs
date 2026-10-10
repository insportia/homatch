import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pollDelayMs, POLL_FAST_MS, POLL_LONG_WAIT_MS, POLL_HIDDEN_MS } from '../pollCadence.ts';

test('poll fast after a stage change, relax during long waits, slow when hidden', () => {
  const base = { stage: 'BROWSER_WAITING', msSinceStageChange: 60_000, msSinceStart: 300_000, hidden: false };
  assert.equal(pollDelayMs(base), POLL_LONG_WAIT_MS);
  assert.equal(pollDelayMs({ ...base, msSinceStageChange: 5_000 }), POLL_FAST_MS);
  assert.equal(pollDelayMs({ ...base, msSinceStart: 5_000 }), POLL_FAST_MS);
  assert.equal(pollDelayMs({ ...base, stage: 'CAPTCHA_REQUIRED' }), POLL_FAST_MS, 'a person may be acting: stay responsive');
  assert.equal(pollDelayMs({ ...base, hidden: true }), POLL_HIDDEN_MS);
  for (const s of ['FINANCIAL_ENTITY_WAITING', 'PUBLIC_RESEARCH_WAITING', 'MARKET_WAITING', 'SYNTHESIS_WAITING']) {
    assert.equal(pollDelayMs({ ...base, stage: s }), POLL_LONG_WAIT_MS, s);
  }
});

test('a 12-minute run makes far fewer status calls than the fixed 2.2 s cadence', () => {
  // Simulate: stage changes at the measured offsets of a typical run (min).
  const changes = [0, 0.5, 1.2, 6.0, 7.5, 9.5, 11.0];
  let t = 0, calls = 0, lastChange = 0, idx = 0;
  const end = 12 * 60_000;
  while (t < end) {
    while (idx < changes.length && changes[idx] * 60_000 <= t) lastChange = changes[idx++] * 60_000;
    const stage = idx % 2 ? 'BROWSER_WAITING' : 'MARKET_WAITING';
    t += pollDelayMs({ stage, msSinceStageChange: t - lastChange, msSinceStart: t, hidden: false });
    calls++;
  }
  const fixed = Math.ceil(end / 2200);
  assert.ok(calls < fixed * 0.7, `${calls} vs ${fixed}`);
});

test('the Verify page uses the adaptive cadence for its regular poll', () => {
  const page = fs.readFileSync(new URL('../../pages/VerifyPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /if\(again\)schedule\(id,nextPollMs\(\)\)/);
});
