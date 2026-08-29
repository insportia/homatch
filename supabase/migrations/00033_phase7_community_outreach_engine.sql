-- ============================================================
-- PHASE 7: Community & Outreach Engine
-- Additive only — never drops existing tables/columns/policies
-- ============================================================

-- ── Safety flags (new keys only) ────────────────────────────
INSERT INTO admin_settings (key, value, description) VALUES
  ('community_discovery_enabled',   'false', 'Enable external community discovery scraping'),
  ('community_auto_post_enabled',   'false', 'Enable automated posting to communities (requires adapter support)'),
  ('outreach_email_sending_enabled','false', 'Enable real email sending via configured provider'),
  ('outreach_sms_sending_enabled',  'false', 'Enable real SMS sending via configured provider'),
  ('outreach_calling_enabled',      'false', 'Enable real AI voice calls via configured provider'),
  ('outreach_email_price_per_1k',   '0.50',  'Homatch retail price per 1000 emails (USD)'),
  ('outreach_sms_unit_price',       '0.02',  'Homatch retail price per SMS unit (USD)'),
  ('outreach_call_price_per_min',   '0.15',  'Homatch retail price per AI call minute (USD)'),
  ('community_recommend_price',     '0.10',  'Homatch retail price per community recommendation (USD)'),
  ('admin_impersonation_enabled',   'true',  'Allow SUPER_ADMIN to impersonate users for support')
ON CONFLICT (key) DO NOTHING;

-- ── Admin RBAC roles ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('SUPER_ADMIN','SUPPORT_ADMIN','BILLING_ADMIN','READ_ONLY')),
  granted_by  uuid REFERENCES auth.users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  notes       text,
  UNIQUE (user_id, role)
);

-- ── Immutable admin audit log ────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES auth.users(id),
  target_id    uuid,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb DEFAULT '{}',
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Audit log is append-only — no UPDATE/DELETE ever
ALTER TABLE admin_audit_log DISABLE ROW LEVEL SECURITY;
-- Re-enable with insert-only for service role; reads only for admins
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_audit" ON admin_audit_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE POLICY "service_insert_audit" ON admin_audit_log FOR INSERT
  WITH CHECK (true);

-- ── Impersonation sessions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       uuid NOT NULL REFERENCES auth.users(id),
  target_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason         text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  audit_log_id   uuid REFERENCES admin_audit_log(id)
);

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_manage_impersonation" ON impersonation_sessions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid()
      AND ar.role IN ('SUPER_ADMIN','SUPPORT_ADMIN') AND ar.revoked_at IS NULL
  ));

-- ── Terms & consent version records ─────────────────────────
CREATE TABLE IF NOT EXISTS terms_consent (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  legal_purpose text NOT NULL DEFAULT 'platform_use',
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip_address   text,
  user_agent   text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at timestamptz
);
ALTER TABLE terms_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_consent" ON terms_consent FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admins_read_consent" ON terms_consent FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));

-- ── Community directory (global, reusable) ───────────────────
CREATE TABLE IF NOT EXISTS communities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          text NOT NULL CHECK (platform IN ('TELEGRAM','FACEBOOK','VK','REDDIT','LINKEDIN','THREADS','OTHER')),
  canonical_id      text NOT NULL,          -- platform-scoped external ID
  canonical_url     text NOT NULL UNIQUE,   -- strong dedup key
  name              text NOT NULL,
  description       text,
  language          text,                   -- BCP-47
  country           text,                   -- ISO-3166 alpha-2
  region            text,
  city              text,
  tags              text[] DEFAULT '{}',
  topics            text[] DEFAULT '{}',
  member_count      bigint,
  posting_policy    text CHECK (posting_policy IN ('OPEN','APPROVAL_REQUIRED','CLOSED','UNKNOWN')) DEFAULT 'UNKNOWN',
  allows_auto_post  boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  metadata          jsonb DEFAULT '{}',
  discovered_by     text DEFAULT 'manual',  -- 'manual','internal','mock_adapter'
  last_verified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, canonical_id)
);
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_communities" ON communities FOR SELECT USING (is_active = true);
CREATE POLICY "admins_manage_communities" ON communities FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_communities_platform ON communities(platform);
CREATE INDEX IF NOT EXISTS idx_communities_country_city ON communities(country, city);
CREATE INDEX IF NOT EXISTS idx_communities_language ON communities(language);
CREATE INDEX IF NOT EXISTS idx_communities_tags ON communities USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_communities_topics ON communities USING GIN(topics);

