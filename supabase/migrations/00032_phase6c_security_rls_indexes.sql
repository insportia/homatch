-- Homatch Phase 6c — Security Hardening: RLS, EXECUTE Grants, FK Indexes
-- Uses real production column names verified from information_schema.
-- Idempotent throughout.

-- ── 1. cost_ledger — service-role only (no authenticated reads) ───
ALTER TABLE public.cost_ledger ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cost_ledger' AND policyname='cost_ledger_service_only') THEN
    CREATE POLICY cost_ledger_service_only ON public.cost_ledger
      AS RESTRICTIVE FOR ALL TO authenticated USING (false);
  END IF;
END $$;

-- ── 2. discovery_query_queue — property owner read, no user write ─
ALTER TABLE public.discovery_query_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='discovery_query_queue' AND policyname='discovery_queue_owner_read') THEN
    CREATE POLICY discovery_queue_owner_read ON public.discovery_query_queue
      FOR SELECT TO authenticated
      USING (
        property_id IN (
          SELECT id FROM public.properties
          WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
        )
      );
  END IF;
END $$;

-- ── 3. property_signal_candidates — property owner read ───────────
ALTER TABLE public.property_signal_candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_signal_candidates' AND policyname='signal_candidates_owner_read') THEN
    CREATE POLICY signal_candidates_owner_read ON public.property_signal_candidates
      FOR SELECT TO authenticated
      USING (
        property_id IN (
          SELECT id FROM public.properties
          WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
        )
      );
  END IF;
END $$;

-- ── 4. eligibility_decisions — property owner read ────────────────
ALTER TABLE public.eligibility_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='eligibility_decisions' AND policyname='eligibility_decisions_owner_read') THEN
    CREATE POLICY eligibility_decisions_owner_read ON public.eligibility_decisions
      FOR SELECT TO authenticated
      USING (
        property_id IN (
          SELECT id FROM public.properties
          WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
        )
      );
  END IF;
END $$;

