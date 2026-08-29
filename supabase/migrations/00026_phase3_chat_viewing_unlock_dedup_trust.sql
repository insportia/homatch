-- ================================================================
-- Homatch Phase 3 — Chat, Viewing Requests, External Contact Unlock,
-- Canonical Dedup, Trust Score, Developer Profiles, PAYG Engine
-- All guards: IF NOT EXISTS / DO $$ / ON CONFLICT DO NOTHING
-- ================================================================

-- ── ENUMS ─────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.message_status AS ENUM ('SENT','DELIVERED','SEEN','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.conversation_status AS ENUM ('ACTIVE','BLOCKED','MUTED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.viewing_request_status AS ENUM (
  'PENDING','ACCEPTED','DECLINED','RESCHEDULE_PROPOSED','CANCELLED','COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.lead_type AS ENUM (
  'BUYER_INTENT','RENTER_INTENT','INVESTOR_INTENT','POSSIBLE_BUYER','POSSIBLE_RENTER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.trust_confidence AS ENUM ('HIGH','MEDIUM','LOW','VERY_LOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CONVERSATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid        REFERENCES public.properties(id) ON DELETE SET NULL,
  match_id         uuid,
  initiator_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status           public.conversation_status NOT NULL DEFAULT 'ACTIVE',
  initiator_muted  boolean     NOT NULL DEFAULT false,
  recipient_muted  boolean     NOT NULL DEFAULT false,
  first_contact_email_sent boolean NOT NULL DEFAULT false,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(initiator_id, recipient_id, property_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body            text        NOT NULL,
  status          public.message_status NOT NULL DEFAULT 'SENT',
  delivered_at    timestamptz,
  seen_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_receipts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status          public.message_status NOT NULL DEFAULT 'DELIVERED',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- Shared contact info within a conversation (explicit opt-in)
CREATE TABLE IF NOT EXISTS public.conversation_contact_shares (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sharer_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone           text,
  whatsapp        text,
  telegram        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, sharer_id)
);

-- Block/report
CREATE TABLE IF NOT EXISTS public.conversation_blocks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS public.conversation_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  reason          text        NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_initiator ON public.conversations(initiator_id);
CREATE INDEX IF NOT EXISTS idx_conversations_recipient ON public.conversations(recipient_id);
CREATE INDEX IF NOT EXISTS idx_conversations_property  ON public.conversations(property_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender         ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_receipts_message        ON public.message_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_receipts_user           ON public.message_receipts(user_id);

-- ── VIEWING REQUESTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viewing_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  requester_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  owner_id             uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id      uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  status               public.viewing_request_status NOT NULL DEFAULT 'PENDING',
  preferred_date       date        NOT NULL,
  preferred_time       time,
  note                 text,
  proposed_date        date,
  proposed_time        time,
  propose_note         text,
  completed_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_viewing_requests_property   ON public.viewing_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_viewing_requests_requester  ON public.viewing_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_viewing_requests_owner      ON public.viewing_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_viewing_requests_status     ON public.viewing_requests(status);

-- ── EXTERNAL CONTACT UNLOCKS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_contact_unlocks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  match_id        uuid        NOT NULL,
  signal_id       uuid,
  lead_type       public.lead_type NOT NULL,
  match_score     integer,
  location_label  text,
  transaction     text,
  budget_min      numeric,
  budget_max      numeric,
  budget_currency text,
  requirements    text,
  source          text,
  confidence      numeric,
  freshness_days  integer,
  -- revealed after unlock
  contact_phone   text,
  contact_email   text,
  contact_whatsapp text,
  contact_telegram text,
  -- pricing
  credits_charged numeric     NOT NULL DEFAULT 0,
  actual_cost     numeric     NOT NULL DEFAULT 0,
  idempotency_key text        NOT NULL UNIQUE,
  unlocked_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ext_unlocks_user    ON public.external_contact_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_ext_unlocks_match   ON public.external_contact_unlocks(match_id);

-- ── CANONICAL PROPERTY GROUPS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.canonical_property_groups (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_property_id uuid   REFERENCES public.properties(id) ON DELETE SET NULL,
  source_count      integer     NOT NULL DEFAULT 1,
  min_price         numeric,
  max_price         numeric,
  price_currency    text,
  price_diff        numeric,
  dedup_signals     jsonb,
  last_deduped_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.canonical_property_sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid        NOT NULL REFERENCES public.canonical_property_groups(id) ON DELETE CASCADE,
  property_id     uuid        REFERENCES public.properties(id) ON DELETE CASCADE,
  raw_signal_id   uuid,
  source_url      text,
  source_name     text,
  price           numeric,
  price_currency  text,
  is_canonical    boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Add canonical_group_id to properties
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS canonical_group_id uuid
  REFERENCES public.canonical_property_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_sources_group    ON public.canonical_property_sources(group_id);
CREATE INDEX IF NOT EXISTS idx_canonical_sources_property ON public.canonical_property_sources(property_id);
CREATE INDEX IF NOT EXISTS idx_properties_canonical_group ON public.properties(canonical_group_id);

-- ── TRUST SCORES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_trust_scores (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  score             integer     NOT NULL DEFAULT 50,
  confidence        public.trust_confidence NOT NULL DEFAULT 'MEDIUM',
  risk_indicators   jsonb       NOT NULL DEFAULT '[]',
  price_conflict    boolean     NOT NULL DEFAULT false,
  area_conflict     boolean     NOT NULL DEFAULT false,
  location_conflict boolean     NOT NULL DEFAULT false,
  duplicate_images  boolean     NOT NULL DEFAULT false,
  data_stale        boolean     NOT NULL DEFAULT false,
  cadastral_mismatch boolean    NOT NULL DEFAULT false,
  source_confidence numeric,
  last_checked_at   timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(property_id)
);

CREATE INDEX IF NOT EXISTS idx_trust_scores_property ON public.property_trust_scores(property_id);

-- ── DEVELOPER PROFILES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.developer_profiles (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  slug                  text        UNIQUE,
  country               text,
  city                  text,
  website               text,
  description           text,
  score                 integer     NOT NULL DEFAULT 50,
  score_breakdown       jsonb       NOT NULL DEFAULT '{}',
  completed_projects    integer     NOT NULL DEFAULT 0,
  active_projects       integer     NOT NULL DEFAULT 0,
  years_active          integer,
  cadastral_info        jsonb,
  permits               jsonb,
  restrictions          jsonb,
  public_risk_evidence  jsonb       NOT NULL DEFAULT '[]',
  is_sponsored          boolean     NOT NULL DEFAULT false,
  last_checked_at       timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.developer_projects (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id     uuid        NOT NULL REFERENCES public.developer_profiles(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  city             text,
  status           text        NOT NULL DEFAULT 'COMPLETED',
  units            integer,
  floors           integer,
  completion_year  integer,
  commissioned     boolean     NOT NULL DEFAULT false,
  cadastral_codes  text[],
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Link properties to developers
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS developer_id uuid
  REFERENCES public.developer_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_developer_projects_dev ON public.developer_projects(developer_id);
CREATE INDEX IF NOT EXISTS idx_properties_developer   ON public.properties(developer_id);

-- ── PAYG PRICING ENGINE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payg_pricing_operations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL,
  operation         text        NOT NULL,
  actual_cost       numeric     NOT NULL DEFAULT 0,
  markup_multiplier numeric     NOT NULL DEFAULT 2.0,
  customer_price    numeric     GENERATED ALWAYS AS (actual_cost * markup_multiplier) STORED,
  currency          text        NOT NULL DEFAULT 'USD',
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, operation)
);

-- Seed default PAYG operations
INSERT INTO public.payg_pricing_operations (provider, operation, actual_cost, currency) VALUES
  ('DATAFORSEO', 'SERP_LIVE_ADVANCED',   0.006, 'USD'),
  ('DATAFORSEO', 'SERP_TASK_POST',       0.002, 'USD'),
  ('APIFY',      'FACEBOOK_SCRAPER',     0.025, 'USD'),
  ('APIFY',      'TELEGRAM_SCRAPER',     0.020, 'USD'),
  ('APIFY',      'INSTAGRAM_SCRAPER',    0.025, 'USD'),
  ('OPENAI',     'GPT4O_MINI_CLASSIFY',  0.001, 'USD'),
  ('OPENAI',     'GPT4O_MINI_TRANSLATE', 0.001, 'USD'),
  ('SYSTEM',     'EXTERNAL_UNLOCK',      0.50,  'USD'),
  ('SYSTEM',     'DEVELOPER_SCORE',      0.10,  'USD'),
  ('SYSTEM',     'CADASTRAL_LOOKUP',     0.25,  'USD')
ON CONFLICT (provider, operation) DO NOTHING;

-- ── ACTIVE SEARCH SUBSCRIPTIONS ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.active_search_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- buyer/renter side: intent profile / search criteria
  intent_id       uuid,
  search_criteria jsonb,
  -- seller/landlord side: property
  property_id     uuid        REFERENCES public.properties(id) ON DELETE CASCADE,
  side            text        NOT NULL CHECK (side IN ('DEMAND','SUPPLY')),
  is_active       boolean     NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  notify_in_app   boolean     NOT NULL DEFAULT true,
  notify_push     boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_active_search_user     ON public.active_search_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_search_property ON public.active_search_subscriptions(property_id);
CREATE INDEX IF NOT EXISTS idx_active_search_active   ON public.active_search_subscriptions(is_active) WHERE is_active = true;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.conversations                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_receipts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_contact_shares     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_requests                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_contact_unlocks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_property_groups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_property_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_trust_scores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payg_pricing_operations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_search_subscriptions     ENABLE ROW LEVEL SECURITY;

-- Conversations: participants can read/write their own
DO $$ BEGIN CREATE POLICY "conv_select" ON public.conversations FOR SELECT
  USING (initiator_id = auth_user_id() OR recipient_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "conv_insert" ON public.conversations FOR INSERT
  WITH CHECK (initiator_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "conv_update" ON public.conversations FOR UPDATE
  USING (initiator_id = auth_user_id() OR recipient_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "conv_service" ON public.conversations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Messages: participants of the conversation
DO $$ BEGIN CREATE POLICY "msg_select" ON public.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
    AND (c.initiator_id = auth_user_id() OR c.recipient_id = auth_user_id())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "msg_insert" ON public.messages FOR INSERT
  WITH CHECK (sender_id = auth_user_id() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (c.initiator_id = auth_user_id() OR c.recipient_id = auth_user_id())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "msg_service" ON public.messages FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Viewing requests: requester or owner
DO $$ BEGIN CREATE POLICY "view_req_select" ON public.viewing_requests FOR SELECT
  USING (requester_id = auth_user_id() OR owner_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "view_req_insert" ON public.viewing_requests FOR INSERT
  WITH CHECK (requester_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "view_req_update" ON public.viewing_requests FOR UPDATE
  USING (requester_id = auth_user_id() OR owner_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "view_req_service" ON public.viewing_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- External unlocks: own records only
DO $$ BEGIN CREATE POLICY "unlock_select" ON public.external_contact_unlocks FOR SELECT
  USING (user_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "unlock_service" ON public.external_contact_unlocks FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trust scores and canonical groups: readable by authenticated
DO $$ BEGIN CREATE POLICY "trust_read" ON public.property_trust_scores FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "trust_service" ON public.property_trust_scores FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "canon_group_read" ON public.canonical_property_groups FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "canon_src_read" ON public.canonical_property_sources FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "canon_service" ON public.canonical_property_groups FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "canon_src_service" ON public.canonical_property_sources FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Developer profiles: public read
DO $$ BEGIN CREATE POLICY "dev_read" ON public.developer_profiles FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "dev_projects_read" ON public.developer_projects FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "dev_service" ON public.developer_profiles FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "dev_proj_service" ON public.developer_projects FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PAYG pricing: admin read, service_role write
DO $$ BEGIN CREATE POLICY "payg_read" ON public.payg_pricing_operations FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "payg_service" ON public.payg_pricing_operations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Active search: own records
DO $$ BEGIN CREATE POLICY "active_search_select" ON public.active_search_subscriptions FOR SELECT
  USING (user_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "active_search_insert" ON public.active_search_subscriptions FOR INSERT
  WITH CHECK (user_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "active_search_update" ON public.active_search_subscriptions FOR UPDATE
  USING (user_id = auth_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "active_search_service" ON public.active_search_subscriptions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── REALTIME ──────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.viewing_requests;

-- ── updated_at triggers ───────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_conversations BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_viewing_requests BEFORE UPDATE ON public.viewing_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_trust_scores BEFORE UPDATE ON public.property_trust_scores
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_developer_profiles BEFORE UPDATE ON public.developer_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_payg_ops BEFORE UPDATE ON public.payg_pricing_operations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';