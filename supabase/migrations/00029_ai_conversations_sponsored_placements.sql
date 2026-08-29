
-- ── AI Conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'New Conversation',
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','model')),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_conversations_user_id_idx ON ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_messages_conv_id_idx ON ai_messages(conversation_id, created_at ASC);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_conv_select" ON ai_conversations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ai_conv_insert" ON ai_conversations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_conv_update" ON ai_conversations FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_conv_delete" ON ai_conversations FOR DELETE USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION is_ai_conv_owner(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM ai_conversations WHERE id = cid AND user_id = auth.uid())
$$;

CREATE POLICY "ai_msg_select" ON ai_messages FOR SELECT USING (is_ai_conv_owner(conversation_id));
CREATE POLICY "ai_msg_insert" ON ai_messages FOR INSERT WITH CHECK (is_ai_conv_owner(conversation_id));
CREATE POLICY "ai_msg_delete" ON ai_messages FOR DELETE USING (is_ai_conv_owner(conversation_id));

CREATE OR REPLACE FUNCTION update_ai_conversation_ts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE ai_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_msg_update_conv_ts
  AFTER INSERT ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION update_ai_conversation_ts();

-- ── Sponsored Placements ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsored_placements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name text NOT NULL,
  category     text NOT NULL CHECK (category IN ('developer','agency','mortgage','relocation','legal','other')),
  creative_url text,
  headline     text NOT NULL,
  sub_headline text,
  cta_label    text DEFAULT 'Learn More',
  destination_url text NOT NULL,
  placement    text NOT NULL DEFAULT 'homepage' CHECK (placement IN ('homepage','search_results','property_detail','verify','sidebar')),
  market       text DEFAULT 'global',
  language     text DEFAULT 'en',
  start_date   timestamptz,
  end_date     timestamptz,
  enabled      boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sponsored_placements_active_idx ON sponsored_placements(placement, enabled, start_date, end_date);

ALTER TABLE sponsored_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_public_select" ON sponsored_placements
  FOR SELECT USING (
    enabled = true AND
    (start_date IS NULL OR start_date <= now()) AND
    (end_date IS NULL OR end_date >= now())
  );

CREATE OR REPLACE FUNCTION is_homatch_admin_v2()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true
  )
$$;

CREATE POLICY "sp_admin_all" ON sponsored_placements
  FOR ALL USING (is_homatch_admin_v2()) WITH CHECK (is_homatch_admin_v2());
