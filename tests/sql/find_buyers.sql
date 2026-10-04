-- FIND BUYERS behavioural checks (run by run-find-buyers.sh).
\set ON_ERROR_STOP on
insert into public.users (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.properties (id) values ('00000000-0000-0000-0000-0000000000b1');
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k1', 'searching_sources');
-- $10 campaign at 10 credits/$ → 100 credits; provider budget 50% = $5.
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'SALE', 100, 10, 10000000, 5000000);

do $$
declare r jsonb; r2 jsonb; b jsonb; b2 jsonb; n int; v numeric;
begin
  -- 1. switch OFF refuses
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r->>'reason' = 'SOCIAL_DISABLED', 'switch off must refuse: ' || r::text;
  update public.admin_settings set value = 'true' where key = 'find_buyers_social_enabled';
  -- 2. disabled actor refuses
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r->>'reason' = 'ACTOR_DISABLED', 'disabled actor must refuse: ' || r::text;
  update public.find_buyers_actor_registry set enabled = true where actor_key = 'FB_COMMENTS';
  -- 3. unverified price refuses (never runs on a stale/unknown price)
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r->>'reason' = 'PRICING_NOT_VERIFIED', 'unverified price must refuse: ' || r::text;
  update public.find_buyers_actor_registry set pricing_verified_at = now() - interval '40 days' where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r->>'reason' = 'PRICING_NOT_VERIFIED', 'stale price must refuse: ' || r::text;
  update public.find_buyers_actor_registry set pricing_verified_at = now(), price_per_1k_micros = 500000, campaign_spend_cap_micros = 5000000, concurrency = 5 where actor_key = 'FB_COMMENTS';
  -- 4. reserve: 20 results × $0.50/1k = $0.01 = 10000 micros
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert (r->>'ok')::boolean and (r->>'reservedMicros')::bigint = 10000, 'reserve: ' || r::text;
  -- 5. idempotent replay returns the same run
  r2 := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-a', null, 'FB_COMMENTS', 'en', 0, 20);
  assert (r2->>'replay')::boolean and r2->>'runId' = r->>'runId', 'replay: ' || r2::text;
  select count(*) into n from public.find_buyers_actor_runs; assert n = 1, 'one run row';
  -- 6. book actual cost once; a retried finaliser books nothing
  update public.find_buyers_actor_runs set provider_run_id = 'pr1', status = 'RUNNING', started_at = now() where id = (r->>'runId')::uuid;
  b := public.find_buyers_book_run_cost((r->>'runId')::uuid, 'SUCCEEDED', 9000, 'RUN_PRICE_X_BILLED_UNITS', 18, 18);
  assert (b->>'booked')::boolean and b->>'costState' = 'ACTUAL', 'book: ' || b::text;
  b2 := public.find_buyers_book_run_cost((r->>'runId')::uuid, 'SUCCEEDED', 9000, 'RUN_PRICE_X_BILLED_UNITS', 18, 18);
  assert not (b2->>'booked')::boolean, 'double booking must be refused';
  select count(*), sum(cost_usd) into n, v from public.cost_events where job_id = '00000000-0000-0000-0000-0000000000c1';
  assert n = 1 and v = 0.009, 'exactly one cost_event of $0.009, got ' || n || ' ' || v;
  -- 7. failed run that the provider billed is still booked (never silently zero), not as success
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-b', null, 'FB_COMMENTS', 'en', 0, 20);
  update public.find_buyers_actor_runs set provider_run_id = 'pr2', status = 'RUNNING' where id = (r->>'runId')::uuid;
  b := public.find_buyers_book_run_cost((r->>'runId')::uuid, 'FAILED', null, 'UNKNOWN', null, 0, 'RUN_FAILED');
  assert b->>'costState' = 'UNKNOWN', 'unknown cost state';
  select cost_usd into v from public.cost_events where request_id = 'pr2';
  assert v = 0.01, 'unknown cost booked at the reservation amount, not zero: ' || v;
  select count(*) into n from public.cost_events where request_id = 'pr2' and pricing_state = 'UNPRICED' and success = false;
  assert n = 1, 'unknown cost is UNPRICED and not a success';
  -- 8. never-started run releases its reservation (0)
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-c', null, 'FB_COMMENTS', 'en', 0, 20);
  b := public.find_buyers_book_run_cost((r->>'runId')::uuid, 'RELEASED', 0, 'NOT_STARTED', 0, 0, 'START_FAILED');
  select count(*) into n from public.cost_events where request_id is null and job_id = '00000000-0000-0000-0000-0000000000c1';
  assert n = 0, 'a released run writes no cost_event';
  -- 9. campaign provider cap: committed 19000 of 5,000,000; ask for 5000 results at $1/1k = $5 → refused
  update public.find_buyers_actor_registry set price_per_1k_micros = 1000000, max_results = 5000 where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-d', null, 'FB_COMMENTS', 'en', 0, 5000);
  assert r->>'reason' = 'CAMPAIGN_BUDGET', 'provider cap must refuse: ' || r::text;
  -- 10. per-actor campaign cap
  update public.find_buyers_actor_registry set campaign_spend_cap_micros = 20000 where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-e', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r->>'reason' = 'ACTOR_CAMPAIGN_CAP', 'actor campaign cap: ' || r::text;
  -- 11. a price edit without verification resets verification
  perform set_config('app.admin', 'on', true);
  perform public.admin_find_buyers_actor_update('FB_COMMENTS', '{"pricePer1kMicros": 700000}'::jsonb);
  assert (select pricing_verified_at is null from public.find_buyers_actor_registry where actor_key = 'FB_COMMENTS'), 'price edit resets verification';
  perform public.admin_find_buyers_actor_update('FB_COMMENTS', '{"pricePer1kMicros": 700000, "pricingVerified": true}'::jsonb);
  assert (select pricing_verified_at is not null from public.find_buyers_actor_registry where actor_key = 'FB_COMMENTS'), 'explicit verification stamps';
  -- 12. admin center answers
  assert (public.admin_find_buyers_center(30)->'overview'->>'campaigns')::int = 1, 'center overview';
  perform set_config('app.admin', '', true);
  -- 13. AI cost once per key; enters cost_events while open
  assert public.find_buyers_record_ai_cost('ai:x', '00000000-0000-0000-0000-0000000000c1', 'AI', 'INTENT', 'gpt-4o-mini', 1000, 100, 210);
  assert not public.find_buyers_record_ai_cost('ai:x', '00000000-0000-0000-0000-0000000000c1', 'AI', 'INTENT', 'gpt-4o-mini', 1000, 100, 210);
  select count(*) into n from public.cost_events where operation_type = 'FIND_BUYERS_INTENT'; assert n = 1, 'one AI cost_event';
  -- translation: ledger only
  perform public.find_buyers_record_ai_cost('tr:x', '00000000-0000-0000-0000-0000000000c1', 'TRANSLATION', 'TRANSLATE', 'gpt-4o-mini', 100, 100, 75);
  select count(*) into n from public.cost_events where operation_type like '%TRANSLATE%'; assert n = 0, 'translation is ledger-only COGS';
  -- 14. after finalisation a late booking carries no property (cannot leak into the next campaign)
  update public.find_buyers_actor_registry set campaign_spend_cap_micros = 5000000, price_per_1k_micros = 500000, pricing_verified_at = now() where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-f', null, 'FB_COMMENTS', 'en', 0, 10);
  assert (r->>'ok')::boolean, 'pre-final reserve ok ' || r::text;
  update public.find_buyers_actor_runs set provider_run_id = 'pr3', status = 'RUNNING' where id = (r->>'runId')::uuid;
  update public.find_buyers_campaigns set finalized_at = now();
  perform public.find_buyers_book_run_cost((r->>'runId')::uuid, 'ABORTED', 3000, 'PROVIDER_REPORTED', 6, 6);
  assert (select property_id is null from public.cost_events where request_id = 'pr3'), 'late booking has no property';
  assert (select after_settlement from public.find_buyers_cost_ledger where idempotency_key = 'book:' || (r->>'runId')), 'ledger marks after_settlement';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c1', 'FB_COMMENTS', 'k-g', null, 'FB_COMMENTS', 'en', 0, 10);
  assert r->>'reason' = 'CAMPAIGN_FINALIZED', 'no reservation after finalisation';
