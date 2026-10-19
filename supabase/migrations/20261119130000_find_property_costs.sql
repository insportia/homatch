-- HOMATCH Find Property — real operating cost (owner, 2026-10-19). Find Property stays free;
-- this is HOMATCH's own cost, admin only, in the existing ledger (cost_events → finance_cost_facts).
--
-- WHAT WAS WRONG (production, search 383ec400…, gpt-4o-mini 1,991 in / 430 out tokens):
--   * provider_price_book had no gpt-4o-mini rows, and estimatedProviderCost() turned the RPC's
--     NULL ("no price") into 0 (Number(null) === 0): every Find Property model call was booked
--     cost_usd 0 with pricing_state ESTIMATED, and finance_cost_facts showed it as unpriced.
--     (Fixed in providerCost.ts: NULL is UNPRICED, never $0.)
--   * MARKETPLACE_* operations had no finance_operation_map row, so they fell to the OPENAI
--     default product and were reported as VERIFY.
--   * cost_events carried no search id, model or input/output split.
--
-- WHAT THIS DOES
--   1. gpt-4o-mini in the price book (OpenAI standard tier, per 1M tokens: input 0.15, cached
--      input 0.075, output 0.60).
--   2. MARKETPLACE_% → FIND_PROPERTY.
--   3. cost_events: correlation_id (a search id, or 'brief:<uuid>' for the brief-understanding
--      call that precedes a search), model, input/output tokens. discovery_marketplace_searches
--      .brief_cost_refs links a search to the brief calls the customer made before starting it.
--   4. Historical correction, only where a reliable record exists:
--        RESULTS_INTELLIGENCE (22 rows): each row matches exactly one search's telemetry
--        (same token total, ≤ 0.1 s apart) → search id, model, tokens, priced ESTIMATED.
--        SEARCH_INTELLIGENCE (29 rows): only the token TOTAL was recorded and no search link →
--        PARTIAL: cost_usd is the lower bound (all tokens at the input rate); the admin view
--        shows the range up to the output rate. Never attributed to a search.
--   5. finance_find_property_costs / finance_find_property_search_cost: admin-only reads
--      (finance_require_admin) for /admin/finance/find-property.
--
-- The five marketplace workers call no paid provider (direct public HTTP from the Railway
-- worker; no proxy, CAPTCHA or scraping API). Their direct charge is reported as $0 with the
-- reason, and the shared infrastructure they run on (Railway, Supabase, Vercel) is reported
-- separately: allocated only when finance_fixed_expenses holds the amounts AND
-- admin_settings.find_property_infra_share says what share of them Find Property uses.

insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from, source, notes)
select 'OPENAI', 'gpt-4o-mini', v.unit, v.rate, 1000000, 'USD', '2024-07-18',
       'openai.com/api/pricing — gpt-4o-mini, standard tier (retrieved 2026-10-19)',
       'Find Property: search brief + results intelligence (marketplaceSearch.ts searchModel)'
  from (values ('INPUT_TOKEN', 0.15::numeric), ('CACHED_INPUT_TOKEN', 0.075::numeric), ('OUTPUT_TOKEN', 0.60::numeric)) v(unit, rate)
 where not exists (select 1 from public.provider_price_book pb
                    where pb.provider = 'OPENAI' and pb.model = 'gpt-4o-mini' and pb.unit = v.unit);

insert into public.finance_operation_map (match_pattern, product_code, priority)
select 'MARKETPLACE_%', 'FIND_PROPERTY', 15
 where not exists (select 1 from public.finance_operation_map where match_pattern = 'MARKETPLACE_%');

alter table public.cost_events
  add column if not exists correlation_id text,
  add column if not exists model text,
  add column if not exists input_tokens bigint,
  add column if not exists output_tokens bigint,
  add column if not exists cached_input_tokens bigint;
comment on column public.cost_events.correlation_id is 'What this cost belongs to: a discovery_marketplace_searches.id, or brief:<uuid> for a Find Property brief call (linked through brief_cost_refs).';
create index if not exists cost_events_correlation_idx on public.cost_events (correlation_id) where correlation_id is not null;

