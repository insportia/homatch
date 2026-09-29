-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — the foundation data domain.
--
-- Design Studio answers "now that I have THIS space, let me design it". It
-- is a customer product and deliberately NOT the Developer Digital Twin:
--
--   Developer Digital Twin   PROJECT → BUILDING → FLOOR → UNIT → APARTMENT
--   Design Studio            SPACE → DESIGN → VERSIONS → COMPARE → WALKTHROUGH
--
-- THE ONE RULE THIS SCHEMA EXISTS TO ENFORCE
--
-- A spatial source (the apartment itself) and a design version (what the
-- customer did to it) are different rows in different tables. Changing a
-- sofa, a wall colour or the lighting writes a design version; it never
-- writes geometry, and it never writes anything in dt_* / dev_*. A developer
-- unit used as a source is referenced, pinned to the version that was
-- published when the customer picked it, and read through the same public
-- dt_unit_scene() any anonymous viewer uses. Nothing here grants a customer
-- a single new privilege over developer data.
--
-- GEOMETRY TRUTH
--
--   ESTIMATED   proportions read from a drawing; scale inferred, not known
--   CALIBRATED  the customer supplied a real-world anchor (area, a wall)
--   VERIFIED    trusted source data (published developer geometry), or at
--               least two independent customer measurements that agree
--               with the built geometry — checked by the database against
--               the geometry itself, not taken on the browser's word
--
-- These are Design Studio's own states. The Developer floor-plan gate
-- (evaluateGate) is untouched and stays exactly as strict as it was.
--
-- WRITES
--
-- Customers write their own projects, floor-plan uploads, design versions,
-- change history and saved views under RLS. Spatial sources are created only
-- through the SECURITY DEFINER functions below (or service_role), because a
-- source row is a claim about truth — "this geometry is VERIFIED" — and a
-- browser must not be able to assert that by inserting a row.
--
-- Pushing this file applies nothing. It is applied deliberately through the
-- deploy workflow like every other migration.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. PROJECTS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ds_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- The HOMATCH property this design is about, when there is one. Must be
  -- the caller's own (enforced by the guard below, not trusted from the row).
  property_id      uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  -- A published developer unit this design personalises, when there is one.
  dev_unit_id      uuid REFERENCES public.dev_units(id) ON DELETE SET NULL,
  active_source_id uuid,  -- FK added after ds_spatial_sources
  head_version_id  uuid,  -- FK added after ds_versions
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  thumbnail_key    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ds_projects_user ON public.ds_projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ds_projects_property ON public.ds_projects(property_id) WHERE property_id IS NOT NULL;
COMMENT ON TABLE public.ds_projects IS
  'Design Studio project: one customer designing one space. Owns versions; references (never owns) its spatial source.';

-- ── 2. CUSTOMER FLOOR PLANS ────────────────────────────────────────────
--
-- Customer-owned, and deliberately NOT dt_floorplans: that table belongs to
-- developer workspaces and its access rules cannot express a customer.
-- The interpretation is written only by the server (the AI reads the
-- drawing); the customer writes corrections and calibration anchors.