-- ── Community recommendations per property ────────────────────
CREATE TABLE IF NOT EXISTS community_recommendations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  community_id     uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  score            numeric(5,2) NOT NULL DEFAULT 0,
  rationale        jsonb DEFAULT '{}',   -- {location, type, language, topics, audience, geo, activity}
  status           text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','OPEN','POST_GENERATED','COPIED','POSTED','SKIPPED')),
  posted_at        timestamptz,
  campaign_id      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, community_id)
);
ALTER TABLE community_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_recommendations" ON community_recommendations
  FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "owners_update_recommendations" ON community_recommendations
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "owners_insert_recommendations" ON community_recommendations
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "admins_manage_recommendations" ON community_recommendations FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_comm_recs_property ON community_recommendations(property_id);
CREATE INDEX IF NOT EXISTS idx_comm_recs_score ON community_recommendations(property_id, score DESC);

-- ── Social posts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  property_id      uuid REFERENCES properties(id) ON DELETE CASCADE,
  community_id     uuid REFERENCES communities(id),
  recommendation_id uuid REFERENCES community_recommendations(id),
  platform         text NOT NULL,
  language         text NOT NULL DEFAULT 'en',
  content          text NOT NULL,
  content_version  int NOT NULL DEFAULT 1,
  generation_mode  text NOT NULL DEFAULT 'manual'
    CHECK (generation_mode IN ('manual','ai_draft','ai_bulk')),
  status           text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','REVIEWED','POSTED','SKIPPED','CANCELLED')),
  posted_at        timestamptz,
  campaign_id      uuid,
  ai_instructions  text,
  metadata         jsonb DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_social_posts" ON social_posts FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "admins_read_social_posts" ON social_posts FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_social_posts_property ON social_posts(property_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_owner ON social_posts(owner_id, created_at DESC);

