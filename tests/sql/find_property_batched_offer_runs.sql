\set ON_ERROR_STOP on
-- Batched paid social runs (20261114090000): a run over several communities may reserve
-- the Actor's max_results for each (≤ 25, ≤ 1000 items) and gets the time to read them;
-- the campaign budget still bounds every reservation; old eight-argument calls still work.
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; v_run uuid; v jsonb;
begin
  update public.admin_settings set value = 'true' where key = 'find_property_social_enabled';
  if not found then insert into public.admin_settings (key, value) values ('find_property_social_enabled', 'true'); end if;
  insert into public.discovery_runs (user_id, status, billing_grant, pricing_policy, credits_per_usd, customer_value_micros, provider_budget_micros, offer_networks)
  values (b1, 'SEARCHING', '{"authorizedMaxCredits": 50}', 'paid_discovery_37_63_v1', 10, 5000000, 3150000, array['FACEBOOK','TELEGRAM'])
  returning id into v_run;

  -- One community (the old call, eight arguments): capped at max_results as before.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'b-1', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 1000);
  assert (v->>'ok')::boolean and (v->>'requestedLimit')::int = 100 and (v->>'reservedMicros')::bigint = 158000, v::text;
  assert (v->>'timeoutSeconds')::int = 300, v::text;

  -- 25 groups in one run: 25 × 100 → the 1000-item ceiling, 20 minutes at most.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'b-25', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 1000, 25);
  assert (v->>'ok')::boolean and (v->>'requestedLimit')::int = 1000 and (v->>'reservedMicros')::bigint = 1508000, v::text;
  assert (v->>'timeoutSeconds')::int = 1200, v::text;

  -- 3 communities: 300 items, three timeout blocks; a silly target count is capped at 25.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'b-3', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 1000, 3);
  assert (v->>'requestedLimit')::int = 300 and (v->>'reservedMicros')::bigint = 458000 and (v->>'timeoutSeconds')::int = 900, v::text;

  -- The budget bounds the whole run: 158000 + 1508000 + 458000 committed, another 1508000 does not fit.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'b-99', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 5000, 99);
  assert v->>'reason' = 'CAMPAIGN_BUDGET' and (v->>'estimateMicros')::bigint = 1508000, v::text;
  assert public.find_property_committed_micros(v_run) = 2124000, public.find_property_committed_micros(v_run)::text;

  -- A smaller run still fits the rest.
  v := public.find_property_reserve_actor_run(v_run, 'TELEGRAM_CHANNEL', 'b-tg', null, 'TELEGRAM_CHANNEL', 'TELEGRAM', null, 1000, 12);
  assert (v->>'ok')::boolean and (v->>'requestedLimit')::int = 1000 and (v->>'reservedMicros')::bigint = 251000, v::text;
  assert public.find_property_committed_micros(v_run) <= 3150000;

  -- A replay answers with the same run and the same time allowance.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'b-25', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 1000, 25);
  assert (v->>'replay')::boolean and (v->>'timeoutSeconds')::int = 1200, v::text;

  -- One signature only; the holder rows for unattributed posts exist once.
  assert (select count(*) from pg_proc where proname = 'find_property_reserve_actor_run') = 1;
  assert (select count(*) from public.source_registry where external_id in ('homatch:fp-tiktok-search', 'homatch:fp-telegram-offers', 'homatch:fp-instagram-offers')) = 3;
  assert not has_function_privilege('authenticated', 'public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer, integer)', 'execute');
end $$;
