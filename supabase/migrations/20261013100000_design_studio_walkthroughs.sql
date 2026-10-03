-- HOMATCH DESIGN STUDIO — THE 3D WALKTHROUGH, OWNED BY THE SERVER.
--
-- A walkthrough is made from one approved design (a design version, its
-- Design Specification and its floor plan) and belongs to it:
--
--   QUEUED → PLANNING (OpenAI scene plan → catalogue matching → spatial
--   validation → finishes; the walkable design is saved as its own version)
--   → SUBMITTED (one Blender factory pass at RunPod, its job id recorded the
--   moment RunPod accepts it) → RUNNING → PROCESSING_RESULT (every output
--   re-read, hashed and inspected) → READY;  or FAILED / CANCELLED, with the
--   reason.
--
-- Nothing here depends on a page being open. Every step is a compare-and-set
-- claim with a bounded lease (lease_at); a claim whose worker died lapses and
-- the next driver takes it over. The drivers are the request that created it
-- (in the background), any status poll, and the reconciler below, every
-- minute — which also settles factory jobs nobody is watching any more.
-- Attempts are counted per step and bounded; a provider job that outlives
-- its deadline is cancelled at the provider and recorded as such.
--
-- Identity: one walkthrough per (project, design version, its state revision,
-- walkthrough revision): a double click, a reload, a second tab or a retried
-- request finds the same row, and therefore the same RunPod job. A NEW
-- walkthrough of the same design is only ever an explicit request (revision+1);
-- the earlier ones stay viewable.
--
-- Customer billing stays off: cost lines are internal COGS (OpenAI scene
-- planning, GPU seconds, storage), never a charge.

CREATE TABLE IF NOT EXISTS public.ds_walkthroughs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  design_version_id uuid NOT NULL REFERENCES public.ds_versions(id) ON DELETE CASCADE,
  source_id         uuid REFERENCES public.ds_spatial_sources(id) ON DELETE SET NULL,
  spec_job_id       uuid REFERENCES public.ds_jobs(id) ON DELETE SET NULL,
  render_id         uuid,
  revision          integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 50),
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  state             text NOT NULL DEFAULT 'QUEUED'
                    CHECK (state IN ('QUEUED', 'PLANNING', 'SUBMITTED', 'RUNNING', 'PROCESSING_RESULT', 'READY', 'FAILED', 'CANCELLED')),
  stage             text,
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  plan_attempts     integer NOT NULL DEFAULT 0 CHECK (plan_attempts >= 0),
  submit_attempts   integer NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
  result_attempts   integer NOT NULL DEFAULT 0 CHECK (result_attempts >= 0),
  lease_at          timestamptz,
  next_check_at     timestamptz NOT NULL DEFAULT now(),
  deadline_at       timestamptz,
  scene_plan        jsonb CHECK (scene_plan IS NULL OR (jsonb_typeof(scene_plan) = 'object' AND octet_length(scene_plan::text) <= 262144)),
  plan_report       jsonb CHECK (plan_report IS NULL OR (jsonb_typeof(plan_report) = 'object' AND octet_length(plan_report::text) <= 262144)),
  walk_version_id   uuid REFERENCES public.ds_versions(id) ON DELETE SET NULL,
  factory_job_id    uuid REFERENCES public.ds_factory_jobs(id) ON DELETE SET NULL,
  provider_job_id   text,
  error             text,
  cost              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cost) = 'array'),
  timings           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(timings) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  ready_at          timestamptz,
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ds_walkthroughs_version ON public.ds_walkthroughs(design_version_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_ds_walkthroughs_due ON public.ds_walkthroughs(next_check_at)
  WHERE state IN ('QUEUED', 'PLANNING', 'SUBMITTED', 'RUNNING', 'PROCESSING_RESULT');

COMMENT ON TABLE public.ds_walkthroughs IS 'Design Studio 3D walkthroughs: server-owned lifecycle (leases, bounded attempts, deadline), one per design version and revision; the walkable design is walk_version_id.';

ALTER TABLE public.ds_walkthroughs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ds_walkthroughs_select ON public.ds_walkthroughs;
CREATE POLICY ds_walkthroughs_select ON public.ds_walkthroughs
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_walkthroughs_service ON public.ds_walkthroughs;
CREATE POLICY ds_walkthroughs_service ON public.ds_walkthroughs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.ds_walkthroughs FROM public, anon, authenticated;
GRANT SELECT ON public.ds_walkthroughs TO authenticated;
GRANT ALL ON public.ds_walkthroughs TO service_role;

-- A factory job nobody watches any more is still settled: when the reconciler
-- last asked the provider, and what the provider said (an audit, not a state).
ALTER TABLE public.ds_factory_jobs ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE public.ds_factory_jobs ADD COLUMN IF NOT EXISTS provider_status text;
CREATE INDEX IF NOT EXISTS idx_ds_factory_jobs_open ON public.ds_factory_jobs(updated_at)
  WHERE state IN ('QUEUED', 'RUNNING');

-- ── The reconciler: every minute, server-side, no page involved ──────────────
--
-- pg_cron → net.http_post → design-studio-reconstruct/walkthrough-tick.
-- x-cron-token is a random value held in Vault and checked inside the function
-- (ds_walkthrough_token_ok answers yes/no, never the value). The function is
-- JWT-verified at the gateway, so the call also carries the project's public
-- anon key, read from Vault (`ds_gateway_anon_key`, set once by the operator;
-- it is the same public key the web app ships). Until that is set the call is
-- refused at the gateway and nothing happens — the walkthrough still advances
-- while anyone polls it.
DO $$
BEGIN
  IF to_regproc('vault.create_secret') IS NULL THEN
    RAISE NOTICE 'vault is not installed; walkthrough reconciler not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ds_walkthrough_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'ds_walkthrough_token',
      'x-cron-token for the Design Studio walkthrough reconciler (pg_cron → edge function)');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ds_walkthrough_token_ok(p_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_expected text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v_expected FROM vault.decrypted_secrets
   WHERE name = 'ds_walkthrough_token' LIMIT 1;
  RETURN v_expected IS NOT NULL AND v_expected = p_token;
END $$;
REVOKE ALL ON FUNCTION public.ds_walkthrough_token_ok(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ds_walkthrough_token_ok(text) TO service_role;

DO $$
BEGIN
  IF to_regproc('vault.create_secret') IS NULL OR to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'homatch-ds-walkthrough-reconciler') THEN
    PERFORM cron.unschedule('homatch-ds-walkthrough-reconciler');
  END IF;
  PERFORM cron.schedule(
    'homatch-ds-walkthrough-reconciler',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/design-studio-reconstruct/walkthrough-tick',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ds_gateway_anon_key' limit 1), ''),
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'ds_walkthrough_token' limit 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
END $$;
