/* ══════════════════════════════════════════════════════════════════════
 * VERIFY COGS: EVERY PROVIDER, EACH STAGE AT THE MODEL THAT RAN IT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Audit F7 (docs/claude/VERIFY_V2_AUDIT.md), prod job 61c1c38c: the
 * "verified" $0.771163 was about 24% short of the real $0.952924.
 *
 *   1. costUsage.synthesis is research-agent's OWN SYNTHESIS stage, run on
 *      the research model (gpt-5.6-terra). verify_stage_cogs priced it at
 *      gpt-5.6-luna: $0.009468 for a $0.094678 stage.
 *   2. The report verify-synthesis writes (synthesis_json._usage, luna,
 *      $0.027051) was not in these views at all.
 *   3. 2Captcha solves (verify_captcha_events, $0.042) and the APIFY memo23
 *      developer-ads run (cost_events DEVELOPER_ADS_VERIFY, $0.0275) were
 *      never part of the job figure.
 *
 * WHAT CHANGES
 *   verify_stage_cogs  same 15 columns, same order. Research stages are
 *                      priced at the model their response named
 *                      (result_json.costModels, written from now on), else
 *                      the research model; a dated snapshot of it prices as
 *                      it (cogs.ts pricedModel). A `report` row is added from
 *                      synthesis_json._usage, priced when it was written
 *                      (synthesis_at). Appended: priced_at.
 *   verify_job_cogs    same 12 columns, same order; total_cogs_usd/_cents
 *                      now cover every provider. Appended: ai_cost_usd,
 *                      web_search_cost_usd, captcha_cost_usd, apify_cost_usd,
 *                      other_provider_cost_usd, captcha_solves.
 *   verify_billing_events  unchanged columns (provider_cogs_* follow
 *                      total_cogs_*); the three non-OpenAI parts appended.
 *   verify_cogs_job()  the admin detail RPC also returns those three.
 *
 * HISTORY IS CORRECTED ON READ, NEVER REWRITTEN
 *   These are views over usage already stored on each job, priced from the
 *   effective-dated price book — exactly as before. Nothing in cost_events
 *   is updated: its historical VERIFY_SYNTHESIS rows keep the luna figure
 *   they were written with. finance_cost_facts never summed those rows (it
 *   excludes VERIFY% from cost_events and reads verify_stage_cogs instead),
 *   so finance gains the corrected synthesis and the report line here, and
 *   still counts CAPTCHA_SOLVE / DEVELOPER_ADS_VERIFY once, from cost_events.
 *
 * WHAT DOES NOT CHANGE: WHAT A CUSTOMER PAYS
 *   verify_job_cost() — the customer meter behind verify_billing — reads
 *   research_jobs, verify_captcha_events and non-OpenAI cost_events
 *   directly. It does not read any view in this file, and no function body
 *   it uses is touched here, so every charge, reservation and settlement is
 *   computed exactly as before.
 *
 * COGS here is the real spend: unlike the customer meter it does not leave
 * out solves made while a job was paused.
 */

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
  'Per-stage OpenAI COGS for a verification: research-agent stages at the model that ran them (costModels, else the research model) and the verify-synthesis report (stage report), priced from the usage stored on the job at the rates in force when each was produced. Raw provider cost only — no margin, no customer price.';

/* ── per job ────────────────────────────────────────────────────────── */

create or replace view public.verify_job_cogs as
with ai as (
  select
    c.job_id,
    c.subject,
    c.completed_at,
    count(*)                         as stages,
    sum(c.total_tokens)              as total_tokens,
    sum(c.cached_input_tokens)       as cached_input_tokens,
    sum(c.web_searches)              as web_searches,
    sum(c.model_cost_usd)            as model_usd,
    sum(c.search_cost_usd)           as search_usd,
    bool_or(c.price_state = 'UNPRICED') as unpriced
  from public.verify_stage_cogs c
  group by c.job_id, c.subject, c.completed_at
),
priced as (
  select
    a.*,
    coalesce(cap.usd, 0)    as captcha_usd,
    coalesce(cap.solves, 0) as captcha_solves,
    coalesce(pr.apify, 0)   as apify_usd,
    coalesce(pr.other, 0)   as other_usd,
    a.unpriced or coalesce(cap.unpriced, false) or coalesce(pr.unpriced, false) as any_unpriced
  from ai a
  /* 2Captcha: the per-job ledger, every solve that was paid for. */
  left join lateral (
    select count(*)                                        as solves,
           sum(coalesce(ev.cost_usd, 0))                   as usd,
           bool_or(ev.cost_usd is null)                    as unpriced
      from public.verify_captcha_events ev
     where ev.job_id = a.job_id
       and ev.outcome in ('ACCEPTED', 'REJECTED', 'NO_CHANGE')
  ) cap on true
  /* Every non-OpenAI provider run recorded against the job (OpenAI is
   * priced above from the job's own usage and never counted twice). */
  left join lateral (
    select sum(case when ce.provider::text like 'APIFY%' then greatest(coalesce(ce.cost_usd, 0), 0) else 0 end) as apify,
           sum(case when ce.provider::text like 'APIFY%' then 0 else greatest(coalesce(ce.cost_usd, 0), 0) end) as other,
           bool_or(ce.pricing_state in ('UNPRICED', 'PARTIAL'))                                              as unpriced
      from public.cost_events ce
     where ce.job_id = a.job_id
       and ce.provider::text <> 'OPENAI'
  ) pr on true
)
select
  p.job_id,
  p.subject,
  p.completed_at,
  p.stages,
  p.total_tokens,
  p.cached_input_tokens,
  p.web_searches,
  round(p.model_usd, 6)                                                   as model_cost_usd,
  round(p.search_usd, 6)                                                  as search_cost_usd,
  /* Every provider. Cents, because that is what the ledger speaks,
   * rounded half-up at the job, not per part. */
  round(p.model_usd + p.search_usd + p.captcha_usd + p.apify_usd + p.other_usd, 6) as total_cogs_usd,
  round((p.model_usd + p.search_usd + p.captcha_usd + p.apify_usd + p.other_usd) * 100)::int as total_cogs_cents,
  case when p.any_unpriced then 'PARTIALLY_PRICED' else 'PRICED' end      as price_state,
  round(p.model_usd, 6)                                                   as ai_cost_usd,
  round(p.search_usd, 6)                                                  as web_search_cost_usd,
  round(p.captcha_usd, 6)                                                 as captcha_cost_usd,
  round(p.apify_usd, 6)                                                   as apify_cost_usd,
  round(p.other_usd, 6)                                                   as other_provider_cost_usd,
  p.captcha_solves
