-- AI Chat: free-tier rate limiting + multilingual intent-to-lead capture
-- (Task #59). Three independent pieces:
--
-- 1. SECURITY FIX (discovered while building this): `users_update_own` RLS
--    policy on public.users had a USING clause but no real WITH CHECK, so
--    any authenticated client could `supabase.from('users').update({...})`
--    their OWN row and freely set `is_admin = true` or `plan = 'PRO'` —
--    a live privilege-escalation bug, not a hypothetical one. This is fixed
--    here rather than left in place, because step 2 below makes `plan`
--    load-bearing for AI Chat rate limits: shipping a tier gate on top of a
--    client-writable tier column would be fake enforcement.
-- 2. Admin-configurable daily AI Chat message caps per plan tier, seeded
--    into the existing admin_settings key/value store (same pattern as the
--    spend_cap_* / pricing_* keys already there) and enforced against the
--    already-existing (but previously unused) rate_limit_events table.
-- 3. A canonical `ai_chat_leads` table: when a user's chat message signals
--    real buy/sell/rent intent or leaves contact info, the edge function
--    (in any of the app's 6 languages) captures a structured lead row here
--    for admin follow-up, distinct from the external-signal-mining
--    `intent_profiles` table (that one is fed by the raw_signals pipeline,
--    not first-party in-app chat — mixing the two would corrupt both).

-- ── 1. Lock down privileged user columns ────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_privileged_user_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the service role (edge functions / trusted backend paths) may
  -- change these columns. A normal client-side update is not rejected
  -- outright — that would break legitimate self-service edits to
  -- full_name/avatar_url/preferred_language/nickname in the same
  -- statement — it just has these two columns silently pinned back to
  -- their previous value.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_privileged_user_columns ON public.users;
CREATE TRIGGER trg_protect_privileged_user_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_privileged_user_columns();

-- ── 2. AI Chat daily message caps (admin-configurable) ──────────────────
-- -1 means unlimited. Values are deliberately editable via the existing
-- admin_settings UI pattern rather than hardcoded in the edge function.
INSERT INTO admin_settings (key, value, description) VALUES
  ('ai_chat_daily_limit_free', '20',  'Max AI Chat messages/day for FREE-plan users (-1 = unlimited)')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES
  ('ai_chat_daily_limit_plus', '150', 'Max AI Chat messages/day for PLUS-plan users (-1 = unlimited)')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES
  ('ai_chat_daily_limit_pro', '-1',   'Max AI Chat messages/day for PRO-plan users (-1 = unlimited)')
  ON CONFLICT (key) DO NOTHING;

-- ── 3. Canonical AI-Chat-derived lead table ──────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
  language         text NOT NULL DEFAULT 'en',
  transaction_type text CHECK (transaction_type IN ('BUY','SELL','RENT_OUT','RENT_IN','INVEST')),
  property_type    text,
  location_text    text,
  budget_min       numeric,
  budget_max       numeric,
  currency         text,
  bedrooms         int,
  timeline         text,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  original_text    text NOT NULL,
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status           text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','CONVERTED','DISMISSED','SPAM')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_chat_leads ENABLE ROW LEVEL SECURITY;

-- Users can see leads captured from their own conversations (transparency);
-- only admins can update status / see the full queue. No INSERT policy for
-- authenticated/anon exists on purpose — rows are written exclusively by
-- the homatch-ai edge function using the service-role key, which bypasses
-- RLS entirely, so a client can never fabricate a lead for someone else.
CREATE POLICY "users_read_own_ai_chat_leads" ON ai_chat_leads FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "admins_manage_ai_chat_leads" ON ai_chat_leads FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));

CREATE INDEX IF NOT EXISTS idx_ai_chat_leads_user ON ai_chat_leads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_leads_status ON ai_chat_leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_leads_conversation ON ai_chat_leads(conversation_id);