alter table public.discovery_marketplace_searches
  add column if not exists brief_cost_refs text[] not null default '{}';
comment on column public.discovery_marketplace_searches.brief_cost_refs is 'brief:<uuid> correlation ids of the brief-understanding calls that preceded this search (cost accounting only).';

-- 4a. Results intelligence: exact one-to-one match with the search's own telemetry.
with t as (
  select s.id as search_id, (a->>'at')::timestamptz as at, (a->>'inputTokens')::bigint as i,
         (a->>'outputTokens')::bigint as o, a->>'model' as m
    from public.discovery_marketplace_searches s, jsonb_array_elements(coalesce(s.telemetry->'ai', '[]'::jsonb)) a
   where a->>'call' = 'RESULTS_INTELLIGENCE' and a->>'at' is not null
), cands as (
  select c.id, t.search_id, t.i, t.o, t.m, c."timestamp" as ts,
         count(*) over (partition by c.id) as n_for_row,
         count(*) over (partition by t.search_id, t.at) as n_for_call
    from public.cost_events c
    join t on abs(extract(epoch from (t.at - c."timestamp"))) < 2 and c.units = t.i + t.o
   where c.operation_type = 'MARKETPLACE_RESULTS_INTELLIGENCE' and c.correlation_id is null
)
update public.cost_events ce
   set correlation_id = x.search_id::text, model = x.m, input_tokens = x.i, output_tokens = x.o,
       cost_usd = round(coalesce(public.provider_estimated_cost_usd('OPENAI', 'INPUT_TOKEN', x.i, x.m, x.ts), 0)
                      + coalesce(public.provider_estimated_cost_usd('OPENAI', 'OUTPUT_TOKEN', x.o, x.m, x.ts), 0), 6),
       pricing_state = case when public.provider_estimated_cost_usd('OPENAI', 'INPUT_TOKEN', x.i, x.m, x.ts) is not null
                             and public.provider_estimated_cost_usd('OPENAI', 'OUTPUT_TOKEN', x.o, x.m, x.ts) is not null
                            then 'ESTIMATED' else 'UNPRICED' end
  from cands x
 where ce.id = x.id and x.n_for_row = 1 and x.n_for_call = 1;

-- 4b. Brief understanding before the correlation existed: total tokens only, no search link.
update public.cost_events ce
   set model = 'gpt-4o-mini', correlation_id = 'brief:unlinked',
       cost_usd = round(ce.units * 0.15 / 1000000, 6), pricing_state = 'PARTIAL'
 where ce.operation_type = 'MARKETPLACE_SEARCH_INTELLIGENCE' and ce.correlation_id is null and ce.input_tokens is null
   and ce."timestamp" < '2026-10-20';

-- Rate for a model/unit at a time, from the price book (null when the book has none).
create or replace function public.finance_fp_rate(p_model text, p_unit text, p_at timestamptz)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select pb.rate / nullif(pb.per_units, 0) from public.provider_price_book pb
   where pb.provider = 'OPENAI' and pb.unit = p_unit and (pb.model = p_model or pb.model is null)
     and pb.effective_from <= p_at and (pb.effective_to is null or pb.effective_to > p_at)
   order by pb.model nulls last, pb.effective_from desc limit 1
$$;

/* One row per Find Property AI cost event, with the search it belongs to (each event once). */
create or replace view public.finance_fp_ai_events with (security_invoker = true) as
with links as (
  select distinct on (ref) ref, s.id as search_id
    from public.discovery_marketplace_searches s, unnest(s.brief_cost_refs) ref
   order by ref, s.created_at
)
select ce.id, ce."timestamp" as occurred_at, ce.operation_type, ce.model, ce.units, ce.input_tokens, ce.output_tokens,
       ce.cost_usd, ce.pricing_state, ce.success, ce.correlation_id,
       case when ce.correlation_id ~ '^[0-9a-f-]{36}$' then ce.correlation_id::uuid else l.search_id end as search_id,
       /* PARTIAL rows: the range a total-only record allows (all input .. all output). */
       case when ce.pricing_state = 'PARTIAL' then round(ce.units * coalesce(public.finance_fp_rate(coalesce(ce.model, 'gpt-4o-mini'), 'OUTPUT_TOKEN', ce."timestamp"), 0), 6) end as cost_upper_usd
  from public.cost_events ce
  left join links l on l.ref = ce.correlation_id
 where ce.operation_type like 'MARKETPLACE\_%';
