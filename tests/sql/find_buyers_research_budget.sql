\set ON_ERROR_STOP on
do $$
declare v jsonb; v_bal numeric; v_err text;
begin
  assert (select value from public.admin_settings where key = 'search_budget_presets_find_clients') = '[100, 500, 1000, 1500, 2000]'::jsonb, 'approved ladder';
  assert (select value from public.admin_settings where key = 'search_budget_recommended_find_clients') = '100'::jsonb, 'recommended 100';

  perform set_config('app.role', 'service_role', true);
  -- 100 → 500 total: only 400 more is reserved.
  v := public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 500, 'extend-key-0001');
  assert (v->>'additionalCredits')::int = 400 and (v->>'totalCredits')::int = 500, 'only the difference: ' || v::text;
  select balance into v_bal from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1';
  assert v_bal = 600, 'balance 1000 → 600: ' || v_bal;
  assert (select provider_budget_micros from public.find_buyers_campaigns) = 25000000, 'provider ceiling widened by 400cr × 50%';
  -- Same key again: no second reservation.
  v := public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 500, 'extend-key-0001');
  assert (v->>'duplicate')::boolean, 'idempotent';
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 600, 'no double reserve';
  -- A total that is not higher is refused.
  begin
    perform public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 500, 'extend-key-0002');
    assert false, 'not higher';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%TOTAL_NOT_HIGHER%', v_err; end;
  -- Somebody else's campaign is refused.
  begin
    perform public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000e001', 1000, 'extend-key-0003');
    assert false, 'foreign campaign';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%UNKNOWN_CAMPAIGN%', v_err; end;

  -- Finalize: the campaign used 150 credits beyond its original 100 → 150 of the 400 extension charged, 250 released.
  v := public.find_buyers_settle_extensions('00000000-0000-0000-0000-00000000e001', 150);
  assert (v->>'chargedCredits')::numeric = 150 and (v->>'releasedCredits')::numeric = 250, 'charged actual usage only: ' || v::text;
  assert (select balance from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 850, 'unused returned to the wallet';
  v := public.find_buyers_settle_extensions('00000000-0000-0000-0000-00000000e001', 150);
  assert (v->>'chargedCredits')::numeric = 0, 'settling twice charges nothing';

  update public.find_buyers_campaigns set finalized_at = now();
  begin
    perform public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 1000, 'extend-key-0004');
    assert false, 'finished';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%CAMPAIGN_FINISHED%', v_err; end;

  perform set_config('app.role', 'authenticated', true);
  begin
    perform public.find_buyers_extend_budget('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 2000, 'extend-key-0005');
    assert false, 'service only';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%FORBIDDEN%', v_err; end;
end $$;
