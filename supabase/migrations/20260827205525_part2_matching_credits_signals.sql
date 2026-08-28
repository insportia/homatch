
-- ============================================================
-- HOMATCH PART 2 — QueryPack, SourceRegistry, RawSignal,
--   IntentProfile, Match, MatchUnlock, CreditAccount,
--   CreditLedger, Payment, CostEvent
-- ============================================================

-- ── ENUMS ──────────────────────────────────────────────────

CREATE TYPE intent_type AS ENUM (
  'BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT',
  'SELLER','AGENT_AD','PROPERTY_AD','SPAM','NOISE','UNKNOWN'
);

CREATE TYPE signal_platform AS ENUM (
  'GOOGLE','BING','FACEBOOK','TELEGRAM','INSTAGRAM','VK',
  'FORUM','WEBSITE','OTHER'
);

CREATE TYPE source_type AS ENUM (
  'FACEBOOK_GROUP','TELEGRAM_GROUP','VK_COMMUNITY',
  'INSTAGRAM_PROFILE','FORUM','WEBSITE','SEARCH_RESULT'
);

CREATE TYPE classification_status AS ENUM (
  'PENDING','FILTERED_OUT','CANDIDATE','CLASSIFIED','ERROR'
);

CREATE TYPE signal_strength AS ENUM (
  'POTENTIAL','GOOD','STRONG','VERY_STRONG','EXCEPTIONAL'
);

CREATE TYPE match_status AS ENUM (
  'NEW','PREVIEWED','UNLOCKED','ARCHIVED','REJECTED'
);

CREATE TYPE ledger_type AS ENUM (
  'TOP_UP','MATCH_UNLOCK','ADMIN_ADJUSTMENT','REFUND'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING','COMPLETED','FAILED','REFUNDED'
);

CREATE TYPE cost_provider AS ENUM (
  'DATAFORSEO','APIFY','ZENROWS','SCRAPINGBEE',
  'BRIGHTDATA','OPENAI','OTHER'
);

CREATE TYPE integration_status AS ENUM (
  'NOT_CONFIGURED','MOCK','CONFIGURED','REAL_TEST_PASSED','ERROR'
);

CREATE TYPE campaign_status AS ENUM (
  'ACTIVE','PAUSED','LOW_BALANCE','ARCHIVED'
);

-- ── QUERY PACKS ─────────────────────────────────────────────

CREATE TABLE query_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL,
  city            text,
  district        text,
  language        text NOT NULL DEFAULT 'en',
  transaction     text,
  property_type   text,
  intent_type     text,
  priority        int NOT NULL DEFAULT 5,
  active          boolean NOT NULL DEFAULT true,
  queries         jsonb NOT NULL DEFAULT '[]',
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE query_packs ENABLE ROW LEVEL SECURITY;
-- Only service role reads/writes query packs (background jobs)
CREATE POLICY "service_all_query_packs" ON query_packs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── SOURCE REGISTRY ─────────────────────────────────────────

CREATE TABLE source_registry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            signal_platform NOT NULL,
  source_type         source_type NOT NULL,
  external_id         text,
  name                text,
  url                 text NOT NULL,
  country_code        text NOT NULL DEFAULT 'GE',
  language            text,
  active              boolean NOT NULL DEFAULT true,
  priority            int NOT NULL DEFAULT 5,
  quality_score       numeric(4,2) DEFAULT 5.0,
  provider            text,
  last_collected_at   timestamptz,
  last_successful_at  timestamptz,
  failure_count       int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_source_registry" ON source_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Authenticated users can read sources (for UI display)
CREATE POLICY "auth_read_source_registry" ON source_registry
  FOR SELECT TO authenticated USING (true);

-- ── RAW SIGNALS ─────────────────────────────────────────────

CREATE TABLE raw_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             uuid REFERENCES source_registry(id) ON DELETE SET NULL,
  platform              signal_platform NOT NULL,
  external_id           text,
  source_url            text,
  author_public_name    text,
  author_public_url     text,
  original_text         text NOT NULL,
  language              text,
  published_at          timestamptz,
  discovered_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  content_fingerprint   text,
  provider              text,
  classification_status classification_status NOT NULL DEFAULT 'PENDING',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX idx_raw_signals_status ON raw_signals(classification_status);
CREATE INDEX idx_raw_signals_platform ON raw_signals(platform);
CREATE INDEX idx_raw_signals_discovered ON raw_signals(discovered_at DESC);
CREATE INDEX idx_raw_signals_fingerprint ON raw_signals(content_fingerprint);

ALTER TABLE raw_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_raw_signals" ON raw_signals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── INTENT PROFILES ─────────────────────────────────────────

CREATE TABLE intent_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           uuid REFERENCES raw_signals(id) ON DELETE CASCADE,
  intent_type         intent_type NOT NULL,
  country             text,
  region              text,
  city                text,
  district            text,
  neighborhoods       text[],
  transaction_type    text,
  property_types      text[],
  bedrooms_min        int,
  bedrooms_max        int,
  area_min            numeric,
  area_max            numeric,
  budget_min          numeric,
  budget_max          numeric,
  currency            text,
  timeline            text,
  relocation_intent   boolean NOT NULL DEFAULT false,
  investment_intent   boolean NOT NULL DEFAULT false,
  language            text,
  intent_confidence   numeric(4,3) DEFAULT 0,
  specificity_score   numeric(4,3) DEFAULT 0,
  actionability_score numeric(4,3) DEFAULT 0,
  original_text       text,
  translated_text     text,
  ai_model            text,
  ai_cost_usd         numeric(10,6),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intent_profiles_signal ON intent_profiles(signal_id);
