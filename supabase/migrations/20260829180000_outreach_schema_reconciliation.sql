-- 20260829180000_outreach_schema_reconciliation
--
-- CRITICAL FIX: the Phase 7 outreach/community feature set was shipped with
-- frontend + edge functions written against the schema in
-- 00033_phase7_community_outreach_engine.sql (table names contacts/contact_lists/
-- communities/community_recommendations/social_posts, column names owner_id/
-- campaign_type/html_body/audience_count/etc), but the schema that was ACTUALLY
-- applied to production uses different table names (outreach_contacts/
-- outreach_contact_lists/community_directory/property_community_recommendations)
-- and different column names (user_id/channel/body_html/estimated_recipients/etc).
-- All affected tables have zero rows, so this reconciles them safely by
-- renaming/widening the REAL tables to match what the app code expects, rather
-- than the other way around.
--
-- It also fixes a critical RLS bug: the "owners manage ..." policies on the
-- outreach tables compare auth.uid() directly against owner/user id columns
-- that the app actually populates with the internal public.users.id (via
-- get_user_id()), not the raw auth uid. Because those two id spaces never
-- match, every insert/select from a real logged-in user was silently blocked
-- by RLS. Fixed to use public.get_user_id() like the rest of the app.

-- ── outreach_campaigns ─────────────────────────────────────────
ALTER TABLE public.outreach_campaigns RENAME COLUMN user_id TO owner_id;
ALTER TABLE public.outreach_campaigns RENAME COLUMN channel TO campaign_type;
ALTER TABLE public.outreach_campaigns RENAME COLUMN body_html TO html_body;
ALTER TABLE public.outreach_campaigns RENAME COLUMN body_text TO text_body;
ALTER TABLE public.outreach_campaigns RENAME COLUMN estimated_recipients TO audience_count;
ALTER TABLE public.outreach_campaigns RENAME COLUMN estimated_cost_usd TO cost_estimate_usd;
ALTER TABLE public.outreach_campaigns RENAME COLUMN actual_cost_usd TO cost_actual_usd;
ALTER TABLE public.outreach_campaigns RENAME COLUMN ai_brief TO ai_instructions;

ALTER TABLE public.outreach_campaigns DROP CONSTRAINT IF EXISTS outreach_campaigns_channel_check;
ALTER TABLE public.outreach_campaigns ADD CONSTRAINT outreach_campaigns_campaign_type_check
  CHECK (campaign_type IN ('EMAIL','SMS','AI_CALL','COMMUNITY','DIRECT_MATCH','MULTI_CHANNEL'));

ALTER TABLE public.outreach_campaigns
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS sender_email text,
  ADD COLUMN IF NOT EXISTS reply_to text,
  ADD COLUMN IF NOT EXISTS sent_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reply_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounce_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complaint_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribe_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS call_script text,
  ADD COLUMN IF NOT EXISTS call_agent_config jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS max_call_duration_sec int DEFAULT 300,
  ADD COLUMN IF NOT EXISTS sms_template text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

DROP POLICY IF EXISTS "owners manage outreach campaigns" ON public.outreach_campaigns;
CREATE POLICY "owners_manage_outreach_campaigns" ON public.outreach_campaigns
  FOR ALL USING (owner_id = public.get_user_id()) WITH CHECK (owner_id = public.get_user_id());
DROP POLICY IF EXISTS "admins_read_outreach_campaigns" ON public.outreach_campaigns;
CREATE POLICY "admins_read_outreach_campaigns" ON public.outreach_campaigns FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── outreach_contact_lists ─────────────────────────────────────
ALTER TABLE public.outreach_contact_lists RENAME COLUMN user_id TO owner_id;
ALTER TABLE public.outreach_contact_lists RENAME COLUMN source_type TO source_format;
ALTER TABLE public.outreach_contact_lists RENAME COLUMN original_filename TO source_filename;
ALTER TABLE public.outreach_contact_lists RENAME COLUMN status TO import_status;
ALTER TABLE public.outreach_contact_lists RENAME COLUMN mapping TO column_map;

ALTER TABLE public.outreach_contact_lists DROP CONSTRAINT IF EXISTS outreach_contact_lists_status_check;
ALTER TABLE public.outreach_contact_lists ADD CONSTRAINT outreach_contact_lists_import_status_check
  CHECK (import_status IN ('PENDING','ANALYZING','READY','FAILED','ARCHIVED'));

ALTER TABLE public.outreach_contact_lists
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS missing_email int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_phone int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS segments jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS terms_consent_id uuid;

ALTER TABLE public.outreach_contact_lists ALTER COLUMN import_status SET DEFAULT 'PENDING';

