-- HOMATCH DESIGN STUDIO — catalogue management: import batches, lifecycle,
-- dependency-safe removal and an audit trail.
--
-- AVAILABILITY IS NOT STORAGE. Taking an asset out of the catalogue
-- (DISABLED) only stops NEW selection: saved designs and public shares keep
-- rendering it, because its files stay. Physical deletion is a separate,
-- later step that is only ever allowed for an asset nothing references
-- (PENDING_DELETE → DELETED, executed server-side after a fresh dependency
-- check). Nothing here deletes a file.
--
--   UNPUBLISHED     imported (READY or not), never offered to users
--   ACTIVE          offered in the editor and to the resolver
--   DISABLED        not offered; files kept for designs that use it
--   PENDING_DELETE  queued for physical deletion; only with zero references
--   DELETED         files removed (by the server, never by this migration)
--
-- Every import carries an immutable import_batch_id (set when it is queued),
-- so a whole batch can be found and managed together. Every admin change is
-- recorded: actor, time, action, assets, batch, counts.

-- ── 1. Batch and lifecycle on the import record ──────────────────────────

ALTER TABLE public.ds_catalog_imports ADD COLUMN IF NOT EXISTS import_batch_id text
  CHECK (import_batch_id IS NULL OR import_batch_id ~ '^ib_[0-9a-z_]{4,60}$');
ALTER TABLE public.ds_catalog_imports ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'UNPUBLISHED'
  CHECK (lifecycle IN ('UNPUBLISHED', 'ACTIVE', 'DISABLED', 'PENDING_DELETE', 'DELETED'));
