-- TWO IDENTITIES WERE SHARING ONE COLUMN.
--
-- research_jobs.user_id holds an AUTH id. Every other table in this schema —
-- properties, credit_accounts, payments, credit_lots — holds a public.users.id.
-- Measured on production: of 79 research jobs with a user, 79 join to
-- auth.users and 0 join to public.users.
--
-- finance_cost_facts therefore emitted an auth id on its VERIFY branch and a
-- public id on its cost_events branch, in the same column. Anything grouping
-- the stream by customer silently lost all Verify cost — which is $20 of the
-- $45 spent. finance_users reported every customer's provider cost as if they
-- had never run a verification, and the admin users page showed 0 verifies for
-- an account that had run 76.
--
-- The fix is to speak ONE identity in the fact stream. public.users.id wins,
-- because that is what the rest of the schema and every report already uses.
--
-- After: $44.78 of $45.53 attributable to a customer, and Verify still
-- reconciles exactly against verify_stage_cogs ($20.2933 on both sides) — this
-- moves WHO cost belongs to, never HOW MUCH.

CREATE OR REPLACE VIEW public.finance_cost_facts AS
SELECT
  ('verify:' || s.job_id::text || ':' || s.stage)          AS fact_key,
  COALESCE(s.completed_at, j.created_at)                   AS occurred_at,
  'OPENAI'::text                                           AS provider,
  'OPENAI'::text                                           AS billed_by,
  'VERIFY'::text                                           AS product,
  upper(s.stage)                                           AS stage,
  'MODEL_AND_SEARCH'::text                                 AS operation,
  -- research_jobs.user_id is an AUTH id. Resolve it so this column means the
  -- same thing on every branch.
  ju.id                                                    AS user_id,
  s.job_id::text                                           AS job_ref,
  s.model,
  s.total_tokens::numeric                                  AS quantity,
  'TOKENS'::text                                           AS unit,
  s.input_tokens, s.cached_input_tokens, s.output_tokens,
  s.web_searches::integer                                  AS web_searches,
  round(s.model_cost_usd + s.search_cost_usd, 6)           AS cost_usd,
  round(s.model_cost_usd, 6)                               AS model_cost_usd,
  round(s.search_cost_usd, 6)                              AS search_cost_usd,
  'USD'::text                                              AS source_currency,
  round(s.model_cost_usd + s.search_cost_usd, 6)           AS source_amount,
  CASE WHEN s.price_state = 'PRICED' THEN 'CALCULATED' ELSE 'UNPRICED' END AS cost_source,
  (s.price_state <> 'PRICED')                              AS is_unpriced,
  true                                                     AS is_cogs,
  'EXECUTION'::text                                        AS charge_class,
  NULL::text                                               AS market,
  false                                                    AS cache_hit,
  'VERIFY_STAGE'::text                                     AS origin
FROM public.verify_stage_cogs s
JOIN public.research_jobs j ON j.id = s.job_id
LEFT JOIN public.users ju ON ju.auth_id = j.user_id

UNION ALL

SELECT
  ('ce:' || ce.id::text),
  ce."timestamp",
  COALESCE(r.provider_id, ce.provider::text),
  COALESCE(r.provider_id, ce.provider::text),
  public.finance_product_for_operation(ce.operation_type, COALESCE(r.default_product, 'PLATFORM')),
  ce.operation_type, ce.operation_type,
  p.user_id,
  COALESCE(ce.job_id::text, ce.discovery_job_id::text),
  NULL::text,
  COALESCE(ce.units, 0),
  COALESCE(r.billing_unit, 'UNITS'),
  NULL, NULL, NULL, NULL::integer,
  round(COALESCE(ce.cost_usd, 0), 6), NULL, NULL,
  'USD'::text,
  round(COALESCE(ce.cost_usd, 0), 6),
  CASE WHEN COALESCE(ce.cost_usd,0) = 0 AND COALESCE(ce.units,0) > 0 AND NOT COALESCE(ce.cache_hit,false)
       THEN 'UNPRICED' ELSE COALESCE(r.default_cost_source, 'MEASURED') END,
  (COALESCE(ce.cost_usd,0) = 0 AND COALESCE(ce.units,0) > 0 AND NOT COALESCE(ce.cache_hit,false)),
  (COALESCE(r.counts_as_cogs, true)
   AND NOT (ce.provider::text = 'OTHER' AND ce.operation_type = 'MATCH_UNLOCK')),
  'EXECUTION'::text,
  ce.market,
  COALESCE(ce.cache_hit, false),
  'COST_EVENT'::text
