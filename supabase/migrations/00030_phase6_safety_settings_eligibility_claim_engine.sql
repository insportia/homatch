
-- =================================================================
-- Homatch Phase 6 — Safety, Eligibility & Claim Engine
-- Adapted to REAL production schema (no discovery_query_queue)
-- Queue is via query_packs. notifications.read (not is_read).
-- notification_type enum has MATCH_FOUND (not MATCH_AVAILABLE).
-- Idempotent throughout.
-- SAFETY INVARIANT: external_discovery_enabled=false, kill_switch=true
-- =================================================================

-- ── 1. Fix get_user_id() — add search_path (security hardening) ──
CREATE OR REPLACE FUNCTION public.get_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_id() TO authenticated, service_role;

-- ── 2. resolve_campaign_for_property — add SECURITY DEFINER + search_path ──
CREATE OR REPLACE FUNCTION public.resolve_campaign_for_property(p_property_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.matching_campaigns
  WHERE property_id = p_property_id AND status = 'ACTIVE'
  ORDER BY created_at DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_for_property(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_for_property(uuid) TO authenticated, service_role;

-- ── 3. Admin settings — insert all missing keys safely ───────────
INSERT INTO public.admin_settings(key, value, description) VALUES
  ('external_discovery_enabled', '"false"',  'Master gate: paid external discovery. MUST remain false until manual activation.'),
  ('provider_kill_switch',       '"true"',   'Hard kill switch — overrides all provider enables. true = all external blocked.'),
  ('disabled_providers',         '"[]"',     'JSON array of disabled provider names e.g. ["APIFY","DATAFORSEO"]'),
  ('match_score_threshold',      '"70"',     'Minimum score (0-100) to count as qualifying strong match for eligibility'),
  ('min_strong_matches',         '"3"',      'Minimum fresh strong matches before external discovery is skipped'),
  ('match_freshness_hours',      '"24"',     'Hours within which matches count as fresh for eligibility decision'),
  ('max_jobs_per_property_tick', '"10"',     'Maximum query packs claimed per property per scheduler tick'),
  ('max_properties_per_tick',    '"4"',      'Maximum properties processed per scheduler tick'),
  ('max_job_attempts',           '"4"',      'Maximum retry attempts for query pack jobs before FAILED'),
  ('discovery_batch_size',       '"14"',     'Query packs per queue-worker invocation'),
  ('dry_run_mode',               '"false"',  'When true: simulate full pipeline without real provider calls ($0 cost)'),
  ('spend_cap_per_property_usd', '"5"',      'Per-property per-run spend cap USD'),
  ('spend_cap_per_run_usd',      '"20"',     'Total per-run (scheduler tick) spend cap USD'),
  ('spend_cap_zenrows',          '"0"',      'ZenRows disabled — cap=0'),
  ('spend_cap_scrapingbee',      '"0"',      'ScrapingBee disabled — cap=0'),
  ('spend_cap_brightdata',       '"0"',      'BrightData disabled — cap=0'),
  ('mock_data_providers',        '"false"',  'MUST be false in production. true only in isolated test env.')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description,
      value = CASE
        -- Force-reset safety keys to safe values
        WHEN public.admin_settings.key = 'external_discovery_enabled' THEN '"false"'
        WHEN public.admin_settings.key = 'provider_kill_switch'       THEN '"true"'
        ELSE public.admin_settings.value  -- preserve user-configured non-safety settings
      END;

-- ── 4. notification_type — add missing enum values ────────────────
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'NEW_MESSAGE';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'VIEWING_REQUEST';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'VIEWING_ACCEPTED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'VIEWING_DECLINED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'VIEWING_CANCELLED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'VIEWING_COMPLETED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'SYSTEM';

-- ── 5. notifications — add entity navigation columns ─────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id   uuid,
  ADD COLUMN IF NOT EXISTS nav_path    text;

-- Index for unread (production uses 'read' column not 'is_read')
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read = false;

-- ── 6. conversation_contact_shares — updated_at for realtime ─────
ALTER TABLE public.conversation_contact_shares
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- RLS: participants only for contact shares
ALTER TABLE public.conversation_contact_shares ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='conversation_contact_shares'
    AND policyname='contact_shares_participant_select'
  ) THEN
    CREATE POLICY "contact_shares_participant_select"
      ON public.conversation_contact_shares FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = conversation_id
          AND (c.initiator_id = public.auth_user_id() OR c.recipient_id = public.auth_user_id())
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='conversation_contact_shares'
    AND policyname='contact_shares_participant_insert'
  ) THEN
    CREATE POLICY "contact_shares_participant_insert"
      ON public.conversation_contact_shares FOR INSERT
      WITH CHECK (
        sharer_id = public.auth_user_id()
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.id = conversation_id
            AND (c.initiator_id = public.auth_user_id() OR c.recipient_id = public.auth_user_id())
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='conversation_contact_shares'
    AND policyname='contact_shares_service'
  ) THEN
    CREATE POLICY "contact_shares_service"
      ON public.conversation_contact_shares FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 7. query_packs — add claim/queue lifecycle columns ────────────
