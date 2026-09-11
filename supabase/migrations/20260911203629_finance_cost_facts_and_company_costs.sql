-- HOMATCH FINANCE — one honest answer to "what did we spend".
--
-- WHAT WAS ALREADY HERE, AND WHY THIS IS NOT A SECOND ACCOUNTING SYSTEM
--
--   cost_events        what the provider integrations measured, per call.
--   verify_stage_cogs  Verify's real token/search cost, priced from
--   verify_job_cogs    provider_price_book at the moment the job ran.
--   verify_billing_events  the job-level view over those.
--   provider_price_book + price_per_unit_at()   effective-dated rates.
--   usage_events       what a CUSTOMER was charged and the landed COGS.
--
-- All of that stays. This adds the one thing missing: a single fact stream
-- that can be summed without double counting, and that never reports an
-- unpriced call as zero.
--
-- THE DOUBLE COUNT THIS EXISTS TO PREVENT
--
-- Verify now writes BOTH a cost_events row per stage AND has its cost
-- recomputed by verify_stage_cogs from the token counts. Measured on
-- production for job e47de985: cost_events sums to $0.453554 and
-- verify_job_cogs returns $0.453554. Identical. Summing the two tables would
-- report double.
--
-- So Verify comes from verify_stage_cogs ONLY, and cost_events rows whose
-- operation_type starts with VERIFY are excluded here. That also fixes a much
-- larger understatement: cost_events only began recording a non-zero Verify
-- cost on 2026-09-11, so of 55 completed Verify jobs it reports $0.97 against
-- the token-accurate $18.93. Reading cost_events alone understates Verify by
-- 95%.
--
-- WHAT "UNPRICED" MEANS, AND WHY IT IS NOT ZERO
--
-- 221 rows on production did real work (units > 0), were not cache hits, and
-- recorded no cost: 203 DataForSEO SERP searches, 15 Apify public-source
-- monitors, 2 Telegram discoveries, 1 massive discovery of 240 units. Those
-- are not free. They are unpriced, and finance must say so rather than adding
-- zero to a total. is_unpriced carries that, and the dashboard surfaces it.
--
-- MATCH_UNLOCK IS NOT A PROVIDER COST
--
-- 16 rows sit in cost_events with provider OTHER and operation MATCH_UNLOCK.
-- They are a business event that was written to the cost table; they have no
-- provider spend behind them. is_cogs = false keeps them out of COGS while
-- leaving the rows untouched.

