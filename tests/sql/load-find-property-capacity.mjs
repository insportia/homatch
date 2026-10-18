// FIND PROPERTY CAPACITY — load test for 100 and 1,000 concurrent search starts on a THROWAWAY
// local Postgres built by run-find-property-capacity.sh (never production, no portal is called).
//
// Per level and request mix it reports:
//   - the start's database time (search insert + the dispatch transaction) p50/p95/p99, through a
//     60-connection pool like PostgREST's;
//   - per source request: answered from cache (REUSED / SHARED / pool-only) vs a genuinely new
//     portal job (LIVE);
//   - database load: commits, rows written, lock waits, active connections, Postgres CPU;
//   - fresh portal capacity and queue wait: the LIVE jobs played through each portal's real slots
//     and measured run times (production 2026-10-18), with the fair claim and its deadlines;
//   - the CPU of the instant pool answer (the real ranking pipeline over pooled listings).
//
// Usage (after run-find-property-capacity.sh has built the database):
//   PG_MODULE=/path/to/node_modules/pg node tests/sql/load-find-property-capacity.mjs
// `pg` is not a project dependency: install it outside the repo (npm i pg@8 in a scratch dir).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { processSearch } from '../../src/research-core/marketplace/pipeline.ts';
import * as F from '../../src/research-core/__tests__/fixtures/marketplaceFixtures.mjs';

const pg = createRequire(import.meta.url)(process.env.PG_MODULE || 'pg');
const pool = new pg.Pool({
  host: process.env.PGFIX_DIR || '/var/tmp/hm-pg', port: Number(process.env.PGFIX_PORT || 54329),
  user: 'postgres', database: process.env.PGDB || 'fpcap', max: Number(process.env.POOL || 60),
});
const q = (text, values) => pool.query(text, values);

/* Production, 2026-10-18 (30 days of worker runs). */
const WORKERS = [
  { id: 'myhome-agent', conc: 2, timeoutS: 900, p50: 13, p95: 36 },
  { id: 'ssge-agent', conc: 2, timeoutS: 900, p50: 114, p95: 884 },
  { id: 'homege-agent', conc: 1, timeoutS: 600, p50: 146, p95: 152 },
  { id: 'placege-agent', conc: 1, timeoutS: 600, p50: 54, p95: 57 },
  { id: 'allhome-agent', conc: 1, timeoutS: 600, p50: 29, p95: 156 },
];
const LEVELS = (process.env.LEVELS || '100,1000').split(',').map(Number);
const DISTINCT = Number(process.env.DISTINCT || 200);
const WARM = Number(process.env.WARM || 30);

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
/* Log-normal run time with the measured median and 95th percentile. */
const runtime = (w) => { const sigma = Math.max(0.05, Math.log(w.p95 / w.p50) / 1.645); const z = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()); return w.p50 * Math.exp(sigma * z); };
/* Zipf over DISTINCT criteria: a few popular searches (2-bedroom Vake/Saburtalo…) and a long tail. */
const zipf = (() => { const w = Array.from({ length: DISTINCT }, (_, i) => 1 / (i + 1)); const t = w.reduce((a, b) => a + b, 0); let c = 0; const cdf = w.map((x) => (c += x / t)); return () => { const u = rnd(); return cdf.findIndex((x) => x >= u); }; })();
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
/* CPU seconds used by every Postgres process (utime + stime from /proc, 100 ticks/s). */
const pgCpu = () => { try { return Number(execSync("for p in $(pgrep -x postgres); do awk '{print $14+$15}' /proc/$p/stat 2>/dev/null; done | awk '{s+=$1} END {print s+0}'").toString().trim()) / 100; } catch { return NaN; } };
const stats = async () => { await new Promise((r) => setTimeout(r, 1500)); return (await q(`select xact_commit, tup_inserted, tup_updated, blks_hit, blks_read from pg_stat_database where datname = current_database()`)).rows[0]; };