FROM public.cost_events ce
LEFT JOIN public.properties p ON p.id = ce.property_id
LEFT JOIN public.finance_provider_registry r ON r.legacy_enum_value = ce.provider::text
WHERE ce.operation_type NOT LIKE 'VERIFY%'

UNION ALL

SELECT
  ('pce:' || e.id::text),
  e.occurred_at,
  e.provider_id,
  COALESCE(e.billed_by_provider_id, e.provider_id),
  COALESCE(e.product_code, public.finance_product_for_operation(e.operation, COALESCE(r.default_product,'PLATFORM'))),
  COALESCE(e.component, e.operation),
  e.operation,
  e.user_id, e.job_ref, NULL::text,
  e.quantity,
  COALESCE(e.unit, r.billing_unit, 'UNITS'),
  NULL, NULL, NULL, NULL::integer,
  round(COALESCE(c.resolved, 0), 6),
  NULL, NULL,
  e.source_currency,
  round(e.source_amount, 6),
  c.resolved_source,
  (c.resolved IS NULL AND COALESCE(e.quantity,0) > 0 AND NOT e.cache_hit),
  (COALESCE(e.counts_as_cogs, r.counts_as_cogs, true)
   AND NOT e.is_double_count_guard),
  e.charge_class,
  e.market,
  e.cache_hit,
  'PROVIDER_EVENT'::text
FROM public.finance_provider_cost_events e
LEFT JOIN public.finance_provider_registry r ON r.provider_id = e.provider_id
CROSS JOIN LATERAL (
  SELECT v.resolved,
         CASE
           WHEN v.resolved IS NULL THEN 'UNPRICED'
           WHEN e.cost_usd IS NOT NULL OR e.source_amount IS NOT NULL THEN e.cost_source
           ELSE 'CALCULATED'
         END AS resolved_source
  FROM (SELECT COALESCE(
          e.cost_usd,
          public.fx_to_usd(e.source_amount, e.source_currency, e.occurred_at),
          CASE WHEN r.supports_effective_dated_pricing THEN
            e.quantity * public.finance_provider_unit_cost(
              e.provider_id, e.operation, e.market, e.occurred_at) END
        ) AS resolved) v
) c

UNION ALL

SELECT
  ('inv:' || i.id::text),
  (i.period_end + 1)::timestamptz,
  i.provider_id, i.provider_id,
  COALESCE(i.product_code, r.default_product, 'PLATFORM'),
  'INVOICE'::text, 'INVOICE'::text,
  NULL::uuid, i.invoice_ref, NULL::text,
  1::numeric, 'USD'::text,
  NULL, NULL, NULL, NULL::integer,
  round(COALESCE(public.fx_to_usd(
    CASE WHEN i.reversal_of IS NOT NULL THEN -i.source_amount ELSE i.source_amount END,
    i.source_currency, (i.period_end + 1)::timestamptz), 0), 6),
  NULL, NULL,
  i.source_currency,
  round(i.source_amount, 6),
  CASE WHEN public.fx_rate_known(i.source_currency, (i.period_end + 1)::timestamptz)
       THEN 'PROVIDER_REPORTED' ELSE 'UNPRICED' END,
  NOT public.fx_rate_known(i.source_currency, (i.period_end + 1)::timestamptz),
  i.counts_as_cogs,
  'SUBSCRIPTION'::text,
  NULL::text, false,
  'INVOICE'::text
