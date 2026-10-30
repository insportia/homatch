// VERIFY JOB CENTER AFTER RECOVERY (20261208140000) on a REAL PostgreSQL 17, against minimal stubs.
// Local only: never production. Run: node tests/sql/verify_job_center/realdb.mjs
// (harness: node C:/Users/User/hm-wt/_pgreal/start.mjs, or PG_HARNESS_DIR / PG_PORT / PG_PASSWORD).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');
const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const DB = 'verify_job_center_real';
const MIGRATION = fs.readFileSync(`${REPO}/supabase/migrations/20261208140000_verify_job_center_after_recovery.sql`, 'utf8');

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`); await a.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: DB, max: 4 });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// Stubs: the columns and the outbox trigger exactly as production has them (2026-10-30).
await q(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, is_admin boolean default false);
create or replace function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin) $$;
create table public.research_jobs (id uuid primary key default gen_random_uuid(), user_id uuid, status text,
  synthesis_state text default 'NONE', synthesis_attempts int default 0, synthesis_at timestamptz, synthesis_json jsonb);
create table public.admin_audit_log (id bigint generated always as identity, admin_id uuid, target_id uuid, action text,
  entity_type text, entity_id text, metadata jsonb, created_at timestamptz default now());
create table public.background_jobs (id uuid primary key default gen_random_uuid(), user_id uuid, product_type text, subject_type text,
  subject_id uuid, state text, progress smallint, current_stage text, stages jsonb default '[]'::jsonb, error_code text,
  user_safe_error text, last_error text, failed_at timestamptz, completed_at timestamptz, last_heartbeat_at timestamptz,
  updated_at timestamptz);
create table public.job_notification_outbox (job_id uuid, terminal_state text, primary key (job_id, terminal_state));
create or replace function public.background_jobs_enqueue_notification() returns trigger language plpgsql as $f$
begin
  if new.state not in ('COMPLETED', 'FAILED') then return new; end if;
  if tg_op = 'UPDATE' and old.state = new.state then return new; end if;
  insert into public.job_notification_outbox (job_id, terminal_state) values (new.id, new.state) on conflict (job_id, terminal_state) do nothing;
  return new;
end $f$;
create trigger trg_background_jobs_enqueue_notification after insert or update of state on public.background_jobs
  for each row execute function public.background_jobs_enqueue_notification();
`);

const admin = await one(`insert into public.users (auth_id, is_admin) values (gen_random_uuid(), true) returning id, auth_id`);
const customer = await one(`insert into public.users (auth_id, is_admin) values (gen_random_uuid(), false) returning id, auth_id`);
const job = async (o) => (await one(`insert into public.research_jobs (user_id, status, synthesis_state, synthesis_attempts, synthesis_json, synthesis_at)
  values ($1, $2, $3, $4, $5, $6) returning id`, [customer.id, o.status ?? 'COMPLETE', o.synth, o.attempts ?? 0, o.report ? { report: {} } : null, o.report ? new Date().toISOString() : null])).id;
// A finished FAILED job center row, its failure notice already in the outbox, as production has them.
const failedRow = async (subject, product = 'VERIFY') => {
  const id = (await one(`insert into public.background_jobs (user_id, product_type, subject_type, subject_id, state, progress, current_stage,
      stages, error_code, user_safe_error, failed_at) values ($1, $2, 'RESEARCH_JOB', $3, 'FAILED', 95, 'FAILED',
      '[{"stage":"REPORT_WRITING","ok":true},{"stage":"FAILED","ok":false}]', 'SUBJECT_FAILED', 'verify_result_failed', now()) returning id`,
    [customer.auth_id, product, subject])).id;
  return id;
};

// Production before the migration: one recovered report (READY) whose row reads FAILED, plus rows that must not move.
const recovered = await job({ synth: 'READY', report: true });
const recoveredRow = await failedRow(recovered);
const stillFailed = await job({ synth: 'FAILED', attempts: 4 });
const stillFailedRow = await failedRow(stillFailed);
const otherProduct = await job({ synth: 'READY', report: true });
const otherProductRow = await failedRow(otherProduct, 'DOCUMENT_ANALYSIS');
const outboxBefore = Number((await one(`select count(*) n from public.job_notification_outbox`)).n);

const apply = async () => {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query(MIGRATION); await c.query('commit'); }
  catch (e) { await c.query('rollback'); throw new Error(`migration: ${e.message}`); } finally { c.release(); }
};
await apply();
let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

