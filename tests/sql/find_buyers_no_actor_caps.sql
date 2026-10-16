-- FIND BUYERS — no per-Actor caps (20261031090000): only the campaign's business math refuses,
-- and OpenAI spend counts against the same provider budget.
\set ON_ERROR_STOP on
insert into public.users (id) values ('00000000-0000-0000-0000-0000000009a1') on conflict do nothing;
insert into public.properties (id) values ('00000000-0000-0000-0000-0000000009b1'), ('00000000-0000-0000-0000-0000000009b2') on conflict do nothing;
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b1', 'k-nocap', 'searching_sources'),
       ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009b2', 'k-nocap-2', 'searching_sources');
-- 100 credits = $10; provider share 50% = $5 provider budget.
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
values ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009a1', 'SALE', 100, 10, 10000000, 5000000),
       ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000009a1', 'SALE', 100, 10, 10000000, 5000000);

do $$
declare r jsonb; r2 jsonb; i int; n int;
begin
  assert (select bool_and(daily_spend_cap_micros is null and campaign_spend_cap_micros is null) from public.find_buyers_actor_registry),
    'every per-Actor cap is removed';
  update public.admin_settings set value = 'true' where key = 'find_buyers_social_enabled';
  -- $1.00 per run (1000 results at $1/1k): five runs exceed the old $2 campaign / $5 daily per-Actor caps.
  update public.find_buyers_actor_registry
     set enabled = true, emergency_disabled = false, pricing_verified_at = now(), pricing_model = 'PAY_PER_RESULT',
         price_per_1k_micros = 1000000, start_fee_micros = 0, max_results = 1000, concurrency = 10
   where actor_key = 'FB_COMMENTS';

  -- A. One Actor may take the whole $5 budget; the sixth dollar is refused by the campaign budget.
  for i in 1..5 loop
    r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c1', 'FB_COMMENTS', 'nocap-' || i, null, 'FB_COMMENTS', 'en', 0, 1000);
    assert (r->>'ok')::boolean, 'run ' || i || ' within the $5 budget must reserve: ' || r::text;
    -- Finished at its estimate: frees the run slot (concurrency, not money), keeps the spend committed.
    update public.find_buyers_actor_runs set status = 'SUCCEEDED', actual_micros = 1000000 where id = (r->>'runId')::uuid;
  end loop;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c1', 'FB_COMMENTS', 'nocap-6', null, 'FB_COMMENTS', 'en', 0, 1000);
  assert r->>'reason' = 'CAMPAIGN_BUDGET', 'past the provider budget is refused: ' || r::text;

  -- B. A retried call with the same idempotency key replays; it never reserves twice.
  select count(*) into n from public.find_buyers_actor_runs where matching_job_id = '00000000-0000-0000-0000-0000000009c1';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c1', 'FB_COMMENTS', 'nocap-1', null, 'FB_COMMENTS', 'en', 0, 1000);
  assert (r->>'replay')::boolean, 'same key replays: ' || r::text;
  assert (select count(*) from public.find_buyers_actor_runs where matching_job_id = '00000000-0000-0000-0000-0000000009c1') = n, 'no second reservation';

  -- C. OpenAI spend is paid from the same budget: $0.60 of OpenAI leaves room for four $1 runs, not five.
  perform public.find_buyers_record_ai_cost('ai:nocap', '00000000-0000-0000-0000-0000000009c2', 'AI', 'ADAPTIVE_PLAN', 'gpt-4o-mini', 1000, 100, 600000);
  for i in 1..4 loop
    r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c2', 'FB_COMMENTS', 'ai-' || i, null, 'FB_COMMENTS', 'en', 0, 1000);
    assert (r->>'ok')::boolean, 'run ' || i || ' fits beside the OpenAI spend: ' || r::text;
    update public.find_buyers_actor_runs set status = 'SUCCEEDED', actual_micros = 1000000 where id = (r->>'runId')::uuid;
  end loop;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c2', 'FB_COMMENTS', 'ai-5', null, 'FB_COMMENTS', 'en', 0, 1000);
  assert r->>'reason' = 'CAMPAIGN_BUDGET' and (r->>'openAiMicros')::bigint = 600000, 'OpenAI counts against the budget: ' || r::text;

  -- D. A partial failure that never started releases its reservation: the money is free again.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c2', 'FB_COMMENTS', 'ai-6', null, 'FB_COMMENTS', 'en', 0, 300);
  assert (r->>'ok')::boolean, '$0.30 still fits: ' || r::text;
  perform public.find_buyers_book_run_cost((r->>'runId')::uuid, 'RELEASED', 0, 'NOT_STARTED', 0, 0, 'START_FAILED');
  r2 := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c2', 'FB_COMMENTS', 'ai-7', null, 'FB_COMMENTS', 'en', 0, 300);
  assert (r2->>'ok')::boolean, 'a released reservation is spendable again: ' || r2::text;
  update public.find_buyers_actor_runs set status = 'SUCCEEDED', actual_micros = 300000 where id = (r2->>'runId')::uuid;

  -- E. An admin-set cap still applies (NULL is the only "no cap").
  update public.find_buyers_actor_registry set daily_spend_cap_micros = 1 where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000009c1', 'FB_COMMENTS', 'cap-set', null, 'FB_COMMENTS', 'en', 0, 5);
  assert r->>'reason' in ('ACTOR_DAILY_CAP', 'CAMPAIGN_BUDGET'), 'an explicit cap still refuses: ' || r::text;
  update public.find_buyers_actor_registry set daily_spend_cap_micros = null where actor_key = 'FB_COMMENTS';
end $$;
select 'FIND BUYERS NO-ACTOR-CAP CHECKS PASS';