CREATE TABLE IF NOT EXISTS public.ds_floorplans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  object_key           text NOT NULL,
  mime                 text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
  bytes                bigint NOT NULL CHECK (bytes > 0 AND bytes <= 26214400),
  sha256               text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  image_width          integer CHECK (image_width IS NULL OR image_width > 0),
  image_height         integer CHECK (image_height IS NULL OR image_height > 0),
  status               text NOT NULL DEFAULT 'UPLOADED'
                         CHECK (status IN ('UPLOADED','INTERPRETING','INTERPRETED','FAILED')),
  interpretation       jsonb,
  interpretation_model text,
  interpretation_error text,
  corrections          jsonb NOT NULL DEFAULT '[]'::jsonb
                         CHECK (jsonb_typeof(corrections) = 'array'),
  -- PLAN: a drawn floor plan. REFERENCE: a picture of the home (a render, a
  -- photo) read by the reconstruction; its reading is an estimated plan in
  -- the same document shape, so review, calibration and geometry are shared.
  purpose              text NOT NULL DEFAULT 'PLAN' CHECK (purpose IN ('PLAN','REFERENCE')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_floorplans_project ON public.ds_floorplans(project_id, created_at DESC);

-- ── 3. SPATIAL SOURCES ─────────────────────────────────────────────────
--
-- The space itself. Immutable once READY: a recalibration, a newer
-- developer publication or a re-uploaded model is a NEW source row that
-- supersedes the old one, so every design version keeps pointing at the
-- exact geometry it was made against.

CREATE TABLE IF NOT EXISTS public.ds_spatial_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('DEVELOPER_UNIT','UPLOADED_MODEL','FLOORPLAN_SCENE')),
  status            text NOT NULL DEFAULT 'READY'
                      CHECK (status IN ('PROCESSING','READY','FAILED','SUPERSEDED')),
  geometry_state    text NOT NULL CHECK (geometry_state IN ('ESTIMATED','CALIBRATED','VERIFIED')),
  -- What the customer may truthfully edit. UNCLASSIFIED until analysed;
  -- a baked single-mesh model is VISUAL_MODEL and is never presented as
  -- having independently editable furniture.
  editability       text NOT NULL DEFAULT 'UNCLASSIFIED'
                      CHECK (editability IN ('FULLY_STRUCTURED','PARTIALLY_STRUCTURED','VISUAL_MODEL','GENERATED','UNCLASSIFIED')),
  dev_unit_id       uuid REFERENCES public.dev_units(id) ON DELETE SET NULL,
  -- The developer publication this source was pinned to: {scene_id, version}.
  upstream          jsonb,
  floorplan_id      uuid REFERENCES public.ds_floorplans(id) ON DELETE SET NULL,
  model_object_key  text,
  model_sha256      text CHECK (model_sha256 IS NULL OR model_sha256 ~ '^[0-9a-f]{64}$'),
  model_bytes       bigint CHECK (model_bytes IS NULL OR model_bytes > 0),
  model_mime        text CHECK (model_mime IS NULL OR model_mime IN ('model/gltf-binary','model/gltf+json')),
  -- The canonical spatial model (rooms, walls, openings in metres) when the
  -- source has one; for a model upload, its semantic analysis.
  canonical         jsonb CHECK (canonical IS NULL OR (jsonb_typeof(canonical) = 'object'
                                   AND octet_length(canonical::text) <= 2097152)),
  calibration       jsonb,
  generator_version text,
  provenance        jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure           text,
  supersedes_id     uuid REFERENCES public.ds_spatial_sources(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A READY source carries the thing it claims to be. An empty "ready"
  -- source would open as a blank workspace, which is a lie about the space.
  CONSTRAINT ds_sources_payload CHECK (
    status IN ('PROCESSING','FAILED')
    OR (kind = 'FLOORPLAN_SCENE' AND canonical IS NOT NULL)
    OR (kind = 'UPLOADED_MODEL' AND model_object_key IS NOT NULL)
    OR (kind = 'DEVELOPER_UNIT' AND upstream IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_ds_sources_project ON public.ds_spatial_sources(project_id, created_at DESC);
COMMENT ON TABLE public.ds_spatial_sources IS
  'The space a design is made against. Immutable once READY; created only by ds_* SECURITY DEFINER functions or service_role.';

ALTER TABLE public.ds_projects
  DROP CONSTRAINT IF EXISTS ds_projects_active_source_fk;
ALTER TABLE public.ds_projects
  ADD CONSTRAINT ds_projects_active_source_fk
  FOREIGN KEY (active_source_id) REFERENCES public.ds_spatial_sources(id) ON DELETE SET NULL;

-- ── 4. DESIGN VERSIONS ─────────────────────────────────────────────────
--
-- A version's `state` is the DESIGN over the source — object instances
-- (asset references + transforms), surface assignments, lighting, palette,
-- locks — never geometry. It is small by construction; version 18 of a
-- 50 MB apartment is a few kilobytes.
--
-- `revision` is the autosave concurrency token: it is advanced by the
-- trigger whenever `state` changes, so a save that says "I edited revision
-- 7" and finds 8 knows another tab got there first.

CREATE TABLE IF NOT EXISTS public.ds_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_id      uuid NOT NULL REFERENCES public.ds_spatial_sources(id) ON DELETE CASCADE,
  parent_id      uuid REFERENCES public.ds_versions(id) ON DELETE SET NULL,
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  origin         text NOT NULL DEFAULT 'USER'
                   CHECK (origin IN ('ORIGINAL','USER','AI','DUPLICATE','BRANCH','RESTORE')),
  state          jsonb NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 1048576),
  state_schema   integer NOT NULL DEFAULT 1,
  revision       integer NOT NULL DEFAULT 0,
  style_tags     text[] NOT NULL DEFAULT '{}',
  change_summary jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(change_summary) = 'array'),
  thumbnail_key  text,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_versions_project ON public.ds_versions(project_id, created_at);

ALTER TABLE public.ds_projects
  DROP CONSTRAINT IF EXISTS ds_projects_head_version_fk;
ALTER TABLE public.ds_projects
  ADD CONSTRAINT ds_projects_head_version_fk
  FOREIGN KEY (head_version_id) REFERENCES public.ds_versions(id) ON DELETE SET NULL;

-- Append-only operation history: what was applied to which revision, by
-- whom (user / AI plan), as the structured operations themselves.
CREATE TABLE IF NOT EXISTS public.ds_version_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES public.ds_versions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  revision    integer NOT NULL,
  origin      text NOT NULL CHECK (origin IN ('USER','AI','SYSTEM')),
  ops         jsonb NOT NULL CHECK (jsonb_typeof(ops) = 'array' AND octet_length(ops::text) <= 262144),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_version_events_version ON public.ds_version_events(version_id, created_at);

-- ── 5. SAVED VIEWS ─────────────────────────────────────────────────────
-- Per project, not per version: the point of a saved view is to look at
-- Version A and Version B from the SAME place.

CREATE TABLE IF NOT EXISTS public.ds_saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  camera     jsonb NOT NULL CHECK (jsonb_typeof(camera) = 'object'),
  room_id    text,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_saved_views_project ON public.ds_saved_views(project_id, sort);

-- ── 6. CATALOG (shared, admin-managed) ─────────────────────────────────
--
-- Built for thousands of rows: the library browses metadata and thumbnails
-- only, and a model is fetched when it is placed. One canonical model per
-- asset for everybody — a design references asset ids, it never copies a
-- file.
--
-- `is_placeholder` marks HOMATCH's internal development blocks (procedural
-- stand-ins used to prove placement, collision and versioning). They are
-- labelled as concept blocks in the product and are never presented as a
-- catalogue of real furniture. `commerce` stays NULL unless an asset truly
-- maps to a purchasable product; a design asset is not a product.

