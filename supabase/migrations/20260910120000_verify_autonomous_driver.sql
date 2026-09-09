-- HOMATCH VERIFY — make the research pipeline run without a browser.
--
-- WHY THIS EXISTS
--
-- research-agent's `status` action was the engine. Its handler ran
--
--   if (!['COMPLETE','FAILED','WAITING_HUMAN'].includes(j.status)) await advance(...)
--
-- so the state machine only ever stepped when a client polled it. Close the
-- tab and the job froze mid-flight, forever, in a non-terminal state with no
-- report and no error. That is not a hypothesis: research_jobs holds
-- 2aa12895-9c2e-49ed-b8ad-c7ebb37c4125 (CREATED/BROWSER_WAITING, last touched
-- 2026-09-08 08:24) and 533a8c19-f160-4f06-ab27-517c1f661b86 (same, last
-- touched 2026-09-08 04:29) — both abandoned exactly when their client went
-- away, neither recoverable by anything in the system.
--
-- Synthesis had the same shape and was worse: nothing server-side ever called
-- verify-synthesis at all. The report existed only because a browser happened
-- to be watching at the moment research finished.
--
-- WHAT THIS ADDS
--
-- Columns only — no drops, no rewrites, no data loss. Every one is nullable
-- or defaulted, so existing rows and the running deployment stay valid.
--
--   synthesis_json      the persisted Buyer Intelligence report. Its presence
--                       is what "the report is ready" means from now on.
--   synthesis_state     NONE -> PENDING -> READY | FAILED
--   synthesis_attempts  bounded retry budget (see §54: research must never be
--                       re-run because synthesis failed)
--   synthesis_at        when the persisted report was written
--   cancelled_at        explicit user cancellation, which is NOT failure
--   driver_claimed_at   short-lived claim so the cron driver and a connected
--                       client never advance the same job at the same moment

alter table public.research_jobs
  add column if not exists synthesis_json     jsonb,
  add column if not exists synthesis_state    text        not null default 'NONE',
  add column if not exists synthesis_attempts integer     not null default 0,
  add column if not exists synthesis_at       timestamptz,
  add column if not exists cancelled_at       timestamptz,
  add column if not exists driver_claimed_at  timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.research_jobs'::regclass
      and conname  = 'research_jobs_synthesis_state_ck'
  ) then
    alter table public.research_jobs
      add constraint research_jobs_synthesis_state_ck
      check (synthesis_state in ('NONE','PENDING','READY','FAILED'));
  end if;
end $$;

-- The driver's sweep is "live jobs, oldest heartbeat first". Without this it
-- is a seq scan on every tick.
create index if not exists research_jobs_driver_sweep_idx
  on public.research_jobs (status, updated_at)
  where deleted_at is null;

-- Finding COMPLETE jobs whose report was never built.
create index if not exists research_jobs_synthesis_pending_idx
  on public.research_jobs (synthesis_state, completed_at)
  where deleted_at is null;

comment on column public.research_jobs.synthesis_json is
  'Persisted Buyer Intelligence report. Written once by the server; re-read on every subsequent view so returning to a finished case never re-runs the model.';
comment on column public.research_jobs.cancelled_at is
  'Set only by an explicit user "კვლევის შეწყვეტა". Closing the browser is not cancellation.';
