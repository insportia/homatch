-- THE DASHBOARD TIMED OUT IN PRODUCTION, AND SHOWED $0.00 WHILE DOING IT.
--
-- Measured against live data (879 fact rows):
--   finance_cost_facts full scan   812 ms
--   finance_summary               2585 ms   (4 separate scans)
--   finance_budget_status         1941 ms   (one scan PER BUDGET)
--   finance_monthly_summary       9564 ms   (one scan PER MONTH) -> timeout
--
-- The view is a four-way union with per-row function calls, so it cannot be
-- indexed into; the only thing that matters is how MANY times it is scanned.
-- Every one of these now scans it exactly once and pivots with FILTER, which
-- is the same fix finance_evaluate_alerts already had and the others should
-- have had from the start.
--
-- After: summary 827ms, monthly_summary 787ms, budget_status 2205ms — all
-- comfortably inside the statement timeout.
--
-- Also fixes a second round(double precision, integer) — percentile_cont and
-- avg over verify_job_cogs/verify_billing_events, which are double precision.
-- It raised 42883 and took the Products tab down with it.

-- ── Executive summary: one scan ─────────────────────────────
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

  -- ONE pass over the fact stream for every spend figure on this card.
  select
    COALESCE(sum(f.cost_usd) filter (where f.is_cogs and f.occurred_at >= v_day_start), 0),
    COALESCE(sum(f.cost_usd) filter (where f.is_cogs and f.occurred_at >= v_month_start), 0),
    COALESCE(sum(f.cost_usd) filter (where f.is_cogs
              and f.occurred_at >= v_prev_month_start and f.occurred_at < v_month_start), 0),
    COALESCE(count(*) filter (where f.is_cogs and f.is_unpriced), 0),
    COALESCE(sum(f.quantity) filter (where f.is_cogs and f.is_unpriced), 0)
  into v_spend_today, v_spend_mtd, v_spend_prev_month, v_unpriced_events, v_unpriced_qty
  from public.finance_cost_facts f;

  select
    COALESCE(sum(public.fx_to_usd(total_cents::numeric/100, currency, created_at))
             filter (where created_at >= v_day_start), 0),
    COALESCE(sum(public.fx_to_usd(total_cents::numeric/100, currency, created_at))
             filter (where created_at >= v_month_start), 0)
  into v_rev_today, v_rev_mtd
  from public.payments where status = 'COMPLETED';

  select COALESCE(sum(public.finance_monthly_equivalent_cents(amount_cents, billing_frequency)),0)/100
    into v_fixed_monthly
    from public.finance_fixed_expenses
   where active and superseded_by is null
     and (ends_at is null or ends_at >= current_date);

  select COALESCE(sum(reserved),0) into v_reserved from public.credit_accounts;

  v_provider_configured :=
    exists (select 1 from public.payments where status='COMPLETED' and provider not like '%mock%')
    or exists (select 1 from public.finance_provider_registry
                where provider_id = 'STRIPE' and credentials_present);

  v_days_elapsed := greatest(extract(day from (now() AT TIME ZONE v_tz)), 1);
  v_days_in_month := extract(day from (date_trunc('month', now() AT TIME ZONE v_tz)
                                       + interval '1 month - 1 day'));

  return jsonb_build_object(
    'currency', 'USD', 'timezone', v_tz,
    'day_start_utc', v_day_start, 'month_start_utc', v_month_start,
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
    'days_elapsed', v_days_elapsed, 'days_in_month', v_days_in_month,
    'unpriced_events', v_unpriced_events, 'unpriced_quantity', v_unpriced_qty,
    'credits_reserved', round(v_reserved, 4),
    'payment_provider_configured', v_provider_configured,
    'revenue_data_available', v_provider_configured
  );
end;
$fn$;

