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
-- BACKEND BROWSER AUTOMATION (same migration, still unapplied):
--   publishing_accounts.automation_enabled / live_submit_approved_*  — the owner's
--                              switches: run the browser worker on this portal at all,
--                              and (separately, audited) let it press the portal's
--                              final publish button. Both default OFF.
--   publishing_account_sessions  the portal session (Playwright storageState) the
--                              owner captured by signing in by hand, sealed with
--                              AES-GCM by the edge function; ciphertext only.
--   publishing_operations      durable per-portal browser operations (CREATE, STATUS,
--                              UPDATE, PRICE, DESCRIPTION, PHOTOS, PAUSE, REACTIVATE,
--                              DELETE, CHECK_SESSION): leases, fenced heartbeats,
--                              retries with backoff, one running operation per portal
--                              account, and submit_started_at — set once, before the
--                              portal's publish button is pressed, after which no
--                              retry ever submits again (RECONCILIATION_REQUIRED).
--   publishing_artifacts       screenshots per operation (private bucket publishing-artifacts,
--                              registered in _shared/storage/keys.ts as an ADMIN-only FLAT
--                              namespace); retained 30 days, removed at once with the listing.
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
  automation_enabled boolean not null default false,
  live_submit_approved boolean not null default false,
  live_submit_approved_by uuid references public.users(id),
  live_submit_approved_at timestamptz,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  constraint publishing_accounts_live_submit_approval check (not live_submit_approved or (live_submit_approved_by is not null and live_submit_approved_at is not null)),
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
  action text not null check (action in ('REGISTER', 'UPDATE', 'CREDENTIAL_SET', 'CREDENTIAL_CLEARED', 'TEST', 'DISCONNECT', 'SESSION_SET', 'SESSION_CHECK', 'AUTOMATION')),
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
    when 'SESSION_SET'        then array['status', 'connection_method', 'verified_at', 'session_expires_at', 'verification_result', 'last_error']
    when 'SESSION_CHECK'      then array['status', 'verified_at', 'verification_result', 'session_expires_at', 'last_error']
    when 'AUTOMATION'         then array['automation_enabled', 'live_submit_approved', 'live_submit_approved_by', 'live_submit_approved_at']
    when 'DISCONNECT'         then array['status', 'connection_method', 'account_label', 'contact_phone', 'credential', 'credential_set_at', 'verified_at', 'session_expires_at', 'verification_result', 'last_error', 'automation_enabled', 'live_submit_approved', 'live_submit_approved_by', 'live_submit_approved_at']
    when 'ACTIVITY'           then array['last_published_at', 'failure_count', 'last_error']
    else null end;
  if v_allowed is null then raise exception 'INVALID_ACTION'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any(v_allowed) then raise exception 'FIELD_NOT_EDITABLE'; end if;
  end loop;
  -- Only a TEST against the real account (or a credential exchange it performed) may claim a verified status.
  if p_action not in ('TEST', 'CREDENTIAL_SET', 'SESSION_CHECK') and p_patch->>'status' in ('CONNECTED', 'PUBLISHING_AVAILABLE') then
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
    automation_enabled  = case when p_patch ? 'automation_enabled' then (p_patch->>'automation_enabled')::boolean else automation_enabled end,
    live_submit_approved    = case when p_patch ? 'live_submit_approved' then (p_patch->>'live_submit_approved')::boolean else live_submit_approved end,
    live_submit_approved_by = case when p_patch ? 'live_submit_approved_by' then (p_patch->>'live_submit_approved_by')::uuid else live_submit_approved_by end,
    live_submit_approved_at = case when p_patch ? 'live_submit_approved_at' then (p_patch->>'live_submit_approved_at')::timestamptz else live_submit_approved_at end,
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

/* ── Backend browser automation ─────────────────────────────────────────── */

create table public.publishing_account_sessions (
  portal_id text primary key references public.publishing_providers(id),
  -- AES-GCM envelope {v,kid,iv,ct} of the Playwright storageState; never plaintext.
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object' and envelope ? 'ct' and envelope ? 'iv' and not envelope ? 'cookies'),
  saved_by uuid references public.users(id),
  saved_at timestamptz not null default now(),
  expires_at timestamptz,
  verified_at timestamptz,
  status text not null default 'UNVERIFIED' check (status in ('UNVERIFIED', 'VALID', 'EXPIRED'))
);
alter table public.publishing_account_sessions enable row level security;
revoke all on public.publishing_account_sessions from anon, authenticated;
grant all on public.publishing_account_sessions to service_role;

