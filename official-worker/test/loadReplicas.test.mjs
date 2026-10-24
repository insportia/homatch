// loadReplicas.test.mjs — Verify at scale, load tests with mocks (owner 2026-10-24).
//
// The REAL QueueRunner, several instances standing in for Railway replicas, against an in-memory queue that keeps
// verify_task_claim's rules: per-source cluster caps (verify_source_policy.max_running), fenced leases, release on
// drain. Task durations are production's measured medians/p95 (verify_tasks, 30 days to 2026-10-24) compressed
// 1 s → 0.5 ms, so a burst of 1,000 verifications runs in seconds. Proven here: every task completes exactly once,
// no source cap is ever exceeded, scaling down mid-burst (drain) loses and duplicates nothing, and more replicas
// help only until the source caps bind. The wall-clock projection with real durations is
// scripts/verify/load-sim.mjs; these runs check the mechanism that projection assumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueRunner } from '../.tstest-build/queue/QueueRunner.js';

const SCALE = 0.5; // ms per production second
// Production 2026-10-24: max_running and measured durations (seconds) per source.
const SOURCES = {
  tas: { lane: 'HTTP', cap: 24, p50: 230, p95: 557 },
  mygov: { lane: 'HTTP', cap: 16, p50: 129, p95: 346 },
  TAS_MAP: { lane: 'BROWSER', cap: 8, p50: 51, p95: 155 },
  enreg: { lane: 'BROWSER', cap: 6, p50: 13, p95: 19 },
  debtor: { lane: 'BROWSER', cap: 6, p50: 5, p95: 7 },
  rstax: { lane: 'BROWSER', cap: 4, p50: 65, p95: 92 },
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
/** Lognormal through the measured p50 and p95. */
function duration(src, r) {
  const { p50, p95 } = SOURCES[src];
  const sigma = Math.log(p95 / p50) / 1.645;
  const u = Math.max(1e-9, r()), v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(p95 * 3, p50 * Math.exp(sigma * z));
}

/** One verification's official tasks, as production plans them: TAS, 1–3 MyGov records, the map, and for a company owner ENREG/DEBTOR/RS. */
function planJobs(n, seed = 7) {
  const r = rng(seed), tasks = [];
  for (let j = 0; j < n; j++) {
    const jobId = `job-${j}`;
    const add = (source) => tasks.push({ id: `${jobId}:${source}:${tasks.length}`, jobId, source, lane: SOURCES[source].lane, dur: duration(source, r) });
    add('tas'); add('TAS_MAP');
    const records = 1 + Math.floor(r() * 3);
    for (let k = 0; k < records; k++) add('mygov');
    if (r() < 0.4) { add('enreg'); add('debtor'); add('rstax'); }
  }
  return tasks;
}

class MemQueue {
  constructor(tasks) {
    this.rows = new Map(tasks.map((t, i) => [t.id, { ...t, order: i, state: 'QUEUED', token: 0, owner: null, attempts: 0 }]));
    this.running = Object.fromEntries(Object.keys(SOURCES).map((s) => [s, 0]));
    this.peak = { ...this.running };
    this.accepted = new Map();
    this.rejected = 0;
    this.released = 0;
  }
  async claim(worker, lanes, limit) {
    const out = [];
    for (const row of this.rows.values()) {
      if (out.length >= limit) break;
      if (row.state !== 'QUEUED' || !lanes.includes(row.lane) || this.running[row.source] >= SOURCES[row.source].cap) continue;
      row.state = 'RUNNING'; row.owner = worker; row.token++; row.attempts++;
      this.running[row.source]++;
      this.peak[row.source] = Math.max(this.peak[row.source], this.running[row.source]);
      out.push({ id: row.id, jobId: row.jobId, source: row.source, lane: row.lane, dedupeKey: row.id, scopeKey: null, input: { dur: row.dur }, state: 'RUNNING', attempts: row.attempts, maxAttempts: 4, fencingToken: row.token, leaseSeconds: 600 });
    }
    return { tasks: out };
  }
  async heartbeat(t) { const r = this.rows.get(t.id); return { state: r.state === 'RUNNING' && r.token === t.fencingToken ? 'OK' : 'LOST' }; }
  async complete(t) {
    const r = this.rows.get(t.id);
    if (r.state !== 'RUNNING' || r.token !== t.fencingToken) { this.rejected++; return { ok: false, reason: 'FENCED' }; }
    r.state = 'SUCCEEDED'; this.running[r.source]--;
    this.accepted.set(t.id, (this.accepted.get(t.id) ?? 0) + 1);
    return { ok: true };
  }
  async fail(t) { return this.release(t); }
  async release(t) {
    const r = this.rows.get(t.id);
    if (r.state !== 'RUNNING' || r.token !== t.fencingToken) return { released: false };
    r.state = 'QUEUED'; r.owner = null; this.running[r.source]--; this.released++;
    return { released: true };
  }
  done() { for (const r of this.rows.values()) if (r.state !== 'SUCCEEDED') return false; return true; }
}

const executor = async (task, ctx) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, task.input.dur * SCALE);
    ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });
  return { type: 'complete', result: { ok: true } };
};

