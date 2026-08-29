
-- =================================================================
-- Homatch Phase 6b — Create missing production tables
-- discovery_query_queue: the actual job queue used by EF workers
-- property_signal_candidates: signal-to-property attribution table
-- Both referenced in live EF code but missing from production DB.
-- Idempotent throughout.
-- =================================================================

-- ── 1. discovery_query_queue ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_query_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign_id     uuid        REFERENCES public.matching_campaigns(id) ON DELETE SET NULL,
  query           text        NOT NULL,
  platform        text        NOT NULL,  -- FACEBOOK, TELEGRAM, REDDIT, THREADS, WEB, VK, INSTAGRAM
  language        text,
  query_kind      text,                  -- keyword, geo, intent, property_type etc
  priority        integer     NOT NULL DEFAULT 50,
  status          text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED','DEFERRED')),
  -- Claim fields (property-scoped, SKIP LOCKED)
  claim_token     text,
  claimed_by_run_id text,
  claimed_at      timestamptz,
  attempts        integer     NOT NULL DEFAULT 0,
  max_attempts    integer     NOT NULL DEFAULT 4,
  last_error      text,
  -- Async run tracking (Apify)
  external_run_id text,
  dataset_id      text,
  provider        text,                  -- APIFY, DATAFORSEO, MOCK
  actor_id        text,
  -- Timing
  started_at      timestamptz,
  processed_at    timestamptz,
  next_attempt_at timestamptz,
  -- Results
  result_count    integer     NOT NULL DEFAULT 0,
  -- Metadata
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Composite indexes for property-scoped SKIP LOCKED claim
CREATE INDEX IF NOT EXISTS dqq_claim_scope_idx
  ON public.discovery_query_queue (property_id, status, priority DESC, next_attempt_at NULLS FIRST, created_at)
  WHERE status IN ('PENDING','PROCESSING');

CREATE INDEX IF NOT EXISTS dqq_stale_recovery_idx
  ON public.discovery_query_queue (status, started_at NULLS FIRST)
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS dqq_property_idx
  ON public.discovery_query_queue (property_id);

-- Dedup: one pending job per property+platform+query combo
CREATE UNIQUE INDEX IF NOT EXISTS dqq_dedup_pending_idx
  ON public.discovery_query_queue (property_id, platform, MD5(query))
  WHERE status IN ('PENDING','PROCESSING');

-- Updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'dqq_updated_at' AND tgrelid = 'public.discovery_query_queue'::regclass
  ) THEN
    CREATE TRIGGER dqq_updated_at BEFORE UPDATE ON public.discovery_query_queue
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.discovery_query_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='discovery_query_queue' AND policyname='dqq_service'
  ) THEN
    CREATE POLICY "dqq_service" ON public.discovery_query_queue
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='discovery_query_queue' AND policyname='dqq_owner_read'
  ) THEN
    CREATE POLICY "dqq_owner_read" ON public.discovery_query_queue
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.properties WHERE id = property_id AND user_id = public.auth_user_id()
      ));
  END IF;
END $$;

-- ── 2. property_signal_candidates ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_signal_candidates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  signal_id           uuid        NOT NULL REFERENCES public.raw_signals(id) ON DELETE CASCADE,
  query_id            uuid        REFERENCES public.discovery_query_queue(id) ON DELETE SET NULL,
  acquisition_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, signal_id)
);

CREATE INDEX IF NOT EXISTS psc_property_signal_idx ON public.property_signal_candidates(property_id, signal_id);
CREATE INDEX IF NOT EXISTS psc_signal_idx ON public.property_signal_candidates(signal_id);

ALTER TABLE public.property_signal_candidates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_signal_candidates' AND policyname='psc_service'
  ) THEN
    CREATE POLICY "psc_service" ON public.property_signal_candidates
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_signal_candidates' AND policyname='psc_owner_read'
  ) THEN
    CREATE POLICY "psc_owner_read" ON public.property_signal_candidates
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.properties WHERE id = property_id AND user_id = public.auth_user_id()
      ));
  END IF;
END $$;