{
  const r = await one(`select * from public.background_jobs where id = $1`, [recoveredRow]);
  assert.equal(r.state, 'COMPLETED');
  assert.equal(r.progress, 100);
  assert.equal(r.current_stage, 'COMPLETE');
  assert.equal(r.error_code, null);
  assert.equal(r.user_safe_error, null);
  assert.ok(r.completed_at);
  assert.deepEqual(r.stages.map((s) => s.stage), ['REPORT_WRITING', 'FAILED', 'COMPLETE'], 'history kept, completion appended');
  const audit = await q(`select * from public.admin_audit_log where action = 'VERIFY_JOB_CENTER_RECONCILED'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity_id, recoveredRow);
  assert.equal(audit[0].target_id, customer.id);
  assert.equal(audit[0].metadata.request_id, 'migration:20261208140000');
  // The COMPLETED notice goes through the outbox; jobNotify dedupes it on verify-complete:<job>.
  assert.ok(await one(`select 1 from public.job_notification_outbox where job_id = $1 and terminal_state = 'COMPLETED'`, [recoveredRow]));
  ok('a recovered report (READY) whose Job Center row read FAILED now reads COMPLETED, audited, history kept');
}
{
  assert.equal((await one(`select state from public.background_jobs where id = $1`, [stillFailedRow])).state, 'FAILED');
  assert.equal((await one(`select state from public.background_jobs where id = $1`, [otherProductRow])).state, 'FAILED');
  ok('a report that really failed, and another product, are not touched');
}
{
  const outbox = Number((await one(`select count(*) n from public.job_notification_outbox`)).n);
  await apply();
  assert.equal(Number((await one(`select count(*) n from public.admin_audit_log where action = 'VERIFY_JOB_CENTER_RECONCILED'`)).n), 1);
  assert.equal(Number((await one(`select count(*) n from public.job_notification_outbox`)).n), outbox);
  assert.equal(outbox, outboxBefore + 1, 'exactly one new outbox row (the COMPLETED notice) from the reconcile');
  ok('re-applying the migration changes nothing');
}

async function as(user, role, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('test.uid', $1, true), set_config('test.role', $2, true)`, [user?.auth_id ?? '', role ?? '']);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows[0];
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
{
  const outbox = Number((await one(`select count(*) n from public.job_notification_outbox`)).n);
  const r = (await as(admin, 'authenticated', `select public.admin_verify_retry_synthesis($1, 'boot failure fixed') r`, [stillFailed])).r;
  assert.equal(r.ok, true);
  assert.equal(r.jobCenterReopened, 1);
  const rj = await one(`select synthesis_state, synthesis_attempts from public.research_jobs where id = $1`, [stillFailed]);
  assert.deepEqual([rj.synthesis_state, rj.synthesis_attempts], ['NONE', 0]);
  const b = await one(`select * from public.background_jobs where id = $1`, [stillFailedRow]);
  assert.equal(b.state, 'PROCESSING');
  assert.equal(b.current_stage, 'REPORT_WRITING');
  assert.equal(b.progress, 95);
  assert.equal(b.failed_at, null);
  assert.equal(b.error_code, null);
  assert.equal(b.user_safe_error, null);
  assert.equal(Number((await one(`select count(*) n from public.job_notification_outbox`)).n), outbox, 'reopening tells nobody anything');
  const audit = await one(`select * from public.admin_audit_log where action = 'VERIFY_SYNTHESIS_RETRY' order by id desc limit 1`);
  assert.equal(audit.admin_id, admin.id);
  assert.equal(audit.metadata.job_center_reopened, 1);
  // The report now fails again: the mirror finishes it FAILED; the outbox already holds that notice, so none is added.
  await q(`update public.background_jobs set state = 'FAILED' where id = $1`, [stillFailedRow]);
  assert.equal(Number((await one(`select count(*) n from public.job_notification_outbox`)).n), outbox, 'a second failure is not announced twice');
  ok('Admin retry reopens the Job Center row (no notice); a second failure is not announced again');
}
{
  await assert.rejects(as(customer, 'authenticated', `select public.admin_verify_retry_synthesis($1, 'not mine to retry')`, [stillFailed]), /FORBIDDEN/);
  const ready = await job({ synth: 'READY', report: true });
  const r = (await as(admin, 'authenticated', `select public.admin_verify_retry_synthesis($1, 'already fine') r`, [ready])).r;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NOT_RECOVERABLE');
  await assert.rejects(as(admin, 'authenticated', `select public.admin_verify_retry_synthesis($1, 'x')`, [stillFailed]), /REASON_REQUIRED/);
  ok('the guards are unchanged: admin only, a reason, only a failed job without a report');
}

await pool.end();
console.log(`\n${passed} passed`);
