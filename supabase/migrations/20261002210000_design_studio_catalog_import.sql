-- HOMATCH DESIGN STUDIO — ONE licensed asset catalogue, many providers.
--
-- Providers plug in as adapters (catalogProviders/): Poly Haven supplies PBR
-- materials and HDRI environments (CC0); Blendkit supplies physical objects
-- (per-asset licence: CC0 is delivered; Royalty-Free is stopped until its
-- terms clearly permit browser delivery; anything unknown never enters).
--
-- Extends the existing catalogue (ds_catalog_assets for models,
-- ds_catalog_materials for materials) instead of starting another one, and
-- adds the one family it did not have: environments (HDRIs).
--
-- IDENTITY. Every imported asset carries its homatchAssetId
-- (catalogSource.ts: "hma_" + 26 base32 characters of a SHA-256 over the
-- provider, the asset type and the provider's asset id). It never changes,
-- whatever the provider does to names, categories or files; (provider,
-- source asset id) is unique, so importing again finds the same row. What the
-- provider's files were is a VERSION ("hmv_…"), and stored objects live under
-- their version: a new release adds objects and never overwrites any.
--
-- DELIVERY is part of every key and follows the licence:
--   design-studio/catalog/public/…      anyone (CC0 content and previews)
--   design-studio/catalog/licensed/…    signed-in users (runtime derivatives a licence allows in-app)
--   design-studio/catalog/restricted/…  staff and the importer only (provider source packages)
-- storage_authorize enforces it, and a trigger refuses a public object for any
-- asset whose licence is not CC0: nothing restricted can drift public.
--
-- BINARIES live in R2 under design-studio/catalog/ (storage ledger rows in
-- storage_objects, one per object); this schema holds the index, the state
-- machine and the audit trail. The importer runs in GitHub Actions with
-- short-lived presigned URLs from design-studio-model/catalog: the R2
-- credential never leaves Supabase, and the bytes never pass through it.
--
-- Nothing existing is changed: new columns are nullable, existing rows are
-- untouched, and imported rows are written INACTIVE (the editor does not list
-- them until activation, which is a separate product decision).

-- ── 1. Identity and search on the existing catalogue ──────────────────────

ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS homatch_asset_id text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS source_asset_id text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS source_category_id uuid;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS source_category_path text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS source_files_hash text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS canonical_category text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS canonical_subcategory text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS version_id text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS search_aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS quality_state text;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS catalog_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS license_class text CHECK (license_class IS NULL OR license_class IN ('CC0','ROYALTY_FREE','UNKNOWN'));
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS quality_tier text CHECK (quality_tier IS NULL OR quality_tier IN ('PREMIUM','STANDARD','FALLBACK','REJECT'));
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS quality_score numeric(5,3);
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS web_suitability numeric(5,3);
ALTER TABLE public.ds_catalog_assets ADD COLUMN IF NOT EXISTS color_families text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS homatch_asset_id text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS source_asset_id text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS source_category_id uuid;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS source_category_path text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS source_files_hash text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS canonical_category text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS canonical_subcategory text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS version_id text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS search_aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS color_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS license jsonb;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS quality_state text;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS catalog_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS license_class text CHECK (license_class IS NULL OR license_class IN ('CC0','ROYALTY_FREE','UNKNOWN'));
ALTER TABLE public.ds_catalog_materials ADD COLUMN IF NOT EXISTS color_families text[] NOT NULL DEFAULT '{}';

-- ── 2. Environments (HDRIs): the family the catalogue did not have ───────

CREATE TABLE IF NOT EXISTS public.ds_catalog_environments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9._/-]{1,79}$'),
  name                  text NOT NULL,
  homatch_asset_id      text,
  source_provider       text,
  source_asset_id       text,
  source_category_id    uuid,
  source_category_path  text,
  source_files_hash     text,
  canonical_category    text,
  canonical_subcategory text,
  version_id            text,
  normalized_name       text,
  search_aliases        text[] NOT NULL DEFAULT '{}',
  -- DAY, CLOUDY, SUNSET, EVENING, NIGHT, STUDIO, INTERIOR_ARTIFICIAL
  lighting_class        text NOT NULL,
  -- SKY, RESIDENTIAL_INTERIOR, HOSPITALITY_INTERIOR, BALCONY_ROOFTOP, URBAN, GARDEN, PARK, STUDIO
  context_class         text NOT NULL,
  attributes            jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_key         text,
  texture_bytes         bigint CHECK (texture_bytes IS NULL OR texture_bytes >= 0),
  provenance            text NOT NULL CHECK (provenance IN ('HOMATCH_OWNED','LICENSED','PARTNER')),
  license               jsonb,
  license_class         text CHECK (license_class IS NULL OR license_class IN ('CC0','ROYALTY_FREE','UNKNOWN')),
  quality_state         text,
  catalog_meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  active                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ds_catalog_assets','ds_catalog_materials','ds_catalog_environments'] LOOP
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (homatch_asset_id) WHERE homatch_asset_id IS NOT NULL', t || '_hma', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (source_provider, source_asset_id) WHERE source_provider IS NOT NULL', t || '_source', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (search_aliases)', t || '_aliases', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_identity_check') THEN
      -- An imported row has its WHOLE identity, or none of it (hand-made rows).
      -- (Written without regex end anchors: a dollar sign cannot nest in this quoting.)
      EXECUTE format($c$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        (homatch_asset_id IS NULL AND source_provider IS NULL AND source_asset_id IS NULL)
        OR (left(homatch_asset_id, 4) = 'hma_' AND length(homatch_asset_id) = 30 AND homatch_asset_id !~ '[^a-z0-9_]'
            AND length(source_provider) BETWEEN 2 AND 40 AND source_provider !~ '[^a-z0-9_-]' AND source_asset_id IS NOT NULL
            AND source_files_hash IS NOT NULL AND canonical_category IS NOT NULL AND canonical_subcategory IS NOT NULL
            AND left(version_id, 4) = 'hmv_' AND length(version_id) = 30 AND version_id !~ '[^a-z0-9_]' AND normalized_name IS NOT NULL)
      )$c$, t, t || '_identity_check');
    END IF;
  END LOOP;
