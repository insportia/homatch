// THE STALLED WORKER, REPRODUCED IN A MILLISECOND.
//
// Production job evidence: a Verify job held FINANCIAL_ENTITY_WAITING for
// 2,307 seconds because the official-worker's entity job stopped progressing
// and the poll that drives that stage had no bound on it at all. Nothing
// downstream ran, and because the job never finished, the customer's report
// kept every section at PENDING — which renders as "not started".
//
// These tests drive that exact condition. Time is a parameter, not a wall
// clock: a ten-minute stall is ten numbers, and the suite stays fast enough
// to run on every commit, which is the only kind of regression test that
// actually catches a regression.
//
// The distinction being protected is narrow and easy to lose: SLOW is not
// STALLED. A worker crawling through a hard registry page must be waited
// for; a worker that has stopped touching its own job must not be. The
// signature is what tells them apart, so most of what follows is about the
// signature.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCIAL_ENTITY_MAX_WAIT_MS,
  FINANCIAL_ENTITY_STALL_MS,
  assessFinancialEntityWait,
  beginWait,
  progressSignature,
  unavailableEntityResult,
} from '../verifyWatchdog.ts';

const T0 = 1_700_000_000_000;
const SEC = 1000;

/** A worker job that is running and has done nothing yet. */
const idle = (updatedAt = '2026-09-18T10:00:00.000Z') => ({
  status: 'RUNNING', stage: 'ENREG_SEARCH', sourceIndex: 0,
  results: [], steps: [{ status: 'RUNNING' }, { status: 'PENDING' }], updatedAt,
});

/**
 * Poll a worker repeatedly and report what the watchdog decided.
 * `worker(tick)` returns the snapshot for that poll, so a test can make the
 * worker move, stop moving, or crawl.
 */
function pollUntilDecision(worker, { everyMs = 30 * SEC, maxTicks = 200, limits } = {}) {
  let state = beginWait(T0);
  const seen = [];
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const nowMs = T0 + tick * everyMs;
    const a = assessFinancialEntityWait(state, worker(tick), nowMs, limits);
    seen.push(a.verdict);
    state = a.next;
    if (a.giveUp) return { ...a, tick, elapsedMs: nowMs - T0, seen };
  }
  return { verdict: 'NEVER_DECIDED', tick: maxTicks, seen, giveUp: false };
}

// ── The signature: what counts as movement ───────────────────────────────

test('a worker that has not moved produces the same signature', () => {
  assert.equal(progressSignature(idle()), progressSignature(idle()));
});

test('every kind of real movement changes the signature', () => {
  const base = idle();
  const moved = [
    { ...base, stage: 'ENREG_RESULTS' },
    { ...base, sourceIndex: 1 },
    { ...base, results: [{}] },
    { ...base, steps: [{ status: 'DONE' }, { status: 'PENDING' }] },
    { ...base, steps: [...base.steps, { status: 'PENDING' }] },
    { ...base, updatedAt: '2026-09-18T10:00:30.000Z' },
    { ...base, status: 'COMPLETE' },
  ];
  for (const m of moved) {
    assert.notEqual(progressSignature(m), progressSignature(base), JSON.stringify(m).slice(0, 60));
  }
});

test('a missing or empty snapshot is handled rather than thrown at', () => {
  assert.equal(typeof progressSignature(null), 'string');
  assert.equal(typeof progressSignature(undefined), 'string');
  assert.equal(typeof progressSignature({}), 'string');
});

// ── THE PRODUCTION FAILURE ───────────────────────────────────────────────

test('THE 2,307-SECOND STALL: a frozen worker is abandoned, bounded', () => {
  // Exactly the production shape: status stays RUNNING and nothing else
  // ever changes. Polled every 30 seconds, as the driver does.
  const outcome = pollUntilDecision(() => idle());

  assert.equal(outcome.verdict, 'GIVE_UP_STALLED');
  assert.equal(outcome.giveUp, true);
  // Bounded well inside the 2,307 seconds production actually burned.
  assert.ok(outcome.elapsedMs <= FINANCIAL_ENTITY_STALL_MS + 30 * SEC,
    `gave up after ${outcome.elapsedMs}ms`);
  assert.ok(outcome.elapsedMs < 2307 * SEC);
  assert.ok(outcome.sinceProgressMs >= FINANCIAL_ENTITY_STALL_MS);
});

test('a worker that never reports anything at all still times out', () => {
  // Not even a payload — the endpoint returns nothing useful. The clock
  // started when the job was created, so this still ends.
  const outcome = pollUntilDecision(() => null);
  assert.equal(outcome.giveUp, true);
  assert.ok(outcome.elapsedMs <= FINANCIAL_ENTITY_STALL_MS + 30 * SEC);
});

// ── SLOW IS NOT STALLED ──────────────────────────────────────────────────

test('a slow but progressing worker is waited for, well past the stall bound', () => {
  // Moves once a minute. Polled every 30s, so half the polls see no change
  // — which must not be mistaken for a stall.
  const outcome = pollUntilDecision(
    (tick) => idle(`2026-09-18T10:${String(Math.floor(tick / 2)).padStart(2, '0')}:00.000Z`),
    { maxTicks: 18 }, // nine minutes: past STALL_MS, inside MAX_WAIT_MS
  );
  assert.equal(outcome.verdict, 'NEVER_DECIDED');
  assert.ok(outcome.seen.includes('PROGRESSED'));
  assert.ok(outcome.seen.includes('WAITING'));
});

