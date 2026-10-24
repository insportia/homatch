-- HOMI workstream · notification events and admin insight functions.
--
-- 1 · Two notification types that were missing: a failed PAYG top-up (no
--     Credits added, balance unchanged; billing is PAYG, there is no plan
--     to renew) and a service the person started that could not complete.
--     Added only; nothing below references them in this file (Postgres
--     requires that).
--     Email for these is claimed before it is sent: the notification_deliveries
--     row is inserted QUEUED (unique on notification_id, channel), then moved
--     to SENT or FAILED, so a concurrent or retried run never sends twice.
--
-- 2 · Admin-only, read-only summaries built from what is already recorded:
--     · contract unit costs from usage_events (the analysis call's measured
--       AI cost, the credits charged, how many were funded by an included
--       usage allowance), with the gross margin a 20 or 50 cent price WOULD give.
--       Prices are not changed here or anywhere in this release;
--     · notification delivery outcomes from notification_deliveries.
--     Each returns counts and averages only, never a person or a document.

alter type notification_type add value if not exists 'PAYMENT_FAILED';
alter type notification_type add value if not exists 'SERVICE_FAILED';

create or replace function public.admin_contract_unit_costs(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with runs as (
    select (e.ai_cost_cents + e.raw_provider_cost_cents + e.fee_cents)::numeric as cost_cents,
           e.charged_credits, e.allowance_funded, e.billable, e.input_tokens, e.output_tokens, e.duration_ms
      from public.usage_events e
     where e.product_code = 'CONTRACT_INTELLIGENCE' and e.created_at >= v_since
  ), docs as (
    select d.size_bytes from public.deal_room_documents d where d.created_at >= v_since and d.analysis_state = 'DONE'
  )
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'analyses', (select count(*) from runs),
    'billable', (select count(*) from runs where billable),
    'allowanceFunded', (select count(*) from runs where allowance_funded),
    'avgCostCents', (select round(avg(cost_cents), 3) from runs),
    'p50CostCents', (select round((percentile_cont(0.5) within group (order by cost_cents))::numeric, 3) from runs),
    'p95CostCents', (select round((percentile_cont(0.95) within group (order by cost_cents))::numeric, 3) from runs),
    'maxCostCents', (select round(max(cost_cents), 3) from runs),
    'avgInputTokens', (select round(avg(input_tokens)) from runs),
    'avgOutputTokens', (select round(avg(output_tokens)) from runs),
    'avgDurationMs', (select round(avg(duration_ms)) from runs),
    'avgChargedCredits', (select round(avg(charged_credits), 3) from runs where billable and not allowance_funded),
    'avgDocumentBytes', (select round(avg(size_bytes)) from docs),
    -- Pricing analysis only: the margin each candidate price would leave at the measured average cost.
    'marginAt20Cents', (select case when avg(cost_cents) is null then null else round((20 - avg(cost_cents)) / 20 * 100, 1) end from runs),
    'marginAt50Cents', (select case when avg(cost_cents) is null then null else round((50 - avg(cost_cents)) / 50 * 100, 1) end from runs),
    'notes', jsonb_build_array(
      'Cost is the measured AI cost of the analysis call plus any recorded provider and fee cost.',
      'Text extraction runs inside the function and has no separate provider charge; scanned documents are not OCR-processed.',
      'Exports are built in the browser and cost nothing to serve.',
      'Storage cost is not included: it is billed per GB-month for the whole bucket, not per document.')
  ) into v;
  return v;
end $$;
revoke all on function public.admin_contract_unit_costs(integer) from public, anon;
grant execute on function public.admin_contract_unit_costs(integer) to authenticated;

create or replace function public.admin_notification_delivery_stats(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'byChannel', coalesce((
      select jsonb_object_agg(channel, counts) from (
        select channel, jsonb_object_agg(status, n) as counts
          from (select channel, status, count(*) as n from public.notification_deliveries
                 where created_at >= v_since group by channel, status) x
         group by channel) y), '{}'::jsonb),
    'bySource', coalesce((
      select jsonb_object_agg(source, n) from (
        select source, count(*) as n from public.notification_deliveries where created_at >= v_since group by source) z), '{}'::jsonb),
    'topFailureReasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc) from (
        select left(coalesce(reason, 'UNKNOWN'), 120) as reason, count(*) as n
          from public.notification_deliveries
         where created_at >= v_since and status in ('FAILED', 'SKIPPED')
         group by 1 order by 2 desc limit 8) r), '[]'::jsonb),
    'inApp', (select count(*) from public.notifications where created_at >= v_since),
    'pushed', (select count(*) from public.notifications where created_at >= v_since and pushed_at is not null));
