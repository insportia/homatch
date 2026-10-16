-- ROLLBACK for supabase/migrations/20261108090000_publishing_central_accounts.sql.
-- NOT a migration. Run by hand, in one transaction, only if the release is rolled
-- back BEFORE any HOMATCH-account publication exists (it refuses otherwise, so no
-- central job, consent record or audit row is ever silently discarded).
-- Proven on a database whose publishing objects are byte-identical to production
-- (tests/sql/publishing/rollback.sh): afterwards every function body, constraint
-- and grant fingerprint equals the pre-migration state.
begin;
do $$ begin
  if exists (select 1 from public.publishing_engine_jobs where channel = 'HOMATCH_ACCOUNT' or status in ('QUEUED','PUBLISHING','ADMIN_ACTION_REQUIRED','AUTH_REQUIRED','REJECTED','FAILED'))
     or exists (select 1 from public.publishing_operations) then
    raise exception 'ROLLBACK_REFUSED: central publications or operations exist';
  end if;
end $$;
drop function public.publishing_artifacts_forget(bigint[]);
drop function public.publishing_artifacts_due(integer);
drop function public.publishing_op_finish(uuid, uuid, text, jsonb, text, boolean);
drop function public.publishing_op_mark_submitting(uuid, uuid);
drop function public.publishing_op_heartbeat(uuid, uuid, text, integer);
drop function public.publishing_op_claim(text, text[], integer);
drop function public.publishing_op_enqueue(uuid, text, text, integer, jsonb, text);
drop function public.publishing_account_write(uuid, text, jsonb, text);
drop table public.publishing_artifacts;
drop table public.publishing_operations;
drop table public.publishing_account_sessions;
drop table public.publishing_account_audit;
drop table public.publishing_accounts;
delete from storage.buckets where id = 'publishing-artifacts' and not exists (select 1 from storage.objects where bucket_id = 'publishing-artifacts');
drop index if exists public.publishing_engine_jobs_queue;
alter table public.publishing_engine_jobs drop constraint publishing_engine_jobs_central_consent;
alter table public.publishing_engine_jobs drop constraint publishing_engine_jobs_status_check;
alter table public.publishing_engine_jobs add constraint publishing_engine_jobs_status_check check (status in (
  'HANDOFF_READY', 'VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'VERIFICATION_FAILED',
  'UNPUBLISH_REQUESTED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY'));
alter table public.publishing_engine_jobs
  drop column admin_claimed_at, drop column admin_claimed_by, drop column status_reason,
  drop column contact_consent_at, drop column channel;
-- The two v1 functions return to their 20261103090000 / 20261106090000 bodies.

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
commit;
