-- HOMATCH — the queue that makes the seven-day rule enforceable.
--
-- WHY A QUEUE AND NOT A CHECK AT READ TIME
--
-- The freshness contract says evidence older than the window is REVALIDATED
-- before it is shown. There are two ways to honour that and only one of them
-- is survivable:
--
--   re-read it while the customer waits    every page view becomes a network
--                                          call to somebody else's server, the
--                                          page hangs on their latency, and a
--                                          popular property quietly turns into
--                                          a denial-of-service against a site
--                                          that did nothing wrong
--
--   re-read it in the discovery workflow   the match writer finds the stale
--                                          evidence, refuses to deliver it,
--                                          and ASKS for it to be re-checked
--
-- So revalidation is work that gets scheduled, and this is where it is
-- scheduled. Nothing in the frontend can cause a fetch.
--
-- THE DEDUP THAT MATTERS
--
-- run-matching-v2 runs per campaign. One popular signal can be a candidate
-- for forty properties in the same minute, and without a uniqueness rule that
-- is forty identical re-reads of one page — which is both wasted money and
-- exactly the behaviour a source would rate-limit us for.
--
-- The partial unique index below allows ONE open job per signal. A second
-- request for the same signal while one is pending or claimed is not an
-- error, it is a no-op: the work is already coming.
--
-- THE CONCURRENCY THAT MATTERS
--
-- Two workers ticking at once must not claim the same row. FOR UPDATE SKIP
-- LOCKED is how that is done without a lock table, without a lease column
-- that needs its own expiry reaper, and without either worker waiting.

create table if not exists public.revalidation_queue (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.raw_signals(id) on delete cascade,

  -- PENDING -> CLAIMED -> DONE | FAILED. A CLAIMED row older than its lease
  -- is reclaimable, which is what makes a worker crash survivable.
  status text not null default 'PENDING',

  /*
   * WHY it was queued, in the reader's own words. Not decoration: "verified
   * 9 days ago" and "we have never been able to read this" need different
   * responses, and a queue that forgets the difference retries the
   * unreadable one forever at the same priority as everything else.
   */
  reason text not null,
  requested_by text not null default 'run-matching-v2',

  attempts integer not null default 0,
  claimed_at timestamptz,
  claimed_by text,
  completed_at timestamptz,
  outcome text,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint revalidation_queue_status_check
    check (status in ('PENDING', 'CLAIMED', 'DONE', 'FAILED')),
  constraint revalidation_queue_outcome_check
    check (outcome is null or outcome in (
      'UNCHANGED_VALID', 'CHANGED_VALID', 'INVALID', 'REMOVED', 'INACCESSIBLE', 'UNKNOWN'
    ))
);

comment on table public.revalidation_queue is
  'Work owed to the freshness contract. Revalidation is scheduled here by the '
  'discovery/matching workflow and never triggered by a frontend read: '
  're-reading on page view would turn a popular property into a '
  'denial-of-service against a source that did nothing wrong.';

-- ONE OPEN JOB PER SIGNAL. The dedup, and the reason a signal that is a
-- candidate for forty campaigns is re-read once.
create unique index if not exists revalidation_queue_open_signal_key
  on public.revalidation_queue (signal_id)
  where status in ('PENDING', 'CLAIMED');

create index if not exists revalidation_queue_pending_idx
  on public.revalidation_queue (status, created_at)
  where status in ('PENDING', 'CLAIMED');

alter table public.revalidation_queue enable row level security;
-- Engine only. A customer has no business scheduling fetches.
revoke all on public.revalidation_queue from anon, authenticated;

