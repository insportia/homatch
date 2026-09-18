// The user must not feel the queue.
//
// A person watching a spinner and a backfill crawling a portal are both
// "research". Scheduling them fairly starves the person, because the backfill
// always has more work queued. The scheduler's job is to be deliberately
// unfair in the right direction — and `ExecutionGrant.priorityLevel` already
// exists in billing.ts with nothing consuming it, which is the gap this fills.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WeightedScheduler, DEFAULT_CLASS_POLICIES } from '../flow/scheduler.ts';
import { Deadline } from '../flow/deadline.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { CircuitBreaker } from '../flow/circuit-breaker.ts';
import { TokenBucket } from '../flow/token-bucket.ts';
import { workClassForGrant, isInteractive, WORK_CLASSES } from '../core/types.ts';

const later = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = (totalConcurrency, classes = DEFAULT_CLASS_POLICIES) =>
  new WeightedScheduler({ totalConcurrency, classes });

test('the four work classes exist and the interactive ones are known', () => {
  assert.deepEqual([...WORK_CLASSES], [
    'INTERACTIVE_HIGH',
    'INTERACTIVE_NORMAL',
    'BACKGROUND',
    'ENRICHMENT',
  ]);
  assert.equal(isInteractive('INTERACTIVE_HIGH'), true);
  assert.equal(isInteractive('BACKGROUND'), false);
});

test('a funding decision maps onto a work class without a second policy', () => {
  // billing.ts already decided how this run is funded. Nothing consumed that
  // decision before; this is the consumer.
  assert.equal(workClassForGrant({ funding: 'PAYG', interactive: true }), 'INTERACTIVE_HIGH');
  assert.equal(workClassForGrant({ funding: 'INCLUDED', interactive: true }), 'INTERACTIVE_NORMAL');
  assert.equal(workClassForGrant({ funding: 'PAYG', interactive: false }), 'BACKGROUND');
  assert.equal(workClassForGrant({ funding: 'UNAVAILABLE', interactive: false }), 'BACKGROUND');
});

test('every class reserves less than the pool, or the scheduler deadlocks', () => {
  // A sum of reservations larger than the pool is a configuration that cannot
  // run anything, and it only shows up under load.
  const reserved = Object.values(DEFAULT_CLASS_POLICIES).reduce((sum, p) => sum + p.minReserved, 0);
  assert.ok(reserved > 0);
  assert.ok(reserved < 32, `reservations total ${reserved}`);
});

test('an interactive task is not made to wait behind a queue of background work', async () => {
  const sched = scheduler(2);
  const order = [];

  const background = Array.from({ length: 40 }, (_, i) =>
    sched.submit(async () => {
      order.push(`bg${i}`);
      await later(2);
    }, { workClass: 'BACKGROUND' }),
  );

  // Then one person arrives.
  const interactive = sched.submit(async () => {
    order.push('interactive');
  }, { workClass: 'INTERACTIVE_HIGH' });

  await interactive.promise;
  const position = order.indexOf('interactive');
  assert.ok(position >= 0);
  assert.ok(position < 10, `the interactive task ran at position ${position} of ${order.length}`);

  await Promise.all(background.map((task) => task.promise));
  await sched.onIdle();
});

test('two interactive classes do not reserve capacity against each other', async () => {
  // A reservation each interactive class holds against the other is a
  // deadlock in any pool smaller than their sum, and it only appears under
  // load.
  const sched = scheduler(1);
  const done = [];

  await Promise.all([
    sched.submit(async () => { done.push('high'); }, { workClass: 'INTERACTIVE_HIGH' }).promise,
    sched.submit(async () => { done.push('normal'); }, { workClass: 'INTERACTIVE_NORMAL' }).promise,
  ]);

  assert.equal(done.length, 2);
});

test('background work still progresses under sustained interactive load', async () => {
  // Yielding forever is starvation, which is a different bug with the same
  // symptom: work that never finishes.
  const sched = new WeightedScheduler({
    totalConcurrency: 2,
    classes: DEFAULT_CLASS_POLICIES,
    backgroundStarvationGuardMs: 5,
  });
  const finished = [];

  const background = sched.submit(async () => { finished.push('bg'); }, { workClass: 'BACKGROUND' });
  const interactive = Array.from({ length: 20 }, () =>
    sched.submit(async () => { await later(1); finished.push('int'); }, { workClass: 'INTERACTIVE_HIGH' }),
  );

  await Promise.all([background.promise, ...interactive.map((t) => t.promise)]);
  assert.ok(finished.includes('bg'));
  await sched.onIdle();
});

