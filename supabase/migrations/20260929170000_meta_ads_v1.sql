-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH — META ADS v1: the complete data domain.
--
-- Customer-simple, admin-deep, backend-strict. Everything here follows the
-- three product principles: complexity belongs to HOMATCH; the customer is
-- never forced to make a technical decision HOMATCH can make safely; Meta
-- capabilities are never invented — unavailable actions are GATED, and the
-- gate is visible in Admin.
--
-- Money: advertising funds are a SEPARATE financial domain from Credits
-- (Credits are the PAYG intelligence currency; ad money is client funds
-- HOMATCH holds against media spend + a management fee). Immutable ledger,
-- balances derived by view, idempotent writes, reservations as rows.
--
-- Tokens: meta_tokens has NO user-facing policy at all. Access tokens are
-- reachable only by service_role (edge functions). Nothing in a browser
-- can select them.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. CONNECTION + TOKENS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED','CONNECTED','EXPIRED','REVOKED','ERROR')),
  meta_user_external_id text,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  token_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_connections_own ON public.meta_connections
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_connections_service ON public.meta_connections
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- The secret half. SERVICE ROLE ONLY: no user policy exists on purpose,
-- so RLS denies every non-service read and write outright.
CREATE TABLE IF NOT EXISTS public.meta_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  token_type text NOT NULL DEFAULT 'bearer',
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_tokens_service ON public.meta_tokens
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Businesses, Pages, Instagram identities, Ad Accounts, tracking assets —
-- one shape, discovered from Meta, never fabricated locally.
CREATE TABLE IF NOT EXISTS public.meta_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('BUSINESS','PAGE','INSTAGRAM','AD_ACCOUNT','PIXEL')),
  external_id text NOT NULL,
  name text,
  parent_external_id text,
  status text NOT NULL DEFAULT 'ACTIVE',
  selected boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_meta_assets_user_kind ON public.meta_assets(user_id, kind);
ALTER TABLE public.meta_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_assets_own ON public.meta_assets
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_assets_select_own_update ON public.meta_assets
  FOR UPDATE USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_assets_service ON public.meta_assets
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 2. CAMPAIGNS ─────────────────────────────────────────────────────────
-- The customer's campaign, with an explicit lifecycle state machine.
-- `plan` is the Strategy Engine's TYPED output (validated in code before
-- it is ever stored); the external Meta topology lives in meta_ad_entities.

CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  property_id text,                       -- HOMATCH property (six-digit id) or NULL
  offer jsonb,                            -- independent offer snapshot (Path B)
  goal text NOT NULL CHECK (goal IN
    ('LEADS_ON_META','LEADS_ON_WEBSITE','SITE_REGISTRATIONS','ENGAGEMENT','MESSAGES','PROMOTE')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','CONNECTION_REQUIRED','CREATIVE_REQUIRED','AUDIENCE_REQUIRED',
     'PREFLIGHT_REQUIRED','NEEDS_CHANGES','MANUAL_REVIEW','READY',
     'PAYMENT_REQUIRED','LAUNCHING','SUBMITTED','META_REVIEW','ACTIVE',
     'PAUSED','COMPLETED','REJECTED','FAILED','ARCHIVED')),
  special_ad_categories text[] NOT NULL DEFAULT '{}',
  objective text,                         -- mapped Meta objective (adapter-owned)
  daily_budget_cents bigint CHECK (daily_budget_cents IS NULL OR daily_budget_cents > 0),
  duration_days integer CHECK (duration_days IS NULL OR duration_days >= 2),
  currency text NOT NULL DEFAULT 'USD',
  start_at timestamptz,
  destination jsonb,                      -- {type:'META_FORM'|'WEBSITE'|'HOMATCH_PAGE', url?...}
  audience_id uuid,                       -- FK added after meta_audiences below
  placements jsonb NOT NULL DEFAULT '{"mode":"RECOMMENDED"}'::jsonb,
  plan jsonb,                             -- typed strategy plan (internal)
  plan_version text,
  preflight jsonb,                        -- {status, checks:[...], checked_at}
  external_campaign_id text,
  external_status text,
  launch_idempotency_key text UNIQUE,
  spend_cents bigint NOT NULL DEFAULT 0,
  results jsonb,                          -- latest normalized insight snapshot
  last_synced_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_user ON public.meta_campaigns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_status ON public.meta_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_external ON public.meta_campaigns(external_campaign_id) WHERE external_campaign_id IS NOT NULL;
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_campaigns_select ON public.meta_campaigns
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
-- Drafting is a client action; every state that talks to Meta or money is
-- server-side. The trigger below stops a browser from writing those fields.
CREATE POLICY meta_campaigns_insert ON public.meta_campaigns
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_campaigns_update ON public.meta_campaigns
  FOR UPDATE USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_campaigns_service ON public.meta_campaigns
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- SERVER-OWNED FIELDS. A browser session may edit its draft, but external
-- identity, money, preflight verdicts and lifecycle states beyond the draft
-- family are written only under service_role.
CREATE OR REPLACE FUNCTION public.meta_campaigns_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'META_ADS_CLIENT_STATUS'; END IF;
    NEW.external_campaign_id := NULL; NEW.external_status := NULL;
    NEW.launch_idempotency_key := NULL; NEW.spend_cents := 0;
    NEW.preflight := NULL; NEW.results := NULL; NEW.plan := NULL; NEW.plan_version := NULL;
    RETURN NEW;
  END IF;
  IF NEW.external_campaign_id IS DISTINCT FROM OLD.external_campaign_id
     OR NEW.external_status IS DISTINCT FROM OLD.external_status
     OR NEW.launch_idempotency_key IS DISTINCT FROM OLD.launch_idempotency_key
     OR NEW.spend_cents IS DISTINCT FROM OLD.spend_cents
     OR NEW.preflight IS DISTINCT FROM OLD.preflight
     OR NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.results IS DISTINCT FROM OLD.results THEN
    RAISE EXCEPTION 'META_ADS_SERVER_FIELD';
  END IF;
  -- The browser may move only between pre-launch editing states.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN
     ('DRAFT','CONNECTION_REQUIRED','CREATIVE_REQUIRED','AUDIENCE_REQUIRED',
      'PREFLIGHT_REQUIRED','ARCHIVED') THEN
    RAISE EXCEPTION 'META_ADS_CLIENT_STATUS';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_meta_campaigns_guard ON public.meta_campaigns;
CREATE TRIGGER trg_meta_campaigns_guard
  BEFORE INSERT OR UPDATE ON public.meta_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.meta_campaigns_guard();

-- The real external topology (ad sets, ads, creatives as Meta sees them).
-- Customer never needs this; Admin sees all of it.
CREATE TABLE IF NOT EXISTS public.meta_ad_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('AD_SET','AD','CREATIVE')),
  external_id text NOT NULL,
  name text,
  status text,
  config jsonb,
  metrics jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, kind, external_id)
);
ALTER TABLE public.meta_ad_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_ad_entities_select ON public.meta_ad_entities
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.meta_campaigns c
      WHERE c.id = campaign_id AND c.user_id = public.auth_user_id())
  );
CREATE POLICY meta_ad_entities_service ON public.meta_ad_entities
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 3. CREATIVES ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'IMAGE' CHECK (kind IN ('IMAGE','VIDEO','CAROUSEL')),
  media jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{path,mime,width?,height?,order}]
  headline text NOT NULL DEFAULT '',
  primary_text text NOT NULL DEFAULT '',
  cta text NOT NULL DEFAULT 'LEARN_MORE',
  destination_url text,
  safety_status text NOT NULL DEFAULT 'PENDING'
    CHECK (safety_status IN ('PENDING','READY','NEEDS_CHANGES','BLOCKED','MANUAL_REVIEW')),
  safety jsonb,
  external_creative_id text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_creatives_user ON public.meta_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_creatives_campaign ON public.meta_creatives(campaign_id);
ALTER TABLE public.meta_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_creatives_own ON public.meta_creatives
  FOR ALL USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_creatives_admin ON public.meta_creatives
  FOR SELECT USING (public.is_admin());
