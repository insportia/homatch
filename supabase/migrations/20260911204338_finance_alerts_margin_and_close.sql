-- Alerts, the margin monitor, month close, repricing preview and export.
--
-- NOTE: finance_evaluate_alerts() as first written here ran a correlated
-- lateral per ROW of the fact view while computing the anomaly baseline, which
-- is quadratic and timed out on production. It is replaced in
-- 20260911204845_finance_evaluate_alerts_single_scan.sql. Everything else in
-- this file is still current.

-- ── Alert evaluation ────────────────────────────────────────
-- Idempotent: re-running updates the open alert instead of stacking duplicates,
-- so this is safe on a schedule and safe to call from the dashboard on load.
CREATE OR REPLACE FUNCTION public.finance_evaluate_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_tz text := public.finance_tz();
  v_month timestamptz := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_day   timestamptz := date_trunc('day',   now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_raised integer := 0; v_resolved integer := 0;
  v_min_margin_bps integer := public.billing_setting_num('finance_min_margin_alert_bps', 3000)::integer;
  v_anomaly numeric := public.billing_setting_num('finance_anomaly_multiplier', 3);
  r record;
  v_open text[] := ARRAY[]::text[];
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: finance data is admin only';
  end if;

  -- 1. Budgets at or over their threshold.
  for r in
    select fb.code, fb.label, fb.amount_cents, fb.warn_at_bps, fb.hard_stop, s.spent
      from public.finance_budgets fb
      cross join lateral (
        select COALESCE(sum(f.cost_usd),0) spent from public.finance_cost_facts f
         where f.is_cogs
           and f.occurred_at >= case fb.period when 'DAY' then v_day else v_month end
           and (fb.scope='COMPANY'
             or (fb.scope='PROVIDER' and f.provider = fb.scope_value)
             or (fb.scope='PRODUCT'  and f.product  = fb.scope_value))) s
     where fb.active and fb.amount_cents > 0
  loop
    if r.spent >= r.amount_cents::numeric/100 then
      v_open := v_open || ('BUDGET:' || r.code);
      insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                         metric_value, threshold_value)
      values ('CRITICAL','BUDGET_EXCEEDED',
              r.label || ' budget exceeded',
              'Spend ' || to_char(r.spent,'FM999999990.00') || ' USD against a budget of '
                || to_char(r.amount_cents::numeric/100,'FM999999990.00') || ' USD.',
              'BUDGET:' || r.code, r.code, r.spent, r.amount_cents::numeric/100)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, severity = excluded.severity;
      v_raised := v_raised + 1;
    elsif r.spent >= (r.amount_cents::numeric/100) * r.warn_at_bps/10000.0 then
      v_open := v_open || ('BUDGET:' || r.code);
      insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                         metric_value, threshold_value)
      values ('WARNING','BUDGET_WARNING',
              r.label || ' budget at ' || round(r.spent / (r.amount_cents::numeric/100) * 100) || '%',
              'Spend ' || to_char(r.spent,'FM999999990.00') || ' USD of '
                || to_char(r.amount_cents::numeric/100,'FM999999990.00') || ' USD.',
              'BUDGET:' || r.code, r.code, r.spent, r.amount_cents::numeric/100)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, severity = excluded.severity;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 2. The finance budget and the gate that actually enforces it disagree.
  for r in
    select fb.code, fb.label, fb.amount_cents,
           public.billing_setting_num(fb.enforcement_setting_key, -1) as enforced
      from public.finance_budgets fb
     where fb.active and fb.enforcement_setting_key is not null
  loop
    if r.enforced >= 0 and r.enforced <> r.amount_cents::numeric/100 then
      v_open := v_open || ('BUDGET_DRIFT:' || r.code);
      insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                         metric_value, threshold_value)
      values ('WARNING','BUDGET_DRIFT',
              r.label || ' budget does not match the enforced cap',
              'Finance budget is ' || to_char(r.amount_cents::numeric/100,'FM999999990.00')
                || ' USD but the enforced spend cap is ' || to_char(r.enforced,'FM999999990.00')
                || ' USD. The enforced value is the one that stops spending.',
              'BUDGET_DRIFT:' || r.code, r.code, r.amount_cents::numeric/100, r.enforced)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, threshold_value = excluded.threshold_value;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 3. Usage we are measuring but cannot price.
  for r in
    select provider, count(*) n, sum(quantity) qty
      from public.finance_cost_facts
     where is_unpriced and occurred_at >= v_month
     group by provider having count(*) > 0
  loop
    v_open := v_open || ('UNPRICED:' || r.provider);
    insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                       metric_value, threshold_value)
    values ('WARNING','UNPRICED_USAGE',
            r.provider || ': ' || r.n || ' unpriced events this month',
            r.qty || ' units measured with no cost attached. This spend is real and is '
              || 'currently counted as zero.',
            'UNPRICED:' || r.provider, r.provider, r.n, 0)
    on conflict (dedupe_key) where resolved_at is null
      do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                    metric_value = excluded.metric_value, detail = excluded.detail,
                    title = excluded.title;
    v_raised := v_raised + 1;
  end loop;

  -- 4. Today's spend far above the trailing daily average for that provider.
  for r in
    select f.provider,
           sum(f.cost_usd) filter (where f.occurred_at >= v_day) as today,
           avg(d.daily) as baseline
      from public.finance_cost_facts f
      join lateral (
        select COALESCE(sum(f2.cost_usd),0) / 14.0 as daily
          from public.finance_cost_facts f2
         where f2.is_cogs and f2.provider = f.provider
           and f2.occurred_at >= v_day - interval '14 days' and f2.occurred_at < v_day) d on true
     where f.is_cogs
     group by f.provider
  loop
    if r.baseline > 0.01 and r.today > r.baseline * v_anomaly then
      v_open := v_open || ('ANOMALY:' || r.provider);
      insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                         metric_value, threshold_value)
      values ('WARNING','SPEND_ANOMALY',
              r.provider || ' spend is ' || round(r.today / r.baseline, 1) || 'x its daily average',
              'Today ' || to_char(r.today,'FM999999990.0000') || ' USD against a 14-day average of '
                || to_char(r.baseline,'FM999999990.0000') || ' USD.',
              'ANOMALY:' || r.provider, r.provider, r.today, r.baseline * v_anomaly)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, title = excluded.title;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 5. Executions sold below the margin floor.
  for r in
    select ue.product_code, count(*) n,
           sum(ue.charged_credits) / public.billing_setting_num('credits_per_usd',10) as revenue,
           sum(ue.landed_cogs_cents)/100.0 as cogs
      from public.usage_events ue
     where ue.created_at >= v_month and ue.billable and ue.charged_credits > 0
     group by ue.product_code
  loop
    if r.revenue > 0 and (r.revenue - r.cogs) / r.revenue * 10000 < v_min_margin_bps then
      v_open := v_open || ('MARGIN:' || r.product_code);
      insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                         metric_value, threshold_value)
      values ('CRITICAL','MARGIN_BELOW_FLOOR',
              r.product_code || ' margin below the floor',
              'Gross margin ' || round((r.revenue - r.cogs) / r.revenue * 100, 2) || '% over '
                || r.n || ' charged executions this month, against a floor of '
                || round(v_min_margin_bps/100.0, 2) || '%.',
              'MARGIN:' || r.product_code, r.product_code,
              round((r.revenue - r.cogs) / r.revenue * 10000), v_min_margin_bps)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, detail = excluded.detail;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 6. A currency we hold costs in but cannot convert.
  for r in
    select distinct source_currency as cur from public.finance_provider_cost_events
     where not public.fx_rate_known(source_currency, occurred_at)
  loop
    v_open := v_open || ('FX:' || r.cur);
    insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                       metric_value, threshold_value)
    values ('WARNING','FX_RATE_MISSING',
            'No USD rate for ' || r.cur,
            'Costs recorded in ' || r.cur || ' cannot be converted and are reported as unpriced.',
            'FX:' || r.cur, r.cur, 0, 0)
    on conflict (dedupe_key) where resolved_at is null
      do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1;
    v_raised := v_raised + 1;
  end loop;

  -- Anything previously open whose condition no longer holds is resolved, so
  -- the list reflects now rather than the worst moment of the month.
  update public.finance_alerts
     set resolved_at = now()
   where resolved_at is null
     and kind in ('BUDGET_EXCEEDED','BUDGET_WARNING','BUDGET_DRIFT','UNPRICED_USAGE',
                  'SPEND_ANOMALY','MARGIN_BELOW_FLOOR','FX_RATE_MISSING')
     and not (dedupe_key = ANY (v_open));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  return jsonb_build_object('raised', v_raised, 'auto_resolved', v_resolved,
                            'evaluated_at', now());