revoke all on public.finance_fp_ai_events from anon, authenticated;

create or replace function public.finance_find_property_costs(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_share numeric;
  v_infra_monthly numeric;
  v_infra_entered boolean;
  v_month_searches int;
begin
  perform public.finance_require_admin();
  select case when (value #>> '{}') ~ '^\s*(0(\.[0-9]+)?|1(\.0+)?)\s*$' then (value #>> '{}')::numeric end into v_share
    from public.admin_settings where key = 'find_property_infra_share';
  select coalesce(sum(public.finance_monthly_equivalent_cents(amount_cents, billing_frequency)), 0) / 100,
         coalesce(bool_and(amount_cents > 0), false)
    into v_infra_monthly, v_infra_entered
    from public.finance_fixed_expenses
   where active and superseded_by is null and category = 'INFRASTRUCTURE' and (ends_at is null or ends_at >= current_date);
  select count(*) into v_month_searches from public.discovery_marketplace_searches where created_at >= date_trunc('month', now());

  return (
  with s as (
    select ds.id, ds.created_at, ds.status, ds.properties_count, ds.ai_status from public.discovery_marketplace_searches ds
  ), ai as (
    select e.search_id, sum(e.cost_usd) as usd, sum(coalesce(e.cost_upper_usd, e.cost_usd)) as usd_upper,
           bool_or(e.pricing_state in ('PARTIAL', 'UNPRICED')) as incomplete, count(*) as calls,
           count(*) filter (where e.operation_type = 'MARKETPLACE_RESULTS_INTELLIGENCE') as results_calls
      from public.finance_fp_ai_events e where e.search_id is not null group by e.search_id
  ), runs as (
    select r.search_id, count(*) as runs, array_agg(distinct r.worker_id order by r.worker_id) as workers,
           count(*) filter (where r.status in ('FAILED', 'TIMED_OUT', 'BLOCKED')) as failed,
           sum(greatest(coalesce(r.attempts, 1), 1) - 1) as retries,
           count(*) filter (where r.shared_run_id is not null) as shared,
           count(*) filter (where r.query_applied->>'index' = 'WARM') as warm_index,
           sum(coalesce((r.metrics->>'pagesVisited')::numeric, 0)) as pages,
           count(*) filter (where coalesce(r.returned_count, 0) = 0 and r.status in ('COMPLETE', 'PARTIAL')) as empty_runs
      from public.discovery_marketplace_worker_runs r group by r.search_id
  ), pool as (
    select l.search_id, count(*) as cached from public.discovery_marketplace_listings l
     where l.raw->'retrievalMetadata'->>'observationLevel' = 'CACHED' group by l.search_id
  ), row_ as (
    select s.*, coalesce(ai.usd, 0) as ai_usd, coalesce(ai.usd_upper, ai.usd, 0) as ai_usd_upper, coalesce(ai.calls, 0) as ai_calls,
           coalesce(ai.results_calls, 0) as results_calls,
           runs.runs, runs.workers, runs.failed, runs.retries, runs.shared, runs.warm_index, runs.pages, runs.empty_runs,
           coalesce(pool.cached, 0) as cached,
           case when ai.incomplete then 'PARTIAL'
                when s.ai_status = 'DONE' and coalesce(ai.results_calls, 0) = 0 then 'UNKNOWN'
                else 'ESTIMATED' end as completeness
      from s left join ai on ai.search_id = s.id left join runs on runs.search_id = s.id left join pool on pool.search_id = s.id
  ), unlinked as (
    select e.* from public.finance_fp_ai_events e where e.search_id is null
  ), all_cost as (
    select e.occurred_at, e.cost_usd, coalesce(e.cost_upper_usd, e.cost_usd) as upper_usd from public.finance_fp_ai_events e
  )
  select jsonb_build_object(
    'generated_at', now(),
    'currency', 'USD',
    'summary', jsonb_build_object(
      'today_usd', (select round(coalesce(sum(cost_usd), 0), 6) from all_cost where occurred_at >= v_today),
      'yesterday_usd', (select round(coalesce(sum(cost_usd), 0), 6) from all_cost where occurred_at >= v_today - 1 and occurred_at < v_today),
      'last7_usd', (select round(coalesce(sum(cost_usd), 0), 6) from all_cost where occurred_at >= v_today - 6),
      'month_usd', (select round(coalesce(sum(cost_usd), 0), 6) from all_cost where occurred_at >= date_trunc('month', now())),
      'month_upper_usd', (select round(coalesce(sum(upper_usd), 0), 6) from all_cost where occurred_at >= date_trunc('month', now())),
      'searches', (select count(*) from row_),
      'searches_in_range', (select count(*) from row_ where created_at between p_from and p_to),
      'properties', (select coalesce(sum(properties_count), 0) from row_),
      'avg_per_search_usd', (select round(avg(ai_usd), 8) from row_),
      'avg_per_property_usd', (select round(sum(ai_usd) / nullif(sum(properties_count), 0), 8) from row_),
      'most_expensive', (select jsonb_build_object('id', id, 'created_at', created_at, 'usd', ai_usd) from row_ order by ai_usd desc, created_at desc limit 1),
      'run_rate_month_usd', (select round(coalesce(sum(cost_usd), 0) / greatest(extract(day from now()), 1) * extract(day from (date_trunc('month', now()) + interval '1 month - 1 day')), 6)
                              from all_cost where occurred_at >= date_trunc('month', now())),
      'unlinked_brief_usd', (select round(coalesce(sum(cost_usd), 0), 6) from unlinked),
      'unlinked_brief_upper_usd', (select round(coalesce(sum(coalesce(cost_upper_usd, cost_usd)), 0), 6) from unlinked),
      'unlinked_brief_calls', (select count(*) from unlinked),
      'incomplete_searches', (select count(*) from row_ where completeness <> 'ESTIMATED')
    ),
    'infrastructure', jsonb_build_object(
      'monthly_fixed_usd', round(v_infra_monthly, 4),
      'amounts_entered', v_infra_entered,
      'share', v_share,
      'allocated_per_search_usd', case when v_share is not null and v_infra_entered and v_month_searches > 0
                                       then round(v_infra_monthly * v_share / v_month_searches, 6) end,
      'status', case when v_share is null or not v_infra_entered then 'UNKNOWN' else 'ESTIMATED' end
    ),
    'daily', (select coalesce(jsonb_agg(d order by d->>'day'), '[]'::jsonb) from (
      select jsonb_build_object('day', g::date,
        'searches', (select count(*) from row_ where created_at::date = g::date),
        'properties', (select coalesce(sum(properties_count), 0) from row_ where created_at::date = g::date),
        'ai_usd', (select round(coalesce(sum(cost_usd), 0), 6) from all_cost where occurred_at::date = g::date),
        'ai_upper_usd', (select round(coalesce(sum(upper_usd), 0), 6) from all_cost where occurred_at::date = g::date),
        'provider_usd', 0) as d
        from generate_series(p_from::date, p_to::date, interval '1 day') g) days),
    'providers', (select coalesce(jsonb_agg(p order by (p->>'runs')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('worker', r.worker_id, 'runs', count(*), 'pages', sum(coalesce((r.metrics->>'pagesVisited')::numeric, 0)),
        'listings', sum(coalesce(r.returned_count, 0)), 'failed', count(*) filter (where r.status in ('FAILED', 'TIMED_OUT', 'BLOCKED')),
        'empty', count(*) filter (where coalesce(r.returned_count, 0) = 0 and r.status in ('COMPLETE', 'PARTIAL')),
        'warm_index', count(*) filter (where r.query_applied->>'index' = 'WARM'), 'shared', count(*) filter (where r.shared_run_id is not null),
        'direct_usd', 0, 'billing', 'NO_PAID_PROVIDER') as p
        from public.discovery_marketplace_worker_runs r
        join public.discovery_marketplace_searches ds on ds.id = r.search_id and ds.created_at between p_from and p_to
       group by r.worker_id) x),
    'cache', (select jsonb_build_object('runs', coalesce(sum(runs), 0), 'shared_runs', coalesce(sum(shared), 0),
        'warm_index_runs', coalesce(sum(warm_index), 0), 'pool_listings', coalesce(sum(cached), 0),
        'hit_rate', round((coalesce(sum(shared), 0) + coalesce(sum(warm_index), 0))::numeric / nullif(sum(runs), 0), 4))
        from row_ where created_at between p_from and p_to),
    'optimisation', jsonb_build_object(
      'repeated_ai_searches', (select count(*) from row_ where results_calls > 1),
      'retries', (select coalesce(sum(retries), 0) from row_ where created_at between p_from and p_to),
      'failed_runs', (select coalesce(sum(failed), 0) from row_ where created_at between p_from and p_to),
      'empty_runs', (select coalesce(sum(empty_runs), 0) from row_ where created_at between p_from and p_to)
    ),
    'searches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'created_at', created_at, 'status', status, 'properties', properties_count,
        'workers', coalesce(to_jsonb(workers), '[]'::jsonb), 'runs', coalesce(runs, 0), 'ai_usd', round(ai_usd, 6), 'ai_upper_usd', round(ai_usd_upper, 6),
        'ai_calls', ai_calls, 'provider_usd', 0, 'other_usd', null, 'total_usd', round(ai_usd, 6),
        'completeness', completeness) order by created_at desc), '[]'::jsonb)
        from row_ where created_at between p_from and p_to)
  ));
