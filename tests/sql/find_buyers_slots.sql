-- FIND BUYERS — global memo23 run slots (20261015090000). Run after find_buyers.sql.
\set ON_ERROR_STOP on
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k2', 'searching_sources');
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'SALE', 100, 10, 10000000, 5000000);

do $$
declare r jsonb; ids uuid[] := '{}'; b jsonb; n int;
begin
  assert (select (value->>'APIFY_MEMO23')::int from public.admin_settings where key = 'discovery_provider_concurrency') = 4, 'cap starts at 4';
  update public.find_buyers_actor_registry
     set enabled = true, pricing_verified_at = now(), pricing_model = 'PAY_PER_RESULT', price_per_1k_micros = 500000,
         concurrency = 10, campaign_spend_cap_micros = 5000000, daily_spend_cap_micros = 50000000
   where actor_key in ('FB_COMMENTS', 'REDDIT');
  select count(*) into n from public.find_buyers_actor_runs where status in ('RESERVED','STARTING','RUNNING') and cost_booked_at is null;
  assert n = 0, 'no run in flight before the test: ' || n;

  -- A,B,C,D take the four slots, across two actors (the cap is global, not per actor).
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 's-A', null, 'FB_COMMENTS', 'en', 0, 20); assert (r->>'ok')::boolean, 'A ' || r::text; ids := ids || (r->>'runId')::uuid;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-B', null, 'REDDIT_SEARCH', 'en', 0, 20); assert (r->>'ok')::boolean, 'B ' || r::text; ids := ids || (r->>'runId')::uuid;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 's-C', null, 'FB_COMMENTS', 'ka', 0, 20); assert (r->>'ok')::boolean, 'C ' || r::text; ids := ids || (r->>'runId')::uuid;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-D', null, 'REDDIT_SEARCH', 'ru', 0, 20); assert (r->>'ok')::boolean, 'D ' || r::text; ids := ids || (r->>'runId')::uuid;
  update public.find_buyers_actor_runs set status = 'RUNNING', provider_run_id = 'slot-' || idempotency_key, started_at = now() where id = any (ids);

  -- E is refused while four are in flight: retryable, no row, no ledger line.
  select count(*) into n from public.find_buyers_cost_ledger;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-E', null, 'REDDIT_SEARCH', 'he', 0, 20);
  assert r->>'reason' = 'GLOBAL_BUSY' and (r->>'retry')::boolean and (r->>'cap')::int = 4, 'E waits for a slot: ' || r::text;
  assert not exists (select 1 from public.find_buyers_actor_runs where idempotency_key = 's-E'), 'a refused reserve writes no run';
  assert (select count(*) from public.find_buyers_cost_ledger) = n, 'a refused reserve writes no ledger line';

  -- A replay of a run already holding a slot is still answered (never refused, never a second row).
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 's-A', null, 'FB_COMMENTS', 'en', 0, 20);
  assert (r->>'replay')::boolean and (r->>'runId')::uuid = ids[1], 'replay while full: ' || r::text;

  -- B finishes (booked) → its slot frees → E starts while A, C, D still run.
  b := public.find_buyers_book_run_cost(ids[2], 'SUCCEEDED', 9000, 'RUN_PRICE_X_BILLED_UNITS', 18, 18);
  assert (b->>'booked')::boolean, 'B booked';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-E', null, 'REDDIT_SEARCH', 'he', 0, 20);
  assert (r->>'ok')::boolean, 'E takes B''s slot: ' || r::text;
  ids := ids || (r->>'runId')::uuid;
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 's-F', null, 'FB_COMMENTS', 'tr', 0, 20);
  assert r->>'reason' = 'GLOBAL_BUSY', 'F waits: ' || r::text;

  -- D fails (billed unknown) → its slot frees as well; F starts. A is still running throughout.
  b := public.find_buyers_book_run_cost(ids[4], 'FAILED', null, 'UNKNOWN', null, 0, 'RUN_FAILED');
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 's-F', null, 'FB_COMMENTS', 'tr', 0, 20);
  assert (r->>'ok')::boolean, 'F takes D''s slot: ' || r::text;
  assert (select status from public.find_buyers_actor_runs where id = ids[1]) = 'RUNNING', 'A still running';

  -- A never-started reservation released at zero frees its slot too.
  b := public.find_buyers_book_run_cost((r->>'runId')::uuid, 'RELEASED', 0, 'NOT_STARTED', 0, 0, 'START_FAILED');
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-G', null, 'REDDIT_SEARCH', 'ar', 0, 20);
  assert (r->>'ok')::boolean, 'G takes the released slot: ' || r::text;

  -- Never more than four in flight.
  select count(*) into n from public.find_buyers_actor_runs where status in ('RESERVED','STARTING','RUNNING') and cost_booked_at is null;
  assert n = 4, 'exactly four in flight: ' || n;

  -- The cap is the setting: raising it opens slots, lowering it closes them (no code change).
  update public.admin_settings set value = value || '{"APIFY_MEMO23":5}'::jsonb where key = 'discovery_provider_concurrency';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-H', null, 'REDDIT_SEARCH', 'en', 0, 20);
  assert (r->>'ok')::boolean, 'fifth slot when the cap is 5: ' || r::text;
  update public.admin_settings set value = value || '{"APIFY_MEMO23":4}'::jsonb where key = 'discovery_provider_concurrency';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-I', null, 'REDDIT_SEARCH', 'en', 0, 20);
  assert r->>'reason' = 'GLOBAL_BUSY', 'back at 4: ' || r::text;

  -- The older guards still come first: a disabled actor is refused for that reason, not for slots.
  update public.find_buyers_actor_registry set enabled = false where actor_key = 'REDDIT';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'REDDIT', 's-J', null, 'REDDIT_SEARCH', 'en', 0, 20);
  assert r->>'reason' = 'ACTOR_DISABLED', 'actor gate first: ' || r::text;
end $$;
select 'FIND BUYERS SLOT CHECKS: PASS' as result;
