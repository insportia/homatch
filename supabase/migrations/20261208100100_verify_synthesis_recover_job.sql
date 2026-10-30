-- Verify: recover the one report lost to the verify-synthesis boot failure (2026-10-29).
--
-- Job 674df06e-8de2-4d8e-b7ed-777f80ddd228 (cadastral code 01.16.06.039.039, admin preview,
-- engine V2) finished its research and stored all evidence; its four synthesis attempts
-- were spent on a function that could not boot, so no model call was made and no report
-- exists. Applied only after the fixed verify-synthesis is deployed and proven to boot.
--
-- Same effect as admin_verify_retry_synthesis (20261208100000), written directly because a
-- migration has no Admin session: the synthesis budget is given back and the driver builds
-- the report from the stored evidence. Research, evidence, billing and usage rows are not
-- touched. It acts only while the job is still COMPLETE with no report and FAILED
-- synthesis, so re-applying it changes nothing.

with recovered as (
  update public.research_jobs
     set synthesis_state = 'NONE', synthesis_attempts = 0, synthesis_at = null
   where id = '674df06e-8de2-4d8e-b7ed-777f80ddd228'
     and status = 'COMPLETE' and synthesis_json is null and synthesis_state = 'FAILED'
  returning id, user_id
)
insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
select '00000000-0000-0000-0000-000000000000'::uuid, r.user_id, 'VERIFY_SYNTHESIS_RETRY', 'research_jobs', r.id::text,
       jsonb_build_object('previous_attempts', 4, 'reason', 'verify-synthesis boot failure 2026-10-29',
                          'request_id', 'migration:20261208100100', 'at', now())
  from recovered r;