end $$;

create or replace function public.finance_find_property_search_cost(p_search_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.finance_require_admin();
  return (
    select jsonb_build_object(
      'search', jsonb_build_object('id', s.id, 'created_at', s.created_at, 'status', s.status, 'properties', s.properties_count,
        'ai_status', s.ai_status, 'brief_cost_refs', to_jsonb(s.brief_cost_refs)),
      'ai', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', e.id, 'at', e.occurred_at, 'operation', e.operation_type, 'model', e.model,
          'input_tokens', e.input_tokens, 'output_tokens', e.output_tokens, 'units', e.units,
          'input_rate_per_1m', round(public.finance_fp_rate(e.model, 'INPUT_TOKEN', e.occurred_at) * 1000000, 6),
          'output_rate_per_1m', round(public.finance_fp_rate(e.model, 'OUTPUT_TOKEN', e.occurred_at) * 1000000, 6),
          'usd', e.cost_usd, 'upper_usd', e.cost_upper_usd, 'state', e.pricing_state, 'success', e.success) order by e.occurred_at), '[]'::jsonb)
          from public.finance_fp_ai_events e where e.search_id = s.id),
      'workers', (select coalesce(jsonb_agg(jsonb_build_object(
          'worker', r.worker_id, 'status', r.status, 'attempts', r.attempts, 'returned', r.returned_count, 'discovered', r.discovered_count,
          'pages', r.metrics->'pagesVisited', 'actions', r.metrics->'actions', 'bytes', r.metrics->'bytesTransferred', 'duration_ms', r.metrics->'durationMs',
          'index', r.query_applied->>'index', 'shared_run_id', r.shared_run_id,
          'cached_listings', (select count(*) from public.discovery_marketplace_listings l where l.worker_run_id = r.id
                                and l.raw->'retrievalMetadata'->>'observationLevel' = 'CACHED'),
          'direct_usd', 0, 'billing', 'NO_PAID_PROVIDER') order by r.worker_id), '[]'::jsonb)
          from public.discovery_marketplace_worker_runs r where r.search_id = s.id)
    )
    from public.discovery_marketplace_searches s where s.id = p_search_id
  );
end $$;

revoke all on function public.finance_find_property_costs(timestamptz, timestamptz) from public, anon;
revoke all on function public.finance_find_property_search_cost(uuid) from public, anon;
revoke all on function public.finance_fp_rate(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finance_find_property_costs(timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_find_property_search_cost(uuid) to authenticated;
