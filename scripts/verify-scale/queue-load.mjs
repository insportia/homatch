#!/usr/bin/env node
/*
 * VERIFY QUEUE LOAD HARNESS — measured, not assumed.
 *
 * Runs against a SCRATCH Postgres (never production) with the
 * verify_durable_execution migration applied. Uses pgbench (ships with
 * Postgres) so the harness adds no project dependency. No government site,
 * provider or paid API is ever called: workers are simulated in SQL.
 *
 *   PGHOST=/tmp PGPORT=55432 PGUSER=postgres node scripts/verify-scale/queue-load.mjs
 *
 * Scenarios (each starts from an empty database):
 *   admission-<N>   N submission attempts from C concurrent connections: each
 *                   inserts a research job with a client_request_id (10 % are
 *                   duplicate retries of an earlier id) and enqueues its three
 *                   official tasks. Checks: no lost job, no duplicate job,
 *                   exactly three tasks per job.
 *   drain           W simulated worker replicas claim (batch 5) and complete
 *                   every queued task. Checks: every task completed exactly
 *                   once (attempts = 1, no double completion).
 *   crash           half the claims are abandoned (worker killed): leases
 *                   expire, are recovered, and every task still completes once.
 *   same-building   1,000 jobs for flats of ONE building: TAS case files are
 *                   read once for the whole building (each flat's task
 *                   delegates to the parcel scope, as the worker does);
 *                   TAS_MAP and MyGov run once per distinct flat, not per job.
 *   many-buildings  10,000 jobs over 200 buildings × 50 flats.
 *
 * Output: one JSON report on stdout (latency percentiles from pgbench logs).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.VERIFY_SCALE_DB || 'verify_scale';
const env = { ...process.env, PGHOST: process.env.PGHOST || '/tmp', PGPORT: process.env.PGPORT || '55432', PGUSER: process.env.PGUSER || 'postgres' };
const BIN = process.env.PG_BIN || '';
const bin = (n) => (BIN ? join(BIN, n) : n);

function psql(sql, db = DB) {
  return execFileSync(bin('psql'), ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { env, encoding: 'utf8' }).trim();
}
function psqlFile(file, db = DB) {
  execFileSync(bin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', file], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function resetDb() {
  psql(`drop database if exists ${DB}`, 'postgres');
  psql(`create database ${DB}`, 'postgres');
  psqlFile(join(ROOT, 'tests/sql/verify_durable_execution_fixture.sql'));
  psqlFile(join(ROOT, 'supabase/migrations/20261026090000_verify_durable_execution.sql'));
  psql(`alter table public.research_jobs add column if not exists query text`);
}

function percentiles(latUs) {
  const a = [...latUs].sort((x, y) => x - y);
  const p = (q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] / 1000 : null);
  return { n: a.length, p50ms: p(0.5), p95ms: p(0.95), p99ms: p(0.99), maxms: a.length ? a[a.length - 1] / 1000 : null };
}

/** Run a pgbench custom script; return { latency, tps, failed, wallMs }. */
function bench(script, { clients, transactions, label, vars = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'vqload-'));
  const f = join(dir, 'script.sql');
  writeFileSync(f, script);
  const args = ['-n', '-f', f, '-c', String(clients), '-j', String(Math.min(clients, 8)), '-t', String(transactions), '-l', '--log-prefix', join(dir, 'log')];
  for (const [k, v] of Object.entries(vars)) args.push('-D', `${k}=${v}`);
  args.push(DB);
  const t0 = Date.now();
  const out = spawnSync(bin('pgbench'), args, { env, encoding: 'utf8' });
  const wallMs = Date.now() - t0;
  const lat = [];
  for (const name of readdirSync(dir).filter((x) => x.startsWith('log'))) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 3 && /^\d+$/.test(cols[2])) lat.push(Number(cols[2]));
    }
  }
  rmSync(dir, { recursive: true, force: true });
  const tps = Number((out.stdout.match(/tps = ([\d.]+)/) || [])[1] || 0);
  const failed = Number((out.stdout.match(/number of failed transactions: (\d+)/) || [])[1] || 0);
  if (out.status !== 0) throw new Error(`${label}: pgbench failed\n${out.stderr}\n${out.stdout}`);
  return { label, clients, transactions: clients * transactions, wallMs, tps, failed, latency: percentiles(lat) };
}

