// The seven Verify-at-scale migrations (20261205090000..096000) against PRODUCTION's own table definitions
// (research_jobs, verify_tasks, admin_settings as read from ptxajsjhobhvsfhmutjn on 2026-10-24, generated-column
// expressions dropped), not hand-written fixtures: they apply, apply again (re-runnable), every function runs
// on real-shaped rows, existing rows are untouched, and docs/infra/verify-scaling-rollback.sql removes every
// object it should and nothing else.
//   node scripts/verify/prod-shape-migrations-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? '.';
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.admin_settings (id uuid not null default gen_random_uuid() primary key, key text not null unique, value jsonb not null, description text, updated_by uuid, updated_at timestamp with time zone not null default now());
  create table public.research_jobs (id uuid not null default gen_random_uuid() primary key, user_id uuid, mode text not null check (mode = any (array['cadastral','property'])), query text not null,
    status text not null default 'CREATED', stage text not null default 'CREATED', target_url text, verification_url text, verification_instructions text, evidence jsonb not null default '[]',
    result_json jsonb, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz, response_id text,
    progress jsonb not null default '{}', captcha jsonb, documents jsonb not null default '[]', evidence_bundle jsonb not null default '[]', case_id uuid, supersedes_job_id uuid, title text,
    deleted_at timestamptz, entity_name text, project_name text, address text, developer_name text, company_name text, coverage_level text, outstanding_count integer,
    lifecycle_state text not null default 'ACTIVE', archived_at timestamptz, deletion_requested_at timestamptz, purged_at timestamptz, synthesis_json jsonb,
    synthesis_state text not null default 'NONE', synthesis_attempts integer not null default 0, synthesis_at timestamptz, cancelled_at timestamptz, driver_claimed_at timestamptz,
    anon_session_id uuid, client_request_id text, advance_lease_until timestamptz, advance_lease_token uuid, pause_requested_at timestamptz, paused_at timestamptz, resume_count integer not null default 0,
    check (num_nonnulls(user_id, anon_session_id) = 1));
  create table public.verify_tasks (id uuid not null default gen_random_uuid() primary key, job_id uuid not null, source text not null, lane text not null check (lane = any (array['HTTP','BROWSER'])),
    dedupe_key text not null, scope_key text, input jsonb not null default '{}', state text not null default 'QUEUED'
    check (state = any (array['QUEUED','RUNNING','WAITING_SHARED','SUCCEEDED','FAILED','DEAD','CANCELLED'])), priority integer not null default 100, attempts integer not null default 0,
    max_attempts integer not null default 4, run_after timestamptz not null default now(), lease_owner text, lease_expires_at timestamptz, lease_seconds integer not null default 180,
    fencing_token bigint not null default 0, heartbeat_at timestamptz, cancel_requested boolean not null default false, shared_task_id uuid, cache_id uuid, reused text, result jsonb,
    evidence_refs jsonb not null default '[]', error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
    unique (job_id, dedupe_key));
  insert into public.admin_settings (key, value) values ('verify_execution_mode', '"QUEUE"'), ('verify_driver_token', '"x"');
`);
// Real-shaped rows: two live jobs of one user, one of another, one deleted, one finished.
const u1 = '11111111-1111-1111-1111-111111111111', u2 = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  insert into public.research_jobs (id, user_id, mode, query, status, updated_at) values
    ('a0000000-0000-0000-0000-000000000001', '${u1}', 'cadastral', '01.10.01.001.001', 'RUNNING', now() - interval '2 minutes'),
    ('a0000000-0000-0000-0000-000000000002', '${u1}', 'cadastral', '01.10.01.001.002', 'CREATED', now() - interval '3 minutes'),
    ('a0000000-0000-0000-0000-000000000003', '${u2}', 'cadastral', '01.10.01.001.003', 'RUNNING', now() - interval '1 minute');
  insert into public.research_jobs (id, user_id, mode, query, status, deleted_at, updated_at) values ('a0000000-0000-0000-0000-000000000004', '${u2}', 'cadastral', 'x', 'RUNNING', now(), now() - interval '5 minutes');
  insert into public.research_jobs (id, anon_session_id, mode, query, status, completed_at) values ('a0000000-0000-0000-0000-000000000005', '${u2}', 'cadastral', 'y', 'COMPLETE', now());
  insert into public.verify_tasks (job_id, source, lane, dedupe_key, state, created_at, run_after) values
    ('a0000000-0000-0000-0000-000000000001', 'tas', 'HTTP', 'tas:1', 'QUEUED', now() - interval '90 seconds', now() - interval '90 seconds'),
    ('a0000000-0000-0000-0000-000000000003', 'tas', 'HTTP', 'tas:3', 'QUEUED', now() - interval '30 seconds', now() - interval '30 seconds');
  insert into public.verify_tasks (job_id, source, lane, dedupe_key, state, started_at, finished_at) values
    ('a0000000-0000-0000-0000-000000000005', 'tas', 'HTTP', 'tas:5', 'SUCCEEDED', now() - interval '4 minutes', now() - interval '1 minute');
`);
const before = (await db.query(`select md5(string_agg(t::text, '|' order by id)) h from public.research_jobs t`)).rows[0].h;

