// AI TALK — the recogniser stream's failure-driven restarts are bounded (2026-10-18).
// The first restart stays immediate (a gap is a gap in somebody's sentence); further
// failures inside the window back off; past the limit the session ends as unavailable
// instead of every live session reopening in a hot loop during a provider outage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restartBackoffMs, MAX_FAILURE_RESTARTS, RESTART_FAILURE_WINDOW_MS } from '../.tstest-build/speech/GoogleSpeechStream.js';

test('backoff: immediate first, then 250 ms doubling, capped at 2 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(restartBackoffMs), [0, 250, 500, 1000, 2000, 2000, 2000]);
  assert.equal(MAX_FAILURE_RESTARTS, 5);
  assert.equal(RESTART_FAILURE_WINDOW_MS, 30_000);
});

test('the scheduled five-minute swap is never counted or delayed; a failure past the limit ends the session', () => {
  const src = readFileSync(new URL('../src/speech/GoogleSpeechStream.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('private restart(why: string)'), src.indexOf('private end(): void'));
  assert.match(fn, /if \(why !== 'scheduled'\) \{/);
  assert.match(fn, /if \(this\.failureRestarts\.length >= MAX_FAILURE_RESTARTS\) \{\s*this\.events\.onUnavailable\('RECOGNISER_UNSTABLE'\);\s*this\.close\(\);\s*return;/);
  assert.match(fn, /if \(delay > 0\) setTimeout\(reopen, delay\); else setImmediate\(reopen\);/);
});
