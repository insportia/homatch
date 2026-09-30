-- Minimal stand-ins for the objects a Supabase project provides before any
-- repository migration runs (roles, auth, storage, cron, net, extensions).
-- Used ONLY by scripts/claude/replay-migrations.sh against a throwaway local
-- PostgreSQL. Never applied anywhere else.
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_admin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_storage_admin; exception when duplicate_object then null; end $$;
do $$ begin create role dashboard_user; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
do $$ begin execute format($f$alter database %I set search_path = "$user", public, extensions$f$, current_database()); end $$;
set search_path = "$user", public, extensions;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  deleted_at timestamptz, is_anonymous boolean default false, banned_until timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.email() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[], version text,
  user_metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as
  $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as
  $$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant usage on schema storage to anon, authenticated, service_role;

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text,
  nodename text default 'localhost', nodeport int default 5432, database text default 'postgres',
  username text default 'postgres', active boolean default true, jobname text unique);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$ declare v bigint; begin
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v; return v; end $$;
create or replace function cron.schedule(schedule text, command text) returns bigint
language sql as $$ insert into cron.job(schedule, command) values (schedule, command) returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$ begin delete from cron.job where jobname = job_name; return found; end $$;
create or replace function cron.unschedule(job_id bigint) returns boolean
language plpgsql as $$ begin delete from cron.job where jobid = job_id; return found; end $$;

create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
language sql as $$ select 1::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
language sql as $$ select 1::bigint $$;

do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
