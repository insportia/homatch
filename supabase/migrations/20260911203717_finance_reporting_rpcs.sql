-- HOMATCH FINANCE — the reporting layer.
--
-- Every function here is admin-only, in its own body as well as by grant. A
-- customer must never be able to read company COGS, provider rates, another
-- customer's economics, or revenue.
--
-- MONEY IS NUMERIC THROUGHOUT. Cents are integers at the boundary. No float
-- touches an accounting number.
--
-- DAY AND MONTH BOUNDARIES ARE EXPLICIT. Timestamps are stored in UTC;
-- "today" means today in the configured business timezone, because an operator
-- asking what was spent today means their day, not UTC's.

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('finance_timezone', '"Asia/Tbilisi"'::jsonb,
   'Business timezone for finance day and month boundaries. Timestamps stay in UTC; only the reporting boundary moves.'),
  ('finance_min_margin_alert_bps', '3000'::jsonb,
   'Gross margin below this raises a finance alert.'),
  ('finance_anomaly_multiplier', '3'::jsonb,
   'An execution costing more than p90 times this is flagged as an anomaly. Deterministic, not predictive.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.finance_tz()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT value #>> '{}' FROM public.admin_settings WHERE key='finance_timezone'), 'UTC');
$fn$;

-- Every finance function starts here. Raising rather than returning empty
-- makes an authorization failure loud instead of looking like "no data".
CREATE OR REPLACE FUNCTION public.finance_require_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  if auth.role() = 'service_role' then return; end if;
  if public.is_admin() then return; end if;
  raise exception 'FORBIDDEN: finance data is admin only';
end;
$fn$;

-- ── Executive summary ───────────────────────────────────────
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
  v_reserved numeric;
begin
  perform public.finance_require_admin();

  select COALESCE(sum(cost_usd),0) into v_spend_today
    from public.finance_cost_facts where is_cogs and occurred_at >= v_day_start;
  select COALESCE(sum(cost_usd),0) into v_spend_mtd
    from public.finance_cost_facts where is_cogs and occurred_at >= v_month_start;
  select COALESCE(sum(cost_usd),0) into v_spend_prev_month
    from public.finance_cost_facts
   where is_cogs and occurred_at >= v_prev_month_start and occurred_at < v_month_start;

  -- Revenue is CASH that actually settled. A PENDING mock payment is not
  -- revenue, and a membership or promotional credit is not cash.
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
    -- Gross profit subtracts only attributable VARIABLE COGS. Fixed operating
    -- costs are reported beside it, never inside it.
    'gross_profit_today', round(v_rev_today - v_spend_today, 4),
    'gross_profit_mtd', round(v_rev_mtd - v_spend_mtd, 4),
    'gross_margin_bps', case when v_rev_mtd > 0
      then round((v_rev_mtd - v_spend_mtd) / v_rev_mtd * 10000)::integer else null end,
    'variable_cogs_mtd', round(v_spend_mtd, 4),
    'fixed_monthly', round(v_fixed_monthly, 4),
    'total_company_spend_mtd', round(v_spend_mtd + v_fixed_monthly, 4),
    'operating_contribution_mtd', round(v_rev_mtd - v_spend_mtd - v_fixed_monthly, 4),
    -- A simple, stated projection: MTD divided by days elapsed, times days in
    -- the month, plus the fixed commitment. Deliberately not dressed up as a
    -- forecast.
    'burn_daily_avg', round(v_spend_mtd / v_days_elapsed, 4),
    'burn_projected_month_end', round((v_spend_mtd / v_days_elapsed) * v_days_in_month + v_fixed_monthly, 4),
    'burn_projection_method', 'MTD variable spend / days elapsed x days in month, plus fixed commitments',
    'days_elapsed', v_days_elapsed,
    'days_in_month', v_days_in_month,
    'unpriced_events', v_unpriced_events,
    'unpriced_quantity', v_unpriced_qty,
    'credits_reserved', round(v_reserved, 4),
    -- Said plainly rather than shown as zero revenue.
    'payment_provider_configured', exists (
      select 1 from public.payments where status='COMPLETED' and provider not like '%mock%'),
    'revenue_data_available', (v_rev_mtd > 0)
  );
end;
$fn$;

