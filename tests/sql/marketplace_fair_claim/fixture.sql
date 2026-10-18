-- Minimal shape of the tables claim_marketplace_worker_runs reads (columns it uses only).
do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.admin_settings (key text primary key, value jsonb);
create table public.discovery_marketplace_workers (
  worker_id text primary key, state text not null, enabled boolean not null,
  max_concurrency integer not null, max_attempts integer not null);
create table public.discovery_marketplace_searches (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null default 'SEARCHING',
  created_at timestamptz not null default now());
create table public.discovery_marketplace_worker_runs (
  id uuid primary key default gen_random_uuid(), search_id uuid not null references public.discovery_marketplace_searches(id),
  worker_id text not null, status text not null default 'QUEUED', claimed_at timestamptz, started_at timestamptz,
  lease_expires_at timestamptz, deadline_at timestamptz not null default now() + interval '1 hour',
  last_heartbeat_at timestamptz, attempts integer not null default 0, updated_at timestamptz,
  created_at timestamptz not null default now(), label text);
insert into public.discovery_marketplace_workers values ('homege-agent', 'ACTIVE', true, 1, 3);
-- production indexes on these tables (2026-10-18)
create unique index on public.discovery_marketplace_worker_runs (search_id, worker_id);
create index on public.discovery_marketplace_worker_runs (worker_id, lease_expires_at) where status in ('SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING');
create index on public.discovery_marketplace_worker_runs (worker_id, status, created_at) where status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED');
create index on public.discovery_marketplace_searches (user_id, created_at desc);