-- ── 5. get_fresh_strong_match_count — harden search_path ─────────
CREATE OR REPLACE FUNCTION public.get_fresh_strong_match_count(
  p_property_id uuid,
  p_min_score   numeric,
  p_since       timestamptz
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT pg_catalog.count(*)::integer
  FROM public.matches
  WHERE property_id = p_property_id
    AND match_score  >= p_min_score
    AND status       IN ('NEW','PREVIEWED','UNLOCKED')
    AND created_at   >= p_since;
$$;
REVOKE ALL ON FUNCTION public.get_fresh_strong_match_count(uuid, numeric, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_fresh_strong_match_count(uuid, numeric, timestamptz) TO authenticated, service_role;

-- ── 6. complete_discovery_job — matches actual column names ───────
-- Columns: id, claim_token, status, attempts, max_attempts,
--          last_error, next_attempt_at, result_count, processed_at
CREATE OR REPLACE FUNCTION public.complete_discovery_job(
  p_job_id       uuid,
  p_claim_token  text,
  p_success      boolean,
  p_result_count integer DEFAULT 0,
  p_cost_usd     numeric DEFAULT 0,
  p_error_msg    text    DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_attempts     integer;
  v_max_attempts integer;
  v_matched      boolean;
BEGIN
  -- Validate: job must be PROCESSING with matching claim token
  SELECT EXISTS(
    SELECT 1 FROM public.discovery_query_queue
    WHERE id = p_job_id
      AND claim_token = p_claim_token
      AND status = 'PROCESSING'
  ) INTO v_matched;
  IF NOT v_matched THEN RETURN false; END IF;

  SELECT attempts, max_attempts
    FROM public.discovery_query_queue
    WHERE id = p_job_id
    INTO v_attempts, v_max_attempts;

  -- Also check admin_settings override for max attempts
  BEGIN
    SELECT COALESCE(replace(value, '"', '')::integer, v_max_attempts)
      FROM public.admin_settings
      WHERE key = 'max_job_attempts'
      INTO v_max_attempts;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF p_success THEN
    UPDATE public.discovery_query_queue SET
      status       = 'DONE',
      claim_token  = NULL,
      processed_at = pg_catalog.now(),
      result_count = p_result_count
    WHERE id = p_job_id;
  ELSIF COALESCE(v_attempts, 1) < COALESCE(v_max_attempts, 4) THEN
    -- Transient failure within retry limit → back to PENDING with backoff
    UPDATE public.discovery_query_queue SET
      status          = 'PENDING',
      claim_token     = NULL,
      claimed_at      = NULL,
      claimed_by_run_id = NULL,
      last_error      = p_error_msg,
      next_attempt_at = pg_catalog.now() + (
        INTERVAL '1 minute' * pg_catalog.power(2, COALESCE(v_attempts, 1) - 1)
      )
    WHERE id = p_job_id;
  ELSE
    -- Terminal failure
    UPDATE public.discovery_query_queue SET
      status      = 'FAILED',
      claim_token = NULL,
      last_error  = p_error_msg,
      processed_at = pg_catalog.now()
    WHERE id = p_job_id;
  END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_discovery_job(uuid, text, boolean, integer, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_discovery_job(uuid, text, boolean, integer, numeric, text)
  TO service_role;

-- ── 7. Performance indexes (schema-verified column names) ─────────

-- matches: hot path for eligibility count query
CREATE INDEX IF NOT EXISTS idx_matches_property_score_status
  ON public.matches (property_id, match_score DESC, status)
  WHERE status IN ('NEW', 'PREVIEWED', 'UNLOCKED');

-- notifications: unread + type routing
CREATE INDEX IF NOT EXISTS idx_notifications_user_type
  ON public.notifications (user_id, type, created_at DESC);

-- notifications: nav_path durable link lookup
CREATE INDEX IF NOT EXISTS idx_notifications_nav_path
  ON public.notifications (user_id, nav_path)
  WHERE nav_path IS NOT NULL;

-- cost_ledger: per-property cost aggregation
CREATE INDEX IF NOT EXISTS idx_cost_ledger_property_job
  ON public.cost_ledger (property_id, job_id);

-- eligibility_decisions: latest decision lookup (uses decided_at, not created_at)
CREATE INDEX IF NOT EXISTS idx_eligibility_decisions_property
  ON public.eligibility_decisions (property_id, decided_at DESC);

-- discovery_query_queue: worker claim query
CREATE INDEX IF NOT EXISTS idx_discovery_queue_property_status
  ON public.discovery_query_queue (property_id, status, priority DESC, next_attempt_at)
  WHERE status IN ('PENDING', 'PROCESSING');

-- property_signal_candidates: property→signal lookup
CREATE INDEX IF NOT EXISTS idx_signal_candidates_property
  ON public.property_signal_candidates (property_id, signal_id);

-- ── 8. Revoke PUBLIC execute on sensitive auth helpers ────────────
DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_id() FROM PUBLIC';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.auth_user_id() FROM PUBLIC';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

-- ── 9. Force-reset safety invariants ─────────────────────────────
UPDATE public.admin_settings SET value = '"false"' WHERE key = 'external_discovery_enabled';
UPDATE public.admin_settings SET value = '"true"'  WHERE key = 'provider_kill_switch';
UPDATE public.admin_settings SET value = '"0"'
  WHERE key IN ('spend_cap_zenrows', 'spend_cap_scrapingbee', 'spend_cap_brightdata');

-- ── Verification: abort entire migration if safety is violated ────
DO $$
DECLARE v_ext text; v_kill text;
BEGIN
  SELECT value INTO v_ext  FROM public.admin_settings WHERE key = 'external_discovery_enabled';
  SELECT value INTO v_kill FROM public.admin_settings WHERE key = 'provider_kill_switch';
  IF v_ext  IS DISTINCT FROM '"false"' THEN
    RAISE EXCEPTION 'SAFETY VIOLATION: external_discovery_enabled must be "false", got %', v_ext;
  END IF;
  IF v_kill IS DISTINCT FROM '"true"' THEN
    RAISE EXCEPTION 'SAFETY VIOLATION: provider_kill_switch must be "true", got %', v_kill;
  END IF;
  RAISE NOTICE 'Phase 6c APPLIED — SAFETY VERIFIED: external=false kill_switch=true';
END $$;