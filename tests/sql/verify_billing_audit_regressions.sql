-- Regression checks for the 2026-10-10 database audit of the Verify queue and
-- credit budget migrations (each block names the finding it guards).
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000000d1';
  ja uuid; jb uuid; jc uuid; jd uuid; je uuid;
  r jsonb; c jsonb; t jsonb; t2 jsonb; s text; n integer;
  usage constant jsonb := '{"identity":{"input_tokens":200000,"output_tokens":20000}}';
begin
  insert into public.credit_accounts (user_id, balance) values (u, 30);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type) values (u, 'PURCHASED', 30, 'TOPUP');
  insert into public.research_jobs (user_id) values (u) returning id into ja;
  insert into public.research_jobs (user_id) values (u) returning id into jb;
  insert into public.research_jobs (user_id) values (u) returning id into jc;
  insert into public.research_jobs (user_id) values (u) returning id into jd;
  insert into public.research_jobs (user_id) values (u) returning id into je;

  -- BLOCKER 1: the OpenAI finance rows for the same usage are not counted again.
  update public.research_jobs set result_json = jsonb_build_object('costUsage', usage) where id = ja;
  c := public.verify_job_cost(ja);
  insert into public.cost_events (provider, operation_type, cost_usd, job_id, pricing_state) values ('OPENAI', 'VERIFY_IDENTITY', 0.64, ja, 'ESTIMATED');
  if (public.verify_job_cost(ja)->>'rawUsd')::numeric <> (c->>'rawUsd')::numeric then raise exception 'B1: AI counted twice %', public.verify_job_cost(ja); end if;
  -- The developer-ads Actor still counts.
  insert into public.cost_events (provider, operation_type, cost_usd, job_id, pricing_state) values ('APIFY_MEMO23', 'DEVELOPER_ADS_VERIFY', 0.10, ja, 'ACTUAL');
  if (public.verify_job_cost(ja)->>'rawUsd')::numeric <> (c->>'rawUsd')::numeric + 0.10 then raise exception 'B1: actor not counted'; end if;

  -- HIGH 4b: a PARTIAL provider cost is a counted floor AND flagged.
  insert into public.cost_events (provider, operation_type, cost_usd, job_id, pricing_state) values ('APIFY_MEMO23', 'DEVELOPER_ADS_VERIFY', 0.40, jb, 'PARTIAL');
  c := public.verify_job_cost(jb);
  if (c->>'rawUsd')::numeric <> 0.40 or c->>'state' <> 'PARTIAL' then raise exception 'H4b: %', c; end if;

  -- HIGH 4a: an unknown CAPTCHA cost is never a priced zero.
  perform public.verify_captcha_record('a4-1', null, jc, 'mygov', 'ACCEPTED', null);
  if (select cost_usd from public.verify_captcha_events where idempotency_key = 'a4-1') is not null then raise exception 'H4a: stored as 0'; end if;
  c := public.verify_job_cost(jc);
  if not exists (select 1 from jsonb_array_elements(c->'lines') l where l->>'kind' = 'CAPTCHA' and l->>'state' = 'FALLBACK' and (l->>'usd')::numeric = 0.003) then raise exception 'H4a: %', c; end if;
  perform public.verify_captcha_record('a4-2', null, jc, 'mygov', 'ACCEPTED', -5);
  if (select cost_usd from public.verify_captcha_events where idempotency_key = 'a4-2') is not null then raise exception 'H4a: negative stored'; end if;

  -- HIGH 2: a refused authorisation is not kept; a retry does not add it twice.
  update public.credit_accounts set balance = 0 where user_id = u;
  r := public.verify_billing_open(jd, u, 'verify:' || jd || ':s1');
  if r->>'reason' <> 'INSUFFICIENT_CREDITS' then raise exception 'H2: %', r; end if;
  r := public.verify_billing_open(jd, u, 'verify:' || jd || ':s1');
  if exists (select 1 from public.verify_billing where job_id = jd) then raise exception 'H2: billing row left behind (authorised %)', (select authorized_total_credits from public.verify_billing where job_id = jd); end if;
  update public.credit_accounts set balance = 30 where user_id = u;

  -- LOW: billing history is not cascade-deleted with its job.
  perform public.verify_billing_open(je, u, 'verify:' || je || ':s1');
  begin
    delete from public.research_jobs where id = je;
    raise exception 'L: job with billing deleted';
  exception when foreign_key_violation then null;
  end;

  -- MEDIUM 5: a system failure releases even when pricing cannot be computed.
  update public.research_jobs set result_json = '{"_cost":{"identity":{"input_tokens":"garbage","output_tokens":{"x":1}}}}' where id = je;
  r := public.verify_billing_close(je, 'SYSTEM_FAILED');
  if (r->>'released')::numeric <> 25 then raise exception 'M5: %', r; end if;
  if (select balance from public.credit_accounts where user_id = u) <> 30 then raise exception 'M5: money held'; end if;

  -- MEDIUM 7: work done while the job was paused is not billed to it.
  update public.research_jobs set result_json = jsonb_build_object('_pauseHistory', jsonb_build_array(
    jsonb_build_object('at', (now() - interval '1 hour')::text, 'resumedAt', (now() + interval '1 hour')::text))) where id = jb;
  if (public.verify_job_cost(jb)->>'rawUsd')::numeric <> 0 then raise exception 'M7: paused-time cost billed %', public.verify_job_cost(jb); end if;

  -- HIGH 3: a stopped job's task never returns to the queue holding the scope.
  -- Only this check's tasks are claimable (the suites share one database).
  update public.verify_tasks set run_after = now() + interval '1 day' where state = 'QUEUED';
  t := public.verify_task_enqueue(ja, 'mygov', 'mygov', 'mygov:H3', '{}');
  t := (select x from public.verify_task_claim('w-h3', array['HTTP'], 1) x limit 1);
  perform public.verify_job_cancel_tasks(ja);
  if not public.verify_task_release((t->>'id')::uuid, (t->>'fencingToken')::bigint) then raise exception 'H3: release refused'; end if;
  select state into s from public.verify_tasks where id = (t->>'id')::uuid;
  if s <> 'CANCELLED' then raise exception 'H3: released to %', s; end if;
  t2 := public.verify_task_enqueue(jb, 'mygov', 'mygov', 'mygov:H3', '{}');
  if t2->>'state' <> 'QUEUED' then raise exception 'H3: scope still held (%)', t2->>'state'; end if;
  -- A follower arriving for a stopped producer revives it instead of waiting forever.
  t := (select x from public.verify_task_claim('w-h3b', array['HTTP'], 1) x limit 1);
  perform public.verify_job_cancel_tasks(jb);
  if not (select cancel_requested from public.verify_tasks where id = (t->>'id')::uuid) then raise exception 'H3: not cancel-requested'; end if;
  t2 := public.verify_task_enqueue(jc, 'mygov', 'mygov', 'mygov:H3', '{}');
  if t2->>'state' <> 'WAITING_SHARED' or (select cancel_requested from public.verify_tasks where id = (t->>'id')::uuid) then raise exception 'H3: producer not revived'; end if;
  -- A cancelled producer whose lease expires is closed, its follower inherits.
  update public.verify_tasks set cancel_requested = true, lease_expires_at = now() - interval '1 minute' where id = (t->>'id')::uuid;
  perform public.verify_task_recover_expired(10);
  if (select state from public.verify_tasks where id = (t->>'id')::uuid) <> 'CANCELLED' then raise exception 'H3: expired cancelled task requeued'; end if;
  if (select state from public.verify_tasks where id = (t2->>'id')::uuid) <> 'QUEUED' then raise exception 'H3: follower did not inherit'; end if;

  raise notice 'verify billing audit regressions: all checks passed';
end;
$$;