end $$;
revoke all on function public.admin_notification_delivery_stats(integer) from public, anon;
grant execute on function public.admin_notification_delivery_stats(integer) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- ADMIN AUDIT (PR #325) · contract unit costs: unknown cost is not zero.
--
-- The contract analyzer records ai_cost_cents from billing_ai_cost_cents(),
-- which returns 0 for a model with no rate in provider_price_book. Averaged
-- as-is, an unpriced run reads as free and the 20/50-cent margins come out
-- too high. This replaces admin_contract_unit_costs (defined above) so that
-- a run that used the model (tokens > 0) whose model had no INPUT or OUTPUT
-- rate at the run's time (the same test homi_usage_summary uses) is counted
-- as UNPRICED and excluded from every cost figure; when no run is priced,
-- the costs and margins are NULL ("unknown" on the Admin screen), never 0.
-- Same signature, same grants; only additive keys ('unpricedRuns', 'pricedRuns').
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.admin_contract_unit_costs(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with all_runs as (
    select (e.ai_cost_cents + e.raw_provider_cost_cents + e.fee_cents)::numeric as cost_cents,
           e.charged_credits, e.allowance_funded, e.billable, e.input_tokens, e.output_tokens, e.duration_ms,
           (e.model is not null
            and coalesce(e.input_tokens, 0) + coalesce(e.output_tokens, 0) > 0
            and (public.price_per_unit_at('OPENAI', e.model, 'INPUT_TOKEN', e.created_at) is null
                 or public.price_per_unit_at('OPENAI', e.model, 'OUTPUT_TOKEN', e.created_at) is null)) as unpriced
      from public.usage_events e
     where e.product_code = 'CONTRACT_INTELLIGENCE' and e.created_at >= v_since
  ), runs as (
    select * from all_runs where not unpriced
  ), docs as (
    select d.size_bytes from public.deal_room_documents d where d.created_at >= v_since and d.analysis_state = 'DONE'
  )
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'analyses', (select count(*) from all_runs),
    'billable', (select count(*) from all_runs where billable),
    'allowanceFunded', (select count(*) from all_runs where allowance_funded),
    'pricedRuns', (select count(*) from runs),
    'unpricedRuns', (select count(*) from all_runs where unpriced),
    'avgCostCents', (select round(avg(cost_cents), 3) from runs),
    'p50CostCents', (select round((percentile_cont(0.5) within group (order by cost_cents))::numeric, 3) from runs),
    'p95CostCents', (select round((percentile_cont(0.95) within group (order by cost_cents))::numeric, 3) from runs),
    'maxCostCents', (select round(max(cost_cents), 3) from runs),
    'avgInputTokens', (select round(avg(input_tokens)) from all_runs),
    'avgOutputTokens', (select round(avg(output_tokens)) from all_runs),
    'avgDurationMs', (select round(avg(duration_ms)) from all_runs),
    'avgChargedCredits', (select round(avg(charged_credits), 3) from all_runs where billable and not allowance_funded),
    'avgDocumentBytes', (select round(avg(size_bytes)) from docs),
    -- Pricing analysis only, over PRICED runs: NULL (unknown) when none was priced.
    'marginAt20Cents', (select case when avg(cost_cents) is null then null else round((20 - avg(cost_cents)) / 20 * 100, 1) end from runs),
    'marginAt50Cents', (select case when avg(cost_cents) is null then null else round((50 - avg(cost_cents)) / 50 * 100, 1) end from runs),
    'notes', jsonb_build_array(
      'Cost is the measured AI cost of the analysis call plus any recorded provider and fee cost.',
      'A run whose model had no price in the price book is counted as unpriced and left out of cost and margin, never costed as zero.',
      'Text extraction runs inside the function and has no separate provider charge; scanned documents are not OCR-processed.',
      'Exports are built in the browser and cost nothing to serve.',
      'Storage cost is not included: it is billed per GB-month for the whole bucket, not per document.')
  ) into v;
  return v;
end $$;
revoke all on function public.admin_contract_unit_costs(integer) from public, anon;
grant execute on function public.admin_contract_unit_costs(integer) to authenticated;
