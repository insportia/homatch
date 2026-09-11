-- HOMATCH — background_jobs: one durable registry for work that outlives a tab.
--
-- WHY A NEW TABLE, AND WHY IT REPLACES NOTHING
--
-- There are already two durable pipelines. research_jobs drives Verify and is
-- genuinely resilient: a pg_cron tick calls research-agent with action:'drive'
-- every thirty seconds, which claims any live job the client has stopped
-- polling and advances it. matching_jobs does the same job for Find Clients,
-- with its own columns, its own status enum and its own worker.
--
-- They do not agree on a single word. research_jobs says CREATED/RUNNING/
-- COMPLETE, matching_jobs says queued/running/succeeded, and document analysis
-- says NONE/RUNNING/DONE — while having no job row at all, which is exactly
-- why a document can sit at "Reading document…" forever (a production row has
-- done so since 13:52 on 2026-09-11, holding a complete nine-clause analysis
-- behind an analysis_state nothing will ever move).
--
-- So this table is deliberately NOT a replacement. It is an INDEX over the
-- work, holding only what every product shares and nothing any one product
-- owns:
--
--   * where it is, in one vocabulary
--   * whether the customer may still stop it
--   * whether anyone is still alive and working on it
--   * what it has already finished, so a retry does not buy it again
--   * which wallet reservation is riding on it
--   * where the finished thing can be read
--
-- research_jobs keeps evidence, documents, result_json and its driver.
-- matching_jobs keeps its tiers and its signal counts. Neither is migrated,
-- neither is duplicated, and both gain a row here that points back at them.
-- One table for the job centre to query and one channel to subscribe to.
--
-- THE LINE THIS TABLE EXISTS TO DRAW
--
-- cancel_deadline_at. For the first fifteen seconds a job has spent nothing
-- irrecoverable and the customer may walk away with their credits. After it,
-- Homatch begins buying provider time on their behalf, and a cancellation
-- would leave us holding a bill with nothing to settle it against.
--
-- That refusal lives in background_job_cancel() below, in Postgres, checked
-- against now(). Hiding the button is a courtesy. This is the control.

