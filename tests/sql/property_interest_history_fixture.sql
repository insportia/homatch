-- Extra objects for 20261107093700_property_interest_history.sql on top of
-- homatch_leads_fixture.sql (users, properties, facts, subscriptions, contact disclosures).
alter table public.properties add column if not exists created_at timestamptz not null default now();
alter table public.active_search_subscriptions add column if not exists search_criteria jsonb, add column if not exists property_id uuid;
create table public.discovery_marketplace_searches (
  id uuid primary key default gen_random_uuid(), user_id uuid, status text default 'RUNNING', brief jsonb, request jsonb,
  created_at timestamptz not null default now());
create table public.viewing_requests (
  id uuid primary key default gen_random_uuid(), property_id uuid, requester_id uuid, owner_id uuid, created_at timestamptz not null default now());
create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid, direction text, subscription_id uuid, intent_profile_id uuid,
  status text default 'QUEUED', created_at timestamptz not null default now());
insert into public.property_facts (property_id, city, district, total_price, currency, area, rooms, bedrooms) values
  ('00000000-0000-0000-0000-0000000000f1', 'Tbilisi', 'Krtsanisi', 150000, 'USD', 80, 3, 2)
on conflict do nothing;
-- A search that predates the migration: backfilled.
insert into public.discovery_marketplace_searches (user_id, request, created_at) values
  ('00000000-0000-0000-0000-0000000000b2', '{"transactionType":"RENT","city":"Batumi","propertyType":"APARTMENT","priceMaxUsd":800}', now() - interval '20 days');
