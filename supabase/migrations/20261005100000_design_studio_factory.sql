-- HOMATCH DESIGN STUDIO — the Blender scene factory's ledger and its private outputs.
--
-- A reconstruction (or a floor-plan design) is built by the Design Studio
-- scene factory: HOMATCH compiles its canonical scene into a validated
-- SceneBuildSpec, the factory (Blender, headless, on the GPU worker) builds
-- the home, renders it from the source picture's own camera, and exports it.
-- This records:
--
--   ds_factory_jobs     one factory pass: the spec it built (data only — no
--                       URLs, no secrets), its pass number in the visual-check
--                       loop, what the worker answered, its stage timings and
--                       its cost lines (each MEASURED / ESTIMATED /
--                       NOT_AVAILABLE). Idempotent per (project,
--                       idempotency_key): a retry never starts a second paid job.
--   ds_factory_assets   what a pass produced: the source-camera RENDER (a
--                       private JPEG), the whole home as a SCENE model per
--                       tier, and each walkthrough PIECE model. Content hash,
--                       size, tier, where it is stored. PROJECT_PRIVATE only:
--                       nothing built from a customer's picture or plan is
--                       ever a shared catalogue asset. Deduplicated by hash
--                       within the project.
--
-- The owner reads both; only the server writes. Deleting the project deletes
-- the rows (cascade) and its R2 prefixes (the existing project-delete route).

CREATE TABLE IF NOT EXISTS public.ds_factory_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reconstruction_id uuid REFERENCES public.ds_reconstructions(id) ON DELETE CASCADE,
  version_id        uuid REFERENCES public.ds_versions(id) ON DELETE SET NULL,
  source_kind       text NOT NULL CHECK (source_kind IN ('PICTURE','FLOOR_PLAN','DESIGN')),
  pass              smallint NOT NULL CHECK (pass BETWEEN 1 AND 3),
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  spec_sha256       text NOT NULL CHECK (spec_sha256 ~ '^[0-9a-f]{64}$'),
  engine_version    text NOT NULL,
  state             text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  provider          text NOT NULL,
  provider_job_id   text,
  spec              jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object' AND octet_length(spec::text) <= 1048576),
  result            jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 262144)),
  timings           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(timings) = 'object'),
  cost              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cost) = 'array'),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ds_factory_jobs_project ON public.ds_factory_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ds_factory_jobs_reconstruction ON public.ds_factory_jobs(reconstruction_id) WHERE reconstruction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ds_factory_assets (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES public.ds_factory_jobs(id) ON DELETE SET NULL,
  role        text NOT NULL CHECK (role IN ('RENDER','SCENE','PIECE')),
  tier        text NOT NULL CHECK (tier IN ('QA','DESKTOP','MOBILE','RUNTIME')),
  -- The walkthrough group a PIECE model stands for (identical pieces share one model).
  group_key   text CHECK (group_key IS NULL OR group_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  object_key  text NOT NULL,
  sha256      text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  bytes       bigint CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 104857600),
  facts       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts) = 'object' AND octet_length(facts::text) <= 16384),
  provider    text NOT NULL,
  scope       text NOT NULL DEFAULT 'PROJECT_PRIVATE' CHECK (scope = 'PROJECT_PRIVATE'),
  state       text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','FAILED','DELETED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'PIECE') = (group_key IS NOT NULL)),
  CHECK ((role = 'RENDER') = (tier = 'QA')),
  -- Always this project's own folder and this asset's id: models are glTF, a render is a private JPEG.
  CHECK (object_key = 'users/' || user_id::text || CASE WHEN role = 'RENDER'
         THEN '/design-studio-thumbnails/' || project_id::text || '/' || id::text || '.jpg'
         ELSE '/design-studio-models/' || project_id::text || '/' || id::text || '.glb' END)
);
CREATE INDEX IF NOT EXISTS idx_ds_factory_assets_project ON public.ds_factory_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_ds_factory_assets_job ON public.ds_factory_assets(job_id);
-- The same bytes are stored once per project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ds_factory_assets_project_sha ON public.ds_factory_assets(project_id, sha256) WHERE state = 'READY';

COMMENT ON TABLE public.ds_factory_jobs IS 'Design Studio scene factory: one Blender pass over a validated SceneBuildSpec (data only; no URLs or secrets), idempotent per project.';
COMMENT ON TABLE public.ds_factory_assets IS 'Design Studio scene factory outputs (source-camera render, scene tiers, walkthrough pieces). Project-private; never a shared catalogue asset.';

-- What the engine did for a reading: each object's route, stage timings, cost
-- lines, the visual checks and the fidelity gates. Written by the owner's own
-- build (the same row they already update); informational, never trusted for money.
ALTER TABLE public.ds_reconstructions ADD COLUMN IF NOT EXISTS engine_report jsonb
  CHECK (engine_report IS NULL OR (jsonb_typeof(engine_report) = 'object' AND octet_length(engine_report::text) <= 262144));