FROM public.finance_provider_invoices i
LEFT JOIN public.finance_provider_registry r ON r.provider_id = i.provider_id;

COMMENT ON VIEW public.finance_cost_facts IS
  'The single summable stream of Homatch provider spend. Four origins: VERIFY_STAGE (token-accurate, price-book priced), COST_EVENT (the legacy enum meter, VERIFY% excluded so the same money is never counted twice), PROVIDER_EVENT (any registered provider, enum-free) and INVOICE. user_id is ALWAYS a public.users.id, including on the Verify branch where research_jobs stores an auth id. cost_source states how each figure was arrived at; is_unpriced marks work that happened with no rate behind it; is_cogs excludes both business events written to the cost table and components another provider actually billed.';

REVOKE ALL ON public.finance_cost_facts FROM anon, authenticated;
GRANT SELECT ON public.finance_cost_facts TO service_role;

-- Same identity mismatch, in the admin users list.
CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_limit integer DEFAULT 200, p_offset integer DEFAULT 0,
  p_include_orphans boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  return jsonb_build_object(
    'credits_per_usd', v_cpu,
    'totals', (select jsonb_build_object(
        'profiles', count(*),
        'registered', count(*) filter (where a.id is not null),
        'orphaned', count(*) filter (where a.id is null),
        'signed_in_ever', count(*) filter (where a.last_sign_in_at is not null),
        'active_30d', count(*) filter (where a.last_sign_in_at >= now() - interval '30 days'),
        'admins', count(*) filter (where u.is_admin))
      from public.users u left join auth.users a on a.id = u.auth_id),
    'rows', COALESCE((select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'full_name', u.full_name,
        'nickname', u.nickname,
        'username', u.username,
        'phone', u.phone,
        'avatar_url', u.avatar_url,
        'plan', COALESCE(u.plan, 'FREE'),
        'is_admin', u.is_admin,
        'preferred_language', u.preferred_language,
        'created_at', u.created_at,
        'registered', (a.id is not null),
        'sign_in_provider', a.raw_app_meta_data->>'provider',
        'last_sign_in_at', a.last_sign_in_at,
        'email_confirmed_at', a.email_confirmed_at,
        'auth_created_at', a.created_at,
        'credits_balance', round(COALESCE(ca.balance, 0), 2),
        'credits_reserved', round(COALESCE(ca.reserved, 0), 2),
        'credits_value_usd', round(COALESCE(ca.balance, 0) / v_cpu, 2),
        'properties', COALESCE(p.n, 0),
        -- research_jobs keys on the AUTH id, not on users.id.
        'verify_runs', COALESCE(rj.n, 0),
        'last_verify_at', rj.last_run,
        'paid_usd', round(COALESCE(pay.usd, 0), 2),
        'provider_cost_usd', round(COALESCE(cogs.usd, 0), 4),
        'last_activity_at', greatest(a.last_sign_in_at, rj.last_run, u.updated_at)
      ) as r
      from public.users u
      left join auth.users a on a.id = u.auth_id
      left join public.credit_accounts ca on ca.user_id = u.id
      left join lateral (select count(*) n from public.properties pr
                          where pr.user_id = u.id) p on true
      left join lateral (select count(*) n, max(created_at) last_run
                           from public.research_jobs j where j.user_id = u.auth_id) rj on true
      left join lateral (select sum(public.fx_to_usd(pm.total_cents::numeric/100, pm.currency, pm.created_at)) usd
                           from public.payments pm
                          where pm.user_id = u.id and pm.status = 'COMPLETED') pay on true
      left join lateral (select sum(f.cost_usd) usd from public.finance_cost_facts f
                          where f.is_cogs and f.user_id = u.id) cogs on true
      where p_include_orphans or a.id is not null
      order by u.created_at desc
      limit greatest(1, least(p_limit, 1000)) offset greatest(0, p_offset)
    ) q), '[]'::jsonb)
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.admin_users_list(integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_users_list(integer, integer, boolean) TO authenticated, service_role;
