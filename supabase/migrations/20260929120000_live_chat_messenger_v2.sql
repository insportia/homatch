-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH — Live Chat messenger v2: media, reactions, saved messages.
--
-- Live Chat stays what it is — the authenticated community room with the
-- escalating burst guard — and grows the messaging features a modern
-- messenger needs, with NO AI in the path: photos, voice up to 60 seconds,
-- emoji reactions, and private per-user bookmarks ("saved messages").
-- Reply-to already exists (reply_to_id, v1). Everything here is additive;
-- history is untouched.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. MEDIA MESSAGES ────────────────────────────────────────────────────
-- A message is TEXT (as before), PHOTO or VOICE. Media rows carry the
-- storage path and a small metadata object; the body becomes an optional
-- caption for media, while a TEXT message keeps the 1..2000 requirement.

ALTER TABLE public.live_chat_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'TEXT',
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_meta jsonb;

ALTER TABLE public.live_chat_messages
  DROP CONSTRAINT IF EXISTS live_chat_messages_kind_check;
ALTER TABLE public.live_chat_messages
  ADD CONSTRAINT live_chat_messages_kind_check
  CHECK (kind IN ('TEXT','PHOTO','VOICE'));

-- The v1 body check required 1..2000 unconditionally, which forbids a photo
-- with no caption. TEXT keeps the old rule verbatim; media allows an empty
-- caption but never an over-long one.
ALTER TABLE public.live_chat_messages
  DROP CONSTRAINT IF EXISTS live_chat_messages_body_check;
ALTER TABLE public.live_chat_messages
  ADD CONSTRAINT live_chat_messages_body_check
  CHECK (
    (kind = 'TEXT' AND char_length(body) BETWEEN 1 AND 2000)
    OR (kind IN ('PHOTO','VOICE') AND char_length(body) BETWEEN 0 AND 2000)
  );

-- Server-side media discipline, none of it trusted from the client:
--   * media only on media kinds, and always present there;
--   * the path must live under the SENDER's own storage prefix, so nobody
--     attaches somebody else's upload to their message;
--   * VOICE must declare a real duration and it may not exceed 60 seconds.
--     (The declared duration is also what the player shows, so a client
--     that lied about it would advertise the lie; the bucket's size limit
--     bounds the real payload.)
ALTER TABLE public.live_chat_messages
  DROP CONSTRAINT IF EXISTS live_chat_messages_media_check;
ALTER TABLE public.live_chat_messages
  ADD CONSTRAINT live_chat_messages_media_check
  CHECK (
    (kind = 'TEXT' AND media_path IS NULL)
    OR (
      kind = 'PHOTO'
      AND media_path IS NOT NULL
      AND media_path LIKE (user_id::text || '/%')
    )
    OR (
      kind = 'VOICE'
      AND media_path IS NOT NULL
      AND media_path LIKE (user_id::text || '/%')
      AND (media_meta ->> 'duration_seconds') IS NOT NULL
      AND (media_meta ->> 'duration_seconds')::numeric > 0
      AND (media_meta ->> 'duration_seconds')::numeric <= 60
    )
  );

COMMENT ON COLUMN public.live_chat_messages.kind IS
  'TEXT | PHOTO | VOICE. Media kinds carry media_path in the live-chat-media bucket under the sender''s own prefix; VOICE duration is capped at 60s by CHECK.';

-- ── 2. REACTIONS ─────────────────────────────────────────────────────────
-- Lightweight, deterministic, no AI. A fixed small palette keeps the row
-- narrow and the UI honest; one row per (message, person, emoji).

