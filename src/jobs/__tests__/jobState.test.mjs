// The client half of the durable-job contract.
//
// The SERVER half — that a cancellation at 16 seconds is refused, that one
// customer cannot touch another's job, that a direct UPDATE cannot extend a
// deadline — is enforced in Postgres and was verified against the production
// database before this was written. It cannot be tested here, and pretending
// otherwise with a mocked client would be the kind of gate that can never
// fail. See supabase/migrations/20260912090000_background_jobs.sql.
//
// What IS decidable here: the countdown, which states are terminal, which are
// worth watching, and when a heartbeat has been silent long enough to matter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATES, TERMINAL_STATES, isTerminal, isActive, hasReadableResult,
  isUserCancellable, cancelSecondsRemaining, isHeartbeatStale,
  CANCEL_WINDOW_MS, HEARTBEAT_STALE_MS,
} from '../jobState.ts';

test('the vocabulary is the one the database CHECK constraint allows', () => {
  // If these ever drift, a worker writes a state the UI cannot name.
  assert.deepEqual([...JOB_STATES], [
    'QUEUED', 'STARTING', 'CANCELLABLE', 'COMMITTED',
    'PROCESSING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]);
});

test('exactly three states are terminal', () => {
  assert.deepEqual([...TERMINAL_STATES], ['COMPLETED', 'FAILED', 'CANCELLED']);
  for (const s of JOB_STATES) {
    assert.equal(isTerminal(s), TERMINAL_STATES.includes(s));
    assert.equal(isActive(s), !isTerminal(s));
  }
});

test('PARTIAL has something to read, which is why it exists', () => {
  assert.equal(hasReadableResult('PARTIAL'), true);
  assert.equal(hasReadableResult('COMPLETED'), true);
  assert.equal(hasReadableResult('PROCESSING'), false);
  assert.equal(hasReadableResult('FAILED'), false);
});

test('the cancel button is only ever offered before spend is committed', () => {
  assert.equal(isUserCancellable('QUEUED'), true);
  assert.equal(isUserCancellable('STARTING'), true);
  assert.equal(isUserCancellable('CANCELLABLE'), true);
  // The whole point of the distinction: after this line Homatch is buying.
  assert.equal(isUserCancellable('COMMITTED'), false);
  assert.equal(isUserCancellable('PROCESSING'), false);
  assert.equal(isUserCancellable('PARTIAL'), false);
  for (const s of TERMINAL_STATES) assert.equal(isUserCancellable(s), false);
});

/* ------------------------------------------------------------------ *
 * The countdown (§26, §49)                                            *
 * ------------------------------------------------------------------ */

const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

test('the window is fifteen seconds', () => {
  assert.equal(CANCEL_WINDOW_MS, 15_000);
});

test('the countdown counts down, and stops at zero rather than going negative', () => {
  assert.equal(cancelSecondsRemaining(at(15_000), NOW), 15);
  assert.equal(cancelSecondsRemaining(at(14_000), NOW), 14);
  assert.equal(cancelSecondsRemaining(at(1_000), NOW), 1);
  assert.equal(cancelSecondsRemaining(at(0), NOW), 0);
  // One second past the deadline is not "minus one second left".
  assert.equal(cancelSecondsRemaining(at(-1_000), NOW), 0);
  assert.equal(cancelSecondsRemaining(at(-60_000), NOW), 0);
});

test('a part-second is rounded UP, so the number never reads zero while the server still allows it', () => {
  // Rounding down would hide the button for the last 999ms of a window the
  // server is still honouring — a customer pressing cancel at 14.6 seconds
  // would find nothing to press.
  assert.equal(cancelSecondsRemaining(at(200), NOW), 1);
  assert.equal(cancelSecondsRemaining(at(14_600), NOW), 15);
});

test('a missing or unparseable deadline reads as no time left, never as infinite', () => {
  // Failing open here would show a cancel button on a committed job and
  // teach the customer that the refusal is arbitrary.
  assert.equal(cancelSecondsRemaining(null, NOW), 0);
  assert.equal(cancelSecondsRemaining(undefined, NOW), 0);
  assert.equal(cancelSecondsRemaining('', NOW), 0);
  assert.equal(cancelSecondsRemaining('not a date', NOW), 0);
});

/* ------------------------------------------------------------------ *
 * Heartbeat (§47)                                                     *
 * ------------------------------------------------------------------ */

test('the stale threshold is generous, because thinking is not dying', () => {
  // A verification stage legitimately spends minutes inside one provider
  // call. A short threshold requeues jobs that were merely working, and buys
  // the same research twice.
  assert.equal(HEARTBEAT_STALE_MS, 5 * 60 * 1000);
});

test('a heartbeat is stale only after the threshold', () => {
  assert.equal(isHeartbeatStale(at(-60_000), NOW), false);
  assert.equal(isHeartbeatStale(at(-HEARTBEAT_STALE_MS + 1_000), NOW), false);
  assert.equal(isHeartbeatStale(at(-HEARTBEAT_STALE_MS - 1_000), NOW), true);
});

test('a job that has never reported is not declared dead', () => {
  // No heartbeat yet means it has not started, not that it has stopped.
  assert.equal(isHeartbeatStale(null, NOW), false);
  assert.equal(isHeartbeatStale(undefined, NOW), false);
  assert.equal(isHeartbeatStale('nonsense', NOW), false);
});
