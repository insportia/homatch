-- Verify: a recovered report must not stay FAILED in the customer's Job Center.
--
-- Production 2026-10-29/30: report 674df06e failed to synthesise (verify-synthesis
-- could not boot), its background_jobs row (dee307b2) was finished FAILED and the
-- customer was told so. The report was then recovered (20261208100100) and is READY,
-- with the "ready" notification sent, but the Job Center still reads FAILED: the
-- jobs-worker mirror only refreshes non-terminal rows, and background_job_finish
-- treats a second terminal write as a race. The same happens after every
-- admin_verify_retry_synthesis (20261208100000) of a job that had already failed.
--
-- 1. admin_verify_retry_synthesis also reopens the job's VERIFY background_jobs row
--    (FAILED -> PROCESSING at REPORT_WRITING, error fields cleared). The existing mirror
--    then finishes it from the report outcome: COMPLETED when READY, FAILED again after
--    the last attempt. No new notification is possible on reopening (the outbox trigger
--    fires on COMPLETED/FAILED only), a COMPLETED notice shares the dedupe key
--    verify-complete:<job> with verify-synthesis's own, and a second failure is the same
--    (job_id, terminal_state) outbox row, which is ignored.
-- 2. Once: every VERIFY background_jobs row still FAILED whose research job now has a
--    READY report is finished COMPLETED (production: exactly one row, dee307b2).
--
-- Billing is untouched: the release made when the report first failed stands (no charge),
-- and nothing here reserves, captures or refunds. Idempotent.

create or replace function public.admin_verify_retry_synthesis(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job record;
  v_admin uuid;
  v_reopened integer;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select id, status, synthesis_state, synthesis_attempts, synthesis_json is null as no_report, user_id
    into v_job from public.research_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  if v_job.status <> 'COMPLETE' or not v_job.no_report or coalesce(v_job.synthesis_state, '') <> 'FAILED' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_RECOVERABLE',
      'status', v_job.status, 'synthesisState', v_job.synthesis_state, 'hasReport', not v_job.no_report);
  end if;
  update public.research_jobs
     set synthesis_state = 'NONE', synthesis_attempts = 0, synthesis_at = null
   where id = p_job_id;
  -- The customer's Job Center follows the report again (the mirror finishes it).
  update public.background_jobs
     set state = 'PROCESSING', current_stage = 'REPORT_WRITING', progress = 95,
         failed_at = null, error_code = null, user_safe_error = null, last_error = null,
         last_heartbeat_at = now()
   where product_type = 'VERIFY' and subject_type = 'RESEARCH_JOB' and subject_id = p_job_id and state = 'FAILED';
  get diagnostics v_reopened = row_count;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), v_job.user_id,
          'VERIFY_SYNTHESIS_RETRY', 'research_jobs', p_job_id::text,
          jsonb_build_object('previous_attempts', v_job.synthesis_attempts, 'reason', btrim(p_reason), 'at', now(),
                             'job_center_reopened', v_reopened));
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'previousAttempts', v_job.synthesis_attempts,
                            'jobCenterReopened', v_reopened);
end $$;
revoke all on function public.admin_verify_retry_synthesis(uuid, text) from public, anon;
grant execute on function public.admin_verify_retry_synthesis(uuid, text) to authenticated, service_role;

-- Once: rows already recovered (their report is READY) read COMPLETED, with the stage kept.
with fixed as (
  update public.background_jobs b
     set state = 'COMPLETED', progress = 100, current_stage = 'COMPLETE',
         error_code = null, user_safe_error = null, last_error = null,
         completed_at = coalesce(r.synthesis_at, now()), last_heartbeat_at = now(),
         stages = case when b.stages @> jsonb_build_array(jsonb_build_object('stage', 'COMPLETE')) then b.stages
                       else b.stages || jsonb_build_array(jsonb_build_object('stage', 'COMPLETE', 'at', now(), 'ok', true)) end
    from public.research_jobs r
   where b.product_type = 'VERIFY' and b.subject_type = 'RESEARCH_JOB' and b.state = 'FAILED'
     and r.id = b.subject_id and r.synthesis_state = 'READY' and r.synthesis_json is not null
  returning b.id, b.subject_id, r.user_id
)
insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
select '00000000-0000-0000-0000-000000000000'::uuid, f.user_id, 'VERIFY_JOB_CENTER_RECONCILED', 'background_jobs', f.id::text,
       jsonb_build_object('research_job', f.subject_id, 'from', 'FAILED', 'to', 'COMPLETED',
                          'reason', 'report recovered and READY', 'request_id', 'migration:20261208140000', 'at', now())
  from fixed f;