CREATE POLICY meta_creatives_service ON public.meta_creatives
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Safety verdicts are server-owned.
CREATE OR REPLACE FUNCTION public.meta_creatives_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.safety_status := 'PENDING'; NEW.safety := NULL; NEW.external_creative_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.safety IS DISTINCT FROM OLD.safety
     OR NEW.external_creative_id IS DISTINCT FROM OLD.external_creative_id THEN
    RAISE EXCEPTION 'META_ADS_SERVER_FIELD';
  END IF;
  -- Any content edit sends the creative back through preflight.
  IF NEW.headline IS DISTINCT FROM OLD.headline
     OR NEW.primary_text IS DISTINCT FROM OLD.primary_text
     OR NEW.media IS DISTINCT FROM OLD.media
     OR NEW.destination_url IS DISTINCT FROM OLD.destination_url THEN
    NEW.safety_status := 'PENDING';
  ELSIF NEW.safety_status IS DISTINCT FROM OLD.safety_status THEN
    RAISE EXCEPTION 'META_ADS_SERVER_FIELD';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_meta_creatives_guard ON public.meta_creatives;
CREATE TRIGGER trg_meta_creatives_guard
  BEFORE INSERT OR UPDATE ON public.meta_creatives
  FOR EACH ROW EXECUTE FUNCTION public.meta_creatives_guard();

-- Private media bucket, sender-prefixed, same discipline as live-chat-media.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('meta-ads-media','meta-ads-media', false, 52428800,
        ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
ON CONFLICT (id) DO UPDATE
  SET public=false, file_size_limit=EXCLUDED.file_size_limit,
      allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS meta_ads_media_upload ON storage.objects;
CREATE POLICY meta_ads_media_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id='meta-ads-media'
    AND (storage.foldername(name))[1] = public.auth_user_id()::text);
DROP POLICY IF EXISTS meta_ads_media_read ON storage.objects;
CREATE POLICY meta_ads_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id='meta-ads-media'
    AND ((storage.foldername(name))[1] = public.auth_user_id()::text OR public.is_admin()));

-- ── 4. LEADS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'META_LEADGEN' CHECK (source IN ('META_LEADGEN','IMPORT')),
  external_lead_id text,
  form_external_id text,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','CONTACTED','INTERESTED','NOT_INTERESTED','CLOSED')),
  note text,
  import_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Webhook idempotency: one external lead lands once per owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_leads_external
  ON public.meta_leads(user_id, external_lead_id) WHERE external_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_leads_user ON public.meta_leads(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_leads_campaign ON public.meta_leads(campaign_id);
ALTER TABLE public.meta_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_leads_select ON public.meta_leads
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_leads_update ON public.meta_leads
  FOR UPDATE USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_leads_service ON public.meta_leads
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Owner may edit their pipeline (status/note), never the lead's identity.
CREATE OR REPLACE FUNCTION public.meta_leads_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.fields IS DISTINCT FROM OLD.fields
     OR NEW.external_lead_id IS DISTINCT FROM OLD.external_lead_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'META_ADS_SERVER_FIELD';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_meta_leads_guard ON public.meta_leads;
CREATE TRIGGER trg_meta_leads_guard
  BEFORE UPDATE ON public.meta_leads
  FOR EACH ROW EXECUTE FUNCTION public.meta_leads_guard();

CREATE TABLE IF NOT EXISTS public.meta_lead_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  mapping jsonb,
  consent_confirmed_at timestamptz,
  consent_version text,
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','READY','FAILED')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_lead_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_lead_imports_select ON public.meta_lead_imports
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_lead_imports_service ON public.meta_lead_imports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Export audit (who exported what, when — content never stored here).
CREATE TABLE IF NOT EXISTS public.meta_lead_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filter jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_lead_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_lead_exports_select ON public.meta_lead_exports
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_lead_exports_service ON public.meta_lead_exports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 5. AUDIENCES ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL CHECK (source IN
    ('UPLOADED_LIST','HOMATCH_LEADS','CAMPAIGN_LEADS','WEBSITE_VISITORS')),
  source_ref jsonb,                        -- {import_id | campaign_id | ...}
  known_record_count integer,              -- OUR rows only; never a Meta estimate we do not have
  external_audience_id text,
  ad_account_external_id text,
  sync_status text NOT NULL DEFAULT 'LOCAL'
    CHECK (sync_status IN ('LOCAL','CREATING','READY','FAILED','DELETED')),
  version integer NOT NULL DEFAULT 1,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
ALTER TABLE public.meta_audiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_audiences_select ON public.meta_audiences
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_audiences_service ON public.meta_audiences
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Custom Audience terms: stored per (user, ad account) with evidence; asked
-- again only when Meta actually requires it (version/context change).
CREATE TABLE IF NOT EXISTS public.meta_audience_terms (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ad_account_external_id text NOT NULL,
  terms_version text NOT NULL DEFAULT 'v1',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb,
  PRIMARY KEY (user_id, ad_account_external_id, terms_version)
);
ALTER TABLE public.meta_audience_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_audience_terms_own ON public.meta_audience_terms
  FOR ALL USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY meta_audience_terms_admin ON public.meta_audience_terms
  FOR SELECT USING (public.is_admin());
CREATE POLICY meta_audience_terms_service ON public.meta_audience_terms
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 6. MONEY — the Meta Ads financial domain ────────────────────────────
-- NOT Credits. An immutable ledger; balances are views over it; the fee
-- percent lives in admin_settings and is read by ONE canonical function.

CREATE TABLE IF NOT EXISTS public.meta_ads_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN
    ('DEPOSIT','RESERVE','RELEASE','META_SPEND','HOMATCH_FEE',
     'REFUND','WITHDRAWAL','ADJUSTMENT')),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  currency text NOT NULL DEFAULT 'USD',
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  provider_ref text,
  idempotency_key text UNIQUE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_ads_ledger_user ON public.meta_ads_ledger(user_id, created_at DESC);
