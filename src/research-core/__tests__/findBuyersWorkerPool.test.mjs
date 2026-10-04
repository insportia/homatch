// FIND BUYERS — the memo23 worker pool, on a virtual clock (no network, no
// provider, no database). The fake queue/reservation below mirror the real
// contracts: claim leases one due job (highest priority first), the reserve
// refuses with GLOBAL_BUSY while 4 runs are in flight, a started job is polled
// ahead of unstarted ones, and a run's slot frees when its cost is booked.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runWorkerPool } from '../findBuyers/workerPool.ts';

/** A clock that only moves when every lane is waiting. */
function virtualClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    sleep: (ms) => new Promise((resolve) => { timers.push({ at: t + ms, resolve }); }),
    async run(promise) {
      let done = false;
      let value;
      promise.then((v) => { done = true; value = v; });
      while (!done) {
        await new Promise((r) => setImmediate(r));
        if (done) break;
        if (!timers.length) throw new Error('deadlock: nothing runnable and no timer');
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        t = Math.max(t, next.at);
        next.resolve();
      }
      return value;
    },
    advanceTo(ms) { t = Math.max(t, ms); },
  };
}

const CAP = 4;
const POLL_PRIORITY = 10_000;

/** The queue, the reservation and the provider, as the driver sees them. */
function world(clock, specs) {
  const jobs = specs.map((s, i) => ({
    id: s.id, seq: i, priority: s.priority ?? 50, status: 'PENDING', nextAt: 0,
    retryCount: 0, runId: null, spec: s,
  }));
  const runs = new Map();          // runId → run
  const reservations = new Map();  // idempotency key → runId (created once)
  const reserveCalls = new Map();  // key → how many runs were created for it
  const leads = [];
  const log = [];
  let handlers = 0; let maxHandlers = 0; let maxRunning = 0;

  const running = () => [...runs.values()].filter((r) => !r.booked).length;

  function reserve(key, job) {
    if (reservations.has(key)) return { ok: true, replay: true, runId: reservations.get(key) };
    if (running() >= CAP) return { ok: false, reason: 'GLOBAL_BUSY' };
    const runId = `${key}`;
    reservations.set(key, runId);
    reserveCalls.set(key, (reserveCalls.get(key) ?? 0) + 1);
    const attempt = job.retryCount;
    const fail = typeof job.spec.fail === 'function' ? job.spec.fail(attempt) : Boolean(job.spec.fail);
    runs.set(runId, { id: runId, job: job.id, startedAt: clock.now(), endsAt: clock.now() + job.spec.duration, fail, booked: false, bookedAt: null, bookings: 0 });
    maxRunning = Math.max(maxRunning, running());
    log.push({ at: clock.now(), ev: 'start', job: job.id });
    return { ok: true, runId };
  }

  function book(run) {
    if (run.booked) return false;
    run.booked = true; run.bookedAt = clock.now(); run.bookings++;
    log.push({ at: clock.now(), ev: run.fail ? 'failed' : 'finished', job: run.job });
    return true;
  }

  async function claim() {
    const due = jobs.filter((j) => (j.status === 'PENDING' || j.status === 'RETRY_WAIT') && j.nextAt <= clock.now())
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const job = due[0];
    if (!job) return null;
    assert.notEqual(job.status, 'PROCESSING', 'a held job is never claimed twice');
    job.status = 'PROCESSING';
    return job;
  }

  const finish = (job, status, waitMs) => { job.status = status; job.nextAt = clock.now() + (waitMs ?? 0); };

  /** One claim's work: start (reserve) or poll, like executor.ts + runSocialJob. */
  async function runJob(job) {
    handlers++; maxHandlers = Math.max(maxHandlers, handlers);
    try {
      await clock.sleep(job.spec.handlerMs?.(job) ?? 300);
      if (!job.runId) {
        const r = reserve(`q:${job.id}:r${job.retryCount}`, job);
        if (!r.ok) return finish(job, 'RETRY_WAIT', 10_000);
        job.runId = r.runId;
        job.priority = POLL_PRIORITY;
        return finish(job, 'RETRY_WAIT', 10_000);
      }
      const run = runs.get(job.runId);
      if (clock.now() < run.endsAt) return finish(job, 'RETRY_WAIT', 10_000);
      book(run);
      if (run.fail) {
        if (job.spec.retryable && job.retryCount < 1) { job.retryCount++; job.runId = null; return finish(job, 'RETRY_WAIT', 5_000); }
        return finish(job, 'FAILED');
      }
      leads.push({ job: job.id, at: clock.now() });
      return finish(job, 'DONE');
    } finally { handlers--; }
  }

  const hasOpenWork = async () => jobs.some((j) => ['PENDING', 'RETRY_WAIT', 'PROCESSING'].includes(j.status));

  /** Cron ticks every minute; each runs the pool for 45 s (SOCIAL_PASS_MS). */
  async function drive(maxTicks = 60) {
    let ticks = 0;
    while (await hasOpenWork() && ticks < maxTicks) {
      const tickStart = ticks * 60_000;
      clock.advanceTo(tickStart);
      await clock.run(runWorkerPool({
        lanes: CAP, deadline: tickStart + 45_000, now: clock.now, sleep: clock.sleep,
        claim, run: runJob, hasOpenWork, idleMs: 2_000, staggerMs: 150,
      }));
      ticks++;
    }
    const finishedAt = Math.max(...[...runs.values()].map((r) => r.bookedAt ?? 0));
    return { ticks, campaignCompletedAt: (await hasOpenWork()) ? null : finishedAt };
  }

  return { jobs, runs, reserveCalls, leads, log, drive, stats: () => ({ maxHandlers, maxRunning }) };
}

