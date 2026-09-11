-- jobs-worker could dispatch the same document analysis twice.
--
-- driveDocuments() selected QUEUED jobs and then "claimed" each one with
-- background_job_progress(). The comment above it said two overlapping ticks
-- must not both invoke the analyser. The code did not achieve that:
-- background_job_progress() succeeds for ANY non-terminal job, so two ticks
-- that both read the row while it was still QUEUED both "claimed" it and both
-- dispatched.
--
-- Observed in production on 2026-09-11, two ticks 21 seconds apart:
--
--   22:11:44  ANALYSIS_STARTED {worker:true}   -> 13 clauses, settled INCLUDED
--   22:12:05  ANALYSIS_STARTED {worker:true}   ->  9 clauses, settled PAYG 0.34
--
-- One document, read twice, for one customer. The wallet arithmetic was
-- correct throughout -- 9.60 held, 0.34 charged, 9.26 released -- but the
-- customer spent their one included Contract Intelligence of the month AND
-- 0.34 Credits on the same file, and Homatch paid OpenAI twice (0.84c then
-- 0.67c). Idempotency in the billing layer could not save it: the first run
-- took the included allowance and the second fell through to PAYG, so the two
-- never met at the same reservation key.
--
-- A claim has to be a COMPARE AND SWAP. This one updates only while the row
-- is still QUEUED, so exactly one caller can win no matter how many read it
-- first -- the same shape as research-agent's claimJob(), which has guarded
-- the Verify driver against precisely this since it was written.

create or replace function public.background_job_claim(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_job public.background_jobs;
begin
  perform public.background_jobs_assert_worker();

  -- The whole point: `and state = 'QUEUED'` inside the UPDATE. A second
  -- caller matches no row and is told so, rather than being handed a job
  -- somebody else is already running.
  update public.background_jobs
     set state = 'PROCESSING',
         current_stage = 'EXTRACTING',
         started_at = coalesce(started_at, now()),
         last_heartbeat_at = now(),
         progress = greatest(progress, 10),
         committed_at = case when committed_at is null and now() >= cancel_deadline_at
                             then now() else committed_at end
   where id = p_job_id
     and state = 'QUEUED'
  returning * into v_job;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  end if;

  return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job));
end;
$$;

revoke all on function public.background_job_claim(uuid) from public;
revoke execute on function public.background_job_claim(uuid) from anon, authenticated;
grant execute on function public.background_job_claim(uuid) to service_role;