ALTER TABLE public.meta_ads_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_ads_ledger_select ON public.meta_ads_ledger
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY meta_ads_ledger_service ON public.meta_ads_ledger
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- History is history: even service_role appends, never rewrites.
CREATE OR REPLACE FUNCTION public.meta_ads_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'META_ADS_LEDGER_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS trg_meta_ads_ledger_immutable ON public.meta_ads_ledger;
CREATE TRIGGER trg_meta_ads_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.meta_ads_ledger
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_ledger_immutable();

-- Sign convention: DEPOSIT/RELEASE/REFUND(+in) positive; RESERVE/META_SPEND/
-- HOMATCH_FEE/WITHDRAWAL negative; ADJUSTMENT signed. Available = sum.
CREATE OR REPLACE VIEW public.meta_wallet_balances AS
SELECT
  user_id,
  currency,
  COALESCE(SUM(amount_cents), 0) AS available_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'RESERVE'), 0) * -1
    - COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'RELEASE'), 0)
    AS reserved_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'META_SPEND'), 0) * -1 AS spent_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'HOMATCH_FEE'), 0) * -1 AS fees_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'DEPOSIT'), 0) AS deposited_cents
FROM public.meta_ads_ledger
GROUP BY user_id, currency;

-- ── 7. OPERATIONS: webhooks, sync, errors, moderation, decisions ─────────

CREATE TABLE IF NOT EXISTS public.meta_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  dedupe_key text UNIQUE,
  signature_ok boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_webhook_events_admin ON public.meta_webhook_events
  FOR SELECT USING (public.is_admin());
CREATE POLICY meta_webhook_events_service ON public.meta_webhook_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.meta_api_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  campaign_id uuid,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  code text,
  subcode text,
  customer_message_key text,
  message text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_api_errors_created ON public.meta_api_errors(created_at DESC);
ALTER TABLE public.meta_api_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_api_errors_admin ON public.meta_api_errors
  FOR SELECT USING (public.is_admin());
CREATE POLICY meta_api_errors_service ON public.meta_api_errors
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.meta_moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  creative_id uuid REFERENCES public.meta_creatives(id) ON DELETE CASCADE,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  findings jsonb,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','APPROVED','REJECTED','CHANGES_REQUESTED')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_moderation_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_moderation_admin ON public.meta_moderation_cases
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY meta_moderation_service ON public.meta_moderation_cases
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.meta_optimization_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  target_entity text NOT NULL,
  metric_snapshot jsonb NOT NULL,
  strategy_version text NOT NULL,
  decision text NOT NULL,
  customer_explanation_key text,
  internal_reason text,
  executed boolean NOT NULL DEFAULT false,
  executed_at timestamptz,
  rollback_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_optimization_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_opt_decisions_select ON public.meta_optimization_decisions
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.meta_campaigns c
      WHERE c.id = campaign_id AND c.user_id = public.auth_user_id())
  );