ALTER TABLE public.ds_catalog_imports ADD COLUMN IF NOT EXISTS lifecycle_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_ds_catalog_imports_batch ON public.ds_catalog_imports (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_imports_lifecycle ON public.ds_catalog_imports (lifecycle);

/* A batch id, once set, never changes (the trail must be trustworthy). */
CREATE OR REPLACE FUNCTION public.ds_catalog_imports_batch_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF OLD.import_batch_id IS NOT NULL AND NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id THEN
    RAISE EXCEPTION 'DS_CATALOG_BATCH_IMMUTABLE: % already belongs to %', OLD.homatch_asset_id, OLD.import_batch_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_catalog_imports_batch ON public.ds_catalog_imports;
CREATE TRIGGER trg_ds_catalog_imports_batch BEFORE UPDATE ON public.ds_catalog_imports
  FOR EACH ROW EXECUTE FUNCTION public.ds_catalog_imports_batch_immutable();

-- The canary that proved the pipeline (2026-10-01) is a batch like any other.
UPDATE public.ds_catalog_imports SET import_batch_id = 'ib_20261001_canary' WHERE import_batch_id IS NULL;

-- Its lifecycle is what its catalogue rows already say.
UPDATE public.ds_catalog_imports i SET lifecycle = 'ACTIVE', lifecycle_at = now()
 WHERE i.lifecycle = 'UNPUBLISHED' AND (
   EXISTS (SELECT 1 FROM public.ds_catalog_assets a WHERE a.homatch_asset_id = i.homatch_asset_id AND a.active)
   OR EXISTS (SELECT 1 FROM public.ds_catalog_materials m WHERE m.homatch_asset_id = i.homatch_asset_id AND m.active)
   OR EXISTS (SELECT 1 FROM public.ds_catalog_environments e WHERE e.homatch_asset_id = i.homatch_asset_id AND e.active));

-- ── 2. The audit trail ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ds_catalog_admin_events (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid,
  actor_kind       text NOT NULL CHECK (actor_kind IN ('ADMIN', 'IMPORTER', 'SERVER')),
  action           text NOT NULL CHECK (action IN ('ACTIVATE', 'DISABLE', 'REQUEST_DELETE', 'CANCEL_DELETE', 'DELETED', 'DELETE_BLOCKED', 'REPROCESS')),
  asset_count      integer NOT NULL CHECK (asset_count >= 0),
  homatch_asset_ids text[] NOT NULL DEFAULT '{}',
  import_batch_ids text[] NOT NULL DEFAULT '{}',
  reason           text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ds_catalog_admin_events_at ON public.ds_catalog_admin_events (at DESC);
ALTER TABLE public.ds_catalog_admin_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ds_catalog_admin_events_select ON public.ds_catalog_admin_events;
CREATE POLICY ds_catalog_admin_events_select ON public.ds_catalog_admin_events FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.ds_catalog_admin_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ds_catalog_admin_events FROM authenticated;

-- ── 3. What uses an asset ─────────────────────────────────────────────────

/*
  How many saved design versions (any project, archived included) and public
  shares reference each asset — as a placed object (objects[].assetId = the
  catalogue code) or as a surface material (surfaces.*.materialId = the
  material row id). Admin only. Read-only.
*/
CREATE OR REPLACE FUNCTION public.ds_catalog_dependencies(p_ids text[])
RETURNS TABLE (homatch_asset_id text, versions integer, projects integer, published integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT public.is_admin() AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'DS_CATALOG_ADMIN_ONLY';
  END IF;
  RETURN QUERY
  WITH ids AS (
    SELECT i.homatch_asset_id AS hma,
           array_remove(ARRAY[i.homatch_asset_id, a.id::text, m.id::text, e.id::text], NULL) AS refs
      FROM public.ds_catalog_imports i
      LEFT JOIN public.ds_catalog_assets a ON a.homatch_asset_id = i.homatch_asset_id
      LEFT JOIN public.ds_catalog_materials m ON m.homatch_asset_id = i.homatch_asset_id
      LEFT JOIN public.ds_catalog_environments e ON e.homatch_asset_id = i.homatch_asset_id
     WHERE i.homatch_asset_id = ANY (p_ids)
  ), used_v AS (
    SELECT ids.hma, v.id AS version_id, v.project_id
      FROM ids JOIN public.ds_versions v ON (
        EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v.state->'objects', '[]'::jsonb)) o WHERE o->>'assetId' = ANY (ids.refs))
        OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(v.state->'surfaces') = 'object' THEN v.state->'surfaces' ELSE '{}'::jsonb END) s WHERE s.value->>'materialId' = ANY (ids.refs)))
  ), used_p AS (
    SELECT ids.hma, p.id
      FROM ids JOIN public.ds_published_designs p ON (
        EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p.state->'objects', '[]'::jsonb)) o WHERE o->>'assetId' = ANY (ids.refs))
        OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p.state->'surfaces') = 'object' THEN p.state->'surfaces' ELSE '{}'::jsonb END) s WHERE s.value->>'materialId' = ANY (ids.refs)))
  )
  SELECT ids.hma,
         (SELECT count(*)::integer FROM used_v WHERE used_v.hma = ids.hma),
         (SELECT count(DISTINCT used_v.project_id)::integer FROM used_v WHERE used_v.hma = ids.hma),
         (SELECT count(*)::integer FROM used_p WHERE used_p.hma = ids.hma)
    FROM ids;