-- ── The table ──────────────────────────────────────────────────────────────

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),

  -- auth.uid(), matching research_jobs.user_id and deal_room_documents.user_id.
  -- NOT public.users.id, which is a different key entirely.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What the customer bought. Maps to billable_products.code where one exists.
  product_type text not null check (product_type in (
    'VERIFY', 'DOCUMENT_ANALYSIS', 'FIND_CLIENTS', 'MARKET_RESEARCH',
    'LOCATION_RESEARCH', 'CONTRACT_ANALYSIS', 'AI_ENRICHMENT', 'EMAIL_CAMPAIGN', 'AI_CALL'
  )),

  -- The product row this is about. Deliberately not a foreign key: the three
  -- subject tables have three different owners and three different deletion
  -- rules, and a job record that vanishes when its subject is archived is a
  -- job record that cannot explain what it spent.
  subject_type text not null check (subject_type in (
    'RESEARCH_JOB', 'DOCUMENT', 'MATCHING_JOB', 'DEAL_ROOM', 'PROPERTY'
  )),
  subject_id uuid,
  -- What to CALL it in the job centre: a cadastral code, a filename, an
  -- address. Denormalised on purpose — the centre must not need five joins,
  -- and a label that changes later is cosmetic.
  subject_label text,

  state text not null default 'QUEUED' check (state in (
    'QUEUED', 'STARTING', 'CANCELLABLE', 'COMMITTED',
    'PROCESSING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),

  -- 0-100. Written by the worker from work actually finished, never from a
  -- timer (see §48 and src/verify/progress.ts for the same rule client-side).
  progress smallint not null default 0 check (progress between 0 and 100),
  current_stage text,

  /*
   * CHECKPOINTS.
   *
   * [{ "stage": "OFFICIAL", "at": "...", "ok": true }, ...]
   *
   * A Verify that failed in MARKET must resume at MARKET. Re-running IDENTITY
   * and OFFICIAL would buy registry lookups the customer has already paid for
   * once, which is the difference between a retry and a second purchase.
   */
  stages jsonb not null default '[]'::jsonb,

  /*
   * IDEMPOTENCY.
   *
   * A double-click, a refresh mid-start, or a retry while the original is
   * still running must not produce two jobs and two provider bills. The
   * partial unique index below makes a second start with the same key
   * impossible while the first is alive, and background_job_start() returns
   * the live one instead of raising.
   */
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  started_at timestamptz,

  -- now() + 15s at creation. The only thing that decides whether a customer
  -- may still cancel.
  cancel_deadline_at timestamptz not null default (now() + interval '15 seconds'),
  -- Stamped when external spend is authorised. Once set, never cleared.
  committed_at timestamptz,

  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,

  -- A worker that has said nothing for HEARTBEAT_STALE is presumed dead and
  -- swept by background_jobs_recover_stuck().
  last_heartbeat_at timestamptz,

  -- error_code is ours and internal. user_safe_error is a TRANSLATION KEY,
  -- never prose and never a provider message — see PART E §54.
  error_code text,
  user_safe_error text,

  attempt smallint not null default 0,
  next_retry_at timestamptz,
  last_error text,

  -- Where the finished thing is read. A stable in-app path, so a notification
  -- and the job centre open the same screen (§35).
  result_ref text,

  reservation_id uuid references public.usage_reservations(id) on delete set null,
  authorized_budget_credits numeric,

  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.background_jobs is
  'Durable registry of long-running user work. An INDEX over research_jobs / matching_jobs / deal_room_documents, not a replacement: it owns lifecycle, the cancellation deadline, heartbeat, checkpoints, idempotency and the billing reservation link, and nothing product-specific.';
comment on column public.background_jobs.cancel_deadline_at is
  'created_at + 15s. background_job_cancel() refuses after this instant regardless of what the client believes, because provider spend begins at it.';
comment on column public.background_jobs.user_safe_error is
  'A translation key. Never prose, never a provider or runtime message.';

create index if not exists background_jobs_user_active_idx
  on public.background_jobs (user_id, created_at desc)
  where state not in ('COMPLETED', 'FAILED', 'CANCELLED');

create index if not exists background_jobs_user_recent_idx
  on public.background_jobs (user_id, created_at desc);

create index if not exists background_jobs_subject_idx
  on public.background_jobs (subject_type, subject_id);

-- Only one LIVE job per key. A finished one does not block starting again.
create unique index if not exists background_jobs_idempotency_live_idx
  on public.background_jobs (user_id, product_type, idempotency_key)
  where state not in ('COMPLETED', 'FAILED', 'CANCELLED');

-- The stuck-job sweep's working set.
create index if not exists background_jobs_heartbeat_idx
  on public.background_jobs (last_heartbeat_at)
  where state in ('STARTING', 'COMMITTED', 'PROCESSING', 'PARTIAL');

create or replace function public.background_jobs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_background_jobs_touch on public.background_jobs;
create trigger trg_background_jobs_touch
  before update on public.background_jobs
  for each row execute function public.background_jobs_touch();

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Read your own; write nothing. Every transition goes through a function
-- below, because the fifteen-second rule is only a rule if a client cannot
-- reach around it with an UPDATE.

alter table public.background_jobs enable row level security;

drop policy if exists background_jobs_select_own on public.background_jobs;
create policy background_jobs_select_own on public.background_jobs
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policy exists for `authenticated` by design.

-- ── Effective state ────────────────────────────────────────────────────────
--
-- The stored state is what the worker last wrote. Whether the customer may
-- still cancel is a function of the CLOCK, and no worker tick is going to
-- fire at exactly the fifteen-second mark to write it down. Deriving it on
-- read means the button disappears at the same instant the server starts
-- refusing — rather than a second or a minute later, which is the window in
-- which a customer clicks cancel and is told no.

create or replace function public.background_job_can_cancel(j public.background_jobs)
returns boolean language sql stable as $$
  select j.state not in ('COMPLETED', 'FAILED', 'CANCELLED')
     and j.committed_at is null
     and now() < j.cancel_deadline_at;
$$;

create or replace function public.background_job_effective_state(j public.background_jobs)
returns text language sql stable as $$
  select case
    when j.state in ('COMPLETED', 'FAILED', 'CANCELLED') then j.state
    when j.committed_at is null and now() < j.cancel_deadline_at then 'CANCELLABLE'
    -- The deadline has passed but no worker has stamped a state yet. The
    -- honest word is COMMITTED: the customer can no longer stop it.
    when j.state in ('QUEUED', 'STARTING', 'CANCELLABLE') then 'COMMITTED'
    else j.state
  end;
$$;

/** The shape every client reads. Never exposes last_error or error_code. */
create or replace function public.background_job_public(j public.background_jobs)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', j.id,
    'productType', j.product_type,
    'subjectType', j.subject_type,
    'subjectId', j.subject_id,
    'subjectLabel', j.subject_label,
    'state', public.background_job_effective_state(j),
    'storedState', j.state,
    'canCancel', public.background_job_can_cancel(j),
    'progress', j.progress,
    'currentStage', j.current_stage,
    'stages', j.stages,
    'createdAt', j.created_at,
    'startedAt', j.started_at,
    'cancelDeadlineAt', j.cancel_deadline_at,
    'committedAt', j.committed_at,
    'completedAt', j.completed_at,
    'failedAt', j.failed_at,
    'cancelledAt', j.cancelled_at,
    'lastHeartbeatAt', j.last_heartbeat_at,
    'userSafeError', j.user_safe_error,
    'attempt', j.attempt,
    'resultRef', j.result_ref,
    'reservationId', j.reservation_id,
    'authorizedBudgetCredits', j.authorized_budget_credits,
    'metadata', j.metadata
  );
$$;

-- ── Starting ───────────────────────────────────────────────────────────────

create or replace function public.background_job_start(
  p_product_type text,
  p_subject_type text,
  p_idempotency_key text,
  p_subject_id uuid default null,
  p_subject_label text default null,
  p_result_ref text default null,
  p_reservation_id uuid default null,
  p_authorized_budget_credits numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_job public.background_jobs;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  /*
   * IDEMPOTENCY (§37).
   *
   * A double-click produces two calls a few milliseconds apart. Looking first
   * is not enough on its own — both can look before either inserts — so the
   * partial unique index is the real guarantee and this SELECT is the fast
   * path. The insert's own conflict is caught below and resolved the same way.
   */
  select * into v_job
    from public.background_jobs
   where user_id = v_user
     and product_type = p_product_type
     and idempotency_key = p_idempotency_key
     and state not in ('COMPLETED', 'FAILED', 'CANCELLED')
   limit 1;

  if found then
    return jsonb_build_object('job', public.background_job_public(v_job), 'created', false);
  end if;

  begin
    insert into public.background_jobs (
      user_id, product_type, subject_type, subject_id, subject_label,
      idempotency_key, result_ref, reservation_id, authorized_budget_credits,
      metadata, state, last_heartbeat_at
    ) values (
      v_user, p_product_type, p_subject_type, p_subject_id, p_subject_label,
      p_idempotency_key, p_result_ref, p_reservation_id, p_authorized_budget_credits,
      coalesce(p_metadata, '{}'::jsonb), 'QUEUED', now()
    )
    returning * into v_job;
  exception when unique_violation then
    -- Lost the race. The other caller's job is the answer, not an error.
    select * into v_job
      from public.background_jobs
     where user_id = v_user
       and product_type = p_product_type
       and idempotency_key = p_idempotency_key
       and state not in ('COMPLETED', 'FAILED', 'CANCELLED')
     limit 1;
    return jsonb_build_object('job', public.background_job_public(v_job), 'created', false);
  end;

  return jsonb_build_object('job', public.background_job_public(v_job), 'created', true);
end;
$$;

-- ── Cancelling: the fifteen-second rule ────────────────────────────────────

create or replace function public.background_job_cancel(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_job public.background_jobs;
  v_release_pending boolean := false;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Locked, because the decision is a read of the clock followed by a write,
  -- and a commit landing between the two would let a cancellation through
  -- after spend had started.
  select * into v_job from public.background_jobs
   where id = p_job_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  -- Someone else's job is not found, never forbidden: a distinguishable
  -- refusal is a way to ask whether a job id exists (§57).
  if v_job.user_id <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if v_job.state in ('COMPLETED', 'FAILED', 'CANCELLED') then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_FINISHED',
                              'state', v_job.state);
  end if;

  /*
   * THE REFUSAL.
   *
   * Past the deadline, or already committed, Homatch has begun paying a
   * provider for work the customer asked for. Letting them cancel here would
   * not undo that spend; it would only detach it from anything that could
   * settle it. The job must now finish or fail, and either way it settles
   * honestly (§27, §44).
   *
   * This check is why the button being hidden is not the mechanism.
   */
  if v_job.committed_at is not null or now() >= v_job.cancel_deadline_at then
    return jsonb_build_object(
      'ok', false,
      'reason', 'COMMITTED',
      'committedAt', v_job.committed_at,
      'cancelDeadlineAt', v_job.cancel_deadline_at
    );
  end if;

  /*
   * WHO IS ALLOWED TO GIVE CREDITS BACK.
   *
   * wallet_release() opens with `if auth.role() <> 'service_role' then raise
   * exception 'FORBIDDEN'`. That is a deliberate rule of the billing layer:
   * the wallet is never moved by a customer's own session, only by a worker.
   *
   * Calling it from here — which runs as the customer — is refused, and the
   * first version of this function did exactly that inside an exception
   * block, so the cancellation succeeded and the hold silently stayed on the
   * balance. That is the stuck reservation §44 exists to prevent, and it was
   * invisible until the acceptance run went through the real wallet.
   *
   * Impersonating service_role inside this SECURITY DEFINER function would
   * have worked and would have been wrong: one function's judgement standing
   * in for a rule the billing layer enforces everywhere else, ready to be
   * copied by the next person who needs a release.
   *
   * So the release is DEFERRED. Cancelling records what is owed and
   * background_jobs_release_cancelled() — called by jobs-worker with the
   * service key — settles it within thirty seconds through the ordinary path,
   * writing the ordinary ledger entry.
   *
   * No new state was added, because none is needed: a CANCELLED job whose
   * reservation is still RESERVED IS the outstanding release. Deriving it
   * means the queue cannot drift out of step with the jobs it describes.
   */
  if v_job.reservation_id is not null then
    select exists (
      select 1 from public.usage_reservations r
       where r.id = v_job.reservation_id and r.status = 'RESERVED'
    ) into v_release_pending;
  end if;

  update public.background_jobs
     set state = 'CANCELLED',
         cancelled_at = now(),
         current_stage = null,
         progress = 0
   where id = p_job_id
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'job', public.background_job_public(v_job),
    -- Nothing was bought, so nothing is owed; the credits come back on the
    -- worker's next tick.
    'releasePending', v_release_pending
  );
end;
$$;

-- ── Worker transitions ─────────────────────────────────────────────────────
--
-- Service role only. Called with the service key, auth.uid() is null; called
-- by a signed-in customer it is not, and these refuse. An admin may call them
-- deliberately (§45), and that is audited by admin_audit_log at the call site.

create or replace function public.background_jobs_assert_worker()
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'worker or admin only' using errcode = '42501';
  end if;
end;
$$;

/**
 * One call for "I am alive, here is where I am".
 *
 * Also stamps committed_at once the window has closed, which is what turns
 * the deadline from a client-side courtesy into a recorded fact.
 */
create or replace function public.background_job_progress(
  p_job_id uuid,
  p_state text default null,
  p_progress smallint default null,
  p_stage text default null,
  p_checkpoint text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_job public.background_jobs;
begin
  perform public.background_jobs_assert_worker();

  select * into v_job from public.background_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  -- A cancelled job is a stop signal to the worker, not a row to keep
  -- updating. Returning it tells the caller to put its tools down.
  if v_job.state in ('COMPLETED', 'FAILED', 'CANCELLED') then
    return jsonb_build_object('ok', false, 'reason', 'TERMINAL', 'state', v_job.state);
  end if;

  update public.background_jobs
     set state = coalesce(p_state, case when state in ('QUEUED','STARTING','CANCELLABLE')
                                        then 'PROCESSING' else state end),
         progress = coalesce(p_progress, progress),
         current_stage = coalesce(p_stage, current_stage),
         started_at = coalesce(started_at, now()),
         last_heartbeat_at = now(),
         -- Once the window has closed it is recorded, not merely derived.
         committed_at = case when committed_at is null and now() >= cancel_deadline_at
                             then now() else committed_at end,
         metadata = case when p_metadata is null then metadata else metadata || p_metadata end,
         stages = case
           when p_checkpoint is null then stages
           -- A stage is checkpointed once. A worker that re-reports one is
           -- resuming, not repeating.
           when stages @> jsonb_build_array(jsonb_build_object('stage', p_checkpoint)) then stages
           else stages || jsonb_build_array(
             jsonb_build_object('stage', p_checkpoint, 'at', now(), 'ok', true))
         end
   where id = p_job_id
  returning * into v_job;

  return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job));
