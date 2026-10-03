-- Minimal fixture of the production objects the property owner lifecycle
-- migration touches (columns and signatures read from production
-- information_schema / pg_proc, 2026-10-03). Run: tests/sql/run-property-lifecycle.sh
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on all functions in schema auth to authenticated, anon, service_role;

create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid);
create or replace function public.get_user_id() returns uuid language sql stable set search_path to ''
  as $$ select id from public.users where auth_id = auth.uid() limit 1 $$;
grant execute on function public.get_user_id() to authenticated;

create type public.property_source_type as enum ('URL_IMPORT', 'PRIVATE_LISTING');
create type public.matching_status as enum ('ACTIVE', 'PAUSED', 'DRAFT', 'COMPLETED');
create type public.notification_type as enum ('PROPERTY_ACTION_REQUIRED', 'BROKER_APPLICATION');

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  source_type public.property_source_type not null,
  title text,
  matching_status public.matching_status not null default 'DRAFT',
  cover_photo_url text,
  is_deleted boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.property_facts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id),
  source_url text, canonical_url text, source_listing_id text, source_domain text,
  description text, total_price numeric,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.matches (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id), status text default 'NEW');
create table public.matching_campaigns (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id), status_v2 text);

create table public.notifications_emitted (user_id uuid, type public.notification_type, title text, dedupe_key text unique);
create or replace function public.notify_emit(p_user_id uuid, p_type public.notification_type, p_title text, p_body text,
  p_priority text, p_deep_link text, p_entity_type text, p_entity_id uuid, p_dedupe_key text,
  p_group_key text default null, p_group_window interval default null, p_group_title_template text default null, p_metadata jsonb default null)
returns uuid language plpgsql as $$
begin
  insert into public.notifications_emitted values (p_user_id, p_type, p_title, p_dedupe_key) on conflict (dedupe_key) do nothing;
  return null;
end $$;

-- Production grants on these tables: RLS keyed on ownership, column-scoped UPDATE
-- on properties WITHOUT archived_at (the defect the migration routes around).
alter table public.properties enable row level security;
alter table public.property_facts enable row level security;
create policy props_select_own on public.properties for select to authenticated using (user_id = public.get_user_id());
create policy props_update_own on public.properties for update to authenticated using (user_id = public.get_user_id());
create policy facts_select_own on public.property_facts for select to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.user_id = public.get_user_id()));
create policy facts_update_own on public.property_facts for update to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.user_id = public.get_user_id()));
grant select on public.properties, public.property_facts to authenticated;
grant update (title, matching_status, cover_photo_url, is_deleted, updated_at) on public.properties to authenticated;
grant update on public.property_facts to authenticated;
grant usage on schema public to authenticated, service_role;
grant select on public.users to authenticated;
grant select on public.matches to authenticated;
