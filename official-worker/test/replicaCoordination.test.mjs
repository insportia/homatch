// replicaCoordination.test.mjs — Verify at scale: limits and market runs that hold across worker replicas.
// The SQL behind the semaphore and the market-run table is proven on PGlite (scripts/verify/worker-semaphore-db-check.mjs);
// here the worker-side behaviour is covered with an in-memory coordinator standing in for verify-queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GlobalSemaphore } from '../.tstest-build/queue/globalSemaphore.js';
import { VerifyMarketRuntime, parseVerifyMarketProfile } from '../.tstest-build/verify/VerifyMarketRuntime.js';

/** verify-queue's sem_acquire/sem_release semantics, in memory. */
function coordinator() {
  const slots = new Map();
  return {
    slots,
    async semAcquire(key, holder, max) {
      const held = slots.get(key) ?? new Set();
      if (held.has(holder)) return { acquired: true };
      if (held.size >= max) return { acquired: false };
      held.add(holder); slots.set(key, held);
      return { acquired: true };
    },
    async semRelease(key, holder) { return { released: slots.get(key)?.delete(holder) ?? false }; },
  };
}

test('six replicas share one MyHome slot: one runs, the others wait or give up at their deadline', async () => {
  const c = coordinator();
  const replicas = Array.from({ length: 6 }, (_, i) => new GlobalSemaphore(c, `replica-${i}`));
  const first = await replicas[0].acquire('myhome', 1, { pollMs: 5 });
  assert.ok(first);
  const others = await Promise.all(replicas.slice(1).map((r) => r.acquire('myhome', 1, { deadlineAt: Date.now() + 30, pollMs: 5 })));
  assert.ok(others.every((s) => s === null), 'no second MyHome run anywhere');
  await first.release();
  const next = await replicas[3].acquire('myhome', 1, { pollMs: 5 });
  assert.ok(next, 'the slot moves to another replica once released');
  await next.release();
});

test('an unreachable coordinator never stalls work: the process limit applies', async () => {
  const broken = { semAcquire: async () => { throw new Error('verify-queue down'); }, semRelease: async () => ({ released: false }) };
  const slot = await new GlobalSemaphore(broken).acquire('myhome', 1, { pollMs: 5 });
  assert.ok(slot);
  await slot.release();
  const none = await new GlobalSemaphore(null).acquire('myhome', 1);
  assert.ok(none, 'one replica, no coordinator: behaves as before');
});

test('a market run is written when it starts and when it completes, so any replica can answer the poll', async () => {
  const writes = [];
  const acquire = async (_req, { report }) => { await report({ status: 'RESULTS_RECEIVED', listings: [] }); };
  const rt = new VerifyMarketRuntime({ acquireMyHome: acquire, acquireSsge: acquire, persist: async (job) => { writes.push(job.status); } });
  const job = rt.start(parseVerifyMarketProfile({ city: 'თბილისი', district: 'ვაკე', propertyType: 'APARTMENT', areaSqm: 70 }), ['MYHOME']);
  while (job.status !== 'COMPLETE') await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(writes, ['RUNNING', 'COMPLETE']);
  const failing = new VerifyMarketRuntime({ acquireMyHome: acquire, acquireSsge: acquire, persist: async () => { throw new Error('db down'); } });
  const j2 = failing.start(parseVerifyMarketProfile({ city: 'თბილისი', district: 'ვაკე', propertyType: 'APARTMENT', areaSqm: 70 }), ['MYHOME']);
  while (j2.status !== 'COMPLETE') await new Promise((r) => setTimeout(r, 5));
  assert.equal(j2.status, 'COMPLETE', 'a failed write never fails the search');
});

test('wiring: MyHome takes the shared slot on both paths; the worker builds the coordinator from the queue gateway', () => {
  const myhome = readFileSync(new URL('../src/marketplace/MyHomeRuntime.ts', import.meta.url), 'utf8');
  assert.match(myhome, /semaphore\.acquire\('myhome', globalMax/);
  assert.match(myhome, /semaphore\?\.acquire\('myhome', globalMax/);
  assert.match(myhome, /await verifySlot\?\.release\(\);/);
  assert.match(myhome, /await heldSlots\.shift\(\)\?\.release\(\);/);
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /startMyHomeRuntime\(process\.env, fetch, sharedSemaphore\)/);
  assert.match(index, /persist: marketRunStore\(\)/);
  const queue = readFileSync(new URL('../../supabase/functions/verify-queue/index.ts', import.meta.url), 'utf8');
  for (const a of ["case 'sem_acquire'", "case 'sem_release'", "case 'market_put'"]) assert.ok(queue.includes(a), a);
  const ra = readFileSync(new URL('../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  assert.match(ra, /from\('verify_market_runs'\)\.select\('status,payload'\)/);
  assert.equal((ra.match(/await marketRun\(/g) ?? []).length, 2, 'both market polls read across replicas');
});

test('scale-down: a draining replica claims nothing new, lets a running task finish within the grace, and hands back the rest', async () => {
  const { QueueRunner } = await import('../.tstest-build/queue/QueueRunner.js');
  const mk = (id) => ({ id, source: 'TAS_MAP', lane: 'BROWSER', fencingToken: 1, leaseSeconds: 600, attempts: 1, input: {} });
  const queue = [mk('fast'), mk('slow')];
  const calls = { claim: 0, complete: [], release: [] };
  const started = new Set();
  const gateway = {
    async claim(_w, _l, limit) { calls.claim++; return { tasks: queue.splice(0, limit) }; },
    async heartbeat() { return { state: 'OK' }; },
    async complete(t) { calls.complete.push(t.id); return { ok: true }; },
    async fail() { return { ok: true }; },
    async release(t) { calls.release.push(t.id); return { released: true }; },
  };
  const runner = new QueueRunner({
    gateway, workerId: 'r1', lanes: { BROWSER: 2 }, idleMinMs: 5, idleMaxMs: 10, heartbeatMinMs: 5,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    executor: async (task, { signal }) => {
      started.add(task.id);
      await new Promise((res, rej) => { const t = setTimeout(res, task.id === 'fast' ? 30 : 5000); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('SHUTDOWN')); }); });
      return { type: 'complete', result: { ok: true } };
    },
  });
  runner.start();
  while (started.size < 2) await new Promise((r) => setTimeout(r, 5));
  const claimsBefore = calls.claim;
  queue.push(mk('arrived-later'));
  await runner.stop(200);
  assert.deepEqual(calls.complete, ['fast'], 'the task that could finish within the grace finished');
  assert.deepEqual(calls.release, ['slow'], 'the one that could not went back to the queue');
  assert.ok(calls.claim <= claimsBefore + 1 && queue.length === 1, 'nothing new was claimed while draining');
});
