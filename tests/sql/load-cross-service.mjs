// CROSS-SERVICE LOAD — does heavy background work in one service slow unrelated interactive
// requests? Runs on the THROWAWAY local Postgres built by run-find-property-capacity.sh plus the
// Verify durable-execution schema (see usage). Never production; no portal, provider or model is
// called: background work is the real queue SQL with simulated work time.
//
// Per level (simulated users) it runs, through ONE 60-connection pool (as PostgREST shares one):
//   interactive: Find Property status polls, Verify job status reads, ordinary navigation reads
//   background:  Find Property search starts (dispatch), Verify task enqueue → claim → complete
//                loops (HTTP and BROWSER lanes at production slot counts), portal-worker claims
// first with the interactive load alone, then with the background load, and reports interactive
// p50/p95/p99, background throughput, lock waits, active connections and Postgres CPU.
//
// Usage:
//   bash tests/sql/run-find-property-capacity.sh
//   P="psql -h /var/tmp/hm-pg -p 54329 -U postgres -d fpcap -v ON_ERROR_STOP=1 -q"
//   $P -f tests/sql/verify_durable_execution_fixture.sql
//   $P -1 -f supabase/migrations/20261026090000_verify_durable_execution.sql
//   PG_MODULE=/path/to/node_modules/pg node tests/sql/load-cross-service.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const pg = createRequire(import.meta.url)(process.env.PG_MODULE || 'pg');
const pool = new pg.Pool({ host: process.env.PGFIX_DIR || '/var/tmp/hm-pg', port: Number(process.env.PGFIX_PORT || 54329),
  user: 'postgres', database: process.env.PGDB || 'fpcap', max: Number(process.env.POOL || 60) });
const q = (t, v) => pool.query(t, v);
const LEVELS = (process.env.LEVELS || '100,500,1000').split(',').map(Number);
const WINDOW_MS = Number(process.env.WINDOW_MS || 15_000);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pgCpu = () => { try { return Number(execSync("for p in $(pgrep -x postgres); do awk '{print $14+$15}' /proc/$p/stat 2>/dev/null; done | awk '{s+=$1} END {print s+0}'").toString()) / 100; } catch { return NaN; } };
const WORKERS = [['myhome-agent', 2, 900], ['ssge-agent', 2, 900], ['homege-agent', 1, 600], ['placege-agent', 1, 600], ['allhome-agent', 1, 600]];
const VERIFY_SOURCES = ['tas', 'mygov', 'TAS_MAP', 'debtor', 'enreg', 'rstax', 'tas_legacy'];

async function setup(maxUsers) {
  await q(`delete from public.rate_limit_events; delete from public.discovery_marketplace_listings; delete from public.discovery_marketplace_worker_runs;
           delete from public.discovery_marketplace_searches; delete from public.verify_tasks; delete from public.research_jobs`);
  for (const [id, conc, t] of WORKERS) {
    await q(`insert into public.discovery_marketplace_workers (worker_id, source_key, source_name, execution_mode, state, enabled, supported_markets,
               supported_property_types, supported_transaction_types, token_hash, max_concurrency, max_attempts, timeout_ms)
             values ($1, $1, $1, 'BROWSER', 'ACTIVE', true, '{GE}', '{APARTMENT}', '{BUY}', repeat('d', 64), $2, 3, $3)
             on conflict (worker_id) do update set max_concurrency = excluded.max_concurrency, timeout_ms = excluded.timeout_ms, state = 'ACTIVE', enabled = true`, [id, conc, t * 1000]);
  }
  await q(`insert into public.users (id, created_at) select ('00000000-0000-4000-7777-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days'
           from generate_series(1, $1) g on conflict (id) do nothing`, [maxUsers]);
  const { rows: [plan] } = await q(`insert into public.discovery_search_plans (direction, user_id, market, plan) values ('SUPPLY', '00000000-0000-4000-7777-000000000001', 'GE', '{}') returning id`);
  /* Every user already has one search and one Verify job to poll (their open screens). */
  await q(`insert into public.discovery_marketplace_searches (id, user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
           select ('00000000-0000-4000-6666-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-7777-' || lpad(g::text, 12, '0'))::uuid, $2,
                  'poll-' || lpad(g::text, 8, '0'), 'SEARCHING', '{}', '{}', now() + interval '1 hour' from generate_series(1, $1) g`, [maxUsers, plan.id]);
  await q(`insert into public.research_jobs (id, user_id, status) select ('00000000-0000-4000-5555-' || lpad(g::text, 12, '0'))::uuid,
           ('00000000-0000-4000-7777-' || lpad(g::text, 12, '0'))::uuid, 'RUNNING' from generate_series(1, $1) g`, [maxUsers]);
  return plan.id;
}
const uid = (i) => `00000000-0000-4000-7777-${String(i).padStart(12, '0')}`;
const sid = (i) => `00000000-0000-4000-6666-${String(i).padStart(12, '0')}`;
const jid = (i) => `00000000-0000-4000-5555-${String(i).padStart(12, '0')}`;

/* Interactive: what an open screen does every few seconds. */
const INTERACTIVE = [
  ['find_property_status', (i) => q(`select s.id, s.status, s.properties_count, (select json_agg(json_build_object('w', r.worker_id, 's', r.status, 'n', r.returned_count))
                                        from public.discovery_marketplace_worker_runs r where r.search_id = s.id) runs
                                      from public.discovery_marketplace_searches s where s.id = $1 and s.user_id = $2`, [sid(i), uid(i)])],
  ['verify_status', (i) => q(`select j.status, (select json_agg(json_build_object('s', t.source, 'st', t.state)) from public.verify_tasks t where t.job_id = j.id) tasks
                               from public.research_jobs j where j.id = $1 and j.user_id = $2`, [jid(i), uid(i)])],
  ['navigation', (i) => q(`select id, created_at from public.users where id = $1`, [uid(i)])],
];