async function setup() {
  await q(`delete from public.rate_limit_events; delete from public.discovery_marketplace_listings; delete from public.discovery_marketplace_worker_runs;
           delete from public.discovery_marketplace_searches;`);
  for (const w of WORKERS) {
    await q(`insert into public.discovery_marketplace_workers (worker_id, source_key, source_name, execution_mode, state, enabled, supported_markets,
               supported_property_types, supported_transaction_types, token_hash, max_concurrency, max_attempts, timeout_ms)
             values ($1, $1, $1, 'BROWSER', 'ACTIVE', true, '{GE}', '{APARTMENT}', '{BUY}', repeat('d', 64), $2, 3, $3)
             on conflict (worker_id) do update set max_concurrency = excluded.max_concurrency, timeout_ms = excluded.timeout_ms, state = 'ACTIVE', enabled = true`,
      [w.id, w.conc, w.timeoutS * 1000]);
  }
  await q(`insert into public.users (id, created_at) values ('00000000-0000-4000-9000-ffffffffffff', now() - interval '90 days') on conflict (id) do nothing`);
  const { rows: [plan] } = await q(`insert into public.discovery_search_plans (direction, user_id, market, plan) values ('SUPPLY', '00000000-0000-4000-9000-ffffffffffff', 'GE', '{}') returning id`);
  /* Run-time history: 50 real-shaped runs per portal, so the median the dispatch reads is production's
     (one search per history slot: a search holds one run per portal). */
  for (let i = 0; i < 50; i++) {
    const { rows: [hist] } = await q(`insert into public.discovery_marketplace_searches (user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at, completed_at)
         values ('00000000-0000-4000-9000-ffffffffffff', $1, 'hist-' || gen_random_uuid(), 'COMPLETE', '{}', '{}', now(), now()) returning id`, [plan.id]);
    for (const w of WORKERS) {
      await q(`insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at, status, started_at, completed_at, returned_count)
               values ($1, $2, '{}', now(), 'COMPLETE', now() - make_interval(secs => $3::float8 + $4::float8), now() - make_interval(secs => $4::float8), 10)`, [hist.id, w.id, runtime(w), 7200 + i * 60]);
    }
  }
  return plan.id;
}

/* One user per request, established accounts: the platform's capacity, not one customer's quota. */
async function users(n) {
  await q(`insert into public.users (id, created_at) select ('00000000-0000-4000-8888-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days'
           from generate_series(1, $1) g on conflict (id) do nothing`, [n]);
}
const uid = (i) => `00000000-0000-4000-8888-${String(i).padStart(12, '0')}`;

/* Results finished in the last 30 minutes for the WARM most popular criteria (earlier traffic). */
async function warm(planId) {
  for (let k = 0; k < WARM; k++) {
    const { rows: [s] } = await q(`insert into public.discovery_marketplace_searches (user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at, completed_at)
         values ('00000000-0000-4000-9000-ffffffffffff', $1, 'warm-' || gen_random_uuid(), 'COMPLETE', '{}', '{}', now(), now()) returning id`, [planId]);
    for (const w of WORKERS) {
      await q(`insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at, status, started_at, completed_at, returned_count, request_key)
               values ($1, $2, '{}', now(), 'COMPLETE', now() - interval '10 minutes' - make_interval(secs => $4::float8), now() - interval '10 minutes', 40, $3)`,
        [s.id, w.id, `criteria-${k}`, runtime(w)]);
    }
  }
}

async function start(planId, i, key) {
  const t0 = performance.now();
  const c = await pool.connect();
  try {
    const { rows: [s] } = await c.query(`insert into public.discovery_marketplace_searches (user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
         values ($1, $2, 'load-' || gen_random_uuid(), 'DISPATCHING', '{}', '{}', now() + interval '20 minutes') returning id`, [uid(i), planId]);
    const runs = WORKERS.map((w) => ({ worker_id: w.id, request: { key }, request_key: key, deadline_at: new Date(Date.now() + w.timeoutS * 1000).toISOString() }));
    const { rows: [d] } = await c.query('select public.marketplace_dispatch_search($1, $2, $3, $4::jsonb) as d', [s.id, uid(i), `10.${i >> 16 & 255}.${i >> 8 & 255}.${i & 255}`, JSON.stringify(runs)]);
    return { ms: performance.now() - t0, d: d.d };
  } finally { c.release(); }
}

/* The LIVE jobs through each portal: fair order (one requester per job here), slots, run times,
   the claim's "less than half the median left" rule and each job's deadline. */
function playPortals(liveByWorker) {
  const out = {};
  for (const w of WORKERS) {
    const jobs = (liveByWorker[w.id] ?? []).map((createdS) => ({ createdS, deadlineS: createdS + w.timeoutS }));
    const slots = Array(w.conc).fill(0);
    const waits = []; let done = 0; let expired = 0; let drain = 0;
    for (const j of jobs) {
      const i = slots.indexOf(Math.min(...slots));
      const startS = Math.max(slots[i], j.createdS);
      if (j.deadlineS - startS < w.p50 / 2) { expired++; continue; }
      const end = Math.min(startS + runtime(w), j.deadlineS);
      slots[i] = end; drain = Math.max(drain, end);
      waits.push(startS - j.createdS);
      if (end < j.deadlineS) done++; else expired++;
    }
    out[w.id] = { live: jobs.length, finished: done, expired, waitP50: pct(waits, 0.5), waitP95: pct(waits, 0.95), drainS: drain,
      perHour: Math.round(3600 / w.p50 * w.conc) };
  }
  return out;
}

