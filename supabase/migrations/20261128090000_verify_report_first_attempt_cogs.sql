-- Verify V2 — the report's first attempt is a COGS line of its own.
--
-- verify-synthesis (V2, report policy AUTO) writes the report with the cheap
-- model and sends it to the strong model only when the objective quality gate
-- (finalizeReport: ungrounded citations, uncited claims, claims contradicted
-- by evidence, …) rejects it. Both calls are paid. synthesis_json._usage is
-- the attempt that was kept; _usageFirstAttempt is the one that was not, and
-- verify_stage_cogs now prices it as stage report_first_attempt, so
-- verify_job_cogs counts both. Same columns, same pricing; nothing else in
-- the view changes. The customer meter (verify_job_cost) is not touched.

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

  /* The report verify-synthesis wrote: its own call, on its own model. */
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

  union all

  /* V2 report escalation: the cheap model's first attempt, kept when the
     quality gate sent the report to the strong model. Its own row, at its
     own model, so an escalated report is never priced as one call. */
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
  'Per-stage OpenAI COGS for a verification: research-agent stages at the model that ran them (costModels, else the research model), the verify-synthesis report (stage report) and, for an escalated V2 report, the discarded first attempt (stage report_first_attempt), priced from the usage stored on the job at the rates in force when each was produced. Raw provider cost only — no margin, no customer price.';
