-- Verify V3 (owner, 2026-10-29): a separate engine for the cost round. The
-- current engines are NOT changed: no V1/V2 setting, default or stored
-- report is touched here, and verify_developer_ads stays as it is (V2 keeps
-- its Developer Advertising stage). V3 is the V2 pipeline plus: Luna writes
-- the report (one cheap repair, Terra only when the gate still rejects it),
-- code-owned fields, capped searches, public research reused for 7 days, no
-- Developer Advertising, every paid report call priced.
--
-- 1. admin_settings.verify_v3_research: V3's OWN routing, stamped on each V3
--    job at creation (like verify_v2_research for V2). Seeded only when absent.
--      identity        luna, maxSearches 2, searchContextSize low
--      official        luna, maxSearches 0 (extraction over official evidence)
--      public_research luna, maxSearches 3 (default search context: the stage
--                      the report depends on most)
--      market          mode AUTO (code-first whenever the worker lane yields
--                      enough comparables), luna, maxSearches 2, context low
--      report          AUTO, reasoningEffort low, repair on, maxOutputTokens 28000
--      budget          ceilingUsd 0.15; escalation of an unusable stage on
--      reuse           freshnessDays 7
--    V3 reaches no job until admin_settings.verify_engine has v3Enabled:true
--    and V3 chosen (Admin → Providers → Verify engine); not done here.
--
-- 2. cost_events.attempt: one VERIFY_REPORT row per PAID CALL of a V3 report
--    (first attempt, repair, escalation, each rebuild). The once-per-stage
--    unique index becomes once per (job, operation, attempt); rows without an
--    attempt (all V1/V2 rows, every research stage, the first V3 report call)
--    keep exactly the old uniqueness. Created before the old one is dropped.
--
-- 3. verify_stage_cogs prices synthesis_json._reportAttempts (the per-call
--    ledger only V3 reports carry) when present; every other report is priced
--    exactly as before (_usage plus _usageFirstAttempt). Never both for one
--    job. The customer meter (verify_job_cost) is not touched.
--
-- 4. admin_verify_engine_stats(days): per engine version, jobs, completion
--    and failure counts, mean duration and mean COGS; plus the latest jobs by
--    engine. Admin only, read only.
--
-- Additive and backward compatible.

-- 1 ────────────────────────────────────────────────────────────────────────
insert into public.admin_settings (key, value, description)
values (
  'verify_v3_research',
  '{"identity":{"model":"gpt-5.6-luna","maxSearches":2,"searchContextSize":"low"},
    "official_collection":{"model":"gpt-5.6-luna","maxSearches":0},
    "public_research":{"model":"gpt-5.6-luna","maxSearches":3},
    "market":{"mode":"AUTO","model":"gpt-5.6-luna","maxSearches":2,"searchContextSize":"low"},
    "report":{"policy":"AUTO","reasoningEffort":"low","repair":true,"maxOutputTokens":28000},
    "budget":{"ceilingUsd":0.15},
    "escalation":{"enabled":true},
    "reuse":{"freshnessDays":7}}'::jsonb,
  'Verify V3 research and report routing, stamped on each V3 job at creation. V2 reads verify_v2_research and is unaffected.'
)
on conflict (key) do nothing;

-- 2 ────────────────────────────────────────────────────────────────────────
alter table public.cost_events add column if not exists attempt text;
comment on column public.cost_events.attempt is
  'Which paid call of a stage this row is (verify-synthesis: b<build>:<n>:<first|repair|escalation>). Null for a stage paid once.';

create unique index if not exists cost_events_verify_once_per_attempt
  on public.cost_events (job_id, operation_type, coalesce(attempt, ''))
  where job_id is not null and operation_type like 'VERIFY\_%';
drop index if exists public.cost_events_verify_once_per_stage;