-- ── Contact lists (uploaded CSV/XLSX databases) ───────────────
CREATE TABLE IF NOT EXISTS contact_lists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  name             text NOT NULL,
  description      text,
  source_filename  text,
  source_format    text CHECK (source_format IN ('CSV','XLSX','JSON','MANUAL')),
  raw_storage_path text,                    -- path in Supabase Storage
  total_rows       int DEFAULT 0,
  valid_rows       int DEFAULT 0,
  invalid_rows     int DEFAULT 0,
  duplicate_rows   int DEFAULT 0,
  missing_email    int DEFAULT 0,
  missing_phone    int DEFAULT 0,
  segments         jsonb DEFAULT '[]',      -- [{name, count, criteria}]
  column_map       jsonb DEFAULT '{}',      -- detected→normalized header map
  import_status    text NOT NULL DEFAULT 'PENDING'
    CHECK (import_status IN ('PENDING','ANALYZING','READY','FAILED','ARCHIVED')),
  retention_until  timestamptz,
  terms_consent_id uuid REFERENCES terms_consent(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contact_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_contact_lists" ON contact_lists FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "admins_read_contact_lists" ON contact_lists FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_contact_lists_owner ON contact_lists(owner_id, created_at DESC);

-- ── Contacts (normalized rows within a list) ──────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id          uuid NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  -- Normalized fields
  full_name        text,
  email            text,
  phone            text,                    -- E.164 when confidently normalized
  phone_raw        text,                    -- original value preserved
  company          text,
  country          text,
  city             text,
  language         text,
  budget_min       numeric,
  budget_max       numeric,
  currency         text DEFAULT 'USD',
  lead_type        text CHECK (lead_type IN ('BUYER','INVESTOR','AGENT','TENANT','OTHER','UNKNOWN')),
  tags             text[] DEFAULT '{}',
  notes            text,
  custom_fields    jsonb DEFAULT '{}',      -- raw extra columns preserved
  raw_row          jsonb DEFAULT '{}',      -- full original import row
  -- Validation & confidence
  email_valid      boolean,
  phone_valid      boolean,
  phone_e164_confidence text CHECK (phone_e164_confidence IN ('HIGH','MEDIUM','LOW','UNRESOLVED')),
  country_inferred boolean DEFAULT false,
  language_inferred boolean DEFAULT false,
  is_duplicate     boolean DEFAULT false,
  validation_flags text[] DEFAULT '{}',
  -- Compliance
  do_not_contact   boolean DEFAULT false,
  do_not_call      boolean DEFAULT false,
  unsubscribed     boolean DEFAULT false,
  unsubscribed_at  timestamptz,
  suppressed       boolean DEFAULT false,
  suppressed_reason text,
  bounce_count     int DEFAULT 0,
  complaint_count  int DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_contacts" ON contacts FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "admins_read_contacts" ON contacts FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_suppressed ON contacts(list_id) WHERE suppressed = true OR do_not_contact = true;

-- ── Outreach campaigns (email / SMS / AI-call / community / multi) ──
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  name               text NOT NULL,
  campaign_type      text NOT NULL
    CHECK (campaign_type IN ('EMAIL','SMS','AI_CALL','COMMUNITY','DIRECT_MATCH','MULTI_CHANNEL')),
  status             text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','READY','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED')),
  property_id        uuid REFERENCES properties(id),
  contact_list_id    uuid REFERENCES contact_lists(id),
  subject            text,
  html_body          text,
  text_body          text,
  language           text DEFAULT 'en',
  sender_name        text,
  sender_email       text,
  reply_to           text,
  ai_instructions    text,
  scheduled_at       timestamptz,
  provider           text DEFAULT 'MOCK'
    CHECK (provider IN ('WIX','AWS_SES','RETELL','VAPI','TWILIO','MOCK')),
  provider_campaign_id text,
  audience_count     int DEFAULT 0,
  sent_count         int DEFAULT 0,
  delivered_count    int DEFAULT 0,
  open_count         int DEFAULT 0,
  click_count        int DEFAULT 0,
  reply_count        int DEFAULT 0,
  bounce_count       int DEFAULT 0,
  complaint_count    int DEFAULT 0,
  unsubscribe_count  int DEFAULT 0,
  cost_estimate_usd  numeric(10,4) DEFAULT 0,
  cost_actual_usd    numeric(10,4) DEFAULT 0,
  -- AI Call config
  call_script        text,
  call_agent_config  jsonb DEFAULT '{}',   -- role,goal,guardrails,questions,prohibited
  max_call_duration_sec int DEFAULT 300,
  calling_window_start time DEFAULT '09:00',
  calling_window_end   time DEFAULT '18:00',
  -- SMS config
  sms_template       text,
  -- Approval
  approved_by        uuid REFERENCES auth.users(id),
  approved_at        timestamptz,
  metadata           jsonb DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_outreach_campaigns" ON outreach_campaigns FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "admins_manage_outreach_campaigns" ON outreach_campaigns FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_owner ON outreach_campaigns(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_property ON outreach_campaigns(property_id);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_status ON outreach_campaigns(status, campaign_type);

-- ── Outreach queue (idempotent retryable batch items) ─────────
CREATE TABLE IF NOT EXISTS outreach_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES contacts(id),
  owner_id           uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  channel            text NOT NULL CHECK (channel IN ('EMAIL','SMS','AI_CALL','COMMUNITY_POST')),
  recipient_email    text,
  recipient_phone    text,
  idempotency_key    text UNIQUE NOT NULL,  -- campaign_id+contact_id+channel+attempt
  status             text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUPPRESSED','QUEUED','SENDING','SENT','DELIVERED',
                      'FAILED','BOUNCED','COMPLAINED','OPTED_OUT')),
  suppressed_reason  text,
  provider           text DEFAULT 'MOCK',
  provider_message_id text,
  attempt_count      int DEFAULT 0,
  max_attempts       int DEFAULT 3,
  next_attempt_at    timestamptz DEFAULT now(),
  sent_at            timestamptz,
  delivered_at       timestamptz,
  opened_at          timestamptz,
  clicked_at         timestamptz,
  bounced_at         timestamptz,
  error_message      text,
  cost_usd           numeric(10,6) DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE outreach_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_outreach_queue" ON outreach_queue FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "admins_manage_outreach_queue" ON outreach_queue FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_outreach_queue_campaign ON outreach_queue(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_next_attempt ON outreach_queue(next_attempt_at) WHERE status = 'PENDING';

