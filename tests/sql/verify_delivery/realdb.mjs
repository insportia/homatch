// VERIFY REPORT DELIVERY (20261208130000) on a REAL PostgreSQL 17, against minimal stubs of its
// dependencies. Local only: never production. Run: node tests/sql/verify_delivery/realdb.mjs
// (harness: node C:/Users/User/hm-wt/_pgreal/start.mjs, or PG_HARNESS_DIR / PG_PORT / PG_PASSWORD).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');
const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const DB = 'verify_delivery_real';

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`); await a.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: DB, max: 4 });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

await q(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, is_admin boolean default false);
create or replace function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin) $$;
create table public.research_jobs (id uuid primary key default gen_random_uuid(), user_id uuid, query text, status text, stage text,
  created_at timestamptz default now(), completed_at timestamptz, cancelled_at timestamptz, deleted_at timestamptz,
  synthesis_state text default 'NONE', synthesis_attempts int default 0, synthesis_at timestamptz, synthesis_json jsonb, result_json jsonb);
create table public.verify_billing (job_id uuid primary key, state text);
create table public.saas_usage (id uuid primary key default gen_random_uuid(), feature text, idempotency_key text, state text, release_reason text, created_at timestamptz default now());
create table public.cost_rows (job_id uuid, stage text, model text, model_cost_usd numeric, search_cost_usd numeric, price_state text, priced_at timestamptz);
create view public.verify_stage_cogs as select * from public.cost_rows;
create view public.verify_job_cogs as select job_id, sum(model_cost_usd + search_cost_usd) as total_cogs_usd from public.cost_rows group by job_id;
`);
{
  const c = await pool.connect();
  try { await c.query('begin'); await c.query(fs.readFileSync(`${REPO}/supabase/migrations/20261208130000_verify_report_delivery.sql`, 'utf8')); await c.query('commit'); }
  catch (e) { await c.query('rollback'); throw new Error(`migration: ${e.message}`); } finally { c.release(); }
}
console.log('migration applied');
let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

const admin = await one(`insert into public.users (auth_id, is_admin) values (gen_random_uuid(), true) returning id, auth_id`);
const customer = await one(`insert into public.users (auth_id, is_admin) values (gen_random_uuid(), false) returning id, auth_id`);
async function as(user, sql, params) {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query(`select set_config('test.uid', $1, true)`, [user.auth_id]); const r = await c.query(sql, params); await c.query('commit'); return r.rows[0]; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const mk = async (o) => (await one(`insert into public.research_jobs (query, status, completed_at, synthesis_state, synthesis_attempts, synthesis_at, synthesis_json, result_json, cancelled_at, created_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, now())) returning id`,
  [o.query ?? 'q', o.status, o.completed_at ?? null, o.synthesis_state ?? 'NONE', o.attempts ?? 0, o.synthesis_at ?? null, o.json ?? null,
   o.engine ? { _engine: { version: o.engine } } : null, o.cancelled_at ?? null, o.created_at ?? null])).id;

const recent = new Date(Date.now() - 10 * 60_000).toISOString();
const old = new Date(Date.now() - 3 * 3600_000).toISOString();
const incident = await mk({ query: '01.16.06.039.039', status: 'COMPLETE', completed_at: recent, synthesis_state: 'FAILED', attempts: 4, engine: 'V2' });
const delivered = await mk({ status: 'COMPLETE', completed_at: recent, synthesis_state: 'READY', synthesis_at: new Date().toISOString(), json: { report: {} }, engine: 'V3' });
const readyNoJson = await mk({ status: 'COMPLETE', completed_at: recent, synthesis_state: 'READY', engine: 'V3' });
const pending = await mk({ status: 'COMPLETE', completed_at: recent, synthesis_state: 'PENDING', attempts: 1 });
const retrying = await mk({ status: 'COMPLETE', completed_at: recent, synthesis_state: 'FAILED', attempts: 2 });
const stale = await mk({ status: 'COMPLETE', completed_at: old, synthesis_state: 'PENDING', attempts: 1 });
const running = await mk({ status: 'RUNNING' });
const researchFailed = await mk({ status: 'FAILED' });
const stopped = await mk({ status: 'CANCELLED', cancelled_at: recent });

/* 1. the delivery rule */
{
  const st = async (id) => (await one(`select public.verify_report_delivery_state(status, cancelled_at, synthesis_state, synthesis_attempts, synthesis_json is not null, completed_at) s from public.research_jobs where id = $1`, [id])).s;
  assert.equal(await st(incident), 'FAILED');
  assert.equal(await st(delivered), 'DELIVERED');
  assert.equal(await st(readyNoJson), 'PREPARING', 'READY without the report is not a delivery');
  assert.equal(await st(pending), 'PREPARING');
  assert.equal(await st(retrying), 'PREPARING');
  assert.equal(await st(stale), 'FAILED', 'past the 2 h settle grace');
  assert.equal(await st(running), 'RESEARCHING');
  assert.equal(await st(researchFailed), 'RESEARCH_FAILED');
  assert.equal(await st(stopped), 'STOPPED');
  ok('verify_report_delivery_state: DELIVERED only with READY and the report');
}

/* 2. failures table: admin-only, service-role writes */
{
  await q(`insert into public.verify_report_failures (job_id, source, attempt, http_status, reason) values ($1, 'DRIVER', 4, 503, 'verify-synthesis 503: {"code":"BOOT_ERROR"}')`, [incident]);
  await q(`insert into public.verify_report_failures (job_id, source, attempt, reason, created_at) values ($1, 'DRIVER', 3, 'older', now() - interval '1 minute')`, [incident]);
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await assert.rejects(c.query('select * from public.verify_report_failures'), /permission denied/);
    await c.query('rollback');
    await c.query('begin'); await c.query('set local role anon');
    await assert.rejects(c.query(`insert into public.verify_report_failures (job_id, source, reason) values ('${incident}', 'DRIVER', 'x')`), /permission denied/);
    await c.query('rollback');
  } finally { c.release(); }
  await assert.rejects(q(`insert into public.verify_report_failures (job_id, source, reason) values ($1, 'NOPE', 'x')`, [incident]), /check/);
  ok('verify_report_failures: customers cannot read or write it; sources are checked');
}