end;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_alert_list(p_include_resolved boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  return COALESCE((select jsonb_agg(a order by
      case a->>'severity' when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end,
      a->>'last_seen_at' desc) from (
    select jsonb_build_object(
      'id', id, 'severity', severity, 'kind', kind, 'title', title, 'detail', detail,
      'subject', subject, 'metric_value', metric_value, 'threshold_value', threshold_value,
      'first_seen_at', first_seen_at, 'last_seen_at', last_seen_at,
      'occurrences', occurrences, 'acknowledged_at', acknowledged_at,
      'resolved_at', resolved_at) as a
    from public.finance_alerts
    where p_include_resolved or resolved_at is null
    order by last_seen_at desc limit 200
  ) t), '[]'::jsonb);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_acknowledge_alert(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  update public.finance_alerts
     set acknowledged_at = now(), acknowledged_by = public.auth_user_id()
   where id = p_id and acknowledged_at is null;
  return jsonb_build_object('ok', found);
end;
$fn$;

-- ── Margin floor monitor ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_margin_monitor(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz; v_cpu numeric; v_floor integer;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  v_cpu := public.billing_setting_num('credits_per_usd', 10);
  v_floor := public.billing_setting_num('min_gross_margin_bps', 3000)::integer;

  return jsonb_build_object(
    'floor_bps', v_floor,
    'by_product', COALESCE((select jsonb_agg(p order by (p->>'margin_bps')::numeric nulls first) from (
      select jsonb_build_object(
        'product_code', ue.product_code,
        'charged_executions', count(*),
        'revenue_usd', round(sum(ue.charged_credits)/v_cpu, 6),
        'cogs_usd', round(sum(ue.landed_cogs_cents)/100.0, 6),
        'gross_profit_usd', round(sum(ue.charged_credits)/v_cpu - sum(ue.landed_cogs_cents)/100.0, 6),
        'margin_bps', case when sum(ue.charged_credits) > 0 then
          round((sum(ue.charged_credits)/v_cpu - sum(ue.landed_cogs_cents)/100.0)
                / (sum(ue.charged_credits)/v_cpu) * 10000) else null end,
        'below_floor', case when sum(ue.charged_credits) > 0 then
          ((sum(ue.charged_credits)/v_cpu - sum(ue.landed_cogs_cents)/100.0)
           / (sum(ue.charged_credits)/v_cpu) * 10000) < v_floor else false end
      ) as p
      from public.usage_events ue
      where ue.created_at >= v_from and ue.billable and ue.charged_credits > 0
      group by ue.product_code
    ) x), '[]'::jsonb),
    -- The individual executions that lost money, which is where a pricing bug
    -- shows up first.
    'worst_executions', COALESCE((select jsonb_agg(e order by (e->>'gross_profit_usd')::numeric) from (
      select jsonb_build_object(
        'job_ref', ue.job_ref, 'product_code', ue.product_code, 'plan_code', ue.plan_code,
        'created_at', ue.created_at,
        'revenue_usd', round(ue.charged_credits/v_cpu, 6),
        'cogs_usd', round(ue.landed_cogs_cents/100.0, 6),
        'gross_profit_usd', round(ue.charged_credits/v_cpu - ue.landed_cogs_cents/100.0, 6),
        'allowance_funded', ue.allowance_funded) as e
      from public.usage_events ue
      where ue.created_at >= v_from
        and (ue.charged_credits/v_cpu - ue.landed_cogs_cents/100.0) < 0
      order by (ue.charged_credits/v_cpu - ue.landed_cogs_cents/100.0) limit 25
    ) x), '[]'::jsonb)
  );
end;
$fn$;

-- ── Monthly close ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_monthly_summary(p_months integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := date_trunc('month', (now() - (p_months || ' months')::interval) AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  return COALESCE((select jsonb_agg(m order by m->>'month' desc) from (
    select jsonb_build_object(
      'month', to_char(b.m AT TIME ZONE v_tz, 'YYYY-MM'),
      'month_start', b.m,
      'is_current', b.m = date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz,
      'variable_cogs_usd', round(COALESCE(c.spend,0), 6),
      'fixed_costs_usd', round(COALESCE(fx.fixed,0), 6),
      'total_spend_usd', round(COALESCE(c.spend,0) + COALESCE(fx.fixed,0), 6),
      'revenue_usd', round(COALESCE(r.revenue,0), 6),
      'gross_profit_usd', round(COALESCE(r.revenue,0) - COALESCE(c.spend,0), 6),
      'gross_margin_bps', case when COALESCE(r.revenue,0) > 0
        then round((r.revenue - COALESCE(c.spend,0)) / r.revenue * 10000)::integer else null end,
      'operating_contribution_usd',
        round(COALESCE(r.revenue,0) - COALESCE(c.spend,0) - COALESCE(fx.fixed,0), 6),
      'cost_events', COALESCE(c.events,0),
      'unpriced_events', COALESCE(c.unpriced,0)
    ) as m
    from generate_series(v_from, date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz,
                         interval '1 month') b(m)
    left join lateral (
      select sum(cost_usd) spend, count(*) events, count(*) filter (where is_unpriced) unpriced
        from public.finance_cost_facts f
       where f.is_cogs and f.occurred_at >= b.m and f.occurred_at < b.m + interval '1 month') c on true
    left join lateral (
      select sum(public.fx_to_usd(p.total_cents::numeric/100, p.currency, p.created_at)) revenue
        from public.payments p
       where p.status='COMPLETED' and p.created_at >= b.m and p.created_at < b.m + interval '1 month') r on true
    left join lateral (
      -- Fixed costs are charged to every month they were live for.
      select sum(public.finance_monthly_equivalent_cents(fe.amount_cents, fe.billing_frequency))/100.0 fixed
        from public.finance_fixed_expenses fe
       where fe.active and fe.superseded_by is null
         and fe.starts_at <= (b.m + interval '1 month')::date
         and (fe.ends_at is null or fe.ends_at >= b.m::date)) fx on true
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Repricing preview. Nothing is rewritten without this first. ──
CREATE OR REPLACE FUNCTION public.finance_reprice_preview(
  p_provider text, p_operation text DEFAULT '*', p_market text DEFAULT '*',
  p_new_unit_cost numeric DEFAULT NULL, p_currency char(3) DEFAULT 'USD',
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_rows integer; v_qty numeric; v_old numeric; v_new numeric;
begin
  perform public.finance_require_admin();

  select count(*), COALESCE(sum(quantity),0), COALESCE(sum(cost_usd),0)
    into v_rows, v_qty, v_old
    from public.finance_cost_facts
   where provider = p_provider
     and (p_operation = '*' or operation = p_operation)
     and (p_market = '*' or market = p_market)
     and (p_from is null or occurred_at >= p_from)
     and (p_to is null or occurred_at < p_to);

  v_new := v_qty * public.fx_to_usd(COALESCE(p_new_unit_cost,0), COALESCE(p_currency,'USD'), now());

  return jsonb_build_object(
    'provider', p_provider, 'operation', p_operation, 'market', p_market,
    'affected_rows', v_rows,
    'total_quantity', round(v_qty, 4),
    'current_cost_usd', round(v_old, 6),
    'repriced_cost_usd', round(COALESCE(v_new,0), 6),
    'delta_usd', round(COALESCE(v_new,0) - v_old, 6),
    'convertible', public.fx_rate_known(COALESCE(p_currency,'USD'), now()),
    -- Said plainly, because this is the screen where somebody is about to
    -- change what last month cost.
    'note', 'Preview only. Nothing has been written. Historical facts are '
         || 'repriced by adding a new effective-dated rate, never by editing rows.'
  );
end;
$fn$;

-- ── Export ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_export_cost_facts(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL, p_product text DEFAULT NULL, p_limit integer DEFAULT 10000
) RETURNS SETOF text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  return next 'occurred_at,provider,product,stage,operation,model,quantity,unit,'
           || 'cost_usd,source_currency,source_amount,cost_source,is_unpriced,job_ref,market';
  return query
    select concat_ws(',',
      to_char(f.occurred_at AT TIME ZONE public.finance_tz(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      f.provider, f.product, COALESCE(f.stage,''), f.operation, COALESCE(f.model,''),
      to_char(f.quantity, 'FM999999999990.000000'), f.unit,
      to_char(f.cost_usd, 'FM999999999990.000000'),
      f.source_currency, COALESCE(to_char(f.source_amount,'FM999999999990.000000'),''),
      f.cost_source, f.is_unpriced::text,
      COALESCE(f.job_ref,''), COALESCE(f.market,''))
      from public.finance_cost_facts f
     where f.is_cogs
       and (p_from is null or f.occurred_at >= p_from)
       and (p_to is null or f.occurred_at < p_to)
       and (p_provider is null or f.provider = p_provider)
       and (p_product is null or f.product = p_product)
     order by f.occurred_at desc
     limit greatest(1, least(p_limit, 50000));
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_evaluate_alerts()',
    'public.finance_alert_list(boolean)',
    'public.finance_acknowledge_alert(uuid)',
    'public.finance_margin_monitor(integer)',
    'public.finance_monthly_summary(integer)',
    'public.finance_reprice_preview(text, text, text, numeric, char, timestamptz, timestamptz)',
    'public.finance_export_cost_facts(timestamptz, timestamptz, text, text, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