// One submission: a job keyed by (owner, client_request_id); 10 % are retries
// of an earlier request id. Then the three official tasks. One transaction,
// exactly what research-agent's start does in QUEUE mode.
const ADMISSION = `
\\set u random(1, 2000)
\\set r random(1, 1000000000)
\\set dup random(1, 10)
\\set b random(1, :buildings)
\\set f random(1, 50)
begin;
insert into public.research_jobs (user_id, client_request_id, query)
values (('00000000-0000-4000-8000-' || lpad(:u::text, 12, '0'))::uuid,
        case when :dup = 1 then 'retry-' || (:r % 50) else 'req-' || :r end,
        '01.18.06.' || lpad(:b::text, 3, '0') || '.055.03.01.' || lpad(:f::text, 3, '0'))
on conflict ((coalesce(user_id::text, anon_session_id::text)), client_request_id) where client_request_id is not null do nothing;
select public.verify_task_enqueue(j.id, 'tas', 'tas', 'tas:' || j.query, jsonb_build_object('cadastral', j.query)),
       public.verify_task_enqueue(j.id, 'TAS_MAP', 'TAS_MAP', 'TAS_MAP:' || j.query, jsonb_build_object('cadastral', j.query)),
       public.verify_task_enqueue(j.id, 'mygov', 'mygov', 'mygov:' || j.query, jsonb_build_object('cadastral', j.query))
  from public.research_jobs j
 where j.user_id = ('00000000-0000-4000-8000-' || lpad(:u::text, 12, '0'))::uuid
   and j.client_request_id = case when :dup = 1 then 'retry-' || (:r % 50) else 'req-' || :r end;
commit;
`;

// A worker replica: claim up to 5 tasks of both lanes, complete them. A TAS
// task for a flat first delegates to its parcel scope, exactly as the worker's
// executor does after its one-request probe; only the parcel's producer reads.
const DRAIN = `
\\set w random(1, 100000)
select count(case
         when x->>'source' = 'tas' and coalesce(x->'input'->>'resolved', '') <> 'true' then
           case when public.verify_task_delegate((x->>'id')::uuid, (x->>'fencingToken')::bigint,
                       'tas:' || array_to_string((string_to_array(x->'input'->>'cadastral', '.'))[1:5], '.'),
                       (x->'input') || '{"resolved":true}'::jsonb)->>'outcome' = 'PRODUCE'
                then public.verify_task_complete((x->>'id')::uuid, (x->>'fencingToken')::bigint, '{"ok":true}'::jsonb,
                       '[]'::jsonb, null, 'tas:' || array_to_string((string_to_array(x->'input'->>'cadastral', '.'))[1:5], '.')) end
         else public.verify_task_complete((x->>'id')::uuid, (x->>'fencingToken')::bigint, '{"ok":true}'::jsonb) end)
  from public.verify_task_claim('w' || :w, array['HTTP','BROWSER'], 5) x;
`;

// A replica that crashes half the time: claims and never completes.
const CRASHY = `
\\set w random(1, 100000)
\\set die random(1, 2)
select count(case when :die = 1 then public.verify_task_complete((x->>'id')::uuid, (x->>'fencingToken')::bigint, '{"ok":true}'::jsonb) end)
  from public.verify_task_claim('w' || :w, array['HTTP','BROWSER'], 5) x;
`;

function counts() {
  return JSON.parse(psql(`select jsonb_build_object(
    'jobs', (select count(*) from public.research_jobs),
    'tasks', (select count(*) from public.verify_tasks),
    'byState', (select jsonb_object_agg(state, n) from (select state, count(*) n from public.verify_tasks group by state) s),
    'jobsWithout3Tasks', (select count(*) from (select j.id from public.research_jobs j left join public.verify_tasks t on t.job_id = j.id group by j.id having count(t.id) <> 3) z),
    'producersRun', (select count(*) from public.verify_tasks where reused is null and state = 'SUCCEEDED'),
    'reusedShared', (select count(*) from public.verify_tasks where reused = 'SHARED'),
    'reusedCache', (select count(*) from public.verify_tasks where reused = 'CACHE'),
    'multiAttempt', (select count(*) from public.verify_tasks where attempts > 1),
    'cacheRows', (select count(*) from public.verify_evidence_cache))`));
}