const at = (log, ev, job) => log.find((e) => e.ev === ev && e.job === job)?.at;

test('slots refill as runs finish: no batch of four, a slow run blocks nobody, a failure stays local', async () => {
  const clock = virtualClock();
  const w = world(clock, [
    { id: 'A', duration: 400_000, priority: 90, handlerMs: (j) => (j.runId ? 40_000 : 300) }, // slow run, slow processing
    { id: 'B', duration: 20_000, priority: 89 },
    { id: 'C', duration: 70_000, priority: 88 },
    { id: 'D', duration: 40_000, priority: 87, fail: true },                                   // fails, not retryable
    { id: 'E', duration: 30_000, priority: 80 },
    { id: 'F', duration: 30_000, priority: 79 },
    { id: 'G', duration: 30_000, priority: 78 },
    { id: 'H', duration: 15_000, priority: 77, fail: (attempt) => attempt === 0, retryable: true }, // fails once, retried
    { id: 'I', duration: 25_000, priority: 76 },
    { id: 'J', duration: 25_000, priority: 75 },
  ]);
  const { campaignCompletedAt } = await w.drive();
  const L = w.log;

  // A, B, C, D start together.
  for (const id of ['A', 'B', 'C', 'D']) assert.ok(at(L, 'start', id) < 2_000, `${id} starts at once`);
  assert.equal(at(L, 'start', 'E') > 2_000, true, 'E waits for a slot');

  // B finishes → E starts in B's slot while A, C, D are still running.
  assert.ok(at(L, 'start', 'E') >= at(L, 'finished', 'B'), 'E after B');
  assert.ok(at(L, 'start', 'E') - at(L, 'finished', 'B') <= 15_000, `E refills B's slot quickly (${at(L, 'start', 'E') - at(L, 'finished', 'B')} ms)`);
  for (const id of ['A', 'C', 'D']) assert.ok(at(L, 'start', 'E') < (at(L, 'finished', id) ?? at(L, 'failed', id)), `${id} still running when E starts`);

  // D fails → F takes its slot; A (slow) is still running and blocked neither.
  assert.ok(at(L, 'start', 'F') >= Math.min(at(L, 'failed', 'D'), at(L, 'finished', 'C')), 'F after a slot frees');
  assert.ok(at(L, 'start', 'F') < at(L, 'finished', 'A'), 'F runs while slow A is running');
  assert.ok(at(L, 'start', 'G') < at(L, 'finished', 'A') && at(L, 'start', 'J') < at(L, 'finished', 'A'), 'the whole queue drains past slow A');

  // Never more than four runs in flight, never more than four handlers.
  assert.ok(w.stats().maxRunning <= CAP, `runs in flight ≤ 4 (got ${w.stats().maxRunning})`);
  assert.equal(w.stats().maxRunning, CAP, 'all four slots are used');
  assert.ok(w.stats().maxHandlers <= CAP, `handlers ≤ 4 (got ${w.stats().maxHandlers})`);

  // Every job reached a terminal state; only D failed; the campaign waited for all ten, not the first four.
  const status = Object.fromEntries(w.jobs.map((j) => [j.id, j.status]));
  assert.deepEqual(status, { A: 'DONE', B: 'DONE', C: 'DONE', D: 'FAILED', E: 'DONE', F: 'DONE', G: 'DONE', H: 'DONE', I: 'DONE', J: 'DONE' });
  assert.ok(campaignCompletedAt >= at(L, 'finished', 'A'), 'campaign completes only after the slowest run');

  // Retry: H's failed attempt and its retry are two reservations with two keys, each created and booked once.
  assert.deepEqual([...w.reserveCalls.entries()].filter(([k]) => k.startsWith('q:H')), [['q:H:r0', 1], ['q:H:r1', 1]]);
  for (const [, n] of w.reserveCalls) assert.equal(n, 1, 'no key reserved twice');
  for (const run of w.runs.values()) assert.equal(run.bookings, 1, `run ${run.id} booked exactly once`);

  // Progressive results: leads land as each run finishes, in completion order, long before slow A.
  assert.equal(w.leads.length, 9, 'one lead per successful job, no duplicates');
  assert.equal(new Set(w.leads.map((l) => l.job)).size, 9);
  assert.equal(w.leads[0].job, 'B', 'B (fastest) is the first result');
  assert.ok(w.leads.filter((l) => l.at < at(L, 'finished', 'A')).length >= 8, 'eight results are visible while A still runs');
  assert.deepEqual(w.leads.map((l) => l.at), [...w.leads.map((l) => l.at)].sort((a, b) => a - b), 'persisted in completion order');
});

