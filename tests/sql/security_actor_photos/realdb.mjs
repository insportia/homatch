// SECURITY: comm actor binding and property-photos writes (20261208150000) on a REAL PostgreSQL 17,
// with RLS enforced as the `authenticated` role. Local only: never production.
// Run: node tests/sql/security_actor_photos/realdb.mjs
// (harness: node C:/Users/User/hm-wt/_pgreal/start.mjs, or PG_HARNESS_DIR / PG_PORT / PG_PASSWORD).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');
const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const DB = 'security_actor_photos_real';
const MIGRATION = fs.readFileSync(`${REPO}/supabase/migrations/20261208150000_security_comm_actor_and_photo_writes.sql`, 'utf8');

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`); await a.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: DB, max: 4 });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// Stubs as production has them (2026-10-30): the old functions, their grants, and the old open policies.
await q(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid unique);
create or replace function public.auth_user_id() returns uuid language sql stable security definer set search_path = public as $$ select id from public.users where auth_id = auth.uid() $$;
grant execute on function public.auth_user_id() to anon, authenticated, service_role;
create table public.comm_conversations (id uuid primary key default gen_random_uuid(), owner_id uuid not null, assigned_to uuid,
  mode text, mode_changed_by uuid, mode_changed_at timestamptz, mode_change_reason text, updated_at timestamptz);
create table public.comm_agents (id uuid primary key default gen_random_uuid(), owner_id uuid, current_version int, status text, updated_at timestamptz);
create table public.comm_agent_versions (id uuid primary key default gen_random_uuid(), agent_id uuid, owner_id uuid, version int, snapshot jsonb, published_by uuid);
-- The function bodies exactly as in production before this migration.
create or replace function public.comm_set_conversation_mode(p_conversation_id uuid, p_expected_mode text, p_new_mode text, p_actor uuid, p_reason text)
returns boolean language plpgsql security definer set search_path to 'public' as $f$
declare v_ok boolean; begin
  update public.comm_conversations set mode = p_new_mode, mode_changed_by = p_actor, mode_changed_at = now(), mode_change_reason = p_reason, updated_at = now()
   where id = p_conversation_id and (p_expected_mode is null or mode = p_expected_mode)
     and (p_actor is null or owner_id = p_actor or exists (select 1 from public.comm_conversations c2 where c2.id = p_conversation_id and c2.assigned_to = p_actor));
  get diagnostics v_ok = row_count; return v_ok > 0; end $f$;
create or replace function public.comm_publish_agent(p_agent_id uuid, p_actor uuid) returns table(version integer, version_id uuid)
language plpgsql security definer set search_path to 'public' as $f$
declare v_agent public.comm_agents; v_next int; v_id uuid; begin
  select * into v_agent from public.comm_agents where id = p_agent_id and owner_id = p_actor for update;
  if not found then raise exception 'agent not found or not owned by caller' using errcode = '42501'; end if;
  v_next := coalesce(v_agent.current_version, 0) + 1;
  insert into public.comm_agent_versions (agent_id, owner_id, version, snapshot, published_by) values (p_agent_id, p_actor, v_next, to_jsonb(v_agent), p_actor) returning id into v_id;
  update public.comm_agents set current_version = v_next where id = p_agent_id;
  return query select v_next, v_id; end $f$;
grant execute on function public.comm_set_conversation_mode(uuid, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.comm_publish_agent(uuid, uuid) to authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, service_role;
create policy "photos_select_own_storage" on storage.objects for select using (bucket_id = 'property-photos' and auth.uid() is not null);
create policy "photos_upload_own" on storage.objects for insert with check (bucket_id = 'property-photos' and auth.uid() is not null);
create policy "photos_delete_own_storage" on storage.objects for delete using (bucket_id = 'property-photos' and auth.uid() is not null);
`);

const mkUser = async () => one(`insert into public.users (auth_id) values (gen_random_uuid()) returning id, auth_id`);
const alice = await mkUser();
const bob = await mkUser();
const conv = async (owner) => (await one(`insert into public.comm_conversations (owner_id, mode) values ($1, 'AI') returning id`, [owner.auth_id])).id;
const bobConv = await conv(bob);
const aliceConv = await conv(alice);
const bobAgent = (await one(`insert into public.comm_agents (owner_id, status) values ($1, 'DRAFT') returning id`, [bob.auth_id])).id;
const bobPhoto = (await one(`insert into storage.objects (bucket_id, name) values ('property-photos', $1) returning id`, [`users/${bob.id}/property-photos/p1/a.jpg`])).id;