function drainAll(clients, maxRounds = 400) {
  let rounds = 0;
  const runs = [];
  while (rounds++ < maxRounds) {
    const open = Number(psql(`select count(*) from public.verify_tasks where state in ('QUEUED','RUNNING')`));
    if (!open) break;
    psql(`update public.verify_tasks set run_after = now() where state = 'QUEUED' and run_after > now()`);
    runs.push(bench(DRAIN, { clients, transactions: Math.max(1, Math.ceil(open / clients / 5) + 1), label: 'drain' }));
  }
  return runs;
}

const report = { startedAt: new Date().toISOString(), host: { note: 'scratch Postgres; simulated workers; no external calls' }, scenarios: [] };
const SIZES = (process.env.VERIFY_SCALE_SIZES || '100,1000,10000').split(',').map(Number);
const CLIENTS = Number(process.env.VERIFY_SCALE_CLIENTS || 200);

for (const n of SIZES) {
  resetDb();
  const clients = Math.min(CLIENTS, n);
  const adm = bench(ADMISSION, { clients, transactions: Math.ceil(n / clients), label: `admission-${n}`, vars: { buildings: 200 } });
  const afterAdmission = counts();
  const t0 = Date.now();
  const drains = drainAll(Math.min(64, clients));
  const drainMs = Date.now() - t0;
  const done = counts();
  report.scenarios.push({
    name: `admission+drain-${n}`, admission: adm, afterAdmission,
    drain: { wallMs: drainMs, rounds: drains.length, claimLatency: drains[0]?.latency ?? null, tps: drains[0]?.tps ?? null },
    final: done,
    checks: {
      noLostJob: afterAdmission.jobsWithout3Tasks === 0,
      everyTaskTerminal: !done.byState?.QUEUED && !done.byState?.RUNNING && !done.byState?.WAITING_SHARED,
      exactlyOnce: done.multiAttempt === 0,
    },
  });
}

// Crash recovery: half the claims die; leases expire; everything completes.
{
  resetDb();
  psql(`update public.verify_source_policy set lease_seconds = 30`);
  bench(ADMISSION, { clients: 100, transactions: 20, label: 'crash-admission', vars: { buildings: 2000 } });
  bench(CRASHY, { clients: 32, transactions: 40, label: 'crashy' });
  const abandoned = Number(psql(`select count(*) from public.verify_tasks where state = 'RUNNING'`));
  psql(`update public.verify_tasks set lease_expires_at = now() - interval '1 second' where state = 'RUNNING'`);
  const recovered = Number(psql(`select public.verify_task_recover_expired(100000)`));
  drainAll(32);
  const done = counts();
  const stale = psql(`select count(*) from public.verify_tasks where state = 'SUCCEEDED' and error like 'LEASE_EXPIRED%' and attempts < 2`);
  report.scenarios.push({ name: 'crash-recovery', abandoned, recovered, final: done,
    checks: { allRecovered: recovered === abandoned, everyTaskTerminal: !done.byState?.QUEUED && !done.byState?.RUNNING, noStaleCompletion: stale === '0' } });
}

// Same building: 1,000 jobs, one parcel; the shared reads run once.
{
  resetDb();
  bench(ADMISSION, { clients: 100, transactions: 10, label: 'same-building', vars: { buildings: 1 } });
  const before = counts();
  drainAll(32);
  const done = counts();
  const tasReads = Number(psql(`select count(*) from public.verify_tasks where source = 'tas' and reused is null`));
  const tasmapProducers = Number(psql(`select count(*) from public.verify_tasks where source = 'TAS_MAP' and reused is null`));
  const flats = Number(psql(`select count(distinct query) from public.research_jobs`));
  report.scenarios.push({ name: 'same-building-1000', before, final: done, flats, tasReads, tasmapProducers,
    // TAS case files: one read for the whole building. TAS_MAP and MyGov are
    // per searched code: one read per distinct flat, never one per job.
    checks: { oneTasReadPerBuilding: tasReads === 1, oneMapReadPerFlat: tasmapProducers === flats } });
}

report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
const failed = report.scenarios.flatMap((s) => Object.entries(s.checks).filter(([, ok]) => !ok).map(([k]) => `${s.name}:${k}`));
if (failed.length) {
  console.error(`FAILED CHECKS: ${failed.join(', ')}`);
  process.exit(1);
}