test('but even a busy worker is not waited for past the ceiling', () => {
  // Moves on every single poll, for ever. Without a total bound this job
  // would be waited on indefinitely while looking perfectly healthy.
  const outcome = pollUntilDecision((tick) => ({ ...idle(), sourceIndex: tick }));
  assert.equal(outcome.verdict, 'GIVE_UP_MAX_WAIT');
  assert.ok(outcome.elapsedMs >= FINANCIAL_ENTITY_MAX_WAIT_MS);
  assert.ok(outcome.elapsedMs <= FINANCIAL_ENTITY_MAX_WAIT_MS + 30 * SEC);
});

test('progress resets the stall clock, so a late recovery is not punished', () => {
  // Frozen for two and a half minutes, then moves. It must survive.
  const outcome = pollUntilDecision(
    (tick) => (tick <= 5 ? idle() : idle('2026-09-18T10:05:00.000Z')),
    { maxTicks: 10 },
  );
  assert.equal(outcome.verdict, 'NEVER_DECIDED');
  assert.equal(outcome.seen[5], 'PROGRESSED');
});

// ── The bounds are configurable, so the wiring can be exercised ──────────

test('the bounds are parameters, which is what makes this testable at all', () => {
  const outcome = pollUntilDecision(() => idle(), {
    everyMs: SEC, limits: { stallMs: 5 * SEC, maxWaitMs: 60 * SEC },
  });
  assert.equal(outcome.verdict, 'GIVE_UP_STALLED');
  // Six seconds, not five: the stall clock starts at the FIRST OBSERVATION,
  // one second in, because nothing can be called stalled before anybody has
  // looked at it. The total-wait ceiling is the bound that counts from job
  // creation, and the test below pins that one.
  assert.equal(outcome.elapsedMs, 6 * SEC);
});

test('the ceiling counts from job creation, not from the first look', () => {
  // The two bounds measure different things on purpose. Whatever happens
  // between creating the worker job and first polling it is time the job
  // has been alive, and the ceiling must not forgive it.
  let state = beginWait(T0);
  const a = assessFinancialEntityWait(state, idle(), T0 + FINANCIAL_ENTITY_MAX_WAIT_MS);
  assert.equal(a.verdict, 'GIVE_UP_MAX_WAIT');
  assert.equal(a.waitedMs, FINANCIAL_ENTITY_MAX_WAIT_MS);
});

// ── State handling ───────────────────────────────────────────────────────

test('the first poll establishes a baseline rather than counting as movement', () => {
  const a = assessFinancialEntityWait(beginWait(T0), idle(), T0 + SEC);
  assert.equal(a.verdict, 'WAITING');
  assert.equal(a.next.signature, progressSignature(idle()));
  assert.equal(a.next.polls, 1);
});

test('a wait with no recorded start begins its clock now, not at the epoch', () => {
  // A job already in flight when this watchdog shipped. Treating a missing
  // startedAt as 0 would abandon it on the first poll; inventing a generous
  // one would excuse it for ever. It starts counting from now.
  const a = assessFinancialEntityWait(undefined, idle(), T0);
  assert.equal(a.giveUp, false);
  assert.equal(a.waitedMs, 0);
  assert.equal(a.next.startedAt, T0);
});

test('polls are counted, and the count never drives the decision', () => {
  let state = beginWait(T0);
  for (let i = 1; i <= 4; i += 1) {
    const a = assessFinancialEntityWait(state, idle(), T0 + i * SEC);
    state = a.next;
    assert.equal(a.giveUp, false, 'four fast polls must not trip anything');
  }
  assert.equal(state.polls, 4);
});

// ── What is left behind ──────────────────────────────────────────────────

test('an abandoned source is recorded as unavailable, not silently dropped', () => {
  const row = unavailableEntityResult({
    source: 'rstax', name: 'შპს მაგალითი', idCode: '405068386',
    reason: 'GIVE_UP_STALLED', waitedMs: 190_000,
    workerJobId: 'wrk-1', atIso: '2026-09-18T10:03:10.000Z',
  });
  assert.equal(row.source, 'rstax');
  // TIMEOUT is already mapped to TECHNICAL_FAILED by customerSourceStatus,
  // so the customer sees "could not be completed" with no further wiring.
  assert.equal(row.status, 'TIMEOUT');
  assert.equal(row.unavailable, true);
  assert.equal(row.unavailableReason, 'GIVE_UP_STALLED');
  // forEntity is what stops the same lookup being launched again.
  assert.deepEqual(row.forEntity, { name: 'შპს მაგალითი', idCode: '405068386' });
  // And it carries no fabricated data.
  assert.deepEqual(row.documents, []);
  assert.equal('results' in row, false);
});

test('the abandoned record is shaped so the dedupe guard recognises it', () => {
  // alreadyHasResultFor() matches on r.source plus r.forEntity.idCode. If
  // this record did not carry both, a later pass would start the very job
  // that just had to be abandoned.
  const row = unavailableEntityResult({
    source: 'enreg', name: 'X', idCode: '404670272', reason: 'GIVE_UP_MAX_WAIT',
    waitedMs: 600_000, workerJobId: 'wrk-2', atIso: '2026-09-18T10:10:00.000Z',
  });
  const sameSource = [row].filter((r) => r.source === 'enreg');
  assert.equal(sameSource.length, 1);
  assert.equal(String(sameSource[0].forEntity.idCode).trim(), '404670272');
});
