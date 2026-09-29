-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — reconstruction from pictures of a home.
--
-- "I want this." A customer uploads one to six pictures of a home (a render,
-- photos, an isometric visualisation) — optionally with their own floor
-- plan — and HOMATCH reads them into structured scene data it can build.
--
-- THE PIECES
--   ds_floorplans (purpose = 'REFERENCE')
--       each uploaded picture: the customer's own file in R2, under the
--       same storage rules as a floor plan. The first picture's row carries
--       the READING of the plan (an estimated floor-plan document), so the
--       existing review, calibration and ds_create_floorplan_source path
--       builds the geometry — no second geometry path.
--   ds_reconstructions
--       one reading of those pictures: what HOMATCH saw (analysis — written
--       ONLY by the server), what the customer corrected (corrections —
--       theirs), and what was built from it (source and version).
--
-- TRUST
--   The model's reading arrives as a proposal. Nothing is geometry until the
--   customer reviews it; sizes are ESTIMATED until they calibrate. Pieces
--   become catalogue assets with their match and confidence kept; what a
--   piece can do in the walkthrough comes from the asset, never the picture.
--
-- Pushing this file applies nothing; it is applied through the deploy
-- workflow like every migration.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ds_reconstructions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The pictures, in the order the customer gave them (ds_floorplans rows, purpose REFERENCE).
  reference_ids    uuid[] NOT NULL CHECK (cardinality(reference_ids) BETWEEN 1 AND 6),
  -- With the customer's own floor plan: its built source gives the rooms, the pictures give the rest.
  plan_source_id   uuid REFERENCES public.ds_spatial_sources(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED','READING','READ','FAILED','BUILT')),
  analysis         jsonb CHECK (analysis IS NULL OR (jsonb_typeof(analysis) = 'object' AND octet_length(analysis::text) <= 1048576)),
  model            text,
  error            text,
  corrections      jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(corrections) = 'object' AND octet_length(corrections::text) <= 262144),
  built_source_id  uuid REFERENCES public.ds_spatial_sources(id) ON DELETE SET NULL,
  built_version_id uuid REFERENCES public.ds_versions(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_reconstructions_project ON public.ds_reconstructions(project_id, created_at DESC);
COMMENT ON TABLE public.ds_reconstructions IS
  'One reading of a customer''s pictures of a home into structured scene data. analysis is server-written; corrections are the customer''s.';

-- ── The guard: the browser may ask for a reading and correct it; only the server reads ──

CREATE OR REPLACE FUNCTION public.ds_reconstructions_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_ok integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ds_projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_PROJECT_NOT_OWNED';
    END IF;
    IF cardinality(NEW.reference_ids) > 6 THEN RAISE EXCEPTION 'DS_TOO_MANY_REFERENCES'; END IF;
    -- Every picture must be the owner's own reference upload in this project.
    SELECT count(DISTINCT f.id) INTO v_ok FROM public.ds_floorplans f
     WHERE f.id = ANY (NEW.reference_ids) AND f.project_id = NEW.project_id AND f.user_id = NEW.user_id AND f.purpose = 'REFERENCE';
    IF v_ok <> cardinality(NEW.reference_ids) THEN RAISE EXCEPTION 'DS_REFERENCE_NOT_OWNED'; END IF;
    IF NEW.plan_source_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ds_spatial_sources s
       WHERE s.id = NEW.plan_source_id AND s.project_id = NEW.project_id AND s.user_id = NEW.user_id AND s.status = 'READY') THEN
      RAISE EXCEPTION 'DS_SOURCE_NOT_OWNED';
    END IF;
    NEW.status := 'QUEUED';
    NEW.analysis := NULL;
    NEW.model := NULL;
    NEW.error := NULL;
    NEW.built_source_id := NULL;
    NEW.built_version_id := NULL;
  ELSE
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.reference_ids IS DISTINCT FROM OLD.reference_ids
       OR NEW.plan_source_id IS DISTINCT FROM OLD.plan_source_id
       OR NEW.analysis IS DISTINCT FROM OLD.analysis
       OR NEW.model IS DISTINCT FROM OLD.model
       OR NEW.error IS DISTINCT FROM OLD.error THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
    END IF;
    -- The only status a customer may set: a reading they built into a design.
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status IN ('READ','BUILT') AND NEW.status = 'BUILT') THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
    END IF;
    IF NEW.built_source_id IS DISTINCT FROM OLD.built_source_id AND NEW.built_source_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ds_spatial_sources s WHERE s.id = NEW.built_source_id AND s.project_id = NEW.project_id AND s.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_SOURCE_NOT_OWNED';
    END IF;
    IF NEW.built_version_id IS DISTINCT FROM OLD.built_version_id AND NEW.built_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ds_versions v WHERE v.id = NEW.built_version_id AND v.project_id = NEW.project_id AND v.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_VERSION_NOT_OWNED';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_reconstructions_guard ON public.ds_reconstructions;
CREATE TRIGGER trg_ds_reconstructions_guard
  BEFORE INSERT OR UPDATE ON public.ds_reconstructions
  FOR EACH ROW EXECUTE FUNCTION public.ds_reconstructions_guard();

-- ── Row security ──────────────────────────────────────────────────────

ALTER TABLE public.ds_reconstructions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ds_reconstructions_select ON public.ds_reconstructions;
CREATE POLICY ds_reconstructions_select ON public.ds_reconstructions
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_reconstructions_insert ON public.ds_reconstructions;
CREATE POLICY ds_reconstructions_insert ON public.ds_reconstructions
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_reconstructions_update ON public.ds_reconstructions;
CREATE POLICY ds_reconstructions_update ON public.ds_reconstructions
  FOR UPDATE USING (user_id = public.auth_user_id()) WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_reconstructions_delete ON public.ds_reconstructions;
CREATE POLICY ds_reconstructions_delete ON public.ds_reconstructions
  FOR DELETE USING (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_reconstructions_service ON public.ds_reconstructions;
CREATE POLICY ds_reconstructions_service ON public.ds_reconstructions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.ds_reconstructions FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ds_reconstructions TO authenticated;
GRANT ALL ON public.ds_reconstructions TO service_role;
REVOKE ALL ON FUNCTION public.ds_reconstructions_guard() FROM public, anon, authenticated;