-- 3 ────────────────────────────────────────────────────────────────────────
create or replace view public.verify_stage_cogs as
with stage as (
  select
    j.id                                            as job_id,
    j.query                                         as subject,
    j.completed_at,
    s.key                                           as stage,
    coalesce((s.value->>'input_tokens')::bigint, 0) as input_tokens,
    coalesce((s.value->'input_tokens_details'->>'cached_tokens')::bigint, 0) as cached_input_tokens,
    coalesce((s.value->>'output_tokens')::bigint, 0) as output_tokens,
    coalesce((s.value->'output_tokens_details'->>'reasoning_tokens')::bigint, 0) as reasoning_tokens,
    coalesce((j.result_json->'webSearchCalls'->>s.key)::int, 0) as web_searches,
    /* Every costUsage key is a research-agent stage — `synthesis` included —
     * on the research model, unless its response named another model. */
    case
      when m.recorded is null
        or m.recorded = 'gpt-5.6-terra'
        or m.recorded like 'gpt-5.6-terra-%' then 'gpt-5.6-terra'
      else m.recorded
    end                                             as model,
    j.completed_at                                  as priced_at
  from public.research_jobs j
  cross join lateral jsonb_each(coalesce(j.result_json->'costUsage', '{}'::jsonb)) as s(key, value)
  cross join lateral (
    select nullif(j.result_json->'costModels'->>regexp_replace(s.key, '_stopped$', ''), '') as recorded
  ) m
  where j.result_json ? 'costUsage'

  union all

  /* The report verify-synthesis wrote: its own call, on its own model
     (reports built before the per-call ledger). */
  select
    j.id,
    j.query,
    j.completed_at,
    'report'::text,
    coalesce((j.synthesis_json->'_usage'->>'inputTokens')::bigint, 0),
    least(coalesce((j.synthesis_json->'_usage'->>'cachedTokens')::bigint, 0),
          coalesce((j.synthesis_json->'_usage'->>'inputTokens')::bigint, 0)),
    coalesce((j.synthesis_json->'_usage'->>'outputTokens')::bigint, 0),
    0::bigint,
    0::int,
    coalesce(nullif(j.synthesis_json->'_usage'->>'model', ''), 'gpt-5.6-luna'),
    coalesce(j.synthesis_at, j.completed_at)
  from public.research_jobs j
  where jsonb_typeof(j.synthesis_json->'_usage') = 'object'
    and jsonb_typeof(j.synthesis_json->'_reportAttempts') is distinct from 'array'

  union all

  /* V2 report escalation before the ledger: the attempt that was not kept. */
  select
    j.id,
    j.query,
    j.completed_at,
    'report_first_attempt'::text,
    coalesce((j.synthesis_json->'_usageFirstAttempt'->>'inputTokens')::bigint, 0),
    least(coalesce((j.synthesis_json->'_usageFirstAttempt'->>'cachedTokens')::bigint, 0),
          coalesce((j.synthesis_json->'_usageFirstAttempt'->>'inputTokens')::bigint, 0)),
    coalesce((j.synthesis_json->'_usageFirstAttempt'->>'outputTokens')::bigint, 0),
    0::bigint,
    0::int,
    coalesce(nullif(j.synthesis_json->'_usageFirstAttempt'->>'model', ''), 'gpt-5.6-luna'),
    coalesce(j.synthesis_at, j.completed_at)
  from public.research_jobs j
  where jsonb_typeof(j.synthesis_json->'_usageFirstAttempt') = 'object'
    and jsonb_typeof(j.synthesis_json->'_reportAttempts') is distinct from 'array'

  union all

  /* THE PER-CALL LEDGER (2026-10-29): every paid report call of every build
     — first attempt, repair, escalation, rebuilds — once each, at its own
     model and its own time. Stage names are unique per job (ordinal). */
  select
    j.id,
    j.query,
    j.completed_at,
    'report_' || lpad(a.ord::text, 2, '0') || '_' || coalesce(nullif(a.call->>'kind', ''), 'call'),
    coalesce((a.call->>'inputTokens')::bigint, 0),
    least(coalesce((a.call->>'cachedTokens')::bigint, 0), coalesce((a.call->>'inputTokens')::bigint, 0)),
    coalesce((a.call->>'outputTokens')::bigint, 0),
    coalesce((a.call->>'reasoningTokens')::bigint, 0),
    0::int,
    coalesce(nullif(a.call->>'model', ''), 'gpt-5.6-luna'),
    coalesce(case when a.call->>'at' ~ '^\d{4}-\d{2}-\d{2}T' then (a.call->>'at')::timestamptz end, j.synthesis_at, j.completed_at)
  from public.research_jobs j
  cross join lateral jsonb_array_elements(j.synthesis_json->'_reportAttempts') with ordinality as a(call, ord)
  where jsonb_typeof(j.synthesis_json->'_reportAttempts') = 'array'
    and jsonb_typeof(a.call) = 'object'
)
select
  st.job_id,
  st.subject,
  st.completed_at,
  st.stage,
  st.model,
  st.input_tokens,
  st.cached_input_tokens,
  /* Fresh input is what is billed at the full rate. */
  greatest(st.input_tokens - st.cached_input_tokens, 0) as fresh_input_tokens,
  st.output_tokens,
  st.reasoning_tokens,
  st.input_tokens + st.output_tokens as total_tokens,
  st.web_searches,
  round(
      greatest(st.input_tokens - st.cached_input_tokens, 0)
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'INPUT_TOKEN', st.priced_at), 0)
    + st.cached_input_tokens
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'CACHED_INPUT_TOKEN', st.priced_at), 0)
    + st.output_tokens
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'OUTPUT_TOKEN', st.priced_at), 0)
  , 6) as model_cost_usd,
  round(
      st.web_searches
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'WEB_SEARCH_CALL', st.priced_at), 0)
  , 6) as search_cost_usd,
  /* PRICED only when every unit actually consumed had a rate. */
  case
    when public.price_per_unit_at('OPENAI', st.model, 'INPUT_TOKEN',  st.priced_at) is null
      or public.price_per_unit_at('OPENAI', st.model, 'OUTPUT_TOKEN', st.priced_at) is null
      or (st.web_searches > 0 and public.price_per_unit_at('OPENAI', st.model, 'WEB_SEARCH_CALL', st.priced_at) is null)
    then 'UNPRICED'
    else 'PRICED'
  end as price_state,
  st.priced_at
