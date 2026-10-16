-- Extra objects for 20261107094700_admin_demand_intelligence.sql on top of
-- homatch_leads_fixture.sql + property_interest_history_fixture.sql (+ its migration).
alter table public.users add column if not exists created_at timestamptz not null default now();
create table if not exists public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid, target_id uuid,
  action text, entity_type text, entity_id text, metadata jsonb, created_at timestamptz default now());
alter table public.discovery_marketplace_searches add column if not exists properties_count int, add column if not exists strong_matches int;
alter table public.discovery_runs add column if not exists credits_per_usd numeric, add column if not exists credits_charged numeric, add column if not exists provider_cost_usd numeric,
  add column if not exists results_found int;
create table if not exists public.find_buyers_campaigns (matching_job_id uuid primary key, campaign_id uuid, property_id uuid, user_id uuid,
  credits_committed int, credits_per_usd numeric, customer_value_micros bigint, provider_budget_micros bigint, finalized_at timestamptz,
  created_at timestamptz default now(), pricing_policy text);
create table if not exists public.matching_jobs (id uuid primary key, billing_grant jsonb, started_at timestamptz, completed_at timestamptz);
create table if not exists public.cost_events (id uuid primary key default gen_random_uuid(), property_id uuid, job_id uuid, cost_usd numeric, pricing_state text, timestamp timestamptz default now());
create table if not exists public.find_buyers_budget_extensions (id uuid primary key default gen_random_uuid(), matching_job_id uuid, status text, settled_credits numeric);
create table if not exists public.supply_observations (id uuid primary key default gen_random_uuid(), city text, district text, last_seen_at timestamptz default now());
create or replace function public.paid_discovery_provider_share_bps() returns integer language sql immutable as $$ select 6300 $$;
update public.users set is_admin = true where id = '00000000-0000-0000-0000-0000000000a2';