end;
$$;

/** Terminal. COMPLETED, FAILED or CANCELLED, once. */
create or replace function public.background_job_finish(
  p_job_id uuid,
  p_state text,
  p_result_ref text default null,
  p_error_code text default null,
  p_user_safe_error text default null,
  p_last_error text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_job public.background_jobs;
begin
  perform public.background_jobs_assert_worker();

  if p_state not in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'background_job_finish requires a terminal state, got %', p_state;
  end if;

  select * into v_job from public.background_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_job.state in ('COMPLETED', 'FAILED', 'CANCELLED') then
    -- Finishing twice is a race, not an error. The first answer stands.
    return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job),
                              'alreadyTerminal', true);
  end if;

  update public.background_jobs
     set state = p_state,
         progress = case when p_state = 'COMPLETED' then 100 else progress end,
         result_ref = coalesce(p_result_ref, result_ref),
         error_code = p_error_code,
         user_safe_error = p_user_safe_error,
         last_error = p_last_error,
         completed_at = case when p_state = 'COMPLETED' then now() else completed_at end,
         failed_at = case when p_state = 'FAILED' then now() else failed_at end,
         cancelled_at = case when p_state = 'CANCELLED' then now() else cancelled_at end,
         last_heartbeat_at = now()
   where id = p_job_id
  returning * into v_job;

  return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job));
