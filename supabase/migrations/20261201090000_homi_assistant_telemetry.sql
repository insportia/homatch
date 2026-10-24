-- HOMI assistant — per-turn route, model, tokens, cost and latency.
--
-- ai_routing_events already holds one row per assistant turn (routing
-- self-report, web calls, latency). HOMI adds what Admin needs to see cost and
-- speed honestly:
--   route               DETERMINISTIC (answered from HOMATCH's written
--                        knowledge, no model) | MODEL_LIGHT | MODEL_FULL
--   deterministic_intent which written answer was used
--   surface             ai-assistant, mortgage-consultant, …
--   model, tokens       what the provider reported (never estimated)
--   cost_cents          billing_ai_cost_cents() at the time; that function
--                        returns 0 for an unpriced model, so Admin re-derives
--                        UNPRICED from the rate book and never trusts 0 alone
--   ttft_ms             time to the first streamed word
--   billed              whether this turn reserved credits (HOMI chat: never)
--   error_code          why a turn produced no answer
--
-- Additive and backward-compatible: every new column is nullable or
-- defaulted, the old writer keeps working, rows written before this migration
-- have route NULL and are reported as "not measured", never as zero cost.

alter table public.ai_routing_events
  add column if not exists route text check (route is null or route in ('DETERMINISTIC', 'MODEL_LIGHT', 'MODEL_FULL')),
  add column if not exists deterministic_intent text,
  add column if not exists surface text,
  add column if not exists model text,
  add column if not exists input_tokens integer,
  add column if not exists cached_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists cost_cents numeric(12, 4),
  add column if not exists ttft_ms integer,
  add column if not exists billed boolean,
  add column if not exists error_code text;

create index if not exists idx_ai_routing_events_route_created
  on public.ai_routing_events (route, created_at desc);

/*
 * Admin → HOMI Assistant / AI usage & costs.
 *
 * One call, one JSON document. Costs come only from priced rows: a model turn
 * whose model has no INPUT/OUTPUT rate at the turn's time is counted as
 * UNPRICED and excluded from money totals, never added as 0. The monthly
 * figure is labelled an estimate: the last 7 complete-or-partial days'
 * priced cost scaled to 30 days, and null when there is no data.
 */
