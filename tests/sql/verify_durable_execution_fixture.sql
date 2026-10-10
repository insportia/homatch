-- Minimal stand-ins for the objects verify_durable_execution depends on, so the
-- migration and tests/sql/verify_durable_execution.sql run on a scratch Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table if not exists public.research_jobs (id uuid primary key default gen_random_uuid(), user_id uuid, anon_session_id uuid, status text default 'CREATED', stage text default 'QUEUED', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.admin_settings (key text primary key, value jsonb, description text);
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
