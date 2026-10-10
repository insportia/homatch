-- Minimal stand-ins for the production objects the benchmarked migrations read.
-- Only what 20261010100000_marketplace_search_foundation.sql and
-- 20261025090000_cron_history_retention.sql reference; nothing else.
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin; exception when duplicate_object then null; end $$;

create table public.users (id uuid primary key default gen_random_uuid());
create table public.discovery_search_plans (id uuid primary key default gen_random_uuid(), plan jsonb not null default '{}');
create table public.supply_observations (id uuid primary key default gen_random_uuid());
create table public.supply_entities (id uuid primary key default gen_random_uuid());
create table public.admin_settings (key text primary key, value jsonb, description text);
create table public.rate_limit_events (id bigserial primary key, user_id uuid, operation text, created_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable as $$ select false $$;

-- pg_cron stand-in: same names and columns the retention migration touches.
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (
  jobid bigint, runid bigserial primary key, job_pid integer, database text, username text,
  command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  delete from cron.job where jobname = p_name returning true $$;