CREATE INDEX idx_intent_profiles_city ON intent_profiles(country, city);
CREATE INDEX idx_intent_profiles_type ON intent_profiles(intent_type);

ALTER TABLE intent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_intent_profiles" ON intent_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── CREDIT ACCOUNTS ─────────────────────────────────────────

CREATE TABLE credit_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance    numeric(12,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX idx_credit_accounts_user ON credit_accounts(user_id);

ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own_credits" ON credit_accounts
  FOR SELECT TO authenticated USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
  );
CREATE POLICY "service_all_credits" ON credit_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Helper: create credit account on new user (trigger)
CREATE OR REPLACE FUNCTION create_credit_account_for_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO credit_accounts (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_credit_account
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_credit_account_for_user();

-- Backfill existing users
INSERT INTO credit_accounts (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

-- ── CREDIT LEDGER ────────────────────────────────────────────

CREATE TABLE credit_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount         numeric(12,4) NOT NULL,
  balance_before numeric(12,4) NOT NULL,
  balance_after  numeric(12,4) NOT NULL,
  type           ledger_type NOT NULL,
  reference      text,
  payment_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own_ledger" ON credit_ledger
  FOR SELECT TO authenticated USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
  );
CREATE POLICY "service_all_ledger" ON credit_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── PAYMENTS ────────────────────────────────────────────────

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider         text NOT NULL DEFAULT 'stripe',
  provider_id      text UNIQUE,
  amount_usd       numeric(10,2) NOT NULL,
  credits_issued   numeric(12,4) NOT NULL,
  status           payment_status NOT NULL DEFAULT 'PENDING',
  webhook_verified boolean NOT NULL DEFAULT false,
  idempotency_key  text UNIQUE,
  metadata         jsonb DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_user ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_provider_id ON payments(provider_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own_payments" ON payments
  FOR SELECT TO authenticated USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
  );
CREATE POLICY "service_all_payments" ON payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── MATCHES ─────────────────────────────────────────────────

CREATE TABLE matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  campaign_id         uuid REFERENCES matching_campaigns(id) ON DELETE SET NULL,
  signal_id           uuid REFERENCES raw_signals(id) ON DELETE SET NULL,
  intent_profile_id   uuid REFERENCES intent_profiles(id) ON DELETE SET NULL,
  match_score         numeric(5,2) NOT NULL DEFAULT 0,
  intent_confidence   numeric(4,3) NOT NULL DEFAULT 0,
  signal_strength     signal_strength NOT NULL DEFAULT 'POTENTIAL',
  match_reasons       jsonb DEFAULT '[]',
  mismatch_reasons    jsonb DEFAULT '[]',
  unlock_price_credits numeric(10,4) NOT NULL DEFAULT 1,
  status              match_status NOT NULL DEFAULT 'NEW',
  -- Locked preview fields (server-always-safe to return)
  preview_platform    signal_platform,
  preview_language    text,
  preview_city        text,
  preview_budget_min  numeric,
  preview_budget_max  numeric,
  preview_currency    text,
  preview_bedrooms    text,
  preview_excerpt     text,
  preview_recency     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_property ON matches(property_id, created_at DESC);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_strength ON matches(signal_strength);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
-- Users see only their own property matches; full unlock data restricted
CREATE POLICY "user_read_own_matches" ON matches
  FOR SELECT TO authenticated USING (
    property_id IN (
      SELECT id FROM properties 
      WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
    )
  );
CREATE POLICY "service_all_matches" ON matches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── MATCH UNLOCKS ────────────────────────────────────────────

CREATE TABLE match_unlocks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  credits_charged   numeric(10,4) NOT NULL,
  ledger_entry_id   uuid REFERENCES credit_ledger(id),
  -- Full reveal (only accessible after unlock, server-enforced)
  full_signal_text  text,
  full_source_url   text,
  full_profile_url  text,
  full_intent_json  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);

CREATE INDEX idx_match_unlocks_user ON match_unlocks(user_id, created_at DESC);
CREATE INDEX idx_match_unlocks_match ON match_unlocks(match_id);

ALTER TABLE match_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_own_unlocks" ON match_unlocks
  FOR SELECT TO authenticated USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
  );
CREATE POLICY "service_all_unlocks" ON match_unlocks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── COST EVENTS ──────────────────────────────────────────────

CREATE TABLE cost_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       cost_provider NOT NULL,
  operation_type text NOT NULL,
  source         text,
  market         text,
  request_id     text,
  units          numeric(12,4),
  cost_usd       numeric(12,6) NOT NULL DEFAULT 0,
  success        boolean NOT NULL DEFAULT true,
  cache_hit      boolean NOT NULL DEFAULT false,
  property_id    uuid REFERENCES properties(id) ON DELETE SET NULL,
  signal_id      uuid REFERENCES raw_signals(id) ON DELETE SET NULL,
  timestamp      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_events_provider ON cost_events(provider, timestamp DESC);
CREATE INDEX idx_cost_events_timestamp ON cost_events(timestamp DESC);

ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_cost_events" ON cost_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── MATCHING CAMPAIGNS — extend status enum ─────────────────
-- Add campaign_status column if matching_campaigns already uses text
ALTER TABLE matching_campaigns
  ADD COLUMN IF NOT EXISTS status_v2 campaign_status NOT NULL DEFAULT 'PAUSED';

-- ── UPDATED AT TRIGGERS ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_query_packs_updated BEFORE UPDATE ON query_packs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_source_registry_updated BEFORE UPDATE ON source_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_credit_accounts_updated BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── HELPER: get_homatch_user_id ──────────────────────────────
-- Already defined in Part 1 as get_user_id(); used in policies above via inline subquery
