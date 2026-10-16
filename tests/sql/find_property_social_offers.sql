\set ON_ERROR_STOP on
-- A $5 paid social campaign: providers can never be reserved past $3.15; the switches
-- stop it; a key replays instead of reserving twice; an unknown cost counts at its
-- reservation; the customer sees only their own run.
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; v_run uuid; v jsonb; v_i int; v_first uuid; v_err text;
begin
  insert into public.discovery_runs (user_id, status, billing_grant, pricing_policy, credits_per_usd, customer_value_micros, provider_budget_micros, offer_networks)
  values (b1, 'SEARCHING', '{"authorizedMaxCredits": 50}', 'paid_discovery_37_63_v1', 10, 5000000, 3150000, array['FACEBOOK','TELEGRAM'])
  returning id into v_run;

  -- Switch OFF (default): nothing is reserved.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'k-off', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20);
  assert v->>'reason' = 'SOCIAL_DISABLED', v::text;
  update public.admin_settings set value = 'true' where key = 'find_property_social_enabled';
  -- APIFY switched off on Admin → Providers: still nothing.
  update public.admin_settings set value = '["APIFY"]' where key = 'provider_disabled_list';
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'k-apify', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20);
  assert v->>'reason' = 'APIFY_DISABLED_BY_ADMIN', v::text;
  update public.admin_settings set value = '[]' where key = 'provider_disabled_list';
  -- Unverified pricing is refused.
  v := public.find_property_reserve_actor_run(v_run, 'VK_POSTS_COMMENTS', 'k-vk', null, 'VK_WALL', 'VK', null, 20);
  assert v->>'reason' = 'PRICING_NOT_VERIFIED', v::text;

  -- Reserve until the budget says no: each run is 8000 + 20 * 1.5 = 38000 µ$.
  for v_i in 1..200 loop
    v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'k-' || v_i, null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20);
    exit when not (v->>'ok')::boolean;
    if v_i = 1 then v_first := (v->>'runId')::uuid; end if;
  end loop;
  assert v->>'reason' = 'CAMPAIGN_BUDGET', v::text;
  assert public.find_property_committed_micros(v_run) <= 3150000, 'never past $3.15: ' || public.find_property_committed_micros(v_run);
  assert public.find_property_committed_micros(v_run) = 82 * 38000, 'floor(3.15 / 0.038) runs';

  -- Replay, no second reservation.
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'k-1', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20);
  assert (v->>'replay')::boolean and (v->>'runId')::uuid = v_first;
  assert (select count(*) from public.find_property_actor_runs where discovery_run_id = v_run) = 82;

  -- Booking: actual spend once; RELEASED for an unstarted run frees its budget; unknown counts at reservation.
  v := public.find_property_book_actor_cost(v_first, 'SUCCEEDED', 30000, 'PROVIDER_REPORTED', 20, 20, 3, null);
  assert (v->>'bookedMicros')::bigint = 30000;
  v := public.find_property_book_actor_cost(v_first, 'SUCCEEDED', 99999, 'PROVIDER_REPORTED', 20, 20, 3, null);
  assert (v->>'duplicate')::boolean, 'booked once';
  update public.find_property_actor_runs set status = 'RUNNING', provider_run_id = 'p-2' where idempotency_key = 'k-2';
  begin
    perform public.find_property_book_actor_cost((select id from public.find_property_actor_runs where idempotency_key = 'k-2'), 'RELEASED', 0, 'NOT_STARTED', 0, 0, 0, null);
    assert false, 'a started run cannot be released at $0';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%RUN_MAY_HAVE_STARTED%', v_err; end;
  v := public.find_property_book_actor_cost((select id from public.find_property_actor_runs where idempotency_key = 'k-2'), 'ABORTED', null, 'UNKNOWN', null, 0, 0, 'x');
  assert (v->>'unknownCost')::boolean;
  v := public.find_property_book_actor_cost((select id from public.find_property_actor_runs where idempotency_key = 'k-3'), 'RELEASED', 0, 'NOT_STARTED', 0, 0, 0, null);
  assert public.find_property_committed_micros(v_run) = 30000 + 38000 + 79 * 38000, 'actual + unknown-at-reservation + held';
  assert (select count(*) from public.cost_events where request_id = v_run::text) = 2, 'cost events for the two runs that reached the provider';
  assert (select offers_found from public.discovery_runs where id = v_run) = 3;

  -- An admin per-Actor daily cap holds across both products.
  update public.find_buyers_actor_registry set daily_spend_cap_micros = 100000 where actor_key = 'TELEGRAM_CHANNEL';
  insert into public.find_buyers_actor_runs (actor_key, status, reserved_micros) values ('TELEGRAM_CHANNEL', 'RUNNING', 95000);
  insert into public.discovery_runs (user_id, status, billing_grant, pricing_policy, credits_per_usd, customer_value_micros, provider_budget_micros)
  values (b1, 'SEARCHING', '{"authorizedMaxCredits": 50}', 'paid_discovery_37_63_v1', 10, 5000000, 3150000) returning id into v_first;
  v := public.find_property_reserve_actor_run(v_first, 'TELEGRAM_CHANNEL', 'k-cap', null, 'TELEGRAM_CHANNEL', 'TELEGRAM', null, 30);
  assert v->>'reason' = 'ACTOR_DAILY_CAP', v::text;
  update public.find_buyers_actor_registry set daily_spend_cap_micros = null where actor_key = 'TELEGRAM_CHANNEL';
  v := public.find_property_reserve_actor_run(v_first, 'TELEGRAM_CHANNEL', 'k-cap2', null, 'TELEGRAM_CHANNEL', 'TELEGRAM', null, 30);
  assert (v->>'ok')::boolean, v::text;

  -- Not searching any more: no new reservations.
  update public.discovery_runs set status = 'MATCHING' where id = v_run;
  v := public.find_property_reserve_actor_run(v_run, 'TELEGRAM_CHANNEL', 'k-late', null, 'TELEGRAM_CHANNEL', 'TELEGRAM', null, 30);
  assert v->>'reason' = 'RUN_NOT_SEARCHING';

  -- The customer's view: own run only.
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
  v := public.my_find_property_campaign(v_run);
  assert (v->>'creditsAuthorized')::numeric = 50, v::text;
  -- committed 30000 + 38000 + 79*38000 = 3,070,000 µ$ → /0.63 = $4.873… → $4.88 → 48.8 credits.
  assert (v->>'creditsUsed')::numeric = 48.8, v::text;
  assert not (v ? 'providerSpendUsd') and not (v ? 'providerBudgetUsd'), 'no provider dollars for the customer';
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b2', true);
  begin perform public.my_find_property_campaign(v_run); assert false, 'foreign run visible';
  exception when insufficient_privilege then null; end;

  assert not has_function_privilege('authenticated', 'public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer)', 'execute');
  assert exists (select 1 from public.source_registry where external_id = 'homatch:fp-fb-post-search' and not active);
end $$;
