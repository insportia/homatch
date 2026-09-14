-- ENGAGEMENT: PUSH SUBSCRIPTIONS, NOTIFICATION POLICY, AND PWA TELEMETRY.
--
-- WHAT ALREADY EXISTED, AND WHY THIS IS ADDITIVE
--
-- `notifications` has been in production since the first schema: user_id, a
-- 24-value type enum that already names the real products (MATCH_FOUND,
-- VERIFY_COMPLETE, DOCUMENT_ANALYZED, CAMPAIGN_COMPLETED,
-- WHATSAPP_TEMPLATE_REJECTED, QUALIFIED_LEAD …), title, body, a `read`
-- boolean and a metadata bag. Rows exist. Two RLS policies already scope it
-- to `user_id = auth_user_id()`.
--
-- So this does not replace that table. Rewriting a live notification feed to
-- get four new columns would be a migration that can lose somebody's history
-- in exchange for tidiness. Every column below is added, nullable or
-- defaulted, and `read` keeps being the boolean the existing readers read.
--
-- WHAT THE NEW COLUMNS ARE FOR
--
--   priority      Not everything deserves a push. CRITICAL is for security
--                 and account integrity; HIGH is a person waiting; NORMAL is
--                 the default; LOW is product news. The delivery decision
--                 reads this, so "should this wake somebody" stops being a
--                 judgement made at each call site.
--   deep_link     A notification that cannot take you to the thing it is
--                 about is a nag. Stored as an app path, never a full URL —
--                 an absolute URL in a notification is a redirect waiting to
--                 be abused.
--   entity_type/id  What it is about, so a surface can mark its own
--                 notifications read when the thing itself is opened.
--   seen_at       Different from read. Seen is "it went past your eyes in a
--                 list"; read is "you opened it". Badges clear on seen,
--                 follow-ups stop on read.
--   dedupe_key    The same event arriving twice — a webhook retried, a job
--                 re-run — must not produce two rows. Unique per user, and
--                 only where it is set, so anything without a natural key is
--                 unaffected.
--   group_key     Twelve buyer matches in three minutes is one notification
--                 that says twelve, not twelve notifications. This is what
--                 the aggregation groups on.
--
-- The `read` boolean and `read_at` are kept in step by a trigger rather than
-- by asking every writer to remember both.

-- ── 1. Notifications gain a delivery policy ───────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS deep_link text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_priority_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_priority_check
      CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_deep_link_is_a_path'
  ) THEN
    -- A path, not a URL. Nothing here may send somebody to another origin.
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_deep_link_is_a_path
      CHECK (deep_link IS NULL OR deep_link ~ '^/[A-Za-z0-9/_%\-\?=&\.]*$');
  END IF;
END $$;

-- One row per (user, dedupe_key). A retried webhook is not a second
-- notification. Partial, so rows without a natural key are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uniq
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The feed reads "mine, newest first, unread first". Without this it is a
-- sequential scan on a table that only grows.
CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_group_idx
  ON public.notifications (user_id, group_key, created_at DESC)
  WHERE group_key IS NOT NULL;

/*
 * `read` and `read_at` cannot disagree.
 *
 * Two columns describing one fact is how a feed ends up with rows that are
 * read with no timestamp and rows with a timestamp that still show unread.
 * The boolean stays authoritative because existing code writes it; the
 * timestamp is derived here, once.
 */
CREATE OR REPLACE FUNCTION public.notifications_sync_read_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.read AND NEW.read_at IS NULL THEN
    NEW.read_at := now();
    -- Opening something is also seeing it.
    IF NEW.seen_at IS NULL THEN NEW.seen_at := now(); END IF;
  ELSIF NOT NEW.read THEN
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notifications_sync_read_at ON public.notifications;
CREATE TRIGGER notifications_sync_read_at
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_sync_read_at();

REVOKE ALL ON FUNCTION public.notifications_sync_read_at() FROM PUBLIC, anon, authenticated;

-- The two existing policies cover SELECT and UPDATE for the owner. Marking
-- seen is an UPDATE, so it is already covered; the column grant is not.
GRANT UPDATE (read, seen_at) ON public.notifications TO authenticated;

