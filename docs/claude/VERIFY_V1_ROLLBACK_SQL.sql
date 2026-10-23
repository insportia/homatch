-- PRODUCTION DEFINITIONS captured 2026-10-23 before Verify V1 stabilisation (read-only pg_get_*def).
-- Rollback = a NEW forward migration with these bodies, followed by the grants below.

create or replace view public.verify_stage_cogs as  WITH stage AS (
         SELECT j.id AS job_id,
            j.query AS subject,
            j.completed_at,
            s.key AS stage,
            COALESCE((s.value ->> 'input_tokens'::text)::bigint, 0::bigint) AS input_tokens,
            COALESCE(((s.value -> 'input_tokens_details'::text) ->> 'cached_tokens'::text)::bigint, 0::bigint) AS cached_input_tokens,
            COALESCE((s.value ->> 'output_tokens'::text)::bigint, 0::bigint) AS output_tokens,
            COALESCE(((s.value -> 'output_tokens_details'::text) ->> 'reasoning_tokens'::text)::bigint, 0::bigint) AS reasoning_tokens,
            COALESCE(((j.result_json -> 'webSearchCalls'::text) ->> s.key)::integer, 0) AS web_searches,
                CASE
                    WHEN s.key = 'synthesis'::text THEN 'gpt-5.6-luna'::text
                    ELSE 'gpt-5.6-terra'::text
                END AS model
           FROM research_jobs j
             CROSS JOIN LATERAL jsonb_each(COALESCE(j.result_json -> 'costUsage'::text, '{}'::jsonb)) s(key, value)
          WHERE j.result_json ? 'costUsage'::text
        )
 SELECT job_id,
    subject,
    completed_at,
    stage,
    model,
    input_tokens,
    cached_input_tokens,
    GREATEST(input_tokens - cached_input_tokens, 0::bigint) AS fresh_input_tokens,
    output_tokens,
    reasoning_tokens,
    input_tokens + output_tokens AS total_tokens,
    web_searches,
    round(GREATEST(input_tokens - cached_input_tokens, 0::bigint)::numeric * COALESCE(price_per_unit_at('OPENAI'::text, model, 'INPUT_TOKEN'::text, completed_at), 0::numeric) + cached_input_tokens::numeric * COALESCE(price_per_unit_at('OPENAI'::text, model, 'CACHED_INPUT_TOKEN'::text, completed_at), 0::numeric) + output_tokens::numeric * COALESCE(price_per_unit_at('OPENAI'::text, model, 'OUTPUT_TOKEN'::text, completed_at), 0::numeric), 6) AS model_cost_usd,
    round(web_searches::numeric * COALESCE(price_per_unit_at('OPENAI'::text, model, 'WEB_SEARCH_CALL'::text, completed_at), 0::numeric), 6) AS search_cost_usd,
        CASE
            WHEN price_per_unit_at('OPENAI'::text, model, 'INPUT_TOKEN'::text, completed_at) IS NULL OR price_per_unit_at('OPENAI'::text, model, 'OUTPUT_TOKEN'::text, completed_at) IS NULL OR web_searches > 0 AND price_per_unit_at('OPENAI'::text, model, 'WEB_SEARCH_CALL'::text, completed_at) IS NULL THEN 'UNPRICED'::text
            ELSE 'PRICED'::text
        END AS price_state
   FROM stage st;

create or replace view public.verify_job_cogs as  SELECT job_id,
    subject,
    completed_at,
    count(*) AS stages,
    sum(total_tokens) AS total_tokens,
    sum(cached_input_tokens) AS cached_input_tokens,
    sum(web_searches) AS web_searches,
    round(sum(model_cost_usd), 6) AS model_cost_usd,
    round(sum(search_cost_usd), 6) AS search_cost_usd,
    round(sum(model_cost_usd + search_cost_usd), 6) AS total_cogs_usd,
    round(sum(model_cost_usd + search_cost_usd) * 100::numeric)::integer AS total_cogs_cents,
        CASE
            WHEN bool_or(price_state = 'UNPRICED'::text) THEN 'PARTIALLY_PRICED'::text
            ELSE 'PRICED'::text
        END AS price_state
   FROM verify_stage_cogs c
  GROUP BY job_id, subject, completed_at;

