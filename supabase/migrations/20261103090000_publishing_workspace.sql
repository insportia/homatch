-- PROPERTY PUBLISHING & LISTING MANAGEMENT — the standalone workspace (/publishing).
--
-- Builds on the 2026-10-14 publishing_engine_* tables instead of creating a
-- parallel system. Production held 0 listings and 0 jobs when this was written,
-- so nothing is migrated; every change is additive except the three RPCs below.
--
--   publishing_engine_listings   ONE portal listing per EXISTING property (id = property id).
--                                status DRAFT | READY, archived_at, updated_at.
--   publishing_engine_jobs       ONE publication per (listing, portal) — already unique —
--                                now with first-class status / external id / URL /
--                                check bookkeeping columns instead of a payload blob.
--   publishing_engine_events     append-only history of every listing and publication change.
--
-- DROPPED: publishing_engine_save created a NEW properties row for every first save,
-- which duplicated the owner's property. publishing_engine_start_job /
-- publishing_engine_start_portal_job created browser-automation jobs whose live
-- submission was never enabled. All three were service-role only and are unused
-- by the new edge function.
--
-- PUBLISHED IS SERVER-ONLY. Owners read their rows through RLS; every write goes
-- through the publishing-engine edge function (service role), which only sets
-- PUBLISHED after its own check of the public portal page.

alter table public.publishing_engine_listings
  add column if not exists status text not null default 'DRAFT',
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.publishing_engine_listings
  add constraint publishing_engine_listings_status_check check (status in ('DRAFT', 'READY'));

alter table public.publishing_engine_jobs
  alter column id set default gen_random_uuid(),
  alter column payload set default '{}'::jsonb,
  add column if not exists status text not null default 'HANDOFF_READY',
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists listing_version integer,
  add column if not exists check_attempts integer not null default 0,
  add column if not exists last_checked_at timestamptz,
  add column if not exists next_check_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.publishing_engine_jobs
  add constraint publishing_engine_jobs_status_check check (status in (
    'HANDOFF_READY', 'VERIFYING', 'PUBLISHED', 'VERIFICATION_FAILED',
    'UNPUBLISH_REQUESTED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY'));
-- One external listing can back only one HOMATCH publication.
create unique index publishing_engine_jobs_external
  on public.publishing_engine_jobs(portal_id, external_id) where external_id is not null;

