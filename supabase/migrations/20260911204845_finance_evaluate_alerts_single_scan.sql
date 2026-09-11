-- The first version ran a correlated lateral per ROW of the fact view while
-- computing the anomaly baseline, so the cost was quadratic and it timed out.
-- finance_cost_facts is a four-way union with per-row function calls, so the
-- fix is to pay for it once: snapshot the window into a temp table and run
-- every check against that.
--
-- This version also adds the COST_DATA_STALE check: a provider that has simply
-- stopped reporting must not read as a provider that stopped costing money.

CREATE OR REPLACE FUNCTION public.finance_evaluate_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_tz text := public.finance_tz();
  v_month timestamptz := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_day   timestamptz := date_trunc('day',   now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_raised integer := 0; v_resolved integer := 0;
  v_min_margin_bps integer := public.billing_setting_num('finance_min_margin_alert_bps', 3000)::integer;
  v_anomaly numeric := public.billing_setting_num('finance_anomaly_multiplier', 3);
  v_open text[] := ARRAY[]::text[];
  r record;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: finance data is admin only';
  end if;

  -- One scan, reused by every check below.
  create temp table _ff on commit drop as
    select provider, product, cost_usd, quantity, is_cogs, is_unpriced, occurred_at
      from public.finance_cost_facts
     where occurred_at >= least(v_month, v_day - interval '14 days');
  create index on _ff (provider);

  -- 1. Budgets.
  for r in
    select fb.code, fb.label, fb.amount_cents, fb.warn_at_bps, s.spent
      from public.finance_budgets fb
      cross join lateral (
        select COALESCE(sum(f.cost_usd),0) spent from _ff f
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
      values ('CRITICAL','BUDGET_EXCEEDED', r.label || ' budget exceeded',
              'Spend ' || to_char(r.spent,'FM999999990.00') || ' USD against a budget of '
                || to_char(r.amount_cents::numeric/100,'FM999999990.00') || ' USD.',
              'BUDGET:' || r.code, r.code, r.spent, r.amount_cents::numeric/100)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, severity = excluded.severity,
                      title = excluded.title, detail = excluded.detail;
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
                      metric_value = excluded.metric_value, severity = excluded.severity,
                      title = excluded.title, detail = excluded.detail;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 2. Finance budget vs the cap that actually enforces.
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
      values ('WARNING','BUDGET_DRIFT', r.label || ' budget does not match the enforced cap',
              'Finance budget is ' || to_char(r.amount_cents::numeric/100,'FM999999990.00')
                || ' USD but the enforced spend cap is ' || to_char(r.enforced,'FM999999990.00')
                || ' USD. The enforced value is the one that stops spending.',
              'BUDGET_DRIFT:' || r.code, r.code, r.amount_cents::numeric/100, r.enforced)
      on conflict (dedupe_key) where resolved_at is null
        do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                      metric_value = excluded.metric_value, threshold_value = excluded.threshold_value,
                      detail = excluded.detail;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 3. Measured but unpriceable.
  for r in
    select provider, count(*) n, sum(quantity) qty from _ff
     where is_unpriced and occurred_at >= v_month group by provider
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

  -- 4. Today against the trailing daily average. One pass, grouped.
  for r in
    select provider,
           COALESCE(sum(cost_usd) filter (where occurred_at >= v_day), 0) as today,
           COALESCE(sum(cost_usd) filter (where occurred_at >= v_day - interval '14 days'
                                            and occurred_at < v_day), 0) / 14.0 as baseline
      from _ff where is_cogs group by provider
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
                      metric_value = excluded.metric_value, title = excluded.title,
                      detail = excluded.detail;
      v_raised := v_raised + 1;
    end if;
  end loop;

  -- 5. Margin floor, from usage_events (cheap, already indexed).
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
      values ('CRITICAL','MARGIN_BELOW_FLOOR', r.product_code || ' margin below the floor',
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

  -- 6. A currency we hold cost in but cannot convert.
  for r in
    select distinct source_currency as cur from public.finance_provider_cost_events
     where not public.fx_rate_known(source_currency, occurred_at)
  loop
    v_open := v_open || ('FX:' || r.cur);
    insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                       metric_value, threshold_value)
    values ('WARNING','FX_RATE_MISSING', 'No USD rate for ' || r.cur,
            'Costs recorded in ' || r.cur || ' cannot be converted and are reported as unpriced.',
            'FX:' || r.cur, r.cur, 0, 0)
    on conflict (dedupe_key) where resolved_at is null
      do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1;
    v_raised := v_raised + 1;
  end loop;

  -- 7. A provider whose cost data has gone stale. Silence is not $0.
  for r in
    select reg.provider_id, reg.stale_after_hours, m.last_seen
      from public.finance_provider_registry reg
      join lateral (select max(occurred_at) last_seen from _ff f
                     where f.provider = reg.provider_id) m on true
     where reg.access_status::text <> 'NOT_CONFIGURED'
       and reg.sync_mode <> 'NONE'
       and m.last_seen is not null
       and m.last_seen < now() - (reg.stale_after_hours || ' hours')::interval
  loop
    v_open := v_open || ('STALE:' || r.provider_id);
    insert into public.finance_alerts (severity, kind, title, detail, dedupe_key, subject,
                                       metric_value, threshold_value)
    values ('WARNING','COST_DATA_STALE', r.provider_id || ': cost data stale',
            'Last cost event ' || to_char(r.last_seen, 'YYYY-MM-DD HH24:MI')
              || ' UTC, beyond the ' || r.stale_after_hours || 'h freshness window.',
            'STALE:' || r.provider_id, r.provider_id,
            extract(epoch from (now() - r.last_seen))/3600.0, r.stale_after_hours)
    on conflict (dedupe_key) where resolved_at is null
      do update set last_seen_at = now(), occurrences = public.finance_alerts.occurrences + 1,
                    metric_value = excluded.metric_value, detail = excluded.detail;
    v_raised := v_raised + 1;
  end loop;

  -- Anything no longer true is resolved, so the list reflects now rather than
  -- the worst moment of the month.
  update public.finance_alerts
     set resolved_at = now()
   where resolved_at is null
     and kind in ('BUDGET_EXCEEDED','BUDGET_WARNING','BUDGET_DRIFT','UNPRICED_USAGE',
                  'SPEND_ANOMALY','MARGIN_BELOW_FLOOR','FX_RATE_MISSING','COST_DATA_STALE')
     and not (dedupe_key = ANY (v_open));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  drop table if exists _ff;
  return jsonb_build_object('raised', v_raised, 'auto_resolved', v_resolved, 'evaluated_at', now());
end;
$fn$;

REVOKE ALL ON FUNCTION public.finance_evaluate_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_evaluate_alerts() TO authenticated, service_role;
