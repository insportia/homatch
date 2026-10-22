\set ON_ERROR_STOP on
-- 20261120090000: a finished VERIFY job carries a terminal stage, written once,
-- in the same UPDATE that makes it terminal. Other products are untouched.
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000000e1';
  v_verify uuid; v_doc uuid; v_fail uuid; r jsonb; j record;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.background_jobs (user_id, product_type, subject_type, idempotency_key, current_stage, stages, state)
  values (u, 'VERIFY', 'RESEARCH_JOB', 'verify:t1', 'REPORT_WRITING',
          '[{"stage":"SYNTHESIS_WAITING","at":"2026-10-22T12:09:16Z","ok":true},{"stage":"REPORT_WRITING","at":"2026-10-22T12:10:46Z","ok":true}]', 'PROCESSING')
  returning id into v_verify;
  insert into public.background_jobs (user_id, product_type, subject_type, idempotency_key, current_stage, state)
  values (u, 'DOCUMENT_ANALYSIS', 'DOCUMENT', 'doc:t1', 'RUNNING', 'PROCESSING') returning id into v_doc;
  insert into public.background_jobs (user_id, product_type, subject_type, idempotency_key, current_stage, state)
  values (u, 'VERIFY', 'RESEARCH_JOB', 'verify:t2', 'REPORT_WRITING', 'PROCESSING') returning id into v_fail;

  /* success: COMPLETED + COMPLETE + one stage entry */
  r := public.background_job_finish(v_verify, 'COMPLETED', '/verify?job=x');
  assert (r->>'ok')::boolean and r->'alreadyTerminal' is null, 'first finish: ' || r::text;
  select * into j from public.background_jobs where id = v_verify;
  assert j.state = 'COMPLETED' and j.current_stage = 'COMPLETE' and j.progress = 100, 'terminal stage: ' || j.current_stage;
  assert jsonb_array_length(j.stages) = 3 and j.stages->2->>'stage' = 'COMPLETE' and (j.stages->2->>'ok')::boolean, 'appended once: ' || j.stages::text;

  /* re-mirror / retry of an already-terminal job: a no-op, never a second entry */
  r := public.background_job_finish(v_verify, 'COMPLETED', '/verify?job=x');
  assert (r->>'alreadyTerminal')::boolean, 'second finish is alreadyTerminal';
  r := public.background_job_finish(v_verify, 'FAILED', null, 'SUBJECT_FAILED', 'verify_result_failed');
  assert (r->>'alreadyTerminal')::boolean, 'a later FAILED cannot overwrite COMPLETED';
  select * into j from public.background_jobs where id = v_verify;
  assert j.state = 'COMPLETED' and j.current_stage = 'COMPLETE' and jsonb_array_length(j.stages) = 3, 'unchanged: ' || j.stages::text;

  /* report failed after the last attempt: FAILED + FAILED, ok=false */
  r := public.background_job_finish(v_fail, 'FAILED', null, 'SUBJECT_FAILED', 'verify_result_failed');
  select * into j from public.background_jobs where id = v_fail;
  assert j.state = 'FAILED' and j.current_stage = 'FAILED' and j.user_safe_error = 'verify_result_failed', 'failed: ' || j::text;
  assert jsonb_array_length(j.stages) = 1 and not (j.stages->0->>'ok')::boolean, 'failed stage entry: ' || j.stages::text;

  /* another product: exactly as before (stage and history untouched) */
  r := public.background_job_finish(v_doc, 'COMPLETED');
  select * into j from public.background_jobs where id = v_doc;
  assert j.state = 'COMPLETED' and j.current_stage = 'RUNNING' and j.stages = '[]'::jsonb, 'document job unchanged: ' || j::text;

  /* still a worker-only RPC */
  perform set_config('test.role', 'authenticated', true);
  begin
    perform public.background_job_finish(v_fail, 'COMPLETED');
    assert false, 'a customer must not finish a job';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.role', '', true);
end $$;
