-- Homatch — let an operator see the economics before a customer does.
--
-- The simulator answers one question: if a run costs us X, what does each plan
-- pay, what do we keep, and does the margin floor bite?
--
-- WHY IT IS ITS OWN FUNCTION AND NOT JUST billing_price_quote()
--
-- billing_price_quote() reads the tax and fee rates from admin_settings,
-- because that is what a real charge must do. An operator asking "what happens
-- if VAT goes to 20%" must not have to CHANGE the live setting to find out.
-- So this takes overrides, defaults them to the live values, and never writes
-- anything.
--
-- It is admin-only and returns the full internal picture: landed cost, the
-- profit pool, the pre-floor plan price, the floor, the margin and the markup.
-- None of that may ever reach a customer, which is why it is a separate
-- function from billing_quote_for_me() rather than a flag on it.
--
-- VERIFIED against the mandate's worked example on production:
--   raw 10c, +18%  -> landed 11.80c, pool 38.20c, floor 16.86c
--   FREE     50.00c  profit 38.20c  margin 76.40%  markup 323.73%  5.00 CR
--   VIP      40.45c (pre-round)                                    4.05 CR
--   PREMIUM  30.90c                                                3.09 CR
CREATE OR REPLACE FUNCTION public.billing_simulate_pricing(
  p_product_code text,
  p_raw_provider_cents numeric DEFAULT 10,
  p_ai_cents numeric DEFAULT 0,
  p_tax_bps numeric DEFAULT NULL,
  p_fee_bps numeric DEFAULT NULL,
  p_standard_retail_cents numeric DEFAULT NULL,
  p_min_margin_bps numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_p record;
  v_tax numeric := COALESCE(p_tax_bps, public.billing_setting_num('billing_cogs_tax_bps', 1800));
  v_fee numeric := COALESCE(p_fee_bps, public.billing_setting_num('billing_cogs_fee_bps', 0));
  v_min numeric;
  v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
  v_dp integer := public.billing_setting_num('billing_credit_rounding_dp', 2)::integer;
  v_base numeric;
  v_landed numeric;
  v_retail numeric;
  v_multiple numeric;
  v_standard numeric;
  v_pool numeric;
  v_plans jsonb := '[]'::jsonb;
  v_plan record;
  v_plan_price numeric;
  v_floor numeric;
  v_final numeric;
  v_credits numeric;
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_p from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT: %', p_product_code; end if;

  v_retail := COALESCE(p_standard_retail_cents, v_p.standard_retail_cents);
  v_min := COALESCE(p_min_margin_bps,
    greatest(v_p.min_gross_margin_bps, public.billing_setting_num('billing_min_gross_margin_bps', 3000)));
  if v_min >= 10000 then raise exception 'INVALID_MIN_MARGIN'; end if;
  if v_p.reference_landed_cogs_cents <= 0 then
    raise exception 'PRODUCT_HAS_NO_REFERENCE_COGS: % cannot be priced', p_product_code;
  end if;

  v_base   := COALESCE(p_raw_provider_cents, 0) + COALESCE(p_ai_cents, 0);
  v_landed := round(v_base * (1 + v_tax/10000.0 + v_fee/10000.0), 4);

  -- The same markup-multiple model the live engine uses, so the simulator
  -- cannot flatter a price the real charge would not produce.
  v_multiple := v_retail / v_p.reference_landed_cogs_cents;
  v_standard := round(v_landed * v_multiple, 4);
  v_pool     := v_standard - v_landed;
  v_floor    := round(v_landed / (1 - v_min/10000.0), 4);

  for v_plan in select * from public.billing_plans where enabled order by sort_order loop
    v_plan_price := round(v_landed + v_pool * (1 - v_plan.profit_share_to_customer_bps/10000.0), 4);
    v_final := greatest(v_plan_price, v_floor);
    v_credits := round(round(v_final * v_cpu / 100.0, 4), v_dp);
    if round(v_credits * 100.0 / v_cpu, 4) < v_floor then
      v_credits := round(v_credits + power(10, -v_dp)::numeric, v_dp);
    end if;
    v_final := round(v_credits * 100.0 / v_cpu, 4);

    v_plans := v_plans || jsonb_build_object(
      'plan_code', v_plan.code,
      'plan_name', v_plan.name,
      'profit_share_to_customer_bps', v_plan.profit_share_to_customer_bps,
      'plan_price_before_floor_cents', v_plan_price,
      'floor_applied', (v_floor > v_plan_price),
      'final_price_cents', v_final,
      'gross_profit_cents', round(v_final - v_landed, 4),
      'gross_margin_bps', case when v_final > 0 then round((v_final - v_landed)/v_final*10000)::integer else 0 end,
      'markup_bps', case when v_landed > 0 then round((v_final - v_landed)/v_landed*10000)::integer else 0 end,
      'credits', v_credits);
  end loop;

  return jsonb_build_object(
    'product_code', p_product_code,
    'inputs', jsonb_build_object(
      'raw_provider_cents', COALESCE(p_raw_provider_cents, 0),
      'ai_cents', COALESCE(p_ai_cents, 0),
      'tax_bps', v_tax, 'fee_bps', v_fee,
      'standard_retail_cents', v_retail,
      'min_gross_margin_bps', v_min,
      'credits_per_usd', v_cpu),
    'landed_cogs_cents', v_landed,
    'standard_price_cents', v_standard,
    'base_profit_pool_cents', v_pool,
    'floor_price_cents', v_floor,
    'markup_multiple', round(v_multiple, 6),
    'plans', v_plans);
end;
$fn$;

REVOKE ALL ON FUNCTION public.billing_simulate_pricing(text, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
-- Admin-callable: the function checks is_admin() itself, and the whole point
-- is that an operator can use it from Admin -> Pricing.
GRANT EXECUTE ON FUNCTION public.billing_simulate_pricing(text, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.billing_simulate_pricing(text, numeric, numeric, numeric, numeric, numeric, numeric) IS
  'Admin pricing simulator. Returns the FULL internal picture including landed cost, profit pool and margin. Never expose its output to a customer; billing_quote_for_me() is the customer-facing equivalent.';