end;
$$;

-- ── Reading ────────────────────────────────────────────────────────────────

/**
 * App bootstrap (§51) and the job centre (§32), in one call.
 *
 * Everything still running, plus a short tail of finished work so a customer
 * who was on another page when their verification landed still sees that it
 * did (§34).
 */
create or replace function public.background_jobs_mine(
  p_recent_hours integer default 48,
  p_limit integer default 100
)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_agg(public.background_job_public(j) order by j.created_at desc), '[]'::jsonb)
    from (
      select * from public.background_jobs
       where user_id = auth.uid()
         and (state not in ('COMPLETED', 'FAILED', 'CANCELLED')
              or created_at > now() - make_interval(hours => greatest(p_recent_hours, 0)))
       order by created_at desc
       limit least(greatest(p_limit, 1), 500)
    ) j;
$$;

/** One job, for a screen that is watching a specific piece of work. */
create or replace function public.background_job_get(p_job_id uuid)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select coalesce(public.background_job_public(j), 'null'::jsonb)
    from public.background_jobs j
   where j.id = p_job_id
     and (j.user_id = auth.uid() or public.is_admin());
$$;

/** The live job for a subject, so a page can re-attach after a refresh. */
create or replace function public.background_job_for_subject(
  p_subject_type text,
  p_subject_id uuid
)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select coalesce(public.background_job_public(j), 'null'::jsonb)
    from public.background_jobs j
   where j.subject_type = p_subject_type
     and j.subject_id = p_subject_id
     and j.user_id = auth.uid()
   order by (j.state not in ('COMPLETED','FAILED','CANCELLED')) desc, j.created_at desc
   limit 1;