END $$;
REVOKE ALL ON FUNCTION public.ds_catalog_dependencies(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_catalog_dependencies(text[]) TO authenticated, service_role;

-- ── 4. Changing availability, in bulk, safely ─────────────────────────────

/*
  Admin bulk lifecycle change. p_confirm_count must equal the number of
  distinct assets named (the confirmation the UI shows); at most 5,000 at once.

    ACTIVE          offer READY assets (re-enable); refused for DELETED / PENDING_DELETE
    DISABLED        stop offering (files and references untouched)
    PENDING_DELETE  queue for physical deletion — ONLY assets with zero
                    references; referenced ones are left as they are and
                    reported, with their counts, as blocked
    CANCEL_DELETE   PENDING_DELETE → DISABLED

  Returns {changed, blocked:[{homatch_asset_id, versions, projects, published, reason}], skipped}.
*/
CREATE OR REPLACE FUNCTION public.ds_catalog_admin_set_lifecycle(p_ids text[], p_target text, p_confirm_count integer, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_ids text[];
  v_actor uuid;
  v_changed text[] := '{}';
  v_blocked jsonb := '[]'::jsonb;
  v_skipped text[] := '{}';
  v_batches text[];
  r record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'DS_CATALOG_ADMIN_ONLY'; END IF;
  IF p_target NOT IN ('ACTIVE', 'DISABLED', 'PENDING_DELETE', 'CANCEL_DELETE') THEN RAISE EXCEPTION 'DS_CATALOG_BAD_TARGET: %', p_target; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_ids, '{}')) x WHERE x ~ '^hma_[0-9a-z]{26}$';
  v_ids := coalesce(v_ids, '{}');
  IF cardinality(v_ids) = 0 THEN RAISE EXCEPTION 'DS_CATALOG_NOTHING_SELECTED'; END IF;
  IF cardinality(v_ids) > 5000 THEN RAISE EXCEPTION 'DS_CATALOG_TOO_MANY: % (max 5000 at once)', cardinality(v_ids); END IF;
  IF p_confirm_count IS DISTINCT FROM cardinality(v_ids) THEN
    RAISE EXCEPTION 'DS_CATALOG_CONFIRM_MISMATCH: confirmed %, selected %', p_confirm_count, cardinality(v_ids);
  END IF;
  SELECT u.id INTO v_actor FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1;

  FOR r IN
    SELECT i.homatch_asset_id AS hma, i.kind, i.state, i.lifecycle, d.versions, d.projects, d.published
      FROM public.ds_catalog_imports i
      LEFT JOIN LATERAL (SELECT * FROM public.ds_catalog_dependencies(ARRAY[i.homatch_asset_id])) d ON true
     WHERE i.homatch_asset_id = ANY (v_ids)
  LOOP
    IF p_target = 'ACTIVE' THEN
      IF r.state <> 'READY' OR r.lifecycle IN ('PENDING_DELETE', 'DELETED') THEN v_skipped := v_skipped || r.hma; CONTINUE; END IF;
    ELSIF p_target = 'DISABLED' THEN
      IF r.lifecycle IN ('DELETED', 'PENDING_DELETE') THEN v_skipped := v_skipped || r.hma; CONTINUE; END IF;
    ELSIF p_target = 'PENDING_DELETE' THEN
      IF r.lifecycle = 'DELETED' THEN v_skipped := v_skipped || r.hma; CONTINUE; END IF;
      IF coalesce(r.versions, 0) + coalesce(r.published, 0) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('homatch_asset_id', r.hma, 'versions', r.versions, 'projects', r.projects, 'published', r.published,
          'reason', 'referenced by saved designs or public shares; its files must stay');
        CONTINUE;
      END IF;
    ELSIF p_target = 'CANCEL_DELETE' THEN
      IF r.lifecycle <> 'PENDING_DELETE' THEN v_skipped := v_skipped || r.hma; CONTINUE; END IF;
    END IF;

    -- Availability follows the lifecycle: only ACTIVE is offered.
    IF r.kind = 'MODEL' THEN UPDATE public.ds_catalog_assets SET active = (p_target = 'ACTIVE'), updated_at = now() WHERE homatch_asset_id = r.hma;
    ELSIF r.kind = 'MATERIAL' THEN UPDATE public.ds_catalog_materials SET active = (p_target = 'ACTIVE'), updated_at = now() WHERE homatch_asset_id = r.hma;
    ELSE UPDATE public.ds_catalog_environments SET active = (p_target = 'ACTIVE'), updated_at = now() WHERE homatch_asset_id = r.hma;
    END IF;
    UPDATE public.ds_catalog_imports
       SET lifecycle = CASE WHEN p_target = 'CANCEL_DELETE' THEN 'DISABLED' ELSE p_target END, lifecycle_at = now(), updated_at = now()
     WHERE homatch_asset_id = r.hma;
    v_changed := v_changed || r.hma;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT import_batch_id) FILTER (WHERE import_batch_id IS NOT NULL), '{}') INTO v_batches
    FROM public.ds_catalog_imports WHERE homatch_asset_id = ANY (v_ids);
  INSERT INTO public.ds_catalog_admin_events (actor_user_id, actor_kind, action, asset_count, homatch_asset_ids, import_batch_ids, reason, detail)
  VALUES (v_actor, 'ADMIN',
          CASE p_target WHEN 'ACTIVE' THEN 'ACTIVATE' WHEN 'DISABLED' THEN 'DISABLE' WHEN 'PENDING_DELETE' THEN 'REQUEST_DELETE' ELSE 'CANCEL_DELETE' END,
          cardinality(v_changed), v_changed, v_batches, left(p_reason, 500),
          jsonb_build_object('selected', cardinality(v_ids), 'blocked', v_blocked, 'skipped', v_skipped));
  IF jsonb_array_length(v_blocked) > 0 THEN
    INSERT INTO public.ds_catalog_admin_events (actor_user_id, actor_kind, action, asset_count, homatch_asset_ids, import_batch_ids, reason, detail)
    VALUES (v_actor, 'ADMIN', 'DELETE_BLOCKED', jsonb_array_length(v_blocked),
            ARRAY(SELECT b->>'homatch_asset_id' FROM jsonb_array_elements(v_blocked) b), v_batches, left(p_reason, 500), jsonb_build_object('blocked', v_blocked));
  END IF;
  RETURN jsonb_build_object('changed', cardinality(v_changed), 'blocked', v_blocked, 'skipped', to_jsonb(v_skipped));