/* CPU of ranking pooled listings with the real pipeline (the instant answer ranks each source's
   pool, then everything): one source and five sources, warmed up, p50 and max of 6. */
function poolAnswerCpu() {
  const mk = (n, src) => Array.from({ length: n }, (_, i) => F.listing({
    source: src, sourceListingId: `${src}-${i}`, price: 130000 + (i * 37) % 40000, areaSqm: 80 + (i % 30), floor: 1 + (i % 25),
    seller: { publicPhone: `+995 5${String(20000000 + i)}`, declaredType: i % 7 === 0 ? 'OWNER' : null, sourceListingCount: i % 7 === 0 ? 1 : null },
  }));
  const time = (cands) => { const t = []; for (let k = 0; k < 6; k++) { const c0 = process.cpuUsage(); processSearch({ request: F.FIXTURE_REQUEST, candidates: cands, now: new Date() }); const c = process.cpuUsage(c0); t.push((c.user + c.system) / 1000); } t.sort((x, y) => x - y); return { p50: Math.round(t[3]), max: Math.round(t[5]) }; };
  time(F.fixtureCandidates(mk(500, 'source-a')));
  const res = {};
  for (const n of [500, 1000, 3000]) res[`oneSource_${n}`] = time(F.fixtureCandidates(mk(n, 'source-a')));
  for (const n of [200, 1000]) res[`fiveSources_${n}each`] = time(F.fixtureCandidates(['a', 'b', 'c', 'd', 'e'].flatMap((x) => mk(n, `source-${x}`))));
  return res;
}

async function level(planId, n, mix) {
  await q(`delete from public.rate_limit_events; delete from public.discovery_marketplace_worker_runs where search_id in (select id from public.discovery_marketplace_searches where idempotency_key like 'load-%');
           delete from public.discovery_marketplace_searches where idempotency_key like 'load-%'`);
  await users(n);
  const keys = Array.from({ length: n }, (_, i) => (mix === 'unique' ? `unique-${n}-${i}` : `criteria-${zipf()}`));
  const before = await stats();
  const cpu0 = pgCpu();
  let maxWaiting = 0; let maxActive = 0; let sampling = true;
  const sampler = (async () => { while (sampling) {
    const { rows: [r] } = await q(`select (select count(*) from pg_locks where not granted) w, (select count(*) from pg_stat_activity where state = 'active' and datname = current_database()) a`).catch(() => ({ rows: [{ w: 0, a: 0 }] }));
    maxWaiting = Math.max(maxWaiting, Number(r.w)); maxActive = Math.max(maxActive, Number(r.a));
    await new Promise((res) => setTimeout(res, 20));
  } })();
  const t0 = performance.now();
  const results = await Promise.all(keys.map((k, i) => start(planId, i + 1, k)));
  const wall = performance.now() - t0;
  sampling = false; await sampler;
  const cpu1 = pgCpu();
  const after = await stats();
  const modes = {}; const liveByWorker = {};
  for (const r of results) for (const run of r.d.runs) {
    modes[run.mode] = (modes[run.mode] ?? 0) + 1;
    if (run.mode === 'LIVE') (liveByWorker[run.workerId] ??= []).push(0);
  }
  const sourceRequests = results.length * WORKERS.length;
  const cached = sourceRequests - (modes.LIVE ?? 0);
  const ms = results.map((r) => r.ms);
  return {
    level: n, mix, wallMs: Math.round(wall), startDb: { p50: +pct(ms, 0.5).toFixed(1), p95: +pct(ms, 0.95).toFixed(1), p99: +pct(ms, 0.99).toFixed(1) },
    sourceRequests, modes, cachedPct: +(100 * cached / sourceRequests).toFixed(1), livePortalJobs: modes.LIVE ?? 0,
    searchesWithAnyLive: results.filter((r) => r.d.live > 0).length,
    db: { commits: after.xact_commit - before.xact_commit, rowsInserted: after.tup_inserted - before.tup_inserted, rowsUpdated: after.tup_updated - before.tup_updated, blocksTouched: (after.blks_hit - before.blks_hit) + (after.blks_read - before.blks_read),
          maxLockWaits: maxWaiting, maxActive, pgCpuS: Number.isFinite(cpu1 - cpu0) ? +(cpu1 - cpu0).toFixed(2) : null },
    portals: playPortals(liveByWorker),
  };
}

const planId = await setup();
const report = { poolAnswerCpuMs: poolAnswerCpu(), runs: [] };
for (const n of LEVELS) for (const mix of ['realistic', 'unique']) {
  if (mix === 'realistic') await warm(planId);
  report.runs.push(await level(planId, n, mix));
}
console.log(JSON.stringify(report, null, 2));
await pool.end();