$$;

-- ── Stuck-job recovery (§47) ───────────────────────────────────────────────

/**
 * A worker that has said nothing for long enough is presumed dead.
 *
 * Deliberately generous, and deliberately conservative about what it does
 * next. A verification stage can spend minutes inside one provider call
 * without writing anything, so a short threshold would requeue jobs that were
 * merely thinking and buy the same research twice.
 *
 * A job that has not committed is safe to requeue: nothing was bought.
 * A committed one is marked for attention instead — it may have paid for work
 * whose result is sitting in the product table, and throwing that away to
 * start again is the expensive mistake. "Processing…" forever is not
 * acceptable either, so it stops being silent.
 */
create or replace function public.background_jobs_recover_stuck(
  p_stale_minutes integer default 5,
  p_limit integer default 50
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_requeued int := 0;
  v_flagged int := 0;
begin
  perform public.background_jobs_assert_worker();

  with stale as (
    select id, committed_at, attempt
      from public.background_jobs
     where state in ('STARTING', 'COMMITTED', 'PROCESSING', 'PARTIAL')
       and last_heartbeat_at is not null
       and last_heartbeat_at < now() - make_interval(mins => greatest(p_stale_minutes, 1))
     order by last_heartbeat_at asc
     limit least(greatest(p_limit, 1), 500)
  ),
  requeued as (
    update public.background_jobs b
       set state = 'QUEUED',
           attempt = b.attempt + 1,
           next_retry_at = now(),
           last_heartbeat_at = now(),
           last_error = 'worker heartbeat lost before commit'
      from stale s
     where b.id = s.id and s.committed_at is null and s.attempt < 3
    returning b.id
  ),
  flagged as (
    update public.background_jobs b
       set user_safe_error = 'job_needs_attention',
           error_code = 'HEARTBEAT_LOST',
           last_error = 'worker heartbeat lost after commit'
      from stale s
     where b.id = s.id
       and (s.committed_at is not null or s.attempt >= 3)
       and b.user_safe_error is null
    returning b.id
  )
  select (select count(*) from requeued), (select count(*) from flagged)
    into v_requeued, v_flagged;

  return jsonb_build_object('requeued', v_requeued, 'flagged', v_flagged);
end;
$$;

/**
 * What cancelling owes the wallet, derived rather than queued.
 *
 * Called by jobs-worker with the service key, which is the only role
 * wallet_release() accepts. wallet_sweep_expired_reservations remains the
 * hour-scale backstop beneath this.
 */
create or replace function public.background_jobs_release_cancelled(p_limit integer default 25)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_job record;
  v_released int := 0;
  v_failed int := 0;
begin
  perform public.background_jobs_assert_worker();

  for v_job in
    select b.id, b.reservation_id
      from public.background_jobs b
      join public.usage_reservations r on r.id = b.reservation_id
     where b.state = 'CANCELLED'
       and b.committed_at is null
       and r.status = 'RESERVED'
     order by b.cancelled_at asc
     limit least(greatest(p_limit, 1), 200)
  loop
    begin
      perform public.wallet_release(
        v_job.reservation_id,
        'JOB_CANCELLED_BEFORE_COMMIT',
        jsonb_build_object('jobId', v_job.id)
      );
      v_released := v_released + 1;
    exception when others then
      -- One reservation that will not release must not stop the rest.
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('released', v_released, 'failed', v_failed);
end;
$$;

-- ── Admin force actions (§45) ──────────────────────────────────────────────

/**
 * The emergency handle a normal user does not get.
 *
 * A COMMITTED job cannot be cancelled by its owner because spend has started.
 * It can still be stuck, and somebody has to be able to stop it — but that is
 * an audited operational decision, not a product feature.
 */
create or replace function public.background_job_admin_force(
  p_job_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_job public.background_jobs;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_action not in ('FORCE_FAIL', 'REQUEUE', 'RELEASE_RESERVATION') then
    raise exception 'unknown action %', p_action;
  end if;

  select * into v_job from public.background_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if p_action = 'FORCE_FAIL' then
    update public.background_jobs
       set state = 'FAILED', failed_at = now(),
           error_code = 'ADMIN_FORCE_FAIL',
           user_safe_error = 'job_stopped_by_support',
           last_error = coalesce(p_reason, 'forced by admin')
     where id = p_job_id returning * into v_job;

  elsif p_action = 'REQUEUE' then
    update public.background_jobs
       set state = 'QUEUED', attempt = attempt + 1, next_retry_at = now(),
           last_heartbeat_at = now(), user_safe_error = null, error_code = null,
           last_error = coalesce(p_reason, 'requeued by admin')
     where id = p_job_id returning * into v_job;

  elsif p_action = 'RELEASE_RESERVATION' then
    if v_job.reservation_id is not null
       and exists (select 1 from public.usage_reservations r
                    where r.id = v_job.reservation_id and r.status = 'RESERVED') then
      perform public.wallet_release(v_job.reservation_id,
        coalesce(p_reason, 'ADMIN_RELEASE'), jsonb_build_object('jobId', v_job.id));
    end if;
  end if;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (public.site_admin_id(), 'background_job_' || lower(p_action),
          'background_job', p_job_id::text,
          jsonb_build_object('reason', p_reason, 'state', v_job.state));

  return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job));
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────

