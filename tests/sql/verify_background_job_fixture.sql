-- Minimal stand-ins for the objects background_jobs (20260911211715, 20260911213925)
-- depends on, so 20261120090000_verify_background_job_terminal_stage.sql and
-- tests/sql/verify_background_job_terminal_stage.sql run on a scratch Postgres.
-- Run with PGOPTIONS='-c check_function_bodies=off' (see run-verify-background-job.sh).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- The worker holds the service key; a test switches test.role to act as a customer.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'service_role') $$;
create table if not exists public.users (id uuid primary key, auth_id uuid);
create table if not exists public.usage_reservations (id uuid primary key default gen_random_uuid(), state text);
create table if not exists public.admin_audit_log (id bigserial primary key, admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz default now());
create or replace function public.is_admin() returns boolean language sql stable as $$ select false $$;
create or replace function public.site_admin_id() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.wallet_release(p_reservation_id uuid, p_reason text default null) returns jsonb language sql as $$ select '{}'::jsonb $$;