from stage st;

comment on view public.verify_stage_cogs is
  'Per-stage OpenAI COGS for a verification: research-agent stages at the model that ran them, and every paid report call (synthesis_json._reportAttempts: first, repair, escalation, rebuilds; one row each) or, for a report built before that ledger, the report and its discarded first attempt. Priced at the rates in force when each was produced. Raw provider cost only.';

-- 4 ────────────────────────────────────────────────────────────────────────
create or replace function public.admin_verify_engine_stats(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with jobs as (
    select j.id, j.query, j.status, j.created_at, j.completed_at,
           coalesce(nullif(j.result_json->'_engine'->>'version', ''), 'V1') as engine,
           c.total_cogs_usd
      from public.research_jobs j
      left join public.verify_job_cogs c on c.job_id = j.id
     where j.created_at >= v_since and j.deleted_at is null
  )
  select jsonb_build_object(
    'days', v_days,
    'engines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'engine', e.engine,
               'jobs', e.jobs,
               'complete', e.complete,
               'failed', e.failed,
               'avgSeconds', e.avg_seconds,
               'avgCogsUsd', e.avg_cogs,
               'pricedJobs', e.priced
             ) order by e.engine)
        from (
          select engine,
                 count(*) as jobs,
                 count(*) filter (where status = 'COMPLETE') as complete,
                 count(*) filter (where status in ('FAILED', 'ERROR', 'CANCELLED')) as failed,
                 round(avg(extract(epoch from (completed_at - created_at))) filter (where status = 'COMPLETE'))::integer as avg_seconds,
                 round(avg(total_cogs_usd) filter (where status = 'COMPLETE'), 4) as avg_cogs,
                 count(total_cogs_usd) filter (where status = 'COMPLETE') as priced
            from jobs group by engine
        ) e
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'engine', r.engine, 'status', r.status, 'createdAt', r.created_at,
               'seconds', case when r.completed_at is not null then round(extract(epoch from (r.completed_at - r.created_at)))::integer end,
               'cogsUsd', round(r.total_cogs_usd, 4)
             ) order by r.created_at desc)
        from (select * from jobs order by created_at desc limit 40) r
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_verify_engine_stats(integer) from public, anon;
grant execute on function public.admin_verify_engine_stats(integer) to authenticated;
