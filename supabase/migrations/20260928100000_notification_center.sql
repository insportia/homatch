-- Homatch — the notification centre's database half.
--
-- Everything here is idempotent: it is written to be applied to a production
-- database that already has some of it (the realtime publication, the
-- revoked INSERT) and to a fresh one that has none of it, and to leave both in
-- the same state.
--
-- ── 1. REALTIME ─────────────────────────────────────────────────────────────
--
-- The bell, the live toast and the centre all subscribe to postgres_changes on
-- this table. Production has had `notifications` in supabase_realtime since it
-- was added by hand; no migration in this repository ever said so, so a fresh
-- environment built from these files had a bell that never moved. Guarded,
-- because ADD TABLE on a table already in the publication is an error.
--
-- Replica identity stays DEFAULT. Every subscription filters on user_id and
-- listens for INSERT and UPDATE, and both carry the full NEW row under the
-- default identity; FULL would only matter for DELETE, which nothing emits.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ── 2. A CUSTOMER CANNOT WRITE A NOTIFICATION ───────────────────────────────
--
-- The original schema created `notif_insert_own`, letting any signed-in person
-- insert rows addressed to themselves — a forged "your verification is
-- complete" or "payment received" that the centre would render with the same
-- authority as the real thing. Production has since lost both the policy and
-- the grant; this makes the repository say the same, so no rebuild brings
-- them back. Every legitimate row is written by notify_emit (service_role).
--
-- UPDATE stays column-scoped to `read` and `seen_at`, exactly as
-- 20260911200000 and 20260914150000 left it.

DROP POLICY IF EXISTS notif_insert_own ON public.notifications;
REVOKE INSERT, DELETE, TRUNCATE ON public.notifications FROM anon, authenticated;
REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (read, seen_at) ON public.notifications TO authenticated;

-- ── 3. KEYSET PAGING ────────────────────────────────────────────────────────
--
-- The centre pages by (created_at, id), newest first. created_at alone is not
-- a cursor: an aggregated row has its created_at rewritten to now(), and two
-- rows written in the same statement share a timestamp, so "older than the
-- last one I saw" both skipped and repeated rows. The id breaks every tie and
-- this index serves the row comparison without a sort.

CREATE INDEX IF NOT EXISTS notifications_user_keyset_idx
  ON public.notifications (user_id, created_at DESC, id DESC);

-- ── 4. UNREAD COUNT ─────────────────────────────────────────────────────────
--
-- One number for the bell, the page header and the "mark all read" control,
-- so they cannot disagree. SECURITY INVOKER: RLS already scopes the table to
-- the caller, and a definer function here would be a second place that has to
-- get "whose rows" right.

CREATE OR REPLACE FUNCTION public.notifications_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.notifications
  WHERE user_id = public.auth_user_id() AND read = false;
$$;

REVOKE ALL ON FUNCTION public.notifications_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notifications_unread_count() TO authenticated;

-- ── 5. OPENING A CONVERSATION READS ITS MESSAGE NOTIFICATIONS ──────────────
--
-- Somebody who opens the conversation has seen what the notification was
-- telling them. Leaving "New message" lit in the bell after they have read and
-- answered it is the contradiction a notification centre must not have.
--
-- WHAT IT TOUCHES: the CALLER's own unread NEW_MESSAGE notifications for that
-- conversation — the typed ones, and the older MATCH_FOUND rows that carried
-- metadata.kind = 'NEW_MESSAGE' before the enum had the value. Nothing else.
-- It does not touch messages: whether a MESSAGE is seen is the chat's own
-- receipt, and the two unread states stay separate.
--
-- WHO MAY CALL IT: a participant of the conversation. Anybody else is refused
-- rather than silently told zero, so a wrong id is a visible bug. The UPDATE
-- is additionally pinned to user_id = the caller, so even a participant can
-- only ever mark their own rows.
--
-- SECURITY DEFINER because it reads conversations to check participation; the
-- write itself is scoped by hand to the caller.

