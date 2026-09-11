-- The live feed polls every 30 seconds and was sorting the ENTIRE fact stream
-- to take the newest 60 rows: 3.9s a call, for a panel that only ever shows
-- recent activity. Bounding the window to 48 hours keeps every figure on the
-- card (5m, 1h, today all sit inside it) and makes the sort trivial.
--
-- "today" is a business-timezone day, and the business timezone can be ahead
-- of UTC, so 48 hours is the safe floor rather than 24.
--
-- Applied to production as finance_live_feed_bounded_window; the exact applied
-- statements are in supabase_migrations.schema_migrations at this version.

CREATE OR REPLACE FUNCTION public.finance_live_feed(p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_tz text := public.finance_tz(); v_day timestamptz; v_window timestamptz;
begin
  perform public.finance_require_admin();
  v_day := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  -- Wide enough to contain the business day whatever the offset.
  v_window := least(v_day, now() - interval '48 hours');

  return (
    with recent as (
      select fact_key, occurred_at, provider, product, stage, operation, model,
             quantity, unit, web_searches, cost_usd, cost_source, is_unpriced,
             job_ref, user_id
        from public.finance_cost_facts
       where is_cogs and occurred_at >= v_window
    )
    select jsonb_build_object(
      'spend_5m',    round(COALESCE(sum(cost_usd) filter (where occurred_at >= now() - interval '5 minutes'),0), 6),
      'spend_1h',    round(COALESCE(sum(cost_usd) filter (where occurred_at >= now() - interval '1 hour'),0), 6),
      'spend_today', round(COALESCE(sum(cost_usd) filter (where occurred_at >= v_day),0), 6),
      'events_1h',   count(*) filter (where occurred_at >= now() - interval '1 hour'),
      -- Only meaningful with enough activity behind it. Below that it is noise
      -- dressed as a number, so it is returned as null and the UI says so.
      'burn_per_hour', case when count(*) filter (where occurred_at >= now() - interval '1 hour') >= 5
        then round(COALESCE(sum(cost_usd) filter (where occurred_at >= now() - interval '1 hour'),0), 4)
        else null end,
      'window_hours', round(extract(epoch from (now() - v_window))/3600.0),
      'events', COALESCE((select jsonb_agg(e order by (e->>'occurred_at') desc) from (
        select jsonb_build_object(
          'fact_key', fact_key, 'occurred_at', occurred_at, 'provider', provider,
          'product', product, 'stage', stage, 'operation', operation,
          'model', model, 'quantity', quantity, 'unit', unit,
          'web_searches', web_searches,
          'cost_usd', cost_usd, 'cost_source', cost_source,
          'is_unpriced', is_unpriced, 'job_ref', job_ref, 'user_id', user_id
        ) as e
        from recent
        order by occurred_at desc
        limit greatest(1, least(p_limit, 200))
      ) t), '[]'::jsonb)
    )
    from recent
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.finance_live_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_live_feed(integer) TO authenticated, service_role;
