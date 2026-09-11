-- PROVIDER ACCESS AND BILLING AUDIT LAYER.
--
-- Built from what the live system actually proved, not from what the code
-- mentions. The audit found, among other things, that the two voice providers
-- named in the brief are not integrated at all, that two scrapers pass live
-- credential tests but produce no cost events, and that every outreach cost
-- write is being silently rejected by the provider enum.

-- ── A. Access classification, per the audit taxonomy ────────
DO $$ BEGIN
  CREATE TYPE public.finance_access_level AS ENUM
    ('NONE','PARTIAL','FULL','CALCULATED','PERMISSION_MISSING','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_access_status AS ENUM (
    'CONNECTED_BILLING_ACCESS',
    'CONNECTED_USAGE_ACCESS',
    'CONNECTED_LOCAL_COST_CALCULATION',
    'CONNECTED_BILLING_PERMISSION_MISSING',
    'CONNECTED_SERVICE_ONLY',
    'NOT_CONFIGURED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.finance_provider_registry
  ADD COLUMN IF NOT EXISTS supports_provider_reported_cost boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_invoice_import boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_manual_cost boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_access public.finance_access_level NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS usage_access   public.finance_access_level NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS billing_access public.finance_access_level NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS invoice_access public.finance_access_level NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS access_status  public.finance_access_status NOT NULL DEFAULT 'NOT_CONFIGURED',
  -- The exact permission that is missing, so the final report can ask for one
  -- specific thing instead of "more access".
  ADD COLUMN IF NOT EXISTS missing_permission text,
  -- Whether the credential Homatch itself holds is enough, as distinct from
  -- what an operator can read from their own console.
  ADD COLUMN IF NOT EXISTS credential_sufficient boolean,
  ADD COLUMN IF NOT EXISTS homatch_use text,
  ADD COLUMN IF NOT EXISTS default_cost_source text,
  -- Reuse of the existing provider_health table rather than a second one.
  ADD COLUMN IF NOT EXISTS health_key text,
  ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'LOCAL_METERING'
      CHECK (sync_mode IN ('WEBHOOK','LIVE_EVENT','PERIODIC_SYNC','USAGE_IMPORT',
                           'INVOICE_IMPORT','LOCAL_METERING','MANUAL_ENTRY','NONE')),
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 1440,
  -- After this long with no data, the dashboard says COST DATA STALE rather
  -- than showing an old number as though it were current.
  ADD COLUMN IF NOT EXISTS stale_after_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS rate_limited_until timestamptz;

-- ── B. One source of truth per cost event ───────────────────
ALTER TABLE public.finance_provider_cost_events
  DROP CONSTRAINT IF EXISTS finance_provider_cost_events_cost_source_check;
ALTER TABLE public.finance_provider_cost_events
  ADD CONSTRAINT finance_provider_cost_events_cost_source_check
  CHECK (cost_source IN ('PROVIDER_REPORTED','MEASURED','CALCULATED','ALLOCATED',
                         'MANUAL','ESTIMATED','UNPRICED','IMPORTED','INVOICE','PRICE_BOOK'));

-- ── C. Double-count prevention, and charges that are not executions ──
ALTER TABLE public.finance_provider_cost_events
  -- WHO ACTUALLY BILLED US. With bring-your-own keys an orchestrator reports a
  -- component it never charged for; the model cost belongs to whoever sent the
  -- invoice. When this differs from provider_id the row is attribution only.
  ADD COLUMN IF NOT EXISTS billed_by_provider_id text
      REFERENCES public.finance_provider_registry(provider_id),
  ADD COLUMN IF NOT EXISTS component text,
  ADD COLUMN IF NOT EXISTS parent_event_id uuid REFERENCES public.finance_provider_cost_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS charge_class text NOT NULL DEFAULT 'EXECUTION'
      CHECK (charge_class IN ('EXECUTION','SUBSCRIPTION','COMMITMENT','RENTAL',
                              'STORAGE','EGRESS','OVERAGE','TAX','PLATFORM_FEE','CREDIT'));

-- The guard itself. A component row whose real biller is somebody else is
-- recorded for the breakdown but must never be added to company spend twice.
ALTER TABLE public.finance_provider_cost_events
  ADD COLUMN IF NOT EXISTS is_double_count_guard boolean
      GENERATED ALWAYS AS (billed_by_provider_id IS NOT NULL
                           AND billed_by_provider_id <> provider_id) STORED;

CREATE INDEX IF NOT EXISTS idx_finance_pce_parent
  ON public.finance_provider_cost_events (parent_event_id) WHERE parent_event_id IS NOT NULL;

-- ── D. Reconciliation: local meter against the provider's own total ──
CREATE TABLE IF NOT EXISTS public.finance_reconciliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   text NOT NULL REFERENCES public.finance_provider_registry(provider_id),
  period_start  date NOT NULL,
  period_end    date NOT NULL CHECK (period_end >= period_start),
  local_usd     numeric(20,6),
  provider_usd  numeric(20,6),
  delta_usd     numeric(20,6) GENERATED ALWAYS AS (COALESCE(provider_usd,0) - COALESCE(local_usd,0)) STORED,
  tolerance_bps integer NOT NULL DEFAULT 200,
  status        text NOT NULL DEFAULT 'INCOMPLETE'
                CHECK (status IN ('MATCHED','WITHIN_TOLERANCE','MISMATCH','INCOMPLETE','UNAVAILABLE')),
  note          text,
  -- Deliberately NOT a correction mechanism. Reconciling never edits the
  -- underlying events; a real difference is booked as its own adjustment.
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_recon_period
  ON public.finance_reconciliations (provider_id, period_start, period_end);

ALTER TABLE public.finance_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_reconciliations FROM anon, authenticated;
GRANT ALL ON public.finance_reconciliations TO service_role;
DROP POLICY IF EXISTS finance_reconciliations_admin ON public.finance_reconciliations;
CREATE POLICY finance_reconciliations_admin ON public.finance_reconciliations
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── E. The audit's findings, recorded ───────────────────────
UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='FULL', billing_access='CALCULATED', invoice_access='NONE',
  access_status='CONNECTED_LOCAL_COST_CALCULATION',
  supports_provider_reported_cost=false, supports_manual_cost=true, supports_invoice_import=true,
  credential_sufficient=true, default_cost_source='CALCULATED',
  health_key='OPENAI', sync_mode='LOCAL_METERING', stale_after_hours=24,
  homatch_use='Verify research stages, signal classification, content generation.',
  missing_permission=null,
  notes='Token and web-search cost is metered per stage locally and priced from the effective-dated price book. OpenAI exposes no per-key billing API, so the local calculation is the accounting source and must not be double-counted against a platform invoice.'
WHERE provider_id='OPENAI';

UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='FULL', billing_access='PARTIAL', invoice_access='NONE',
  access_status='CONNECTED_USAGE_ACCESS',
  supports_provider_reported_cost=true, credential_sufficient=true,
  default_cost_source='PROVIDER_REPORTED', health_key='DATAFORSEO',
  sync_mode='LIVE_EVENT', stale_after_hours=72,
  homatch_use='SERP and search lookups for client discovery.',
  notes='Each response carries its own cost, which is what we book. Account-level billing totals are not read.'
WHERE provider_id='DATAFORSEO';

UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='PARTIAL', billing_access='PARTIAL', invoice_access='NONE',
  access_status='CONNECTED_USAGE_ACCESS',
  supports_provider_reported_cost=true, supports_usage_import=true, credential_sufficient=true,
  default_cost_source='PROVIDER_REPORTED', health_key='APIFY',
  sync_mode='LIVE_EVENT', stale_after_hours=72,
  homatch_use='Actor runs collecting Facebook, Telegram, Threads and Reddit signals.',
  missing_permission=null,
  notes='Cost is captured on actor runs but the discovery path writes zero-cost rows, which is the bulk of the unpriced backlog. Apify usage is readable with the existing token and should be imported to close it.'
WHERE provider_id='APIFY';

-- Both pass a live credential test but have never produced a cost event.
UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='NONE', billing_access='NONE', invoice_access='NONE',
  access_status='CONNECTED_SERVICE_ONLY', active=true, credentials_present=true,
  credential_sufficient=true, default_cost_source='UNPRICED',
  health_key=provider_id, sync_mode='NONE',
  homatch_use='Configured fallback scraper. Not currently on any execution path.',
  notes='Live credential test passes, but no cost event has ever been recorded. Either it is genuinely unused or its usage is unmetered.'
WHERE provider_id IN ('ZENROWS','SCRAPINGBEE');

UPDATE public.finance_provider_registry SET
  service_access='NONE', usage_access='NONE', billing_access='NONE', invoice_access='NONE',
  access_status='NOT_CONFIGURED', active=false, credentials_present=false,
  credential_sufficient=false, health_key='BRIGHTDATA', sync_mode='NONE',
  notes='Credential absent. Live test reports NOT_CONFIGURED.'
WHERE provider_id='BRIGHTDATA';

UPDATE public.finance_provider_registry SET
  service_access='NONE', usage_access='NONE', billing_access='NONE', invoice_access='NONE',
  access_status='NOT_CONFIGURED', active=false, credentials_present=false,
  credential_sufficient=false, health_key='STRIPE', sync_mode='INVOICE_IMPORT',
  supports_invoice_import=true,
  homatch_use='Payment processing. No revenue can be collected until configured.',
  missing_permission='PAYMENT_PROVIDER_SECRET (and PAYMENT_WEBHOOK_SECRET) are not set. Until then revenue reads as NOT CONFIGURED rather than zero.',
  notes='Live test reports NOT_CONFIGURED. Processing fees must be imported from payouts, never estimated as a percentage.'
WHERE provider_id='STRIPE';

-- Infrastructure: plans verified directly against each platform.
UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='PARTIAL', billing_access='PERMISSION_MISSING', invoice_access='NONE',
  access_status='CONNECTED_BILLING_PERMISSION_MISSING',
  supports_manual_cost=true, supports_invoice_import=true, credential_sufficient=false,
  default_cost_source='MANUAL', sync_mode='MANUAL_ENTRY',
  homatch_use='Database, auth, storage and every edge function.',
  missing_permission='Homatch holds only the project service-role key, which is NOT billing access. A Supabase Management API PAT scoped to read organization billing would be required for automated ingestion.',
  notes='Organization plan verified directly as FREE, so the current fixed cost is $0. A service-role key must never be treated as billing access.'
WHERE provider_id='SUPABASE';

UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='PARTIAL', billing_access='PERMISSION_MISSING', invoice_access='NONE',
  access_status='CONNECTED_BILLING_PERMISSION_MISSING',
  credential_sufficient=false, default_cost_source='MANUAL', sync_mode='MANUAL_ENTRY',
  homatch_use='Frontend hosting, deployed from the GitHub repository.',
  missing_permission='Homatch stores no Vercel token at all. A read-only Vercel API token would be required for automated billing ingestion.',
  notes='Team plan verified directly as HOBBY, so the current fixed cost is $0.'
WHERE provider_id='VERCEL';

UPDATE public.finance_provider_registry SET
  service_access='FULL', usage_access='FULL', billing_access='PERMISSION_MISSING', invoice_access='NONE',
  access_status='CONNECTED_BILLING_PERMISSION_MISSING',
  credential_sufficient=false, default_cost_source='ALLOCATED', sync_mode='MANUAL_ENTRY',
  billing_unit='USD',
  homatch_use='Background workers: homatch-official-worker, homatch-official-worker-v2.',
  missing_permission='Homatch stores no Railway token. A Railway API token with project read access would allow CPU, memory, egress and volume usage to be ingested automatically.',
  notes='Per-service usage metrics are readable and were sampled during the audit; both workers are near-idle. Usage-based cost cannot be stated without billing access.'
WHERE provider_id='RAILWAY';

-- Registered from the audit: real adapters exist, credentials were never set.
INSERT INTO public.finance_provider_registry
 (provider_id, provider_name, category, billing_unit, currency,
  supports_live_metering, supports_usage_import, supports_manual_invoice,
  supports_effective_dated_pricing, supports_provider_reported_cost, supports_invoice_import,
  active, credentials_present, credential_env_var, icon_key, sort_order,
  service_access, usage_access, billing_access, invoice_access, access_status,
  credential_sufficient, default_cost_source, health_key, sync_mode, homatch_use, notes) VALUES
 ('RESEND','Resend','MESSAGING','EMAILS','USD',
  true,true,true,true,false,true,false,false,'RESEND_API_KEY','mail',230,
  'NONE','NONE','NONE','NONE','NOT_CONFIGURED',false,'CALCULATED','RESEND','LOCAL_METERING',
  'Outreach email delivery. A real adapter exists behind an admin flag.',
  'Live test reports NOT_CONFIGURED. Keep the monthly subscription separate from per-email COGS when it is wired.'),
 ('TWILIO','Twilio','MESSAGING','SEGMENTS','USD',
  true,true,true,true,false,true,false,false,'TWILIO_AUTH_TOKEN','smartphone',220,
  'UNKNOWN','NONE','NONE','NONE','NOT_CONFIGURED',false,'CALCULATED','TWILIO','LOCAL_METERING',
  'Outreach SMS. A real adapter exists behind an admin flag.',
  'Never covered by the existing health check, so its credential has never been tested. Number rental is a rental charge, not an execution cost.'),
 ('RETELL','Retell AI','AI_VOICE','MINUTES','USD',
  true,true,true,true,true,true,false,false,'RETELL_API_KEY','phone-call',310,
  'UNKNOWN','NONE','NONE','NONE','NOT_CONFIGURED',false,'PROVIDER_REPORTED','RETELL','WEBHOOK',
  'AI calling. A real adapter and a webhook endpoint both exist.',
  'This, not Vapi, is the voice provider this codebase integrates. Call pricing is deliberately still undefined. If it ever runs on bring-your-own model or voice keys, the component billed by someone else must be attributed to them.'),
 ('GEMINI','Google Gemini','AI_MODEL','TOKENS','USD',
  true,false,true,true,false,false,false,false,'GEMINI_API_KEY','sparkles',15,
  'UNKNOWN','NONE','NONE','NONE','NOT_CONFIGURED',false,'CALCULATED','GEMINI','LOCAL_METERING',
  'Referenced as an alternative model provider.',
  'Referenced in code but no live endpoint call was found during the audit.')
ON CONFLICT (provider_id) DO NOTHING;

-- Named in the brief, absent from the system. Registered so the dashboard can
-- say so plainly rather than leaving a reader to assume they are running.
INSERT INTO public.finance_provider_registry
 (provider_id, provider_name, category, billing_unit, currency,
  supports_live_metering, supports_usage_import, supports_manual_invoice,
  supports_effective_dated_pricing, supports_provider_reported_cost,
  active, credentials_present, icon_key, sort_order,
  service_access, usage_access, billing_access, invoice_access, access_status,
  credential_sufficient, default_cost_source, sync_mode, homatch_use, notes) VALUES
 ('VAPI','Vapi','AI_VOICE','MINUTES','USD',
  true,true,true,true,true,false,false,'phone-call',315,
  'NONE','NONE','NONE','NONE','NOT_CONFIGURED',false,'PROVIDER_REPORTED','WEBHOOK',
  'Not integrated.',
  'Appears only as a value in a TypeScript union. No adapter, no endpoint, no credential. Retell is the voice provider actually implemented.'),
 ('CARTESIA','Cartesia','SPEECH','CHARACTERS','USD',
  true,true,true,true,false,false,false,'volume-2',340,
  'NONE','NONE','NONE','NONE','NOT_CONFIGURED',false,'CALCULATED','LOCAL_METERING',
  'Not integrated.',
  'A single incidental reference in the repository. No adapter, no endpoint, no credential.')
ON CONFLICT (provider_id) DO NOTHING;

UPDATE public.finance_provider_registry
   SET health_key = COALESCE(health_key, provider_id),
       default_cost_source = COALESCE(default_cost_source, 'UNPRICED')
 WHERE health_key IS NULL OR default_cost_source IS NULL;

-- Credential names are corrected against what the code actually reads in
-- 20260911212850 and 20260911212930.
