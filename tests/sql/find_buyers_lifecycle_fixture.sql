-- Extra production shapes the lifecycle migration (20261016090000) reads
-- (columns copied from production 2026-10-04).
alter table public.users add column if not exists preferred_language text;
alter table public.properties add column if not exists user_id uuid, add column if not exists transaction_type text;
alter table public.matching_jobs
  add column if not exists failure_reason text, add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz, add column if not exists paused_at timestamptz,
  add column if not exists paused_remaining_seconds integer, add column if not exists signals_classified integer default 0,
  add column if not exists search_languages text[];
create table if not exists public.matches (id uuid primary key default gen_random_uuid(), property_id uuid, job_id uuid,
  status text default 'LOCKED', demand_published_at timestamptz, created_at timestamptz default now());
create type public.notification_type as enum ('MATCHING_STARTED','MATCH_FOUND','CAMPAIGN_COMPLETED','CAMPAIGN_NEEDS_REVIEW');
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type public.notification_type,
  title text, body text, dedupe_key text unique, created_at timestamptz default now());
create or replace function public.notify_emit(p_user_id uuid, p_type public.notification_type, p_title text, p_body text,
  p_priority text default 'NORMAL', p_deep_link text default null, p_entity_type text default null, p_entity_id uuid default null,
  p_dedupe_key text default null, p_group_key text default null, p_group_window interval default null,
  p_group_title_template text default null, p_metadata jsonb default '{}') returns uuid language sql as $$
  insert into public.notifications (user_id, type, title, body, dedupe_key) values (p_user_id, p_type, p_title, p_body, p_dedupe_key)
  on conflict (dedupe_key) do nothing returning id $$;
create or replace function public.matching_jobs_notify_finished() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_matching_jobs_notify_finished after update of status on public.matching_jobs
  for each row execute function public.matching_jobs_notify_finished();