create table public.publishing_operations (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references public.publishing_engine_jobs(id) on delete cascade,
  listing_id uuid references public.publishing_engine_listings(id) on delete cascade,
  user_id uuid references public.users(id),
  portal_id text not null references public.publishing_providers(id),
  kind text not null check (kind in ('CREATE', 'STATUS', 'UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE', 'CHECK_SESSION')),
  listing_version integer,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'PREPARED', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'RECONCILIATION_REQUIRED', 'CANCELLED')),
  stage text check (stage is null or stage ~ '^[A-Z_]{2,40}$'),
  submit_started_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  worker_id text check (worker_id is null or length(worker_id) <= 80),
  result jsonb not null default '{}'::jsonb,
  last_error text check (last_error is null or length(last_error) <= 200),
  idempotency_key text not null unique check (length(idempotency_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_operations_target check (kind = 'CHECK_SESSION' or (publication_id is not null and listing_id is not null and user_id is not null))
);
-- One queued-or-running operation per publication: a second request waits for the first.
create unique index publishing_operations_one_active on public.publishing_operations(publication_id)
  where status in ('QUEUED', 'RUNNING') and publication_id is not null;
create index publishing_operations_claim on public.publishing_operations(portal_id, available_at) where status = 'QUEUED';
create index publishing_operations_publication on public.publishing_operations(publication_id, created_at desc);
alter table public.publishing_operations enable row level security;
revoke all on public.publishing_operations from anon, authenticated;
grant all on public.publishing_operations to service_role;

create table public.publishing_artifacts (
  id bigint generated always as identity primary key,
  -- SET NULL, not CASCADE: a deleted listing's screenshots must still be found by
  -- housekeeping and removed from storage (an orphan object would outlive its row).
  operation_id uuid references public.publishing_operations(id) on delete set null,
  kind text not null check (kind in ('SCREENSHOT', 'LOG')),
  stage text,
  path text not null check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,80}$'),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index publishing_artifacts_due on public.publishing_artifacts(created_at);
alter table public.publishing_artifacts enable row level security;
revoke all on public.publishing_artifacts from anon, authenticated;
grant all on public.publishing_artifacts to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publishing-artifacts', 'publishing-artifacts', false, 5000000, array['image/png', 'image/jpeg', 'application/json', 'text/plain'])
on conflict (id) do nothing;

-- Enqueue one operation; the idempotency key makes a repeat a no-op that returns the first.
create function public.publishing_op_enqueue(p_publication uuid, p_portal text, p_kind text, p_version integer, p_payload jsonb, p_key text)
returns public.publishing_operations language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_job public.publishing_engine_jobs; v_op public.publishing_operations;
begin
  select * into v_op from public.publishing_operations where idempotency_key = p_key;
  if found then return v_op; end if;
  if p_kind <> 'CHECK_SESSION' then
    select * into v_job from public.publishing_engine_jobs where id = p_publication;
    if not found or v_job.portal_id <> p_portal then raise exception 'PUBLICATION_NOT_FOUND'; end if;
  end if;
  begin
    insert into public.publishing_operations(publication_id, listing_id, user_id, portal_id, kind, listing_version, payload, idempotency_key)
    values (p_publication, v_job.listing_id, v_job.user_id, p_portal, p_kind, p_version, coalesce(p_payload, '{}'::jsonb), p_key)
    returning * into v_op;
  exception when unique_violation then
    -- Another operation is already queued or running for this publication.
    raise exception 'OPERATION_ALREADY_ACTIVE';
  end;
  return v_op;
end $$;

-- Claim at most one operation per portal account. Expired leases are swept first:
-- an operation that had started submitting is NEVER re-queued.
create function public.publishing_op_claim(p_worker text, p_portals text[], p_lease_seconds integer)
returns setof public.publishing_operations language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_portal text; v_op public.publishing_operations;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'INVALID_LEASE'; end if;
  update public.publishing_operations set
    status = case when submit_started_at is not null then 'RECONCILIATION_REQUIRED'
                  when attempts >= max_attempts then 'FAILED' else 'QUEUED' end,
    last_error = case when submit_started_at is not null then 'LEASE_LOST_AFTER_SUBMIT' else 'LEASE_EXPIRED' end,
    available_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::integer)),
    lease_token = null, lease_until = null, updated_at = now()
  where status = 'RUNNING' and lease_until < now();
  foreach v_portal in array coalesce(p_portals, '{}') loop
    if not pg_try_advisory_xact_lock(hashtextextended('publishing-account:' || v_portal, 0)) then continue; end if;
    if exists (select 1 from public.publishing_operations where portal_id = v_portal and status = 'RUNNING') then continue; end if;
    select o.* into v_op from public.publishing_operations o
      join public.publishing_accounts a on a.portal_id = o.portal_id
     where o.portal_id = v_portal and o.status = 'QUEUED' and o.available_at <= now()
       and (a.automation_enabled or o.kind = 'CHECK_SESSION')
       and exists (select 1 from public.publishing_account_sessions s where s.portal_id = o.portal_id and s.status <> 'EXPIRED')
     order by o.available_at, o.created_at
     for update of o skip locked limit 1;
    if not found then continue; end if;
    update public.publishing_operations set status = 'RUNNING', attempts = attempts + 1, worker_id = left(p_worker, 80),
      lease_token = gen_random_uuid(), lease_until = now() + make_interval(secs => p_lease_seconds), stage = 'CLAIMED', updated_at = now()
     where id = v_op.id returning * into v_op;
    return next v_op;
  end loop;