ALTER TABLE public.query_packs
  ADD COLUMN IF NOT EXISTS claim_token        text,
  ADD COLUMN IF NOT EXISTS claimed_by_run_id  text,
  ADD COLUMN IF NOT EXISTS claimed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS attempts           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error         text,
  ADD COLUMN IF NOT EXISTS next_run_at        timestamptz,
  ADD COLUMN IF NOT EXISTS result_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at       timestamptz;

-- Indexes for property-scoped claim (SKIP LOCKED pattern)
CREATE INDEX IF NOT EXISTS qp_claim_idx
  ON public.query_packs (property_id, pack_status, priority DESC, next_run_at NULLS FIRST, created_at)
  WHERE pack_status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS qp_stale_idx
  ON public.query_packs (pack_status, started_at)
  WHERE pack_status = 'processing';

-- ── 8. eligibility_decisions audit table ─────────────────────────
CREATE TABLE IF NOT EXISTS public.eligibility_decisions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign_id           uuid        REFERENCES public.matching_campaigns(id) ON DELETE SET NULL,
  decided_at            timestamptz NOT NULL DEFAULT now(),
  eligible_for_external boolean     NOT NULL,
  fresh_strong_count    integer     NOT NULL DEFAULT 0,
  total_match_count     integer     NOT NULL DEFAULT 0,
  threshold_score       integer     NOT NULL DEFAULT 70,
  min_strong_required   integer     NOT NULL DEFAULT 3,
  freshness_hours       integer     NOT NULL DEFAULT 24,
  reason                text,
  deferred_job_count    integer     NOT NULL DEFAULT 0,
  run_id                text
);

CREATE INDEX IF NOT EXISTS eligibility_decisions_property_idx
  ON public.eligibility_decisions (property_id, decided_at DESC);

ALTER TABLE public.eligibility_decisions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='eligibility_decisions' AND policyname='ed_service'
  ) THEN
    CREATE POLICY "ed_service" ON public.eligibility_decisions FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='eligibility_decisions' AND policyname='ed_owner_read'
  ) THEN
    CREATE POLICY "ed_owner_read" ON public.eligibility_decisions FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_id AND p.user_id = public.auth_user_id()
      ));
  END IF;
END $$;