DROP POLICY IF EXISTS "owners manage contact lists" ON public.outreach_contact_lists;
CREATE POLICY "owners_manage_outreach_contact_lists" ON public.outreach_contact_lists
  FOR ALL USING (owner_id = public.get_user_id()) WITH CHECK (owner_id = public.get_user_id());
DROP POLICY IF EXISTS "admins_read_outreach_contact_lists" ON public.outreach_contact_lists;
CREATE POLICY "admins_read_outreach_contact_lists" ON public.outreach_contact_lists FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── outreach_contacts ──────────────────────────────────────────
ALTER TABLE public.outreach_contacts RENAME COLUMN user_id TO owner_id;
ALTER TABLE public.outreach_contacts RENAME COLUMN country_code TO country;
ALTER TABLE public.outreach_contacts RENAME COLUMN raw_data TO raw_row;

ALTER TABLE public.outreach_contacts
  ADD COLUMN IF NOT EXISTS phone_raw text,
  ADD COLUMN IF NOT EXISTS budget_min numeric,
  ADD COLUMN IF NOT EXISTS budget_max numeric,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS lead_type text DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_valid boolean,
  ADD COLUMN IF NOT EXISTS phone_valid boolean,
  ADD COLUMN IF NOT EXISTS phone_e164_confidence text,
  ADD COLUMN IF NOT EXISTS country_inferred boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS language_inferred boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_flags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS do_not_contact boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_call boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS suppressed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppressed_reason text,
  ADD COLUMN IF NOT EXISTS bounce_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complaint_count int DEFAULT 0;

ALTER TABLE public.outreach_contacts DROP CONSTRAINT IF EXISTS outreach_contacts_lead_type_check;
ALTER TABLE public.outreach_contacts ADD CONSTRAINT outreach_contacts_lead_type_check
  CHECK (lead_type IN ('BUYER','INVESTOR','AGENT','TENANT','OTHER','UNKNOWN'));
ALTER TABLE public.outreach_contacts DROP CONSTRAINT IF EXISTS outreach_contacts_phone_e164_confidence_check;
ALTER TABLE public.outreach_contacts ADD CONSTRAINT outreach_contacts_phone_e164_confidence_check
  CHECK (phone_e164_confidence IS NULL OR phone_e164_confidence IN ('HIGH','MEDIUM','LOW','UNRESOLVED'));

DROP POLICY IF EXISTS "owners manage outreach contacts" ON public.outreach_contacts;
CREATE POLICY "owners_manage_outreach_contacts" ON public.outreach_contacts
  FOR ALL USING (owner_id = public.get_user_id()) WITH CHECK (owner_id = public.get_user_id());
DROP POLICY IF EXISTS "admins_read_outreach_contacts" ON public.outreach_contacts;
CREATE POLICY "admins_read_outreach_contacts" ON public.outreach_contacts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── community_directory (used by the app as "communities") ────
ALTER TABLE public.community_directory RENAME COLUMN external_id TO canonical_id;
ALTER TABLE public.community_directory RENAME COLUMN country_code TO country;
ALTER TABLE public.community_directory RENAME COLUMN relevance_tags TO tags;

ALTER TABLE public.community_directory
  ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_auto_post boolean DEFAULT false;

ALTER TABLE public.community_directory DROP CONSTRAINT IF EXISTS community_directory_platform_check;
ALTER TABLE public.community_directory ADD CONSTRAINT community_directory_platform_check
  CHECK (platform IN ('TELEGRAM','FACEBOOK','VK','REDDIT','LINKEDIN','THREADS','OTHER'));

ALTER TABLE public.community_directory RENAME COLUMN posting_mode TO posting_policy;
ALTER TABLE public.community_directory DROP CONSTRAINT IF EXISTS community_directory_posting_mode_check;
ALTER TABLE public.community_directory ADD CONSTRAINT community_directory_posting_policy_check
  CHECK (posting_policy IN ('OPEN','APPROVAL_REQUIRED','CLOSED','UNKNOWN'));
ALTER TABLE public.community_directory ALTER COLUMN posting_policy SET DEFAULT 'UNKNOWN';

-- was completely lacking any policy (RLS on, zero policies == fully locked)
CREATE POLICY "public_read_active_communities" ON public.community_directory FOR SELECT
  USING (is_active = true);
CREATE POLICY "admins_manage_community_directory" ON public.community_directory FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── property_community_recommendations (used as "community_recommendations") ─
ALTER TABLE public.property_community_recommendations RENAME COLUMN relevance_score TO score;
ALTER TABLE public.property_community_recommendations
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.outreach_campaigns(id);

