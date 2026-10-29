-- Verify: recover a report whose synthesis failed for a reason that was not the job's.
--
-- 2026-10-29: verify-synthesis failed to BOOT in production (it imported an export that
-- did not exist; fixed in the same release as this migration). The driver's four
-- synthesis attempts were spent on boot errors, so job 674df06e-8de2-4d8e-b7ed-777f80ddd228
-- (cadastral code 01.16.06.039.039, owner admin preview, engine V2) is COMPLETE with all
-- research and official evidence stored, synthesis_state FAILED and no report. No model
-- call was made in those attempts (the function never started), so nothing was paid.
--
-- 1. admin_verify_retry_synthesis(job, reason): an audited Admin action that gives such a
--    job its synthesis budget back. It only acts on a finished job (status COMPLETE) with
--    NO report (synthesis_json is null) and synthesis FAILED; it never touches research,
--    evidence, billing or usage rows. The research-agent driver then builds the report from
--    the stored evidence exactly as for any job (one build, same model routing, same
--    idempotent cost rows). Research is never re-run by this path.
-- 2. The one job known to be affected is recovered by the NEXT migration, applied only
--    after the fixed verify-synthesis is deployed (the driver retries every 30 s, so
--    resetting it while the broken bundle still runs would spend the budget again).
--
-- Additive.

create or replace function public.admin_verify_retry_synthesis(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job record;
  v_admin uuid;
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
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), v_job.user_id,
          'VERIFY_SYNTHESIS_RETRY', 'research_jobs', p_job_id::text,
          jsonb_build_object('previous_attempts', v_job.synthesis_attempts, 'reason', btrim(p_reason), 'at', now()));
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'previousAttempts', v_job.synthesis_attempts);
end $$;
revoke all on function public.admin_verify_retry_synthesis(uuid, text) from public, anon;
grant execute on function public.admin_verify_retry_synthesis(uuid, text) to authenticated, service_role;
