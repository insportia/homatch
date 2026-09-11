/* ══════════════════════════════════════════════════════════════════════
 * WHAT A VERIFY ACTUALLY COSTS HOMATCH
 * ══════════════════════════════════════════════════════════════════════
 *
 * cost_events records what a verification CONSUMED. This prices it, from the
 * usage already stored on the job and the effective-dated rate book, without
 * touching the financial record.
 *
 * WHY A VIEW AND NOT A COLUMN. Three separate reasons, all learned the hard
 * way in this subsystem:
 *
 *   1. Repricing must never happen by accident. cost_events.cost_usd is a
 *      financial record; a view recomputes, a column would rewrite.
 *   2. Rates are effective-dated and resolved at completed_at, so a September
 *      job prices at September's rate however long afterwards it is read.
 *      A stored number silently becomes wrong the day a rate changes.
 *   3. The pricing/wallet work needs to read Verify's cost without waiting
 *      for a backfill, and without this subsystem guessing at its schema.
 *
 * WHAT IS AND IS NOT COUNTED.
 *
 * Counted: OpenAI tokens and OpenAI web-search calls. They are the only
 * per-job metered providers Verify touches — checked against cost_events,
 * where DATAFORSEO and APIFY belong to the discovery product and have not run
 * since August.
 *
 * NOT counted: the official-source worker. It is local Playwright Chromium on
 * a Railway service — real money, but a fixed subscription shared across every
 * job rather than a per-unit meter, so folding it in per-job would be an
 * allocation, not a measurement. It belongs in a gross-margin model, not here.
 *
 * Cached input is a SUBSET of input_tokens and is subtracted, never added.
 * Reasoning tokens are inside output_tokens and are not priced separately.
 * Web-search content tokens are billed at model rates and ALREADY appear in
 * input_tokens, so the $10/1k call fee is the only extra charge.
 * All three of those are double-count traps, and each is guarded by a test.
 */

/* The rate in force for one unit at one moment, per single unit.
 * An exact model match beats a provider-wide row, matching cogs.ts. */
create or replace function public.price_per_unit_at(
  p_provider text,
  p_model    text,
  p_unit     text,
  p_at       timestamptz
) returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select (b.rate / b.per_units)
  from public.provider_price_book b
  where b.provider = p_provider
    and b.unit = p_unit
    and b.effective_from <= p_at
    and (b.effective_to is null or b.effective_to > p_at)
    and (b.model = p_model or b.model is null)
  order by (b.model = p_model) desc nulls last, b.effective_from desc
  limit 1
$$;

comment on function public.price_per_unit_at(text, text, text, timestamptz) is
  'The rate per single unit in force at a moment. Exact model beats provider-wide, and the period is half-open [from, to) — the same resolution cogs.ts performs in TypeScript.';

/* ── per stage ──────────────────────────────────────────────────────── */

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
    /* The report runs on a different model from the four research stages.
     * Pricing them as one would misattribute whichever half is expensive. */
    case when s.key = 'synthesis' then 'gpt-5.6-luna' else 'gpt-5.6-terra' end as model
  from public.research_jobs j
  cross join lateral jsonb_each(coalesce(j.result_json->'costUsage', '{}'::jsonb)) as s(key, value)
  where j.result_json ? 'costUsage'
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
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'INPUT_TOKEN', st.completed_at), 0)
    + st.cached_input_tokens
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'CACHED_INPUT_TOKEN', st.completed_at), 0)
    + st.output_tokens
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'OUTPUT_TOKEN', st.completed_at), 0)
  , 6) as model_cost_usd,
  round(
      st.web_searches
        * coalesce(public.price_per_unit_at('OPENAI', st.model, 'WEB_SEARCH_CALL', st.completed_at), 0)
  , 6) as search_cost_usd,
  /* PRICED only when every unit actually consumed had a rate. A zero that
   * means "no rate for this" must never read as a zero that means "free". */
  case
    when public.price_per_unit_at('OPENAI', st.model, 'INPUT_TOKEN',  st.completed_at) is null
      or public.price_per_unit_at('OPENAI', st.model, 'OUTPUT_TOKEN', st.completed_at) is null
      or (st.web_searches > 0 and public.price_per_unit_at('OPENAI', st.model, 'WEB_SEARCH_CALL', st.completed_at) is null)
    then 'UNPRICED'
    else 'PRICED'
  end as price_state
from stage st;

comment on view public.verify_stage_cogs is
  'Per-stage landed provider COGS for a verification, priced from the usage stored on the job at the rates in force when it completed. Raw provider cost only — no margin, no customer price, no allocated infrastructure.';

/* ── per job ────────────────────────────────────────────────────────── */

create or replace view public.verify_job_cogs as
select
  c.job_id,
  c.subject,
  c.completed_at,
  count(*)                                   as stages,
  sum(c.total_tokens)                        as total_tokens,
  sum(c.cached_input_tokens)                 as cached_input_tokens,
  sum(c.web_searches)                        as web_searches,
  round(sum(c.model_cost_usd), 6)            as model_cost_usd,
  round(sum(c.search_cost_usd), 6)           as search_cost_usd,
  round(sum(c.model_cost_usd + c.search_cost_usd), 6) as total_cogs_usd,
  /* Cents, because that is the unit research_products and the credit ledger
   * already speak. Rounded half-up at the job, not per stage. */
  round(sum(c.model_cost_usd + c.search_cost_usd) * 100)::int as total_cogs_cents,
  case when bool_or(c.price_state = 'UNPRICED') then 'PARTIALLY_PRICED' else 'PRICED' end as price_state
from public.verify_stage_cogs c
group by c.job_id, c.subject, c.completed_at;

comment on view public.verify_job_cogs is
  'Landed provider COGS for one verification. total_cogs_cents is the figure the pricing/wallet work consumes; it is cost, never a price.';

revoke all on public.verify_stage_cogs from anon, authenticated;
revoke all on public.verify_job_cogs   from anon, authenticated;
grant select on public.verify_stage_cogs to service_role;
grant select on public.verify_job_cogs   to service_role;
