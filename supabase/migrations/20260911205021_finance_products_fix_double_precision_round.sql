-- percentile_cont() returns double precision, and Postgres has no
-- round(double precision, integer). The median and p90 COGS columns therefore
-- raised 42883 as soon as a product had any priced execution — latent until
-- there was data to aggregate. Cast to numeric before rounding.
--
-- This version also adds unpriced_events, gross_profit_usd and
-- cogs_per_execution_usd, which the Products tab renders.

CREATE OR REPLACE FUNCTION public.finance_products(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz; v_cpu numeric;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  v_cpu := public.billing_setting_num('credits_per_usd', 10);

  return COALESCE((select jsonb_agg(t) from (
    select jsonb_build_object(
      'product_code', bp.code,
      'name', bp.name,
      'enabled', bp.enabled,
      'pricing_active', bp.pricing_active,
      -- Provider spend attributed to this product.
      'provider_cogs', round(COALESCE((select sum(cost_usd) from public.finance_cost_facts f
          where f.is_cogs and f.product = bp.code and f.occurred_at >= v_from), 0), 6),
      'cost_events', COALESCE((select count(*) from public.finance_cost_facts f
          where f.is_cogs and f.product = bp.code and f.occurred_at >= v_from), 0),
      'unpriced_events', COALESCE((select count(*) from public.finance_cost_facts f
          where f.is_unpriced and f.product = bp.code and f.occurred_at >= v_from), 0),
      -- Customer side, from usage_events: what was actually charged.
      'executions', COALESCE((select count(*) from public.usage_events u
          where u.product_code = bp.code and u.created_at >= v_from), 0),
      'included_executions', COALESCE((select count(*) from public.usage_events u
          where u.product_code = bp.code and u.allowance_funded and u.created_at >= v_from), 0),
      'payg_executions', COALESCE((select count(*) from public.usage_events u
          where u.product_code = bp.code and not u.allowance_funded and u.charged_credits > 0
            and u.created_at >= v_from), 0),
      'credits_charged', round(COALESCE((select sum(charged_credits) from public.usage_events u
          where u.product_code = bp.code and u.created_at >= v_from), 0), 4),
      'revenue_usd', round(COALESCE((select sum(charged_credits) from public.usage_events u
          where u.product_code = bp.code and u.created_at >= v_from), 0) / v_cpu, 6),
      'gross_profit_usd', round(
          COALESCE((select sum(charged_credits) from public.usage_events u
            where u.product_code = bp.code and u.created_at >= v_from), 0) / v_cpu
        - COALESCE((select sum(cost_usd) from public.finance_cost_facts f
            where f.is_cogs and f.product = bp.code and f.occurred_at >= v_from), 0), 6),
      'avg_cogs_usd', (select round((avg(landed_cogs_cents)/100)::numeric, 6) from public.usage_events u
          where u.product_code = bp.code and u.created_at >= v_from and u.landed_cogs_cents > 0),
      'median_cogs_usd', (select round(
            (percentile_cont(0.5) within group (order by landed_cogs_cents)/100)::numeric, 6)
          from public.usage_events u where u.product_code = bp.code
            and u.created_at >= v_from and u.landed_cogs_cents > 0),
      'p90_cogs_usd', (select round(
            (percentile_cont(0.9) within group (order by landed_cogs_cents)/100)::numeric, 6)
          from public.usage_events u where u.product_code = bp.code
            and u.created_at >= v_from and u.landed_cogs_cents > 0),
      'cogs_per_execution_usd', (select case when count(*) > 0
            then round((sum(landed_cogs_cents)/100.0/count(*))::numeric, 6) end
          from public.usage_events u where u.product_code = bp.code and u.created_at >= v_from)
    ) as t
    from public.billable_products bp
    order by bp.sort_order
  ) x), '[]'::jsonb);
end;
$fn$;

REVOKE ALL ON FUNCTION public.finance_products(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_products(integer) TO authenticated, service_role;