-- ── 2. Push subscriptions ─────────────────────────────────────────────────
--
-- One row per browser per device. `endpoint` is the identity: it is what the
-- push service addresses, it is unique across the world, and re-subscribing
-- the same browser returns the same endpoint — so UPSERT on it is what stops
-- a person accumulating a subscription per sign-in.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  -- The two keys the browser generates. They are not secrets of ours: they
  -- are the recipient's public key and auth tag, useless without the
  -- endpoint, and required to encrypt a payload the push service cannot read.
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- Coarse, and deliberately so. Enough to answer "are Safari users failing"
  -- without building a fingerprint: no user agent string, no screen metrics.
  platform text,
  browser text,
  locale text,
  standalone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  failure_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id) WHERE enabled AND revoked_at IS NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'push_subscriptions' AND p.polname = 'push_sub_own') THEN
    -- A subscription belongs to the person whose browser made it. Nobody
    -- else may read an endpoint: an endpoint plus the two keys IS the
    -- ability to send that device a notification.
    CREATE POLICY push_sub_own ON public.push_subscriptions
      FOR ALL TO authenticated
      USING (user_id = (SELECT auth_user_id()))
      WITH CHECK (user_id = (SELECT auth_user_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'push_subscriptions' AND p.polname = 'push_sub_service') THEN
    CREATE POLICY push_sub_service ON public.push_subscriptions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

-- ── 3. What a person wants to be told about ───────────────────────────────
--
-- Absent row means defaults, which is why nothing has to be backfilled and
-- why a new account is not silent until it visits a settings screen.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  -- Per-category switches, keyed by the notification family rather than by
  -- the 24 enum values: a person thinks "stop telling me about campaigns",
  -- not "stop CAMPAIGN_PAUSED but keep CAMPAIGN_COMPLETED".
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  push_enabled boolean NOT NULL DEFAULT true,
  -- Marketing is opt-IN and stays that way. Transactional and security
  -- notifications are not governed by this and deliberately have no switch.
  marketing_opt_in boolean NOT NULL DEFAULT false,
  quiet_hours_start smallint CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end smallint CHECK (quiet_hours_end BETWEEN 0 AND 23),
  timezone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'notification_preferences' AND p.polname = 'notif_prefs_own') THEN
    CREATE POLICY notif_prefs_own ON public.notification_preferences
      FOR ALL TO authenticated
      USING (user_id = (SELECT auth_user_id()))
      WITH CHECK (user_id = (SELECT auth_user_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'notification_preferences' AND p.polname = 'notif_prefs_service') THEN
    CREATE POLICY notif_prefs_service ON public.notification_preferences
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON public.notification_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

-- ── 4. PWA install telemetry ──────────────────────────────────────────────
--
-- WHY A CONFIDENCE COLUMN EXISTS
--
-- The browser does not tell a web page that an install succeeded. It fires
-- `appinstalled` on Chromium and nothing at all on iOS, where installing is
-- a Share-menu gesture the page never observes. So an honest funnel has to
-- record HOW it knows:
--
--   CONFIRMED  the browser said so (appinstalled, or userChoice.accepted)
--   DETECTED   measured directly (display-mode: standalone right now)
--   INFERRED   deduced (a first standalone launch implies an install we
--              never saw)
--
-- Anything that would be a guess dressed as a fact is not recorded at all.
-- Clicking the install CTA is not an install, and is stored as its own event.
--
-- WHAT IS NOT STORED
--
-- No user agent string, no screen size, no IP, no cookie beyond the anonymous
-- id the app already issues. Platform and browser are coarse buckets. This is
-- a funnel, not a fingerprint.

CREATE TABLE IF NOT EXISTS public.pwa_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN (
    'PWA_AFFORDANCE_VIEWED',
    'PWA_INSTALL_CLICKED',
    'PWA_NATIVE_PROMPT_AVAILABLE',
    'PWA_NATIVE_PROMPT_SHOWN',
    'PWA_NATIVE_PROMPT_ACCEPTED',
    'PWA_NATIVE_PROMPT_DISMISSED',
    'PWA_IOS_INSTRUCTIONS_SHOWN',
    'PWA_STANDALONE_DETECTED',
    'PWA_FIRST_STANDALONE_LAUNCH',
    'PWA_RETURNING_STANDALONE_SESSION',
    'PUSH_PERMISSION_REQUESTED',
    'PUSH_PERMISSION_GRANTED',
    'PUSH_PERMISSION_DENIED',
    'PUSH_PERMISSION_DISMISSED',
    'PUSH_SUBSCRIPTION_CREATED',
    'PUSH_SUBSCRIPTION_INVALIDATED'
  )),
  confidence text NOT NULL CHECK (confidence IN ('CONFIRMED', 'DETECTED', 'INFERRED')),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- The anonymous session id the product already issues for signed-out
  -- visitors. Not a new identifier, and not joined to anything else.
  anon_id text,
  platform text CHECK (platform IS NULL OR platform IN ('IOS', 'ANDROID', 'MAC', 'WINDOWS', 'OTHER')),
  browser text CHECK (browser IS NULL OR browser IN ('SAFARI', 'CHROMIUM', 'FIREFOX', 'OTHER')),
  locale text CHECK (locale IS NULL OR length(locale) <= 8),
  standalone boolean,
  -- Which surface offered it: the header strip, the mobile menu, a page.
  source text CHECK (source IS NULL OR length(source) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pwa_events_funnel_idx
  ON public.pwa_events (event, created_at DESC);

ALTER TABLE public.pwa_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'pwa_events' AND p.polname = 'pwa_events_write') THEN
    -- Write-only for everybody, including signed-out visitors: the funnel
    -- starts before an account exists. Every column is CHECK-constrained to
    -- a short bucket or a bounded string, so the worst a caller can do is
    -- add a row that says one of sixteen things.
    CREATE POLICY pwa_events_write ON public.pwa_events
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'pwa_events' AND p.polname = 'pwa_events_admin_read') THEN
    -- Reading the funnel is an admin act. A visitor may contribute to it and
    -- may not query it.
    CREATE POLICY pwa_events_admin_read ON public.pwa_events
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'pwa_events' AND p.polname = 'pwa_events_service') THEN
    CREATE POLICY pwa_events_service ON public.pwa_events
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON public.pwa_events FROM anon, authenticated;
GRANT INSERT ON public.pwa_events TO anon, authenticated;
GRANT SELECT ON public.pwa_events TO authenticated;

COMMENT ON TABLE public.pwa_events IS
  'Install and push funnel. Every row states how it knows: CONFIRMED (the browser said so), DETECTED (measured now), INFERRED (deduced). Write-only for visitors, readable only by admins.';
COMMENT ON TABLE public.push_subscriptions IS
  'One row per browser. endpoint+p256dh+auth together are the ability to notify that device, so no policy exposes them to anyone but the owner and service_role.';
