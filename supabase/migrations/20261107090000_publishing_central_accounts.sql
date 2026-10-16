-- CENTRALIZED PUBLISHING — HOMATCH publishes through its OWN portal accounts.
--
-- Builds on 20261106090000_publishing_providers.sql (production ledger
-- 20261016085445). Additive except the jobs status CHECK, which is replaced by a
-- wider one; no row is rewritten and every existing status stays valid.
--
--   publishing_accounts        one row per portal: the HOMATCH account an admin
--                              registered — identity, the HOMATCH contact phone
--                              shown on every listing it posts, connection
--                              method, verification and activity bookkeeping.
--                              `credential` holds ONLY AES-GCM ciphertext made by
--                              the publishing-engine function (key in the
--                              function's environment, never in the database);
--                              no read path selects it.
--   publishing_account_audit   append-only record of every admin change, test and
--                              disconnect. The credential column is removed from
--                              both snapshots before they are written.
--   publishing_engine_jobs     channel: OWNER_HANDOFF (v1, the owner posts) or
--                              HOMATCH_ACCOUNT (HOMATCH posts). New statuses for
--                              the central pipeline: QUEUED, PUBLISHING,
--                              ADMIN_ACTION_REQUIRED, AUTH_REQUIRED, REJECTED,
--                              FAILED. contact_consent_at records the owner's
--                              consent to their name and phone in the footer.
--
-- CONNECTED and PUBLISHING_AVAILABLE need a verification timestamp: a CHECK
-- constraint makes "connected without verifying against the real account"
-- impossible to store, whatever the caller.
--
-- Service-role only (RLS on, no policies). Admins reach it through the
-- publishing-engine function, which re-checks is_admin() with the caller's own
-- token on every request. Owners keep reading their own jobs through the existing
-- RLS policy; nothing about the HOMATCH account is stored on a job.

create table public.publishing_accounts (
  portal_id text primary key references public.publishing_providers(id),
  status text not null default 'NOT_CONFIGURED' check (status in (
    'NOT_CONFIGURED', 'CONNECTED', 'AUTH_REQUIRED', 'SESSION_EXPIRED',
    'PUBLISHING_AVAILABLE', 'PUBLISHING_RESTRICTED', 'TEMPORARILY_UNAVAILABLE', 'UNSUPPORTED')),
  connection_method text check (connection_method in ('API', 'BROWSER_SESSION', 'MANUAL')),
  account_label text check (account_label is null or length(account_label) between 1 and 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  credential jsonb check (credential is null or (jsonb_typeof(credential) = 'object' and credential ? 'ct' and credential ? 'iv' and not credential ? 'secret')),
  credential_set_at timestamptz,
  session_expires_at timestamptz,
  verified_at timestamptz,
  verification_result text,
  last_published_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  constraint publishing_accounts_verified_status check (status not in ('CONNECTED', 'PUBLISHING_AVAILABLE') or verified_at is not null),
  constraint publishing_accounts_configured_identity check (status = 'NOT_CONFIGURED' or (account_label is not null and contact_phone is not null))
);
alter table public.publishing_accounts enable row level security;
revoke all on public.publishing_accounts from anon, authenticated;
grant all on public.publishing_accounts to service_role;
insert into public.publishing_accounts (portal_id) select id from public.publishing_providers;

create table public.publishing_account_audit (
  id bigint generated always as identity primary key,
  portal_id text not null references public.publishing_providers(id),
  actor uuid references public.users(id),
  action text not null check (action in ('REGISTER', 'UPDATE', 'CREDENTIAL_SET', 'CREDENTIAL_CLEARED', 'TEST', 'DISCONNECT')),
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create index publishing_account_audit_recent on public.publishing_account_audit(created_at desc);
alter table public.publishing_account_audit enable row level security;
revoke all on public.publishing_account_audit from anon, authenticated;
grant all on public.publishing_account_audit to service_role;

alter table public.publishing_engine_jobs
  add column if not exists channel text not null default 'OWNER_HANDOFF' check (channel in ('OWNER_HANDOFF', 'HOMATCH_ACCOUNT')),
  add column if not exists contact_consent_at timestamptz,
  add column if not exists status_reason text check (status_reason is null or length(status_reason) <= 500),
  add column if not exists admin_claimed_by uuid references public.users(id),
  add column if not exists admin_claimed_at timestamptz;

alter table public.publishing_engine_jobs drop constraint if exists publishing_engine_jobs_status_check;
alter table public.publishing_engine_jobs
  add constraint publishing_engine_jobs_status_check check (status in (
    'HANDOFF_READY', 'VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'VERIFICATION_FAILED',
    'UNPUBLISH_REQUESTED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY',
    'QUEUED', 'PUBLISHING', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED', 'REJECTED', 'FAILED'));
-- A HOMATCH-account publication carries the owner's footer only with their consent.
alter table public.publishing_engine_jobs
  add constraint publishing_engine_jobs_central_consent check (channel <> 'HOMATCH_ACCOUNT' or contact_consent_at is not null);
create index publishing_engine_jobs_queue on public.publishing_engine_jobs(status, updated_at)
  where status in ('QUEUED', 'PUBLISHING', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED', 'UNPUBLISH_REQUESTED');

-- The v1 write, widened to the central columns. Same signature, same
-- compare-and-set on revision, same one-transaction history row.
create or replace function public.publishing_publication_write(
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
    insert into public.publishing_engine_jobs(listing_id, user_id, portal_id, revision, status, listing_version, payload, channel, contact_consent_at)
    values (p_listing, p_owner, p_portal, 0, p_set->>'status', (p_set->>'listing_version')::integer, '{}'::jsonb,
            coalesce(p_set->>'channel', 'OWNER_HANDOFF'), (p_set->>'contact_consent_at')::timestamptz)
    returning * into v_row;
  else
    if v_row.user_id <> p_owner then raise exception 'OWNED_RECORD_REQUIRED'; end if;
    if v_row.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
    v_from := v_row.status;
    begin
      update public.publishing_engine_jobs set
        status             = coalesce(p_set->>'status', status),
        channel            = coalesce(p_set->>'channel', channel),
        external_id        = case when p_set ? 'external_id' then p_set->>'external_id' else external_id end,
        external_url       = case when p_set ? 'external_url' then p_set->>'external_url' else external_url end,
        listing_version    = case when p_set ? 'listing_version' then (p_set->>'listing_version')::integer else listing_version end,
        check_attempts     = case when p_set ? 'check_attempts' then (p_set->>'check_attempts')::integer else check_attempts end,
        last_checked_at    = case when p_set ? 'last_checked_at' then (p_set->>'last_checked_at')::timestamptz else last_checked_at end,
        next_check_at      = case when p_set ? 'next_check_at' then (p_set->>'next_check_at')::timestamptz else next_check_at end,
        published_at       = case when p_set ? 'published_at' then (p_set->>'published_at')::timestamptz else published_at end,
        last_error         = case when p_set ? 'last_error' then p_set->>'last_error' else last_error end,
        contact_consent_at = case when p_set ? 'contact_consent_at' then (p_set->>'contact_consent_at')::timestamptz else contact_consent_at end,
        status_reason      = case when p_set ? 'status_reason' then p_set->>'status_reason' else status_reason end,
        admin_claimed_by   = case when p_set ? 'admin_claimed_by' then (p_set->>'admin_claimed_by')::uuid else admin_claimed_by end,
        admin_claimed_at   = case when p_set ? 'admin_claimed_at' then (p_set->>'admin_claimed_at')::timestamptz else admin_claimed_at end,
        revision           = revision + 1,
        updated_at         = now()
      where id = v_row.id returning * into v_row;
    exception when unique_violation then raise exception 'EXTERNAL_LISTING_ALREADY_LINKED';
    end;
  end if;
  insert into public.publishing_engine_events(listing_id, publication_id, user_id, kind, portal_id, from_status, to_status, detail)
  values (p_listing, v_row.id, p_owner, coalesce(p_event->>'kind', 'PUBLICATION_UPDATED'), p_portal, v_from, v_row.status,
          coalesce(p_event->'detail', '{}'::jsonb));
  return to_jsonb(v_row);
end $$;

-- Archive / delete also wait for queued and in-progress central publications:
-- HOMATCH may be posting the listing right now.
create or replace function public.publishing_listing_lifecycle(p_owner uuid, p_listing uuid, p_action text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_row public.publishing_engine_listings;
begin
  select * into v_row from public.publishing_engine_listings where id = p_listing and user_id = p_owner for update;
  if not found then raise exception 'OWNED_RECORD_REQUIRED'; end if;
  if p_action in ('ARCHIVE', 'DELETE') and exists (
    select 1 from public.publishing_engine_jobs
     where listing_id = p_listing and status in ('VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'UNPUBLISH_REQUESTED',
                                                 'QUEUED', 'PUBLISHING', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED')) then
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

-- One admin change to one HOMATCH account and its audit row, in one transaction.
-- The edge function has validated every value (central.ts sanitizeAccountPatch)
-- and computed the status; this function enforces which keys each action may
-- write. ACTIVITY (publication bookkeeping) is not audited — the job history is.
create function public.publishing_account_write(p_actor uuid, p_portal text, p_patch jsonb, p_action text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_before public.publishing_accounts; v_after public.publishing_accounts; v_key text; v_allowed text[];
begin
  v_allowed := case p_action
    when 'REGISTER'           then array['status', 'connection_method', 'account_label', 'contact_phone', 'verification_result', 'last_error']
    when 'UPDATE'             then array['status', 'connection_method', 'account_label', 'contact_phone', 'verification_result', 'last_error']
    when 'CREDENTIAL_SET'     then array['credential', 'credential_set_at', 'status', 'verified_at', 'session_expires_at']
    when 'CREDENTIAL_CLEARED' then array['credential', 'credential_set_at', 'status', 'verified_at', 'session_expires_at']
    when 'TEST'               then array['status', 'verified_at', 'verification_result', 'session_expires_at', 'last_error', 'failure_count']
    when 'DISCONNECT'         then array['status', 'connection_method', 'account_label', 'contact_phone', 'credential', 'credential_set_at', 'verified_at', 'session_expires_at', 'verification_result', 'last_error']
    when 'ACTIVITY'           then array['last_published_at', 'failure_count', 'last_error']
    else null end;
  if v_allowed is null then raise exception 'INVALID_ACTION'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any(v_allowed) then raise exception 'FIELD_NOT_EDITABLE'; end if;
  end loop;
  -- Only a TEST against the real account (or a credential exchange it performed) may claim a verified status.
  if p_action not in ('TEST', 'CREDENTIAL_SET') and p_patch->>'status' in ('CONNECTED', 'PUBLISHING_AVAILABLE') then
    raise exception 'VERIFICATION_REQUIRED';
  end if;
  select * into v_before from public.publishing_accounts where portal_id = p_portal for update;
  if not found then raise exception 'PORTAL_UNKNOWN'; end if;
  update public.publishing_accounts set
    status              = case when p_patch ? 'status' then p_patch->>'status' else status end,
    connection_method   = case when p_patch ? 'connection_method' then p_patch->>'connection_method' else connection_method end,
    account_label       = case when p_patch ? 'account_label' then p_patch->>'account_label' else account_label end,
    contact_phone       = case when p_patch ? 'contact_phone' then p_patch->>'contact_phone' else contact_phone end,
    credential          = case when p_patch ? 'credential' then nullif(p_patch->'credential', 'null'::jsonb) else credential end,
    credential_set_at   = case when p_patch ? 'credential_set_at' then (p_patch->>'credential_set_at')::timestamptz else credential_set_at end,
    session_expires_at  = case when p_patch ? 'session_expires_at' then (p_patch->>'session_expires_at')::timestamptz else session_expires_at end,
    verified_at         = case when p_patch ? 'verified_at' then (p_patch->>'verified_at')::timestamptz else verified_at end,
    verification_result = case when p_patch ? 'verification_result' then p_patch->>'verification_result' else verification_result end,
    last_published_at   = case when p_patch ? 'last_published_at' then (p_patch->>'last_published_at')::timestamptz else last_published_at end,
    failure_count       = case when p_patch ? 'failure_count' then (p_patch->>'failure_count')::integer else failure_count end,
    last_error          = case when p_patch ? 'last_error' then p_patch->>'last_error' else last_error end,
    updated_by          = case when p_action = 'ACTIVITY' then updated_by else p_actor end,
    updated_at          = now()
  where portal_id = p_portal returning * into v_after;
  if p_action <> 'ACTIVITY' then
    insert into public.publishing_account_audit(portal_id, actor, action, before, after)
    values (p_portal, p_actor, p_action, to_jsonb(v_before) - 'credential', to_jsonb(v_after) - 'credential');
  end if;
  return to_jsonb(v_after) - 'credential';
end $$;

revoke all on function public.publishing_account_write(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.publishing_account_write(uuid, text, jsonb, text) to service_role;
