-- PROPERTY PORTALS — eight providers, admin-configurable, with an audit trail.
--
-- Builds on 20261103090000_publishing_workspace.sql (applied in production as
-- ledger 20261016062214). Additive except two CHECK constraints that are
-- replaced by wider ones; no row is rewritten.
--
--   publishing_providers        one row per portal: enabled, links, field rules,
--                               verification mode, last health check. The facts
--                               about a portal (its domains, its listing-URL
--                               pattern, its capabilities, the research evidence)
--                               live in code (publishing-engine/providers.ts) and
--                               are not editable here.
--   publishing_provider_audit   append-only record of every admin change / re-check.
--   publishing_engine_jobs      portal_id: the ('myhome','ssge') CHECK becomes a
--                               foreign key to publishing_providers; status gains
--                               OWNER_CONFIRMED (live by the owner's own statement,
--                               for portals HOMATCH may not fetch — never shown
--                               as verified).
--   publishing_listing_lifecycle  OWNER_CONFIRMED counts as live (no archive /
--                               delete while a portal copy may still be up).
--
-- No credentials of any kind are stored: no portal offers an authorised API or
-- account connection (see providers.ts), so there is nothing to store.
-- Service-role only. Admins reach it through the publishing-engine function,
-- which re-checks is_admin() with the caller's own token on every request.

create table public.publishing_providers (
  id text primary key check (id ~ '^[a-z]{2,20}$'),
  enabled boolean not null default true,
  sort integer not null default 0 check (sort between 0 and 99),
  create_url text check (create_url is null or create_url ~ '^https://'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  verification text check (verification in ('PAGE_CHECK', 'OWNER_CONFIRMED')),
  max_photos integer check (max_photos between 1 and 100),
  description_max integer check (description_max between 100 and 50000),
  required_fields text[] not null default '{}',
  health_status text,
  health_detail text,
  health_checked_at timestamptz,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.publishing_providers enable row level security;
revoke all on public.publishing_providers from anon, authenticated;
grant all on public.publishing_providers to service_role;

-- Seeded with the code defaults (providers.ts PROFILES.defaults), so behaviour is
-- unchanged until an admin edits a row.
insert into public.publishing_providers (id, sort, verification, max_photos, required_fields) values
  ('myhome',  0, 'PAGE_CHECK',      16,   '{description.ka}'),
  ('ssge',    1, 'PAGE_CHECK',      null, '{}'),
  ('placege', 2, 'PAGE_CHECK',      null, '{}'),
  ('homege',  3, 'PAGE_CHECK',      null, '{}'),
  ('brokeri', 4, 'PAGE_CHECK',      null, '{}'),
  ('korter',  5, 'OWNER_CONFIRMED', null, '{}'),
  ('binebi',  6, 'OWNER_CONFIRMED', null, '{}'),
  ('allhome', 7, 'PAGE_CHECK',      null, '{}');

create table public.publishing_provider_audit (
  id bigint generated always as identity primary key,
  provider_id text not null references public.publishing_providers(id),
  actor uuid references public.users(id),
  action text not null check (action in ('UPDATE', 'RECHECK')),
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create index publishing_provider_audit_recent on public.publishing_provider_audit(created_at desc);
alter table public.publishing_provider_audit enable row level security;
revoke all on public.publishing_provider_audit from anon, authenticated;
grant all on public.publishing_provider_audit to service_role;

alter table public.publishing_engine_jobs drop constraint if exists publishing_engine_jobs_portal_id_check;
alter table public.publishing_engine_jobs
  add constraint publishing_engine_jobs_portal_fk foreign key (portal_id) references public.publishing_providers(id);

alter table public.publishing_engine_jobs drop constraint if exists publishing_engine_jobs_status_check;
alter table public.publishing_engine_jobs
  add constraint publishing_engine_jobs_status_check check (status in (
    'HANDOFF_READY', 'VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'VERIFICATION_FAILED',
    'UNPUBLISH_REQUESTED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY'));

create or replace function public.publishing_listing_lifecycle(p_owner uuid, p_listing uuid, p_action text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.publishing_engine_listings;
begin
  select * into v_row from public.publishing_engine_listings where id = p_listing and user_id = p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if p_action in ('ARCHIVE', 'DELETE') and exists (
    select 1 from public.publishing_engine_jobs
     where listing_id = p_listing and status in ('VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'UNPUBLISH_REQUESTED')) then
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

-- One admin change (or re-check result) to one provider, and its audit row, in
-- one transaction. Only the listed columns can be written; the edge function has
-- already validated every value (providers.ts sanitizePatch).
create function public.publishing_provider_update(p_actor uuid, p_provider text, p_patch jsonb, p_action text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_before public.publishing_providers; v_after public.publishing_providers; v_key text;
begin
  if p_action not in ('UPDATE', 'RECHECK') then raise exception 'INVALID_ACTION'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if p_action = 'UPDATE' and v_key not in ('enabled', 'sort', 'create_url', 'logo_url', 'verification', 'max_photos', 'description_max', 'required_fields') then
      raise exception 'FIELD_NOT_EDITABLE';
    end if;
    if p_action = 'RECHECK' and v_key not in ('health_status', 'health_detail', 'health_checked_at') then
      raise exception 'FIELD_NOT_EDITABLE';
    end if;
  end loop;
  select * into v_before from public.publishing_providers where id = p_provider for update;
  if not found then raise exception 'PORTAL_UNKNOWN'; end if;
  update public.publishing_providers set
    enabled           = case when p_patch ? 'enabled' then (p_patch->>'enabled')::boolean else enabled end,
    sort              = case when p_patch ? 'sort' then (p_patch->>'sort')::integer else sort end,
    create_url        = case when p_patch ? 'create_url' then p_patch->>'create_url' else create_url end,
    logo_url          = case when p_patch ? 'logo_url' then p_patch->>'logo_url' else logo_url end,
    verification      = case when p_patch ? 'verification' then p_patch->>'verification' else verification end,
    max_photos        = case when p_patch ? 'max_photos' then (p_patch->>'max_photos')::integer else max_photos end,
    description_max   = case when p_patch ? 'description_max' then (p_patch->>'description_max')::integer else description_max end,
    required_fields   = case when p_patch ? 'required_fields' then array(select jsonb_array_elements_text(p_patch->'required_fields')) else required_fields end,
    health_status     = case when p_patch ? 'health_status' then p_patch->>'health_status' else health_status end,
    health_detail     = case when p_patch ? 'health_detail' then p_patch->>'health_detail' else health_detail end,
    health_checked_at = case when p_patch ? 'health_checked_at' then (p_patch->>'health_checked_at')::timestamptz else health_checked_at end,
    updated_by        = case when p_action = 'UPDATE' then p_actor else updated_by end,
    updated_at        = case when p_action = 'UPDATE' then now() else updated_at end
  where id = p_provider returning * into v_after;
  insert into public.publishing_provider_audit(provider_id, actor, action, before, after)
  values (p_provider, p_actor, p_action, to_jsonb(v_before), to_jsonb(v_after));
  return to_jsonb(v_after);
end $$;

revoke all on function public.publishing_listing_lifecycle(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.publishing_listing_lifecycle(uuid, uuid, text) to service_role;
revoke all on function public.publishing_provider_update(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.publishing_provider_update(uuid, text, jsonb, text) to service_role;
