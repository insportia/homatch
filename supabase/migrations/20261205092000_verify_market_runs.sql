-- Verify at scale: market searches survive the replica that ran them.
--
-- The worker's /verify/market jobs lived only in the memory of the process
-- that started them. With several replicas of homatch-official-worker behind
-- one domain, research-agent's poll can reach another replica, which answers
-- 404, and the search was recorded LOST. The worker now writes each market
-- run here (through verify-queue, action market_put) when it starts and when
-- it completes; research-agent reads this row whenever the worker it reached
-- does not hold the job. Service role only.

create table if not exists public.verify_market_runs (
  id uuid primary key,
  status text not null check (status in ('RUNNING', 'COMPLETE')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.verify_market_runs enable row level security;
revoke all on table public.verify_market_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.verify_market_runs to service_role;

create index if not exists verify_market_runs_updated_idx on public.verify_market_runs (updated_at);
