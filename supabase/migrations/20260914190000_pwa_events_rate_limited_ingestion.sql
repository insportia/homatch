-- ANONYMOUS TELEMETRY, WITH A BUDGET.
--
-- THE RISK THIS CLOSES
--
-- pwa_events accepts inserts from `anon`, because the install funnel starts
-- before an account exists and a funnel that only counts signed-in visitors
-- measures the wrong half of the journey. Every column is CHECK-constrained
-- to one of sixteen event names, one of three confidences and a short bucket,
-- so nobody can store prose in it — but nothing stopped a script inserting
-- the same legal row a million times. CHECK constraints bound what a row can
-- SAY; they say nothing about how many rows there may be.
--
-- WHY NOT MOVE INGESTION BEHIND AN EDGE FUNCTION
--
-- That was the obvious alternative and it buys less than it costs here. The
-- function would have to be callable by `anon` too, so the rate limit would
-- still have to be keyed on the same identity and enforced in the same
-- database; all the function adds is a hop, a cold start on the critical path
-- of a page load, and a second place for the event taxonomy to drift from the
-- table's own CHECK constraint. The control belongs where the rows land.
--
-- WHAT THIS ADDS
--
--   A per-identity hourly budget. 60 events an hour is far above what an
--   honest session produces — the client already de-duplicates per page view,
--   so a real visitor generates single digits — and far below what makes a
--   table worth attacking.
--
--   A dedupe window. The same identity repeating the same event from the same
--   source inside ten seconds is a re-render or a double-fire, not a second
--   impression. It is dropped SILENTLY, by returning NULL from a BEFORE
--   trigger, because telemetry that throws at the caller is telemetry that
--   puts an error in front of somebody trying to install an app.
--
--   No backdating. `created_at` loses its INSERT grant, so the timestamp is
--   always the default. A caller that could choose its own timestamp could
--   both evade the rate limit and forge history.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- No IP address, no user agent, no fingerprint. The budget is keyed on the
-- anonymous session id the product already issues, or on the account when
-- there is one. Somebody determined can rotate that id — this is a spam
-- control, not an identity system, and building an identity system to protect
-- an install funnel would be the wrong trade.

CREATE INDEX IF NOT EXISTS pwa_events_identity_idx
  ON public.pwa_events (anon_id, created_at DESC)
  WHERE anon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pwa_events_user_idx
  ON public.pwa_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pwa_events_guard()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER so the counting SELECT is not itself subject to the table's RLS,
-- which would make it read zero rows for an anonymous caller and count
-- nothing. search_path pinned: a SECURITY DEFINER function that resolves
-- names through the caller's path is a privilege escalation.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recent integer;
  same integer;
BEGIN
  /* An event with no identity at all cannot be budgeted, and an unbudgeted
     write path is the hole this migration exists to close. */
  IF NEW.anon_id IS NULL AND NEW.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  /* Ten-second dedupe. Silent, because a dropped duplicate impression is not
     a problem the visitor should hear about. */
  SELECT count(*) INTO same
  FROM public.pwa_events e
  WHERE e.event = NEW.event
    AND e.source IS NOT DISTINCT FROM NEW.source
    AND e.created_at > now() - interval '10 seconds'
    AND ((NEW.user_id IS NOT NULL AND e.user_id = NEW.user_id)
      OR (NEW.user_id IS NULL AND e.anon_id = NEW.anon_id));
  IF same > 0 THEN
    RETURN NULL;
  END IF;

  /* The hourly budget. Also silent: a client that has gone wrong should not
     be handed an error it might retry. */
  SELECT count(*) INTO recent
  FROM public.pwa_events e
  WHERE e.created_at > now() - interval '1 hour'
    AND ((NEW.user_id IS NOT NULL AND e.user_id = NEW.user_id)
      OR (NEW.user_id IS NULL AND e.anon_id = NEW.anon_id));
  IF recent >= 60 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.pwa_events_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pwa_events_guard ON public.pwa_events;
CREATE TRIGGER pwa_events_guard
  BEFORE INSERT ON public.pwa_events
  FOR EACH ROW EXECUTE FUNCTION public.pwa_events_guard();

-- The timestamp is the database's to decide. Without this a caller can
-- backdate a row outside both windows above and defeat them both.
REVOKE INSERT ON public.pwa_events FROM anon, authenticated;
GRANT INSERT (event, confidence, user_id, anon_id, platform, browser, locale, standalone, source)
  ON public.pwa_events TO anon, authenticated;

COMMENT ON FUNCTION public.pwa_events_guard() IS
  'Silently drops duplicate (10s) and over-budget (60/hour per identity) telemetry, and any event with no identity to budget against. Silent rather than raising: an error here would surface to somebody trying to install the app.';