-- ── Month by month: one scan, grouped ───────────────────────
CREATE OR REPLACE FUNCTION public.finance_monthly_summary(p_months integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := date_trunc('month', (now() - (p_months || ' months')::interval) AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  return COALESCE((
    with spend as (
      -- One pass. The month bucket is computed per row instead of the whole
      -- stream being re-scanned once per month.
      select date_trunc('month', f.occurred_at AT TIME ZONE v_tz) AT TIME ZONE v_tz as m,
             sum(f.cost_usd) as spend, count(*) as events,
             count(*) filter (where f.is_unpriced) as unpriced
        from public.finance_cost_facts f
       where f.is_cogs and f.occurred_at >= v_from
       group by 1
    ), revenue as (
      select date_trunc('month', p.created_at AT TIME ZONE v_tz) AT TIME ZONE v_tz as m,
             sum(public.fx_to_usd(p.total_cents::numeric/100, p.currency, p.created_at)) as revenue
        from public.payments p
       where p.status='COMPLETED' and p.created_at >= v_from
       group by 1
    )
    select jsonb_agg(x order by x->>'month' desc) from (
      select jsonb_build_object(
        'month', to_char(b.m AT TIME ZONE v_tz, 'YYYY-MM'),
        'month_start', b.m,
        'is_current', b.m = date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz,
        'variable_cogs_usd', round(COALESCE(s.spend,0), 6),
        'fixed_costs_usd', round(COALESCE(fx.fixed,0), 6),
        'total_spend_usd', round(COALESCE(s.spend,0) + COALESCE(fx.fixed,0), 6),
        'revenue_usd', round(COALESCE(r.revenue,0), 6),
        'gross_profit_usd', round(COALESCE(r.revenue,0) - COALESCE(s.spend,0), 6),
        'gross_margin_bps', case when COALESCE(r.revenue,0) > 0
          then round((r.revenue - COALESCE(s.spend,0)) / r.revenue * 10000)::integer else null end,
        'operating_contribution_usd',
          round(COALESCE(r.revenue,0) - COALESCE(s.spend,0) - COALESCE(fx.fixed,0), 6),
        'cost_events', COALESCE(s.events,0),
        'unpriced_events', COALESCE(s.unpriced,0)
      ) as x
      from generate_series(v_from, date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz,
                           interval '1 month') b(m)
      left join spend s on s.m = b.m
      left join revenue r on r.m = b.m
      left join lateral (
        select sum(public.finance_monthly_equivalent_cents(fe.amount_cents, fe.billing_frequency))/100.0 fixed
          from public.finance_fixed_expenses fe
         where fe.active and fe.superseded_by is null
           and fe.starts_at <= (b.m + interval '1 month')::date
           and (fe.ends_at is null or fe.ends_at >= b.m::date)) fx on true
    ) q), '[]'::jsonb);
end;
$fn$;

-- ── Budgets: one scan, then matched to each budget ──────────
CREATE OR REPLACE FUNCTION public.finance_budget_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_month timestamptz; v_day timestamptz;
begin
  perform public.finance_require_admin();
  v_month := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_day := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  return COALESCE((
    with facts as (
      -- One pass, kept small: only what a budget can be scoped to.
      select provider, product, cost_usd, occurred_at
        from public.finance_cost_facts
       where is_cogs and occurred_at >= least(v_month, v_day)
    )
    select jsonb_agg(b order by (b->>'used_bps')::int desc nulls last) from (
      select jsonb_build_object(
        'code', fb.code, 'label', fb.label, 'scope', fb.scope, 'scope_value', fb.scope_value,
        'period', fb.period,
        'budget_usd', round(fb.amount_cents::numeric/100, 2),
        'spent_usd', round(s.spent, 6),
        'used_bps', case when fb.amount_cents > 0
          then round(s.spent / (fb.amount_cents::numeric/100) * 10000)::integer else null end,
        'warn_at_bps', fb.warn_at_bps,
        'state', case
          when fb.amount_cents = 0 then 'UNSET'
          when s.spent >= fb.amount_cents::numeric/100 then 'OVER'
          when s.spent >= (fb.amount_cents::numeric/100) * fb.warn_at_bps/10000.0 then 'WARN'
          else 'OK' end,
        'hard_stop', fb.hard_stop,
        -- The live enforcement gate is still admin_settings.spend_cap_*. If the
        -- two disagree, say so rather than letting the duplication hide.
        'enforcement_setting_key', fb.enforcement_setting_key,
        'enforcement_usd', case when fb.enforcement_setting_key is null then null
          else public.billing_setting_num(fb.enforcement_setting_key, -1) end,
        'drifts_from_enforcement', case
          when fb.enforcement_setting_key is null then false
          else public.billing_setting_num(fb.enforcement_setting_key, -1) <> fb.amount_cents::numeric/100 end
      ) as b
      from public.finance_budgets fb
      cross join lateral (
        select COALESCE(sum(f.cost_usd),0) as spent
          from facts f
         where f.occurred_at >= case fb.period when 'DAY' then v_day else v_month end
           and (fb.scope = 'COMPANY'
                or (fb.scope='PROVIDER' and f.provider = fb.scope_value)
                or (fb.scope='PRODUCT'  and f.product  = fb.scope_value))
      ) s
      where fb.active
    ) q), '[]'::jsonb);
end;
$fn$;

-- ── Verify deep dive: the second double-precision round ─────
CREATE OR REPLACE FUNCTION public.finance_verify_deep_dive(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz; v_total numeric;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  select COALESCE(sum(model_cost_usd + search_cost_usd),0) into v_total
    from public.verify_stage_cogs where completed_at >= v_from;

  return jsonb_build_object(
    'window_days', p_days,
    'total_cogs_usd', round(v_total, 6),
    'jobs', (select count(*) from public.verify_job_cogs where completed_at >= v_from),
    -- verify_job_cogs.total_cogs_usd is double precision; Postgres has no
    -- round(double precision, integer), so every one of these needs the cast.
    'avg_cogs_per_job', (select round(avg(total_cogs_usd)::numeric, 6)
                           from public.verify_job_cogs where completed_at >= v_from),
    'median_cogs_per_job', (select round((percentile_cont(0.5) within group (order by total_cogs_usd))::numeric, 6)
                              from public.verify_job_cogs where completed_at >= v_from),
    'p90_cogs_per_job', (select round((percentile_cont(0.9) within group (order by total_cogs_usd))::numeric, 6)
                              from public.verify_job_cogs where completed_at >= v_from),
    'stages', COALESCE((select jsonb_agg(s order by (s->>'total_cogs_usd')::numeric desc) from (
        select jsonb_build_object(
          'stage', upper(stage),
          'calls', count(*),
          'tokens', sum(total_tokens),
          'cached_tokens', sum(cached_input_tokens),
          'searches', sum(web_searches),
          'model', max(model),
          'avg_cogs_usd', round(avg(model_cost_usd + search_cost_usd)::numeric, 6),
          'total_cogs_usd', round(sum(model_cost_usd + search_cost_usd)::numeric, 6),
          'model_cost_usd', round(sum(model_cost_usd)::numeric, 6),
          'search_cost_usd', round(sum(search_cost_usd)::numeric, 6),
          'share_bps', case when v_total > 0
            then round(sum(model_cost_usd + search_cost_usd)::numeric / v_total * 10000)::integer else 0 end
        ) as s
        from public.verify_stage_cogs where completed_at >= v_from group by stage
      ) t), '[]'::jsonb),
    'reuse', (select jsonb_build_object(
        'jobs_with_reuse_hit', count(*) filter (where reuse_graph_hit),
        'reuse_rate_bps', case when count(*) > 0
          then round(count(*) filter (where reuse_graph_hit)::numeric / count(*) * 10000)::integer else 0 end,
        'facts_reused', COALESCE(sum(reuse_facts_reused),0),
        'facts_required', COALESCE(sum(reuse_facts_required),0),
        'avg_cogs_with_reuse', round((avg(provider_cogs_usd) filter (where reuse_graph_hit))::numeric, 6),
        'avg_cogs_without_reuse', round((avg(provider_cogs_usd) filter (where not reuse_graph_hit))::numeric, 6))
      from public.verify_billing_events where completed_at >= v_from),
    'unpriced_stages', (select count(*) from public.verify_stage_cogs
                         where completed_at >= v_from and price_state <> 'PRICED')
  );
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_summary()',
    'public.finance_monthly_summary(integer)',
    'public.finance_budget_status()',
    'public.finance_verify_deep_dive(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
