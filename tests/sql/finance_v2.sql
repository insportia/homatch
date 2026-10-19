\set ON_ERROR_STOP on
-- Finance V2 (20261119130000_finance_v2_engine.sql): VAT extraction, paid discovery v1/v2,
-- the campaign spend a v2 charge is based on, and the read-only finance ledger.
do $$
declare
  v jsonb; s record; v_run uuid; v_job uuid := gen_random_uuid(); b1 uuid := '00000000-0000-0000-0000-0000000000b1';
  a1 uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  /* ── VAT is extracted from the VAT-inclusive price, never gross × 18% ── */
  select * into s from public.finance_split_gross(0.30, 1800);
  assert s.vat_usd = 0.045763 and s.net_usd = 0.254237, '$0.30: ' || s::text;
  select * into s from public.finance_split_gross(1.00, 1800);
  assert s.vat_usd = 0.152542 and s.net_usd = 0.847458, '$1.00: ' || s::text;
  select * into s from public.finance_split_gross(5.00, 1800);
  assert s.vat_usd = 0.762712 and s.net_usd = 4.237288, '$5.00: ' || s::text;
  select * into s from public.finance_split_gross(10.00, 1800);
  assert s.vat_usd = 1.525424 and s.net_usd = 8.474576, '$10.00: ' || s::text;
  select * into s from public.finance_split_gross(10.00, 0);
  assert s.vat_usd = 0 and s.net_usd = 10.00, 'zero-rated: no VAT';
  select * into s from public.finance_split_gross(10.00, 500);
  assert s.net_usd = 9.523810, 'another rate: ' || s::text;
  select * into s from public.finance_split_gross(10.00, null);
  assert s.vat_usd is null and s.net_usd is null, 'no tax profile: unknown, never 0';
  assert public.finance_vat_bps_at(now()) = 1800, 'the owner profile: 18% for every customer';
  assert public.finance_vat_bps_at('2019-01-01') is null, 'before any profile: unknown';

  /* ── Paid discovery: v2 splits the VAT-exclusive revenue; v1 kept as it was ── */
  assert public.paid_discovery_execution_micros('paid_discovery_37_63_vat_v2', 10000000) = 5338983, '$10 v2 execution';
  assert public.paid_discovery_execution_micros('paid_discovery_37_63_vat_v2', 5000000) = 2669491, '$5 v2 execution';
  assert public.paid_discovery_execution_micros('paid_discovery_37_63_vat_v2', 30000000) = 16016949, '$30 v2 execution';
  assert public.paid_discovery_execution_micros('paid_discovery_37_63_v1', 10000000) = 6300000, '$10 v1 execution unchanged';
  assert public.paid_discovery_execution_micros('anything_else', 10000000) is null, 'unknown policy: no budget';
  assert public.paid_discovery_gross_for_spend_micros('paid_discovery_37_63_vat_v2', 3000000) = 5619048, '$3 spend → $5.62 gross (v2)';
  assert public.paid_discovery_gross_for_spend_micros('paid_discovery_37_63_v1', 3000000) = 4761905, '$3 spend → $4.77 gross (v1)';
  assert public.paid_discovery_gross_for_spend_micros('paid_discovery_37_63_vat_v2', 5338983) <= 10000000, 'a fully used $10 budget never charges above $10';

  /* Both policy ids are accepted; anything else is refused. */
  insert into public.find_buyers_campaigns (matching_job_id, campaign_id, user_id, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros, pricing_policy)
  values (v_job, gen_random_uuid(), a1, 50, 10, 5000000, 2669491, 'paid_discovery_37_63_vat_v2');
  begin
    update public.find_buyers_campaigns set pricing_policy = 'made_up' where matching_job_id = v_job;
    assert false, 'unknown policy refused';
  exception when check_violation then null; end;

  /* ── The spend a v2 campaign is charged for = what its budget is enforced against ── */
  insert into public.find_buyers_actor_runs (matching_job_id, actor_key, status, reserved_micros, actual_micros, cost_basis, provider_run_id) values
    (v_job, 'A', 'SUCCEEDED', 400000, 250000, 'PROVIDER_REPORTED', 'r1'), -- actual
    (v_job, 'A', 'ABORTED', 300000, null, 'UNKNOWN', 'r2'),              -- confirmed, cost unknown → its reservation, never 0
    (v_job, 'A', 'RUNNING', 200000, null, null, 'r3'),                   -- confirmed, still running → held
    (v_job, 'A', 'RELEASED', 900000, null, 'NOT_STARTED', null),         -- released → 0
    (v_job, 'A', 'STARTING', 500000, null, null, null),                  -- never confirmed → HOMATCH's, not the customer's
    (v_job, 'A', 'FAILED', 700000, null, 'START_AMBIGUOUS', 'r6');       -- ambiguous start → HOMATCH's
  insert into public.find_buyers_cost_ledger (matching_job_id, kind, provider, model, estimated_micros, actual_micros, cost_state, after_settlement) values
    (v_job, 'AI', 'OPENAI', 'gpt-4o-mini', 1200, null, 'ESTIMATED', false),
    (v_job, 'TRANSLATION', 'OPENAI', 'gpt-4o-mini', 300, null, 'ESTIMATED', false),  -- translation counts (it consumes the budget)
    (v_job, 'AI', 'OPENAI', 'gpt-4o-mini', 999, null, 'ESTIMATED', true),            -- after settlement: not this charge
    (v_job, 'AI', 'OPENAI', 'gpt-4o-mini', 0, null, 'UNKNOWN', false),               -- unknown: not charged, reported UNPRICED
    (v_job, 'AI', 'OPENAI', 'gpt-4o-mini', 777, null, 'RELEASED', false),            -- released: neither charged nor COGS
    (v_job, 'PROVIDER', 'APIFY_MEMO23', null, 250000, 250000, 'ACTUAL', false);      -- Apify comes from the runs, not twice
  assert public.find_buyers_campaign_spend_micros(v_job) = 250000 + 300000 + 200000 + 1200 + 300,
    'customer spend = confirmed runs (actual / unknown at reservation / held) + OpenAI ledger: ' || public.find_buyers_campaign_spend_micros(v_job);
  assert (select count(*) from public.finance_v2_cost_lines where execution_id = v_job::text and cost_source = 'find_buyers_cost_ledger' and cost_status = 'UNPRICED' and cost_usd is null) = 1,
    'UNKNOWN OpenAI row is UNPRICED, never $0';
  assert not exists (select 1 from public.finance_v2_cost_lines where execution_id = v_job::text and cost_source = 'find_buyers_cost_ledger' and cost_usd = 0.000777),
    'RELEASED ledger row is not COGS';

  /* ── Budget extension follows the campaign's own policy ── */
  insert into public.billable_products (code, name, enabled, kill_switch)
  select 'FIND_CLIENTS', 'Find Clients', true, false where not exists (select 1 from public.billable_products where code = 'FIND_CLIENTS');
  update public.credit_accounts set balance = 1000 where user_id = a1;
  perform set_config('app.role', 'service_role', true);
  v := public.find_buyers_extend_budget(a1, v_job, 100, 'finance-v2-extend-1');
  assert (v->>'providerBudgetAddedMicros')::bigint = 2669491, 'v2: +50 credits ($5) adds 63% of $4.237288: ' || v::text;
  assert (select provider_budget_micros from public.find_buyers_campaigns where matching_job_id = v_job) = 2669491 * 2, '$10 v2 budget';
  v := public.find_buyers_extend_budget(a1, v_job, 100, 'finance-v2-extend-1');
  assert (v->>'duplicate')::boolean, 'an extension is applied once';
  -- A v1 campaign started before Finance V2 keeps 63% of the gross extension.
  insert into public.find_buyers_campaigns (matching_job_id, campaign_id, user_id, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros, pricing_policy)
  values ('00000000-0000-0000-0000-00000000f1f1', gen_random_uuid(), a1, 50, 10, 5000000, 3150000, 'paid_discovery_37_63_v1');
  v := public.find_buyers_extend_budget(a1, '00000000-0000-0000-0000-00000000f1f1', 100, 'finance-v2-extend-v1');
  assert (v->>'providerBudgetAddedMicros')::bigint = 3150000, 'v1 unchanged: ' || v::text;
  perform set_config('app.role', '', true);

  /* ── Find Property: a v2 campaign may reserve; the customer's live figure is v2 ── */
  update public.admin_settings set value = 'true' where key = 'find_property_social_enabled';
  if not found then insert into public.admin_settings (key, value) values ('find_property_social_enabled', 'true'); end if;
  insert into public.discovery_runs (user_id, status, billing_grant, pricing_policy, credits_per_usd, customer_value_micros, provider_budget_micros, offer_networks)
  values (b1, 'SEARCHING', '{"authorizedMaxCredits": 50}', 'paid_discovery_37_63_vat_v2', 10, 5000000, 2669491, array['FACEBOOK'])
  returning id into v_run;
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'fv2-1', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 1000);
  assert (v->>'ok')::boolean, 'a v2 campaign is a paid social campaign: ' || v::text;
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'fv2-big', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 5000, 25);
  assert (v->>'ok')::boolean and (v->>'remainingMicros')::bigint = 2669491 - 158000 - 1508000, 'room left inside $2.669491: ' || v::text;
  v := public.find_property_reserve_actor_run(v_run, 'FB_GROUP_POSTS', 'fv2-big2', null, 'FB_GROUP_POSTS', 'FACEBOOK', null, 5000, 25);
  assert v->>'reason' = 'CAMPAIGN_BUDGET', 'the v2 execution budget bounds the runs (v1 would have allowed $3.15): ' || v::text;
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
  v := public.my_find_property_campaign(v_run);
  -- Reserved but unconfirmed work is not customer spend yet: nothing used.
  assert (v->>'creditsUsed')::numeric >= 0 and (v->>'policy') = 'paid_discovery_37_63_vat_v2', v::text;