test('the pool refills a free lane at once (no batch barrier) and contains a throwing job', async () => {
  const clock = virtualClock();
  const queue = [50_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000].map((ms, i) => ({ id: i, ms, throws: i === 2 }));
  const startedAt = {};
  let inFlight = 0; let maxInFlight = 0;
  const result = await clock.run(runWorkerPool({
    lanes: 4, deadline: 120_000, now: clock.now, sleep: clock.sleep,
    claim: async () => queue.shift() ?? null,
    hasOpenWork: async () => queue.length > 0,
    run: async (job) => {
      startedAt[job.id] = clock.now();
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await clock.sleep(job.ms);
        if (job.throws) throw new Error('boom');
        return job.id;
      } finally { inFlight--; }
    },
  }));
  assert.equal(startedAt[4], 5_000, 'job 4 starts the moment the first 5 s job frees its lane (not after the 50 s job)');
  assert.ok(startedAt[6] < 50_000, 'the queue drains while job 0 is still running');
  assert.equal(maxInFlight, 4, 'never more than four at once');
  assert.equal(result.claimed, 7);
  assert.equal(result.results.filter((r) => r && r.error).length, 1, 'the throwing job is recorded, the others complete');
});

test('an idle pool stops when no work is open, and never claims past its deadline', async () => {
  const clock = virtualClock();
  let claims = 0;
  const r1 = await clock.run(runWorkerPool({
    lanes: 4, deadline: 45_000, now: clock.now, sleep: clock.sleep,
    claim: async () => { claims++; return null; }, hasOpenWork: async () => false, run: async () => 0,
  }));
  assert.equal(r1.claimed, 0); assert.equal(claims, 4, 'one look per lane, then stop');
  assert.equal(clock.now() < 1_000, true, 'returns at once when nothing is open');

  const clock2 = virtualClock();
  const r2 = await clock2.run(runWorkerPool({
    lanes: 4, deadline: 45_000, now: clock2.now, sleep: clock2.sleep, idleMs: 2_000,
    claim: async () => null, hasOpenWork: async () => true, run: async () => 0,
  }));
  assert.equal(r2.claimed, 0);
  assert.ok(clock2.now() <= 45_000, 'waiting for due work stays inside the pass');
});
