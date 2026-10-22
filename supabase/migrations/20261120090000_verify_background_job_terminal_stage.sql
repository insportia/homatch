-- A FINISHED VERIFY JOB KEPT SAYING "WRITING THE REPORT".
--
-- background_job_finish() changed state, progress and the timestamps, and
-- never touched current_stage. The stage a Verify job was last mirrored at
-- therefore stayed on the row for ever: every completed Verify in production
-- read state COMPLETED with current_stage SYNTHESIS_WAITING (e.g. background
-- job 0015e291-1323-48c0-a4b8-287a9668f9fd), and the stage history ended at
-- a stage the job had left.
--
-- Now the terminal transition of a VERIFY job also writes a terminal stage
-- (COMPLETE / FAILED / CANCELLED) and appends it to `stages`, in the same
-- UPDATE that makes the job terminal. Same signature, same return shape.
--
-- Scoped to product_type = 'VERIFY'. Every other product's finish is
-- byte-for-byte what it was: nothing it writes changes, so no other screen or
-- worker can notice this migration.
--
-- Idempotent and race-safe by the existing construction: the row is locked
-- FOR UPDATE, and a job that is already terminal returns alreadyTerminal
-- before anything is written. Two finishes therefore produce one terminal
-- state and one stage entry; a re-mirror of a finished job writes nothing.
-- The append is also guarded by containment, so a stage that is somehow
-- already present is never duplicated.
--
-- Historical rows are NOT rewritten. Readers treat a terminal state as
-- authoritative over a stale stage (src/jobs/jobState.ts presentableStage).

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
  v_stage text;
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

  -- Verify only: the stage a finished job keeps. Null leaves every other
  -- product exactly as before.
  v_stage := case when v_job.product_type = 'VERIFY' then
               case p_state when 'COMPLETED' then 'COMPLETE' else p_state end
             end;

  update public.background_jobs
     set state = p_state,
         progress = case when p_state = 'COMPLETED' then 100 else progress end,
         current_stage = coalesce(v_stage, current_stage),
         stages = case
           when v_stage is null then stages
           when stages @> jsonb_build_array(jsonb_build_object('stage', v_stage)) then stages
           else stages || jsonb_build_array(
             jsonb_build_object('stage', v_stage, 'at', now(), 'ok', p_state = 'COMPLETED'))
         end,
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

-- CREATE OR REPLACE keeps the existing grants; restated so the worker RPC can
-- never become callable by anon/authenticated through this migration
-- (20260911213925_background_jobs_worker_guard_checks_role_not_uid.sql).
revoke execute on function public.background_job_finish(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.background_job_finish(uuid, text, text, text, text, text) to service_role;