-- ── Providers ───────────────────────────────────────────────
-- NOTE: replaced in 20260911204108_finance_registry_rpcs.sql, which drives
-- this off finance_provider_registry so a provider with no spend still has a
-- row and capabilities come from data rather than from the fact stream.
CREATE OR REPLACE FUNCTION public.finance_providers(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_day timestamptz; v_month timestamptz; v_total numeric;
begin
  perform public.finance_require_admin();
  v_day := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_month := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  select COALESCE(sum(cost_usd),0) into v_total from public.finance_cost_facts
   where is_cogs and occurred_at >= now() - (p_days || ' days')::interval;

  return COALESCE((select jsonb_agg(t order by t->>'cost_window' desc) from (
    select jsonb_build_object(
      'provider', f.provider,
      'cost_today', round(sum(cost_usd) filter (where occurred_at >= v_day), 6),
      'cost_7d', round(sum(cost_usd) filter (where occurred_at >= now() - interval '7 days'), 6),
      'cost_30d', round(sum(cost_usd) filter (where occurred_at >= now() - interval '30 days'), 6),
      'cost_mtd', round(sum(cost_usd) filter (where occurred_at >= v_month), 6),
      'cost_prev_month', round(sum(cost_usd) filter (
          where occurred_at >= v_month - interval '1 month' and occurred_at < v_month), 6),
      'cost_window', round(sum(cost_usd) filter (where occurred_at >= now() - (p_days || ' days')::interval), 6),
      'share_bps', case when v_total > 0 then round(
          sum(cost_usd) filter (where occurred_at >= now() - (p_days || ' days')::interval) / v_total * 10000)::integer
          else 0 end,
      'events', count(*) filter (where occurred_at >= now() - (p_days || ' days')::interval),
      'avg_unit_cost', case when sum(quantity) filter (where occurred_at >= now() - (p_days || ' days')::interval) > 0
          then round(sum(cost_usd) filter (where occurred_at >= now() - (p_days || ' days')::interval)
                   / sum(quantity) filter (where occurred_at >= now() - (p_days || ' days')::interval), 8)
          else null end,
      'unpriced_events', count(*) filter (where is_unpriced),
      'configured', COALESCE((select ph.status <> 'NOT_CONFIGURED' from public.provider_health ph
                               where upper(ph.provider) = f.provider limit 1), null)
    ) as t
    from public.finance_cost_facts f
    where f.is_cogs
    group by f.provider
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Products ────────────────────────────────────────────────
-- NOTE: replaced in 20260911205021_finance_products_fix_double_precision_round.sql
-- because percentile_cont() returns double precision and Postgres has no
-- round(double precision, integer) — the median/p90 columns raised 42883 as
-- soon as a product had priced executions.
CREATE OR REPLACE FUNCTION public.finance_products(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;

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
      -- Customer side, from usage_events (what was actually charged).
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
          where u.product_code = bp.code and u.created_at >= v_from), 0)
          / public.billing_setting_num('credits_per_usd', 10), 6),
      'avg_cogs_usd', (select round(avg(landed_cogs_cents)/100, 6) from public.usage_events u
          where u.product_code = bp.code and u.created_at >= v_from and u.landed_cogs_cents > 0),
      'median_cogs_usd', (select round(percentile_cont(0.5) within group (order by landed_cogs_cents)/100, 6)
          from public.usage_events u where u.product_code = bp.code and u.created_at >= v_from and u.landed_cogs_cents > 0),
      'p90_cogs_usd', (select round(percentile_cont(0.9) within group (order by landed_cogs_cents)/100, 6)
          from public.usage_events u where u.product_code = bp.code and u.created_at >= v_from and u.landed_cogs_cents > 0)
    ) as t
    from public.billable_products bp
    order by bp.sort_order
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Verify deep dive, including the stage breakdown ─────────
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
    'avg_cogs_per_job', (select round(avg(total_cogs_usd), 6) from public.verify_job_cogs where completed_at >= v_from),
    'median_cogs_per_job', (select round(percentile_cont(0.5) within group (order by total_cogs_usd), 6)
                              from public.verify_job_cogs where completed_at >= v_from),
    'p90_cogs_per_job', (select round(percentile_cont(0.9) within group (order by total_cogs_usd), 6)
                              from public.verify_job_cogs where completed_at >= v_from),
    'stages', COALESCE((select jsonb_agg(s order by (s->>'total_cogs_usd')::numeric desc) from (
        select jsonb_build_object(
          'stage', upper(stage),
          'calls', count(*),
          'tokens', sum(total_tokens),
          'cached_tokens', sum(cached_input_tokens),
          'searches', sum(web_searches),
          'model', max(model),
          'avg_cogs_usd', round(avg(model_cost_usd + search_cost_usd), 6),
          'total_cogs_usd', round(sum(model_cost_usd + search_cost_usd), 6),
          'model_cost_usd', round(sum(model_cost_usd), 6),
          'search_cost_usd', round(sum(search_cost_usd), 6),
          'share_bps', case when v_total > 0
            then round(sum(model_cost_usd + search_cost_usd) / v_total * 10000)::integer else 0 end
        ) as s
        from public.verify_stage_cogs where completed_at >= v_from group by stage
      ) t), '[]'::jsonb),
    -- Reuse, from the plan the job recorded. Internal only.
    'reuse', (select jsonb_build_object(
        'jobs_with_reuse_hit', count(*) filter (where reuse_graph_hit),
        'reuse_rate_bps', case when count(*) > 0
          then round(count(*) filter (where reuse_graph_hit)::numeric / count(*) * 10000)::integer else 0 end,
        'facts_reused', COALESCE(sum(reuse_facts_reused),0),
        'facts_required', COALESCE(sum(reuse_facts_required),0),
        'avg_cogs_with_reuse', round(avg(provider_cogs_usd) filter (where reuse_graph_hit), 6),
        'avg_cogs_without_reuse', round(avg(provider_cogs_usd) filter (where not reuse_graph_hit), 6))
      from public.verify_billing_events where completed_at >= v_from),
    'unpriced_stages', (select count(*) from public.verify_stage_cogs
                         where completed_at >= v_from and price_state <> 'PRICED')
  );