-- ── Indexes the finance reads depend on ─────────────────────
CREATE INDEX IF NOT EXISTS idx_cost_events_timestamp ON public.cost_events("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_cost_events_provider_ts ON public.cost_events(provider, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_cost_events_operation_ts ON public.cost_events(operation_type, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_research_jobs_completed ON public.research_jobs(completed_at DESC) WHERE completed_at IS NOT NULL;

-- ── FX, so a non-USD provider bill is never silently lost ───
-- USD is the internal accounting currency. Nothing in the codebase bills in
-- another currency TODAY, so this starts with the identity rate only. It
-- exists now because retrofitting currency onto an accounting system after it
-- has history is far worse than carrying an unused column.
CREATE TABLE IF NOT EXISTS public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL,
  quote_currency text NOT NULL DEFAULT 'USD',
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'MANUAL',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_rates_not_self CHECK (base_currency <> quote_currency OR rate = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_fx_rates_period
  ON public.fx_rates(base_currency, quote_currency, effective_from);
INSERT INTO public.fx_rates (base_currency, quote_currency, rate, source, effective_from)
VALUES ('USD','USD',1,'IDENTITY','2000-01-01')
ON CONFLICT DO NOTHING;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx_rates_admin ON public.fx_rates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY fx_rates_service ON public.fx_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- NOTE: this permissive version of fx_to_usd (COALESCE(rate, 1)) was replaced
-- in 20260911204157_finance_fx_strict_no_silent_parity.sql, which found that
-- falling back to a rate of 1 invents a conversion for any unknown currency.
CREATE OR REPLACE FUNCTION public.fx_to_usd(p_amount numeric, p_currency text, p_at timestamptz DEFAULT now())
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round(COALESCE(p_amount,0) * COALESCE((
    SELECT r.rate FROM public.fx_rates r
     WHERE r.base_currency = upper(COALESCE(p_currency,'USD'))
       AND r.quote_currency = 'USD'
       AND r.effective_from <= p_at
       AND (r.effective_to IS NULL OR r.effective_to > p_at)
     ORDER BY r.effective_from DESC LIMIT 1), 1), 6);
$fn$;

-- ── Fixed / recurring company costs ─────────────────────────
-- Provider metering is not the whole company. These are entered by an admin
-- because no API reports them reliably, and they are marked MANUAL so they can
-- never be mistaken for measured usage.
CREATE TABLE IF NOT EXISTS public.finance_fixed_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor text NOT NULL,
  category text NOT NULL DEFAULT 'OTHER'
    CHECK (category IN ('INFRASTRUCTURE','AI','COMMUNICATION','EMAIL','TELEPHONY',
                        'DATA_PROVIDER','PAYMENT','DOMAIN','SOFTWARE','MARKETING','OTHER')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  billing_frequency text NOT NULL DEFAULT 'MONTHLY'
    CHECK (billing_frequency IN ('ONE_OFF','MONTHLY','QUARTERLY','ANNUAL')),
  starts_at date NOT NULL DEFAULT current_date,
  renews_at date,
  ends_at date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  reference_url text,
  -- A recurring subscription is an OPERATING cost, not cost of goods sold,
  -- unless an accounting policy says otherwise. Defaulting it to false keeps
  -- gross margin honest; an admin can flag the exceptions.
  counts_as_cogs boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Corrections supersede rather than overwrite, so the audit trail survives.
  superseded_by uuid REFERENCES public.finance_fixed_expenses(id),
  reversal_of uuid REFERENCES public.finance_fixed_expenses(id),
  reversal_reason text
);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_active
  ON public.finance_fixed_expenses(active, category) WHERE superseded_by IS NULL;

COMMENT ON TABLE public.finance_fixed_expenses IS
  'Admin-entered recurring and one-off company costs. Source is always MANUAL and must never be presented alongside measured provider usage without that label.';

ALTER TABLE public.finance_fixed_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_expenses_admin ON public.finance_fixed_expenses
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY fixed_expenses_service ON public.finance_fixed_expenses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Monthly equivalent, so annual and quarterly commitments can be compared and
-- summed with monthly ones.
CREATE OR REPLACE FUNCTION public.finance_monthly_equivalent_cents(
  p_amount_cents integer, p_frequency text
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_frequency
    WHEN 'MONTHLY'   THEN p_amount_cents::numeric
    WHEN 'QUARTERLY' THEN p_amount_cents::numeric / 3
    WHEN 'ANNUAL'    THEN p_amount_cents::numeric / 12
    ELSE 0  -- ONE_OFF has no monthly equivalent; it lands in its own month.
  END;
$fn$;

-- ── Budgets ─────────────────────────────────────────────────
-- NOTE ON THE EXISTING spend_cap_* SETTINGS
--
-- admin_settings already holds spend_cap_openai, spend_cap_global and friends,
-- and those are the LIVE ENFORCEMENT gate read by spend-cap-check and
-- external_discovery_budget_allowed. This table does NOT replace them and does
-- not enforce anything; it is the finance view, with the period, severity and
-- warning threshold that monitoring needs and a scalar setting cannot express.
--
-- It is seeded from those values so the two agree on day one, and
-- finance_budget_status() reports any DRIFT between them rather than letting
-- the duplication hide. Unifying them means changing the enforcement path,
-- which is a separate and riskier change than this one.
CREATE TABLE IF NOT EXISTS public.finance_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  scope text NOT NULL DEFAULT 'PROVIDER'
    CHECK (scope IN ('COMPANY','PROVIDER','PRODUCT')),
  -- NULL scope_value on a COMPANY budget; provider code or product code otherwise.
  scope_value text,
  period text NOT NULL DEFAULT 'MONTH' CHECK (period IN ('DAY','MONTH')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  warn_at_bps integer NOT NULL DEFAULT 8000 CHECK (warn_at_bps BETWEEN 0 AND 10000),
  -- Advisory only. Actual blocking still belongs to the spend-cap path.
  hard_stop boolean NOT NULL DEFAULT false,
  enforcement_setting_key text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_budgets_admin ON public.finance_budgets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY finance_budgets_service ON public.finance_budgets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.finance_budgets (code, label, scope, scope_value, period, amount_cents, warn_at_bps, enforcement_setting_key)
VALUES
  ('COMPANY_MONTH', 'Company monthly spend',   'COMPANY',  NULL,          'MONTH', 25000, 8000, 'spend_cap_global'),
  ('OPENAI_MONTH',  'OpenAI monthly',          'PROVIDER', 'OPENAI',      'MONTH',  1500, 8000, 'spend_cap_openai'),
  ('DATAFORSEO_MONTH','DataForSEO monthly',    'PROVIDER', 'DATAFORSEO',  'MONTH',  4000, 8000, 'spend_cap_dataforseo'),
  ('APIFY_MONTH',   'Apify monthly',           'PROVIDER', 'APIFY',       'MONTH', 10000, 8000, 'spend_cap_apify'),
  ('VERIFY_MONTH',  'Verify provider monthly', 'PRODUCT',  'VERIFY',      'MONTH',  1500, 8000, NULL),
  ('FIND_CLIENTS_MONTH','Find Clients provider monthly','PRODUCT','FIND_CLIENTS','MONTH', 5000, 8000, NULL)
ON CONFLICT (code) DO NOTHING;

-- ── Alerts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  kind text NOT NULL,
  title text NOT NULL,
  detail text,
  -- Dedup key: one open alert per (kind, subject, period). Re-raising the same
  -- condition bumps last_seen_at instead of creating a second row, so an alert
  -- list stays readable during a sustained problem.
  dedupe_key text NOT NULL,
  subject text,
  metric_value numeric,
  threshold_value numeric,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_alerts_open
  ON public.finance_alerts(dedupe_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_finance_alerts_recent
  ON public.finance_alerts(last_seen_at DESC);

ALTER TABLE public.finance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_alerts_admin ON public.finance_alerts
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY finance_alerts_service ON public.finance_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── THE UNIFIED COST FACT STREAM ────────────────────────────
-- One row per measurable unit of provider spend, from whichever source is
-- authoritative for it. Sum this, never the underlying tables.
--
-- NOTE: this view has since been rebuilt three times — on the provider
-- registry (20260911204020), for unconvertible currencies (20260911204211),
-- and for the source-of-truth taxonomy and double-count guard
-- (20260911204617). This is the original two-branch form.
CREATE OR REPLACE VIEW public.finance_cost_facts AS
-- 1. Verify, per stage, priced from the effective-dated price book.
SELECT
  ('verify:' || s.job_id::text || ':' || s.stage)          AS fact_key,
  COALESCE(s.completed_at, j.created_at)                   AS occurred_at,
  'OPENAI'::text                                           AS provider,
  'VERIFY'::text                                           AS product,
  upper(s.stage)                                           AS stage,
  'MODEL_AND_SEARCH'::text                                 AS operation,
  j.user_id                                                AS user_id,
  s.job_id::text                                           AS job_ref,
  s.model                                                  AS model,
  s.total_tokens::numeric                                  AS quantity,
  'TOKENS'::text                                           AS unit,
  s.input_tokens, s.cached_input_tokens, s.output_tokens,
  s.web_searches::integer                                  AS web_searches,
  round(s.model_cost_usd + s.search_cost_usd, 6)           AS cost_usd,
  round(s.model_cost_usd, 6)                               AS model_cost_usd,
  round(s.search_cost_usd, 6)                              AS search_cost_usd,
  'USD'::text                                              AS source_currency,
  round(s.model_cost_usd + s.search_cost_usd, 6)           AS source_amount,
  -- Derived from token counts against the price book, not reported by a bill.
  'PRICE_BOOK'::text                                       AS cost_source,
  (s.price_state <> 'PRICED')                              AS is_unpriced,
  true                                                     AS is_cogs,
  NULL::text                                               AS market,
  false                                                    AS cache_hit
FROM public.verify_stage_cogs s
JOIN public.research_jobs j ON j.id = s.job_id

UNION ALL

-- 2. Everything else, as the provider integrations measured it.
--    VERIFY% is excluded: it is the same money as branch 1.
SELECT
  ('ce:' || ce.id::text)                                   AS fact_key,
  ce."timestamp"                                           AS occurred_at,
  ce.provider::text                                        AS provider,
  CASE
    WHEN ce.operation_type LIKE 'QUEUE_%'
      OR ce.operation_type LIKE 'COLLECT_%'
      OR ce.operation_type LIKE 'DISCOVER_%'
      OR ce.operation_type IN ('SERP_SEARCH','SOURCE_DISCOVERY_MASSIVE','SOURCE_MONITOR_PUBLIC',
                               'FACEBOOK_GROUP_DISCOVERY','EXTERNAL_DISCOVERY_FAILED')
      THEN 'FIND_CLIENTS'
    WHEN ce.operation_type LIKE 'CLASSIFY%' THEN 'FIND_CLIENTS'
    WHEN ce.operation_type LIKE 'DOCUMENT%' THEN 'CONTRACT_INTELLIGENCE'
    ELSE 'PLATFORM'
  END                                                      AS product,
  ce.operation_type                                        AS stage,
  ce.operation_type                                        AS operation,
  p.user_id                                                AS user_id,
  COALESCE(ce.job_id::text, ce.discovery_job_id::text)     AS job_ref,
  NULL::text                                               AS model,
  COALESCE(ce.units, 0)                                    AS quantity,
  'UNITS'::text                                            AS unit,
  NULL::bigint, NULL::bigint, NULL::bigint,
  NULL::integer                                            AS web_searches,
  round(COALESCE(ce.cost_usd, 0), 6)                       AS cost_usd,
  NULL::numeric                                            AS model_cost_usd,
  NULL::numeric                                            AS search_cost_usd,
  'USD'::text                                              AS source_currency,
  round(COALESCE(ce.cost_usd, 0), 6)                       AS source_amount,
  'MEASURED'::text                                         AS cost_source,
  -- Did real work, was not a cache hit, and recorded nothing. That is
  -- unpriced, not free, and must not be summed as zero without saying so.
  (COALESCE(ce.cost_usd, 0) = 0
     AND COALESCE(ce.units, 0) > 0
     AND NOT COALESCE(ce.cache_hit, false))                AS is_unpriced,
  -- MATCH_UNLOCK is a business event that was written to the cost table. It
  -- has no provider spend behind it and must not enter COGS.
  NOT (ce.provider::text = 'OTHER' AND ce.operation_type = 'MATCH_UNLOCK')  AS is_cogs,
  ce.market                                                AS market,
  COALESCE(ce.cache_hit, false)                            AS cache_hit
FROM public.cost_events ce
LEFT JOIN public.properties p ON p.id = ce.property_id
WHERE ce.operation_type NOT LIKE 'VERIFY%';

COMMENT ON VIEW public.finance_cost_facts IS
  'The single summable stream of Homatch provider spend. Verify comes from verify_stage_cogs (token-accurate, price-book priced); everything else from cost_events with VERIFY% excluded so the same money is never counted twice. is_unpriced marks work that happened with no rate behind it; is_cogs excludes business events that were written to the cost table.';

-- Admin-only. No customer may read company COGS.
REVOKE ALL ON public.finance_cost_facts FROM anon, authenticated;