CREATE OR REPLACE FUNCTION public.notifications_mark_conversation_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.auth_user_id();
  v_n  integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.initiator_id = v_me OR c.recipient_id = v_me)
  ) THEN
    RAISE EXCEPTION 'not a participant of this conversation' USING errcode = '42501';
  END IF;

  UPDATE public.notifications n
     SET read = true
   WHERE n.user_id = v_me
     AND n.read = false
     AND (n.type = 'NEW_MESSAGE' OR n.metadata->>'kind' = 'NEW_MESSAGE')
     AND (n.entity_id = p_conversation_id
          OR n.metadata->>'conversation_id' = p_conversation_id::text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.notifications_mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notifications_mark_conversation_read(uuid) TO authenticated;

COMMENT ON FUNCTION public.notifications_mark_conversation_read(uuid) IS
  'Marks the caller''s unread NEW_MESSAGE notifications for one conversation read. Participants only; never touches another account''s rows or the messages themselves.';

-- ── 6. ANNOUNCEMENTS: THE READER'S LANGUAGE, AND A SET-BASED FAN-OUT ───────
--
-- WHAT WAS WRONG
--
-- publish_announcement() stored the ENGLISH title and body on every row and
-- the centre rendered the stored text, so a Georgian reader was told the news
-- in English although the operator had written it in Georgian. And it called
-- notify_emit once per account in a PL/pgSQL loop: one function call, one
-- identity lookup and one aggregation probe per person, for rows that never
-- aggregate and whose recipient is already a public.users.id.
--
-- WHAT IT DOES NOW
--
--   The stored title/body are in the account's preferred_language when the
--   operator wrote that language, else English. That text is also what a push
--   payload or an old client shows.
--
--   metadata carries every language the operator wrote (title_i18n,
--   body_i18n), so the centre renders the reader's CURRENT interface
--   language — somebody who switches to Russian tomorrow reads it in Russian.
--   Announcement text is public by definition; nothing private is copied.
--
--   The fan-out is INSERT ... SELECT in batches of 1000 accounts, keyed on
--   users.id so each batch is an index range. ON CONFLICT on the same
--   (user_id, dedupe_key) index notify_emit uses: a retry or second publish
--   still tells nobody twice.
--
-- It returns the number of accounts NEWLY told, so a second publish honestly
-- answers 0.
--
-- Push: notify_emit never pushed from SQL either (push is triggered by the
-- edge helper), and announcements are LOW priority, which push-send skips.
-- Nothing about delivery changes.

CREATE OR REPLACE FUNCTION public.publish_announcement(p_slug text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a        public.announcements%rowtype;
  v_after  uuid := '00000000-0000-0000-0000-000000000000';
  v_last   uuid;
  v_batch  integer;
  v_sent   integer := 0;
  c_size   constant integer := 1000;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'only an administrator may publish an announcement'
      USING errcode = '42501';
  END IF;

  SELECT * INTO a FROM public.announcements WHERE slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no announcement named %', p_slug USING errcode = 'HM003';
  END IF;

  IF a.published_at IS NULL THEN
    UPDATE public.announcements SET published_at = now() WHERE id = a.id
      RETURNING * INTO a;
  END IF;

  LOOP
    WITH batch AS (
      SELECT u.id, lower(coalesce(u.preferred_language, 'en')) AS lang
      FROM public.users u
      WHERE u.id > v_after
      ORDER BY u.id
      LIMIT c_size
    ),
    ins AS (
      INSERT INTO public.notifications (
        user_id, type, title, body, read, priority, deep_link,
        entity_type, entity_id, dedupe_key, metadata
      )
      SELECT
        b.id,
        'ANNOUNCEMENT'::public.notification_type,
        coalesce(nullif(a.title ->> b.lang, ''), a.title ->> 'en', p_slug),
        coalesce(nullif(a.body ->> b.lang, ''), a.body ->> 'en'),
        false,
        'LOW',
        coalesce(a.deep_link, '/notifications'),
        'announcement',
        a.id,
        'announcement:' || a.slug,
        jsonb_build_object(
          'kind', 'ANNOUNCEMENT',
          'announcement_id', a.id,
          'slug', a.slug,
          'title_i18n', a.title,
          'body_i18n', coalesce(a.body, '{}'::jsonb)
        )
      FROM batch b
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins)::integer, (SELECT max(id::text)::uuid FROM batch)
      INTO v_batch, v_last;

    EXIT WHEN v_last IS NULL;
    v_sent := v_sent + v_batch;
    v_after := v_last;
  END LOOP;

  RETURN v_sent;
END $$;

COMMENT ON FUNCTION public.publish_announcement(text) IS
  'Publishes an announcement and tells every account once, in batches, in the account''s preferred language with every written language in metadata. Idempotent on the slug; returns the number of accounts newly told.';

REVOKE ALL ON FUNCTION public.publish_announcement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_announcement(text) TO authenticated;
