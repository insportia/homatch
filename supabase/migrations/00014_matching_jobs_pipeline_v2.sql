
-- ================================================================
-- Homatch — Prompt 2 Pipeline Migration
-- Version  : 20260829000000_matching_jobs_pipeline_v2
-- Target   : ptxajsjhobhvsfhmutjn (production)
-- Idempotent: IF NOT EXISTS / DO $$ guards throughout
-- ================================================================

-- ── 1. ENUM: matching_job_status ─────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.matching_job_status AS ENUM (
    'queued','analysing_property','generating_queries',
    'searching_sources','collecting_results','normalizing',
    'deduplicating','classifying','ranking',
    'completed','partially_completed','failed','paused','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. TABLE: matching_jobs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matching_jobs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL,
  property_id              uuid        NOT NULL REFERENCES public.properties(id)         ON DELETE CASCADE,
  campaign_id              uuid                 REFERENCES public.matching_campaigns(id) ON DELETE SET NULL,
  idempotency_key          text        NOT NULL UNIQUE,
  status                   public.matching_job_status NOT NULL DEFAULT 'queued',
  progress                 integer     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  current_step             text,
  current_tier             integer     NOT NULL DEFAULT 1,
  query_packs_created      integer     NOT NULL DEFAULT 0,
  queries_run              integer     NOT NULL DEFAULT 0,
  signals_collected        integer     NOT NULL DEFAULT 0,
  signals_classified       integer     NOT NULL DEFAULT 0,
  signals_rejected         integer     NOT NULL DEFAULT 0,
  candidates_after_filter  integer     NOT NULL DEFAULT 0,
  matches_created          integer     NOT NULL DEFAULT 0,
  matches_found            integer     NOT NULL DEFAULT 0,
  tiers_run                integer     NOT NULL DEFAULT 0,
  cost_usd_total           numeric(10,4) NOT NULL DEFAULT 0,
  provider_results         jsonb,
  intent_profile_snap      jsonb,
  failure_reason           text,
  error_message            text,
  started_at               timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── 3. TABLE: matching_job_events ────────────────────────────
CREATE TABLE IF NOT EXISTS public.matching_job_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL REFERENCES public.matching_jobs(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 4. TABLE: apify_actor_runs ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.apify_actor_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid        REFERENCES public.matching_jobs(id) ON DELETE SET NULL,
  query_pack_id    uuid,
  platform         text,
  actor_id         text,
  run_id           text        NOT NULL UNIQUE,
  dataset_id       text,
  status           text        NOT NULL DEFAULT 'RUNNING',
  items_returned   integer     NOT NULL DEFAULT 0,
  cost_usd         numeric(10,4) NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  dataset_fetched  boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 5. Augment query_packs ────────────────────────────────────
ALTER TABLE public.query_packs
  ADD COLUMN IF NOT EXISTS property_id         uuid,
  ADD COLUMN IF NOT EXISTS campaign_id         uuid,
  ADD COLUMN IF NOT EXISTS job_id              uuid,
  ADD COLUMN IF NOT EXISTS tier                integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS expansion_tier      integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tier_reason         text,
  ADD COLUMN IF NOT EXISTS query_hash          text,
  ADD COLUMN IF NOT EXISTS property_snapshot   jsonb,
  ADD COLUMN IF NOT EXISTS intent_profile_snap jsonb,
  ADD COLUMN IF NOT EXISTS results_count       integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usable_count        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_count           integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pack_status         text        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS started_at          timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS error_message       text;

DO $$ BEGIN
  ALTER TABLE public.query_packs ADD CONSTRAINT qp_query_hash_unique UNIQUE (query_hash);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Augment raw_signals ────────────────────────────────────
-- NOTE: raw_signals already has mock_mode (boolean). Adding pipeline cols.
ALTER TABLE public.raw_signals
  ADD COLUMN IF NOT EXISTS job_id             uuid,
  ADD COLUMN IF NOT EXISTS query_pack_id      uuid,
  ADD COLUMN IF NOT EXISTS tier               integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS title              text,
  ADD COLUMN IF NOT EXISTS snippet_text       text,
  ADD COLUMN IF NOT EXISTS domain             text,
  ADD COLUMN IF NOT EXISTS rank_position      integer,
  ADD COLUMN IF NOT EXISTS query_text         text,
  ADD COLUMN IF NOT EXISTS dataforseo_task_id text,
  ADD COLUMN IF NOT EXISTS actor_run_id       text,
  ADD COLUMN IF NOT EXISTS actor_dataset_id   text,
  ADD COLUMN IF NOT EXISTS rejection_reason   text;

-- ── 7. Augment intent_profiles ────────────────────────────────
ALTER TABLE public.intent_profiles
  ADD COLUMN IF NOT EXISTS job_id              uuid,
  ADD COLUMN IF NOT EXISTS query_pack_id       uuid,
  ADD COLUMN IF NOT EXISTS tier                integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS score_intent        numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_geo           numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_budget        numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_compat        numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_freshness     numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_quality       numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_contact       numeric(5,3),
  ADD COLUMN IF NOT EXISTS total_score         numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_label         text,
  ADD COLUMN IF NOT EXISTS dedup_hash          text,
  ADD COLUMN IF NOT EXISTS merged_signal_ids   uuid[],
  ADD COLUMN IF NOT EXISTS mock_mode           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classifier_version  text,
  ADD COLUMN IF NOT EXISTS property_id         uuid,
  ADD COLUMN IF NOT EXISTS campaign_id         uuid;

-- ── 8. Augment matches ────────────────────────────────────────
-- NOTE: matches already has mock_mode boolean. Adding score/job cols.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS job_id          uuid,
  ADD COLUMN IF NOT EXISTS tier            integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS score_intent    numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_geo       numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_budget    numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_compat    numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_freshness numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_quality   numeric(5,3),
  ADD COLUMN IF NOT EXISTS score_contact   numeric(5,3);

-- ── 9. Augment cost_events ────────────────────────────────────
ALTER TABLE public.cost_events
  ADD COLUMN IF NOT EXISTS job_id uuid;

-- ── 10. INDEXES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_matching_jobs_property_id ON public.matching_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_matching_jobs_user_id     ON public.matching_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_matching_jobs_status      ON public.matching_jobs(status);
CREATE INDEX IF NOT EXISTS idx_matching_jobs_created_at  ON public.matching_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mje_job_id                ON public.matching_job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_mje_created_at            ON public.matching_job_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_signals_job_id        ON public.raw_signals(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_query_packs_job_id        ON public.query_packs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apify_runs_job_id         ON public.apify_actor_runs(job_id) WHERE job_id IS NOT NULL;

-- ── 11. updated_at trigger function ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_matching_jobs_updated_at ON public.matching_jobs;
CREATE TRIGGER trg_matching_jobs_updated_at
  BEFORE UPDATE ON public.matching_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_apify_runs_updated_at ON public.apify_actor_runs;
CREATE TRIGGER trg_apify_runs_updated_at
  BEFORE UPDATE ON public.apify_actor_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 12. Auth helper ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- ── 13. RLS ───────────────────────────────────────────────────
ALTER TABLE public.matching_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_actor_runs    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mj_service_all   ON public.matching_jobs;
DROP POLICY IF EXISTS mj_owner_select  ON public.matching_jobs;
DROP POLICY IF EXISTS mj_owner_insert  ON public.matching_jobs;
DROP POLICY IF EXISTS mj_anon_deny     ON public.matching_jobs;

CREATE POLICY mj_service_all  ON public.matching_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mj_owner_select ON public.matching_jobs
  FOR SELECT TO authenticated
  USING (user_id = public.auth_user_id());
CREATE POLICY mj_owner_insert ON public.matching_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.auth_user_id());
CREATE POLICY mj_anon_deny ON public.matching_jobs
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS mje_service_all  ON public.matching_job_events;
DROP POLICY IF EXISTS mje_owner_select ON public.matching_job_events;
DROP POLICY IF EXISTS mje_anon_deny    ON public.matching_job_events;

CREATE POLICY mje_service_all  ON public.matching_job_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mje_owner_select ON public.matching_job_events
  FOR SELECT TO authenticated
  USING (
    job_id IN (
      SELECT id FROM public.matching_jobs
      WHERE user_id = public.auth_user_id()
    )
  );
CREATE POLICY mje_anon_deny ON public.matching_job_events
  FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS aar_service_all ON public.apify_actor_runs;
DROP POLICY IF EXISTS aar_anon_deny   ON public.apify_actor_runs;
CREATE POLICY aar_service_all ON public.apify_actor_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY aar_anon_deny ON public.apify_actor_runs
  FOR ALL TO anon USING (false);

-- ── 14. Realtime ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.matching_jobs;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.matching_job_events;
EXCEPTION WHEN others THEN NULL; END $$;

-- ── 15. Helper RPCs ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_job_signals(
  p_job_id uuid, p_count integer
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.matching_jobs
  SET signals_collected = signals_collected + p_count,
      updated_at = now()
  WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.resolve_campaign_for_property(
  p_property_id uuid
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.matching_campaigns
  WHERE property_id = p_property_id
  ORDER BY created_at DESC LIMIT 1;
$$;