CREATE TABLE IF NOT EXISTS public.ds_catalog_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9._/-]{1,79}$'),
  name           text NOT NULL,
  category       text NOT NULL,
  subcategory    text,
  room_kinds     text[] NOT NULL DEFAULT '{}',
  style_tags     text[] NOT NULL DEFAULT '{}',
  color_tags     text[] NOT NULL DEFAULT '{}',
  material_tags  text[] NOT NULL DEFAULT '{}',
  width_m        numeric(6,3) NOT NULL CHECK (width_m > 0 AND width_m <= 20),
  depth_m        numeric(6,3) NOT NULL CHECK (depth_m > 0 AND depth_m <= 20),
  height_m       numeric(6,3) NOT NULL CHECK (height_m > 0 AND height_m <= 10),
  placement      text NOT NULL DEFAULT 'FLOOR' CHECK (placement IN ('FLOOR','WALL','CEILING','SURFACE')),
  -- Placement rule: how it prefers to sit in a room (see interior engine).
  anchor         text NOT NULL DEFAULT 'WALL' CHECK (anchor IN ('WALL','CENTRE','CORNER','FREE')),
  clearance_m    numeric(4,2) NOT NULL DEFAULT 0 CHECK (clearance_m >= 0 AND clearance_m <= 3),
  -- Procedural shape for placeholders ({kind:'SOFA',...}); NULL for real models.
  procedural     jsonb,
  -- What the design may do with the piece and what it offers a visitor
  -- (sit, switch, open…), and how its living parts behave in the walkthrough
  -- (hinges, slides, switches, state machines, seats; a model names its
  -- parts ix:<id>). The walkthrough performs only what is declared AND permitted.
  capabilities   text[] NOT NULL DEFAULT '{MOVABLE,ROTATABLE,REPLACEABLE,DUPLICATABLE}'
                   CHECK (capabilities <@ ARRAY['MOVABLE','ROTATABLE','REPLACEABLE','DUPLICATABLE','HIDEABLE',
                     'OPENABLE','SLIDABLE','SITTABLE','LIEABLE','SWITCHABLE','DIMMABLE','PICKABLE','PLACEABLE',
                     'POURABLE','DRINKABLE','COOKABLE','WASHABLE','INTERACTIVE']::text[]),
  interactions   jsonb NOT NULL DEFAULT '[]'::jsonb
                   CHECK (jsonb_typeof(interactions) = 'array' AND jsonb_array_length(interactions) <= 24),
  model_key      text,
  model_sha256   text,
  model_bytes    bigint,
  lods           jsonb NOT NULL DEFAULT '[]'::jsonb,
  triangles      integer CHECK (triangles IS NULL OR triangles >= 0),
  texture_bytes  bigint CHECK (texture_bytes IS NULL OR texture_bytes >= 0),
  thumbnail_key  text,
  material_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants       jsonb NOT NULL DEFAULT '[]'::jsonb,
  dominant_colors text[] NOT NULL DEFAULT '{}',
  provenance     text NOT NULL CHECK (provenance IN ('HOMATCH_DEV_PLACEHOLDER','HOMATCH_OWNED','LICENSED','PARTNER')),
  license        jsonb,
  is_placeholder boolean NOT NULL DEFAULT false,
  commerce       jsonb,
  active         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A real model requires a file; a placeholder requires a procedural shape.
  CONSTRAINT ds_catalog_assets_shape CHECK (
    (is_placeholder AND procedural IS NOT NULL AND provenance = 'HOMATCH_DEV_PLACEHOLDER')
    OR (NOT is_placeholder AND model_key IS NOT NULL AND provenance <> 'HOMATCH_DEV_PLACEHOLDER'))
);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_assets_browse ON public.ds_catalog_assets(category, active);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_assets_rooms ON public.ds_catalog_assets USING gin(room_kinds);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_assets_styles ON public.ds_catalog_assets USING gin(style_tags);

CREATE TABLE IF NOT EXISTS public.ds_catalog_materials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9._/-]{1,79}$'),
  name           text NOT NULL,
  category       text NOT NULL CHECK (category IN ('WALL','FLOOR','CEILING','WOOD','STONE','TILE','METAL','FABRIC','GLASS','KITCHEN','BATHROOM')),
  applies_to     text[] NOT NULL DEFAULT '{}',   -- surface kinds: WALL, FLOOR, CEILING, OBJECT
  style_tags     text[] NOT NULL DEFAULT '{}',
  color_family   text,
  -- Physically based parameters the renderer understands:
  -- {baseColor:'#rrggbb', roughness, metalness, maps:{albedo,normal,roughness}, repeatM, rotationDeg}
  pbr            jsonb NOT NULL CHECK (jsonb_typeof(pbr) = 'object'),
  thumbnail_key  text,
  texture_bytes  bigint CHECK (texture_bytes IS NULL OR texture_bytes >= 0),
  provenance     text NOT NULL CHECK (provenance IN ('HOMATCH_DEV_PLACEHOLDER','HOMATCH_OWNED','LICENSED','PARTNER')),
  is_placeholder boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_materials_browse ON public.ds_catalog_materials(category, active);

