-- 20260829000001 content — apply idempotently
-- matching_jobs pipeline v2 (already partially applied; all guards in place)
DO $$ BEGIN
  CREATE TYPE public.matching_job_status AS ENUM (
    'queued','analysing_property','generating_queries',
    'searching_sources','collecting_results','normalizing',
    'deduplicating','classifying','ranking',
    'completed','partially_completed','failed','paused','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.matching_jobs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL,
  property_id              uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign_id              uuid        REFERENCES public.matching_campaigns(id) ON DELETE SET NULL,
  idempotency_key          text        NOT NULL UNIQUE,
  status                   public.matching_job_status NOT NULL DEFAULT 'queued',
  error_message            text,
  failure_reason           text,
  signals_collected        integer     NOT NULL DEFAULT 0,
  matches_created          integer     NOT NULL DEFAULT 0,
  queries_planned          integer     NOT NULL DEFAULT 0,
  queries_executed         integer     NOT NULL DEFAULT 0,
  provider_results         jsonb,
  started_at               timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matching_job_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL REFERENCES public.matching_jobs(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.apify_actor_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        REFERENCES public.matching_jobs(id) ON DELETE SET NULL,
  run_id      text,
  actor_id    text,
  dataset_id  text,
  platform    text,
  status      text,
  mock_mode   boolean     NOT NULL DEFAULT false,
  items_count integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- query_packs: add job_id column if missing
ALTER TABLE public.query_packs ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.matching_jobs(id) ON DELETE SET NULL;

-- raw_signals: add job_id, isMock columns if missing
ALTER TABLE public.raw_signals ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.matching_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.raw_signals ADD COLUMN IF NOT EXISTS mock_mode boolean NOT NULL DEFAULT false;

-- intent_profiles: add job_id, dedup_hash if missing
ALTER TABLE public.intent_profiles ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.matching_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.intent_profiles ADD COLUMN IF NOT EXISTS dedup_hash text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_matching_jobs_property ON public.matching_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_matching_jobs_status ON public.matching_jobs(status);
CREATE INDEX IF NOT EXISTS idx_matching_job_events_job ON public.matching_job_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_apify_runs_job ON public.apify_actor_runs(job_id);

-- RLS
ALTER TABLE public.matching_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_actor_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users see own jobs" ON public.matching_jobs FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users see own job events" ON public.matching_job_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.matching_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access matching_jobs" ON public.matching_jobs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access job_events" ON public.matching_job_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access apify_runs" ON public.apify_actor_runs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;