-- The shared network layer's traffic ledger (Verify at scale; official-worker net/proxyGateway.ts).
--
-- One row per flush (every ~30 s per replica) per job, worker type, domain and route: requests,
-- retries, bytes up/down, blocked responses, and the estimated proxy cost when a provider price is
-- configured. Direct (non-proxied) traffic is recorded too, so proxy bandwidth per Verify is measured
-- before a package is bought. No URLs, query strings, credentials or page content are stored.
-- Service role only; the Admin reads aggregates through admin-gated RPCs.

create table if not exists public.proxy_usage_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  replica text,
  job_id uuid,
  worker text not null,
  domain text not null,
  via text not null check (via in ('proxy', 'direct')),
  provider text,
  session text check (session is null or session in ('sticky', 'rotating')),
  requests integer not null default 0 check (requests >= 0),
  retries integer not null default 0 check (retries >= 0),
  bytes_up bigint not null default 0 check (bytes_up >= 0),
  bytes_down bigint not null default 0 check (bytes_down >= 0),
  blocked integer not null default 0 check (blocked >= 0),
  est_cost_usd numeric(12, 6)
);

alter table public.proxy_usage_events enable row level security;
revoke all on table public.proxy_usage_events from public, anon, authenticated;
grant select, insert on table public.proxy_usage_events to service_role;
grant usage on sequence public.proxy_usage_events_id_seq to service_role;

create index if not exists proxy_usage_events_created_idx on public.proxy_usage_events (created_at);
create index if not exists proxy_usage_events_job_idx on public.proxy_usage_events (job_id) where job_id is not null;
