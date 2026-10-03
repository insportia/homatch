-- PROPERTY OWNER LIFECYCLE: 30-DAY FRESHNESS, FREE RENEWAL, AVAILABILITY,
-- SOURCE PROVENANCE AND SOURCE HEALTH.
--
-- A property an owner manages in HOMATCH is only worth showing to buyers and
-- tenants while the owner still stands behind it. Until now nothing recorded
-- that: a listing created in August looked exactly as current in October.
--
--   FRESHNESS (owner side, server-authoritative)
--     properties.freshness_anchor_at   start of the current 30-day window
--     properties.owner_confirmed_at    the owner's last explicit confirmation
--                                      (null = never confirmed; never invented)
--     property_freshness_state()       ACTIVE (day 0-23) / EXPIRING_SOON (24-29)
--                                      / EXPIRED (30+), computed with the
--                                      database clock, never the browser's
--     renew_property()                 free, owner-only, idempotent
--
--   DISCOVERY GUARD
--     An EXPIRED property is not freshly confirmed inventory. The hourly sweep
--     pauses its matching and records that IT did (freshness_paused_matching),
--     and a trigger refuses to switch matching back on while it is expired.
--     Renewal resumes exactly what the sweep paused, on the SAME property.
--     Matches, campaigns, photos and history are never touched.
--
--   AVAILABILITY
--     set_property_availability() is "no longer available" / "available
--     again" on the existing archive semantics (archived_at). It also repairs
--     a real defect: authenticated has no UPDATE grant on archived_at
--     (20260911170000 scoped the column grants and 20260926280000 added the
--     column without one), so archiving from the client was refused.
--
--   SOURCE PROVENANCE AND HEALTH (imported properties only)
--     property_facts.imported_at, source_status, source_checked_at,
--     source_last_available_at, media_last_ok_at, source_failed_checks.
--     The exact source URL, listing id and these fields cannot be changed by
--     an owner's edit (a trigger keeps them), so provenance survives HOMATCH
--     edits. Source health is a separate dimension from freshness: renewing
--     in HOMATCH never claims the source listing was updated, and a source
--     check never renews HOMATCH. A temporary outage never marks a listing
--     gone: LISTING_NOT_FOUND needs two consecutive not-found checks.
--
-- BACKFILL (conservative, nothing invented)
--   freshness_anchor_at  existing rows: the moment this migration runs, i.e. a
--                        full 30-day window from release. Nobody expires on
--                        release day and no historical confirmation is
--                        claimed. New rows: their creation time.
--   owner_confirmed_at   null for every existing row.
--   imported_at          URL_IMPORT properties: properties.created_at (the row
--                        is created by the import's save).
--   source_status        UNKNOWN until a real check records something.
--
-- Free: nothing here reads or writes credits, reservations or charges.
-- Append-only, additive, idempotent (safe to apply twice). The runner owns the
-- transaction.

-------------------------------------------------------------------------------
-- 1. Columns
-------------------------------------------------------------------------------
alter table public.properties
  add column if not exists freshness_anchor_at timestamptz not null default now(),
  add column if not exists owner_confirmed_at timestamptz,
  add column if not exists freshness_paused_matching boolean not null default false;

comment on column public.properties.freshness_anchor_at is
  'Start of the current 30-day freshness window: creation, or the last owner renewal. '
  'Existing rows at release were given the release time (a full window), never an invented confirmation.';
comment on column public.properties.owner_confirmed_at is
  'When the owner last explicitly confirmed this property is still current. Null: never confirmed.';
comment on column public.properties.freshness_paused_matching is
  'True when the freshness sweep paused matching because the property expired; renewal resumes it.';

alter table public.property_facts
  add column if not exists imported_at timestamptz,
  add column if not exists source_status text not null default 'UNKNOWN',
  add column if not exists source_checked_at timestamptz,
  add column if not exists source_last_available_at timestamptz,
  add column if not exists media_last_ok_at timestamptz,
  add column if not exists source_failed_checks integer not null default 0;

do $$ begin
  alter table public.property_facts add constraint property_facts_source_status_check
    check (source_status in ('AVAILABLE', 'TEMPORARILY_UNREACHABLE', 'LISTING_NOT_FOUND',
                             'MEDIA_UNAVAILABLE', 'SOURCE_CHANGED', 'UNKNOWN'));
exception when duplicate_object then null; end $$;

update public.property_facts f
   set imported_at = p.created_at
  from public.properties p
 where p.id = f.property_id and f.imported_at is null
   and p.source_type::text = 'URL_IMPORT';

create index if not exists properties_freshness_sweep_idx
  on public.properties (freshness_anchor_at)
  where is_deleted = false and archived_at is null;

-------------------------------------------------------------------------------
-- 2. The rule: one definition, used by every reader and the guard
-------------------------------------------------------------------------------
create or replace function public.property_freshness_state(p_anchor timestamptz, p_now timestamptz default now())
returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when p_anchor is null then 'EXPIRED'
    when p_now - p_anchor >= interval '30 days' then 'EXPIRED'
    when p_now - p_anchor >= interval '24 days' then 'EXPIRING_SOON'
    else 'ACTIVE'
  end
$function$;
grant execute on function public.property_freshness_state(timestamptz, timestamptz) to authenticated, service_role;

-------------------------------------------------------------------------------
-- 3. What the owner sees: the server's answer, computed with the server clock
-------------------------------------------------------------------------------
create or replace function public.my_property_lifecycle(p_property_ids uuid[])
returns table (
  property_id uuid,
  freshness_state text,
  anchor_at timestamptz,
  expires_at timestamptz,
  days_left integer,
  owner_confirmed_at timestamptz,
  archived boolean,
  matching_paused_by_freshness boolean,
  discovery_eligible boolean,
  source_status text,
  source_checked_at timestamptz,
  imported_at timestamptz,
  server_now timestamptz
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select p.id,
         public.property_freshness_state(p.freshness_anchor_at),
         p.freshness_anchor_at,
         p.freshness_anchor_at + interval '30 days',
         greatest(0, ceil(extract(epoch from (p.freshness_anchor_at + interval '30 days' - now())) / 86400))::integer,
         p.owner_confirmed_at,
         p.archived_at is not null,
         p.freshness_paused_matching,
         (p.archived_at is null and p.is_deleted = false
          and public.property_freshness_state(p.freshness_anchor_at) <> 'EXPIRED'),
         f.source_status,
         f.source_checked_at,
         f.imported_at,
         now()
    from public.properties p
    left join public.property_facts f on f.property_id = p.id
   where p.id = any (p_property_ids)
     and p.is_deleted = false
     and p.user_id = public.get_user_id()
$function$;
revoke all on function public.my_property_lifecycle(uuid[]) from public, anon;
grant execute on function public.my_property_lifecycle(uuid[]) to authenticated;

-------------------------------------------------------------------------------
-- 4. Renewal: free, owner-only, idempotent, same property
-------------------------------------------------------------------------------
create or replace function public.renew_property(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := public.get_user_id();
  v_row public.properties%rowtype;
  v_resumed boolean := false;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_row from public.properties
   where id = p_property_id and user_id = v_user and is_deleted = false
   for update;
  if not found then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_AVAILABLE');
  end if;

  /* A double click, a retry, a second tab: one renewal. The row lock above
     serialises them; the second sees the first's timestamp and changes nothing. */
  if v_row.owner_confirmed_at is not null and v_row.owner_confirmed_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', true, 'renewed', false, 'reason', 'ALREADY_RENEWED',
      'freshness_state', public.property_freshness_state(v_row.freshness_anchor_at),
      'expires_at', v_row.freshness_anchor_at + interval '30 days');
  end if;

  v_resumed := v_row.freshness_paused_matching;

  update public.properties
     set freshness_anchor_at = now(),
         owner_confirmed_at = now(),
         freshness_paused_matching = false,
         matching_status = case when v_resumed then 'ACTIVE' else matching_status end,
         updated_at = now()
   where id = p_property_id;

  return jsonb_build_object('ok', true, 'renewed', true, 'freshness_state', 'ACTIVE',
    'expires_at', now() + interval '30 days', 'matching_resumed', v_resumed);
end;
$function$;
revoke all on function public.renew_property(uuid) from public, anon;
grant execute on function public.renew_property(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. Availability on the existing archive semantics
-------------------------------------------------------------------------------
create or replace function public.set_property_availability(p_property_id uuid, p_available boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := public.get_user_id();
  v_found boolean;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  perform 1 from public.properties
   where id = p_property_id and user_id = v_user and is_deleted = false
   for update;
  v_found := found;
  if not v_found then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = '42501';
  end if;

  if p_available then
    /* Back on the market. Matching stays paused: resuming spends, and that
       is the owner's next decision, not a side effect (see archiveProperty). */
    update public.properties set archived_at = null, updated_at = now()
     where id = p_property_id and archived_at is not null;
  else
    update public.properties
       set archived_at = coalesce(archived_at, now()), matching_status = 'PAUSED',
           freshness_paused_matching = false, updated_at = now()
     where id = p_property_id;
  end if;
  return jsonb_build_object('ok', true, 'available', p_available);
end;
$function$;
revoke all on function public.set_property_availability(uuid, boolean) from public, anon;
grant execute on function public.set_property_availability(uuid, boolean) to authenticated;

-------------------------------------------------------------------------------
-- 6. Discovery guard: expired inventory is not switched (back) on
-------------------------------------------------------------------------------
create or replace function public.properties_freshness_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.matching_status::text = 'ACTIVE'
     and old.matching_status::text is distinct from 'ACTIVE'
     and public.property_freshness_state(new.freshness_anchor_at) = 'EXPIRED' then
    raise exception 'PROPERTY_EXPIRED' using errcode = 'P0001',
      hint = 'Renew the property (free) before starting buyer/tenant discovery.';
  end if;
  return new;
end;
$function$;

drop trigger if exists properties_freshness_guard on public.properties;
create trigger properties_freshness_guard
  before update of matching_status on public.properties
  for each row execute function public.properties_freshness_guard();

-------------------------------------------------------------------------------
-- 7. Provenance survives owner edits
-------------------------------------------------------------------------------
create or replace function public.property_facts_keep_provenance()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  /* The service role (importer, source checks) may write these; an owner's
     edit through the API may not. Kept silently rather than refused, so the
     existing edit form, which writes the whole row, keeps working. */
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if old.source_url is not null then new.source_url := old.source_url; end if;
    if old.canonical_url is not null then new.canonical_url := old.canonical_url; end if;
    if old.source_listing_id is not null then new.source_listing_id := old.source_listing_id; end if;
    if old.source_domain is not null then new.source_domain := old.source_domain; end if;
    new.imported_at := old.imported_at;
    new.source_status := old.source_status;
    new.source_checked_at := old.source_checked_at;
    new.source_last_available_at := old.source_last_available_at;
    new.media_last_ok_at := old.media_last_ok_at;
    new.source_failed_checks := old.source_failed_checks;
  end if;
  return new;
end;
$function$;

drop trigger if exists property_facts_keep_provenance on public.property_facts;
create trigger property_facts_keep_provenance
  before update on public.property_facts
  for each row execute function public.property_facts_keep_provenance();

/* A new imported property records when it was imported, server-side. */
create or replace function public.property_facts_stamp_import()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.source_url is not null and new.imported_at is null then
    new.imported_at := now();
  end if;
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.source_status := 'UNKNOWN';
    new.source_checked_at := null;
    new.source_last_available_at := null;
    new.media_last_ok_at := null;
    new.source_failed_checks := 0;
  end if;
  return new;
end;
$function$;

drop trigger if exists property_facts_stamp_import on public.property_facts;
create trigger property_facts_stamp_import
  before insert on public.property_facts
  for each row execute function public.property_facts_stamp_import();

-------------------------------------------------------------------------------
-- 8. Source health (service role only; separate from freshness)
-------------------------------------------------------------------------------
create or replace function public.record_property_source_check(
  p_property_id uuid, p_outcome text, p_media_ok boolean default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_facts public.property_facts%rowtype;
  v_status text;
  v_failed integer;
begin
  if p_outcome not in ('AVAILABLE', 'NOT_FOUND', 'UNREACHABLE', 'MEDIA_UNAVAILABLE', 'CHANGED') then
    raise exception 'UNKNOWN_OUTCOME %', p_outcome;
  end if;
  select * into v_facts from public.property_facts where property_id = p_property_id for update;
  if not found or v_facts.source_url is null then
    return null;
  end if;

  v_failed := v_facts.source_failed_checks;
  v_status := v_facts.source_status;
  case p_outcome
    when 'AVAILABLE' then v_status := 'AVAILABLE'; v_failed := 0;
    when 'MEDIA_UNAVAILABLE' then v_status := 'MEDIA_UNAVAILABLE'; v_failed := 0;
    when 'CHANGED' then v_status := 'SOURCE_CHANGED'; v_failed := 0;
    /* An outage is never a verdict. */
    when 'UNREACHABLE' then
      if v_status <> 'LISTING_NOT_FOUND' then v_status := 'TEMPORARILY_UNREACHABLE'; end if;
    /* "Gone" needs to be seen twice in a row. */
    when 'NOT_FOUND' then
      v_failed := v_failed + 1;
      v_status := case when v_failed >= 2 then 'LISTING_NOT_FOUND' else 'TEMPORARILY_UNREACHABLE' end;
  end case;

  update public.property_facts
     set source_status = v_status,
         source_failed_checks = v_failed,
         source_checked_at = now(),
         source_last_available_at = case when p_outcome in ('AVAILABLE', 'MEDIA_UNAVAILABLE') then now() else source_last_available_at end,
         media_last_ok_at = case when p_media_ok is true then now() else media_last_ok_at end
   where property_id = p_property_id;
  return v_status;
end;
$function$;
revoke all on function public.record_property_source_check(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.record_property_source_check(uuid, text, boolean) to service_role;

-------------------------------------------------------------------------------
-- 9. The hourly sweep: pause expired discovery, tell the owner
-------------------------------------------------------------------------------
create or replace function public.property_freshness_sweep()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row record;
  v_paused integer := 0;
  v_warned integer := 0;
begin
  for v_row in
    update public.properties p
       set matching_status = 'PAUSED', freshness_paused_matching = true, updated_at = now()
     where p.is_deleted = false and p.archived_at is null
       and p.matching_status::text = 'ACTIVE'
       and public.property_freshness_state(p.freshness_anchor_at) = 'EXPIRED'
    returning p.id, p.user_id, p.freshness_anchor_at
  loop
    v_paused := v_paused + 1;
  end loop;

  /* One notice when a window starts closing, one when it has closed. */
  for v_row in
    select p.id, p.user_id, p.freshness_anchor_at,
           public.property_freshness_state(p.freshness_anchor_at) as state
      from public.properties p
     where p.is_deleted = false and p.archived_at is null
       and public.property_freshness_state(p.freshness_anchor_at) in ('EXPIRING_SOON', 'EXPIRED')
       and p.freshness_anchor_at > now() - interval '45 days'
  loop
    perform public.notify_emit(v_row.user_id, 'PROPERTY_ACTION_REQUIRED'::public.notification_type,
      case when v_row.state = 'EXPIRED' then 'Your property listing has expired'
           else 'Your property listing needs renewing soon' end,
      'Confirm it is still available to keep it active for another 30 days. Renewal is free.',
      'NORMAL', '/property/' || v_row.id::text, 'properties', v_row.id,
      'property-freshness:' || lower(v_row.state) || ':' || v_row.id::text || ':' || to_char(v_row.freshness_anchor_at, 'YYYYMMDDHH24MISS'));
    v_warned := v_warned + 1;
  end loop;

  return jsonb_build_object('paused', v_paused, 'notified', v_warned);
end;
$function$;
revoke all on function public.property_freshness_sweep() from public, anon, authenticated;
grant execute on function public.property_freshness_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'homatch-property-freshness') then
      perform cron.unschedule('homatch-property-freshness');
    end if;
    perform cron.schedule('homatch-property-freshness', '23 * * * *',
      $cron$ select public.property_freshness_sweep(); $cron$);
  end if;
end $$;
