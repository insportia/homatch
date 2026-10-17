\set ON_ERROR_STOP on
-- The customer pays only for confirmed provider work: an ambiguous start and an
-- unstarted reservation are HOMATCH's (still counted against the provider budget),
-- a confirmed run counts at its actual cost, or at its reservation when unknown.
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; v_run uuid; v jsonb; r_ok uuid; r_amb uuid; r_unk uuid; r_rel uuid; r_live uuid;
begin
  update public.admin_settings set value = 'true' where key = 'find_property_social_enabled';
  insert into public.discovery_runs (user_id, status, billing_grant, pricing_policy, credits_per_usd, customer_value_micros, provider_budget_micros, offer_networks)
  values (b1, 'SEARCHING', '{"authorizedMaxCredits": 50}', 'paid_discovery_37_63_v1', 10, 5000000, 3150000, array['FACEBOOK'])
  returning id into v_run;
  r_ok := (public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'sl-ok', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20)->>'runId')::uuid;
  r_amb := (public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'sl-amb', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20)->>'runId')::uuid;
  r_unk := (public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'sl-unk', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20)->>'runId')::uuid;
  r_rel := (public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'sl-rel', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20)->>'runId')::uuid;
  r_live := (public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'sl-live', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 20)->>'runId')::uuid;
  assert r_ok is not null and r_live is not null, 'five reservations';

  -- Held reservations that never reached the provider: nothing for the customer yet.
  assert public.find_property_customer_micros(v_run) = 0, 'reserved only: 0';
  assert public.find_property_committed_micros(v_run) = 5 * 38000, 'budget still holds them';

  -- Confirmed and finished, actual known.
  update public.find_property_actor_runs set status = 'RUNNING', provider_run_id = 'p-ok' where id = r_ok;
  v := public.find_property_book_actor_cost(r_ok, 'SUCCEEDED', 30000, 'PROVIDER_REPORTED', 20, 20, 2, null);
  -- Start answered 5xx / network: ambiguous, booked START_AMBIGUOUS without a provider id.
  update public.find_property_actor_runs set status = 'STARTING' where id = r_amb;
  v := public.find_property_book_actor_cost(r_amb, 'ABORTED', null, 'START_AMBIGUOUS', null, 0, 0, 'START_AMBIGUOUS: HTTP_503');
  -- Confirmed, cost unknown: at its reservation.
  update public.find_property_actor_runs set status = 'RUNNING', provider_run_id = 'p-unk' where id = r_unk;
  v := public.find_property_book_actor_cost(r_unk, 'ABORTED', null, 'UNKNOWN', null, 0, 0, 'CAMPAIGN_ENDED');
  -- Never started: released.
  v := public.find_property_book_actor_cost(r_rel, 'RELEASED', 0, 'NOT_STARTED', 0, 0, 0, 'PROVIDER_NOT_CONFIGURED');
  -- Confirmed and still running: its reservation, until booked.
  update public.find_property_actor_runs set status = 'RUNNING', provider_run_id = 'p-live' where id = r_live;

  assert public.find_property_customer_micros(v_run) = 30000 + 38000 + 38000,
    'actual + confirmed-unknown + running; ambiguous and released excluded: ' || public.find_property_customer_micros(v_run);
  assert public.find_property_committed_micros(v_run) = 30000 + 38000 + 38000 + 38000,
    'the provider budget still counts the ambiguous start';
  assert (select count(*) from public.cost_events where request_id = v_run::text and pricing_state = 'UNPRICED' and cost_usd = 0.038) = 2,
    'the ambiguous start (and the unknown run) are booked as cost at their reservation, never zero';

  -- A START_AMBIGUOUS booking carries no customer charge even if a provider id was written.
  update public.find_property_actor_runs set provider_run_id = 'p-amb' where id = r_amb;
  assert public.find_property_customer_micros(v_run) = 30000 + 38000 + 38000, 'START_AMBIGUOUS never charged';

  -- The customer's live figure reads the customer sum: 106000 µ$ / 0.63 → $0.17 → 1.7 Credits.
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
  v := public.my_find_property_campaign(v_run);
  assert (v->>'creditsUsed')::numeric = 1.7, 'creditsUsed from confirmed work: ' || (v->>'creditsUsed');

  -- Photos column exists, empty by default.
  insert into public.supply_observations (id) values (default);
  assert (select image_urls from public.supply_observations limit 1) = '{}'::text[], 'image_urls defaults to empty';
end $$;
