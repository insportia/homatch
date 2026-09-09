-- Homatch — Verify report lifecycle and evidence integrity.
--
-- TWO PROBLEMS, ONE TABLE.
--
-- 1. EVIDENCE INTEGRITY (the security half)
--
--    research_jobs_update_own is USING (auth.uid() = user_id) with the same
--    WITH CHECK and no column restriction, and research_jobs_insert_own lets
--    a signed-in user create rows freely. Together they mean a customer can
--    INSERT a Verify report that Homatch never produced, or UPDATE their own
--    result_json / evidence / evidence_bundle / status after the fact.
--
--    That matters because research_jobs.result_json is not a customer note.
--    It is the evidence of record: verify-synthesis projects the verdict from
--    it, deal-room-ai grounds every answer in it, and the Deal Room's
--    snapshot, action plan and contract cross-check all derive from it. A
--    rewritable report can be shown to a counterparty as if a government
--    source had said something it never said.
--
--    An audit of every caller (repository-wide) shows nothing legitimate
--    needs those rights:
--
--      * the client NEVER inserts — the UI starts a run through the
--        research-agent Edge Function, which uses the service role and
--        creates the row itself (research-agent/index.ts)
--      * the client updates exactly four columns, all of them labels or
--        lifecycle, never evidence:
--            renameResearchJob      -> title
--            softDeleteResearchJob  -> deleted_at
--            linkResearchJobToCase  -> case_id, supersedes_job_id
--      * deal-room-ai, verify-synthesis and verification-handoff run under
--        the CALLER's JWT but only SELECT this table
--
--    So the rights are narrowed with column-level privileges rather than by
--    dropping the policies: the policies still express "your own rows", and
--    the grants express "these columns only". Both must pass, so a forged
--    result_json is rejected by the grant even though RLS would allow the
--    row. Service role is untouched and keeps writing evidence normally.
--
-- 2. LIFECYCLE (the honesty half)
--
--    The existing design is soft-delete-only, deliberately: a row can still
--    be referenced by transaction_cases.research_job_id, by another row's
--    supersedes_job_id, and by deal_rooms.verify_job_id, so a hard DELETE
--    would strand real customer work. That is correct and is NOT changed
--    here.
--
--    What was missing is that `deleted_at` carried two different meanings at
--    once — "the customer removed this from their history" and "this data is
--    gone" — while only the first was ever true. Nothing is destroyed, and a
--    Deal Room built on an archived Verify keeps working, which is the right
--    behaviour but makes the word "deleted" a lie.
--
--    lifecycle_state names the real states:
--
--      ACTIVE              visible in Verify history
--      ARCHIVED            removed from history by the customer; evidence
--                          retained; dependent Deal Rooms keep working
--      DELETION_REQUESTED  the customer asked for actual erasure; retained
--                          until an operator completes the retention review,
--                          because dependents may exist
--      PURGED              evidence actually erased (service role only)
--
--    deleted_at is kept and kept in sync in BOTH directions, so the shipped
--    UI and the existing `.is('deleted_at', null)` history filter keep
--    working unchanged while the state becomes truthful.
--
-- Idempotent: safe to re-run. No data is destroyed by this migration.

/* ------------------------------------------------------------------ *
 * 1. Lifecycle columns                                                *
 * ------------------------------------------------------------------ */

alter table public.research_jobs
  add column if not exists lifecycle_state text not null default 'ACTIVE',
  add column if not exists archived_at timestamptz,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists purged_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.research_jobs'::regclass
      and conname = 'research_jobs_lifecycle_state_ck'
  ) then
    alter table public.research_jobs
      add constraint research_jobs_lifecycle_state_ck
      check (lifecycle_state in ('ACTIVE','ARCHIVED','DELETION_REQUESTED','PURGED'));
  end if;
end $$;

-- Backfill from the existing meaning of deleted_at. A soft-deleted row was
-- ARCHIVED all along; recording it as anything stronger would overstate what
-- actually happened to the data.
update public.research_jobs
   set lifecycle_state = 'ARCHIVED',
       archived_at     = coalesce(archived_at, deleted_at)
 where deleted_at is not null
   and lifecycle_state = 'ACTIVE';

create index if not exists research_jobs_lifecycle_idx
  on public.research_jobs (user_id, lifecycle_state, created_at desc);

/* ------------------------------------------------------------------ *
 * 2. Keep lifecycle_state and deleted_at consistent, both directions  *
 * ------------------------------------------------------------------ */