test('enrichment yields, but still finishes', async () => {
  const sched = scheduler(2);
  const finished = [];
  const tasks = [
    sched.submit(async () => { await later(1); finished.push('enrichment'); }, { workClass: 'ENRICHMENT' }),
    sched.submit(async () => { await later(1); finished.push('interactive'); }, { workClass: 'INTERACTIVE_HIGH' }),
  ];
  await Promise.all(tasks.map((t) => t.promise));
  assert.equal(finished.length, 2);
  await sched.onIdle();
});

test('a cancelled task rejects rather than leaving an unsettled promise', async () => {
  const sched = scheduler(1);
  const blocker = sched.submit(async () => { await later(20); }, { workClass: 'BACKGROUND' });
  const victim = sched.submit(async () => 'never', { workClass: 'BACKGROUND' });

  victim.cancel('test');
  await assert.rejects(() => victim.promise);
  await blocker.promise;
  await sched.onIdle();
});

/* ── Deadlines ────────────────────────────────────────────────────────── */

test('a deadline aborts in flight rather than hanging or throwing', async () => {
  const deadline = new Deadline(10);
  assert.equal(deadline.hasExpired, false);
  await later(40);
  assert.equal(deadline.hasExpired, true);
  assert.equal(deadline.signal.aborted, true);
});

test('a deadline reports how much budget is left', () => {
  let clock = 1000;
  const deadline = new Deadline(5000, () => clock, clock);
  assert.equal(deadline.remainingMs(), 5000);
  clock += 2000;
  assert.equal(deadline.remainingMs(), 3000);
  clock += 9000;
  assert.equal(deadline.remainingMs(), 0);
  deadline.cancel();
});

/* ── Back pressure ────────────────────────────────────────────────────── */

test('a rate limiter caps concurrency per key, not globally', async () => {
  const limiter = new RateLimiter({
    defaultPolicy: { concurrency: 2, requestsPerSecond: 1000, burst: 1000 },
  });
  let live = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 10 }, () =>
      limiter.run('one-host', async () => {
        live += 1;
        peak = Math.max(peak, live);
        await later(2);
        live -= 1;
      }),
    ),
  );
  assert.equal(peak, 2);
});

test('two hosts do not share one budget', async () => {
  const limiter = new RateLimiter({
    defaultPolicy: { concurrency: 1, requestsPerSecond: 1000, burst: 1000 },
  });
  let live = 0;
  let peak = 0;
  const work = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await later(5);
    live -= 1;
  };
  await Promise.all([limiter.run('a', work), limiter.run('b', work)]);
  assert.equal(peak, 2, 'one host throttled another');
});

test('a token bucket refills over time rather than blocking forever', () => {
  let clock = 0;
  const bucket = new TokenBucket({ tokensPerSecond: 10, burst: 2, clock: { now: () => clock } });
  assert.equal(bucket.tryTake(1), true);
  assert.equal(bucket.tryTake(1), true);
  assert.equal(bucket.tryTake(1), false);
  clock += 1000;
  assert.equal(bucket.tryTake(1), true);
});

test('a circuit opens after repeated failure and stops calling through', async () => {
  // A source that is down should not be hammered — that is bad for them and
  // pointless for us.
  let clock = 0;
  const breaker = new CircuitBreaker('host', {
    failureThreshold: 2,
    minimumCalls: 2,
    windowMs: 60_000,
    openMs: 1000,
    successThreshold: 1,
    halfOpenMaxCalls: 1,
    clock: { now: () => clock },
  });

  const boom = () => Promise.reject(new Error('down'));
  await assert.rejects(() => breaker.execute(boom));
  await assert.rejects(() => breaker.execute(boom));
  assert.equal(breaker.currentState(), 'OPEN');

  let called = false;
  await assert.rejects(() => breaker.execute(async () => { called = true; }));
  assert.equal(called, false, 'the open circuit still called through');

  clock += 2000;
  assert.equal(breaker.currentState(), 'HALF_OPEN');
  await breaker.execute(async () => 'ok');
  assert.notEqual(breaker.currentState(), 'OPEN');
});