END $$;

-- ── 3. The importer's state machine ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ds_catalog_imports (
  homatch_asset_id   text PRIMARY KEY CHECK (homatch_asset_id ~ '^hma_[0-9a-z]{26}$'),
  source_provider    text NOT NULL,
  source_asset_id    text NOT NULL,
  source_type        text NOT NULL CHECK (source_type IN ('textures','models','hdris')),
  kind               text NOT NULL CHECK (kind IN ('MATERIAL','MODEL','ENVIRONMENT')),
  canonical_category    text NOT NULL,
  canonical_subcategory text NOT NULL,
  display_name       text NOT NULL,
  -- The provider's listing at discovery (names, tags, attributes, category id and path).
  source_asset       jsonb NOT NULL,
  policy             text NOT NULL,
  -- The licence, per asset: UNKNOWN is recorded and never becomes READY.
  license_class      text NOT NULL DEFAULT 'UNKNOWN' CHECK (license_class IN ('CC0','ROYALTY_FREE','UNKNOWN')),
  license            jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_tier       text CHECK (quality_tier IS NULL OR quality_tier IN ('PREMIUM','STANDARD','FALLBACK','REJECT')),
  quality_score      numeric(5,3),
  web_suitability    numeric(5,3),
  state              text NOT NULL DEFAULT 'DISCOVERED'
                       CHECK (state IN ('DISCOVERED','QUEUED','DOWNLOADING','VALIDATING','OPTIMIZING','UPLOADING','INDEXING','READY','FAILED','EXCLUDED')),
  version_id         text CHECK (version_id IS NULL OR version_id ~ '^hmv_[0-9a-z]{26}$'),
  source_files_hash  text,
  planned_files      integer,
  planned_bytes      bigint,
  source_bytes       bigint NOT NULL DEFAULT 0,
  optimized_bytes    bigint NOT NULL DEFAULT 0,
  stored_bytes       bigint NOT NULL DEFAULT 0,
  files_uploaded     integer NOT NULL DEFAULT 0,
  files_skipped      integer NOT NULL DEFAULT 0,
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_owner        text,
  lease_until        timestamptz,
  last_error         text,
  last_error_stage   text,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  UNIQUE (source_provider, source_asset_id),
  CONSTRAINT ds_catalog_imports_ready_licensed CHECK (state <> 'READY' OR (license_class IN ('CC0','ROYALTY_FREE') AND coalesce(quality_tier, 'STANDARD') <> 'REJECT'))
);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_imports_state ON public.ds_catalog_imports (state, lease_until);