-- ── 3. Property-scoped claim RPC for discovery_query_queue ────────
CREATE OR REPLACE FUNCTION public.claim_discovery_jobs_scoped(
  p_property_id uuid,
  p_run_id      text,
  p_max_jobs    integer DEFAULT 10
)
RETURNS SETOF public.discovery_query_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_now timestamptz := pg_catalog.now();
BEGIN
  RETURN QUERY
  UPDATE public.discovery_query_queue AS q
  SET
    status            = 'PROCESSING',
    claim_token       = pg_catalog.gen_random_uuid()::text,
    claimed_by_run_id = p_run_id,
    claimed_at        = v_now,
    started_at        = v_now,
    attempts          = COALESCE(q.attempts, 0) + 1,
    next_attempt_at   = v_now + INTERVAL '5 minutes',
    updated_at        = v_now
  WHERE q.id IN (
    SELECT id FROM public.discovery_query_queue
    WHERE property_id = p_property_id
      AND status = 'PENDING'
      AND (next_attempt_at IS NULL OR next_attempt_at <= v_now)
    ORDER BY priority DESC NULLS LAST, created_at ASC
    LIMIT p_max_jobs
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_discovery_jobs_scoped(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_discovery_jobs_scoped(uuid, text, integer) TO service_role;

-- ── 4. complete_discovery_job — claim-token-gated ─────────────────
CREATE OR REPLACE FUNCTION public.complete_discovery_job(
  p_job_id      uuid,
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
  v_job          public.discovery_query_queue;
  v_max_attempts integer := 4;
BEGIN
  SELECT * INTO v_job
  FROM public.discovery_query_queue
  WHERE id = p_job_id AND claim_token = p_claim_token AND status = 'PROCESSING'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT COALESCE(
    NULLIF(REGEXP_REPLACE(value::text, '"', '', 'g'), ''), '4'
  )::integer INTO v_max_attempts
  FROM public.admin_settings WHERE key = 'max_job_attempts';
  v_max_attempts := COALESCE(v_max_attempts, 4);

  IF p_success THEN
    UPDATE public.discovery_query_queue
    SET status = 'DONE', result_count = p_result_count, processed_at = pg_catalog.now(),
        last_error = NULL, next_attempt_at = NULL, claim_token = NULL, claimed_by_run_id = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_job_id;
  ELSE
    IF v_job.attempts >= v_max_attempts THEN
      UPDATE public.discovery_query_queue
      SET status = 'FAILED', last_error = COALESCE(p_error_msg, 'Max attempts'), processed_at = pg_catalog.now(),
          next_attempt_at = NULL, claim_token = NULL, updated_at = pg_catalog.now()
      WHERE id = p_job_id;
    ELSE
      UPDATE public.discovery_query_queue
      SET status = 'PENDING', last_error = COALESCE(p_error_msg, 'Unknown'),
          next_attempt_at = pg_catalog.now() + (LEAST(POWER(2, v_job.attempts), 60) || ' minutes')::interval,
          claim_token = NULL, claimed_by_run_id = NULL, started_at = NULL,
          updated_at = pg_catalog.now()
      WHERE id = p_job_id;
    END IF;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_discovery_job(uuid, text, boolean, integer, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_discovery_job(uuid, text, boolean, integer, text, numeric) TO service_role;

-- ── 5. recover_stale_discovery_jobs ───────────────────────────────
CREATE OR REPLACE FUNCTION public.recover_stale_discovery_jobs(
  p_stale_after_minutes integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count        integer;
  v_max_attempts integer := 4;
BEGIN
  SELECT COALESCE(NULLIF(REGEXP_REPLACE(value::text,'"','','g'),''),'4')::integer
  INTO v_max_attempts FROM public.admin_settings WHERE key='max_job_attempts';
  v_max_attempts := COALESCE(v_max_attempts, 4);

  WITH stale AS (
    SELECT id, attempts FROM public.discovery_query_queue
    WHERE status = 'PROCESSING'
      AND started_at < pg_catalog.now() - (p_stale_after_minutes||' minutes')::interval
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.discovery_query_queue q
  SET
    status            = CASE WHEN s.attempts >= v_max_attempts THEN 'FAILED' ELSE 'PENDING' END,
    claim_token       = NULL, claimed_by_run_id = NULL, started_at = NULL,
    next_attempt_at   = CASE
      WHEN s.attempts >= v_max_attempts THEN NULL
      ELSE pg_catalog.now() + (LEAST(POWER(2, COALESCE(s.attempts,0)), 60) || ' minutes')::interval
    END,
    last_error        = COALESCE(q.last_error, 'Recovered: stale PROCESSING'),
    updated_at        = pg_catalog.now()
  FROM stale s WHERE q.id = s.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_discovery_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_discovery_jobs(integer) TO service_role;

-- ── 6. Safety verification ─────────────────────────────────────────
DO $$
DECLARE v_ext text; v_kill text;
BEGIN
  SELECT REGEXP_REPLACE(value::text,'"','','g') INTO v_ext FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT REGEXP_REPLACE(value::text,'"','','g') INTO v_kill FROM public.admin_settings WHERE key='provider_kill_switch';
  IF v_ext IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'SAFETY VIOLATION: external_discovery_enabled must be false, got: %',v_ext; END IF;
  IF v_kill IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SAFETY VIOLATION: provider_kill_switch must be true, got: %',v_kill; END IF;
  RAISE NOTICE 'Phase 6b Safety PASSED: external_discovery=% kill_switch=%',v_ext,v_kill;
END $$;