-- ── 9. cost_ledger table (centralized cost audit) ─────────────────
CREATE TABLE IF NOT EXISTS public.cost_ledger (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text        NOT NULL,
  job_id          text,
  property_id     uuid        REFERENCES public.properties(id) ON DELETE SET NULL,
  campaign_id     uuid        REFERENCES public.matching_campaigns(id) ON DELETE SET NULL,
  operation_type  text        NOT NULL,
  estimated_cost  numeric(10,6) NOT NULL DEFAULT 0,
  actual_cost     numeric(10,6),
  currency        text        NOT NULL DEFAULT 'USD',
  claim_token     text,
  attempt         integer     NOT NULL DEFAULT 1,
  success         boolean,
  error_msg       text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_ledger_provider_ts_idx ON public.cost_ledger(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS cost_ledger_property_idx    ON public.cost_ledger(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cost_ledger_job_idx         ON public.cost_ledger(job_id, created_at DESC);

ALTER TABLE public.cost_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='cost_ledger' AND policyname='cost_ledger_service'
  ) THEN
    CREATE POLICY "cost_ledger_service" ON public.cost_ledger FOR ALL
      USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='cost_ledger' AND policyname='cost_ledger_admin_read'
  ) THEN
    CREATE POLICY "cost_ledger_admin_read" ON public.cost_ledger FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
END $$;

-- ── 10. Property-scoped claim RPC (SECURITY DEFINER, SKIP LOCKED) ─
CREATE OR REPLACE FUNCTION public.claim_query_packs_scoped(
  p_property_id uuid,
  p_run_id      text,
  p_max_jobs    integer DEFAULT 10
)
RETURNS SETOF public.query_packs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
BEGIN
  RETURN QUERY
  UPDATE public.query_packs AS q
  SET
    pack_status       = 'processing',
    claim_token       = pg_catalog.gen_random_uuid()::text,
    claimed_by_run_id = p_run_id,
    claimed_at        = v_now,
    started_at        = v_now,
    attempts          = COALESCE(q.attempts, 0) + 1,
    -- Exponential backoff applied at next_run_at for safety
    next_run_at       = v_now + INTERVAL '5 minutes'
  WHERE q.id IN (
    SELECT id FROM public.query_packs
    WHERE property_id = p_property_id
      AND pack_status = 'pending'
      AND (next_run_at IS NULL OR next_run_at <= v_now)
      AND active = true
    ORDER BY priority DESC NULLS LAST, created_at ASC
    LIMIT p_max_jobs
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_query_packs_scoped(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_query_packs_scoped(uuid, text, integer) TO service_role;

-- ── 11. complete_query_pack_job — claim-token-gated completion ────
CREATE OR REPLACE FUNCTION public.complete_query_pack_job(
  p_pack_id     uuid,
  p_claim_token text,
  p_success     boolean,
  p_result_count integer DEFAULT 0,
  p_error_msg   text DEFAULT NULL,
  p_cost_usd    numeric DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pack   record;
  v_max_attempts integer;
BEGIN
  SELECT * INTO v_pack
  FROM public.query_packs
  WHERE id = p_pack_id
    AND claim_token = p_claim_token
    AND pack_status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    NULLIF(REGEXP_REPLACE(value::text, '"', '', 'g'), ''), '4'
  )::integer
  INTO v_max_attempts
  FROM public.admin_settings WHERE key = 'max_job_attempts';

  v_max_attempts := COALESCE(v_max_attempts, 4);

  IF p_success THEN
    UPDATE public.query_packs
    SET pack_status   = 'completed',
        result_count  = p_result_count,
        processed_at  = pg_catalog.now(),
        completed_at  = pg_catalog.now(),
        last_error    = NULL,
        next_run_at   = NULL,
        claim_token   = NULL,
        claimed_by_run_id = NULL
    WHERE id = p_pack_id;
  ELSE
    IF v_pack.attempts >= v_max_attempts THEN
      UPDATE public.query_packs
      SET pack_status   = 'failed',
          last_error    = COALESCE(p_error_msg, 'Max attempts reached'),
          processed_at  = pg_catalog.now(),
          next_run_at   = NULL,
          claim_token   = NULL
      WHERE id = p_pack_id;
    ELSE
      -- Exponential backoff: 2^attempts minutes, max 60 min
      UPDATE public.query_packs
      SET pack_status       = 'pending',
          last_error        = COALESCE(p_error_msg, 'Unknown error'),
          next_run_at       = pg_catalog.now() + (LEAST(POWER(2, v_pack.attempts), 60) || ' minutes')::interval,
          claim_token       = NULL,
          claimed_by_run_id = NULL,
          started_at        = NULL
      WHERE id = p_pack_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_query_pack_job(uuid, text, boolean, integer, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_query_pack_job(uuid, text, boolean, integer, text, numeric) TO service_role;

-- ── 12. recover_stale_packs — safe stale claim recovery ──────────
CREATE OR REPLACE FUNCTION public.recover_stale_query_packs(
  p_stale_after_minutes integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count        integer;
  v_max_attempts integer;
BEGIN
  SELECT COALESCE(
    NULLIF(REGEXP_REPLACE(value::text, '"', '', 'g'), ''), '4'
  )::integer INTO v_max_attempts
  FROM public.admin_settings WHERE key = 'max_job_attempts';
  v_max_attempts := COALESCE(v_max_attempts, 4);

  WITH stale AS (
    SELECT id, attempts FROM public.query_packs
    WHERE pack_status = 'processing'
      AND started_at < pg_catalog.now() - (p_stale_after_minutes || ' minutes')::interval
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.query_packs q
  SET
    pack_status       = CASE WHEN s.attempts >= v_max_attempts THEN 'failed' ELSE 'pending' END,
    claim_token       = NULL,
    claimed_by_run_id = NULL,
    started_at        = NULL,
    next_run_at       = CASE
      WHEN s.attempts >= v_max_attempts THEN NULL
      ELSE pg_catalog.now() + (LEAST(POWER(2, COALESCE(s.attempts,0)), 60) || ' minutes')::interval
    END,
    last_error        = COALESCE(q.last_error, 'Recovered from stale processing state')
  FROM stale s WHERE q.id = s.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_query_packs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_query_packs(integer) TO service_role;

-- ── 13. get_fresh_strong_match_count — eligibility helper ─────────
CREATE OR REPLACE FUNCTION public.get_fresh_strong_match_count(
  p_property_id     uuid,
  p_min_score       integer DEFAULT 70,
  p_freshness_hours integer DEFAULT 24
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COUNT(*)::integer
  FROM public.matches
  WHERE property_id = p_property_id
    AND match_score >= p_min_score
    AND status IN ('NEW', 'PREVIEWED', 'UNLOCKED')
    AND created_at >= pg_catalog.now() - (p_freshness_hours || ' hours')::interval;
$$;

REVOKE ALL ON FUNCTION public.get_fresh_strong_match_count(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fresh_strong_match_count(uuid, integer, integer) TO service_role;

-- ── 14. check_external_discovery_safety — server-side gate ────────
CREATE OR REPLACE FUNCTION public.check_external_discovery_safety()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled         boolean := false;
  v_kill_switch     boolean := true;
  v_disabled_prov   jsonb   := '[]'::jsonb;
BEGIN
  SELECT COALESCE(
    NULLIF(REGEXP_REPLACE(value::text, '"', '', 'g'), '')::boolean, false
  ) INTO v_enabled
  FROM public.admin_settings WHERE key = 'external_discovery_enabled';

  SELECT COALESCE(
    NULLIF(REGEXP_REPLACE(value::text, '"', '', 'g'), '')::boolean, true
  ) INTO v_kill_switch
  FROM public.admin_settings WHERE key = 'provider_kill_switch';

  SELECT COALESCE(value, '[]'::jsonb) INTO v_disabled_prov
  FROM public.admin_settings WHERE key = 'disabled_providers';

  RETURN jsonb_build_object(
    'allowed',            v_enabled AND NOT v_kill_switch,
    'external_enabled',   v_enabled,
    'kill_switch',        v_kill_switch,
    'disabled_providers', v_disabled_prov
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_external_discovery_safety() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_external_discovery_safety() TO service_role;

-- ── 15. Performance indexes ────────────────────────────────────────
-- matches freshness (eligibility engine)
CREATE INDEX IF NOT EXISTS matches_freshness_idx
  ON public.matches (property_id, match_score DESC, created_at DESC)
  WHERE status IN ('NEW','PREVIEWED','UNLOCKED');

-- cost_events cap checks
CREATE INDEX IF NOT EXISTS cost_events_provider_ts_idx
  ON public.cost_events (provider, timestamp DESC);

-- FK index raw_signals
CREATE INDEX IF NOT EXISTS raw_signals_platform_extid_idx
  ON public.raw_signals (platform, external_id)
  WHERE external_id IS NOT NULL;

-- query_packs → matching_jobs FK index
CREATE INDEX IF NOT EXISTS query_packs_job_id_idx
  ON public.query_packs (job_id)
  WHERE job_id IS NOT NULL;

-- intent_profiles signal lookup
CREATE INDEX IF NOT EXISTS intent_profiles_signal_idx
  ON public.intent_profiles (signal_id)
  WHERE signal_id IS NOT NULL;

-- message_receipts lookup
CREATE INDEX IF NOT EXISTS message_receipts_msg_user_idx
  ON public.message_receipts (message_id, user_id);

-- ── 16. FINAL SAFETY VERIFICATION ─────────────────────────────────
DO $$
DECLARE
  v_ext  text;
  v_kill text;
BEGIN
  SELECT REGEXP_REPLACE(value::text, '"', '', 'g') INTO v_ext
  FROM public.admin_settings WHERE key = 'external_discovery_enabled';

  SELECT REGEXP_REPLACE(value::text, '"', '', 'g') INTO v_kill
  FROM public.admin_settings WHERE key = 'provider_kill_switch';

  IF v_ext IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'SAFETY VIOLATION: external_discovery_enabled must be false, got: %', v_ext;
  END IF;
  IF v_kill IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'SAFETY VIOLATION: provider_kill_switch must be true, got: %', v_kill;
  END IF;

  RAISE NOTICE 'Phase 6 Safety PASSED: external_discovery=% kill_switch=%', v_ext, v_kill;
END $$;
