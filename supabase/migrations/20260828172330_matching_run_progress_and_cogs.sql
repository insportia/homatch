-- This migration was already applied directly to production as matching_run_progress_and_cogs.
-- The SQL below documents the production schema and is intentionally idempotent.
create table if not exists public.matching_run_progress (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.matching_campaigns(id) on delete set null,
  status text not null default 'RUNNING' check (status in ('RUNNING','COMPLETED','FAILED','PAUSED')),
  stage text not null default 'INITIALIZING',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  sources jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  search_profile jsonb,
  message text,
  error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists matching_run_progress_property_idx on public.matching_run_progress(property_id, started_at desc);
alter table public.matching_run_progress enable row level security;
drop policy if exists matching_run_progress_owner_select on public.matching_run_progress;
create policy matching_run_progress_owner_select on public.matching_run_progress for select to authenticated using (user_id = public.get_user_id());
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='matches' and column_name='estimated_cogs_usd') then
    alter table public.matches add column estimated_cogs_usd numeric(12,6) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='matches' and column_name='pricing_multiplier') then
    alter table public.matches add column pricing_multiplier numeric(6,2) not null default 1;
  end if;
end $$;
