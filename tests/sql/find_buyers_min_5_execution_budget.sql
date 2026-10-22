-- FIND BUYERS — $5 minimum and the execution budget (20261119120000): every read agrees on
-- 50 credits = $5, and the atomic reserve holds the OpenAI classification of in-flight runs'
-- items inside the campaign budget (AI can never be booked on top of a fully spent budget).
\set ON_ERROR_STOP on
insert into public.users (id) values ('00000000-0000-0000-0000-000000000ea1') on conflict do nothing;
insert into public.properties (id) values ('00000000-0000-0000-0000-000000000eb1') on conflict do nothing;
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-000000000ec1', '00000000-0000-0000-0000-000000000ea1', '00000000-0000-0000-0000-000000000eb1', 'k-min5', 'searching_sources')
on conflict do nothing;
-- A $1.00 execution budget.
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
values ('00000000-0000-0000-0000-000000000ec1', '00000000-0000-0000-0000-000000000eb1', '00000000-0000-0000-0000-000000000ea1', 'SALE', 50, 10, 5000000, 1000000)
on conflict do nothing;

do $$
declare c jsonb; r jsonb; r2 jsonb; first uuid;
begin
  /* 1 · the minimum */
  c := public.find_buyers_public_config();
  assert (c->>'minUsd')::numeric = 5 and (c->>'minCredits')::numeric = 50, '$5 = 50 credits: ' || c::text;
  assert (select value from public.admin_settings where key = 'find_buyers_min_usd') = '5'::jsonb, 'find_buyers_min_usd aligned to 5';
  assert (select value from public.admin_settings where key = 'search_budget_presets_find_clients') = '[50, 100, 500, 1000, 1500, 2000]'::jsonb,
    'research presets start at 50';
  insert into public.admin_settings (key, value) values ('credits_per_usd', '20') on conflict (key) do update set value = excluded.value;
  assert (public.find_buyers_public_config()->>'minCredits')::numeric = 100, 'the minimum follows the credit rate ($5 at 20/$)';
  update public.admin_settings set value = '10' where key = 'credits_per_usd';

  /* 2 · classification headroom held inside the budget */
  update public.admin_settings set value = 'true' where key = 'find_buyers_social_enabled';
  update public.find_buyers_actor_registry
     set enabled = true, emergency_disabled = false, pricing_verified_at = now(), pricing_model = 'PAY_PER_RESULT',
         price_per_1k_micros = 1000000, start_fee_micros = 0, max_results = 1000, concurrency = 10, daily_spend_cap_micros = null, campaign_spend_cap_micros = null
   where actor_key = 'FB_COMMENTS';
  assert (select value from public.admin_settings where key = 'find_buyers_ai_headroom_micros_per_item') = '250'::jsonb, 'default 250 µ$ per item';

  -- 900 items: $0.90 + $0.225 of classification > $1.00 → refused, nothing reserved.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-a', null, 'FB_COMMENTS', 'ka', 0, 900);
  assert r->>'reason' = 'CAMPAIGN_BUDGET' and (r->>'aiHoldMicros')::bigint = 225000, 'its classification must fit too: ' || r::text;
  assert not exists (select 1 from public.find_buyers_actor_runs where idempotency_key = 'min5-a'), 'a refusal reserves nothing';

  -- 790 items: $0.79 + $0.1975 = $0.9875 ≤ $1.00 → reserved.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-b', null, 'FB_COMMENTS', 'ka', 0, 790);
  assert (r->>'ok')::boolean and (r->>'remainingMicros')::bigint = 12500, 'fits with its classification: ' || r::text;
  first := (r->>'runId')::uuid;

  -- Beside it in flight: 10 more items fit exactly ($0.79 + $0.01 + 800 × 250 µ$ = $1.00) …
  r2 := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-c', null, 'FB_COMMENTS', 'ka', 0, 10);
  assert (r2->>'ok')::boolean and (r2->>'remainingMicros')::bigint = 0, 'exactly at the ceiling: ' || r2::text;
  -- … one more item would pass it.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-d', null, 'FB_COMMENTS', 'ka', 0, 1);
  assert r->>'reason' = 'CAMPAIGN_BUDGET', 'never past the ceiling: ' || r::text;

  -- The first run returns 600 items for $0.60 and its classification costs $0.10: its hold is
  -- replaced by what it really used, and the freed money is spendable.
  update public.find_buyers_actor_runs set status = 'SUCCEEDED', actual_micros = 600000, cost_booked_at = now() where id = first;
  perform public.find_buyers_record_ai_cost('ai:min5:first', '00000000-0000-0000-0000-000000000ec1', 'AI', 'AI_CLASSIFY', 'gpt-4o-mini', 100000, 10000, 100000);
  -- committed $0.60 + $0.01 + AI $0.10 = $0.71; 200 more items cost $0.20 and hold (10 + 200) × 250 µ$ = $0.0525 → $0.0375 left.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-e', null, 'FB_COMMENTS', 'ka', 0, 200);
  assert (r->>'ok')::boolean and (r->>'remainingMicros')::bigint = 37500, 'freed budget reused: ' || r::text;

  -- The same key replays; never a second reservation.
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-e', null, 'FB_COMMENTS', 'ka', 0, 200);
  assert (r->>'replay')::boolean, 'replay: ' || r::text;

  -- An allowance of 0 restores the earlier rule (Actor spend + booked OpenAI only).
  update public.admin_settings set value = '0' where key = 'find_buyers_ai_headroom_micros_per_item';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-000000000ec1', 'FB_COMMENTS', 'min5-f', null, 'FB_COMMENTS', 'ka', 0, 70);
  assert (r->>'ok')::boolean and (r->>'aiHoldMicros')::bigint = 0, 'allowance 0 holds nothing: ' || r::text;
  update public.admin_settings set value = '250' where key = 'find_buyers_ai_headroom_micros_per_item';
end $$;
select 'FIND BUYERS $5 MINIMUM + EXECUTION BUDGET CHECKS PASS';