from priced p;

comment on view public.verify_job_cogs is
  'Landed provider COGS for one verification, every provider: OpenAI model + web search (ai_cost_usd, web_search_cost_usd), 2Captcha, APIFY and any other provider run recorded against the job. total_cogs_cents is cost, never a price; the customer charge is verify_job_cost/verify_billing and is not derived from this view.';

/* ── metering row: the three non-OpenAI parts, appended ─────────────── */

create or replace view public.verify_billing_events as
select
  j.id                                        as job_id,
  'VERIFY'::text                              as product_type,
  null::text                                  as quality_tier,
  j.user_id,
  j.query                                     as subject,
  j.completed_at,
  round(extract(epoch from (j.completed_at - j.created_at)))::int as duration_seconds,

  c.total_tokens,
  c.cached_input_tokens,
  c.web_searches,
  'OPENAI'::text                              as provider,

  c.model_cost_usd,
  c.search_cost_usd,
  c.total_cogs_usd                            as provider_cogs_usd,
  c.total_cogs_cents                          as provider_cogs_cents,
  'USD'::text                                 as cogs_currency,
  c.price_state,

  (select max(b.effective_from)
     from public.provider_price_book b
    where b.provider = 'OPENAI'
      and b.effective_from <= j.completed_at
      and (b.effective_to is null or b.effective_to > j.completed_at)) as price_book_effective_from,

  coalesce((j.result_json->'_reusePlan'->>'known')::boolean, false) as reuse_graph_hit,
  (j.result_json->'_reusePlan'->>'reusableFacts')::int              as reuse_facts_reused,
  (j.result_json->'_reusePlan'->>'requiredFacts')::int              as reuse_facts_required,
  (j.result_json->'_reusePlan'->>'heldFacts')::int                  as reuse_facts_on_subject,
  (j.result_json->'_reusePlan'->>'relatedFacts')::int               as reuse_facts_on_lineage,

  (select jsonb_object_agg(s.stage, jsonb_build_object(
            'tokens', s.total_tokens,
            'web_searches', s.web_searches,
            'model_cost_usd', s.model_cost_usd,
            'search_cost_usd', s.search_cost_usd,
            'model', s.model))
     from public.verify_stage_cogs s
    where s.job_id = j.id)                    as stage_breakdown,

  c.captcha_cost_usd,
  c.apify_cost_usd,
  c.other_provider_cost_usd

from public.research_jobs j
join public.verify_job_cogs c on c.job_id = j.id
where j.status = 'COMPLETE';

/* ── admin detail: the same row, with the non-OpenAI parts ──────────── */

create or replace function public.verify_cogs_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v jsonb;
begin
  -- NULL-SAFE ON PURPOSE (see 20260919200000_verify_cogs_admin.sql).
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select to_jsonb(x) into v from (
    select
      e.job_id,
      e.user_id,
      (select u.email::text from auth.users u where u.id = e.user_id) as user_email,
      e.subject,
      e.completed_at,
      e.duration_seconds,
      e.total_tokens,
      e.cached_input_tokens,
      e.web_searches,
      e.provider,
      e.model_cost_usd,
      e.search_cost_usd,
      e.provider_cogs_usd,
      e.provider_cogs_cents,
      e.cogs_currency,
      e.price_state,
      e.price_book_effective_from,
      e.reuse_graph_hit,
      e.reuse_facts_reused,
      e.reuse_facts_required,
      e.reuse_facts_on_subject,
      e.reuse_facts_on_lineage,
      e.stage_breakdown,
      e.captcha_cost_usd,
      e.apify_cost_usd,
      e.other_provider_cost_usd
    from public.verify_billing_events e
    where e.job_id = p_job_id
  ) x;

  return v;
end;
$fn$;

/* CREATE OR REPLACE keeps grants; restated so none can widen. */
revoke all on public.verify_stage_cogs     from anon, authenticated;
revoke all on public.verify_job_cogs       from anon, authenticated;
revoke all on public.verify_billing_events from anon, authenticated;
grant select on public.verify_stage_cogs     to service_role;
grant select on public.verify_job_cogs       to service_role;
grant select on public.verify_billing_events to service_role;
revoke all on function public.verify_cogs_job(uuid) from public, anon;
grant execute on function public.verify_cogs_job(uuid) to authenticated, service_role;
