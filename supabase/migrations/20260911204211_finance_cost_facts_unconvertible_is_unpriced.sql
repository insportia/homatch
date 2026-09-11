-- Same four branches; the registry branches now resolve cost ONCE in a lateral
-- and treat "we could not convert this currency" as UNPRICED, the same as "we
-- have no rate for this operation". Neither may ever read as zero dollars.
-- source_amount is now the genuine provider-currency figure, or null — it no
-- longer falls back to the USD number under a foreign currency label.
--
-- NOTE: superseded by 20260911204617, which adds the source-of-truth taxonomy
-- and the bring-your-own-key double-count guard.

CREATE OR REPLACE VIEW public.finance_cost_facts AS
SELECT
  ('verify:' || s.job_id::text || ':' || s.stage)          AS fact_key,
  COALESCE(s.completed_at, j.created_at)                   AS occurred_at,
  'OPENAI'::text                                           AS provider,
  'VERIFY'::text                                           AS product,
  upper(s.stage)                                           AS stage,
  'MODEL_AND_SEARCH'::text                                 AS operation,
  j.user_id,
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
  'PRICE_BOOK'::text                                       AS cost_source,
  (s.price_state <> 'PRICED')                              AS is_unpriced,
  true                                                     AS is_cogs,
  NULL::text                                               AS market,
  false                                                    AS cache_hit,
  'VERIFY_STAGE'::text                                     AS origin
FROM public.verify_stage_cogs s
JOIN public.research_jobs j ON j.id = s.job_id

UNION ALL

SELECT
  ('ce:' || ce.id::text),
  ce."timestamp",
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
  'MEASURED'::text,
  (COALESCE(ce.cost_usd,0) = 0 AND COALESCE(ce.units,0) > 0 AND NOT COALESCE(ce.cache_hit,false)),
  (COALESCE(r.counts_as_cogs, true)
   AND NOT (ce.provider::text = 'OTHER' AND ce.operation_type = 'MATCH_UNLOCK')),
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
  COALESCE(e.product_code, public.finance_product_for_operation(e.operation, COALESCE(r.default_product,'PLATFORM'))),
  e.operation, e.operation,
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
  COALESCE(e.counts_as_cogs, r.counts_as_cogs, true),
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
           ELSE 'PRICE_BOOK'
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
  i.provider_id,
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
       THEN 'INVOICE' ELSE 'UNPRICED' END,
  NOT public.fx_rate_known(i.source_currency, (i.period_end + 1)::timestamptz),
  i.counts_as_cogs,
  NULL::text, false,
  'INVOICE'::text
FROM public.finance_provider_invoices i
LEFT JOIN public.finance_provider_registry r ON r.provider_id = i.provider_id;

REVOKE ALL ON public.finance_cost_facts FROM anon, authenticated;
GRANT SELECT ON public.finance_cost_facts TO service_role;
