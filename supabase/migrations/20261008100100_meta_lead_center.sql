-- META LEAD CENTER — a focused real-estate pipeline on the existing meta_leads
-- rows (no new service, no generic CRM). Append-only.
--
-- 1. meta_campaigns.intelligence — HOMATCH Intelligence preference (off by
--    default; homatchIntelligence.prefsOf sanitises it on every read). The
--    owner may change it at any time; it never moves money or touches Meta.
-- 2. meta_leads pipeline fields the OWNER edits: follow_up_at, lost_reason,
--    won_at, quality (+ who set it). contact_key is SERVER-computed (a hash
--    of the normalised phone/e-mail) to group submissions of one person
--    without merging them — the guard keeps it server-only.
-- 3. meta_lead_events — the lead's timeline (received, status, note,
--    follow-up, quality), written by triggers only; the owner reads their own.

-- 1 ───────────────────────────────────────────────────────────────────────
alter table public.meta_campaigns
  add column if not exists intelligence jsonb not null default '{"enabled": false}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meta_campaigns_intelligence_shape') then
    alter table public.meta_campaigns add constraint meta_campaigns_intelligence_shape
      check (jsonb_typeof(intelligence) = 'object' and pg_column_size(intelligence) <= 2048);
  end if;
end $$;

-- 2 ───────────────────────────────────────────────────────────────────────
alter table public.meta_leads
  add column if not exists follow_up_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists won_at timestamptz,
  add column if not exists quality text not null default 'UNRATED',
  add column if not exists quality_source text not null default 'AUTO',
  add column if not exists contact_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meta_leads_quality_check') then
    alter table public.meta_leads add constraint meta_leads_quality_check
      check (quality in ('HIGH','MEDIUM','LOW','UNRATED') and quality_source in ('AUTO','MANUAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_leads_lost_reason_check') then
    alter table public.meta_leads add constraint meta_leads_lost_reason_check
      check (lost_reason is null or lost_reason in ('NO_ANSWER','NOT_INTERESTED','BUDGET','LOCATION','ALREADY_FOUND','NOT_REAL','DUPLICATE','OTHER'));
  end if;
end $$;
create index if not exists idx_meta_leads_follow_up on public.meta_leads(user_id, follow_up_at) where follow_up_at is not null;
create index if not exists idx_meta_leads_contact on public.meta_leads(user_id, contact_key) where contact_key is not null;
create index if not exists idx_meta_leads_status on public.meta_leads(user_id, status, received_at desc);

-- The owner edits the pipeline (status, note, follow-up, lost reason, won
-- date, quality) — never the lead's identity or the server's contact key.
create or replace function public.meta_leads_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.fields is distinct from old.fields
     or new.external_lead_id is distinct from old.external_lead_id
     or new.source is distinct from old.source
     or new.campaign_id is distinct from old.campaign_id
     or new.user_id is distinct from old.user_id
     or new.form_external_id is distinct from old.form_external_id
     or new.received_at is distinct from old.received_at
     or new.ad_external_id is distinct from old.ad_external_id
     or new.adset_external_id is distinct from old.adset_external_id
     or new.property_id is distinct from old.property_id
     or new.answers is distinct from old.answers
     or new.meta_created_time is distinct from old.meta_created_time
     or new.contact_key is distinct from old.contact_key then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  -- A manual rating is the owner's; the automatic one never overwrites it.
  if new.quality is distinct from old.quality then new.quality_source := 'MANUAL'; end if;
  -- WON carries its date; leaving WON or LOST clears what belonged to it.
  if new.status = 'WON' and old.status is distinct from 'WON' and new.won_at is null then new.won_at := now(); end if;
  if new.status <> 'WON' then new.won_at := null; end if;
  if new.status <> 'LOST' then new.lost_reason := null; end if;
  new.updated_at := now();
  return new;
end $$;

-- 3 ───────────────────────────────────────────────────────────────────────
create table if not exists public.meta_lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.meta_leads(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('RECEIVED','STATUS','NOTE','FOLLOW_UP','QUALITY')),
  from_value text,
  to_value text,
  actor text not null default 'OWNER' check (actor in ('OWNER','SYSTEM')),
  at timestamptz not null default now()
);
create index if not exists idx_meta_lead_events_lead on public.meta_lead_events(lead_id, at desc);
create index if not exists idx_meta_lead_events_user on public.meta_lead_events(user_id, at desc);
alter table public.meta_lead_events enable row level security;
drop policy if exists meta_lead_events_select on public.meta_lead_events;
create policy meta_lead_events_select on public.meta_lead_events
  for select using (user_id = public.auth_user_id() or public.is_admin());
revoke insert, update, delete, truncate, references, trigger on public.meta_lead_events from authenticated, anon;
grant select on public.meta_lead_events to authenticated;

-- Notes are recorded as "changed", never copied: the timeline holds no lead text.
create or replace function public.meta_lead_events_log()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare actor text := case when auth.role() = 'service_role' then 'SYSTEM' else 'OWNER' end;
begin
  if tg_op = 'INSERT' then
    insert into public.meta_lead_events (lead_id, user_id, kind, to_value, actor) values (new.id, new.user_id, 'RECEIVED', new.source, 'SYSTEM');
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.meta_lead_events (lead_id, user_id, kind, from_value, to_value, actor)
    values (new.id, new.user_id, 'STATUS', old.status, new.status, actor);
  end if;
  if new.note is distinct from old.note then
    insert into public.meta_lead_events (lead_id, user_id, kind, actor) values (new.id, new.user_id, 'NOTE', actor);
  end if;
  if new.follow_up_at is distinct from old.follow_up_at then
    insert into public.meta_lead_events (lead_id, user_id, kind, to_value, actor)
    values (new.id, new.user_id, 'FOLLOW_UP', to_char(new.follow_up_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), actor);
  end if;
  if new.quality is distinct from old.quality then
    insert into public.meta_lead_events (lead_id, user_id, kind, from_value, to_value, actor)
    values (new.id, new.user_id, 'QUALITY', old.quality, new.quality, actor);
  end if;
  return new;
end $$;
revoke execute on function public.meta_lead_events_log() from public, anon, authenticated;
drop trigger if exists trg_meta_lead_events on public.meta_leads;
create trigger trg_meta_lead_events after insert or update on public.meta_leads
  for each row execute function public.meta_lead_events_log();
