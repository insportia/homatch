// PGlite behaviour test for 20261201096000_verify_scaling.sql: healthy replicas come from fresh, non-draining beats;
// queue depth, age and throughput are read from verify_tasks; the default setting is MANUAL and never overwrites.
//   node scripts/verify/scaling-metrics-db-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
import { readFileSync } from 'node:fs';
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
  create table public.admin_settings (key text primary key, value jsonb not null, updated_at timestamptz);
  create table public.research_jobs (id uuid primary key default gen_random_uuid(), status text, updated_at timestamptz default now(), completed_at timestamptz, deleted_at timestamptz, cancelled_at timestamptz);
  create table public.verify_tasks (id uuid primary key default gen_random_uuid(), job_id uuid, source text, lane text, state text,
    run_after timestamptz default now(), created_at timestamptz default now(), started_at timestamptz, finished_at timestamptz);
  insert into public.admin_settings values ('verify_scaling', '{"mode":"AUTOMATIC","approvedMax":6}', now());
`);
const sql = readFileSync(ROOT + '/supabase/migrations/20261201096000_verify_scaling.sql', 'utf8');
await db.exec(sql);
await db.exec(sql); // re-runnable
assert.equal((await db.query(`select value->>'mode' m from public.admin_settings where key = 'verify_scaling'`)).rows[0].m, 'AUTOMATIC', 'the owner\'s setting is kept');

await db.exec(`
  insert into public.worker_replicas (replica, last_seen, draining, http_slots, browser_slots, running, rss_mb) values
    ('r1-1', now(), false, 12, 3, 4, 900),
    ('r2-1', now() - interval '20 seconds', false, 12, 3, 0, 700),
    ('r3-1', now() - interval '5 minutes', false, 12, 3, 0, 700),   -- stopped beating
    ('r4-1', now(), true, 12, 3, 1, 800);                            -- draining
  insert into public.verify_tasks (source, lane, state, created_at, run_after) values
    ('tas', 'BROWSER', 'QUEUED', now() - interval '200 seconds', now() - interval '200 seconds'),
    ('napr', 'HTTP', 'QUEUED', now() - interval '10 seconds', now() - interval '10 seconds'),
    ('napr', 'HTTP', 'QUEUED', now(), now() + interval '1 hour'),     -- backoff: not counted as old
    ('rstax', 'BROWSER', 'QUEUED', now() - interval '900 seconds', now() - interval '900 seconds'),
    ('tas', 'BROWSER', 'RUNNING', now(), now());
  insert into public.verify_tasks (source, lane, state, started_at, finished_at) values
    ('tas', 'BROWSER', 'SUCCEEDED', now() - interval '70 seconds', now() - interval '10 seconds'),
    ('napr', 'HTTP', 'SUCCEEDED', now() - interval '12 seconds', now() - interval '2 seconds');
  insert into public.research_jobs (status, completed_at) values ('COMPLETE', now()), ('RUNNING', null), ('CREATED', null);
  insert into public.research_jobs (status, deleted_at) values ('RUNNING', now());  -- deleted: never active
`);
const m = (await db.query('select public.verify_scaling_metrics() m')).rows[0].m;
assert.equal(m.healthyReplicas, 2, 'fresh and not draining only');
assert.equal(m.replicas.length, 4);
assert.equal(m.queued, 3, 'rstax is waited on by design, not capacity');
assert.equal(m.running, 1);
assert.ok(m.oldestQueuedSeconds >= 195 && m.oldestQueuedSeconds < 300, `oldest due non-rstax task: ${m.oldestQueuedSeconds}`);
assert.equal(m.completedLast15m, 2);
assert.equal(m.activeJobs, 2);
assert.ok(Number(m.taskP95Seconds) > 50 && Number(m.taskP95Seconds) <= 60);

const evGrants = (await db.query(`select privilege_type from information_schema.role_table_grants where table_name = 'verify_scaling_events' and grantee = 'service_role'`)).rows.map((r) => r.privilege_type).sort();
assert.deepEqual(evGrants, ['INSERT', 'SELECT'], 'the scaling ledger is append-only');
const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_name = 'verify_scaling_metrics'`)).rows.map((r) => r.grantee);
assert.ok(grants.includes('service_role') && !grants.includes('anon') && !grants.includes('authenticated'));
console.log('scaling-metrics-db-check: OK');
