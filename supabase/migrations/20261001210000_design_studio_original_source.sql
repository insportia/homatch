-- HOMATCH DESIGN STUDIO — the customer's original picture is kept, unchanged.
--
-- A picture larger than the reading size (2560 px on its longest side, or
-- 8 MB) was re-encoded in the browser and ONLY the smaller copy was uploaded:
-- the customer's original evidence was lost. From now on a picture row
-- records two objects:
--
--   object_key    the ANALYSIS image HOMATCH reads (unchanged meaning)
--   original_*    the ORIGINAL as the customer supplied it, immutable
--
-- When no derivative was needed the two are the same object. Rows written
-- before this keep NULL originals, which means "not recorded" — nothing is
-- back-filled or guessed.
--
-- The guard is the 20260930090000 body (verified identical to production,
-- prosrc md5 0ce8f342762912bfb4d9b8056d4ce938) with two additions: an
-- original must be the owner's own upload under this project's prefix (the
-- prefix permanent deletion sweeps), and the original fields never change.

ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_key text;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_mime text;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_bytes bigint;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_sha256 text;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_width integer;
ALTER TABLE public.ds_floorplans ADD COLUMN IF NOT EXISTS original_height integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_floorplans_original_check') THEN
    ALTER TABLE public.ds_floorplans ADD CONSTRAINT ds_floorplans_original_check CHECK (
      original_key IS NULL OR (
        original_mime IN ('image/png','image/jpeg','image/webp','application/pdf')
        AND original_bytes > 0 AND original_bytes <= 41943040
        AND (original_sha256 IS NULL OR original_sha256 ~ '^[0-9a-f]{64}$')
        AND (original_width IS NULL OR original_width > 0)
        AND (original_height IS NULL OR original_height > 0)
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN public.ds_floorplans.original_key IS
  'The customer''s original upload, immutable. object_key is the analysis image (the same object when no derivative was needed). NULL = not recorded (rows before 20261001210000).';

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
       OR NEW.original_height IS DISTINCT FROM OLD.original_height THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ds_floorplans_guard() FROM public, anon, authenticated;