async function interactiveLoad(users, until, lat) {
  const loops = [];
  for (let i = 1; i <= users; i++) loops.push((async () => {
    await sleep(Math.random() * 3000);
    while (Date.now() < until) {
      const [name, f] = INTERACTIVE[Math.floor(Math.random() * INTERACTIVE.length)];
      const t = performance.now();
      try { await f(i); (lat[name] ??= []).push(performance.now() - t); } catch { (lat.errors ??= []).push(1); }
      await sleep(2500 + Math.random() * 1000); // a screen polls every ~3 s
    }
  })());
  await Promise.all(loops);
}

async function backgroundLoad(users, until, planId, stats) {
  const tasks = [];
  /* Find Property: 30 % of users start a new search during the window. */
  const starters = Math.round(users * 0.3);
  for (let k = 0; k < starters; k++) tasks.push((async () => {
    await sleep(Math.random() * (until - Date.now()) * 0.8);
    const i = 1 + Math.floor(Math.random() * users);
    try {
      const { rows: [s] } = await q(`insert into public.discovery_marketplace_searches (user_id, search_plan_id, idempotency_key, status, brief, request, deadline_at)
           values ($1, $2, 'bg-' || gen_random_uuid(), 'DISPATCHING', '{}', '{}', now() + interval '20 minutes') returning id`, [uid(i), planId]);
      const key = `crit-${Math.floor(Math.random() * 120)}`;
      await q('select public.marketplace_dispatch_search($1, $2, null, $3::jsonb)', [s.id, uid(i),
        JSON.stringify(WORKERS.map(([w, , t]) => ({ worker_id: w, request: { key }, request_key: key, deadline_at: new Date(Date.now() + t * 1000).toISOString() })))]);
      stats.fpStarts++;
    } catch { stats.errors++; }
  })());
  /* Verify: 20 % of users submit a job (7 source tasks each). */
  const jobs = Math.round(users * 0.2);
  for (let k = 0; k < jobs; k++) tasks.push((async () => {
    await sleep(Math.random() * (until - Date.now()) * 0.8);
    const i = 1 + Math.floor(Math.random() * users);
    try {
      for (const src of VERIFY_SOURCES) await q('select public.verify_task_enqueue($1, $2, $3, null, $4::jsonb, 100)', [jid(i), src, `${src}:${i}:${k}`, '{}']);
      stats.verifyJobs++;
    } catch { stats.errors++; }
  })());
  /* The worker: HTTP 12 + BROWSER 3 slots, claim → simulated work → complete. */
  const lane = (name, slots, workMs) => Array.from({ length: slots }, () => (async () => {
    while (Date.now() < until) {
      try {
        const { rows } = await q('select public.verify_task_claim($1, $2, 1) as t', [`load-${name}`, [name]]);
        const t = rows[0]?.t;
        if (!t) { await sleep(200); continue; }
        await sleep(workMs());
        await q("select public.verify_task_complete($1, $2, '{}'::jsonb)", [t.id, t.fencingToken ?? t.fencing_token ?? 0]);
        stats.verifyTasksDone++;
      } catch { stats.errors++; await sleep(100); }
    }
  })());
  tasks.push(...lane('HTTP', 12, () => 200 + Math.random() * 800), ...lane('BROWSER', 3, () => 1500 + Math.random() * 2500));
  /* Portal workers polling for runs (each portal claims every second). */
  for (const [w] of WORKERS) tasks.push((async () => {
    while (Date.now() < until) {
      try { const { rows } = await q('select id from public.claim_marketplace_worker_runs($1, 5, 120)', [w]); stats.portalClaims += rows.length; } catch { stats.errors++; }
      await sleep(1000);
    }
  })());
  await Promise.all(tasks);
}

async function phase(users, planId, withBackground) {
  const lat = {}; const stats = { fpStarts: 0, verifyJobs: 0, verifyTasksDone: 0, portalClaims: 0, errors: 0 };
  let maxWaiting = 0; let maxActive = 0; let sampling = true;
  const sampler = (async () => { while (sampling) {
    const { rows: [r] } = await q(`select (select count(*) from pg_locks where not granted) w, (select count(*) from pg_stat_activity where state = 'active' and datname = current_database()) a`).catch(() => ({ rows: [{ w: 0, a: 0 }] }));
    maxWaiting = Math.max(maxWaiting, Number(r.w)); maxActive = Math.max(maxActive, Number(r.a)); await sleep(50);
  } })();
  const cpu0 = pgCpu();
  const until = Date.now() + WINDOW_MS;
  await Promise.all([interactiveLoad(users, until, lat), withBackground ? backgroundLoad(users, until, planId, stats) : null]);
  sampling = false; await sampler;
  const out = { users, background: withBackground, pgCpuS: +(pgCpu() - cpu0).toFixed(2), maxLockWaits: maxWaiting, maxActiveConnections: maxActive, interactive: {}, stats };
  for (const [k, v] of Object.entries(lat)) if (k !== 'errors') out.interactive[k] = { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), p99: pct(v, 0.99) };
  out.interactiveErrors = (lat.errors ?? []).length;
  return out;
}

const planId = await setup(Math.max(...LEVELS));
const report = [];
for (const n of LEVELS) {
  report.push(await phase(n, planId, false));
  report.push(await phase(n, planId, true));
}
console.log(JSON.stringify(report, null, 2));
await pool.end();