create or replace function public.homi_usage_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with t as (
    select e.*,
           (e.route is not null) as measured,
           (e.route like 'MODEL_%') as is_model,
           case
             when e.route like 'MODEL_%' and e.error_code is null and e.model is not null
              and coalesce(e.input_tokens, 0) + coalesce(e.output_tokens, 0) > 0
              and (public.price_per_unit_at('OPENAI', e.model, 'INPUT_TOKEN', e.created_at) is null
                   or public.price_per_unit_at('OPENAI', e.model, 'OUTPUT_TOKEN', e.created_at) is null)
             then true else false
           end as unpriced
      from public.ai_routing_events e
     where e.created_at >= v_from
  ),
  daily as (
    select date_trunc('day', created_at)::date as day,
           count(*) filter (where measured) as requests,
           count(*) filter (where route = 'DETERMINISTIC') as deterministic,
           count(*) filter (where route = 'MODEL_LIGHT') as model_light,
           count(*) filter (where route = 'MODEL_FULL') as model_full,
           count(*) filter (where error_code is not null) as failures,
           coalesce(sum(input_tokens), 0) as input_tokens,
           coalesce(sum(cached_tokens), 0) as cached_tokens,
           coalesce(sum(output_tokens), 0) as output_tokens,
           round(coalesce(sum(cost_cents) filter (where is_model and not unpriced), 0) / 100.0, 4) as cost_usd,
           count(*) filter (where unpriced) as unpriced_turns,
           count(*) filter (where web_calls > 0) as web_turns,
           coalesce(sum(web_calls), 0) as web_calls,
           count(*) filter (where not measured) as legacy_turns
      from t group by 1
  ),
  lat as (
    select route,
           round(avg(latency_ms)) as avg_ms,
           percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
           round(avg(ttft_ms)) as avg_ttft_ms,
           percentile_cont(0.95) within group (order by ttft_ms) as p95_ttft_ms
      from t where measured and error_code is null and latency_ms is not null group by route
  ),
  by_model as (
    select model, count(*) as turns,
           coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(cached_tokens), 0) as cached_tokens,
           coalesce(sum(output_tokens), 0) as output_tokens,
           round(coalesce(sum(cost_cents) filter (where not unpriced), 0) / 100.0, 4) as cost_usd,
           count(*) filter (where unpriced) as unpriced_turns
      from t where is_model and model is not null group by model
  ),
  by_surface as (
    select coalesce(surface, 'unknown') as surface, count(*) as turns,
           count(*) filter (where route = 'DETERMINISTIC') as deterministic,
           round(coalesce(sum(cost_cents) filter (where is_model and not unpriced), 0) / 100.0, 4) as cost_usd,
           count(*) filter (where error_code is not null) as failures
      from t where measured group by 1
  ),
  errs as (
    select error_code, count(*) as n from t where error_code is not null group by 1
  ),
  last7 as (
    select round(coalesce(sum(cost_cents) filter (where is_model and not unpriced), 0) / 100.0, 4) as cost_usd,
           count(distinct date_trunc('day', created_at)) as days
      from t where measured and created_at >= now() - interval '7 days'
  ),
  totals as (
    select count(*) filter (where measured) as requests,
           count(*) filter (where route = 'DETERMINISTIC') as deterministic,
           count(*) filter (where is_model) as model_turns,
           count(*) filter (where error_code is not null) as failures,
           count(*) filter (where web_calls > 0) as web_turns,
           coalesce(sum(web_calls), 0) as web_calls,
           coalesce(sum(input_tokens), 0) as input_tokens,
           coalesce(sum(cached_tokens), 0) as cached_tokens,
           coalesce(sum(output_tokens), 0) as output_tokens,
           round(coalesce(sum(cost_cents) filter (where is_model and not unpriced), 0) / 100.0, 4) as cost_usd,
           count(*) filter (where unpriced) as unpriced_turns,
           count(*) filter (where billed) as billed_turns,
           count(*) filter (where not measured) as legacy_turns,
           round(avg(latency_ms) filter (where measured and error_code is null)) as avg_latency_ms,
           percentile_cont(0.95) within group (order by latency_ms) filter (where measured and error_code is null) as p95_latency_ms
      from t
  )
  select jsonb_build_object(
    'from', v_from,
    'to', now(),
    'totals', (select to_jsonb(totals) || jsonb_build_object(
        'deterministic_rate', case when requests > 0 then round(deterministic::numeric / requests, 4) end,
        'failure_rate', case when requests > 0 then round(failures::numeric / requests, 4) end,
        'prompt_cache_rate', case when input_tokens > 0 then round(cached_tokens::numeric / input_tokens, 4) end
      ) from totals),
    'estimated_monthly_usd', (select case when days > 0 then round(cost_usd / least(days, 7) * 30, 2) end from last7),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb),
    'latency', coalesce((select jsonb_agg(to_jsonb(lat)) from lat), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(to_jsonb(by_model) order by turns desc) from by_model), '[]'::jsonb),
    'by_surface', coalesce((select jsonb_agg(to_jsonb(by_surface) order by turns desc) from by_surface), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(to_jsonb(errs) order by n desc) from errs), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.homi_usage_summary(integer) from public, anon;
grant execute on function public.homi_usage_summary(integer) to authenticated;

comment on function public.homi_usage_summary(integer) is
  'Admin only. HOMI assistant usage, tokens, priced cost by model and surface, latency (avg/p95, time to first word), deterministic (no-model) answer rate, web usage, failures. Unpriced model turns are counted, never costed as 0.';
