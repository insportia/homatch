-- HOMATCH DESIGN STUDIO — PHOTOS ARE A SOURCE OF THEIR OWN.
--
-- A photo project is designed from the pictures themselves (OpenAI sees them
-- and the design is generated over them). It needs no reconstructed 3D home,
-- so its spatial source is a PHOTO_SET: the uploaded pictures (ds_floorplans
-- rows with purpose REFERENCE, through the reconstruction that read them)
-- plus what was understood from them, stored as provenance.
--
-- Additive only: one more allowed kind, and the payload rule for it (a READY
-- photo set names its reconstruction and at least one picture). Existing rows
-- and the other kinds are untouched. The runner owns the transaction.

DO $$
DECLARE c record;
BEGIN
  -- The inline CHECK on kind carries a generated name; find it by its text.
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ds_spatial_sources'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%DEVELOPER_UNIT%' AND pg_get_constraintdef(oid) NOT LIKE '%upstream%'
  LOOP
    EXECUTE format('ALTER TABLE public.ds_spatial_sources DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.ds_spatial_sources
  ADD CONSTRAINT ds_spatial_sources_kind_check
  CHECK (kind IN ('DEVELOPER_UNIT','UPLOADED_MODEL','FLOORPLAN_SCENE','PHOTO_SET'));

ALTER TABLE public.ds_spatial_sources DROP CONSTRAINT IF EXISTS ds_sources_payload;
ALTER TABLE public.ds_spatial_sources ADD CONSTRAINT ds_sources_payload CHECK (
  status IN ('PROCESSING','FAILED')
  OR (kind = 'FLOORPLAN_SCENE' AND canonical IS NOT NULL)
  OR (kind = 'UPLOADED_MODEL' AND model_object_key IS NOT NULL)
  OR (kind = 'DEVELOPER_UNIT' AND upstream IS NOT NULL)
  OR (kind = 'PHOTO_SET'
      AND provenance ? 'reconstructionId'
      AND jsonb_typeof(provenance->'referenceIds') = 'array'
      AND jsonb_array_length(provenance->'referenceIds') BETWEEN 1 AND 6));

COMMENT ON COLUMN public.ds_spatial_sources.kind IS
  'DEVELOPER_UNIT | UPLOADED_MODEL | FLOORPLAN_SCENE | PHOTO_SET (pictures of the space, designed over directly; created only by the service role).';