/* 3. admin_verify_delivery */
{
  await q(`insert into public.cost_rows values ($1, 'identity', 'luna', 0.01, 0.002, 'PRICED', now()), ($1, 'synthesis', 'luna', 0.02, 0, 'UNPRICED', now())`, [incident]);
  await q(`insert into public.verify_billing values ($1, 'RELEASED')`, [incident]);
  await q(`insert into public.saas_usage (feature, idempotency_key, state, release_reason) values ('VERIFY', $1, 'RELEASED', 'SYSTEM_FAILED')`, [`verify:${incident}`]);
  await assert.rejects(as(customer, `select public.admin_verify_delivery(14, 40, false) r`), /FORBIDDEN/);
  let r = (await as(admin, `select public.admin_verify_delivery(14, 40, false) r`)).r;
  assert.equal(r.retryAvailable, false, 'the hotfix RPC is absent here');
  assert.equal(r.rows.length, 9);
  const row = r.rows.find((x) => x.id === incident);
  assert.equal(row.delivery, 'FAILED');
  assert.equal(row.researchStatus, 'COMPLETE');
  assert.equal(row.engine, 'V2');
  assert.equal(row.attempts, 4);
  assert.equal(row.lastError, 'verify-synthesis 503: {"code":"BOOT_ERROR"}');
  assert.equal(row.lastErrorStatus, 503);
  assert.equal(row.failures, 2);
  assert.equal(row.retryable, true);
  assert.equal(row.billingState, 'RELEASED');
  assert.equal(row.usageState, 'RELEASED');
  assert.equal(row.usageReleaseReason, 'SYSTEM_FAILED');
  assert.equal(Number(row.costUsd), 0.032);
  assert.equal(row.stages.length, 2);
  assert.equal(row.stages.find((s) => s.stage === 'synthesis').priced, false);
  assert.equal(r.rows.find((x) => x.id === delivered).retryable, false);
  assert.equal(r.rows.find((x) => x.id === delivered).delivery, 'DELIVERED');
  r = (await as(admin, `select public.admin_verify_delivery(14, 40, true) r`)).r;
  assert.deepEqual(new Set(r.rows.map((x) => x.delivery)), new Set(['FAILED', 'PREPARING']), 'problems only: report failed or still preparing');
  await q(`create function public.admin_verify_retry_synthesis(p_job_id uuid, p_reason text) returns jsonb language sql as $$ select '{}'::jsonb $$`);
  r = (await as(admin, `select public.admin_verify_delivery(14, 40, true) r`)).r;
  assert.equal(r.retryAvailable, true);
  ok('admin_verify_delivery: research and delivery side by side, last error, cost by stage, billing, retry guard');
}

/* 4. engine stats count delivery */
{
  await assert.rejects(as(customer, `select public.admin_verify_engine_stats(30) r`), /FORBIDDEN/);
  const r = (await as(admin, `select public.admin_verify_engine_stats(30) r`)).r;
  assert.equal(r.countsBy, 'DELIVERY');
  const by = Object.fromEntries(r.engines.map((e) => [e.engine, e]));
  assert.equal(by.V2.researchComplete, 1);
  assert.equal(by.V2.delivered, 0);
  assert.equal(by.V2.complete, 0, 'research COMPLETE without a report is not counted complete');
  assert.equal(by.V2.reportFailed, 1);
  assert.equal(by.V2.failed, 1);
  assert.equal(Number(by.V2.successRate), 0);
  assert.equal(by.V3.delivered, 1);
  assert.equal(by.V3.reportPending, 1, 'READY without the report is still being prepared');
  assert.equal(Number(by.V3.successRate), 1);
  assert.equal(by.V1.researchFailed, 1);
  assert.equal(by.V1.stopped, 1);
  assert.equal(by.V1.failed, 2, 'stale report + research failed; a stop is not a failure');
  assert.ok(r.recent.find((x) => x.id === incident).delivery === 'FAILED');
  ok('admin_verify_engine_stats: delivered vs report failed vs research failed, per engine');
}

/* 5. nothing existing was rewritten */
{
  const j = await one(`select synthesis_state, synthesis_attempts, synthesis_json from public.research_jobs where id = $1`, [incident]);
  assert.deepEqual([j.synthesis_state, j.synthesis_attempts, j.synthesis_json], ['FAILED', 4, null]);
  ok('read-only: no job, report, billing or usage row changed');
}

await pool.end();
console.log(`${passed} passed`);