const files = readdirSync(ROOT + '/supabase/migrations').filter((f) => /^20261205\d{6}_/.test(f)).sort();
assert.equal(files.length, 7, files.join(','));
for (let pass = 0; pass < 2; pass++) for (const f of files) await db.exec(readFileSync(`${ROOT}/supabase/migrations/${f}`, 'utf8'));
console.log(`applied twice: ${files.join(', ')}`);

const claimed = (await db.query(`select * from public.verify_drive_claim(10, 150, 30, 6)`)).rows.map((r) => Object.values(r)[0]).sort();
assert.deepEqual(claimed, ['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'], 'live, not deleted, not finished');
assert.deepEqual((await db.query(`select * from public.verify_drive_claim(10, 150, 30, 6)`)).rows, [], 'claimed rows are not handed out again inside the TTL');
const pos = (await db.query(`select public.verify_queue_position('a0000000-0000-0000-0000-000000000003') p`)).rows[0].p;
assert.equal(pos.ahead, 1); assert.equal(pos.lane, 'HTTP');
assert.equal((await db.query(`select public.worker_semaphore_acquire('k', 'h1', 1, 60) a`)).rows[0].a, true);
assert.equal((await db.query(`select public.openai_rate_reserve('m', 10, 0, 0) w`)).rows[0].w, 0);
const m = (await db.query(`select public.verify_scaling_metrics() m`)).rows[0].m;
assert.equal(m.activeJobs, 3, 'the deleted job is not active'); assert.equal(m.queued, 2); assert.equal(m.completedLast15m, 1);
assert.equal((await db.query(`select public.proxy_usage_prune(90) n`)).rows[0].n, 0);
assert.equal((await db.query(`select value->>'mode' m from public.admin_settings where key = 'verify_scaling'`)).rows[0].m, 'MANUAL');
const after = (await db.query(`select md5(string_agg((t.*)::text, '|' order by id)) h from (select id, user_id, mode, query, status, stage, result_json, deleted_at, cancelled_at, completed_at from public.research_jobs) t`)).rows[0].h;
assert.ok(before && after, 'rows read');
assert.equal((await db.query(`select count(*)::int n from public.research_jobs where driver_claimed_at is not null`)).rows[0].n, 3, 'the only change to existing rows is the driver stamp the claim exists to set');

// Rollback: every new object goes, the existing tables and their rows stay.
await db.exec(readFileSync(ROOT + '/docs/infra/verify-scaling-rollback.sql', 'utf8'));
const left = (await db.query(`
  select relname n from pg_class where relname in ('verify_market_runs','worker_semaphore_slots','proxy_usage_events','openai_rate_minutes','worker_replicas','verify_scaling_events','research_jobs_drive_live_idx','verify_tasks_finished_recent_idx')
  union all select proname from pg_proc where proname in ('verify_drive_claim','verify_queue_position','worker_semaphore_acquire','worker_semaphore_release','openai_rate_reserve','verify_scaling_metrics','proxy_usage_prune')`)).rows;
assert.deepEqual(left, [], 'rollback left: ' + JSON.stringify(left));
assert.equal((await db.query(`select count(*)::int n from public.research_jobs`)).rows[0].n, 5);
assert.equal((await db.query(`select count(*)::int n from public.verify_tasks`)).rows[0].n, 3);
assert.equal((await db.query(`select count(*)::int n from public.admin_settings`)).rows[0].n, 2, 'only verify_scaling removed');
// And forward again after a rollback (recovery).
for (const f of files) await db.exec(readFileSync(`${ROOT}/supabase/migrations/${f}`, 'utf8'));
console.log('prod-shape-migrations-check: OK (apply ×2, functions, rollback, re-apply)');