create table public.publishing_engine_events (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.publishing_engine_listings(id),
  publication_id uuid references public.publishing_engine_jobs(id),
  user_id uuid not null references public.users(id),
  kind text not null,
  portal_id text,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index publishing_engine_events_listing on public.publishing_engine_events(listing_id, created_at desc);
alter table public.publishing_engine_events enable row level security;
create policy publishing_engine_events_read on public.publishing_engine_events
  for select to authenticated using (user_id = public.get_user_id());
revoke all on public.publishing_engine_events from anon, authenticated;
grant select on public.publishing_engine_events to authenticated;
grant all on public.publishing_engine_events to service_role;

drop function if exists public.publishing_engine_save(uuid, uuid, integer, jsonb);
drop function if exists public.publishing_engine_start_job(uuid, uuid, integer);
drop function if exists public.publishing_engine_start_portal_job(uuid, uuid, integer, text);

-- Save a listing for a property the owner already has. Optimistic concurrency on
-- version (0 = create); never inserts into properties or property_facts.
create function public.publishing_listing_save(p_owner uuid, p_property uuid, p_version integer, p_payload jsonb, p_status text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.publishing_engine_listings; v_version integer;
begin
  if p_status not in ('DRAFT', 'READY') then raise exception 'INVALID_STATUS'; end if;
  perform 1 from public.properties where id = p_property and user_id = p_owner and is_deleted = false;
  if not found then raise exception 'OWNED_PROPERTY_REQUIRED'; end if;
  select * into v_row from public.publishing_engine_listings where id = p_property for update;
  if not found then
    if p_version <> 0 then raise exception 'VERSION_CONFLICT'; end if;
    v_version := 1;
    begin
      insert into public.publishing_engine_listings(id, user_id, version, payload, status)
      values (p_property, p_owner, 1, p_payload, p_status) returning * into v_row;
    exception when unique_violation then raise exception 'VERSION_CONFLICT';
    end;
  else
    if v_row.user_id <> p_owner then raise exception 'OWNED_PROPERTY_REQUIRED'; end if;
    if v_row.archived_at is not null then raise exception 'LISTING_ARCHIVED'; end if;
    if v_row.version <> p_version then raise exception 'VERSION_CONFLICT'; end if;
    v_version := v_row.version + 1;
    update public.publishing_engine_listings
       set version = v_version, payload = p_payload, status = p_status, updated_at = now()
     where id = p_property returning * into v_row;
  end if;
  insert into public.publishing_engine_versions(listing_id, user_id, version, payload)
  values (p_property, p_owner, v_version, p_payload);
  insert into public.publishing_engine_events(listing_id, user_id, kind, to_status, detail)
  values (p_property, p_owner, 'LISTING_SAVED', p_status, jsonb_build_object('version', v_version));
  return to_jsonb(v_row);
end $$;

-- Apply one publication transition decided by the edge function's state machine:
-- compare-and-set on revision, the change and its history row in one transaction.
create function public.publishing_publication_write(
  p_owner uuid, p_listing uuid, p_portal text, p_revision integer, p_set jsonb, p_event jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.publishing_engine_jobs; v_from text;
begin
  perform 1 from public.publishing_engine_listings where id = p_listing and user_id = p_owner;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  select * into v_row from public.publishing_engine_jobs where listing_id = p_listing and portal_id = p_portal for update;
  if not found then
    if p_revision <> -1 then raise exception 'REVISION_CONFLICT'; end if;
    v_from := null;
    insert into public.publishing_engine_jobs(listing_id, user_id, portal_id, revision, status, listing_version, payload)
    values (p_listing, p_owner, p_portal, 0, p_set->>'status', (p_set->>'listing_version')::integer, '{}'::jsonb)
    returning * into v_row;
  else
    if v_row.user_id <> p_owner then raise exception 'OWNED_RECORD_REQUIRED'; end if;
    if v_row.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
    v_from := v_row.status;
    begin
      update public.publishing_engine_jobs set
        status          = coalesce(p_set->>'status', status),
        external_id     = case when p_set ? 'external_id' then p_set->>'external_id' else external_id end,
        external_url    = case when p_set ? 'external_url' then p_set->>'external_url' else external_url end,
        listing_version = case when p_set ? 'listing_version' then (p_set->>'listing_version')::integer else listing_version end,
        check_attempts  = case when p_set ? 'check_attempts' then (p_set->>'check_attempts')::integer else check_attempts end,
        last_checked_at = case when p_set ? 'last_checked_at' then (p_set->>'last_checked_at')::timestamptz else last_checked_at end,
        next_check_at   = case when p_set ? 'next_check_at' then (p_set->>'next_check_at')::timestamptz else next_check_at end,
        published_at    = case when p_set ? 'published_at' then (p_set->>'published_at')::timestamptz else published_at end,
        last_error      = case when p_set ? 'last_error' then p_set->>'last_error' else last_error end,
        revision        = revision + 1,
        updated_at      = now()
      where id = v_row.id returning * into v_row;
    exception when unique_violation then raise exception 'EXTERNAL_LISTING_ALREADY_LINKED';
    end;
  end if;
  insert into public.publishing_engine_events(listing_id, publication_id, user_id, kind, portal_id, from_status, to_status, detail)
  values (p_listing, v_row.id, p_owner, coalesce(p_event->>'kind', 'PUBLICATION_UPDATED'), p_portal, v_from, v_row.status,
          coalesce(p_event->'detail', '{}'::jsonb));
  return to_jsonb(v_row);
end $$;

-- Archive / restore / delete a listing. Never touches the property itself, and
-- refuses while any portal copy may still be live.
create function public.publishing_listing_lifecycle(p_owner uuid, p_listing uuid, p_action text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.publishing_engine_listings;
begin
  select * into v_row from public.publishing_engine_listings where id = p_listing and user_id = p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if p_action in ('ARCHIVE', 'DELETE') and exists (
    select 1 from public.publishing_engine_jobs
     where listing_id = p_listing and status in ('VERIFYING', 'PUBLISHED', 'UNPUBLISH_REQUESTED')) then
    raise exception 'LIVE_PUBLICATIONS_EXIST';
  end if;
  if p_action = 'ARCHIVE' then
    update public.publishing_engine_listings set archived_at = now(), updated_at = now() where id = p_listing returning * into v_row;
  elsif p_action = 'RESTORE' then
    update public.publishing_engine_listings set archived_at = null, updated_at = now() where id = p_listing returning * into v_row;
  elsif p_action = 'DELETE' then
    delete from public.publishing_engine_events where listing_id = p_listing;
    delete from public.publishing_engine_jobs where listing_id = p_listing;
    delete from public.publishing_engine_versions where listing_id = p_listing;
    delete from public.publishing_engine_listings where id = p_listing;
    return jsonb_build_object('id', p_listing, 'deleted', true);
  else
    raise exception 'INVALID_ACTION';
  end if;
  insert into public.publishing_engine_events(listing_id, user_id, kind, detail)
  values (p_listing, p_owner, 'LISTING_' || p_action || 'D', '{}'::jsonb);
  return to_jsonb(v_row);
end $$;

revoke all on function public.publishing_listing_save(uuid, uuid, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.publishing_publication_write(uuid, uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.publishing_listing_lifecycle(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.publishing_listing_save(uuid, uuid, integer, jsonb, text) to service_role;
grant execute on function public.publishing_publication_write(uuid, uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.publishing_listing_lifecycle(uuid, uuid, text) to service_role;