END $$;
REVOKE ALL ON FUNCTION public.ds_catalog_admin_set_lifecycle(text[], text, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_catalog_admin_set_lifecycle(text[], text, integer, text) TO authenticated;

-- ── 5. Only ACTIVE assets are offered by the resolver ─────────────────────

CREATE OR REPLACE FUNCTION public.ds_catalog_resolve(p_kind text, p_terms text[], p_limit integer DEFAULT 5)
RETURNS TABLE (homatch_asset_id text, name text, kind text, canonical_category text, canonical_subcategory text, score integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH terms AS (
    SELECT DISTINCT lower(trim(t)) AS t FROM unnest(coalesce(p_terms, '{}')) t WHERE length(trim(t)) BETWEEN 2 AND 40 LIMIT 16
  ), pool AS (
    SELECT m.homatch_asset_id, m.name, 'MATERIAL'::text AS kind, m.canonical_category, m.canonical_subcategory, m.search_aliases, m.normalized_name
      FROM public.ds_catalog_materials m WHERE m.homatch_asset_id IS NOT NULL AND m.quality_state = 'READY' AND m.active AND upper(p_kind) IN ('MATERIAL','ANY')
    UNION ALL
    SELECT a.homatch_asset_id, a.name, 'MODEL', a.canonical_category, a.canonical_subcategory, a.search_aliases, a.normalized_name
      FROM public.ds_catalog_assets a WHERE a.homatch_asset_id IS NOT NULL AND a.quality_state = 'READY' AND a.active AND upper(p_kind) IN ('MODEL','ANY')
    UNION ALL
    SELECT e.homatch_asset_id, e.name, 'ENVIRONMENT', e.canonical_category, e.canonical_subcategory, e.search_aliases, e.normalized_name
      FROM public.ds_catalog_environments e WHERE e.homatch_asset_id IS NOT NULL AND e.quality_state = 'READY' AND e.active AND upper(p_kind) IN ('ENVIRONMENT','ANY')
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

COMMENT ON TABLE public.ds_catalog_admin_events IS
  'Design Studio catalogue admin audit: who changed availability or requested/blocked/completed deletion of which assets and batches, when.';