-- A style is a structured design profile, not a filter:
-- {palette:[...], materials:{wall,floor,...}, furnitureTags:[...], lighting:{kelvin,mood},
--  decorDensity, woodTone, metalFinish, textile}
CREATE TABLE IF NOT EXISTS public.ds_styles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name       text NOT NULL,
  profile    jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  sort       integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ds_palettes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name       text NOT NULL,
  colors     jsonb NOT NULL CHECK (jsonb_typeof(colors) = 'array'),
  tags       text[] NOT NULL DEFAULT '{}',
  sort       integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 7. JOBS ────────────────────────────────────────────────────────────
-- Asynchronous work (floor-plan interpretation, model ingestion, AI design
-- plans, later renders). Written by edge functions; read by the owner and
-- by Admin. `billing` records the reservation when an operation is paid.

CREATE TABLE IF NOT EXISTS public.ds_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('FLOORPLAN_INTERPRET','MODEL_INGEST','AI_DESIGN','RENDER','RECONSTRUCT')),
  status      text NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  input       jsonb NOT NULL DEFAULT '{}'::jsonb,
  output      jsonb,
  error       text,
  model       text,
  billing     jsonb,
  -- Measured provider cost in cents; fractional (cheap AI runs cost less
  -- than a cent). NULL means unknown, never zero.
  cost_cents  numeric(12,4) CHECK (cost_cents IS NULL OR cost_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ds_jobs_user ON public.ds_jobs(user_id, created_at DESC);

-- A version or an operation record that says "AI" names the AI job whose
-- proposal the customer accepted; without one the claim is refused.
ALTER TABLE public.ds_versions ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.ds_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.ds_version_events ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.ds_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ds_jobs_status ON public.ds_jobs(kind, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- GUARDS
-- ═══════════════════════════════════════════════════════════════════════

-- Projects: a property must be the caller's own, a developer unit must be
-- published, and the active source / head version must belong to THIS
-- project. Checked here rather than trusted from the row.
CREATE OR REPLACE FUNCTION public.ds_projects_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.active_source_id := NULL;
    NEW.head_version_id := NULL;
    NEW.status := 'ACTIVE';
    NEW.archived_at := NULL;
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'DS_OWNER_IMMUTABLE';
    END IF;
  END IF;

  IF NEW.property_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.properties p
       WHERE p.id = NEW.property_id AND p.user_id = NEW.user_id AND NOT p.is_deleted) THEN
      RAISE EXCEPTION 'DS_PROPERTY_NOT_OWNED';
    END IF;
  END IF;

  IF NEW.dev_unit_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.dev_unit_id IS DISTINCT FROM OLD.dev_unit_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.dev_units u
        JOIN public.dev_projects dp ON dp.id = u.project_id
       WHERE u.id = NEW.dev_unit_id AND u.is_published AND dp.is_published) THEN
      RAISE EXCEPTION 'DS_UNIT_NOT_PUBLISHED';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.active_source_id IS NOT NULL AND NEW.active_source_id IS DISTINCT FROM OLD.active_source_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.ds_spatial_sources s
         WHERE s.id = NEW.active_source_id AND s.project_id = NEW.id AND s.status = 'READY') THEN
        RAISE EXCEPTION 'DS_SOURCE_MISMATCH';
      END IF;
    END IF;
    IF NEW.head_version_id IS NOT NULL AND NEW.head_version_id IS DISTINCT FROM OLD.head_version_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.ds_versions v
         WHERE v.id = NEW.head_version_id AND v.project_id = NEW.id) THEN
        RAISE EXCEPTION 'DS_VERSION_MISMATCH';
      END IF;
    END IF;
    IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED' THEN NEW.archived_at := now(); END IF;
    IF NEW.status = 'ACTIVE' THEN NEW.archived_at := NULL; END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_projects_guard ON public.ds_projects;
CREATE TRIGGER trg_ds_projects_guard
  BEFORE INSERT OR UPDATE ON public.ds_projects
  FOR EACH ROW EXECUTE FUNCTION public.ds_projects_guard();

-- Floor plans: the upload is the customer's; the interpretation is the
-- server's. A browser may write corrections, nothing else after insert.
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
       OR NEW.interpretation_error IS DISTINCT FROM OLD.interpretation_error THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_floorplans_guard ON public.ds_floorplans;
CREATE TRIGGER trg_ds_floorplans_guard
  BEFORE INSERT OR UPDATE ON public.ds_floorplans
  FOR EACH ROW EXECUTE FUNCTION public.ds_floorplans_guard();

-- Spatial sources: immutable once READY. The only permitted change to a
-- READY row is READY -> SUPERSEDED, performed by the functions below.
CREATE OR REPLACE FUNCTION public.ds_sources_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF OLD.status IN ('READY','SUPERSEDED') THEN
    IF NEW.status = 'SUPERSEDED' AND OLD.status = 'READY'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'DS_SOURCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_sources_guard ON public.ds_spatial_sources;
CREATE TRIGGER trg_ds_sources_guard
  BEFORE UPDATE ON public.ds_spatial_sources
  FOR EACH ROW EXECUTE FUNCTION public.ds_sources_guard();