function replica(q, i) {
  return new QueueRunner({ gateway: q, executor, workerId: `replica-${i}`, lanes: { HTTP: 12, BROWSER: 3 }, idleMinMs: 2, idleMaxMs: 10, heartbeatMinMs: 1000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
}

async function burst(jobs, replicas, { scaleDownAfterMs = null, keep = 1 } = {}) {
  const q = new MemQueue(planJobs(jobs));
  const runners = Array.from({ length: replicas }, (_, i) => replica(q, i));
  const t0 = Date.now();
  runners.forEach((r) => r.start());
  if (scaleDownAfterMs !== null) {
    setTimeout(() => { for (const r of runners.slice(keep)) void r.stop(5); }, scaleDownAfterMs);
  }
  while (!q.done()) await new Promise((r) => setTimeout(r, 5));
  const ms = Date.now() - t0;
  await Promise.all(runners.map((r) => r.stop(50)));
  return { q, ms, seconds: Math.round(ms / SCALE) };
}

function assertExactlyOnce(q) {
  assert.equal(q.accepted.size, q.rows.size, 'every task completed');
  for (const [id, n] of q.accepted) assert.equal(n, 1, `${id} completed ${n} times`);
  for (const s of Object.keys(SOURCES)) assert.ok(q.peak[s] <= SOURCES[s].cap, `${s} peaked at ${q.peak[s]} > cap ${SOURCES[s].cap}`);
}

test('50 verifications on 1 replica: all complete once, caps hold', async () => {
  const { q, seconds } = await burst(50, 1);
  assertExactlyOnce(q);
  console.log(`[load] 50 jobs, 1 replica: ~${Math.round(seconds / 60)} min equivalent (${q.rows.size} tasks)`);
});

test('200 verifications: 3 replicas beat 1; 6 add little once the source caps bind', async () => {
  const one = await burst(200, 1);
  const three = await burst(200, 3);
  const six = await burst(200, 6);
  for (const r of [one, three, six]) assertExactlyOnce(r.q);
  console.log(`[load] 200 jobs: 1 replica ~${Math.round(one.seconds / 60)} min, 3 ~${Math.round(three.seconds / 60)} min, 6 ~${Math.round(six.seconds / 60)} min (equivalent)`);
  assert.ok(three.ms < one.ms * 0.75, `3 replicas (${three.ms} ms) should clearly beat 1 (${one.ms} ms)`);
  assert.ok(six.ms > three.ms * 0.6, 'past the source caps, doubling replicas cannot halve the time');
  // What binds at 3+ replicas is a source cap, not worker slots: MyGov (cap 16, 1–3 records per verification).
  assert.equal(three.q.peak.mygov, SOURCES.mygov.cap, 'with 3 replicas MyGov runs at its full cap');
  assert.equal(six.q.peak.mygov, SOURCES.mygov.cap);
});

test('1,000 verifications on 6 replicas, scaled down to 3 mid-burst: nothing lost, nothing run twice', async () => {
  const { q, seconds } = await burst(1000, 6, { scaleDownAfterMs: 400, keep: 3 });
  assertExactlyOnce(q);
  assert.ok(q.released > 0, 'the drained replicas handed their running tasks back');
  assert.equal(q.rejected, 0, 'no fenced completion: a released task was never completed by its old owner');
  console.log(`[load] 1,000 jobs, 6→3 replicas mid-burst: ~${Math.round(seconds / 60)} min equivalent, ${q.released} tasks handed back on drain`);
});
