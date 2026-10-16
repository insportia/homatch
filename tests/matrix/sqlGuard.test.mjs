/*
 * The project permission configuration (.claude/settings.json) and its SQL
 * guard hook. The owner pre-approved read-only production inspection and the
 * application of migrations that are already reviewed (on origin/main); the
 * hook may answer `allow` for exactly those and must answer `ask` for
 * everything else. It must never be the reason destructive SQL ran unasked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readOnly, decide, PROJECT_REF } from '../../.claude/hooks/sql-guard.mjs';

const ROOT = process.cwd();
const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));

test('read-only inspection is recognised', () => {
  for (const q of [
    'select count(*) from public.users',
    'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;',
    "with x as (select id from public.meta_campaigns where status = 'ACTIVE') select count(*) from x",
    'select pg_get_functiondef(p.oid) from pg_proc p where proname = $$x$$'.replace('$$x$$', "'storage_authorize'"),
    'explain select * from public.properties where id = 1',
    'select polname, polcmd from pg_policy where polrelid = to_regclass(\'public.ds_catalog_files\')',
    "select jobname, status from cron.job_run_details order by start_time desc limit 5 -- recent runs",
    'show search_path',
  ]) assert.equal(readOnly(q).ok, true, q);
});

test('anything that writes, locks, executes or is unreadable is not', () => {
  for (const q of [
    'delete from public.users', 'update public.users set x = 1', 'insert into t values (1)', 'drop table t', 'truncate t',
    'alter table t add column x int', 'grant select on t to anon', 'create table t (id int)',
    'select * into newtable from t', 'select * from t for update', 'explain analyze delete from t',
    'select pg_terminate_backend(123)', 'select public.admin_meta_adjust_balance(1)', 'select cron.schedule(\'x\', \'* * * * *\', \'select 1\')',
    'select net.http_post(\'https://x\')', 'select set_config(\'role\', \'postgres\', false)', 'select nextval(\'s\')',
    'select 1; delete from t', 'do $$ begin delete from t; end $$', "select 'unterminated", 'vacuum t', 'copy t to stdout', '',
  ]) assert.equal(readOnly(q).ok, false, q);
});

test('the hook: allow only the two pre-approved shapes, ask for the rest, never deny', () => {
  const sql = (query, project_id = PROJECT_REF) => decide({ tool_name: 'mcp__Supabase__execute_sql', tool_input: { project_id, query } });
  assert.equal(sql('select 1').permissionDecision, 'allow');
  assert.equal(sql('delete from public.users').permissionDecision, 'ask');
  assert.equal(sql('select 1', 'someotherproject').permissionDecision, 'ask', 'another project is never pre-approved');
  const mig = (query, show) => decide({ tool_name: 'mcp__Supabase__apply_migration', tool_input: { project_id: PROJECT_REF, name: 'x', query } }, { root: ROOT, show });
  assert.equal(mig('drop table public.users;', () => 'drop table public.users;').permissionDecision, 'ask', 'not a repository migration');
  // A real migration file, merged: allowed. The same bytes not on main: asked.
  const file = readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort().at(-1);
  const f = readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8');
  const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
  assert.equal(decide({ tool_name: 'mcp__Supabase__apply_migration', tool_input: { project_id: PROJECT_REF, name, query: f } }, { root: ROOT, show: () => f }).permissionDecision, 'allow');
  assert.equal(decide({ tool_name: 'mcp__Supabase__apply_migration', tool_input: { project_id: PROJECT_REF, name, query: f } }, { root: ROOT, show: () => { throw new Error('not on main'); } }).permissionDecision, 'ask');
  assert.equal(decide({ tool_name: 'mcp__Supabase__apply_migration', tool_input: { project_id: PROJECT_REF, name, query: `${f}\ndelete from public.users;` } }, { root: ROOT, show: () => f }).permissionDecision, 'ask', 'an edited migration is not the reviewed one');
  for (const d of [sql('select 1'), sql('drop table x')]) assert.notEqual(d.permissionDecision, 'deny');
});

/*
 * Owner policy, 2026-10-10 (commit fbbb492e): every routine tool is
 * pre-allowed — "Always Allow, never ask me again". What stays is the deny
 * list: no project, service, volume, bucket, repository or domain is ever
 * created, paid for or deleted from a session, whatever the allow list says
 * (deny always wins over allow).
 */
test('settings: creating, buying and deleting infrastructure stays denied; no secret in settings', () => {
  const { deny = [] } = settings.permissions;
  for (const must of ['mcp__Supabase__create_project', 'mcp__Supabase__pause_project', 'mcp__Vercel__buy_*', 'mcp__Vercel__create_project', 'mcp__Vercel__delete_project', 'mcp__Railway__create-service', 'mcp__Railway__create-project', 'mcp__Railway__delete-service', 'Bash(supabase db reset*)', 'Bash(supabase projects create*)', 'Bash(supabase projects delete*)']) {
    assert.ok(deny.includes(must), `${must} must be denied`);
  }
  // The guard itself still exists for sessions that wire it.
  assert.ok(existsSync(join(ROOT, '.claude/hooks/sql-guard.mjs')));
  assert.doesNotMatch(JSON.stringify(settings), /(sk_|sbp_|eyJ|ghp_|token=)/, 'no secret in project settings');
});
