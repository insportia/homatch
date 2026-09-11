-- The single-scan rewrite keyed months on a timestamptz and stepped the series
-- with `interval '1 month'`. In a timezone ahead of UTC a month start lands on
-- the PREVIOUS month's 31st in UTC, and adding a month to the 31st drifts
-- (31 Jan + 1 month = 28 Feb). The series therefore produced 2026-08-28 where
-- the grouped spend produced a true month start, the join missed every row,
-- and the whole month-by-month table rendered zeros.
--
-- Found on production: month_start came back as 2026-08-28T20:00:00+00:00.
--
-- Months are a LOCAL calendar concept. Both sides now key on the local
-- timestamp (no round trip), and the conversion to timestamptz happens once,
-- for display and for bounding the scan.

CREATE OR REPLACE FUNCTION public.finance_monthly_summary(p_months integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_tz text := public.finance_tz();
  v_from_local timestamp := date_trunc('month', (now() - (p_months || ' months')::interval) AT TIME ZONE v_tz);
  v_this_local timestamp := date_trunc('month', now() AT TIME ZONE v_tz);
  v_from timestamptz := v_from_local AT TIME ZONE v_tz;
begin
  perform public.finance_require_admin();

  return COALESCE((
    with spend as (
      -- One pass, keyed on the LOCAL month the cost belongs to.
      select date_trunc('month', f.occurred_at AT TIME ZONE v_tz) as m,
             sum(f.cost_usd) as spend, count(*) as events,
             count(*) filter (where f.is_unpriced) as unpriced
        from public.finance_cost_facts f
       where f.is_cogs and f.occurred_at >= v_from
       group by 1
    ), revenue as (
      select date_trunc('month', p.created_at AT TIME ZONE v_tz) as m,
             sum(public.fx_to_usd(p.total_cents::numeric/100, p.currency, p.created_at)) as revenue
        from public.payments p
       where p.status='COMPLETED' and p.created_at >= v_from
       group by 1
    )
    select jsonb_agg(x order by x->>'month' desc) from (
      select jsonb_build_object(
        'month', to_char(b.m, 'YYYY-MM'),
        'month_start', b.m AT TIME ZONE v_tz,
        'is_current', b.m = v_this_local,
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
      -- Stepping a plain timestamp by a month is exact calendar arithmetic:
      -- no offset, nothing to drift.
      from generate_series(v_from_local, v_this_local, interval '1 month') b(m)
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

REVOKE ALL ON FUNCTION public.finance_monthly_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_monthly_summary(integer) TO authenticated, service_role;
