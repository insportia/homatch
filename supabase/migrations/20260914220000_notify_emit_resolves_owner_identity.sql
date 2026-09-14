-- ============================================================================
-- HOMATCH — notify_emit accepts either identity a caller can be holding.
--
-- THE DEFECT, AND WHY IT WAS INVISIBLE
--
-- Homatch keys a person two ways. Most of the product uses public.users.id.
-- The whole outreach and communications domain — comm_channel_accounts,
-- comm_conversations, comm_agents, comm_whatsapp_templates, outreach_campaigns,
-- outreach_contacts, outreach_sends — keys owner_id on auth.users.id, and
-- authenticate() in _shared/comm/auth.ts returns the auth id too.
--
-- notifications.user_id references public.users(id). So every producer in the
-- communications half handed notify_emit an auth id, the insert failed on the
-- foreign key, and the helper swallowed the error because a notification is a
-- side effect of something that already happened.
--
-- The result, in production, for months: an inbound WhatsApp message, a
-- rejected template, a qualified lead, a requested callback, a campaign paused
-- by the compliance engine and a campaign finishing told NOBODY. Eight of the
-- sixteen places Homatch notifies somebody. Every screen looked correct,
-- nothing was logged where anybody would look, and the notifications simply
-- were not there.
--
-- Confirmed against production rather than reasoned about: calling notify_emit
-- with a real account's auth_id raises
--   23503 insert or update on table "notifications" violates foreign key
--   constraint "notifications_user_id_fkey".
--
-- WHY THE FIX IS HERE AND NOT IN EIGHT CALLERS
--
-- Because there would be eight of them, and then nine. The whole point of one
-- canonical emit function is that "who is this for" is answered once. A caller
-- knows which id it is holding the way it knows anything else about its own
-- tables — which is to say it does not, reliably, and the one that forgets is
-- the one nobody tests.
--
-- So the function resolves. public.users.id if that is what arrived, else the
-- row whose auth_id matches, else nothing at all.
--
-- WHY AN UNRESOLVABLE RECIPIENT RETURNS NULL RATHER THAN RAISING
--
-- It used to raise, via the foreign key, and the helper swallowed it. Raising
-- has not protected anybody: it produced exactly this silence. NULL is the
-- same outcome the caller already handles — the helper returns null and the
-- feature carries on — and it is stated in the return value rather than
-- thrown into a catch block.
--
-- A missing recipient is a bug in the caller either way. What changes is that
-- an id that IS resolvable now resolves, which is every one of the eight.
-- ============================================================================

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
  p_group_window interval DEFAULT interval '5 minutes',
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
  v_user uuid;
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'notify_emit needs a recipient and a title';
  END IF;

  /* ── Which person is this ────────────────────────────────────────────
     public.users.id if that is what arrived; otherwise the row whose
     auth_id matches, which is what every communications table holds. The
     order matters: public.users.id is the common case and costs one index
     lookup, and checking auth_id first would make the common case pay for
     the rare one. */
  SELECT id INTO v_user FROM public.users WHERE id = p_user_id;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_user_id;
  END IF;
  IF v_user IS NULL THEN
    -- Neither identity resolves to an account. Nothing to tell anybody
    -- about, and nothing a foreign-key violation would have told us either.
    RETURN NULL;
  END IF;

  /* ── Aggregation ─────────────────────────────────────────────────────
     Only into a row that is still UNREAD and still UNPUSHED. Once somebody
     has seen it, or it has already interrupted them, the next event is news
     and deserves its own row. */
  IF p_group_key IS NOT NULL THEN
    SELECT id, COALESCE((metadata->>'group_count')::int, 1)
      INTO v_group_id, v_count
    FROM public.notifications
    WHERE user_id = v_user
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
    v_user, p_type, p_title, p_body, false,
    COALESCE(p_priority, 'NORMAL'), p_deep_link,
    p_entity_type, p_entity_id, p_dedupe_key, p_group_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO UPDATE SET title = public.notifications.title   -- no-op, so RETURNING works
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.notify_emit(uuid, public.notification_type, text, text, text, text, text, uuid, text, text, interval, text, jsonb) IS
  'The canonical way to create a notification. Accepts a public.users.id or the auth.users.id every communications table holds, deduplicates on (user_id, dedupe_key), aggregates into an unread unpushed row sharing group_key inside the window, and returns the id either way. service_role only.';

-- The lookup the resolution leans on. Without it every communications
-- notification pays a sequential scan of users.
CREATE INDEX IF NOT EXISTS users_auth_id_idx ON public.users (auth_id);
