-- ============================================================
-- HOMATCH — Live Chat v1 (Master Prompt §32-§43)
-- ONE global, simple, realtime chat. Absolutely separate from the
-- existing 1:1 conversations/messages system and from the AI
-- assistant (ai_conversations/ai_messages) — same separation
-- precedent as those two already use (separate tables, separate
-- route, separate page). Private DMs are NOT duplicated here —
-- "Send Private Message" reuses the existing conversations/messages
-- system via the existing send-message edge function.
-- ============================================================

-- 1. Public chat identity, deliberately separate from `users` so a
--    private account is never exposed by joining chat messages
--    (Master Prompt §34/§37).
CREATE TABLE IF NOT EXISTS public.live_chat_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  nickname text NOT NULL CHECK (nickname ~ '^[A-Za-z0-9_]{3,24}$'),
  avatar_color text NOT NULL DEFAULT '#6366f1',
  suspended boolean NOT NULL DEFAULT false,
  suspended_reason text,
  suspended_at timestamptz,
  suspended_by uuid REFERENCES public.users(id),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_chat_profiles_nickname_lower ON public.live_chat_profiles (lower(nickname));

ALTER TABLE public.live_chat_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_chat_profiles_read_all ON public.live_chat_profiles
  FOR SELECT USING (auth.uid() IS NOT NULL OR auth.role() = 'service_role');
CREATE POLICY live_chat_profiles_insert_own ON public.live_chat_profiles
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY live_chat_profiles_update_own_or_admin ON public.live_chat_profiles
  FOR UPDATE USING (user_id = public.auth_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY live_chat_profiles_service_all ON public.live_chat_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Non-admins may change their own nickname/avatar but never their
-- own suspension state (defense in depth on top of RLS, which
-- cannot express "leave these columns unchanged" on its own).
CREATE OR REPLACE FUNCTION public.live_chat_profiles_protect_moderation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    NEW.suspended := OLD.suspended;
    NEW.suspended_reason := OLD.suspended_reason;
    NEW.suspended_at := OLD.suspended_at;
    NEW.suspended_by := OLD.suspended_by;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_live_chat_profiles_protect_moderation ON public.live_chat_profiles;
CREATE TRIGGER trg_live_chat_profiles_protect_moderation
  BEFORE UPDATE ON public.live_chat_profiles
  FOR EACH ROW EXECUTE FUNCTION public.live_chat_profiles_protect_moderation_fields();

-- 2. The global message stream (Master Prompt §35/§39).
CREATE TABLE IF NOT EXISTS public.live_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial,
  user_id uuid NOT NULL REFERENCES public.users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  reply_to_id uuid REFERENCES public.live_chat_messages(id),
  edited_at timestamptz,
  deleted_at timestamptz,
  hidden_by_admin boolean NOT NULL DEFAULT false,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_chat_messages_seq ON public.live_chat_messages(seq DESC);
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_user ON public.live_chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_reply_to ON public.live_chat_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
COMMENT ON COLUMN public.live_chat_messages.seq IS 'Monotonic cursor for keyset pagination — do not load unlimited history at once (Master Prompt §39).';

ALTER TABLE public.live_chat_messages ENABLE ROW LEVEL SECURITY;

-- Visible if: not soft-deleted/hidden and the viewer has not blocked
-- the author — OR the viewer is the author (sees their own hidden
-- state) — OR the viewer is an admin (moderation view).
CREATE POLICY live_chat_messages_select ON public.live_chat_messages
  FOR SELECT USING (
    (
      deleted_at IS NULL AND hidden_by_admin = false
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_blocks b
        WHERE b.blocker_id = public.auth_user_id() AND b.blocked_id = live_chat_messages.user_id
      )
    )
    OR user_id = public.auth_user_id()
    OR public.is_admin()
  );

-- Post if: it's your own row, your chat profile (if any) isn't
-- suspended, and you haven't posted in the last 2 seconds (basic
-- anti-spam rate limit — Master Prompt §40).
CREATE POLICY live_chat_messages_insert ON public.live_chat_messages
  FOR INSERT WITH CHECK (
    user_id = public.auth_user_id()
    AND NOT EXISTS (SELECT 1 FROM public.live_chat_profiles p WHERE p.user_id = public.auth_user_id() AND p.suspended = true)
    AND NOT EXISTS (
      SELECT 1 FROM public.live_chat_messages m2
      WHERE m2.user_id = public.auth_user_id() AND m2.created_at > now() - interval '2 seconds'
    )
  );

-- Edit/delete your own message; admins may hide any message.
CREATE POLICY live_chat_messages_update ON public.live_chat_messages
  FOR UPDATE USING (user_id = public.auth_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.auth_user_id() OR public.is_admin());

CREATE POLICY live_chat_messages_service_all ON public.live_chat_messages
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Server-side guardrails a client-side check cannot enforce: only
-- admins can touch moderation fields or a message once soft-deleted;
-- edited_at is stamped by the server, not trusted from the client.
CREATE OR REPLACE FUNCTION public.live_chat_messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    if OLD.deleted_at IS NOT NULL then
      raise exception 'MESSAGE_ALREADY_DELETED';
    end if;
    NEW.hidden_by_admin := OLD.hidden_by_admin;
    NEW.hidden_reason := OLD.hidden_reason;
    if NEW.deleted_at IS NOT NULL then
      NEW.body := OLD.body; -- deleting clears visibility, not content editing in the same call
    end if;
  end if;
  if NEW.body IS DISTINCT FROM OLD.body then
    NEW.edited_at := now();
  end if;
  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_live_chat_messages_guard_update ON public.live_chat_messages;
CREATE TRIGGER trg_live_chat_messages_guard_update
  BEFORE UPDATE ON public.live_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.live_chat_messages_guard_update();

-- 3. Message-level reporting -> "Reported Messages" admin screen
--    (Master Prompt §40). conversation_reports is scoped to 1:1
--    conversations and does not fit message-level Live Chat reports,
--    so this is a new, narrowly-scoped table rather than a
--    duplicate chat system.
CREATE TABLE IF NOT EXISTS public.live_chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.live_chat_messages(id),
  reporter_id uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DISMISSED','HIDDEN','USER_SUSPENDED')),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);

ALTER TABLE public.live_chat_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_chat_reports_insert_own ON public.live_chat_reports
  FOR INSERT WITH CHECK (reporter_id = public.auth_user_id());
CREATE POLICY live_chat_reports_select ON public.live_chat_reports
  FOR SELECT USING (reporter_id = public.auth_user_id() OR public.is_admin());
CREATE POLICY live_chat_reports_admin_update ON public.live_chat_reports
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY live_chat_reports_service_all ON public.live_chat_reports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 4. Realtime — messages should appear without a page refresh
--    (Master Prompt §38), following the existing postgres_changes
--    channel pattern already used by ChatPage.tsx.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'live_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat_messages;
  END IF;
END $$;