end $$;

/* ── The finance ledger: every line from its source, unpriced never 0 ── */
do $$
declare
  v jsonb; u1 uuid := gen_random_uuid(); s_fp uuid := gen_random_uuid(); s_bad uuid := gen_random_uuid(); r record;
begin
  -- Revenue: a Verify settlement (17.42 credits = $1.742), a match unlock (10 credits), a Meta fee and its partial release.
  insert into public.usage_events (user_id, product_code, charged_credits, released_credits, job_ref, created_at, metadata)
  values (u1, 'VERIFY', 17.42, 7.58, 'verify-job-1', now(), '{"profit_floor_shortfall": false}');
  insert into public.credit_ledger (user_id, amount, type, reference, created_at) values (u1, -10, 'MATCH_UNLOCK', 'match:abc', now());
  insert into public.meta_ads_ledger (user_id, entry_type, amount_cents, currency, campaign_id) values
    (u1, 'HOMATCH_FEE', -500, 'USD', '00000000-0000-0000-0000-00000000ca01'), (u1, 'FEE_RELEASE', 200, 'USD', '00000000-0000-0000-0000-00000000ca01');
  select * into r from public.finance_v2_revenue_lines where execution_id = 'verify-job-1';
  assert r.gross_usd = 1.742 and r.vat_usd = 0.265729 and r.net_usd = 1.476271 and r.homatch_allocation_usd is null, 'Verify: VAT out, no 37/63: ' || r::text;
  select * into r from public.finance_v2_revenue_lines where execution_id = 'match:abc';
  assert r.service_key = 'match_unlocks' and r.gross_usd = 1.00 and r.net_usd = 0.847458, 'match unlock: ' || r::text;
  assert (select sum(gross_usd) from public.finance_v2_revenue_lines where service_key = 'meta_ads_fee') = 3.00, 'fee $5 − release $2';

  -- Costs: Find Property search telemetry is priced at the call time; an unknown model is UNPRICED (NULL), never $0.
  insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from)
  select 'OPENAI', 'gpt-4o-mini', 'INPUT_TOKEN', 0.15, 1000000, 'USD', '2024-07-18' where not exists (select 1 from public.provider_price_book where model = 'gpt-4o-mini' and unit = 'INPUT_TOKEN');
  insert into public.discovery_marketplace_searches (id, telemetry, created_at) values
    (s_fp, '{"ai":[{"at":"2026-10-18T20:33:36Z","call":"RESULTS_INTELLIGENCE","model":"gpt-4o-mini","inputTokens":1991,"outputTokens":430,"costUsd":0}]}', '2026-10-18T20:26:47Z'),
    (s_bad, '{"ai":[{"at":"2026-10-18T20:00:00Z","call":"SEARCH_INTELLIGENCE","model":"not-a-real-model","inputTokens":100,"outputTokens":10}]}', '2026-10-18T19:59:00Z');
  select * into r from public.finance_v2_cost_lines where execution_id = s_fp::text;
  assert r.cost_usd = round(1991 * 0.15 / 1e6 + 430 * 0.60 / 1e6, 8) and r.cost_status = 'ESTIMATED' and r.model = 'gpt-4o-mini',
    'search 383ec400-like: 1,991 in / 430 out priced, not $0: ' || r::text;
  select * into r from public.finance_v2_cost_lines where execution_id = s_bad::text;
  assert r.cost_usd is null and r.cost_status = 'UNPRICED', 'unknown model: UNPRICED, NULL: ' || r::text;

  -- The old "$0 ESTIMATED" cost_events copy of a search call is not counted twice.
  insert into public.cost_events (provider, operation_type, source, units, cost_usd, pricing_state, "timestamp")
  values ('OPENAI', 'MARKETPLACE_RESULTS_INTELLIGENCE', 'marketplace-search', 2421, 0, 'ESTIMATED', now());
  assert not exists (select 1 from public.finance_v2_cost_lines where operation like 'MARKETPLACE_%' and cost_source = 'cost_events'), 'search copies excluded';
  -- An UNPRICED cost_events row is NULL in the ledger even if 0 was stored.
  insert into public.cost_events (provider, operation_type, units, cost_usd, pricing_state, "timestamp")
  values ('OPENAI', 'meta_ads_brief_interpret', 120, 0, 'UNPRICED', now());
  assert (select cost_usd from public.finance_v2_cost_lines where operation = 'meta_ads_brief_interpret' and cost_status = 'UNPRICED') is null, 'UNPRICED → NULL';
  -- An AI chat answer on a model with no rate is UNPRICED whatever cents were stored.
  insert into public.usage_events (user_id, product_code, charged_credits, provider, model, input_tokens, output_tokens, ai_cost_cents, job_ref, created_at)
  values (u1, 'AI_CHAT_RESPONSE', 0.2, 'OPENAI', 'unpriced-model', 900, 300, 0, 'chat-1', now());
  select * into r from public.finance_v2_cost_lines where execution_id = 'chat-1';
  assert r.cost_status = 'UNPRICED' and r.cost_usd is null, 'AI chat silent 0 caught: ' || r::text;

  /* HOMATCH Leads tiers (Find Buyers 2.0): an EXACT unlock is Leads revenue; a product no
     service lists is kept as 'unattributed', never dropped. */
  insert into public.usage_events (user_id, product_code, charged_credits, job_ref, created_at)
  values (u1, 'INTERNAL_LEAD_EXACT', 5, 'lead-exact-1', now()), (u1, 'SOME_FUTURE_PRODUCT', 2, 'future-1', now());
  select * into r from public.finance_v2_revenue_lines where execution_id = 'lead-exact-1';
  assert r.service_key = 'homatch_leads' and r.gross_usd = 0.5 and r.vat_usd = 0.076271, 'EXACT unlock: ' || r::text;
  select * into r from public.finance_v2_revenue_lines where execution_id = 'future-1';
  assert r.service_key = 'unattributed' and r.gross_usd = 0.2, 'unmapped product kept: ' || r::text;

  /* ── Admin RPCs: refused without admin, consistent with the views ── */
  begin
    perform public.finance_v2_services();
    assert false, 'non-admin refused';
  exception when others then
    assert sqlerrm = 'FORBIDDEN', sqlerrm;
  end;
  perform set_config('app.finance_admin', 'yes', true);
  v := (select e from jsonb_array_elements(public.finance_v2_services(now() - interval '400 days', now() + interval '1 day')) e where e->>'service' = 'find_property_search');
  assert (v->>'grossUsd')::numeric = 0 and (v->>'cogsUsd')::numeric > 0 and (v->>'unpricedLines')::int = 1, 'free search: $0 revenue, real COGS, unpriced flagged: ' || v::text;
  v := public.finance_v2_execution('verify', 'verify-job-1');
  assert (v #>> '{chain,netUsd}')::numeric = 1.476271 and (v #>> '{chain,profitComplete}')::boolean, v::text;
  v := public.finance_v2_quote('paid_discovery_37_63_vat_v2', 10, 2);
  assert (v->>'vatUsd')::numeric = 1.525424 and (v->>'executionAllocationUsd')::numeric = 5.338983
     and (v->>'homatchAllocationUsd')::numeric = 3.135593 and (v->>'withinExecution')::boolean, 'quote parity with the TS policy: ' || v::text;
  assert (v->>'chargeForCostCredits')::numeric = 37.5, '$2 of execution → $3.75 → 37.5 credits: ' || v::text;
  v := public.finance_v2_quote('fixed_retail_v1', 0.30);
  assert (v->>'netUsd')::numeric = 0.254237 and v->'executionAllocationUsd' = 'null'::jsonb, 'fixed $0.30: VAT out, no split';
  v := public.finance_v2_service_detail('verify', now() - interval '1 day', now() + interval '1 day');
  assert jsonb_array_length(v->'executions') >= 1 and v #>> '{policy,policy_id}' = 'verify_cost_floor_v1', v::text;
end $$;
