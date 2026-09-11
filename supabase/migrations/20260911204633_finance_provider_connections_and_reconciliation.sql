-- ── Provider Connections: the audit, as a screen ────────────
CREATE OR REPLACE FUNCTION public.finance_provider_connections()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  return COALESCE((select jsonb_agg(p order by
      case p->>'access_status'
        when 'CONNECTED_BILLING_ACCESS' then 0
        when 'CONNECTED_USAGE_ACCESS' then 1
        when 'CONNECTED_LOCAL_COST_CALCULATION' then 2
        when 'CONNECTED_BILLING_PERMISSION_MISSING' then 3
        when 'CONNECTED_SERVICE_ONLY' then 4
        else 5 end,
      (p->>'sort_order')::int) from (
    select jsonb_build_object(
      'provider_id', r.provider_id,
      'provider_name', r.provider_name,
      'category', r.category, 'category_label', c.label,
      'sort_order', r.sort_order, 'icon_key', r.icon_key,
      'homatch_use', r.homatch_use,
      'access_status', r.access_status,
      'service_access', r.service_access,
      'usage_access', r.usage_access,
      'billing_access', r.billing_access,
      'invoice_access', r.invoice_access,
      'credential_sufficient', r.credential_sufficient,
      'missing_permission', r.missing_permission,
      -- The env var NAME and whether it is set. Never the value.
      'credential_env_var', r.credential_env_var,
      'credentials_present', r.credentials_present,
      'cost_source', r.default_cost_source,
      'sync_mode', r.sync_mode,
      'supports_live_metering', r.supports_live_metering,
      'supports_provider_reported_cost', r.supports_provider_reported_cost,
      'supports_usage_import', r.supports_usage_import,
      'supports_invoice_import', r.supports_invoice_import,
      'supports_manual_cost', r.supports_manual_cost,
      'supports_effective_dated_pricing', r.supports_effective_dated_pricing,
      -- Health comes from the existing provider_health table rather than a
      -- second copy of the same idea.
      'health_status', h.status,
      'last_tested_at', h.last_tested_at,
      'last_success_at', h.last_success_at,
      'latency_ms', h.latency_ms,
      'last_error', h.last_error,
      'last_sync_at', r.last_sync_at,
      'last_sync_error', r.last_sync_error,
      'last_cost_event_at', f.last_seen,
      'cost_events_30d', COALESCE(f.events, 0),
      'spend_30d_usd', round(COALESCE(f.spend, 0), 6),
      'unpriced_30d', COALESCE(f.unpriced, 0),
      -- Stale means the number on screen is old, and saying so is the point.
      'stale', (r.access_status::text <> 'NOT_CONFIGURED'
                AND r.sync_mode <> 'NONE'
                AND COALESCE(f.events,0) > 0
                AND f.last_seen < now() - (r.stale_after_hours || ' hours')::interval),
      'stale_after_hours', r.stale_after_hours,
      'data_quality', case
        when r.access_status::text = 'NOT_CONFIGURED' then 'NONE'
        when COALESCE(f.events,0) = 0 then 'NO_DATA'
        when COALESCE(f.unpriced,0)::numeric / greatest(f.events,1) > 0.5 then 'POOR'
        when COALESCE(f.unpriced,0) > 0 then 'PARTIAL'
        when h.status = 'REAL_TEST_PASSED' then 'GOOD'
        else 'UNVERIFIED' end,
      'action_required', case
        when r.access_status::text = 'NOT_CONFIGURED' and r.credential_env_var is not null
          then 'Credential not set: ' || r.credential_env_var
        when r.billing_access::text = 'PERMISSION_MISSING' then r.missing_permission
        when COALESCE(f.unpriced,0) > 0 then COALESCE(f.unpriced,0) || ' unpriced events to resolve'
        else null end,
      'reconciliation', (select jsonb_build_object(
            'status', rc.status, 'local_usd', rc.local_usd,
            'provider_usd', rc.provider_usd, 'delta_usd', rc.delta_usd,
            'period_start', rc.period_start, 'period_end', rc.period_end)
          from public.finance_reconciliations rc
         where rc.provider_id = r.provider_id
         order by rc.period_end desc limit 1),
      'notes', r.notes
    ) as p
    from public.finance_provider_registry r
    join public.finance_provider_categories c on c.code = r.category
    left join public.provider_health h on h.provider = r.health_key
    left join lateral (
      select sum(ff.cost_usd) spend, count(*) events,
             count(*) filter (where ff.is_unpriced) unpriced, max(ff.occurred_at) last_seen
        from public.finance_cost_facts ff
       where ff.provider = r.provider_id
         and ff.occurred_at >= now() - interval '30 days') f on true
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Reconciliation ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_reconcile(
  p_provider_id text, p_period_start date, p_period_end date,
  p_provider_usd numeric DEFAULT NULL, p_tolerance_bps integer DEFAULT 200,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_local numeric; v_status text; v_unpriced integer; v_id uuid;
begin
  perform public.finance_require_admin();

  select COALESCE(sum(cost_usd),0), count(*) filter (where is_unpriced)
    into v_local, v_unpriced
    from public.finance_cost_facts
   where provider = p_provider_id and origin <> 'INVOICE' and is_cogs
     and occurred_at >= p_period_start::timestamptz
     and occurred_at < (p_period_end + 1)::timestamptz;

  v_status := case
    when p_provider_usd is null then 'UNAVAILABLE'
    -- Unpriced usage means the local side is knowably incomplete, so a
    -- difference proves nothing yet.
    when v_unpriced > 0 then 'INCOMPLETE'
    when p_provider_usd = v_local then 'MATCHED'
    when p_provider_usd = 0 then case when v_local = 0 then 'MATCHED' else 'MISMATCH' end
    when abs(p_provider_usd - v_local) / greatest(p_provider_usd, 0.000001) * 10000 <= p_tolerance_bps
      then 'WITHIN_TOLERANCE'
    else 'MISMATCH' end;

  insert into public.finance_reconciliations (
    provider_id, period_start, period_end, local_usd, provider_usd,
    tolerance_bps, status, note, created_by)
  values (p_provider_id, p_period_start, p_period_end, v_local, p_provider_usd,
          p_tolerance_bps, v_status, p_note, public.auth_user_id())
  on conflict (provider_id, period_start, period_end) do update set
    local_usd = excluded.local_usd, provider_usd = excluded.provider_usd,
    tolerance_bps = excluded.tolerance_bps, status = excluded.status,
    note = excluded.note, created_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', v_status,
    'local_usd', round(v_local,6), 'provider_usd', p_provider_usd,
    'delta_usd', round(COALESCE(p_provider_usd,0) - v_local, 6),
    'unpriced_events', v_unpriced,
    -- Stated because the temptation to "fix" a mismatch by editing events is
    -- exactly the thing that destroys an audit trail.
    'note', 'Local events are never rewritten to match a provider total. '
         || 'A real difference is booked as its own adjustment.');
end;
$fn$;

-- Record a component that another provider actually billed, so an orchestrated
-- call can be broken down without booking the same dollar twice.
CREATE OR REPLACE FUNCTION public.finance_record_component_cost(
  p_parent_event_id uuid, p_component text, p_billed_by text,
  p_quantity numeric DEFAULT 0, p_source_amount numeric DEFAULT NULL,
  p_source_currency char(3) DEFAULT 'USD'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_parent record; v_id uuid;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: cost recording is server-side only';
  end if;
  select * into v_parent from public.finance_provider_cost_events where id = p_parent_event_id;
  if v_parent.id is null then raise exception 'PARENT_EVENT_NOT_FOUND'; end if;
  if not exists (select 1 from public.finance_provider_registry where provider_id = p_billed_by) then
    raise exception 'UNREGISTERED_PROVIDER: %', p_billed_by;
  end if;

  insert into public.finance_provider_cost_events (
    provider_id, billed_by_provider_id, parent_event_id, component, occurred_at,
    product_code, operation, user_id, job_ref, quantity, unit,
    source_currency, source_amount,
    cost_usd, cost_source, charge_class)
  values (
    v_parent.provider_id, p_billed_by, p_parent_event_id, p_component, v_parent.occurred_at,
    v_parent.product_code, v_parent.operation, v_parent.user_id, v_parent.job_ref,
    p_quantity, v_parent.unit, COALESCE(p_source_currency,'USD'), p_source_amount,
    public.fx_to_usd(p_source_amount, COALESCE(p_source_currency,'USD'), v_parent.occurred_at),
    'PROVIDER_REPORTED', v_parent.charge_class)
  returning id into v_id;
  return v_id;
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_provider_connections()',
    'public.finance_reconcile(text, date, date, numeric, integer, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.finance_record_component_cost(uuid, text, text, numeric, numeric, char) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.finance_record_component_cost(uuid, text, text, numeric, numeric, char) TO service_role';
END $$;