end $$;

-- 15. queue: APIFY_MEMO23 is claimable; a wait-finish gives the attempt back
insert into public.discovery_query_queue (id, property_id, platform, language, query, provider, matching_job_id, executor, status, dedupe_key)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'FACEBOOK', 'en', 'q1', 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000000c1', 'EDGE', 'PENDING', 'dk1');
do $$
declare j record; s text;
begin
  select * into j from public.claim_discovery_source_jobs_v2(1, 180, 4, 'EDGE', array['APIFY_MEMO23']);
  assert j.id = '00000000-0000-0000-0000-0000000000d1' and j.attempts = 1, 'claimed memo23 job';
  s := public.finish_discovery_source_job_wait(j.id, j.claim_token, 20, '{"actorRunId":"x"}');
  assert s = 'RETRY_WAIT', 'wait-finish';
  assert (select attempts = 0 and metadata->>'actorRunId' = 'x' and lease_expires_at is null from public.discovery_query_queue where id = j.id), 'attempt returned, metadata kept';
  -- the native pass never sees it
  update public.discovery_query_queue set next_attempt_at = now() where id = j.id;
  select * into j from public.claim_discovery_source_jobs_v2(1, 180, 4, 'EDGE', array['TELEGRAM','TELEGRAM_SOURCES','FORUM','PORTAL']);
  assert j.id is null, 'native pass must not claim memo23 jobs';
end $$;

-- 16. RLS: owners do not get the economics columns
do $$ begin
  assert not has_column_privilege('authenticated', 'public.find_buyers_campaigns', 'provider_budget_micros', 'select'), 'economics hidden from owners';
  assert has_column_privilege('authenticated', 'public.find_buyers_campaigns', 'stats', 'select'), 'stats visible to owners';
  assert not has_table_privilege('anon', 'public.find_buyers_leads', 'select'), 'anon reads nothing';
end $$;
select 'FIND BUYERS SQL CHECKS: PASS' as result;
