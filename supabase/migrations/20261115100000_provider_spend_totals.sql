-- SPEND CAPS — month-to-date provider spend summed in the database (capacity audit 2026-10-18, P2 #13).
--
-- checkSpendCap (supabase/functions/_shared/spend_cap.ts — outreach-send, Email Studio) summed
-- cost_events by selecting every row of the month through PostgREST. PostgREST returns at most
-- its configured max rows per request, so once a month held more rows than that, the sum — and
-- the spend_cap_* decision built on it — silently under-counted. Production today has ~600 rows a
-- month, so today's decisions are unaffected; the numbers would diverge with growth.
--
-- provider_spend_totals_since(p_since) returns the same grouping the TypeScript did
-- (lower(provider) → sum(cost_usd), NULL cost counted as 0) in one aggregate. The thresholds
-- (admin_settings.spend_cap_*) and the decision rule are unchanged.
--
-- Additive only. Rollback: drop function if exists public.provider_spend_totals_since(timestamptz);

create or replace function public.provider_spend_totals_since(p_since timestamptz)
returns table (provider text, cost_usd numeric)
language sql
stable
security invoker
set search_path to ''
as $function$
  select lower(c.provider::text) as provider, coalesce(sum(coalesce(c.cost_usd, 0)), 0) as cost_usd
    from public.cost_events c
   where c."timestamp" >= p_since
   group by lower(c.provider::text);
$function$;

comment on function public.provider_spend_totals_since(timestamptz) is
  'Month-to-date provider spend for checkSpendCap (spend_cap_* settings); service role only.';

revoke all on function public.provider_spend_totals_since(timestamptz) from public, anon, authenticated;
grant execute on function public.provider_spend_totals_since(timestamptz) to service_role;