create or replace view public.verify_billing_events as  SELECT j.id AS job_id,
    'VERIFY'::text AS product_type,
    NULL::text AS quality_tier,
    j.user_id,
    j.query AS subject,
    j.completed_at,
    round(EXTRACT(epoch FROM j.completed_at - j.created_at))::integer AS duration_seconds,
    c.total_tokens,
    c.cached_input_tokens,
    c.web_searches,
    'OPENAI'::text AS provider,
    c.model_cost_usd,
    c.search_cost_usd,
    c.total_cogs_usd AS provider_cogs_usd,
    c.total_cogs_cents AS provider_cogs_cents,
    'USD'::text AS cogs_currency,
    c.price_state,
    ( SELECT max(b.effective_from) AS max
           FROM provider_price_book b
          WHERE b.provider = 'OPENAI'::text AND b.effective_from <= j.completed_at AND (b.effective_to IS NULL OR b.effective_to > j.completed_at)) AS price_book_effective_from,
    COALESCE(((j.result_json -> '_reusePlan'::text) ->> 'known'::text)::boolean, false) AS reuse_graph_hit,
    ((j.result_json -> '_reusePlan'::text) ->> 'reusableFacts'::text)::integer AS reuse_facts_reused,
    ((j.result_json -> '_reusePlan'::text) ->> 'requiredFacts'::text)::integer AS reuse_facts_required,
    ((j.result_json -> '_reusePlan'::text) ->> 'heldFacts'::text)::integer AS reuse_facts_on_subject,
    ((j.result_json -> '_reusePlan'::text) ->> 'relatedFacts'::text)::integer AS reuse_facts_on_lineage,
    ( SELECT jsonb_object_agg(s.stage, jsonb_build_object('tokens', s.total_tokens, 'web_searches', s.web_searches, 'model_cost_usd', s.model_cost_usd, 'search_cost_usd', s.search_cost_usd, 'model', s.model)) AS jsonb_object_agg
           FROM verify_stage_cogs s
          WHERE s.job_id = j.id) AS stage_breakdown
   FROM research_jobs j
     JOIN verify_job_cogs c ON c.job_id = j.id
  WHERE j.status = 'COMPLETE'::text;

CREATE OR REPLACE FUNCTION public.verify_cogs_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select to_jsonb(x) into v from (
    select e.job_id, e.user_id,
      (select u.email::text from auth.users u where u.id = e.user_id) as user_email,
      e.subject, e.completed_at, e.duration_seconds, e.total_tokens, e.cached_input_tokens,
      e.web_searches, e.provider, e.model_cost_usd, e.search_cost_usd, e.provider_cogs_usd,
      e.provider_cogs_cents, e.cogs_currency, e.price_state, e.price_book_effective_from,
      e.reuse_graph_hit, e.reuse_facts_reused, e.reuse_facts_required, e.reuse_facts_on_subject,
      e.reuse_facts_on_lineage, e.stage_breakdown
    from public.verify_billing_events e where e.job_id = p_job_id) x;
  return v;
end; $function$
;

CREATE OR REPLACE FUNCTION public.background_job_finish(p_job_id uuid, p_state text, p_result_ref text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_user_safe_error text DEFAULT NULL::text, p_last_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.background_jobs;
begin
  perform public.background_jobs_assert_worker();

  if p_state not in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'background_job_finish requires a terminal state, got %', p_state;
  end if;

  select * into v_job from public.background_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_job.state in ('COMPLETED', 'FAILED', 'CANCELLED') then
    return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job),
                              'alreadyTerminal', true);
  end if;

  update public.background_jobs
     set state = p_state,
         progress = case when p_state = 'COMPLETED' then 100 else progress end,
         result_ref = coalesce(p_result_ref, result_ref),
         error_code = p_error_code,
         user_safe_error = p_user_safe_error,
         last_error = p_last_error,
         completed_at = case when p_state = 'COMPLETED' then now() else completed_at end,
         failed_at = case when p_state = 'FAILED' then now() else failed_at end,
         cancelled_at = case when p_state = 'CANCELLED' then now() else cancelled_at end,
         last_heartbeat_at = now()
   where id = p_job_id
  returning * into v_job;

  return jsonb_build_object('ok', true, 'job', public.background_job_public(v_job));
end;
$function$
;

revoke all on public.verify_stage_cogs, public.verify_job_cogs, public.verify_billing_events from anon, authenticated;
grant select on public.verify_stage_cogs, public.verify_job_cogs, public.verify_billing_events to service_role;
revoke execute on function public.background_job_finish(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.background_job_finish(uuid,text,text,text,text,text) to service_role;
-- verify_cogs_job: production currently grants EXECUTE to anon, authenticated, service_role (guarded by is_admin/service inside).
grant execute on function public.verify_cogs_job(uuid) to anon, authenticated, service_role;