-- Versions: identity columns are immutable (rebasing a design onto new
-- geometry is a new version, not an edit), and `revision` is advanced by
-- the database, never by the client.
CREATE OR REPLACE FUNCTION public.ds_versions_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision := 0;
    IF auth.role() <> 'service_role' THEN
      IF NOT EXISTS (SELECT 1 FROM public.ds_projects p
                      WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'DS_PROJECT_NOT_OWNED';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ds_spatial_sources s
                    WHERE s.id = NEW.source_id AND s.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'DS_SOURCE_MISMATCH';
    END IF;
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ds_versions v WHERE v.id = NEW.parent_id AND v.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'DS_VERSION_MISMATCH';
    END IF;
    IF auth.role() <> 'service_role' THEN
      -- ORIGINAL is the untouched starting point of a space: one per source.
      IF NEW.origin = 'ORIGINAL' AND EXISTS (
        SELECT 1 FROM public.ds_versions v WHERE v.source_id = NEW.source_id AND v.origin = 'ORIGINAL') THEN
        RAISE EXCEPTION 'DS_ORIGIN_NOT_ALLOWED';
      END IF;
      -- AI: only with the customer's own finished AI job behind it.
      IF NEW.origin = 'AI' AND NOT EXISTS (
        SELECT 1 FROM public.ds_jobs j
         WHERE j.id = NEW.job_id AND j.user_id = NEW.user_id AND j.project_id = NEW.project_id
           AND j.kind = 'AI_DESIGN' AND j.status = 'SUCCEEDED') THEN
        RAISE EXCEPTION 'DS_ORIGIN_NOT_ALLOWED';
      END IF;
      IF NEW.origin <> 'AI' THEN NEW.job_id := NULL; END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'DS_VERSION_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.revision := OLD.revision + 1;
  ELSE
    NEW.revision := OLD.revision;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_versions_guard ON public.ds_versions;
CREATE TRIGGER trg_ds_versions_guard
  BEFORE INSERT OR UPDATE ON public.ds_versions
  FOR EACH ROW EXECUTE FUNCTION public.ds_versions_guard();

-- Children of a project are always written by the project's owner.
CREATE OR REPLACE FUNCTION public.ds_child_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'ds_version_events' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ds_versions v
                    WHERE v.id = NEW.version_id AND v.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_VERSION_NOT_OWNED';
    END IF;
    -- SYSTEM is the server's; AI needs the customer's finished AI job.
    IF NEW.origin = 'SYSTEM' THEN RAISE EXCEPTION 'DS_ORIGIN_NOT_ALLOWED'; END IF;
    IF NEW.origin = 'AI' AND NOT EXISTS (
      SELECT 1 FROM public.ds_jobs j
       WHERE j.id = NEW.job_id AND j.user_id = NEW.user_id
         AND j.kind = 'AI_DESIGN' AND j.status = 'SUCCEEDED') THEN
      RAISE EXCEPTION 'DS_ORIGIN_NOT_ALLOWED';
    END IF;
    IF NEW.origin = 'USER' THEN NEW.job_id := NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ds_projects p
                    WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'DS_PROJECT_NOT_OWNED';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id
                             OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
      RAISE EXCEPTION 'DS_OWNER_IMMUTABLE';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_version_events_owner ON public.ds_version_events;
CREATE TRIGGER trg_ds_version_events_owner
  BEFORE INSERT ON public.ds_version_events
  FOR EACH ROW EXECUTE FUNCTION public.ds_child_owner_guard();
DROP TRIGGER IF EXISTS trg_ds_saved_views_owner ON public.ds_saved_views;
CREATE TRIGGER trg_ds_saved_views_owner
  BEFORE INSERT OR UPDATE ON public.ds_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.ds_child_owner_guard();

-- Catalog rows keep their own updated_at.
CREATE OR REPLACE FUNCTION public.ds_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_catalog_assets_touch ON public.ds_catalog_assets;
CREATE TRIGGER trg_ds_catalog_assets_touch BEFORE UPDATE ON public.ds_catalog_assets
  FOR EACH ROW EXECUTE FUNCTION public.ds_touch_updated_at();
DROP TRIGGER IF EXISTS trg_ds_catalog_materials_touch ON public.ds_catalog_materials;
CREATE TRIGGER trg_ds_catalog_materials_touch BEFORE UPDATE ON public.ds_catalog_materials
  FOR EACH ROW EXECUTE FUNCTION public.ds_touch_updated_at();
DROP TRIGGER IF EXISTS trg_ds_styles_touch ON public.ds_styles;
CREATE TRIGGER trg_ds_styles_touch BEFORE UPDATE ON public.ds_styles
  FOR EACH ROW EXECUTE FUNCTION public.ds_touch_updated_at();
DROP TRIGGER IF EXISTS trg_ds_palettes_touch ON public.ds_palettes;
CREATE TRIGGER trg_ds_palettes_touch BEFORE UPDATE ON public.ds_palettes
  FOR EACH ROW EXECUTE FUNCTION public.ds_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ds_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_floorplans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_spatial_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_version_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_saved_views     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_catalog_assets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_catalog_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_styles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_palettes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_jobs            ENABLE ROW LEVEL SECURITY;

-- Projects
DROP POLICY IF EXISTS ds_projects_select ON public.ds_projects;
CREATE POLICY ds_projects_select ON public.ds_projects
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_projects_insert ON public.ds_projects;
CREATE POLICY ds_projects_insert ON public.ds_projects
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_projects_update ON public.ds_projects;
CREATE POLICY ds_projects_update ON public.ds_projects
  FOR UPDATE USING (user_id = public.auth_user_id()) WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_projects_delete ON public.ds_projects;
CREATE POLICY ds_projects_delete ON public.ds_projects
  FOR DELETE USING (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_projects_service ON public.ds_projects;
CREATE POLICY ds_projects_service ON public.ds_projects
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Floor plans
DROP POLICY IF EXISTS ds_floorplans_select ON public.ds_floorplans;
CREATE POLICY ds_floorplans_select ON public.ds_floorplans
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_floorplans_insert ON public.ds_floorplans;
CREATE POLICY ds_floorplans_insert ON public.ds_floorplans
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_floorplans_update ON public.ds_floorplans;
CREATE POLICY ds_floorplans_update ON public.ds_floorplans
  FOR UPDATE USING (user_id = public.auth_user_id()) WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_floorplans_service ON public.ds_floorplans;
CREATE POLICY ds_floorplans_service ON public.ds_floorplans
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Spatial sources: READ ONLY for the owner. Created by the functions below.
DROP POLICY IF EXISTS ds_sources_select ON public.ds_spatial_sources;
CREATE POLICY ds_sources_select ON public.ds_spatial_sources
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_sources_service ON public.ds_spatial_sources;
CREATE POLICY ds_sources_service ON public.ds_spatial_sources
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Versions
DROP POLICY IF EXISTS ds_versions_select ON public.ds_versions;
CREATE POLICY ds_versions_select ON public.ds_versions
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_versions_insert ON public.ds_versions;
CREATE POLICY ds_versions_insert ON public.ds_versions
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_versions_update ON public.ds_versions;
CREATE POLICY ds_versions_update ON public.ds_versions
  FOR UPDATE USING (user_id = public.auth_user_id()) WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_versions_delete ON public.ds_versions;
CREATE POLICY ds_versions_delete ON public.ds_versions
  FOR DELETE USING (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_versions_service ON public.ds_versions;
CREATE POLICY ds_versions_service ON public.ds_versions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Version events: append-only (no update, no delete policy).
DROP POLICY IF EXISTS ds_version_events_select ON public.ds_version_events;
CREATE POLICY ds_version_events_select ON public.ds_version_events
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_version_events_insert ON public.ds_version_events;
CREATE POLICY ds_version_events_insert ON public.ds_version_events
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_version_events_service ON public.ds_version_events;
CREATE POLICY ds_version_events_service ON public.ds_version_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Saved views
DROP POLICY IF EXISTS ds_saved_views_select ON public.ds_saved_views;
CREATE POLICY ds_saved_views_select ON public.ds_saved_views
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_saved_views_insert ON public.ds_saved_views;
CREATE POLICY ds_saved_views_insert ON public.ds_saved_views
  FOR INSERT WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_saved_views_update ON public.ds_saved_views;
CREATE POLICY ds_saved_views_update ON public.ds_saved_views
  FOR UPDATE USING (user_id = public.auth_user_id()) WITH CHECK (user_id = public.auth_user_id());
DROP POLICY IF EXISTS ds_saved_views_delete ON public.ds_saved_views;
CREATE POLICY ds_saved_views_delete ON public.ds_saved_views
  FOR DELETE USING (user_id = public.auth_user_id());

-- Catalog: any signed-in customer reads ACTIVE rows; Admin reads and
-- writes everything. Anonymous visitors read nothing.
DROP POLICY IF EXISTS ds_catalog_assets_select ON public.ds_catalog_assets;
CREATE POLICY ds_catalog_assets_select ON public.ds_catalog_assets
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS ds_catalog_assets_admin ON public.ds_catalog_assets;
CREATE POLICY ds_catalog_assets_admin ON public.ds_catalog_assets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ds_catalog_materials_select ON public.ds_catalog_materials;
CREATE POLICY ds_catalog_materials_select ON public.ds_catalog_materials
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS ds_catalog_materials_admin ON public.ds_catalog_materials;
CREATE POLICY ds_catalog_materials_admin ON public.ds_catalog_materials
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ds_styles_select ON public.ds_styles;
CREATE POLICY ds_styles_select ON public.ds_styles
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS ds_styles_admin ON public.ds_styles;
CREATE POLICY ds_styles_admin ON public.ds_styles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ds_palettes_select ON public.ds_palettes;
CREATE POLICY ds_palettes_select ON public.ds_palettes
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS ds_palettes_admin ON public.ds_palettes;
CREATE POLICY ds_palettes_admin ON public.ds_palettes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Jobs: the owner and Admin read; only edge functions write.
DROP POLICY IF EXISTS ds_jobs_select ON public.ds_jobs;
CREATE POLICY ds_jobs_select ON public.ds_jobs
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_jobs_service ON public.ds_jobs;
CREATE POLICY ds_jobs_service ON public.ds_jobs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Anonymous visitors hold no table privilege on any of this.
REVOKE ALL ON public.ds_projects, public.ds_floorplans, public.ds_spatial_sources,
  public.ds_versions, public.ds_version_events, public.ds_saved_views,
  public.ds_catalog_assets, public.ds_catalog_materials, public.ds_styles,
  public.ds_palettes, public.ds_jobs FROM anon;

-- Signed-in customers: exactly the verbs the policies above describe, so a
-- change to the platform's default privileges cannot widen them. Sources
-- and jobs are written only by ds_* functions and edge functions.
REVOKE ALL ON public.ds_projects, public.ds_floorplans, public.ds_spatial_sources,
  public.ds_versions, public.ds_version_events, public.ds_saved_views,
  public.ds_catalog_assets, public.ds_catalog_materials, public.ds_styles,
  public.ds_palettes, public.ds_jobs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ds_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ds_floorplans TO authenticated;
GRANT SELECT ON public.ds_spatial_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ds_versions TO authenticated;
GRANT SELECT, INSERT ON public.ds_version_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ds_saved_views TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ds_catalog_assets, public.ds_catalog_materials,
  public.ds_styles, public.ds_palettes TO authenticated;
GRANT SELECT ON public.ds_jobs TO authenticated;
GRANT ALL ON public.ds_projects, public.ds_floorplans, public.ds_spatial_sources,
  public.ds_versions, public.ds_version_events, public.ds_saved_views,
  public.ds_catalog_assets, public.ds_catalog_materials, public.ds_styles,
  public.ds_palettes, public.ds_jobs TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- SOURCE CREATION
-- ═══════════════════════════════════════════════════════════════════════

-- Pin a PUBLISHED developer unit as this project's space.
--
-- Reads through public.dt_unit_scene() — the same three-gate function an
-- anonymous viewer uses — so a customer can reference exactly what the
-- developer published and nothing more. Writes nothing in dt_* / dev_*.
-- Idempotent per (project, unit, published version).
CREATE OR REPLACE FUNCTION public.ds_attach_developer_unit(p_project_id uuid, p_unit_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid     uuid := public.auth_user_id();
  v_scene   jsonb;
  v_source  uuid;
  v_unit    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DS_AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ds_projects p
                  WHERE p.id = p_project_id AND p.user_id = v_uid) THEN
    RAISE EXCEPTION 'DS_PROJECT_NOT_OWNED';
  END IF;

  v_scene := public.dt_unit_scene(p_unit_id);
  IF v_scene IS NULL OR v_scene ? 'error' THEN
    RAISE EXCEPTION 'DS_NO_PUBLISHED_SCENE';
  END IF;

  SELECT u.unit_number, u.floor_level, u.area_total, u.ceiling_height,
         dp.name AS project_name, b.name AS building_name
    INTO v_unit
    FROM public.dev_units u
    JOIN public.dev_projects dp ON dp.id = u.project_id
    LEFT JOIN public.dev_buildings b ON b.id = u.building_id
   WHERE u.id = p_unit_id;

  SELECT s.id INTO v_source
    FROM public.ds_spatial_sources s
   WHERE s.project_id = p_project_id
     AND s.kind = 'DEVELOPER_UNIT'
     AND s.dev_unit_id = p_unit_id
     AND s.status = 'READY'
     AND s.upstream->>'scene_id' = v_scene->>'id'
     AND s.upstream->>'version' = v_scene->>'version'
   LIMIT 1;
  IF v_source IS NOT NULL THEN RETURN v_source; END IF;

  INSERT INTO public.ds_spatial_sources
    (project_id, user_id, kind, status, geometry_state, editability, dev_unit_id,
     upstream, provenance)
  VALUES
    (p_project_id, v_uid, 'DEVELOPER_UNIT', 'READY', 'VERIFIED', 'UNCLASSIFIED', p_unit_id,
     jsonb_build_object('scene_id', v_scene->>'id', 'version', v_scene->>'version',
                        'unit_type_id', v_scene->>'unit_type_id'),
     jsonb_build_object('origin', 'DEVELOPER_PUBLISHED',
                        'project_name', v_unit.project_name,
                        'building_name', v_unit.building_name,
                        'floor_level', v_unit.floor_level,
                        'unit_number', v_unit.unit_number,
                        'area_total', v_unit.area_total,
                        'ceiling_height', v_unit.ceiling_height))
  RETURNING id INTO v_source;

  UPDATE public.ds_projects SET dev_unit_id = p_unit_id
   WHERE id = p_project_id AND dev_unit_id IS NULL;

  RETURN v_source;
END $$;

-- Record deterministic geometry generated from a customer floor plan.
--
-- The geometry itself is computed by HOMATCH's deterministic engine
-- (src/lib/designStudio) from the stored interpretation plus the
-- customer's calibration. The truth claim is checked here: CALIBRATED needs
-- at least one real-world anchor and VERIFIED at least two, and nothing a
-- browser sends can make a plan VERIFIED without them. A previous source
-- for the same plan is SUPERSEDED, never overwritten.
CREATE OR REPLACE FUNCTION public.ds_create_floorplan_source(
  p_floorplan_id uuid,
  p_canonical jsonb,
  p_geometry_state text,
  p_calibration jsonb,
  p_generator_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid     uuid := public.auth_user_id();
  v_plan    record;
  v_anchors integer;
  v_anchor  jsonb;
  v_scene   jsonb;
  v_have    numeric;
  v_ratio   numeric;
  v_targets text[] := '{}';
  v_source  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DS_AUTH_REQUIRED'; END IF;
  SELECT f.id, f.project_id, f.status INTO v_plan
    FROM public.ds_floorplans f
   WHERE f.id = p_floorplan_id AND f.user_id = v_uid;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'DS_FLOORPLAN_NOT_OWNED'; END IF;
  IF v_plan.status <> 'INTERPRETED' THEN RAISE EXCEPTION 'DS_FLOORPLAN_NOT_INTERPRETED'; END IF;
  IF p_geometry_state NOT IN ('ESTIMATED','CALIBRATED','VERIFIED') THEN
    RAISE EXCEPTION 'DS_GEOMETRY_STATE';
  END IF;
  IF p_canonical IS NULL OR jsonb_typeof(p_canonical) <> 'object' THEN
    RAISE EXCEPTION 'DS_CANONICAL_REQUIRED';
  END IF;

  v_anchors := CASE WHEN p_calibration IS NOT NULL
                     AND jsonb_typeof(p_calibration->'anchors') = 'array'
                    THEN jsonb_array_length(p_calibration->'anchors') ELSE 0 END;
  IF p_geometry_state = 'CALIBRATED' AND v_anchors < 1 THEN
    RAISE EXCEPTION 'DS_CALIBRATION_REQUIRED';
  END IF;
  IF p_geometry_state = 'VERIFIED' THEN
    -- Two or more measurements of different things, each agreeing with the
    -- geometry being stored (within 3.5% in scale; areas compare by their
    -- square root). A browser cannot claim agreement it does not have.
    v_scene := p_canonical->'scene';
    IF v_anchors < 2 OR v_scene IS NULL THEN RAISE EXCEPTION 'DS_VERIFICATION_REQUIRED'; END IF;
    FOR v_anchor IN SELECT a FROM jsonb_array_elements(p_calibration->'anchors') AS a LOOP
      v_have := NULL;
      IF v_anchor->>'kind' = 'TOTAL_AREA' THEN
        SELECT sum((f->>'areaM2')::numeric) INTO v_have
          FROM jsonb_array_elements(v_scene->'floors') f
         WHERE coalesce((f->>'outdoor')::boolean, false) = false;
        v_ratio := CASE WHEN v_have > 0 AND (v_anchor->>'valueM2')::numeric > 0
                        THEN sqrt((v_anchor->>'valueM2')::numeric / v_have) END;
        v_targets := array_append(v_targets, 'TOTAL');
      ELSIF v_anchor->>'kind' = 'ROOM_AREA' THEN
        SELECT (f->>'areaM2')::numeric INTO v_have
          FROM jsonb_array_elements(v_scene->'floors') f WHERE f->>'id' = v_anchor->>'roomId' LIMIT 1;
        v_ratio := CASE WHEN v_have > 0 AND (v_anchor->>'valueM2')::numeric > 0
                        THEN sqrt((v_anchor->>'valueM2')::numeric / v_have) END;
        v_targets := array_append(v_targets, 'ROOM:' || coalesce(v_anchor->>'roomId', ''));
      ELSIF v_anchor->>'kind' = 'WALL_LENGTH' THEN
        SELECT (w->>'lengthM')::numeric INTO v_have
          FROM jsonb_array_elements(v_scene->'walls') w WHERE w->>'id' = v_anchor->>'wallId' LIMIT 1;
        v_ratio := CASE WHEN v_have > 0 AND (v_anchor->>'valueM')::numeric > 0
                        THEN (v_anchor->>'valueM')::numeric / v_have END;
        v_targets := array_append(v_targets, 'WALL:' || coalesce(v_anchor->>'wallId', ''));
      ELSE
        RAISE EXCEPTION 'DS_VERIFICATION_REQUIRED';
      END IF;
      IF v_ratio IS NULL OR abs(v_ratio - 1) > 0.035 THEN
        RAISE EXCEPTION 'DS_VERIFICATION_DISAGREES';
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT t) FROM unnest(v_targets) t) < 2 THEN
      RAISE EXCEPTION 'DS_VERIFICATION_REQUIRED';
    END IF;
  END IF;

  UPDATE public.ds_spatial_sources
     SET status = 'SUPERSEDED'
   WHERE floorplan_id = p_floorplan_id AND status = 'READY';

  INSERT INTO public.ds_spatial_sources
    (project_id, user_id, kind, status, geometry_state, editability, floorplan_id,
     canonical, calibration, generator_version, provenance)
  VALUES
    (v_plan.project_id, v_uid, 'FLOORPLAN_SCENE', 'READY', p_geometry_state, 'GENERATED',
     p_floorplan_id, p_canonical, p_calibration, left(coalesce(p_generator_version, ''), 40),
     jsonb_build_object('origin', 'CUSTOMER_FLOORPLAN', 'verified_by',
       CASE WHEN p_geometry_state = 'VERIFIED' THEN 'CUSTOMER_MEASUREMENTS' END))
  RETURNING id INTO v_source;

  RETURN v_source;
END $$;

-- ── Function privileges ────────────────────────────────────────────────
-- Named-role revokes, not only PUBLIC: Supabase's default privileges grant
-- EXECUTE to anon and authenticated by name (see functionGrants test).
REVOKE ALL ON FUNCTION public.ds_attach_developer_unit(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_attach_developer_unit(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ds_create_floorplan_source(uuid, jsonb, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_create_floorplan_source(uuid, jsonb, text, jsonb, text) TO authenticated;

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.ds_projects_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_floorplans_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_sources_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_versions_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_child_owner_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_touch_updated_at() FROM public, anon, authenticated;
