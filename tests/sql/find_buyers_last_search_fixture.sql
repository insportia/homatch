-- matching_campaigns as production has it: two status columns kept equal by
-- the live trigger sync_matching_campaign_status_columns (status_v2 =
-- continuous monitoring). Enum values as in production (campaign_status).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'campaign_status') then
    create type public.campaign_status as enum ('ACTIVE', 'PAUSED', 'LOW_BALANCE', 'ARCHIVED');
  end if;
end $$;
create table if not exists public.matching_campaigns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid, user_id uuid,
  status public.campaign_status not null default 'PAUSED',
  status_v2 public.campaign_status,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create or replace function public.sync_matching_campaign_status_columns() returns trigger language plpgsql set search_path to 'public' as $f$
begin
  if tg_op = 'INSERT' then
    if new.status_v2 is not null then new.status := new.status_v2; else new.status_v2 := new.status; end if;
  else
    if new.status_v2 is distinct from old.status_v2 then new.status := new.status_v2;
    elsif new.status is distinct from old.status then new.status_v2 := new.status; end if;
  end if;
  return new;
end $f$;
drop trigger if exists sync_matching_campaign_status_columns on public.matching_campaigns;
create trigger sync_matching_campaign_status_columns before insert or update on public.matching_campaigns
  for each row execute function public.sync_matching_campaign_status_columns();
create table if not exists public.matching_job_events (
  id uuid primary key default gen_random_uuid(), job_id uuid not null, event_type text not null,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