CREATE POLICY meta_opt_decisions_service ON public.meta_optimization_decisions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 8. HELP CONTENT (admin-managed tutorials) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_help_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_key text NOT NULL,
  locale text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  video_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_key, locale)
);
ALTER TABLE public.meta_help_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_help_read ON public.meta_help_content
  FOR SELECT USING (enabled = true OR public.is_admin());
CREATE POLICY meta_help_admin ON public.meta_help_content
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY meta_help_service ON public.meta_help_content
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 9. FUNNEL EVENTS (privacy-safe, server-written) ─────────────────────

CREATE TABLE IF NOT EXISTS public.meta_funnel_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL CHECK (event IN
    ('meta_ads_started','meta_ads_draft_created','meta_ads_auth_required',
     'meta_ads_authenticated','meta_connected','preflight_completed',
     'checkout_started','launch_requested','published')),
  user_id uuid,
  anon_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_funnel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_funnel_admin ON public.meta_funnel_events
  FOR SELECT USING (public.is_admin());
CREATE POLICY meta_funnel_service ON public.meta_funnel_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 10. FK that had to wait ──────────────────────────────────────────────
ALTER TABLE public.meta_campaigns
  DROP CONSTRAINT IF EXISTS meta_campaigns_audience_fk;
ALTER TABLE public.meta_campaigns
  ADD CONSTRAINT meta_campaigns_audience_fk
  FOREIGN KEY (audience_id) REFERENCES public.meta_audiences(id) ON DELETE SET NULL;

-- ── 11. CANONICAL SETTINGS (admin-managed; ONE source of financial truth) ─

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('meta_ads_enabled',                 'true'::jsonb, 'Meta Ads product availability (global kill switch).'),
  ('meta_ads_publishing_enabled',      'true'::jsonb, 'Allow launches to reach the Meta adapter.'),
  ('meta_ads_fee_percent',             '9'::jsonb,    'HOMATCH management fee, percent of media spend, added on top. THE canonical fee source.'),
  ('meta_ads_min_duration_days',       '2'::jsonb,    'HOMATCH product minimum campaign duration (HOMATCH rule, not a Meta rule).'),
  ('meta_ads_daily_budget_min_cents',  '200'::jsonb,  'Minimum daily budget in cents.'),
  ('meta_ads_daily_budget_max_cents',  '100000000'::jsonb, 'Maximum daily budget in cents.'),
  ('meta_ads_goals_enabled',           '["LEADS_ON_META","LEADS_ON_WEBSITE","SITE_REGISTRATIONS","ENGAGEMENT","PROMOTE"]'::jsonb,
                                       'Human goals currently mapped and enabled. MESSAGES stays off until the capability is verified.'),
  ('meta_ads_lead_sync_enabled',       'true'::jsonb, 'Leadgen webhook ingestion.'),
  ('meta_ads_lead_import_enabled',     'true'::jsonb, 'First-party list upload.'),
  ('meta_ads_audience_creation_enabled','true'::jsonb,'Custom Audience creation through the adapter.'),
  ('meta_ads_retargeting_enabled',     'true'::jsonb, 'Campaigns aimed at an existing eligible audience.'),
  ('meta_ads_lookalike_enabled',       'false'::jsonb,'Lookalike creation. OFF until verified for the connected account; never for HOUSING.'),
  ('meta_ads_autopilot_enabled',       'false'::jsonb,'Autopilot mutations. Observation/decision records are always written; execution obeys this.'),
  ('meta_ads_ai_assist_enabled',       'true'::jsonb, 'AI creative/copy assistance.'),
  ('meta_ads_api_version',             '"v26.0"'::jsonb, 'Pinned Graph/Marketing API version.')
ON CONFLICT (key) DO NOTHING;

-- One canonical reader, so no frontend or edge function hardcodes money rules.
CREATE OR REPLACE FUNCTION public.meta_ads_setting(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT value FROM public.admin_settings WHERE key = p_key
$$;
GRANT EXECUTE ON FUNCTION public.meta_ads_setting(text) TO authenticated, anon;

-- ── 12. NOTIFICATIONS ────────────────────────────────────────────────────
-- New values are safe here: PG allows ADD VALUE in a transaction as long as
-- the value is not USED in the same transaction — and these are used only
-- at runtime by edge functions.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'META_LEAD';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'META_CAMPAIGN_STATUS';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'META_ADS_BALANCE';
