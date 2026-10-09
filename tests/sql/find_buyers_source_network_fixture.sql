-- The tables admin_find_buyers_source_network reads, as production has them
-- (columns it touches only). Idempotent: the source_registry replica from
-- find_buyers_fixture.sql gains the read-history columns.
alter table public.source_registry
  add column if not exists posts_observed int, add column if not exists scanned_signal_count int,
  add column if not exists useful_signal_count int, add column if not exists last_successful_at timestamptz,
  add column if not exists last_collected_at timestamptz, add column if not exists discovered_via text;
create table if not exists public.community_targets (
  id uuid primary key default gen_random_uuid(), platform text not null, external_id text not null, name text, url text,
  readability text not null default 'UNVERIFIED', lifecycle text not null default 'DISCOVERED', discovery_enabled boolean not null default false,
  items_read int not null default 0, comments_read int not null default 0, demand_found int not null default 0,
  last_success_at timestamptz, last_error_code text, last_message_at timestamptz, relevance_score numeric,
  source_registry_id uuid, source_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (platform, external_id));
create table if not exists public.community_directory (id uuid primary key default gen_random_uuid(), platform text not null, name text);
