-- ONE WAY TO CREATE A NOTIFICATION.
--
-- WHAT THIS REPLACES
--
-- Direct `insert into notifications (...)` from wherever a feature happened
-- to need one. Nine call sites at the time of writing, each choosing its own
-- title, none of them setting a priority, a deep link, a dedupe key or a
-- group key — because those columns did not exist until this week, and
-- because asking every feature to remember six delivery concerns is how they
-- end up remembered differently six times.
--
-- `notify_emit` is the canonical path. A feature says what happened and to
-- whom; this decides what that means for the feed.
--
-- WHAT IT DOES THAT A BARE INSERT CANNOT
--
--   DEDUPE. A webhook retried, a job re-run, a realtime event delivered
--   twice: same dedupe_key, one row. The unique index enforces it; this
--   turns the conflict into "return the row that already exists" rather than
--   an error the caller has to handle.
--
--   AGGREGATION. Twelve buyer matches in five minutes is one notification
--   that says twelve. When an unread, unpushed notification with the same
--   group_key exists inside the window, this UPDATES it — bumping a counter
--   and rewriting the title — instead of adding a thirteenth row. The
--   window is per-group, because "five new matches" and "five new campaign
--   failures" deserve different patience.
--
--   Direct human messages are deliberately NOT aggregatable: a group_key of
--   NULL means every one is its own row. Collapsing "four people wrote to
--   you" into one line hides the four people.
--
-- WHY SECURITY DEFINER
--
-- A notification is written FOR somebody, by something acting on their
-- behalf: a finished verification, an inbound reply. The caller is the
-- service role or another definer function, never the recipient, so RLS —
-- which scopes the table to `user_id = auth_user_id()` — would refuse every
-- legitimate write. Execute is granted to service_role only; `authenticated`
-- cannot call this and therefore cannot mint notifications for anybody,
-- including themselves.

CREATE OR REPLACE FUNCTION public.notify_emit(
  p_user_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text DEFAULT NULL,
  p_priority text DEFAULT 'NORMAL',
  p_deep_link text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL,
  p_group_key text DEFAULT NULL,
  -- How long a group stays open. Five minutes for a burst of matches; a
  -- caller that wants every event separate passes NULL for p_group_key.
  p_group_window interval DEFAULT interval '5 minutes',
  -- Rewritten onto the aggregate row: "12 new buyer matches". Takes the
  -- count, so the wording (and its language) stays with the caller.
  p_group_title_template text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_group_id uuid;
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'notify_emit needs a recipient and a title';
  END IF;

  /* ── Aggregation ─────────────────────────────────────────────────────
     Only into a row that is still UNREAD and still UNPUSHED. Once somebody
     has seen it, or it has already interrupted them, the next event is news
     and deserves its own row. */
  IF p_group_key IS NOT NULL THEN
    SELECT id, COALESCE((metadata->>'group_count')::int, 1)
      INTO v_group_id, v_count
    FROM public.notifications
    WHERE user_id = p_user_id
      AND group_key = p_group_key
      AND read = false
      AND pushed_at IS NULL
      AND created_at > now() - p_group_window
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_group_id IS NOT NULL THEN
      v_count := v_count + 1;
      UPDATE public.notifications SET
        title = COALESCE(replace(p_group_title_template, '{n}', v_count::text), title),
        body = COALESCE(p_body, body),
        -- The newest event decides where the link goes: it is the thing that
        -- just happened, and a five-minute-old target is the wrong one.
        deep_link = COALESCE(p_deep_link, deep_link),
        priority = GREATEST(priority, p_priority),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('group_count', v_count),
        created_at = now()
      WHERE id = v_group_id;
      RETURN v_group_id;
    END IF;
  END IF;

  /* ── A new row, deduplicated ─────────────────────────────────────────
     ON CONFLICT rather than a pre-check: two workers racing the same event
     is exactly the case a pre-check loses. */
  INSERT INTO public.notifications (
    user_id, type, title, body, read, priority, deep_link,
    entity_type, entity_id, dedupe_key, group_key, metadata
  ) VALUES (
    p_user_id, p_type, p_title, p_body, false,
    COALESCE(p_priority, 'NORMAL'), p_deep_link,
    p_entity_type, p_entity_id, p_dedupe_key, p_group_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO UPDATE SET title = public.notifications.title   -- no-op, so RETURNING works
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.notify_emit(uuid, public.notification_type, text, text, text, text, text, uuid, text, text, interval, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(uuid, public.notification_type, text, text, text, text, text, uuid, text, text, interval, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.notify_emit(uuid, public.notification_type, text, text, text, text, text, uuid, text, text, interval, text, jsonb) IS
  'The canonical way to create a notification: deduplicates on (user_id, dedupe_key), aggregates into an unread unpushed row sharing group_key inside the window, and returns the id either way. service_role only — a customer cannot mint notifications.';