ALTER TABLE public.property_community_recommendations DROP CONSTRAINT IF EXISTS property_community_recommendations_status_check;
ALTER TABLE public.property_community_recommendations ADD CONSTRAINT property_community_recommendations_status_check
  CHECK (status IN ('PENDING','OPEN','POST_GENERATED','COPIED','POSTED','SKIPPED'));
ALTER TABLE public.property_community_recommendations ALTER COLUMN status SET DEFAULT 'PENDING';

CREATE POLICY "owners_insert_community_recommendations" ON public.property_community_recommendations
  FOR INSERT WITH CHECK (public.user_owns_property(property_id));
CREATE POLICY "admins_read_community_recommendations" ON public.property_community_recommendations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── social_posts (did not exist at all — social-post-generate was 100% broken) ─
CREATE TABLE IF NOT EXISTS public.social_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id),
  property_id       uuid REFERENCES public.properties(id),
  community_id      uuid REFERENCES public.community_directory(id),
  recommendation_id uuid REFERENCES public.property_community_recommendations(id),
  platform          text NOT NULL DEFAULT 'OTHER',
  language          text NOT NULL DEFAULT 'en',
  content           text NOT NULL,
  content_version   int NOT NULL DEFAULT 1,
  generation_mode   text,
  status            text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','REVIEWED','POSTED','SKIPPED','CANCELLED')),
  posted_at         timestamptz,
  campaign_id       uuid REFERENCES public.outreach_campaigns(id),
  ai_instructions   text,
  metadata          jsonb DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_social_posts" ON public.social_posts
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "admins_read_social_posts" ON public.social_posts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── outreach_sends: per-contact send/call tracking (powers live call UI + stats) ─
CREATE TABLE IF NOT EXISTS public.outreach_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES public.outreach_contacts(id),
  owner_id         uuid NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('EMAIL','SMS','AI_CALL')),
  recipient_email  text,
  recipient_phone  text,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                     'PENDING','QUEUED','SENDING','DIALING','ANSWERED','SENT','DELIVERED',
                     'COMPLETED','FAILED','NO_ANSWER','BUSY','BOUNCED','OPTED_OUT','SUPPRESSED'
                   )),
  provider         text DEFAULT 'MOCK',
  provider_message_id text,
  error_message    text,
  cost_usd         numeric(10,6) DEFAULT 0,
  duration_sec     int,
  transcript       text,
  summary          text,
  recording_url    text,
  attempt_count    int DEFAULT 1,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  call_started_at  timestamptz,
  call_ended_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_campaign ON public.outreach_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_owner ON public.outreach_sends(owner_id, created_at DESC);
ALTER TABLE public.outreach_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_outreach_sends" ON public.outreach_sends
  FOR SELECT USING (owner_id = public.get_user_id());
CREATE POLICY "admins_manage_outreach_sends" ON public.outreach_sends FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true));

-- ── realtime for live campaign progress / live call view ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'outreach_sends'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.outreach_sends;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'outreach_campaigns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.outreach_campaigns;
  END IF;
END $$;

-- ── admin_settings: outreach channel toggles + spend caps for new providers ─
INSERT INTO public.admin_settings (key, value, description)
SELECT * FROM (VALUES
  ('outreach_sms_sending_enabled', 'false'::jsonb, 'Master switch for real SMS sending (Twilio). Mock used while false.'),
  ('outreach_calling_enabled', 'false'::jsonb, 'Master switch for real AI voice calling (Retell). Mock used while false.'),
  ('outreach_sms_provider', '"NONE"'::jsonb, 'SMS provider: NONE or TWILIO'),
  ('outreach_calling_provider', '"NONE"'::jsonb, 'Voice provider: NONE or RETELL'),
  ('outreach_email_price_per_1k', '0.5'::jsonb, 'Customer-facing price per 1000 emails (USD)'),
  ('outreach_sms_unit_price', '0.05'::jsonb, 'Customer-facing price per SMS (USD)'),
  ('outreach_call_price_per_min', '0.2'::jsonb, 'Customer-facing price per AI call minute (USD)'),
  ('spend_cap_resend', '5'::jsonb, 'Monthly spend cap for Resend (USD)'),
  ('spend_cap_twilio', '5'::jsonb, 'Monthly spend cap for Twilio (USD)'),
  ('spend_cap_retell', '10'::jsonb, 'Monthly spend cap for Retell AI (USD)')
) AS v(key, value, description)
WHERE NOT EXISTS (SELECT 1 FROM public.admin_settings s WHERE s.key = v.key);
