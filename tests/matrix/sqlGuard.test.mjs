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

test('settings: destructive and spending operations are never pre-approved; the hook is wired', () => {
  const { allow, ask, deny } = settings.permissions;
  for (const must of ['mcp__Supabase__create_project', 'mcp__Supabase__pause_project', 'mcp__Vercel__buy_*', 'mcp__Railway__create-service', 'mcp__Railway__create-project', 'Bash(supabase db reset*)']) {
    assert.ok(deny.includes(must), `${must} must be denied`);
  }
  for (const must of ['Bash(git push --force*)', 'Bash(git push origin main*)', 'Bash(git reset --hard*)', 'Bash(supabase db push*)', 'Bash(railway up*)', 'mcp__Railway__redeploy']) {
    assert.ok(ask.includes(must), `${must} must ask`);
  }
  for (const never of ['mcp__Supabase__execute_sql', 'mcp__Supabase__apply_migration', 'mcp__Supabase', 'mcp__Supabase__*', 'Bash(*)', 'Bash']) {
    assert.ok(!allow.includes(never), `${never} must not be blanket-allowed (the SQL hook decides)`);
  }
  const hook = settings.hooks.PreToolUse.find((h) => /execute_sql/.test(h.matcher) && /apply_migration/.test(h.matcher));
  assert.ok(hook && /sql-guard\.mjs/.test(hook.hooks[0].command));
  assert.ok(existsSync(join(ROOT, '.claude/hooks/sql-guard.mjs')));
  assert.doesNotMatch(JSON.stringify(settings), /(sk_|sbp_|eyJ|ghp_|token=)/, 'no secret in project settings');
});
