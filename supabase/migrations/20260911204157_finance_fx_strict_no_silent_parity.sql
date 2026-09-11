-- fx_to_usd used to fall back to a rate of 1 for any currency it did not know.
-- For USD that is right. For anything else it invents a number and shows it as
-- fact: a EUR provider bill would have appeared as the same figure in dollars,
-- with nothing on screen to say so. Every live payment and every live provider
-- cost today is USD, so this changes no existing total — it closes the hole
-- before the first non-USD channel arrives.

CREATE OR REPLACE FUNCTION public.fx_to_usd(
  p_amount numeric, p_currency text, p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE
    WHEN p_amount IS NULL THEN NULL
    -- USD is the reporting currency; the identity never needs a rate row.
    WHEN upper(COALESCE(p_currency,'USD')) = 'USD' THEN round(p_amount, 6)
    ELSE (SELECT round(p_amount * r.rate, 6)
            FROM public.fx_rates r
           WHERE r.base_currency = upper(p_currency)
             AND r.quote_currency = 'USD'
             AND r.effective_from <= p_at
             AND (r.effective_to IS NULL OR r.effective_to > p_at)
           ORDER BY r.effective_from DESC LIMIT 1)
    -- No rate: NULL, which every caller renders as UNPRICED rather than as a
    -- confident conversion.
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.fx_rate_known(p_currency text, p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT upper(COALESCE(p_currency,'USD')) = 'USD'
      OR EXISTS (SELECT 1 FROM public.fx_rates r
                  WHERE r.base_currency = upper(p_currency) AND r.quote_currency = 'USD'
                    AND r.effective_from <= p_at
                    AND (r.effective_to IS NULL OR r.effective_to > p_at));
$fn$;

-- Rates are effective-dated like every other price here: a new rate closes the
-- old one instead of overwriting it, so last month stays converted at last
-- month's rate.
CREATE OR REPLACE FUNCTION public.finance_set_fx_rate(
  p_currency text, p_rate numeric, p_effective_from timestamptz DEFAULT NULL,
  p_source text DEFAULT 'MANUAL'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz := COALESCE(p_effective_from, now()); v_cur text := upper(p_currency);
begin
  perform public.finance_require_admin();
  if v_cur = 'USD' then raise exception 'USD_IS_THE_REPORTING_CURRENCY'; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'RATE_MUST_BE_POSITIVE'; end if;

  update public.fx_rates set effective_to = v_from
   where base_currency = v_cur and quote_currency = 'USD'
     and effective_to is null and effective_from < v_from;

  insert into public.fx_rates (base_currency, quote_currency, rate, source, effective_from)
  values (v_cur, 'USD', p_rate, COALESCE(p_source,'MANUAL'), v_from);

  return jsonb_build_object('currency', v_cur, 'rate', p_rate, 'effective_from', v_from, 'ok', true);
end;
$fn$;

-- What cannot currently be converted, so it is a visible gap rather than a
-- quietly missing number.
CREATE OR REPLACE FUNCTION public.finance_fx_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  perform public.finance_require_admin();
  return jsonb_build_object(
    'reporting_currency', 'USD',
    'rates', COALESCE((select jsonb_agg(jsonb_build_object(
        'currency', base_currency, 'rate', rate, 'source', source,
        'effective_from', effective_from, 'effective_to', effective_to)
        order by base_currency, effective_from desc)
      from public.fx_rates where quote_currency='USD'), '[]'::jsonb),
    'missing', COALESCE((select jsonb_agg(distinct jsonb_build_object(
        'currency', cur, 'where', src))
      from (
        select source_currency as cur, 'provider_cost_events' as src
          from public.finance_provider_cost_events
         where not public.fx_rate_known(source_currency, occurred_at)
        union
        select source_currency, 'provider_invoices'
          from public.finance_provider_invoices
         where not public.fx_rate_known(source_currency, (period_end+1)::timestamptz)
        union
        select currency, 'payments' from public.payments
         where not public.fx_rate_known(currency, created_at)
        union
        select currency, 'provider_registry' from public.finance_provider_registry
         where active and not public.fx_rate_known(currency, now())
      ) q), '[]'::jsonb)
  );
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.fx_rate_known(text, timestamptz)',
    'public.finance_set_fx_rate(text, numeric, timestamptz, text)',
    'public.finance_fx_status()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
