-- HOMATCH DESIGN STUDIO — a factory pass renders planned views, each with its object map.
--
-- A SceneBuildSpec may now carry `views` (a dollhouse master view and
-- eye-level room views, planned elsewhere). For every view the factory writes
-- three files, each a ds_factory_assets row of this pass, grouped by the
-- view's id (group_key):
--
--   VIEW         the picture, a private JPEG        …/design-studio-thumbnails/<project>/<id>.jpg
--   VIEW_IDS     its id image, a lossless PNG       …/design-studio-thumbnails/<project>/<id>.png
--   VIEW_LEGEND  which target each colour is, JSON  …/design-studio-thumbnails/<project>/<id>.json
--
-- tier 'VIEW' for all three. Everything else about the table is unchanged:
-- the server alone writes rows, the owner reads them (RLS untouched), every
-- key is this project's own folder and this asset's own id.
--
-- The 20261005100000 checks on role / tier / group / key were unnamed (and so
-- named by Postgres); they are found by what they check and replaced by named
-- ones that admit the three view roles. Existing rows satisfy both versions.
-- Idempotent: re-applying drops and re-adds the same named checks.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.ds_factory_assets'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\m(role|tier)\M'
  LOOP
    EXECUTE format('ALTER TABLE public.ds_factory_assets DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.ds_factory_assets
  ADD CONSTRAINT ds_factory_assets_role_check
    CHECK (role IN ('RENDER','SCENE','PIECE','VIEW','VIEW_IDS','VIEW_LEGEND')),
  ADD CONSTRAINT ds_factory_assets_tier_check
    CHECK (tier IN ('QA','DESKTOP','MOBILE','RUNTIME','VIEW')),
  -- A piece names its walkthrough group; a view's files name their view.
  ADD CONSTRAINT ds_factory_assets_group_role_check
    CHECK ((role IN ('PIECE','VIEW','VIEW_IDS','VIEW_LEGEND')) = (group_key IS NOT NULL)),
  ADD CONSTRAINT ds_factory_assets_render_tier_check
    CHECK ((role = 'RENDER') = (tier = 'QA')),
  ADD CONSTRAINT ds_factory_assets_view_tier_check
    CHECK ((role IN ('VIEW','VIEW_IDS','VIEW_LEGEND')) = (tier = 'VIEW')),
  -- Always this project's own folder and this asset's id: models are glTF, pictures private.
  ADD CONSTRAINT ds_factory_assets_key_check
    CHECK (object_key = 'users/' || user_id::text || CASE role
      WHEN 'RENDER'      THEN '/design-studio-thumbnails/' || project_id::text || '/' || id::text || '.jpg'
      WHEN 'VIEW'        THEN '/design-studio-thumbnails/' || project_id::text || '/' || id::text || '.jpg'
      WHEN 'VIEW_IDS'    THEN '/design-studio-thumbnails/' || project_id::text || '/' || id::text || '.png'
      WHEN 'VIEW_LEGEND' THEN '/design-studio-thumbnails/' || project_id::text || '/' || id::text || '.json'
      ELSE '/design-studio-models/' || project_id::text || '/' || id::text || '.glb' END);

COMMENT ON TABLE public.ds_factory_assets IS 'Design Studio scene factory outputs (source-camera render, planned views with their id images and legends, scene tiers, walkthrough pieces). Project-private; never a shared catalogue asset.';
