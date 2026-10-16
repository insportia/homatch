\set ON_ERROR_STOP on
-- 20261107091700_paid_discovery_pricing_policy.sql on top of the research-budget checks:
-- campaigns stamped with the 37/63 policy widen their provider budget by 63% of each
-- extension; legacy campaigns keep their 50% share; nothing is charged twice.
do $$
declare v jsonb; v_err text;
begin
  assert public.paid_discovery_provider_share_bps() = 6300, '63% provider share';
  assert (select provider_budget_micros from public.find_buyers_campaigns
           where matching_job_id = '00000000-0000-0000-0000-00000000e001') = 25000000, 'legacy campaign untouched';
  begin
    update public.find_buyers_campaigns set pricing_policy = 'made_up' where matching_job_id = '00000000-0000-0000-0000-00000000e001';
    assert false, 'unknown policy refused';
  exception when check_violation then null; end;

  -- A $5 campaign under the policy: $3.15 for providers, $1.85 HOMATCH.
  insert into public.find_buyers_campaigns (matching_job_id, campaign_id, property_id, user_id, credits_committed,
    customer_value_micros, provider_budget_micros, finalized_at, pricing_policy)
  values ('00000000-0000-0000-0000-00000000e002', gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1',
    '00000000-0000-0000-0000-0000000000a1', 50, 5000000, 3150000, null, 'paid_discovery_37_63_v1');
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 850, 'start balance';

  perform set_config('app.role', 'service_role', true);
  -- $5 → $10 total: +50 credits reserved, provider ceiling +$3.15 → $6.30 (63%, not 50%).
  v := public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e002', 100, 'policy-key-0001');
  assert (v->>'providerBudgetAddedMicros')::bigint = 3150000, '63% of the extension: ' || v::text;
  assert (select provider_budget_micros from public.find_buyers_campaigns where matching_job_id = '00000000-0000-0000-0000-00000000e002') = 6300000, '$10 → $6.30 providers';
  assert (select customer_value_micros - provider_budget_micros from public.find_buyers_campaigns where matching_job_id = '00000000-0000-0000-0000-00000000e002') = 3700000, '$10 → $3.70 HOMATCH';
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 800, 'reserved once';
  v := public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e002', 100, 'policy-key-0001');
  assert (v->>'duplicate')::boolean, 'idempotent';
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 800, 'no duplicate deduction';

  -- Cancelled before using the extension: nothing beyond the first reservation → all released.
  v := public.find_buyers_settle_extensions('00000000-0000-0000-0000-00000000e002', 0);
  assert (v->>'chargedCredits')::numeric = 0 and (v->>'releasedCredits')::numeric = 50, 'unused extension released: ' || v::text;
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 850, 'balance restored';
end $$;