CREATE TABLE IF NOT EXISTS public.live_chat_reactions (
  message_id uuid NOT NULL REFERENCES public.live_chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','😂','👀','🔥','🙏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_live_chat_reactions_message
  ON public.live_chat_reactions(message_id);

ALTER TABLE public.live_chat_reactions ENABLE ROW LEVEL SECURITY;

-- The room is one shared space for authenticated members, so reactions are
-- readable room-wide; content-level visibility (deleted/hidden/blocked)
-- is decided by which MESSAGES the reader can see, and reactions are only
-- ever rendered on messages already loaded through that policy.
DROP POLICY IF EXISTS live_chat_reactions_select ON public.live_chat_reactions;
CREATE POLICY live_chat_reactions_select ON public.live_chat_reactions
  FOR SELECT USING (public.auth_user_id() IS NOT NULL);

-- React as yourself, never while suspended, and only to a message that is
-- actually visible (not soft-deleted, not admin-hidden).
DROP POLICY IF EXISTS live_chat_reactions_insert ON public.live_chat_reactions;
CREATE POLICY live_chat_reactions_insert ON public.live_chat_reactions
  FOR INSERT WITH CHECK (
    user_id = public.auth_user_id()
    AND NOT EXISTS (SELECT 1 FROM public.live_chat_profiles p
                    WHERE p.user_id = public.auth_user_id() AND p.suspended = true)
    AND EXISTS (SELECT 1 FROM public.live_chat_messages m
                WHERE m.id = message_id
                  AND m.deleted_at IS NULL AND m.hidden_by_admin = false)
  );

DROP POLICY IF EXISTS live_chat_reactions_delete ON public.live_chat_reactions;
CREATE POLICY live_chat_reactions_delete ON public.live_chat_reactions
  FOR DELETE USING (user_id = public.auth_user_id());

DROP POLICY IF EXISTS live_chat_reactions_service_all ON public.live_chat_reactions;
CREATE POLICY live_chat_reactions_service_all ON public.live_chat_reactions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 3. SAVED MESSAGES (private bookmarks) ────────────────────────────────
-- Important information gets lost in a long room. A save is PRIVATE: it
-- never notifies anyone, and nobody else can see what a person saved.

CREATE TABLE IF NOT EXISTS public.live_chat_saved (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.live_chat_messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_live_chat_saved_user
  ON public.live_chat_saved(user_id, created_at DESC);

ALTER TABLE public.live_chat_saved ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS live_chat_saved_own ON public.live_chat_saved;
CREATE POLICY live_chat_saved_own ON public.live_chat_saved
  FOR ALL USING (user_id = public.auth_user_id())
  WITH CHECK (user_id = public.auth_user_id());

DROP POLICY IF EXISTS live_chat_saved_service_all ON public.live_chat_saved;
CREATE POLICY live_chat_saved_service_all ON public.live_chat_saved
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 4. MEDIA BUCKET ──────────────────────────────────────────────────────
-- Private, like every other HOMATCH media bucket; the app reads through
-- short-lived signed URLs. 8 MB bounds a photo and vastly over-bounds a
-- 60-second voice note. MIME list = what the composer can actually record
-- or pick; the bucket enforces it again server-side.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('live-chat-media', 'live-chat-media', false, 8388608,
        ARRAY['image/jpeg','image/png','image/webp',
              'audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upload only into YOUR OWN prefix, and not while chat-suspended. The
-- message row's CHECK then requires the referenced path to carry the same
-- prefix, closing the "attach someone else's file" hole from both ends.
DROP POLICY IF EXISTS live_chat_media_upload ON storage.objects;
CREATE POLICY live_chat_media_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'live-chat-media'
    AND (storage.foldername(name))[1] = public.auth_user_id()::text
    AND NOT EXISTS (SELECT 1 FROM public.live_chat_profiles p
                    WHERE p.user_id = public.auth_user_id() AND p.suspended = true)
  );

-- The room is shared among authenticated members, so its media reads
-- room-wide (signed URLs, never public). Content-level moderation lives on
-- the MESSAGE row, which is what decides whether a path is ever rendered.
DROP POLICY IF EXISTS live_chat_media_read ON storage.objects;
CREATE POLICY live_chat_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'live-chat-media');

-- No client delete/update: messages soft-delete (v1 semantics) and the
-- object simply stops being referenced; service_role can clean up.

-- ── 5. REALTIME ──────────────────────────────────────────────────────────
-- Reactions update live like messages do. Same guarded ADD the
-- notification center used: only if the publication exists and the table
-- is not already in it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename = 'live_chat_reactions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat_reactions;
  END IF;
END $$;
