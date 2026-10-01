-- HOMATCH DESIGN STUDIO — a picture's own geometry, measured from its pixels.
--
-- An isometric / dollhouse render of a whole home is an orthographic view,
-- and its camera can be MEASURED from the picture (the vertical, the two
-- floor directions and their ratio, the wall height, the outline at floor
-- level). The browser measures it at upload, from the analysis image, and
-- renders a top-down PLAN VIEW of the picture from it. The reader then traces
-- rooms on the plan view, so an L-shaped home is rebuilt as an L instead of
-- the rectangle a model's guess in metres tends to draw.
--
--   picture_geometry  the measured frame (pictureFrame.ts, v 1), bounded
--   plan_view_key     the plan view image, under this project's prefix
--
-- Both or neither. Both are evidence about the customer's own picture: the
-- owner's upload writes them once, and they never change. The server reads
-- the frame through its own validator (readFrame) and uses it only for the
-- owner's own reconstruction; a malformed one is ignored, never repaired.
-- Rows before this keep NULL (read as before; nothing is back-filled).
--
-- The guard is the 20261001210000 body (applied to production) with the
-- plan view's prefix check and the two new immutable fields.

ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS plan_view_key text;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS picture_geometry jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_floorplans_picture_geometry_check') THEN
    ALTER TABLE public.ds_floorplans ADD CONSTRAINT ds_floorplans_picture_geometry_check CHECK (
      (plan_view_key IS NULL) = (picture_geometry IS NULL)
      AND (picture_geometry IS NULL OR (
        jsonb_typeof(picture_geometry) = 'object'
        AND picture_geometry->'v' = '1'::jsonb
        AND octet_length(picture_geometry::text) <= 16384
      ))
    );
  END IF;
END $$;

COMMENT ON COLUMN public.ds_floorplans.picture_geometry IS
  'The picture''s camera and outline measured from its pixels (pictureFrame.ts v1), immutable; with plan_view_key, its top-down plan view. NULL = not measured.';

CREATE OR REPLACE FUNCTION public.ds_floorplans_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ds_projects p
                    WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_PROJECT_NOT_OWNED';
    END IF;
    -- The key the browser reports must be the owner's own upload for this
    -- project (users/<user>/design-studio-floorplans/<project>/<file>).
    IF left(NEW.object_key, char_length('users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'))
         <> 'users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'
       OR position('..' in NEW.object_key) > 0 THEN
      RAISE EXCEPTION 'DS_OBJECT_KEY_INVALID';
    END IF;
    -- So must the original, when one is recorded.
    IF NEW.original_key IS NOT NULL AND (
         left(NEW.original_key, char_length('users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'))
           <> 'users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'
         OR position('..' in NEW.original_key) > 0) THEN
      RAISE EXCEPTION 'DS_OBJECT_KEY_INVALID';
    END IF;
    -- So must the plan view, when one is recorded.
    IF NEW.plan_view_key IS NOT NULL AND (
         left(NEW.plan_view_key, char_length('users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'))
           <> 'users/' || NEW.user_id::text || '/design-studio-floorplans/' || NEW.project_id::text || '/'
         OR position('..' in NEW.plan_view_key) > 0) THEN
      RAISE EXCEPTION 'DS_OBJECT_KEY_INVALID';
    END IF;
    NEW.status := 'UPLOADED';
    NEW.interpretation := NULL;
    NEW.interpretation_model := NULL;
    NEW.interpretation_error := NULL;
  ELSE
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.object_key IS DISTINCT FROM OLD.object_key
       OR NEW.mime IS DISTINCT FROM OLD.mime
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.bytes IS DISTINCT FROM OLD.bytes
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.interpretation IS DISTINCT FROM OLD.interpretation
       OR NEW.interpretation_model IS DISTINCT FROM OLD.interpretation_model
       OR NEW.interpretation_error IS DISTINCT FROM OLD.interpretation_error
       -- The original is evidence: it never changes after it is recorded.
       OR NEW.original_key IS DISTINCT FROM OLD.original_key
       OR NEW.original_mime IS DISTINCT FROM OLD.original_mime
       OR NEW.original_bytes IS DISTINCT FROM OLD.original_bytes
       OR NEW.original_sha256 IS DISTINCT FROM OLD.original_sha256
       OR NEW.original_width IS DISTINCT FROM OLD.original_width
       OR NEW.original_height IS DISTINCT FROM OLD.original_height
       -- So is what was measured from it.
       OR NEW.plan_view_key IS DISTINCT FROM OLD.plan_view_key
       OR NEW.picture_geometry IS DISTINCT FROM OLD.picture_geometry THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ds_floorplans_guard() FROM public, anon, authenticated;
