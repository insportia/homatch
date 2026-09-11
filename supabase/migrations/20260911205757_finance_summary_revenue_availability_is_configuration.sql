-- "Is revenue data available" was being answered with "was there any revenue
-- this month". Those are different questions, and conflating them makes the
-- dashboard lie in one specific case: a properly configured payment provider
-- in a genuinely quiet month would render NOT CONFIGURED instead of $0.00.
--
-- Availability is a question about CONFIGURATION. Zero revenue from a working
-- provider is a real, reportable fact and must be shown as zero.

CREATE OR REPLACE FUNCTION public.finance_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_tz text := public.finance_tz();
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_prev_month_start timestamptz := v_month_start - interval '1 month';
  v_spend_today numeric; v_spend_mtd numeric; v_spend_prev_month numeric;
  v_rev_today numeric; v_rev_mtd numeric;
  v_fixed_monthly numeric;
  v_unpriced_events integer; v_unpriced_qty numeric;
  v_days_elapsed numeric; v_days_in_month numeric;
  v_reserved numeric; v_provider_configured boolean;
begin
  perform public.finance_require_admin();

  select COALESCE(sum(cost_usd),0) into v_spend_today
    from public.finance_cost_facts where is_cogs and occurred_at >= v_day_start;
  select COALESCE(sum(cost_usd),0) into v_spend_mtd
    from public.finance_cost_facts where is_cogs and occurred_at >= v_month_start;
  select COALESCE(sum(cost_usd),0) into v_spend_prev_month
    from public.finance_cost_facts
   where is_cogs and occurred_at >= v_prev_month_start and occurred_at < v_month_start;

  select COALESCE(sum(public.fx_to_usd(total_cents::numeric/100, currency, created_at)),0) into v_rev_today
    from public.payments where status='COMPLETED' and created_at >= v_day_start;
  select COALESCE(sum(public.fx_to_usd(total_cents::numeric/100, currency, created_at)),0) into v_rev_mtd
    from public.payments where status='COMPLETED' and created_at >= v_month_start;

  select COALESCE(sum(public.finance_monthly_equivalent_cents(amount_cents, billing_frequency)),0)/100
    into v_fixed_monthly
    from public.finance_fixed_expenses
   where active and superseded_by is null
     and (ends_at is null or ends_at >= current_date);

  select count(*), COALESCE(sum(quantity),0) into v_unpriced_events, v_unpriced_qty
    from public.finance_cost_facts where is_cogs and is_unpriced;

  select COALESCE(sum(reserved),0) into v_reserved from public.credit_accounts;

  -- Configured means a real, non-mock payment has ever settled, or the
  -- provider is registered as having credentials. Either is evidence that a
  -- zero is a real zero.
  v_provider_configured :=
    exists (select 1 from public.payments where status='COMPLETED' and provider not like '%mock%')
    or exists (select 1 from public.finance_provider_registry
                where provider_id = 'STRIPE' and credentials_present);

  v_days_elapsed := greatest(extract(day from (now() AT TIME ZONE v_tz)), 1);
  v_days_in_month := extract(day from (date_trunc('month', now() AT TIME ZONE v_tz)
                                       + interval '1 month - 1 day'));

  return jsonb_build_object(
    'currency', 'USD',
    'timezone', v_tz,
    'day_start_utc', v_day_start,
    'month_start_utc', v_month_start,
    'spend_today', round(v_spend_today, 4),
    'spend_mtd', round(v_spend_mtd, 4),
    'spend_prev_month', round(v_spend_prev_month, 4),
    'revenue_today', round(v_rev_today, 4),
    'revenue_mtd', round(v_rev_mtd, 4),
    'gross_profit_today', round(v_rev_today - v_spend_today, 4),
    'gross_profit_mtd', round(v_rev_mtd - v_spend_mtd, 4),
    'gross_margin_bps', case when v_rev_mtd > 0
      then round((v_rev_mtd - v_spend_mtd) / v_rev_mtd * 10000)::integer else null end,
    'variable_cogs_mtd', round(v_spend_mtd, 4),
    'fixed_monthly', round(v_fixed_monthly, 4),
    'total_company_spend_mtd', round(v_spend_mtd + v_fixed_monthly, 4),
    'operating_contribution_mtd', round(v_rev_mtd - v_spend_mtd - v_fixed_monthly, 4),
    'burn_daily_avg', round(v_spend_mtd / v_days_elapsed, 4),
    'burn_projected_month_end', round((v_spend_mtd / v_days_elapsed) * v_days_in_month + v_fixed_monthly, 4),
    'burn_projection_method', 'MTD variable spend / days elapsed x days in month, plus fixed commitments',
    'days_elapsed', v_days_elapsed,
    'days_in_month', v_days_in_month,
    'unpriced_events', v_unpriced_events,
    'unpriced_quantity', v_unpriced_qty,
    'credits_reserved', round(v_reserved, 4),
    'payment_provider_configured', v_provider_configured,
    'revenue_data_available', v_provider_configured
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.finance_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_summary() TO authenticated, service_role;