create or replace function public.sync_research_job_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client boolean := current_user = 'authenticated';
begin
  /*
   * deleted_at is the legacy field the shipped UI still writes. Treat
   * whichever of the two the caller actually changed as the intent, so
   * softDeleteResearchJob() keeps working untouched and a lifecycle-aware
   * caller gets the same result.
   */
  if tg_op = 'UPDATE' then
    if new.deleted_at is distinct from old.deleted_at then
      if new.deleted_at is not null and new.lifecycle_state = 'ACTIVE' then
        new.lifecycle_state := 'ARCHIVED';
        new.archived_at := coalesce(new.archived_at, new.deleted_at);
      elsif new.deleted_at is null and new.lifecycle_state = 'ARCHIVED' then
        new.lifecycle_state := 'ACTIVE';
        new.archived_at := null;
      end if;
    end if;

    /*
     * A customer may only move between the states that are theirs to choose.
     * PURGED is an operator outcome and is never reachable from a client, and
     * a purged row is terminal — otherwise "erased" could be undone.
     */
    if v_client and new.lifecycle_state is distinct from old.lifecycle_state then
      if old.lifecycle_state = 'PURGED' or new.lifecycle_state = 'PURGED' then
        raise exception 'lifecycle_state PURGED is not settable by a client'
          using errcode = 'insufficient_privilege';
      end if;
      if not (
        (old.lifecycle_state = 'ACTIVE'             and new.lifecycle_state = 'ARCHIVED')
        or (old.lifecycle_state = 'ARCHIVED'        and new.lifecycle_state = 'ACTIVE')
        or (old.lifecycle_state = 'ARCHIVED'        and new.lifecycle_state = 'DELETION_REQUESTED')
        or (old.lifecycle_state = 'ACTIVE'          and new.lifecycle_state = 'DELETION_REQUESTED')
        or (old.lifecycle_state = 'DELETION_REQUESTED' and new.lifecycle_state = 'ARCHIVED')
      ) then
        raise exception 'illegal lifecycle transition % -> %',
          old.lifecycle_state, new.lifecycle_state
          using errcode = 'invalid_parameter_value';
      end if;
    end if;
  end if;

  -- Whatever set the state, keep the legacy history filter truthful.
  if new.lifecycle_state in ('ARCHIVED','DELETION_REQUESTED','PURGED') then
    new.deleted_at := coalesce(new.deleted_at, now());
    if new.lifecycle_state = 'ARCHIVED' then
      new.archived_at := coalesce(new.archived_at, now());
    end if;
    if new.lifecycle_state = 'DELETION_REQUESTED' then
      new.deletion_requested_at := coalesce(new.deletion_requested_at, now());
    end if;
  elsif new.lifecycle_state = 'ACTIVE' then
    new.deleted_at := null;
    new.archived_at := null;
    new.deletion_requested_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_research_jobs_lifecycle on public.research_jobs;
create trigger trg_research_jobs_lifecycle
  before insert or update on public.research_jobs
  for each row execute function public.sync_research_job_lifecycle();

/* ------------------------------------------------------------------ *
 * 3. Evidence integrity: column-level privileges                      *
 * ------------------------------------------------------------------ */

-- Narrow, not removed: research_jobs_insert_own / _update_own still say
-- "only your own rows". These grants say "and only these columns".
revoke insert, update on public.research_jobs from authenticated;

-- The client never inserts today (research-agent does, as service role).
-- These three columns are the identity of a run and carry no evidence, so a
-- future client-side "start a run" cannot forge a finished report.
grant insert (user_id, mode, query, title) on public.research_jobs to authenticated;

-- Exactly the columns the shipped UI writes, plus the new lifecycle fields.
-- result_json, evidence, evidence_bundle, documents, status, stage, progress,
-- captcha, error and every derived summary column are deliberately absent.
grant update (
  title,
  case_id,
  supersedes_job_id,
  deleted_at,
  lifecycle_state,
  archived_at,
  deletion_requested_at
) on public.research_jobs to authenticated;

/* ------------------------------------------------------------------ *
 * 4. Telling the customer the truth about dependents                  *
 * ------------------------------------------------------------------ */

/**
 * What still depends on this Verify report.
 *
 * The UI calls this before offering to remove a report so it can say what is
 * actually true — "this Verify is still used by 1 Deal Room, which will keep
 * working" — instead of implying erasure. SECURITY DEFINER because a customer
 * cannot see the referencing rows through their own RLS in every case, but it
 * refuses any job that is not the caller's own before returning anything.
 */
create or replace function public.research_job_dependents(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_rooms int;
  v_cases int;
  v_supersedes int;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select user_id into v_owner from public.research_jobs where id = p_job_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'research job not found for this user'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_rooms
    from public.deal_rooms
   where verify_job_id = p_job_id and deleted_at is null;

  select count(*) into v_cases
    from public.transaction_cases
   where research_job_id = p_job_id;

  select count(*) into v_supersedes
    from public.research_jobs
   where supersedes_job_id = p_job_id;

  return jsonb_build_object(
    'dealRooms', v_rooms,
    'cases', v_cases,
    'supersededBy', v_supersedes,
    -- Evidence is retained whenever anything still points at this run. This
    -- is the flag the UI uses to avoid the word "delete".
    'retained', (v_rooms + v_cases + v_supersedes) > 0
  );
end;
$$;

revoke all on function public.research_job_dependents(uuid) from public, anon;
grant execute on function public.research_job_dependents(uuid) to authenticated;