ALTER TABLE public.ds_factory_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_factory_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ds_factory_jobs_select ON public.ds_factory_jobs;
CREATE POLICY ds_factory_jobs_select ON public.ds_factory_jobs
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_factory_jobs_service ON public.ds_factory_jobs;
CREATE POLICY ds_factory_jobs_service ON public.ds_factory_jobs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS ds_factory_assets_select ON public.ds_factory_assets;
CREATE POLICY ds_factory_assets_select ON public.ds_factory_assets
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_factory_assets_service ON public.ds_factory_assets;
CREATE POLICY ds_factory_assets_service ON public.ds_factory_assets
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.ds_factory_jobs FROM public, anon, authenticated;
REVOKE ALL ON public.ds_factory_assets FROM public, anon, authenticated;
GRANT SELECT ON public.ds_factory_jobs TO authenticated;
GRANT SELECT ON public.ds_factory_assets TO authenticated;
GRANT ALL ON public.ds_factory_jobs TO service_role;
GRANT ALL ON public.ds_factory_assets TO service_role;

-- A public link carries the design, not how it was made: besides provenance,
-- a piece's factory-model reference (an owner-private storage key) is
-- stripped, so the shared view shows HOMATCH's drawn piece in its place.
CREATE OR REPLACE FUNCTION public.ds_create_share(
  p_version_id uuid,
  p_share_type text,
  p_label text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid       uuid := public.auth_user_id();
  v_version   record;
  v_source    record;
  v_project   record;
  v_hash      text;
  v_state     jsonb;
  v_published uuid;
  v_token     text;
  v_share     uuid;
  v_recent    integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DS_AUTH_REQUIRED'; END IF;
  IF p_share_type NOT IN ('WALKTHROUGH','DESIGN') THEN RAISE EXCEPTION 'DS_SHARE_TYPE'; END IF;
  IF p_expires_at IS NOT NULL AND (p_expires_at <= now() OR p_expires_at > now() + interval '3650 days') THEN
    RAISE EXCEPTION 'DS_SHARE_EXPIRY';
  END IF;

  SELECT v.id, v.project_id, v.source_id, v.state, v.archived_at INTO v_version
    FROM public.ds_versions v WHERE v.id = p_version_id AND v.user_id = v_uid;
  IF v_version.id IS NULL OR v_version.archived_at IS NOT NULL THEN RAISE EXCEPTION 'DS_VERSION_NOT_OWNED'; END IF;
  SELECT p.id, p.name, p.status INTO v_project FROM public.ds_projects p WHERE p.id = v_version.project_id;
  IF v_project.status <> 'ACTIVE' THEN RAISE EXCEPTION 'DS_PROJECT_ARCHIVED'; END IF;
  SELECT s.id, s.kind, s.status INTO v_source FROM public.ds_spatial_sources s WHERE s.id = v_version.source_id;
  -- Public delivery needs geometry that lives in the database (a floor-plan
  -- space). A private uploaded model or a developer scene is not published
  -- through a customer link.
  IF v_source.kind <> 'FLOORPLAN_SCENE' OR v_source.status NOT IN ('READY','SUPERSEDED') THEN
    RAISE EXCEPTION 'DS_SHARE_SOURCE_UNSUPPORTED';
  END IF;
  -- Only pieces HOMATCH may show publicly: its own concept blocks and
  -- models it owns. Licensed or partner models are not published by link.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_version.state->'objects', '[]'::jsonb)) o
      JOIN public.ds_catalog_assets a ON a.code = o->>'assetId'
     WHERE NOT a.is_placeholder AND a.provenance <> 'HOMATCH_OWNED') THEN
    RAISE EXCEPTION 'DS_SHARE_ASSET_NOT_PUBLIC';
  END IF;

  SELECT count(*) INTO v_recent FROM public.ds_shares
   WHERE user_id = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 500 THEN RAISE EXCEPTION 'DS_SHARE_RATE_LIMITED'; END IF;

  -- The public snapshot carries the design, not how it was made: where a
  -- piece came from (reference picture ids, match scores) stays private.
  v_state := CASE WHEN jsonb_typeof(v_version.state->'objects') = 'array'
    THEN jsonb_set(v_version.state, '{objects}',
      coalesce((SELECT jsonb_agg(o - 'provenance' - 'generated' ORDER BY n) FROM jsonb_array_elements(v_version.state->'objects') WITH ORDINALITY AS x(o, n)), '[]'::jsonb))
    ELSE v_version.state END;
  v_hash := encode(extensions.digest(v_state::text, 'sha256'), 'hex');
  INSERT INTO public.ds_published_designs (project_id, user_id, version_id, source_id, state, state_hash, title)
  VALUES (v_version.project_id, v_uid, v_version.id, v_version.source_id, v_state, v_hash, left(v_project.name, 80))
  ON CONFLICT (version_id, state_hash) DO NOTHING;
  SELECT id INTO v_published FROM public.ds_published_designs WHERE version_id = v_version.id AND state_hash = v_hash;

  -- 32 random bytes, URL-safe base64 without padding: 43 characters, 256 bits.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO public.ds_shares (token_hash, token_hint, published_id, project_id, user_id, share_type, label, expires_at)
  VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), right(v_token, 4), v_published, v_version.project_id, v_uid,
          p_share_type, nullif(btrim(left(coalesce(p_label, ''), 60)), ''), p_expires_at)
  RETURNING id INTO v_share;

  RETURN jsonb_build_object('id', v_share, 'token', v_token);
END $$;
REVOKE ALL ON FUNCTION public.ds_create_share(uuid, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_create_share(uuid, text, text, timestamptz) TO authenticated;