end $$;

-- Extend the lease and record progress. False: the lease is gone (stop at once).
create function public.publishing_op_heartbeat(p_op uuid, p_token uuid, p_stage text, p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.publishing_operations set lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
    stage = coalesce(p_stage, stage), updated_at = now()
   where id = p_op and lease_token = p_token and status = 'RUNNING' and lease_until >= now();
  return found;
end $$;

-- The one-way door before the portal's final publish click. True exactly once.
create function public.publishing_op_mark_submitting(p_op uuid, p_token uuid)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.publishing_operations set submit_started_at = now(), stage = 'SUBMITTING', updated_at = now()
   where id = p_op and lease_token = p_token and status = 'RUNNING' and lease_until >= now() and submit_started_at is null;
  return found;
end $$;

-- Finish an operation. A retryable failure before any submit goes back to the queue
-- with backoff; any failure after submit_started_at needs reconciliation.
create function public.publishing_op_finish(p_op uuid, p_token uuid, p_outcome text, p_result jsonb, p_error text, p_retryable boolean)
returns public.publishing_operations language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_op public.publishing_operations; v_status text;
begin
  if p_outcome not in ('SUCCEEDED', 'PREPARED', 'FAILED', 'BLOCKED', 'RECONCILIATION_REQUIRED') then raise exception 'INVALID_OUTCOME'; end if;
  select * into v_op from public.publishing_operations where id = p_op for update;
  if not found or v_op.lease_token is distinct from p_token or v_op.status <> 'RUNNING' then raise exception 'LEASE_CONFLICT'; end if;
  v_status := case
    when p_outcome = 'FAILED' and v_op.submit_started_at is not null then 'RECONCILIATION_REQUIRED'
    when p_outcome = 'FAILED' and coalesce(p_retryable, false) and v_op.attempts < v_op.max_attempts then 'QUEUED'
    else p_outcome end;
  update public.publishing_operations set status = v_status,
    result = coalesce(p_result, '{}'::jsonb), last_error = left(p_error, 200),
    available_at = case when v_status = 'QUEUED' then now() + make_interval(secs => least(3600, 60 * power(2, v_op.attempts)::integer)) else available_at end,
    lease_token = null, lease_until = null, stage = case when v_status = 'QUEUED' then 'RETRY_WAIT' else stage end, updated_at = now()
   where id = p_op returning * into v_op;
  return v_op;
end $$;

revoke all on function public.publishing_op_enqueue(uuid, text, text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.publishing_op_claim(text, text[], integer) from public, anon, authenticated;
revoke all on function public.publishing_op_heartbeat(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.publishing_op_mark_submitting(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publishing_op_finish(uuid, uuid, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.publishing_op_enqueue(uuid, text, text, integer, jsonb, text) to service_role;
grant execute on function public.publishing_op_claim(text, text[], integer) to service_role;
grant execute on function public.publishing_op_heartbeat(uuid, uuid, text, integer) to service_role;
grant execute on function public.publishing_op_mark_submitting(uuid, uuid) to service_role;
grant execute on function public.publishing_op_finish(uuid, uuid, text, jsonb, text, boolean) to service_role;

-- RETENTION: screenshots are kept 30 days, and dropped at once when their listing
-- is deleted (operation_id set null). Housekeeping (publishing-worker) removes the
-- storage objects first and then forgets exactly the rows whose object is gone.
create function public.publishing_artifacts_due(p_limit integer)
returns table (id bigint, path text) language sql security invoker set search_path = public, pg_temp as $$
  select a.id, a.path from public.publishing_artifacts a
   where a.operation_id is null or a.created_at < now() - interval '30 days'
   order by a.created_at limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
create function public.publishing_artifacts_forget(p_ids bigint[])
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v integer;
begin
  delete from public.publishing_artifacts where id = any(coalesce(p_ids, '{}'));
  get diagnostics v = row_count;
  return v;
end $$;
revoke all on function public.publishing_artifacts_due(integer) from public, anon, authenticated;
revoke all on function public.publishing_artifacts_forget(bigint[]) from public, anon, authenticated;
grant execute on function public.publishing_artifacts_due(integer) to service_role;
grant execute on function public.publishing_artifacts_forget(bigint[]) to service_role;