-- ── asking for a re-check ────────────────────────────────────────────────
--
-- Idempotent by construction. Returns the job id either way, so a caller can
-- tell the customer "this is being re-checked" without caring whether it was
-- the one who asked.
create or replace function public.request_revalidation(
  p_signal_id uuid,
  p_reason text,
  p_requested_by text default 'run-matching-v2'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  existing uuid;
  created uuid;
begin
  select id into existing
    from public.revalidation_queue
   where signal_id = p_signal_id
     and status in ('PENDING', 'CLAIMED')
   limit 1;

  if existing is not null then
    -- Already coming. Not an error and not a second job.
    return existing;
  end if;

  insert into public.revalidation_queue (signal_id, reason, requested_by)
  values (p_signal_id, coalesce(p_reason, 'stale'), coalesce(p_requested_by, 'unknown'))
  returning id into created;

  return created;
exception
  when unique_violation then
    /*
     * Two callers raced past the SELECT. The index is the authority, and the
     * loser reads back the winner's row rather than failing -- a campaign
     * must not error because another campaign asked for the same re-check a
     * millisecond earlier.
     */
    select id into existing
      from public.revalidation_queue
     where signal_id = p_signal_id
       and status in ('PENDING', 'CLAIMED')
     limit 1;
    return existing;
end $$;

comment on function public.request_revalidation is
  'Schedule a re-check, at most one open job per signal. Idempotent: a second '
  'request while one is open returns the existing job rather than creating a '
  'duplicate or failing.';

-- ── taking work ──────────────────────────────────────────────────────────
--
-- SKIP LOCKED so two workers ticking together take different rows and
-- neither waits. A CLAIMED row whose lease has expired is reclaimable, which
-- is what makes a worker that died mid-fetch survivable without a reaper.
create or replace function public.claim_revalidation(
  p_worker text,
  p_limit integer default 25,
  p_lease_minutes integer default 10,
  p_max_attempts integer default 3
)
returns setof public.revalidation_queue
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return query
  with candidate as (
    select q.id
      from public.revalidation_queue q
     where q.attempts < greatest(1, p_max_attempts)
       and (
         q.status = 'PENDING'
         or (q.status = 'CLAIMED'
             and q.claimed_at < now() - make_interval(mins => greatest(1, p_lease_minutes)))
       )
     order by q.created_at
     limit greatest(1, least(200, p_limit))
     for update skip locked
  )
  update public.revalidation_queue q
     set status = 'CLAIMED',
         claimed_at = now(),
         claimed_by = p_worker,
         attempts = q.attempts + 1,
         updated_at = now()
    from candidate c
   where q.id = c.id
  returning q.*;
end $$;

comment on function public.claim_revalidation is
  'Take up to p_limit jobs atomically. FOR UPDATE SKIP LOCKED so concurrent '
  'workers take different rows and neither waits; an expired lease is '
  'reclaimable so a worker that died mid-fetch needs no reaper.';

-- ── finishing ────────────────────────────────────────────────────────────
--
-- The outcome is recorded here; the EVIDENCE is written by the worker through
-- applyRevalidation, because the rules about which timestamp may move live in
-- one place and it is not this one.
create or replace function public.complete_revalidation(
  p_id uuid,
  p_outcome text,
  p_error text default null
)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.revalidation_queue
     set status = case
           -- An inconclusive outcome is not a completed job: it establishes
           -- nothing, so the signal is still owed a look and the row stays
           -- claimable until its attempts run out.
           when p_outcome in ('INACCESSIBLE', 'UNKNOWN')
             and attempts < 3 then 'PENDING'
           when p_outcome in ('INACCESSIBLE', 'UNKNOWN') then 'FAILED'
           else 'DONE'
         end,
         outcome = p_outcome,
         last_error = p_error,
         completed_at = case
           when p_outcome in ('INACCESSIBLE', 'UNKNOWN') and attempts < 3 then null
           else now()
         end,
         claimed_at = case
           when p_outcome in ('INACCESSIBLE', 'UNKNOWN') and attempts < 3 then null
           else claimed_at
         end,
         updated_at = now()
   where id = p_id
$$;

comment on function public.complete_revalidation is
  'Close a job. An INACCESSIBLE or UNKNOWN outcome returns it to PENDING '
  'until its attempts run out, because establishing nothing is not the same '
  'as finishing.';

revoke all on function public.request_revalidation(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_revalidation(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_revalidation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.request_revalidation(uuid, text, text) to service_role;
grant execute on function public.claim_revalidation(text, integer, integer, integer) to service_role;
grant execute on function public.complete_revalidation(uuid, text, text) to service_role;

-- ── what the customer was actually shown ─────────────────────────────────
--
-- Recorded on the match, at the moment it was created, so "was this delivered
-- fresh?" is answerable afterwards rather than re-derived from timestamps
-- that have since moved on.
alter table public.matches
  add column if not exists evidence_freshness text,
  add column if not exists evidence_verified_at timestamptz;

comment on column public.matches.evidence_freshness is
  'FRESH (verified inside the window) or NEW_UNVERIFIED (seen inside it, '
  'never re-checked) at the moment this match was created. NULL means the '
  'match predates the freshness contract. Nothing else may be delivered.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_evidence_freshness_check') then
    alter table public.matches
      add constraint matches_evidence_freshness_check
      check (evidence_freshness is null or evidence_freshness in ('FRESH', 'NEW_UNVERIFIED'))
      not valid;
  end if;
end $$;

alter table public.matches validate constraint matches_evidence_freshness_check;