end;
$fn$;

-- ── OpenAI breakdown ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_openai_breakdown(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  return jsonb_build_object(
    'window_days', p_days,
    'by_model', COALESCE((select jsonb_agg(m order by (m->>'cost_usd')::numeric desc) from (
      select jsonb_build_object(
        'model', model,
        'calls', count(*),
        'input_tokens', sum(input_tokens),
        'cached_input_tokens', sum(cached_input_tokens),
        'fresh_input_tokens', sum(fresh_input_tokens),
        'output_tokens', sum(output_tokens),
        'web_searches', sum(web_searches),
        'model_cost_usd', round(sum(model_cost_usd), 6),
        'search_cost_usd', round(sum(search_cost_usd), 6),
        'cost_usd', round(sum(model_cost_usd + search_cost_usd), 6)
      ) as m from public.verify_stage_cogs where completed_at >= v_from group by model
    ) t), '[]'::jsonb),
    'search_cost_usd', (select round(COALESCE(sum(search_cost_usd),0), 6)
                          from public.verify_stage_cogs where completed_at >= v_from),
    'search_calls', (select COALESCE(sum(web_searches),0) from public.verify_stage_cogs where completed_at >= v_from),
    'rates', (select jsonb_agg(jsonb_build_object('model', model, 'unit', unit,
                'rate', rate, 'per_units', per_units, 'currency', currency,
                'effective_from', effective_from))
              from public.provider_price_book where provider='OPENAI' and effective_to is null)
  );
end;
$fn$;

-- ── Live feed ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_live_feed(p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_day timestamptz;
begin
  perform public.finance_require_admin();
  v_day := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  return jsonb_build_object(
    'spend_5m',  (select round(COALESCE(sum(cost_usd),0),6) from public.finance_cost_facts
                   where is_cogs and occurred_at >= now() - interval '5 minutes'),
    'spend_1h',  (select round(COALESCE(sum(cost_usd),0),6) from public.finance_cost_facts
                   where is_cogs and occurred_at >= now() - interval '1 hour'),
    'spend_today', (select round(COALESCE(sum(cost_usd),0),6) from public.finance_cost_facts
                   where is_cogs and occurred_at >= v_day),
    'events_1h', (select count(*) from public.finance_cost_facts
                   where is_cogs and occurred_at >= now() - interval '1 hour'),
    -- Only meaningful with enough activity behind it. Below that it is noise
    -- dressed as a number, so it is returned as null and the UI hides it.
    'burn_per_hour', (select case when count(*) >= 5
        then round(COALESCE(sum(cost_usd),0), 4) else null end
        from public.finance_cost_facts where is_cogs and occurred_at >= now() - interval '1 hour'),
    'events', COALESCE((select jsonb_agg(e order by (e->>'occurred_at') desc) from (
      select jsonb_build_object(
        'fact_key', fact_key, 'occurred_at', occurred_at, 'provider', provider,
        'product', product, 'stage', stage, 'operation', operation,
        'model', model, 'quantity', quantity, 'unit', unit,
        'web_searches', web_searches,
        'cost_usd', cost_usd, 'cost_source', cost_source,
        'is_unpriced', is_unpriced, 'job_ref', job_ref, 'user_id', user_id
      ) as e
      from public.finance_cost_facts
      where is_cogs
      order by occurred_at desc
      limit greatest(1, least(p_limit, 200))
    ) t), '[]'::jsonb)
  );
end;
$fn$;

-- ── Unpriced ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_unpriced()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  return jsonb_build_object(
    'total_events', (select count(*) from public.finance_cost_facts where is_cogs and is_unpriced),
    'total_quantity', (select COALESCE(sum(quantity),0) from public.finance_cost_facts where is_cogs and is_unpriced),
    'groups', COALESCE((select jsonb_agg(g order by (g->>'events')::int desc) from (
      select jsonb_build_object(
        'provider', provider, 'product', product, 'operation', operation,
        'events', count(*), 'quantity', COALESCE(sum(quantity),0),
        'first_seen', min(occurred_at), 'last_seen', max(occurred_at),
        -- A rate exists for this provider but not for what this call did.
        'provider_has_any_rate', exists (
          select 1 from public.provider_price_book b where b.provider = finance_cost_facts.provider)
      ) as g
      from public.finance_cost_facts where is_cogs and is_unpriced
      group by provider, product, operation
    ) t), '[]'::jsonb)
  );
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_summary()',
    'public.finance_providers(integer)',
    'public.finance_products(integer)',
    'public.finance_verify_deep_dive(integer)',
    'public.finance_openai_breakdown(integer)',
    'public.finance_live_feed(integer)',
    'public.finance_unpriced()',
    'public.finance_require_admin()',
    'public.finance_tz()',
    'public.fx_to_usd(numeric, text, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    -- authenticated is granted, and each function calls finance_require_admin()
    -- itself, so a non-admin gets an explicit FORBIDDEN rather than silence.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
