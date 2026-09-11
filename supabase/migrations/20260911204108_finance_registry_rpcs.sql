-- Registry-aware reporting and mutation. The dashboard reads capabilities from
-- here and renders itself; it never switches on a provider's name.

-- ── The registry, as the UI sees it ─────────────────────────
CREATE OR REPLACE FUNCTION public.finance_provider_registry_list(
  p_days integer DEFAULT 30, p_include_inactive boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;

  return jsonb_build_object(
    'categories', COALESCE((select jsonb_agg(jsonb_build_object(
        'code', code, 'label', label, 'sort_order', sort_order) order by sort_order)
      from public.finance_provider_categories), '[]'::jsonb),
    'units', COALESCE((select jsonb_agg(jsonb_build_object(
        'code', code, 'label', label, 'precision', precision) order by code)
      from public.finance_billing_units), '[]'::jsonb),
    'providers', COALESCE((select jsonb_agg(p order by (p->>'sort_order')::int) from (
      select jsonb_build_object(
        'provider_id', r.provider_id,
        'provider_name', r.provider_name,
        'category', r.category,
        'category_label', c.label,
        'billing_unit', r.billing_unit,
        'unit_label', u.label,
        'unit_precision', u.precision,
        'currency', r.currency,
        'supports_live_metering', r.supports_live_metering,
        'supports_usage_import', r.supports_usage_import,
        'supports_manual_invoice', r.supports_manual_invoice,
        'supports_effective_dated_pricing', r.supports_effective_dated_pricing,
        'active', r.active,
        'credentials_present', r.credentials_present,
        -- The NAME of the variable, never its value. Nothing here is a secret.
        'credential_env_var', r.credential_env_var,
        'icon_key', r.icon_key,
        'accent', r.accent,
        'sort_order', r.sort_order,
        'default_product', r.default_product,
        'counts_as_cogs', r.counts_as_cogs,
        'notes', r.notes,
        -- Live figures, so a registered provider that has never cost anything
        -- is visibly distinct from one that is simply quiet this month.
        'spend_usd', round(COALESCE(f.spend, 0), 6),
        'events', COALESCE(f.events, 0),
        'quantity', round(COALESCE(f.quantity, 0), 4),
        'unpriced_events', COALESCE(f.unpriced, 0),
        'last_seen_at', f.last_seen,
        'price_rules', COALESCE(pr.rules, 0),
        'invoices', COALESCE(iv.invoices, 0),
        'state', case
          when not r.active and COALESCE(f.events,0) = 0 then 'REGISTERED'
          when not r.credentials_present and COALESCE(f.events,0) = 0 then 'NOT_CONFIGURED'
          when COALESCE(f.unpriced,0) > 0 then 'UNPRICED'
          when COALESCE(f.events,0) = 0 then 'IDLE'
          else 'LIVE' end
      ) as p
      from public.finance_provider_registry r
      join public.finance_provider_categories c on c.code = r.category
      join public.finance_billing_units u on u.code = r.billing_unit
      left join lateral (
        select sum(cost_usd) spend, count(*) events, sum(quantity) quantity,
               count(*) filter (where is_unpriced) unpriced, max(occurred_at) last_seen
          from public.finance_cost_facts ff
         where ff.provider = r.provider_id and ff.occurred_at >= v_from) f on true
      left join lateral (
        select count(*) rules from public.finance_provider_prices pp
         where pp.provider_id = r.provider_id
           and (pp.effective_to is null or pp.effective_to > now())) pr on true
      left join lateral (
        select count(*) invoices from public.finance_provider_invoices ii
         where ii.provider_id = r.provider_id) iv on true
      where p_include_inactive or r.active
    ) x), '[]'::jsonb)
  );
end;
$fn$;

-- ── Providers report, now driven by the registry ────────────
-- Replaces the earlier version, which grouped only over whatever happened to
-- appear in the facts. A provider with no spend now still has a row.
CREATE OR REPLACE FUNCTION public.finance_providers(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := now() - (p_days || ' days')::interval;

  return COALESCE((select jsonb_agg(p order by (p->>'spend_usd')::numeric desc, p->>'provider_name') from (
    select jsonb_build_object(
      'provider_id', r.provider_id,
      'provider_name', r.provider_name,
      'category', r.category,
      'category_label', c.label,
      'billing_unit', r.billing_unit,
      'currency', r.currency,
      'icon_key', r.icon_key,
      'active', r.active,
      'credentials_present', r.credentials_present,
      'supports_live_metering', r.supports_live_metering,
      'supports_usage_import', r.supports_usage_import,
      'supports_manual_invoice', r.supports_manual_invoice,
      'supports_effective_dated_pricing', r.supports_effective_dated_pricing,
      'spend_usd', round(COALESCE(f.spend,0), 6),
      'spend_today_usd', round(COALESCE(f.today,0), 6),
      'events', COALESCE(f.events,0),
      'quantity', round(COALESCE(f.quantity,0), 4),
      'cost_per_unit_usd', case when COALESCE(f.quantity,0) > 0
        then round(COALESCE(f.spend,0) / f.quantity, 8) else null end,
      'unpriced_events', COALESCE(f.unpriced,0),
      'unpriced_quantity', round(COALESCE(f.unpriced_qty,0), 4),
      'cache_hits', COALESCE(f.cache_hits,0),
      'last_seen_at', f.last_seen,
      'share_bps', case when COALESCE(tot.total,0) > 0
        then round(COALESCE(f.spend,0) / tot.total * 10000)::integer else 0 end,
      'by_product', COALESCE(f.by_product, '[]'::jsonb),
      -- The invoice-vs-meter check. A gap here is either an unmetered cost or
      -- a billing surprise, and both are worth seeing.
      'invoiced_usd', round(COALESCE(iv.invoiced,0), 6),
      'metered_vs_invoiced_delta_usd', case when COALESCE(iv.invoiced,0) > 0
        then round(COALESCE(f.spend,0) - iv.invoiced, 6) else null end
    ) as p
    from public.finance_provider_registry r
    join public.finance_provider_categories c on c.code = r.category
    cross join lateral (select sum(cost_usd) total from public.finance_cost_facts
                         where is_cogs and occurred_at >= v_from) tot
    left join lateral (
      select sum(ff.cost_usd) spend,
             sum(ff.cost_usd) filter (where ff.occurred_at >= date_trunc('day', now() AT TIME ZONE public.finance_tz()) AT TIME ZONE public.finance_tz()) today,
             count(*) events, sum(ff.quantity) quantity,
             count(*) filter (where ff.is_unpriced) unpriced,
             sum(ff.quantity) filter (where ff.is_unpriced) unpriced_qty,
             count(*) filter (where ff.cache_hit) cache_hits,
             max(ff.occurred_at) last_seen,
             (select jsonb_agg(jsonb_build_object('product', product, 'usd', round(s,6), 'events', n)
                                order by s desc)
                from (select ff2.product, sum(ff2.cost_usd) s, count(*) n
                        from public.finance_cost_facts ff2
                       where ff2.is_cogs and ff2.provider = r.provider_id and ff2.occurred_at >= v_from
                       group by ff2.product) q) by_product
        from public.finance_cost_facts ff
       where ff.is_cogs and ff.provider = r.provider_id and ff.occurred_at >= v_from) f on true
    left join lateral (
      select sum(public.fx_to_usd(
               case when ii.reversal_of is not null then -ii.source_amount else ii.source_amount end,
               ii.source_currency, (ii.period_end + 1)::timestamptz)) invoiced
        from public.finance_provider_invoices ii
       where ii.provider_id = r.provider_id and (ii.period_end + 1)::timestamptz >= v_from) iv on true
    where r.active or COALESCE(f.events,0) > 0
  ) x), '[]'::jsonb);
end;
$fn$;

-- ── Recording cost from anywhere, without a migration ───────
-- The one entry point a new integration calls. Service role only: a customer
-- session must never be able to write the company's cost ledger.
CREATE OR REPLACE FUNCTION public.finance_record_cost(
  p_provider_id text,
  p_operation text DEFAULT 'USAGE',
  p_quantity numeric DEFAULT 0,
  p_unit text DEFAULT NULL,
  p_source_amount numeric DEFAULT NULL,
  p_source_currency char(3) DEFAULT NULL,
  p_product_code text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_job_ref text DEFAULT NULL,
  p_market text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_cache_hit boolean DEFAULT false,
  p_success boolean DEFAULT true,
  p_occurred_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_r record; v_id uuid; v_at timestamptz := COALESCE(p_occurred_at, now());
        v_cost numeric; v_source text;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: cost recording is server-side only';
  end if;

  select * into v_r from public.finance_provider_registry where provider_id = p_provider_id;
  if v_r.provider_id is null then
    -- Deliberately loud. An unregistered provider means money we cannot
    -- categorise, and silently accepting it is how a cost source goes missing.
    raise exception 'UNREGISTERED_PROVIDER: % is not in finance_provider_registry', p_provider_id;
  end if;

  if p_source_amount is not null then
    v_cost := public.fx_to_usd(p_source_amount, COALESCE(p_source_currency, v_r.currency), v_at);
    v_source := 'MEASURED';
  elsif v_r.supports_effective_dated_pricing then
    v_cost := COALESCE(p_quantity,0)
            * public.finance_provider_unit_cost(p_provider_id, p_operation, p_market, v_at);
    v_source := case when v_cost is null then 'UNPRICED' else 'PRICE_BOOK' end;
  else
    v_source := 'UNPRICED';
  end if;

  insert into public.finance_provider_cost_events (
    provider_id, occurred_at, product_code, operation, user_id, job_ref, market,
    quantity, unit, source_currency, source_amount, cost_usd, cost_source,
    counts_as_cogs, cache_hit, success, external_ref, metadata)
  values (
    p_provider_id, v_at,
    COALESCE(p_product_code, public.finance_product_for_operation(p_operation, v_r.default_product)),
    p_operation, p_user_id, p_job_ref, p_market,
    COALESCE(p_quantity,0), COALESCE(p_unit, v_r.billing_unit),
    COALESCE(p_source_currency, v_r.currency), p_source_amount, v_cost, v_source,
    v_r.counts_as_cogs, COALESCE(p_cache_hit,false), COALESCE(p_success,true),
    p_external_ref, COALESCE(p_metadata,'{}'::jsonb))
  -- Replaying an import or retrying a call must not double-count.
  on conflict (provider_id, external_ref) where external_ref is not null
    do update set quantity = excluded.quantity,
                  cost_usd = excluded.cost_usd,
                  source_amount = excluded.source_amount,
                  cost_source = excluded.cost_source
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ── Admin mutations ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_register_provider(p_provider jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_id text;
begin
  perform public.finance_require_admin();
  v_id := upper(trim(p_provider->>'provider_id'));

  insert into public.finance_provider_registry (
    provider_id, provider_name, category, billing_unit, currency,
    supports_live_metering, supports_usage_import, supports_manual_invoice,
    supports_effective_dated_pricing, active, credentials_present, credential_env_var,
    icon_key, accent, sort_order, default_product, counts_as_cogs, notes)
  values (
    v_id,
    COALESCE(p_provider->>'provider_name', v_id),
    COALESCE(p_provider->>'category', 'OTHER'),
    COALESCE(p_provider->>'billing_unit', 'UNITS'),
    COALESCE(p_provider->>'currency', 'USD'),
    COALESCE((p_provider->>'supports_live_metering')::boolean, false),
    COALESCE((p_provider->>'supports_usage_import')::boolean, false),
    COALESCE((p_provider->>'supports_manual_invoice')::boolean, true),
    COALESCE((p_provider->>'supports_effective_dated_pricing')::boolean, false),
    COALESCE((p_provider->>'active')::boolean, true),
    COALESCE((p_provider->>'credentials_present')::boolean, false),
    nullif(p_provider->>'credential_env_var',''),
    nullif(p_provider->>'icon_key',''), nullif(p_provider->>'accent',''),
    COALESCE((p_provider->>'sort_order')::integer, 100),
    nullif(p_provider->>'default_product',''),
    COALESCE((p_provider->>'counts_as_cogs')::boolean, true),
    nullif(p_provider->>'notes',''))
  on conflict (provider_id) do update set
    provider_name = excluded.provider_name,
    category = excluded.category,
    billing_unit = excluded.billing_unit,
    currency = excluded.currency,
    supports_live_metering = excluded.supports_live_metering,
    supports_usage_import = excluded.supports_usage_import,
    supports_manual_invoice = excluded.supports_manual_invoice,
    supports_effective_dated_pricing = excluded.supports_effective_dated_pricing,
    active = excluded.active,
    credentials_present = excluded.credentials_present,
    credential_env_var = excluded.credential_env_var,
    icon_key = excluded.icon_key, accent = excluded.accent,
    sort_order = excluded.sort_order,
    default_product = excluded.default_product,
    counts_as_cogs = excluded.counts_as_cogs,
    notes = excluded.notes;

  return jsonb_build_object('provider_id', v_id, 'ok', true);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_set_provider_price(
  p_provider_id text, p_unit_cost numeric, p_unit text DEFAULT NULL,
  p_operation text DEFAULT '*', p_market text DEFAULT '*',
  p_currency char(3) DEFAULT 'USD', p_effective_from timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz := COALESCE(p_effective_from, now()); v_id bigint; v_unit text;
begin
  perform public.finance_require_admin();
  select COALESCE(p_unit, billing_unit) into v_unit
    from public.finance_provider_registry where provider_id = p_provider_id;
  if v_unit is null then raise exception 'UNREGISTERED_PROVIDER: %', p_provider_id; end if;

  -- A new rate CLOSES the old one rather than editing it, so historical cost
  -- keeps being priced at the rate that was actually in force.
  update public.finance_provider_prices
     set effective_to = v_from
   where provider_id = p_provider_id
     and operation = COALESCE(p_operation,'*') and market = COALESCE(p_market,'*')
     and effective_to is null and effective_from < v_from;

  insert into public.finance_provider_prices (
    provider_id, operation, market, unit, unit_cost, currency, effective_from, note, created_by)
  values (p_provider_id, COALESCE(p_operation,'*'), COALESCE(p_market,'*'), v_unit,
          p_unit_cost, COALESCE(p_currency,'USD'), v_from, p_note, public.auth_user_id())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'effective_from', v_from, 'ok', true);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_record_provider_invoice(
  p_provider_id text, p_period_start date, p_period_end date,
  p_source_amount numeric, p_source_currency char(3) DEFAULT 'USD',
  p_invoice_ref text DEFAULT NULL, p_product_code text DEFAULT NULL,
  p_counts_as_cogs boolean DEFAULT true, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_id uuid; v_metered numeric;
begin
  perform public.finance_require_admin();
  if not exists (select 1 from public.finance_provider_registry where provider_id = p_provider_id) then
    raise exception 'UNREGISTERED_PROVIDER: %', p_provider_id;
  end if;

  insert into public.finance_provider_invoices (
    provider_id, period_start, period_end, invoice_ref, source_currency,
    source_amount, counts_as_cogs, product_code, note, created_by)
  values (p_provider_id, p_period_start, p_period_end, p_invoice_ref,
          COALESCE(p_source_currency,'USD'), p_source_amount,
          COALESCE(p_counts_as_cogs,true), p_product_code, p_note, public.auth_user_id())
  returning id into v_id;

  -- Report the meter alongside, so the operator sees the gap immediately.
  select COALESCE(sum(cost_usd),0) into v_metered
    from public.finance_cost_facts
   where provider = p_provider_id and origin <> 'INVOICE'
     and occurred_at >= p_period_start::timestamptz
     and occurred_at < (p_period_end + 1)::timestamptz;

  return jsonb_build_object('id', v_id, 'ok', true,
    'invoiced_usd', round(public.fx_to_usd(p_source_amount, COALESCE(p_source_currency,'USD'), (p_period_end+1)::timestamptz), 6),
    'metered_usd', round(v_metered, 6));
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_provider_registry_list(integer, boolean)',
    'public.finance_providers(integer)',
    'public.finance_register_provider(jsonb)',
    'public.finance_set_provider_price(text, numeric, text, text, text, char, timestamptz, text)',
    'public.finance_record_provider_invoice(text, date, date, numeric, char, text, text, boolean, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  -- Cost recording is not an authenticated-user capability at all.
  EXECUTE 'REVOKE ALL ON FUNCTION public.finance_record_cost(text, text, numeric, text, numeric, char, text, uuid, text, text, text, boolean, boolean, timestamptz, jsonb) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.finance_record_cost(text, text, numeric, text, numeric, char, text, uuid, text, text, text, boolean, boolean, timestamptz, jsonb) TO service_role';
END $$;
