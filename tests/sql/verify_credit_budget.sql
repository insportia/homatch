-- Verify credit budget: behaviour checks against the real wallet functions.
-- Run on a scratch database: verify_durable_execution_fixture.sql, the queue
-- migration, verify_credit_budget_fixture.sql, the budget migration, then this.
do $$
declare
  u1 uuid := '00000000-0000-4000-8000-0000000000b1';
  u2 uuid := '00000000-0000-4000-8000-0000000000b2';
  u3 uuid := '00000000-0000-4000-8000-0000000000b3';
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; j6 uuid; j7 uuid;
  r jsonb; s jsonb; p jsonb; c jsonb;
  bal numeric; n integer; charged1 numeric; charged2 numeric; charged_j1 numeric;
  usage1 constant jsonb := '{"identity":{"input_tokens":200000,"output_tokens":20000,"input_tokens_details":{"cached_tokens":0}}}';
  usage2 constant jsonb := '{"identity":{"input_tokens":200000,"output_tokens":20000,"input_tokens_details":{"cached_tokens":0}},
                              "official_collection":{"input_tokens":300000,"output_tokens":30000,"input_tokens_details":{"cached_tokens":100000}}}';
begin
  -- Wallets: u1 100 credits, u2 10 credits, u3 100 credits on VIP.
  insert into public.users (id, auth_id) values (u1, u1), (u2, u2), (u3, u3);
  insert into public.credit_accounts (user_id, balance) values (u1, 200), (u2, 10), (u3, 100);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type) values (u1, 'PURCHASED', 200, 'TOPUP'), (u2, 'PURCHASED', 10, 'TOPUP'), (u3, 'PURCHASED', 100, 'TOPUP');
  insert into public.user_subscriptions values (u3, 'VIP', 'ACTIVE', now() + interval '20 days');
  insert into public.research_jobs (user_id) values (u1) returning id into j1;
  insert into public.research_jobs (user_id) values (u1) returning id into j2;
  insert into public.research_jobs (user_id) values (u2) returning id into j3;
  insert into public.research_jobs (user_id) values (u1) returning id into j4;
  insert into public.research_jobs (user_id) values (u3) returning id into j5;
  insert into public.research_jobs (user_id) values (u1) returning id into j6;
  insert into public.research_jobs (user_id) values (u1) returning id into j7;

  -- 1. The price: (landed + 10 % contingency) / (1 − 55 %) + 18 % VAT, rounded UP.
  p := public.verify_price_for_cost(100);
  if (p->>'contingencyCents')::numeric <> 10 or (p->>'netCents')::numeric <> 244.4444 or (p->>'vatCents')::numeric <> 44.0000
     or (p->>'grossCents')::numeric <> 288.4444 or (p->>'credits')::numeric <> 28.85 then
    raise exception '1: price %', p;
  end if;
  -- 55 % of VAT-exclusive revenue is margin over landed + contingency.
  if round(1 - (100 + 10) / (p->>'netCents')::numeric, 4) <> 0.5500 then raise exception '1: margin'; end if;
  if (public.verify_price_for_cost(0)->>'credits')::numeric <> 0 then raise exception '1: zero cost is zero'; end if;

  -- 2. Exactly 25 credits reserved at start; nothing charged yet.
  r := public.verify_billing_open(j1, u1, 'verify:' || j1 || ':s1');
  if not (r->>'ok')::boolean or (r->>'reservedCredits')::numeric <> 25 then raise exception '2: %', r; end if;
  select balance into bal from public.credit_accounts where user_id = u1;
  if bal <> 175 then raise exception '2: balance %', bal; end if;
  if (select count(*) from public.credit_ledger where user_id = u1 and type = 'SERVICE_RESERVE' and amount = -25) <> 1 then raise exception '2: ledger'; end if;

  -- 3. Duplicate / double-click: same key, or any key while a session is open → the same session.
  r := public.verify_billing_open(j1, u1, 'verify:' || j1 || ':s1');
  if not (r->>'duplicate')::boolean then raise exception '3: same key'; end if;
  r := public.verify_billing_open(j1, u1, 'verify:' || j1 || ':other');
  if not (r->>'duplicate')::boolean then raise exception '3: other key'; end if;
  select balance into bal from public.credit_accounts where user_id = u1;
  if bal <> 175 then raise exception '3: held twice (%)', bal; end if;
  begin
    perform public.verify_billing_open(j1, u2, 'verify:' || j1 || ':intruder');
    raise exception '3: another user opened this job';
  exception when others then if sqlerrm not like '%JOB_NOT_OWNED%' then raise; end if;
  end;

  -- 4. Live usage comes from metered usage, priced now.
  s := public.verify_billing_state(j1);
  if (s->>'accrued')::numeric <> 0 or (s->>'remaining')::numeric <> 25 or s->>'usageState' <> 'LIVE' then raise exception '4: idle %', s; end if;
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1, '_searches', '{"identity":3}'::jsonb) where id = j1;
  c := public.verify_job_cost(j1);
  -- 200k × $2/M + 20k × $12/M + 3 × $0.01 = 0.40 + 0.24 + 0.03 = $0.67 → eligible cost 67 ¢ (VAT once, on the price)
  if (c->>'rawUsd')::numeric <> 0.67 or (c->>'landedCents')::numeric <> 67 then raise exception '4: cost %', c; end if;
  s := public.verify_billing_state(j1);
  p := public.verify_price_for_cost(67);
  if (s->>'accrued')::numeric <> (p->>'credits')::numeric then raise exception '4: accrued % vs %', s, p; end if;
  if (s->>'used')::numeric + (s->>'remaining')::numeric <> 25 then raise exception '4: used + remaining %', s; end if;

  -- 5. Settles below the maximum; the rest goes back. Idempotent.
  r := public.verify_billing_close(j1, 'COMPLETE');
  charged1 := (r->>'charged')::numeric; charged_j1 := charged1;
  -- A completed report is priced with the $1 floor (67 ¢ + $1 > 67 ¢ × 1.1 / 0.45).
  p := public.verify_price_for_cost(67, true);
  if charged1 <> (p->>'credits')::numeric or charged1 <> 19.71 or (r->>'released')::numeric <> 25 - charged1 then raise exception '5: %', r; end if;
  select balance into bal from public.credit_accounts where user_id = u1;
  if bal <> 200 - charged1 then raise exception '5: balance %', bal; end if;
  r := public.verify_billing_close(j1, 'COMPLETE');
  if not (r->>'duplicate')::boolean then raise exception '5: second settle'; end if;
  select balance into bal from public.credit_accounts where user_id = u1;
  if bal <> 200 - charged1 then raise exception '5: second settle moved money'; end if;
  if (select count(*) from public.usage_events where reservation_id = (select reservation_id from public.verify_billing_sessions where job_id = j1)) <> 1 then
    raise exception '5: usage event count';
  end if;

  -- 6. A run that costs more than the budget is charged exactly the cap; HOMATCH absorbs the rest.
  perform public.verify_billing_open(j2, u1, 'verify:' || j2 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', jsonb_build_object('identity',
    jsonb_build_object('input_tokens', 20000000, 'output_tokens', 2000000))) where id = j2;
  r := public.verify_billing_close(j2, 'COMPLETE');
  if (r->>'charged')::numeric <> 25 or (r->>'released')::numeric <> 0 then raise exception '6: %', r; end if;
  if (select charged_total_credits from public.verify_billing where job_id = j2) <> 25 then raise exception '6: total'; end if;
  if (select needs_review from public.verify_billing where job_id = j2) then null; end if;

  -- 7. A system failure charges nothing.
  perform public.verify_billing_open(j4, u1, 'verify:' || j4 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1) where id = j4;
  select balance into bal from public.credit_accounts where user_id = u1;
  r := public.verify_billing_close(j4, 'SYSTEM_FAILED');
  if (r->>'charged')::numeric <> 0 or (r->>'released')::numeric <> 25 then raise exception '7: %', r; end if;
  if (select balance from public.credit_accounts where user_id = u1) <> bal + 25 then raise exception '7: balance'; end if;

  -- 8. Stop, then resume: cumulative, never twice, never past the authorisation.
  perform public.verify_billing_open(j6, u1, 'verify:' || j6 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1) where id = j6;
  r := public.verify_billing_close(j6, 'STOPPED');
  charged1 := (r->>'charged')::numeric;
  if (select state from public.verify_billing where job_id = j6) <> 'PAUSED' then raise exception '8: not paused'; end if;
  -- Resume reserves only what is left of the 25.
  r := public.verify_billing_open(j6, u1, 'verify:' || j6 || ':s2');
  if (r->>'reservedCredits')::numeric <> 25 - charged1 then raise exception '8: resume reserved % (charged %)', r, charged1; end if;
  -- Resuming with nothing new done (all reused) charges nothing more.
  s := public.verify_billing_state(j6);
  if (s->>'accrued')::numeric <> 0 then raise exception '8: reused work accrued %', s; end if;
  -- New work is charged as the difference of the cumulative price.
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage2) where id = j6;
  r := public.verify_billing_close(j6, 'COMPLETE');
  charged2 := (r->>'charged')::numeric;
  p := public.verify_price_for_cost((public.verify_job_cost(j6)->>'landedCents')::numeric);
  if charged1 + charged2 <> least((p->>'credits')::numeric, 25) then raise exception '8: cumulative % + % vs %', charged1, charged2, p; end if;
  if (select charged_total_credits from public.verify_billing where job_id = j6) <> charged1 + charged2 then raise exception '8: total'; end if;
  -- A late retry of an old session's start key does not reopen anything.
  r := public.verify_billing_open(j6, u1, 'verify:' || j6 || ':s1');
  if (r->>'ok')::boolean then raise exception '8: closed key reopened %', r; end if;

  -- 9. Fully spent: no more without an explicit, recorded authorisation (+25, from policy — never a client amount).
  r := public.verify_billing_open(j2, u1, 'verify:' || j2 || ':s2');
  if r->>'reason' <> 'BUDGET_EXHAUSTED' or not (r->>'canExtend')::boolean then raise exception '9: %', r; end if;
  r := public.verify_billing_open(j2, u1, 'verify:' || j2 || ':s2x', true, 1);
  if (r->>'reservedCredits')::numeric <> 25 or (r->>'authorizedTotal')::numeric <> 50 or (r->>'authorizations')::int <> 2 then raise exception '9: extra %', r; end if;
  if (select count(*) from public.verify_billing_authorizations where job_id = j2) <> 2 then raise exception '9: authorisation not recorded'; end if;
  perform public.verify_billing_close(j2, 'SYSTEM_FAILED');

  -- 10. Insufficient balance: refused, nothing held.
  r := public.verify_billing_open(j3, u2, 'verify:' || j3 || ':s1');
  if r->>'reason' <> 'INSUFFICIENT_CREDITS' or (r->>'requiredCredits')::numeric <> 25 or (r->>'availableCredits')::numeric <> 10 then raise exception '10: %', r; end if;
  if (select balance from public.credit_accounts where user_id = u2) <> 10 then raise exception '10: balance moved'; end if;
  if exists (select 1 from public.verify_billing_sessions where job_id = j3) then raise exception '10: session created'; end if;

  -- 11. A missing rate is never a silent zero.
  update public.billable_products set config = jsonb_set(config, '{verify_budget,ai_models,default}', '"unpriced-model"') where code = 'VERIFY';
  perform public.verify_billing_open(j7, u1, 'verify:' || j7 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1,
    'browserOfficial', jsonb_build_object('results', jsonb_build_array(
      jsonb_build_object('source', 'mygov', 'captchaResolution', jsonb_build_array(jsonb_build_object('outcome', 'ACCEPTED', 'attempts', 2))),
      jsonb_build_object('source', 'mygov', 'queue', jsonb_build_object('reused', 'SHARED'), 'captchaResolution', jsonb_build_array(jsonb_build_object('outcome', 'ACCEPTED', 'attempts', 5)))))) where id = j7;
  c := public.verify_job_cost(j7);
  if c->>'state' <> 'PARTIAL' or (c->>'unpricedLines')::int <> 1 then raise exception '11: %', c; end if;
  -- CAPTCHA: no price-book rate → documented fallback; a shared (reused) result costs this job nothing.
  if not exists (select 1 from jsonb_array_elements(c->'lines') l where l->>'kind' = 'CAPTCHA' and (l->>'units')::numeric = 2 and l->>'state' = 'FALLBACK' and (l->>'usd')::numeric = 0.006) then
    raise exception '11: captcha %', c;
  end if;
  if public.verify_billing_state(j7)->>'usageState' <> 'CALCULATING' then raise exception '11: state'; end if;
  r := public.verify_billing_close(j7, 'COMPLETE');
  if not (select needs_review from public.verify_billing where job_id = j7) then raise exception '11: not flagged'; end if;
  update public.billable_products set config = jsonb_set(config, '{verify_budget,ai_models,default}', '"gpt-5.6-terra"') where code = 'VERIFY';

  -- 12. Plans: a VIP customer pays the same Verify price (PAYG; no plan pricing), the plan is only snapshotted.
  perform public.verify_billing_open(j5, u3, 'verify:' || j5 || ':s1');
  if (select plan_code_snapshot from public.usage_reservations where idempotency_key = 'verify:' || j5 || ':s1') <> 'VIP' then raise exception '12: snapshot'; end if;
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1, '_searches', '{"identity":3}'::jsonb) where id = j5;
  r := public.verify_billing_close(j5, 'COMPLETE');
  if (r->>'charged')::numeric <> charged_j1 then raise exception '12: VIP price % differs from %', r, charged_j1; end if;
  if (select count(*) from public.credit_ledger where user_id = u3 and type = 'SERVICE_CAPTURE') <> 1 then raise exception '12: allowance used'; end if;

  -- 13. A reservation released behind the job's back (expiry sweep) is never charged, and is flagged.
  insert into public.research_jobs (user_id) values (u1) returning id into j3;
  perform public.verify_billing_open(j3, u1, 'verify:' || j3 || ':s1');
  update public.research_jobs set result_json = jsonb_build_object('_cost', usage1) where id = j3;
  perform public.wallet_release((select reservation_id from public.verify_billing_sessions where job_id = j3), 'reservation_expired');
  r := public.verify_billing_close(j3, 'COMPLETE');
  if not (r->>'expired')::boolean or (r->>'charged')::numeric <> 0 then raise exception '13: %', r; end if;
  if not (select needs_review from public.verify_billing where job_id = j3) then raise exception '13: not flagged'; end if;

  -- 14. Durable CAPTCHA records win over result logs (no double count).
  insert into public.verify_captcha_events (idempotency_key, job_id, source, outcome, cost_usd) values ('k14', j7, 'mygov', 'ACCEPTED', 0.003);
  c := public.verify_job_cost(j7);
  if (select count(*) from jsonb_array_elements(c->'lines') l where l->>'kind' = 'CAPTCHA') <> 1
     or not exists (select 1 from jsonb_array_elements(c->'lines') l where l->>'kind' = 'CAPTCHA' and (l->>'usd')::numeric = 0.003) then
    raise exception '14: %', c;
  end if;

  -- 15. Resume re-queues only unfinished tasks; completed ones are kept.
  r := public.verify_task_enqueue(j7, 'mygov', 'mygov', 'mygov:R15', '{}');
  perform public.verify_task_enqueue(j7, 'tas', 'tas', 'tas:R15', '{}');
  update public.verify_tasks set state = 'SUCCEEDED', result = '{"ok":true}' where job_id = j7 and dedupe_key = 'tas';
  perform public.verify_job_cancel_tasks(j7);
  n := public.verify_job_requeue_unfinished(j7);
  if n <> 1 then raise exception '15: archived %', n; end if;
  r := public.verify_task_enqueue(j7, 'mygov', 'mygov', 'mygov:R15', '{}');
  if not (r->>'created')::boolean or r->>'state' <> 'QUEUED' then raise exception '15: re-enqueue %', r; end if;
  if (select state from public.verify_tasks where job_id = j7 and dedupe_key = 'tas') <> 'SUCCEEDED' then raise exception '15: completed task touched'; end if;

  -- 16. Ledger integrity: balance + reserved equals what was granted minus what was charged.
  if (select sum(balance + reserved) from public.credit_accounts where user_id = u1)
     <> 200 - (select sum(charged_total_credits) from public.verify_billing where user_id = u1) then
    raise exception '16: wallet drift';
  end if;
  if exists (select 1 from public.credit_accounts where balance < 0 or reserved < 0) then raise exception '16: negative'; end if;

  raise notice 'verify_credit_budget: all checks passed';
end;
$$;