async function as(user, role, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('test.uid', $1, true), set_config('test.role', $2, true)`, [user?.auth_id ?? '', role]);
    await c.query(`set local role ${role === 'service_role' ? 'service_role' : 'authenticated'}`);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

// Before (as production had it): the mode switch cannot run at all (boolean > integer), so its
// update always rolled back; the publish grant and the photo writes were open.
{
  await assert.rejects(as(alice, 'authenticated', `select public.comm_set_conversation_mode($1, null, 'HUMAN', null, 'x')`, [bobConv]),
    /operator does not exist: boolean > integer/, 'precondition: every call raises');
  await assert.rejects(as(bob, 'authenticated', `select public.comm_set_conversation_mode($1, 'AI', 'HUMAN', $2, 'mine')`, [bobConv, bob.auth_id]),
    /operator does not exist: boolean > integer/, 'precondition: even the owner\'s own take-over fails');
  assert.equal((await one(`select mode from public.comm_conversations where id = $1`, [bobConv])).mode, 'AI', 'and nothing changed');
  const pub = await as(alice, 'authenticated', `select * from public.comm_publish_agent($1, $2)`, [bobAgent, bob.auth_id]);
  assert.equal(pub.rows[0].version, 1, 'precondition: an outsider naming the owner published Bob\'s agent');
  await q(`delete from public.comm_agent_versions; update public.comm_agents set current_version = null`);
  const del = await as(alice, 'authenticated', `delete from storage.objects where id = $1`, [bobPhoto]);
  assert.equal(del.rowCount, 1, 'precondition: an outsider could delete Bob\'s photo');
  await q(`insert into storage.objects (id, bucket_id, name) values ($1, 'property-photos', $2)`, [bobPhoto, `users/${bob.id}/property-photos/p1/a.jpg`]);
  console.log('  precondition: the broken mode switch, the open publish grant and the open photo writes reproduce');
}

const apply = async () => {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query(MIGRATION); await c.query('commit'); }
  catch (e) { await c.query('rollback'); throw new Error(`migration: ${e.message}`); } finally { c.release(); }
};
await apply();
await apply(); // idempotent
let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

{
  for (const actor of [null, bob.auth_id]) {
    const r = await as(alice, 'authenticated', `select public.comm_set_conversation_mode($1, null, 'HUMAN', $2, 'x') ok`, [bobConv, actor]);
    assert.equal(r.rows[0].ok, false);
  }
  assert.equal((await one(`select mode from public.comm_conversations where id = $1`, [bobConv])).mode, 'AI');
  ok('a signed-in outsider cannot change another person\'s conversation, with p_actor NULL or naming the owner');
}
{
  const r = await as(alice, 'authenticated', `select public.comm_set_conversation_mode($1, 'AI', 'HUMAN', $2, 'take over') ok`, [aliceConv, alice.auth_id]);
  assert.equal(r.rows[0].ok, true);
  const row = await one(`select mode, mode_changed_by from public.comm_conversations where id = $1`, [aliceConv]);
  assert.deepEqual([row.mode, row.mode_changed_by], ['HUMAN', alice.auth_id]);
  ok('the owner still switches their own conversation (the inbox call), recorded as themselves');
}
{
  await q(`update public.comm_conversations set assigned_to = $2 where id = $1`, [bobConv, alice.auth_id]);
  const r = await as(alice, 'authenticated', `select public.comm_set_conversation_mode($1, 'AI', 'HUMAN', null, 'assigned') ok`, [bobConv]);
  assert.equal(r.rows[0].ok, true, 'assignee acts as itself even when the client sends NULL');
  assert.equal((await one(`select mode_changed_by from public.comm_conversations where id = $1`, [bobConv])).mode_changed_by, alice.auth_id);
  await q(`update public.comm_conversations set assigned_to = null, mode = 'AI' where id = $1`, [bobConv]);
  ok('an assigned operator still can, and is recorded as themselves');
}
{
  const r = await as(null, 'service_role', `select public.comm_set_conversation_mode($1, 'AI', 'HUMAN', null, 'webhook') ok`, [bobConv]);
  assert.equal(r.rows[0].ok, true);
  assert.equal((await one(`select mode_changed_by from public.comm_conversations where id = $1`, [bobConv])).mode_changed_by, null);
  await assert.rejects(as(null, 'authenticated', `select public.comm_set_conversation_mode($1, null, 'AI', null, 'x')`, [bobConv]), /FORBIDDEN/);
  ok('the service role (webhooks) still sets modes as the system; no session at all is refused');
}
{
  await assert.rejects(as(alice, 'authenticated', `select * from public.comm_publish_agent($1, $2)`, [bobAgent, bob.auth_id]), /permission denied/);
  const r = await as(null, 'service_role', `select * from public.comm_publish_agent($1, $2)`, [bobAgent, bob.auth_id]);
  assert.equal(r.rows[0].version, 1);
  ok('comm_publish_agent: browser roles cannot call it; the comm-agent edge function (service role) still can');
}
{
  const del = await as(alice, 'authenticated', `delete from storage.objects where id = $1`, [bobPhoto]);
  assert.equal(del.rowCount, 0);
  await assert.rejects(as(alice, 'authenticated', `insert into storage.objects (bucket_id, name) values ('property-photos', $1)`, [`users/${bob.id}/property-photos/p1/x.jpg`]), /row-level security/);
  await assert.rejects(as(alice, 'authenticated', `insert into storage.objects (bucket_id, name) values ('property-photos', 'property-photos/p1/x.jpg')`), /row-level security/);
  const own = await as(alice, 'authenticated', `insert into storage.objects (bucket_id, name) values ('property-photos', $1) returning id`, [`users/${alice.id}/property-photos/p2/b.jpg`]);
  const delOwn = await as(alice, 'authenticated', `delete from storage.objects where id = $1`, [own.rows[0].id]);
  assert.equal(delOwn.rowCount, 1);
  const read = await as(alice, 'authenticated', `select count(*)::int n from storage.objects where id = $1`, [bobPhoto]);
  assert.equal(read.rows[0].n, 1, 'reading other people\'s listing photos is unchanged');
  ok('property-photos: a signed-in user writes and deletes only under users/<own id>/; reads unchanged');
}

await pool.end();
console.log(`\n${passed} passed`);
