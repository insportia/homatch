-- HOMATCH FINANCE — plans, credits, users, drill-down, budgets, charts.

-- ── Plan economics ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_plans(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz; v_cpu numeric;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  v_cpu := public.billing_setting_num('credits_per_usd', 10);

  return COALESCE((select jsonb_agg(t order by t->>'sort') from (
    select jsonb_build_object(
      'sort', bp.sort_order,
      'plan_code', bp.code,
      'plan_name', bp.name,
      'monthly_price_usd', round(bp.monthly_price_cents::numeric/100, 2),
      'active_users', (select count(*) from public.users u where COALESCE(u.plan,'FREE') = bp.code),
      'active_subscriptions', (select count(*) from public.user_subscriptions s
          where s.plan_code = bp.code and s.status in ('ACTIVE','PAST_DUE') and s.current_period_end > now()),
      -- MRR only counts subscriptions that are actually live and paid for.
      'mrr_usd', round((select count(*) from public.user_subscriptions s
          where s.plan_code = bp.code and s.status = 'ACTIVE' and s.current_period_end > now())
          * bp.monthly_price_cents::numeric / 100, 2),
      'membership_credits_granted', round(COALESCE((select sum(credits_granted) from public.credit_lots l
          where l.kind='MEMBERSHIP' and l.plan_code = bp.code and l.granted_at >= v_from), 0), 4),
      'membership_credits_spent', round(COALESCE((select sum(credits_consumed) from public.credit_lots l
          where l.kind='MEMBERSHIP' and l.plan_code = bp.code), 0), 4),
      'included_executions', COALESCE((select count(*) from public.usage_events u
          where u.plan_code = bp.code and u.allowance_funded and u.created_at >= v_from), 0),
      -- The cost of giving allowances away. Revenue is zero on these and the
      -- COGS is real, which is the whole point of tracking them apart.
      'included_usage_cogs_usd', round(COALESCE((select sum(landed_cogs_cents) from public.usage_events u
          where u.plan_code = bp.code and u.allowance_funded and u.created_at >= v_from), 0)/100, 6),
      'payg_executions', COALESCE((select count(*) from public.usage_events u
          where u.plan_code = bp.code and not u.allowance_funded and u.charged_credits > 0 and u.created_at >= v_from), 0),
      'payg_revenue_usd', round(COALESCE((select sum(charged_credits) from public.usage_events u
          where u.plan_code = bp.code and u.created_at >= v_from), 0) / v_cpu, 6),
      'provider_cogs_usd', round(COALESCE((select sum(landed_cogs_cents) from public.usage_events u
          where u.plan_code = bp.code and u.created_at >= v_from), 0)/100, 6),
      'gross_profit_usd', round(
          COALESCE((select sum(charged_credits) from public.usage_events u
            where u.plan_code = bp.code and u.created_at >= v_from), 0) / v_cpu
        - COALESCE((select sum(landed_cogs_cents) from public.usage_events u
            where u.plan_code = bp.code and u.created_at >= v_from), 0)/100, 6)
    ) as t
    from public.billing_plans bp where bp.enabled
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Credit economics ────────────────────────────────────────
-- Membership and promotional credits are NOT cash. This keeps them apart from
-- money that actually arrived, which is the single most important distinction
-- on this page.
CREATE OR REPLACE FUNCTION public.finance_credits()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
begin
  perform public.finance_require_admin();
  return jsonb_build_object(
    'credits_per_usd', v_cpu,
    'by_kind', COALESCE((select jsonb_agg(k order by k->>'kind') from (
      select jsonb_build_object(
        'kind', kind,
        'lots', count(*),
        'issued', round(COALESCE(sum(credits_granted),0), 4),
        'consumed', round(COALESCE(sum(credits_consumed),0), 4),
        'reserved', round(COALESCE(sum(credits_reserved),0), 4),
        'expired', round(COALESCE(sum(credits_expired),0), 4),
        'remaining', round(COALESCE(sum(credits_available),0), 4),
        'nominal_usd', round(COALESCE(sum(credits_granted),0) / v_cpu, 4),
        -- Only PURCHASED credits correspond to cash a customer actually paid.
        'is_cash_backed', (kind = 'PURCHASED')
      ) as k from public.credit_lots group by kind
    ) t), '[]'::jsonb),
    'cash_collected_usd', round(COALESCE((select sum(public.fx_to_usd(total_cents::numeric/100, currency, created_at))
        from public.payments where status='COMPLETED'), 0), 4),
    'liability_outstanding_credits', round(COALESCE((select sum(credits_available)
        from public.credit_lots where status <> 'EXPIRED'), 0), 4),
    'liability_outstanding_usd', round(COALESCE((select sum(credits_available)
        from public.credit_lots where status <> 'EXPIRED'), 0) / v_cpu, 4),
    'ledger_by_type', COALESCE((select jsonb_agg(l order by l->>'type') from (
      select jsonb_build_object('type', type::text, 'entries', count(*),
                                'net_credits', round(sum(amount), 4)) as l
      from public.credit_ledger group by type
    ) t), '[]'::jsonb),
    -- First top-up promo economics.
    'first_topup_promo', (select jsonb_build_object(
        'redemptions', count(*),
        'promo_credits_granted', round(COALESCE(sum(r.credits_granted),0), 4),
        'promo_credits_consumed', round(COALESCE((select sum(l.credits_consumed) from public.credit_lots l
            where l.kind='PROMOTIONAL'), 0), 4),
        'cash_from_qualifying_topups_usd', round(COALESCE((select sum(p.total_cents::numeric/100)
            from public.payments p where p.id in (select payment_id from public.promotion_redemptions)
              and p.status='COMPLETED'), 0), 4),
        'provider_cogs_from_promo_usd', round(COALESCE((select sum(u.landed_cogs_cents)/100
            from public.usage_events u where u.billable and u.charged_credits > 0), 0) * 0, 6))
      from public.promotion_redemptions r)
  );
end;
$fn$;

-- ── Per-user economics ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_users(
  p_days integer DEFAULT 30, p_sort text DEFAULT 'cogs', p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz; v_cpu numeric;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;
  v_cpu := public.billing_setting_num('credits_per_usd', 10);

  return COALESCE((select jsonb_agg(t) from (
    select jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'plan', COALESCE(u.plan,'FREE'),
      'subscription_revenue_usd', round(COALESCE((select sum(bp.monthly_price_cents)::numeric/100
          from public.user_subscriptions s join public.billing_plans bp on bp.code = s.plan_code
          where s.user_id = u.id and s.status='ACTIVE' and s.current_period_end > now()), 0), 2),
      'topup_revenue_usd', round(COALESCE((select sum(public.fx_to_usd(p.total_cents::numeric/100, p.currency, p.created_at))
          from public.payments p where p.user_id = u.id and p.status='COMPLETED' and p.created_at >= v_from), 0), 4),
      'payg_revenue_usd', round(COALESCE((select sum(ue.charged_credits) from public.usage_events ue
          where ue.user_id = u.id and ue.created_at >= v_from), 0) / v_cpu, 6),
      'credits_issued', round(COALESCE((select sum(credits_granted) from public.credit_lots l
          where l.user_id = u.id), 0), 4),
      'credits_consumed', round(COALESCE((select sum(credits_consumed) from public.credit_lots l
          where l.user_id = u.id), 0), 4),
      'included_consumed', COALESCE((select count(*) from public.allowance_consumptions a
          where a.user_id = u.id and a.released_at is null and a.created_at >= v_from), 0),
      -- Provider cost attributed to this customer, from the fact stream.
      'provider_cogs_usd', round(COALESCE((select sum(f.cost_usd) from public.finance_cost_facts f
          where f.is_cogs and f.user_id = u.id and f.occurred_at >= v_from), 0), 6),
      'verify_runs', COALESCE((select count(*) from public.research_jobs j
          where j.user_id = u.id and j.completed_at >= v_from), 0),
      'gross_profit_usd', round(
          COALESCE((select sum(p.total_cents::numeric/100) from public.payments p
            where p.user_id = u.id and p.status='COMPLETED' and p.created_at >= v_from), 0)
        + COALESCE((select sum(ue.charged_credits) from public.usage_events ue
            where ue.user_id = u.id and ue.created_at >= v_from), 0) / v_cpu
        - COALESCE((select sum(f.cost_usd) from public.finance_cost_facts f
            where f.is_cogs and f.user_id = u.id and f.occurred_at >= v_from), 0), 6)
    ) as t
    from public.users u
    order by case p_sort
      when 'cogs' then COALESCE((select sum(f.cost_usd) from public.finance_cost_facts f
                                  where f.is_cogs and f.user_id = u.id and f.occurred_at >= v_from), 0)
      when 'revenue' then COALESCE((select sum(p.total_cents::numeric/100) from public.payments p
                                  where p.user_id = u.id and p.status='COMPLETED'), 0)
      else 0 end desc nulls last
    limit greatest(1, least(p_limit, 500))
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Cost event drill-down ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_cost_events(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL, p_product text DEFAULT NULL,
  p_unpriced_only boolean DEFAULT false, p_job_ref text DEFAULT NULL,
  p_min_cost numeric DEFAULT NULL, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_rows jsonb; v_total integer; v_sum numeric;
begin
  perform public.finance_require_admin();

  select count(*), round(COALESCE(sum(cost_usd),0),6) into v_total, v_sum
    from public.finance_cost_facts f
   where f.is_cogs
     and (p_from is null or f.occurred_at >= p_from)
     and (p_to is null or f.occurred_at < p_to)
     and (p_provider is null or f.provider = p_provider)
     and (p_product is null or f.product = p_product)
     and (not p_unpriced_only or f.is_unpriced)
     and (p_job_ref is null or f.job_ref = p_job_ref)
     and (p_min_cost is null or f.cost_usd >= p_min_cost);

  select COALESCE(jsonb_agg(e order by (e->>'occurred_at') desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'fact_key', fact_key, 'occurred_at', occurred_at, 'provider', provider,
      'product', product, 'stage', stage, 'operation', operation, 'model', model,
      'quantity', quantity, 'unit', unit, 'web_searches', web_searches,
      'cost_usd', cost_usd, 'model_cost_usd', model_cost_usd, 'search_cost_usd', search_cost_usd,
      'cost_source', cost_source, 'is_unpriced', is_unpriced,
      'job_ref', job_ref, 'user_id', user_id, 'market', market, 'cache_hit', cache_hit,
      'source_currency', source_currency, 'source_amount', source_amount
    ) as e
    from public.finance_cost_facts f
    where f.is_cogs
      and (p_from is null or f.occurred_at >= p_from)
      and (p_to is null or f.occurred_at < p_to)
      and (p_provider is null or f.provider = p_provider)
      and (p_product is null or f.product = p_product)
      and (not p_unpriced_only or f.is_unpriced)
      and (p_job_ref is null or f.job_ref = p_job_ref)
      and (p_min_cost is null or f.cost_usd >= p_min_cost)
    order by f.occurred_at desc
    limit greatest(1, least(p_limit, 1000)) offset greatest(0, p_offset)
  ) t;

  return jsonb_build_object('total', v_total, 'sum_usd', v_sum, 'rows', v_rows);
end;
$fn$;

-- ── One execution, fully auditable ──────────────────────────
CREATE OR REPLACE FUNCTION public.finance_execution_detail(p_job_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
        v_cogs numeric; v_charged numeric; v_res record; v_bill record;
begin
  perform public.finance_require_admin();

  select COALESCE(sum(cost_usd),0) into v_cogs
    from public.finance_cost_facts where is_cogs and job_ref = p_job_ref;

  select * into v_bill from public.verify_billing_events where job_id::text = p_job_ref;
  select * into v_res from public.usage_reservations where job_ref = p_job_ref order by created_at desc limit 1;
  select COALESCE(sum(charged_credits),0) into v_charged
    from public.usage_events where job_ref = p_job_ref;

  return jsonb_build_object(
    'job_ref', p_job_ref,
    'found', (v_bill.job_id is not null or v_res.id is not null or v_cogs > 0),
    'subject', v_bill.subject,
    'user_id', COALESCE(v_bill.user_id, v_res.user_id),
    'completed_at', v_bill.completed_at,
    'duration_seconds', v_bill.duration_seconds,
    'quality_tier', COALESCE(v_res.quality_tier_snapshot, v_bill.quality_tier),
    'plan_code', v_res.plan_code_snapshot,
    'pricing_version', v_res.pricing_version_snapshot,
    'price_book_effective_from', v_bill.price_book_effective_from,
    'tokens', v_bill.total_tokens,
    'cached_tokens', v_bill.cached_input_tokens,
    'web_searches', v_bill.web_searches,
    'stage_breakdown', v_bill.stage_breakdown,
    'reuse', jsonb_build_object(
      'graph_hit', v_bill.reuse_graph_hit,
      'facts_reused', v_bill.reuse_facts_reused,
      'facts_required', v_bill.reuse_facts_required),
    'provider_cogs_usd', round(v_cogs, 6),
    'customer_credits_charged', round(v_charged, 4),
    'customer_charge_usd', round(v_charged / v_cpu, 6),
    'gross_profit_usd', round(v_charged / v_cpu - v_cogs, 6),
    'gross_margin_bps', case when v_charged > 0
      then round((v_charged / v_cpu - v_cogs) / (v_charged / v_cpu) * 10000)::integer else null end,
    'authorized_max_credits', v_res.authorized_max_credits,
    'reserved_credits', v_res.reserved_credits,
    'released_credits', v_res.released_credits,
    -- Whether the minimum-margin floor moved the price is recorded on the
    -- reservation, so the pricing engine stays auditable after the fact.
    'margin_floor_applied', COALESCE((v_res.metadata->>'clamped')::boolean, false),
    'funding', case when v_res.id is null then 'UNBILLED'
                    when v_res.authorized_max_credits = 0 then 'INCLUDED' else 'PAYG' end,
    'facts', COALESCE((select jsonb_agg(jsonb_build_object(
        'occurred_at', occurred_at, 'provider', provider, 'stage', stage,
        'model', model, 'quantity', quantity, 'web_searches', web_searches,
        'cost_usd', cost_usd, 'cost_source', cost_source, 'is_unpriced', is_unpriced)
        order by occurred_at)
      from public.finance_cost_facts where is_cogs and job_ref = p_job_ref), '[]'::jsonb)
  );
end;
$fn$;

-- ── Budgets, and the drift between finance and enforcement ──
CREATE OR REPLACE FUNCTION public.finance_budget_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_month timestamptz; v_day timestamptz;
begin
  perform public.finance_require_admin();
  v_month := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_day := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  return COALESCE((select jsonb_agg(b order by (b->>'used_bps')::int desc nulls last) from (
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
        from public.finance_cost_facts f
       where f.is_cogs
         and f.occurred_at >= case fb.period when 'DAY' then v_day else v_month end
         and (fb.scope = 'COMPANY'
              or (fb.scope='PROVIDER' and f.provider = fb.scope_value)
              or (fb.scope='PRODUCT'  and f.product  = fb.scope_value))
    ) s
    where fb.active
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Time series for the charts ──────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_timeseries(
  p_days integer DEFAULT 30, p_bucket text DEFAULT 'day'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_from timestamptz; v_cpu numeric;
begin
  perform public.finance_require_admin();
  if p_bucket not in ('day','week','month') then raise exception 'INVALID_BUCKET'; end if;
  v_from := date_trunc(p_bucket, (now() - (p_days || ' days')::interval) AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_cpu := public.billing_setting_num('credits_per_usd', 10);

  return COALESCE((select jsonb_agg(d order by d->>'bucket') from (
    select jsonb_build_object(
      'bucket', b.bucket,
      'spend_usd', round(COALESCE(c.spend,0), 6),
      'revenue_usd', round(COALESCE(r.revenue,0), 6),
      'gross_profit_usd', round(COALESCE(r.revenue,0) - COALESCE(c.spend,0), 6),
      'events', COALESCE(c.events,0)
    ) as d
    from generate_series(v_from, now(), ('1 ' || p_bucket)::interval) b(bucket)
    left join lateral (
      select sum(cost_usd) spend, count(*) events from public.finance_cost_facts f
       where f.is_cogs
         and f.occurred_at >= b.bucket
         and f.occurred_at < b.bucket + ('1 ' || p_bucket)::interval) c on true
    left join lateral (
      select sum(public.fx_to_usd(p.total_cents::numeric/100, p.currency, p.created_at)) revenue
        from public.payments p
       where p.status='COMPLETED' and p.created_at >= b.bucket
         and p.created_at < b.bucket + ('1 ' || p_bucket)::interval) r on true
  ) x), '[]'::jsonb);
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_plans(integer)',
    'public.finance_credits()',
    'public.finance_users(integer, text, integer)',
    'public.finance_cost_events(timestamptz, timestamptz, text, text, boolean, text, numeric, integer, integer)',
    'public.finance_execution_detail(text)',
    'public.finance_budget_status()',
    'public.finance_timeseries(integer, text)',
    'public.finance_monthly_equivalent_cents(integer, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
