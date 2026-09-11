-- HOMATCH FINANCE — THE PROVIDER REGISTRY.
--
-- cost_events.provider is an ENUM of seven values. That was fine while every
-- cost came from DataForSEO, Apify or OpenAI, and it is the exact reason a
-- WhatsApp or telephony bill cannot be recorded today without a type migration
-- and a new branch in the dashboard.
--
-- So: providers become ROWS. A new cost source is registered, not coded. The
-- fact stream unions it in, every existing report picks it up, and the UI
-- renders it from its declared capabilities rather than from a switch on its
-- name.
--
-- Registering a provider is NOT pricing it. The slots below for AI calling and
-- email carry no rates, no quotas and no retail price on purpose.

-- ── Categories and units are rows too, so grouping never needs a migration ──
CREATE TABLE IF NOT EXISTS public.finance_provider_categories (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.finance_provider_categories (code, label, sort_order) VALUES
  ('AI_MODEL',        'AI models',                 10),
  ('RESEARCH_SEARCH', 'Search & SERP research',    20),
  ('RESEARCH_SOCIAL', 'Social research',           30),
  ('SCRAPING',        'Scraping & extraction',     40),
  ('ENRICHMENT',      'Data & enrichment',         50),
  ('MESSAGING',       'Messaging channels',        60),
  ('TELEPHONY',       'Telephony',                 70),
  ('AI_VOICE',        'AI voice agents',           80),
  ('SPEECH',          'Speech (STT / TTS)',        90),
  ('INFRASTRUCTURE',  'Infrastructure & hosting', 100),
  ('PAYMENTS',        'Payment processing',       110),
  ('OTHER',           'Other',                    900)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_billing_units (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  -- How many decimals a quantity of this unit is meaningful to. Minutes want
  -- 2, tokens want 0. The UI reads this instead of guessing.
  precision   smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.finance_billing_units (code, label, precision) VALUES
  ('TOKENS',     'Tokens',              0),
  ('REQUESTS',   'Requests',            0),
  ('SEARCHES',   'Searches',            0),
  ('RESULTS',    'Results',             0),
  ('PAGES',      'Pages',               0),
  ('MESSAGES',   'Messages',            0),
  ('SEGMENTS',   'SMS segments',        0),
  ('EMAILS',     'Emails',              0),
  ('MINUTES',    'Minutes',             2),
  ('SECONDS',    'Seconds',             0),
  ('CHARACTERS', 'Characters',          0),
  ('RECORDS',    'Records',             0),
  ('GB',         'Gigabytes',           3),
  ('SEATS',      'Seats',               0),
  ('EVENTS',     'Events',              0),
  ('UNITS',      'Units',               0),
  ('USD',        'Currency (flat fee)', 2)
ON CONFLICT (code) DO NOTHING;

-- ── The registry ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_provider_registry (
  provider_id   text PRIMARY KEY
                CHECK (provider_id ~ '^[A-Z][A-Z0-9_]{1,48}$'),
  provider_name text NOT NULL,
  category      text NOT NULL REFERENCES public.finance_provider_categories(code),
  billing_unit  text NOT NULL REFERENCES public.finance_billing_units(code),
  -- The currency the provider bills us in. Reporting is USD; this is what is
  -- kept alongside so an invoice can still be reconciled in its own money.
  currency      char(3) NOT NULL DEFAULT 'USD',

  -- The four capability flags. These are what the dashboard renders from.
  supports_live_metering          boolean NOT NULL DEFAULT false,
  supports_usage_import           boolean NOT NULL DEFAULT false,
  supports_manual_invoice         boolean NOT NULL DEFAULT true,
  supports_effective_dated_pricing boolean NOT NULL DEFAULT false,

  -- Operational state, kept apart from the capabilities.
  active        boolean NOT NULL DEFAULT true,
  -- A provider can be registered long before it is wired up. Until it is, the
  -- dashboard says NOT CONFIGURED rather than showing a confident zero.
  credentials_present boolean NOT NULL DEFAULT false,
  -- The NAME of the environment variable holding the key. Never the key.
  -- Nothing in this table is a secret and nothing in it may become one.
  credential_env_var  text,

  -- Rendering hints, so a new provider looks deliberate without any UI change.
  icon_key      text,
  accent        text,
  sort_order    integer NOT NULL DEFAULT 100,
  -- Which product this provider's spend belongs to when its events do not say.
  default_product text,
  counts_as_cogs  boolean NOT NULL DEFAULT true,
  notes         text,
  legacy_enum_value text,   -- maps cost_events.provider onto this row
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.finance_provider_registry.credential_env_var IS
  'Name of the env var only. Storing a credential value here is a bug.';

CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_provider_legacy_enum
  ON public.finance_provider_registry (legacy_enum_value)
  WHERE legacy_enum_value IS NOT NULL;

-- Reject anything that looks like a pasted secret, rather than trusting the
-- comment above to be read.
CREATE OR REPLACE FUNCTION public.finance_provider_registry_guard()
RETURNS trigger LANGUAGE plpgsql AS $fn$
begin
  new.updated_at := now();
  if new.credential_env_var is not null and (
       length(new.credential_env_var) > 64
       or new.credential_env_var !~ '^[A-Z][A-Z0-9_]*$') then
    raise exception 'credential_env_var must be an ENV VAR NAME, never a secret value';
  end if;
  return new;
end;
$fn$;

DROP TRIGGER IF EXISTS trg_finance_provider_registry_guard ON public.finance_provider_registry;
CREATE TRIGGER trg_finance_provider_registry_guard
  BEFORE INSERT OR UPDATE ON public.finance_provider_registry
  FOR EACH ROW EXECUTE FUNCTION public.finance_provider_registry_guard();

-- ── What we actually use today ──────────────────────────────
INSERT INTO public.finance_provider_registry
 (provider_id, provider_name, category, billing_unit, currency,
  supports_live_metering, supports_usage_import, supports_manual_invoice,
  supports_effective_dated_pricing, active, credentials_present, credential_env_var,
  icon_key, sort_order, default_product, legacy_enum_value, notes) VALUES
 ('OPENAI','OpenAI','AI_MODEL','TOKENS','USD',
  true,false,true,true,true,true,'OPENAI_API_KEY','brain',10,'VERIFY','OPENAI',
  'Token and web-search cost, priced per stage from the effective-dated price book.'),
 ('APIFY','Apify','SCRAPING','RESULTS','USD',
  true,true,true,false,true,true,'APIFY_TOKEN','robot',20,'FIND_CLIENTS','APIFY',
  'Actor runs for social collection. Per-run cost is measured, not priced.'),
 ('DATAFORSEO','DataForSEO','RESEARCH_SEARCH','SEARCHES','USD',
  true,true,true,false,true,true,'DATAFORSEO_LOGIN','search',30,'FIND_CLIENTS','DATAFORSEO',
  'SERP and search-volume lookups.'),
 ('ZENROWS','ZenRows','SCRAPING','REQUESTS','USD',
  true,false,true,false,false,false,'ZENROWS_API_KEY','shield',40,'FIND_CLIENTS','ZENROWS',NULL),
 ('SCRAPINGBEE','ScrapingBee','SCRAPING','REQUESTS','USD',
  true,false,true,false,false,false,'SCRAPINGBEE_API_KEY','bee',50,'FIND_CLIENTS','SCRAPINGBEE',NULL),
 ('BRIGHTDATA','Bright Data','SCRAPING','GB','USD',
  true,false,true,false,false,false,'BRIGHTDATA_TOKEN','globe',60,'FIND_CLIENTS','BRIGHTDATA',NULL),
 ('OTHER','Unattributed','OTHER','UNITS','USD',
  true,false,true,false,true,true,NULL,'help',890,'PLATFORM','OTHER',
  'Legacy bucket. New costs should register a real provider instead.')
ON CONFLICT (provider_id) DO NOTHING;

-- ── The channels that are coming ────────────────────────────
-- Registered so that adding them later is configuration, not architecture.
-- No rates, no quotas, no retail price: pricing for AI calling and email
-- campaigns is deliberately still absent, and inventing it here would be
-- exactly the thing we were told not to do.
INSERT INTO public.finance_provider_registry
 (provider_id, provider_name, category, billing_unit, currency,
  supports_live_metering, supports_usage_import, supports_manual_invoice,
  supports_effective_dated_pricing, active, credentials_present, credential_env_var,
  icon_key, sort_order, default_product, notes) VALUES
 -- Research channels
 ('TELEGRAM_RESEARCH','Telegram research','RESEARCH_SOCIAL','RESULTS','USD',
  true,true,true,true,false,false,NULL,'send',110,'FIND_CLIENTS',NULL),
 ('META_RESEARCH','Facebook / Instagram research','RESEARCH_SOCIAL','RESULTS','USD',
  true,true,true,true,false,false,NULL,'message-circle',120,'FIND_CLIENTS',NULL),
 ('GOOGLE_RESEARCH','Google research','RESEARCH_SEARCH','SEARCHES','USD',
  true,true,true,true,false,false,NULL,'search',130,'FIND_CLIENTS',NULL),
 ('LINKEDIN_RESEARCH','LinkedIn research','RESEARCH_SOCIAL','RESULTS','USD',
  true,true,true,true,false,false,NULL,'briefcase',140,'FIND_CLIENTS',NULL),
 -- Messaging channels
 ('WHATSAPP','WhatsApp messaging','MESSAGING','MESSAGES','USD',
  true,true,true,true,false,false,NULL,'message-square',210,NULL,
  'Conversation-based pricing varies by country; model it in the price book when wired.'),
 ('SMS','SMS','MESSAGING','SEGMENTS','USD',
  true,true,true,true,false,false,NULL,'smartphone',220,NULL,
  'Billed per segment per destination country.'),
 ('EMAIL','Email delivery','MESSAGING','EMAILS','USD',
  true,true,true,true,false,false,NULL,'mail',230,NULL,
  'Registered only. Email campaign pricing is intentionally not defined yet.'),
 -- Voice
 ('AI_CALL','AI call center','AI_VOICE','MINUTES','USD',
  true,true,true,true,false,false,NULL,'phone-call',310,NULL,
  'Registered only. AI call pricing is intentionally not defined yet.'),
 ('TELEPHONY','Telephony carrier','TELEPHONY','MINUTES','USD',
  true,true,true,true,false,false,NULL,'phone',320,NULL,
  'Carrier minutes and number rental, separate from the AI agent on the call.'),
 ('STT','Speech to text','SPEECH','MINUTES','USD',
  true,true,true,true,false,false,NULL,'mic',330,NULL,NULL),
 ('TTS','Text to speech','SPEECH','CHARACTERS','USD',
  true,true,true,true,false,false,NULL,'volume-2',340,NULL,NULL),
 -- Data
 ('ENRICHMENT','Contact enrichment','ENRICHMENT','RECORDS','USD',
  true,true,true,true,false,false,NULL,'user-search',410,NULL,NULL),
 -- Company infrastructure. These are real money today and were invisible.
 ('SUPABASE','Supabase','INFRASTRUCTURE','USD','USD',
  false,false,true,false,true,true,NULL,'database',510,'PLATFORM',
  'Fixed subscription; record under Fixed Costs.'),
 ('VERCEL','Vercel','INFRASTRUCTURE','USD','USD',
  false,false,true,false,true,true,NULL,'triangle',520,'PLATFORM',NULL),
 ('RAILWAY','Railway','INFRASTRUCTURE','USD','USD',
  false,false,true,false,true,true,NULL,'train',530,'PLATFORM',NULL),
 ('STRIPE','Stripe','PAYMENTS','EVENTS','USD',
  false,true,true,false,false,false,'STRIPE_SECRET_KEY','credit-card',610,'PLATFORM',
  'Processing fees. Imported from payouts, never guessed from a percentage.')
ON CONFLICT (provider_id) DO NOTHING;

-- ── Operation -> product mapping, also rows ─────────────────
-- Replaces the CASE expression that was hardcoded inside finance_cost_facts.
CREATE TABLE IF NOT EXISTS public.finance_operation_map (
  id            bigserial PRIMARY KEY,
  match_pattern text NOT NULL,            -- SQL LIKE, matched against operation
  product_code  text NOT NULL,
  priority      integer NOT NULL DEFAULT 100,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_operation_map
  ON public.finance_operation_map (match_pattern);

INSERT INTO public.finance_operation_map (match_pattern, product_code, priority) VALUES
  ('VERIFY%',        'VERIFY',                 10),
  ('QUEUE_%',        'FIND_CLIENTS',           20),
  ('DISCOVER%',      'FIND_CLIENTS',           20),
  ('COLLECT%',       'FIND_CLIENTS',           20),
  ('SOURCE_%',       'FIND_CLIENTS',           20),
  ('CLASSIFY%',      'FIND_CLIENTS',           20),
  ('FACEBOOK_%',     'FIND_CLIENTS',           20),
  ('SERP_%',         'FIND_CLIENTS',           20),
  ('MATCH_UNLOCK',   'FIND_CLIENTS',           20),
  ('DOCUMENT%',      'CONTRACT_INTELLIGENCE',  20),
  ('CONTRACT%',      'CONTRACT_INTELLIGENCE',  20),
  ('BROKER%',        'BROKER_FINDER',          20),
  ('CALL_%',         'AI_CALL',                20),
  ('EMAIL_%',        'EMAIL_CAMPAIGN',         20),
  ('WHATSAPP_%',     'WHATSAPP',               20),
  ('SMS_%',          'SMS',                    20)
ON CONFLICT (match_pattern) DO NOTHING;

CREATE OR REPLACE FUNCTION public.finance_product_for_operation(
  p_operation text, p_default text DEFAULT 'PLATFORM'
) RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT m.product_code FROM public.finance_operation_map m
      WHERE m.active AND p_operation LIKE m.match_pattern
      ORDER BY m.priority, length(m.match_pattern) DESC LIMIT 1),
    p_default, 'PLATFORM');
$fn$;

-- ── Generic cost ledger for every registered provider ───────
-- The enum-free path. Anything registered can record cost here without a type
-- change, and it lands in the same fact stream as everything else.
CREATE TABLE IF NOT EXISTS public.finance_provider_cost_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  text NOT NULL REFERENCES public.finance_provider_registry(provider_id),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  product_code text,
  operation    text NOT NULL DEFAULT 'USAGE',
  -- Who and what it was for, when that is known.
  user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  job_ref      text,
  market       text,
  -- The measurement.
  quantity     numeric(20,6) NOT NULL DEFAULT 0,
  unit         text REFERENCES public.finance_billing_units(code),
  -- The money, in the provider's own currency and in USD.
  source_currency char(3) NOT NULL DEFAULT 'USD',
  source_amount   numeric(20,6),
  cost_usd        numeric(20,6),
  -- MEASURED (the provider told us), PRICE_BOOK (we priced the quantity),
  -- IMPORTED (from a usage export), INVOICE (from a bill), UNPRICED.
  cost_source  text NOT NULL DEFAULT 'MEASURED'
               CHECK (cost_source IN ('MEASURED','PRICE_BOOK','IMPORTED','INVOICE','ESTIMATED','UNPRICED')),
  counts_as_cogs boolean,
  cache_hit    boolean NOT NULL DEFAULT false,
  success      boolean NOT NULL DEFAULT true,
  -- Idempotency for imports and retries.
  external_ref text,
  import_batch uuid,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_pce_external
  ON public.finance_provider_cost_events (provider_id, external_ref)
  WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_pce_time ON public.finance_provider_cost_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_pce_provider ON public.finance_provider_cost_events (provider_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_pce_user ON public.finance_provider_cost_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_pce_job ON public.finance_provider_cost_events (job_ref) WHERE job_ref IS NOT NULL;

-- ── Generic effective-dated price book ──────────────────────
-- Only consulted for providers that declare supports_effective_dated_pricing.
CREATE TABLE IF NOT EXISTS public.finance_provider_prices (
  id             bigserial PRIMARY KEY,
  provider_id    text NOT NULL REFERENCES public.finance_provider_registry(provider_id) ON DELETE CASCADE,
  operation      text NOT NULL DEFAULT '*',
  market         text NOT NULL DEFAULT '*',
  unit           text NOT NULL REFERENCES public.finance_billing_units(code),
  unit_cost      numeric(20,10) NOT NULL CHECK (unit_cost >= 0),
  currency       char(3) NOT NULL DEFAULT 'USD',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_finance_provider_prices_lookup
  ON public.finance_provider_prices (provider_id, operation, market, effective_from DESC);

CREATE OR REPLACE FUNCTION public.finance_provider_unit_cost(
  p_provider text, p_operation text DEFAULT '*', p_market text DEFAULT '*',
  p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT public.fx_to_usd(p.unit_cost, p.currency, p_at)
    FROM public.finance_provider_prices p
   WHERE p.provider_id = p_provider
     AND p.effective_from <= p_at
     AND (p.effective_to IS NULL OR p.effective_to > p_at)
     AND (p.operation = '*' OR p.operation = COALESCE(p_operation,'*'))
     AND (p.market = '*' OR p.market = COALESCE(p_market,'*'))
   -- Most specific match wins: exact operation beats wildcard, then latest.
   ORDER BY (p.operation <> '*') DESC, (p.market <> '*') DESC, p.effective_from DESC
   LIMIT 1;
$fn$;

-- ── Manual provider invoices ────────────────────────────────
-- For providers that only ever hand us a bill. Variable, so not a fixed cost.
CREATE TABLE IF NOT EXISTS public.finance_provider_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    text NOT NULL REFERENCES public.finance_provider_registry(provider_id),
  period_start   date NOT NULL,
  period_end     date NOT NULL CHECK (period_end >= period_start),
  invoice_ref    text,
  source_currency char(3) NOT NULL DEFAULT 'USD',
  source_amount  numeric(20,6) NOT NULL CHECK (source_amount >= 0),
  counts_as_cogs boolean NOT NULL DEFAULT true,
  product_code   text,
  -- Metered spend already recorded for the same period. An invoice that is
  -- far from the meter is the most valuable alert this system can raise.
  note           text,
  -- Corrections are new rows, never edits.
  reversal_of    uuid REFERENCES public.finance_provider_invoices(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_provider_invoice_ref
  ON public.finance_provider_invoices (provider_id, invoice_ref)
  WHERE invoice_ref IS NOT NULL;

-- ── Lock it all down: admin only, like the rest of finance ──
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'finance_provider_categories','finance_billing_units','finance_provider_registry',
    'finance_operation_map','finance_provider_cost_events','finance_provider_prices',
    'finance_provider_invoices'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format($p$DROP POLICY IF EXISTS %I ON public.%I$p$, tbl || '_admin', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      tbl || '_admin', tbl);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.finance_operation_map_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.finance_provider_prices_id_seq TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.finance_product_for_operation(text, text)',
    'public.finance_provider_unit_cost(text, text, text, timestamptz)',
    'public.finance_provider_registry_guard()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