-- Every retry, failure and completion, kept: an import is auditable after the fact.
CREATE TABLE IF NOT EXISTS public.ds_catalog_import_events (
  id               bigserial PRIMARY KEY,
  homatch_asset_id text NOT NULL REFERENCES public.ds_catalog_imports(homatch_asset_id) ON DELETE CASCADE,
  run_id           text,
  stage            text NOT NULL,
  event            text NOT NULL CHECK (event IN ('CLAIMED','STAGE','SKIPPED_IDENTICAL','RETRY','FAILED','READY','EXCLUDED','REQUEUED')),
  attempt          integer,
  error            text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_import_events_asset ON public.ds_catalog_import_events (homatch_asset_id, at);

-- One row per stored object: which asset, which version, which variant and map.
CREATE TABLE IF NOT EXISTS public.ds_catalog_files (
  object_key       text PRIMARY KEY CHECK (object_key ~ '^design-studio/catalog/(public|licensed|restricted)/(models|materials|hdri|thumbnails|metadata)/hma_[0-9a-z]{26}/hmv_[0-9a-z]{26}/'),
  delivery         text NOT NULL CHECK (delivery IN ('public','licensed','restricted')),
  homatch_asset_id text NOT NULL REFERENCES public.ds_catalog_imports(homatch_asset_id) ON DELETE RESTRICT,
  version_id       text NOT NULL CHECK (version_id ~ '^hmv_[0-9a-z]{26}$'),
  variant          text NOT NULL CHECK (variant IN ('SOURCE','OPTIMIZED')),
  role             text NOT NULL CHECK (role IN ('GLTF','GLB','SOURCE_PACKAGE','GEOMETRY','BASE_COLOR','NORMAL','ORM','HEIGHT','OPACITY','EMISSION','HDRI','THUMBNAIL','METADATA')),
  resolution       text CHECK (resolution IS NULL OR resolution IN ('1k','2k','4k')),
  rel_path         text NOT NULL,
  bytes            bigint NOT NULL CHECK (bytes >= 0),
  md5              text NOT NULL CHECK (md5 ~ '^[0-9a-f]{32}$'),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_type     text NOT NULL,
  source_url       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (homatch_asset_id, version_id, variant, rel_path),
  -- The delivery class IS the key's third segment: the two can never disagree.
  CONSTRAINT ds_catalog_files_delivery_key CHECK (split_part(object_key, '/', 3) = delivery)
);

/* A PUBLIC object only for an asset whose licence lets anyone have it (CC0).
   A restricted source package can never be filed where anyone may read it. */
CREATE OR REPLACE FUNCTION public.ds_catalog_files_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_class text;
BEGIN
  IF NEW.delivery = 'public' THEN
    SELECT i.license_class INTO v_class FROM public.ds_catalog_imports i WHERE i.homatch_asset_id = NEW.homatch_asset_id;
    IF v_class IS DISTINCT FROM 'CC0' THEN
      RAISE EXCEPTION 'DS_CATALOG_NOT_PUBLIC: % is %', NEW.homatch_asset_id, coalesce(v_class, 'unknown');
    END IF;
  END IF;
  IF NEW.role = 'SOURCE_PACKAGE' AND NEW.delivery <> 'restricted' THEN
    SELECT i.license_class INTO v_class FROM public.ds_catalog_imports i WHERE i.homatch_asset_id = NEW.homatch_asset_id;
    IF v_class IS DISTINCT FROM 'CC0' THEN RAISE EXCEPTION 'DS_CATALOG_SOURCE_RESTRICTED'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_catalog_files_delivery ON public.ds_catalog_files;
CREATE TRIGGER trg_ds_catalog_files_delivery BEFORE INSERT OR UPDATE ON public.ds_catalog_files
  FOR EACH ROW EXECUTE FUNCTION public.ds_catalog_files_delivery_guard();
CREATE INDEX IF NOT EXISTS idx_ds_catalog_files_asset ON public.ds_catalog_files (homatch_asset_id, version_id);

-- ── 4. Claiming work: leases, bounded retries, resumable by construction ──

/*
  The next assets to work on: QUEUED ones, and any whose lease ran out mid-way
  (a runner that died after 5 GB leaves leases that expire; the next run takes
  those assets again from the start of their pipeline, and every object that
  already landed intact is skipped by checksum). Attempts are bounded: an
  asset that has used them all is FAILED, with its last error kept.
*/
CREATE OR REPLACE FUNCTION public.ds_catalog_claim(p_owner text, p_limit integer DEFAULT 4, p_lease_seconds integer DEFAULT 1800)
RETURNS SETOF public.ds_catalog_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- Out of attempts: failed for good (kept, with the reason).
  UPDATE public.ds_catalog_imports SET state = 'FAILED', lease_owner = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
   WHERE state IN ('DOWNLOADING','VALIDATING','OPTIMIZING','UPLOADING','INDEXING') AND lease_until < now() AND attempts >= max_attempts;
  RETURN QUERY
  WITH picked AS (
    SELECT i.homatch_asset_id FROM public.ds_catalog_imports i
     WHERE (i.state = 'QUEUED' OR (i.state IN ('DOWNLOADING','VALIDATING','OPTIMIZING','UPLOADING','INDEXING') AND i.lease_until < now()))
       AND i.attempts < i.max_attempts
     ORDER BY i.state = 'QUEUED' DESC, i.homatch_asset_id
     LIMIT greatest(1, least(p_limit, 32))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ds_catalog_imports i
     SET state = 'DOWNLOADING', attempts = i.attempts + 1, lease_owner = left(p_owner, 80),
         lease_until = now() + make_interval(secs => greatest(60, least(p_lease_seconds, 7200))),
         started_at = coalesce(i.started_at, now()), updated_at = now()
    FROM picked WHERE i.homatch_asset_id = picked.homatch_asset_id
  RETURNING i.*;
END $$;
REVOKE ALL ON FUNCTION public.ds_catalog_claim(text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ds_catalog_claim(text, integer, integer) TO service_role;

-- ── 5. Selection by meaning, never by path ────────────────────────────────

/*
  A reading or a designer asks for what it NEEDS ("wood, oak, light, floor")
  and gets canonical HOMATCH asset ids back — never a storage key. Scores:
  exact canonical subcategory or category 3, each matching alias 2, a word of
  the name 1. Only assets whose import is READY are offered.
*/
CREATE OR REPLACE FUNCTION public.ds_catalog_resolve(p_kind text, p_terms text[], p_limit integer DEFAULT 5)
RETURNS TABLE (homatch_asset_id text, name text, kind text, canonical_category text, canonical_subcategory text, score integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH terms AS (
    SELECT DISTINCT lower(trim(t)) AS t FROM unnest(coalesce(p_terms, '{}')) t WHERE length(trim(t)) BETWEEN 2 AND 40 LIMIT 16
  ), pool AS (
    SELECT m.homatch_asset_id, m.name, 'MATERIAL'::text AS kind, m.canonical_category, m.canonical_subcategory, m.search_aliases, m.normalized_name
      FROM public.ds_catalog_materials m WHERE m.homatch_asset_id IS NOT NULL AND m.quality_state = 'READY' AND upper(p_kind) IN ('MATERIAL','ANY')
    UNION ALL
    SELECT a.homatch_asset_id, a.name, 'MODEL', a.canonical_category, a.canonical_subcategory, a.search_aliases, a.normalized_name
      FROM public.ds_catalog_assets a WHERE a.homatch_asset_id IS NOT NULL AND a.quality_state = 'READY' AND upper(p_kind) IN ('MODEL','ANY')
    UNION ALL
    SELECT e.homatch_asset_id, e.name, 'ENVIRONMENT', e.canonical_category, e.canonical_subcategory, e.search_aliases, e.normalized_name
      FROM public.ds_catalog_environments e WHERE e.homatch_asset_id IS NOT NULL AND e.quality_state = 'READY' AND upper(p_kind) IN ('ENVIRONMENT','ANY')
  )
  SELECT p.homatch_asset_id, p.name, p.kind, p.canonical_category, p.canonical_subcategory,
         (SELECT coalesce(sum(
            CASE WHEN replace(lower(p.canonical_subcategory), '_', ' ') = t.t OR lower(split_part(p.canonical_category, '.', 2)) = replace(t.t, ' ', '_') THEN 3 ELSE 0 END
            + CASE WHEN t.t = ANY (p.search_aliases) THEN 2 ELSE 0 END
            + CASE WHEN p.normalized_name ~ ('(^|-)' || regexp_replace(t.t, '[^a-z0-9]+', '-', 'g') || '(-|$)') THEN 1 ELSE 0 END), 0)::integer
            FROM terms t) AS score
    FROM pool p
   ORDER BY score DESC, p.homatch_asset_id
   LIMIT greatest(1, least(coalesce(p_limit, 5), 50));
$$;
REVOKE ALL ON FUNCTION public.ds_catalog_resolve(text, text[], integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_catalog_resolve(text, text[], integer) TO authenticated, service_role;

-- ── 6. Access: the catalogue index is readable like the rest; the machinery is staff-only ──

ALTER TABLE public.ds_catalog_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_catalog_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_catalog_import_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_catalog_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ds_catalog_environments_select ON public.ds_catalog_environments;
CREATE POLICY ds_catalog_environments_select ON public.ds_catalog_environments
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS ds_catalog_environments_admin ON public.ds_catalog_environments;
CREATE POLICY ds_catalog_environments_admin ON public.ds_catalog_environments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ds_catalog_imports_admin ON public.ds_catalog_imports;
CREATE POLICY ds_catalog_imports_admin ON public.ds_catalog_imports FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS ds_catalog_import_events_admin ON public.ds_catalog_import_events;
CREATE POLICY ds_catalog_import_events_admin ON public.ds_catalog_import_events FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS ds_catalog_files_select ON public.ds_catalog_files;
CREATE POLICY ds_catalog_files_select ON public.ds_catalog_files FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.ds_catalog_imports, public.ds_catalog_import_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ds_catalog_imports, public.ds_catalog_import_events, public.ds_catalog_files FROM authenticated;

COMMENT ON TABLE public.ds_catalog_imports IS
  'Design Studio catalogue import state machine (one row per provider asset). Written by the importer (service role); admin-readable.';
COMMENT ON TABLE public.ds_catalog_files IS
  'Every stored catalogue object: asset, version, SOURCE/OPTIMIZED variant, map role, resolution, size and checksums. Ledger row in storage_objects.';

-- ── 7. Who may read a catalogue object: its delivery class ───────────────
--
-- storage_authorize() keeps its namespace rules in SQL. This is the
-- definition from 20260930092000_design_studio_storage_categories.sql,
-- VERBATIM (verified identical to production: prosrc md5
-- 2787a6b60e675e5318436185aa426e1c), with one added branch ("DESIGN STUDIO
-- CATALOGUE"). Grants are restated as that migration left them.

create or replace function public.storage_authorize(p_key text, p_action text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_me      uuid;
  v_admin   boolean := false;
  v_seg     text[];
  v_n       int;
  v_ns      text;
  v_rest    text;
  v_cat     text;
  v_acct    uuid;
  v_owner   uuid;
  v_vis     text;
  v_ws      uuid;
  v_uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_action is null or p_action not in ('READ', 'WRITE', 'DELETE') then
    return 'INVALID_KEY';
  end if;
  if p_key is null or p_key = '' or length(p_key) > 1024 then
    return 'INVALID_KEY';
  end if;
  if left(p_key, 1) = '/' or right(p_key, 1) = '/'
     or position('\' in p_key) > 0
     or p_key ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']') then
    return 'INVALID_KEY';
  end if;

  v_seg := string_to_array(p_key, '/');
  v_n := coalesce(array_length(v_seg, 1), 0);
  if v_n < 2 then return 'INVALID_KEY'; end if;
  if exists (select 1 from unnest(v_seg) s where s = '' or s = '.' or s = '..') then
    return 'INVALID_KEY';
  end if;

  v_ns := v_seg[1];
  v_rest := array_to_string(v_seg[2:v_n], '/');

  if v_uid is not null then
    select u.id, u.is_admin into v_me, v_admin
    from public.users u where u.auth_id = v_uid limit 1;
    v_admin := coalesce(v_admin, false);
  end if;

  -- ══ ACCOUNT-SCOPED KEYS ═══════════════════════════════════════════════
  if v_ns = 'users' then
    if v_n < 4 then return 'INVALID_KEY'; end if;      -- users/<id>/<cat>/<object>
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    v_acct := v_seg[2]::uuid;
    v_cat := v_seg[3];

    if v_uid is null then return 'UNAUTHENTICATED'; end if;

    -- Workspace files: the capability decides, not the prefix.
    if v_cat in ('developer-documents', 'developer-media') then
      if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      v_ws := v_seg[4]::uuid;
      if v_cat = 'developer-media' and p_action = 'READ' then return 'ALLOW'; end if;
      if public.dev_can(v_ws,
           case when v_cat = 'developer-media' then 'inventory' else 'documents' end)
      then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NO_CAPABILITY';
    end if;

    -- HOMATCH Design Studio: the design project in the key is the relationship.
    -- users/<account>/design-studio-<kind>/<ds_projects.id>/<object>.<ext>
    -- Owner only; Admin may read and never write or delete.
    if v_cat in ('design-studio-floorplans', 'design-studio-models', 'design-studio-thumbnails') then
      if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      select dp.user_id into v_owner from public.ds_projects dp where dp.id = v_seg[4]::uuid limit 1;
      if v_owner is null then
        if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      if v_owner = v_me and v_acct = v_me then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;

    if v_cat not in ('property-photos', 'deal-room-documents', 'mortgage-documents',
                     'expat-attachments', 'generated-reports') then
      return 'INVALID_KEY';
    end if;

    -- Property photos keep their own visibility rule: the column the product
    -- has always carried and nothing ever read.
    if v_cat = 'property-photos' then
      select p.user_id, ph.visibility::text into v_owner, v_vis
      from public.property_photos ph
      join public.properties p on p.id = ph.property_id
      where ph.storage_path = p_key limit 1;

      if v_owner is not null and p_action = 'READ' then
        if v_vis in ('PUBLIC', 'AUTHENTICATED') then return 'ALLOW'; end if;
        if v_owner = v_me or v_admin then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      -- No row yet: the upload. The PROPERTY says who owns it.
      if v_owner is null then
        if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
        select p.user_id into v_owner from public.properties p
        where p.id = v_seg[4]::uuid and p.is_deleted = false limit 1;
        if v_owner is null then
          if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
          return 'NOT_OWNER';
        end if;
      end if;
    elsif v_cat = 'deal-room-documents' then
      -- The deal room is the relationship; the account segment is not.
      if v_n >= 5 and v_seg[4] ~ v_uuid_re then
        select dr.user_id into v_owner from public.deal_rooms dr
        where dr.id = v_seg[4]::uuid and dr.deleted_at is null limit 1;
        -- deal_rooms.user_id is an auth uid; translate to the account id.
        if v_owner is not null then
          select u.id into v_owner from public.users u where u.auth_id = v_owner limit 1;
        end if;
      end if;
      if v_owner is null then v_owner := v_acct; end if;
    else
      -- mortgage-documents, expat-attachments, generated-reports: the account
      -- in the key is the owner, and there is no other relationship to check.
      v_owner := v_acct;
    end if;

    if v_owner = v_me and v_acct = v_me then return 'ALLOW'; end if;
    -- Admin may look. Admin may not change or remove somebody's file.
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  -- ══ LEGACY FUNCTIONAL NAMESPACES ══════════════════════════════════════
  -- Objects that were already in Supabase Storage keep the path they had, so
  -- that the copy is a copy and the rollback is "read from the old place".

  if v_ns = 'property-photos' then
    select p.user_id, ph.visibility::text into v_owner, v_vis
    from public.property_photos ph
    join public.properties p on p.id = ph.property_id
    where ph.storage_path = v_rest limit 1;

    if v_owner is not null then
      if p_action = 'READ' then
        if v_vis = 'PUBLIC' then return 'ALLOW'; end if;
        if v_uid is null then return 'UNAUTHENTICATED'; end if;
        if v_vis = 'AUTHENTICATED' then return 'ALLOW'; end if;
        if v_owner = v_me or v_admin then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      if v_uid is null then return 'UNAUTHENTICATED'; end if;
      if v_owner = v_me then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;

    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_n < 4 then return 'INVALID_KEY'; end if;
    if v_seg[2] !~ v_uuid_re or v_seg[3] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    select p.user_id into v_owner from public.properties p
    where p.id = v_seg[3]::uuid and p.is_deleted = false limit 1;
    if v_owner is null or v_owner is distinct from v_me then
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;
    if v_seg[2] <> v_me::text then return 'NOT_OWNER'; end if;
    return 'ALLOW';
  end if;

  if v_ns = 'deal-room-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    select d.user_id into v_owner from public.deal_room_documents d
    where d.storage_path = v_rest limit 1;
    if v_owner is not null then
      if v_owner = v_uid then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;
    if v_seg[2] = v_uid::text then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  if v_ns = 'developer-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    select d.workspace_id into v_ws from public.dev_documents d
    where d.storage_path = v_rest limit 1;
    if v_ws is null then
      if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      v_ws := v_seg[2]::uuid;
    end if;
    if public.dev_can(v_ws, 'documents') then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NO_CAPABILITY';
  end if;

  if v_ns = 'developer-media' then
    if p_action = 'READ' then return 'ALLOW'; end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    return case when public.dev_can(v_seg[2]::uuid, 'inventory') then 'ALLOW' else 'NO_CAPABILITY' end;
  end if;

  if v_ns = 'mortgage-offer-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] = v_uid::text then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  -- ══ DESIGN STUDIO CATALOGUE ════════════════════════════════════════════
  -- design-studio/catalog/<delivery>/<area>/<hma>/<hmv>/<file>. The delivery
  -- class in the key is the whole rule: public = anyone (CC0 and previews),
  -- licensed = any signed-in user (runtime derivatives a licence allows
  -- in-app), restricted = staff only (provider source packages). Nobody
  -- writes here through signing: the importer writes with the service role.
  if v_ns = 'design-studio' then
    if v_n < 7 or v_seg[2] <> 'catalog'
       or v_seg[3] not in ('public', 'licensed', 'restricted')
       or v_seg[4] not in ('models', 'materials', 'hdri', 'thumbnails', 'metadata')
       or v_seg[5] !~ '^hma_[0-9a-z]{26}$' or v_seg[6] !~ '^hmv_[0-9a-z]{26}$' then
      return 'INVALID_KEY';
    end if;
    if p_action = 'READ' then
      if v_seg[3] = 'public' then return 'ALLOW'; end if;
      if v_uid is null then return 'UNAUTHENTICATED'; end if;
      if v_seg[3] = 'licensed' then return 'ALLOW'; end if;
      return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
    end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return 'NOT_ADMIN';
  end if;

  -- ══ SYSTEM NAMESPACES ═════════════════════════════════════════════════
  if v_ns = 'site-assets' then
    if p_action = 'READ' then return 'ALLOW'; end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  if v_ns in ('voice-auditions', 'diagnostics', 'system', 'research') then
    -- Recordings of real people, self-test objects, generated system assets
    -- and research evidence. Staff only, in every direction.
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  return 'INVALID_KEY';

exception when others then
  return 'UNAVAILABLE';
end;
$fn$;

revoke all on function public.storage_authorize(text, text) from public;
grant execute on function public.storage_authorize(text, text) to anon, authenticated, service_role;
