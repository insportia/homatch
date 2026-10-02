-- Columns/tables the admin intelligence RPC reads, beyond phase2_fixture.sql
-- (names copied from production information_schema, 2026-10-02).
alter table public.supply_observations
  add column if not exists adapter_id text, add column if not exists entity_id uuid,
  add column if not exists first_seen_at timestamptz default now(), add column if not exists last_seen_at timestamptz default now(),
  add column if not exists validation_state text default 'UNVERIFIED', add column if not exists structured_quality numeric;
create table if not exists public.supply_entities (id uuid primary key default gen_random_uuid(), city text, transaction text,
  property_type text, observation_count int default 1, source_count int default 1, min_price numeric, max_price numeric,
  price_currency text, price_spread numeric, last_seen_at timestamptz default now());
create table if not exists public.supply_resolution_decisions (id uuid primary key default gen_random_uuid(),
  left_observation_id uuid, right_observation_id uuid, verdict text, confidence numeric, signals jsonb, decided_at timestamptz default now());
create table if not exists public.matches (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
alter table public.raw_signals add column if not exists research_direction text;
alter table public.discovery_query_queue add column if not exists finished_at timestamptz;