revoke all on function public.background_job_start(text, text, text, uuid, text, text, uuid, numeric, jsonb) from public;
revoke all on function public.background_job_cancel(uuid) from public;
revoke all on function public.background_job_progress(uuid, text, smallint, text, text, jsonb) from public;
revoke all on function public.background_job_finish(uuid, text, text, text, text, text) from public;
revoke all on function public.background_jobs_mine(integer, integer) from public;
revoke all on function public.background_job_get(uuid) from public;
revoke all on function public.background_job_for_subject(text, uuid) from public;
revoke all on function public.background_jobs_recover_stuck(integer, integer) from public;
revoke all on function public.background_jobs_release_cancelled(integer) from public;
revoke all on function public.background_job_admin_force(uuid, text, text) from public;

-- What a signed-in customer may do: start their own work, stop it inside the
-- window, and read it. Nothing else.
grant execute on function public.background_job_start(text, text, text, uuid, text, text, uuid, numeric, jsonb) to authenticated;
grant execute on function public.background_job_cancel(uuid) to authenticated;
grant execute on function public.background_jobs_mine(integer, integer) to authenticated;
grant execute on function public.background_job_get(uuid) to authenticated;
grant execute on function public.background_job_for_subject(text, uuid) to authenticated;

-- Workers hold the service key, which bypasses grants; admins are named
-- explicitly so an operator can drive one by hand from the admin console.
grant execute on function public.background_job_progress(uuid, text, smallint, text, text, jsonb) to service_role;
grant execute on function public.background_job_finish(uuid, text, text, text, text, text) to service_role;
grant execute on function public.background_jobs_recover_stuck(integer, integer) to service_role;
grant execute on function public.background_jobs_release_cancelled(integer) to service_role;
grant execute on function public.background_job_admin_force(uuid, text, text) to authenticated, service_role;

-- ── Realtime ───────────────────────────────────────────────────────────────
--
-- So the job centre learns a stage changed without polling. RLS still applies
-- to the stream, so a customer only ever receives their own rows. Polling
-- remains the fallback and the job never depends on either (§46).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'background_jobs'
  ) then
    alter publication supabase_realtime add table public.background_jobs;
  end if;
end;
$$;

alter table public.background_jobs replica identity full;