-- ── AI Call records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_call_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  queue_item_id         uuid REFERENCES outreach_queue(id),
  owner_id              uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  contact_id            uuid REFERENCES contacts(id),
  phone_number          text NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','QUEUED','DIALING','ANSWERED','NO_ANSWER','BUSY','FAILED','COMPLETED','OPTED_OUT')),
  provider              text DEFAULT 'MOCK' CHECK (provider IN ('RETELL','VAPI','MOCK')),
  provider_call_id      text,
  agent_config          jsonb DEFAULT '{}',
  language              text DEFAULT 'en',
  duration_sec          int,
  recording_ref         text,
  transcript            text,
  summary               text,
  detected_language     text,
  intent                text,
  qualification_score   int,
  qualification_data    jsonb DEFAULT '{}',
  lead_score            int,
  follow_up_needed      boolean DEFAULT false,
  follow_up_notes       text,
  cost_usd              numeric(10,4) DEFAULT 0,
  call_started_at       timestamptz,
  call_ended_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_call_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_call_records" ON ai_call_records FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "admins_read_call_records" ON ai_call_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid() AND ar.revoked_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_call_records_campaign ON ai_call_records(campaign_id);
CREATE INDEX IF NOT EXISTS idx_call_records_owner ON ai_call_records(owner_id, created_at DESC);

-- ── Attribution events ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach_attribution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  queue_item_id   uuid REFERENCES outreach_queue(id),
  contact_id      uuid REFERENCES contacts(id),
  community_id    uuid REFERENCES communities(id),
  property_id     uuid REFERENCES properties(id),
  owner_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  event_type      text NOT NULL
    CHECK (event_type IN ('DELIVERED','OPENED','CLICKED','REPLIED','ANSWERED',
                          'QUALIFIED','CONVERSATION_STARTED','VIEWING_BOOKED','UNSUBSCRIBED')),
  channel         text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb DEFAULT '{}'
);
ALTER TABLE outreach_attribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_attribution" ON outreach_attribution FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "owners_insert_attribution" ON outreach_attribution FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_attribution_campaign ON outreach_attribution(campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_attribution_property ON outreach_attribution(property_id);

-- ── SECURITY DEFINER helpers ──────────────────────────────────

-- Check admin role (safe, no self-loop)
CREATE OR REPLACE FUNCTION public.check_admin_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = p_user_id AND role = p_role AND revoked_at IS NULL
  );
$$;

-- Get active community recommendations for a property (safe read)
CREATE OR REPLACE FUNCTION public.get_community_recommendations(p_property_id uuid, p_limit int DEFAULT 20)
RETURNS TABLE (
  rec_id uuid, community_id uuid, score numeric, rationale jsonb, status text,
  platform text, name text, canonical_url text, member_count bigint,
  language text, country text, city text, posting_policy text, tags text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cr.id, cr.community_id, cr.score, cr.rationale, cr.status,
         c.platform, c.name, c.canonical_url, c.member_count,
         c.language, c.country, c.city, c.posting_policy, c.tags
  FROM public.community_recommendations cr
  JOIN public.communities c ON c.id = cr.community_id
  WHERE cr.property_id = p_property_id
    AND cr.owner_id = auth.uid()
    AND c.is_active = true
  ORDER BY cr.score DESC
  LIMIT p_limit;
$$;

-- Count non-suppressed contacts in a list (safe)
CREATE OR REPLACE FUNCTION public.get_eligible_contact_count(p_list_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COUNT(*) FROM public.contacts
  WHERE list_id = p_list_id
    AND owner_id = auth.uid()
    AND suppressed = false
    AND do_not_contact = false
    AND unsubscribed = false;
$$;

-- Insert immutable audit event (service-side call)
CREATE OR REPLACE FUNCTION public.log_admin_audit(
  p_admin_id uuid, p_target_id uuid, p_action text,
  p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  VALUES (p_admin_id, p_target_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id;
$$;

-- ── Storage bucket for contact list files ─────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-imports',
  'contact-imports',
  false,
  52428800,  -- 50MB
  ARRAY['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel','text/plain']
) ON CONFLICT (id) DO NOTHING;

-- Storage RLS
CREATE POLICY "owners_upload_contacts" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'contact-imports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "owners_read_contacts" ON storage.objects FOR SELECT
  USING (bucket_id = 'contact-imports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "owners_delete_contacts" ON storage.objects FOR DELETE
  USING (bucket_id = 'contact-imports' AND auth.uid()::text = (storage.foldername(name))[1]);