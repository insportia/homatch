\set ON_ERROR_STOP on
-- Admin Demand Intelligence RPCs: admin-only, combinable filters, audited profile and
-- export, real 37/63 campaign money (a fully used $5 campaign: $5 charged, $3.15 spend, $1.85 profit).
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000b1'; b2 uuid := '00000000-0000-0000-0000-0000000000b2';
  a1 uuid := '00000000-0000-0000-0000-0000000000a1'; f1 uuid := '00000000-0000-0000-0000-0000000000f1';
  v jsonb; v_res uuid := gen_random_uuid(); v_job uuid := gen_random_uuid(); v_err text;
begin
  insert into public.discovery_marketplace_searches (user_id, request) values
    (b1, '{"transactionType":"BUY","city":"თბილისი","districts":["Krtsanisi"],"propertyType":"APARTMENT","priceMinUsd":80000,"priceMaxUsd":250000,"bedrooms":{"min":2,"max":2},"areaMinSqm":50,"areaMaxSqm":120}');
  insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id) values (b1, a1, f1);
  insert into public.supply_observations (city, district) values ('Tbilisi', 'კრწანისი'), ('Тбилиси', 'Vake');

  -- A finished $5 campaign under the 37/63 policy that used its whole provider budget.
  insert into public.usage_reservations (id, user_id, product_code, status, authorized_max_credits, reserved_credits, settled_credits)
  values (v_res, a1, 'FIND_CLIENTS', 'SETTLED', 50, 50, 50);
  insert into public.matching_jobs (id, billing_grant, started_at, completed_at) values (v_job, jsonb_build_object('reservationId', v_res), now() - interval '2 hours', now());
  insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros, finalized_at, pricing_policy)
  values (v_job, f1, a1, 50, 10, 5000000, 3150000, now(), 'paid_discovery_37_63_v1');
  insert into public.cost_events (property_id, job_id, cost_usd, pricing_state, timestamp) values (f1, v_job, 2.00, 'ACTUAL', now() - interval '1 hour'), (f1, v_job, 1.15, 'ESTIMATED', now() - interval '30 minutes');

  -- Not an admin.
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
  begin perform public.admin_demand_customers('{}', 'last_seen_desc', 25, 0); assert false, 'non-admin listed';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_demand_customer_profile(b1); assert false, 'non-admin profile';
  exception when insufficient_privilege then null; end;

  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
  -- Combinable filters: city in Russian, district in Georgian, budget overlap, rooms, area, basis, contacts.
  v := public.admin_demand_customers('{"side":"BUY","city":"Тбилиси","district":"კრწანისი","budget_min":"100000","budget_max":"300000","rooms_min":"2","area_min":"60","basis":"EXPLICIT"}', 'strength_desc', 25, 0);
  assert (v->>'total')::int = 1 and v->'rows'->0->>'user_id' = b1::text, v::text;
  v := public.admin_demand_customers('{"side":"BUY","city":"Tbilisi","budget_min":"300000"}', 'strength_desc', 25, 0);
  assert (v->>'total')::int = 0, 'budget filter excludes: ' || v::text;
  v := public.admin_demand_customers('{"has_contacts":"true"}', 'last_seen_desc', 25, 0);
  assert (v->>'total')::int = 1, 'contacts filter';
  v := public.admin_demand_customers('{"q":"buyer1@"}', 'last_seen_desc', 25, 0);
  assert (v->>'total')::int = 1, 'search by email';
  v := public.admin_demand_customers('{"side":"SELL"}', 'last_seen_desc', 25, 0);
  assert (select bool_and(r->>'user_id' in (a1::text, '00000000-0000-0000-0000-0000000000a2')) from jsonb_array_elements(v->'rows') r), 'only listing owners are sellers';
  assert (v->>'total')::int >= 1;
  v := public.admin_demand_customers('{}', 'last_seen_desc', 1, 1);
  assert jsonb_array_length(v->'rows') = 1 and (v->>'total')::int >= 3, 'paginated';

  -- Profile: audited, complete.
  v := public.admin_demand_customer_profile(b1);
  assert v->'identity'->>'email' = 'buyer1@x.test';
  assert jsonb_array_length(v->'timeline') >= 2 and jsonb_array_length(v->'contacts') = 1 and jsonb_array_length(v->'freeSearches') >= 1;
  assert exists (select 1 from public.admin_audit_log where action = 'DEMAND_PROFILE_VIEWED' and target_id = b1), 'profile view audited';

  -- Export: audited with filters and count.
  v := public.admin_demand_export('{"side":"BUY"}', 1000, 0);
  assert (v->>'count')::int >= 1;
  assert exists (select 1 from public.admin_audit_log where action = 'DEMAND_INTELLIGENCE_EXPORT' and (metadata->>'rows')::int = (v->>'count')::int);

  -- Analytics: real counts and the 37/63 money.
  v := public.admin_demand_analytics(90, null);
  assert (v#>>'{people,buyers}')::int >= 1 and (v#>>'{people,sellers}')::int >= 1, v::text;
  assert (v#>>'{searches,freeCreditsCharged}')::int = 0;
  assert (select (g->>'chargedUsd')::numeric = 5.00 and (g->>'providerSpendUsd')::numeric = 3.15 and (g->>'homatchProfitUsd')::numeric = 1.85
            from jsonb_array_elements(v#>'{campaignEconomics,findBuyers}') g where g->>'policy' = 'paid_discovery_37_63_v1'), v#>>'{campaignEconomics}';
  assert (v#>>'{campaignEconomics,policy,homatchShareBps}')::int = 3700;
  -- An unpriced provider run makes the spend (and the profit) unknown, never $0.
  insert into public.cost_events (property_id, job_id, cost_usd, pricing_state) values (f1, v_job, 0.20, 'UNPRICED');
  v := public.admin_demand_analytics(90, null);
  assert (select g->'providerSpendUsd' = 'null'::jsonb and g->'homatchProfitUsd' = 'null'::jsonb and (g->>'unknownCostCampaigns')::int = 1
            from jsonb_array_elements(v#>'{campaignEconomics,findBuyers}') g where g->>'policy' = 'paid_discovery_37_63_v1'), v#>>'{campaignEconomics}';
  v := public.admin_demand_analytics(90, 'თბილისი');
  assert v->>'city' = 'tbilisi';
  assert exists (select 1 from jsonb_array_elements(v->'demandVsSupply') d where d->>'label' = 'krtsanisi' and (d->>'demand')::int >= 1 and (d->>'portalSupply')::int = 1), v->>'demandVsSupply';
end $$;
