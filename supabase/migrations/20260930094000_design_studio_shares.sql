-- HOMATCH DESIGN STUDIO — PUBLIC SHARE LINKS.
--
-- A customer shares a design with anyone, without a HOMATCH account:
--
--   IMMUTABLE DESIGN SNAPSHOT (ds_published_designs)
--        ↑            ↑            ↑
--     share A      share B  …   share N      (ds_shares, unlimited)
--
-- · A snapshot is a frozen copy of ONE version's design state (small JSON)
--   plus a reference to the space it was made on. Spatial sources are
--   already immutable once READY, so nothing heavy is copied, ever. Sharing
--   the same unchanged version twice reuses the same snapshot (state hash).
-- · Later edits to the version never change what an existing link shows.
-- · Each link is its own row with its own 256-bit random token. Only the
--   token's SHA-256 is stored; the plaintext is returned once, to the owner,
--   at creation (the same pattern as the verification handoff nonces).
-- · Revoking a link is one row: other links to the same design keep working.
-- · The public reads exactly one thing: ds_public_share(token), which
--   returns the presentation payload — design state, geometry, the catalogue
--   pieces and materials it uses — and nothing else: no ids, no owner, no
--   project, no versions, no storage keys, no history.
--
-- Transactions are the runner's. Not applied by pushing.

-- ── Snapshots ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ds_published_designs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_id  uuid REFERENCES public.ds_versions(id) ON DELETE SET NULL,
  source_id   uuid NOT NULL REFERENCES public.ds_spatial_sources(id) ON DELETE CASCADE,
  state       jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 1048576),
  state_hash  text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ds_published_once UNIQUE (version_id, state_hash)
);
CREATE INDEX IF NOT EXISTS idx_ds_published_project ON public.ds_published_designs(project_id, created_at DESC);
COMMENT ON TABLE public.ds_published_designs IS
  'Frozen design snapshots for public sharing. Immutable. Referenced by any number of ds_shares.';

-- ── Links ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ds_shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- The last four characters of the token, so the owner can tell links apart.
  token_hint     text NOT NULL CHECK (char_length(token_hint) = 4),
  published_id   uuid NOT NULL REFERENCES public.ds_published_designs(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  share_type     text NOT NULL CHECK (share_type IN ('WALKTHROUGH','DESIGN')),
  label          text CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  view_count     bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ds_shares_project ON public.ds_shares(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ds_shares_user_recent ON public.ds_shares(user_id, created_at DESC);
COMMENT ON TABLE public.ds_shares IS
  'Public share links. Token stored only as SHA-256. Created/revoked through ds_create_share/ds_revoke_share.';

-- Snapshots never change. Links change only by revocation and view counts.
CREATE OR REPLACE FUNCTION public.ds_published_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'DS_SNAPSHOT_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS trg_ds_published_guard ON public.ds_published_designs;
CREATE TRIGGER trg_ds_published_guard
  BEFORE UPDATE ON public.ds_published_designs
  FOR EACH ROW EXECUTE FUNCTION public.ds_published_guard();

CREATE OR REPLACE FUNCTION public.ds_shares_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.token_hint IS DISTINCT FROM OLD.token_hint
     OR NEW.published_id IS DISTINCT FROM OLD.published_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.share_type IS DISTINCT FROM OLD.share_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.label IS DISTINCT FROM OLD.label THEN
    RAISE EXCEPTION 'DS_SHARE_IMMUTABLE';
  END IF;
  -- A revoked link stays revoked.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'DS_SHARE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ds_shares_guard ON public.ds_shares;
CREATE TRIGGER trg_ds_shares_guard
  BEFORE UPDATE ON public.ds_shares
  FOR EACH ROW EXECUTE FUNCTION public.ds_shares_guard();

-- ── Access ───────────────────────────────────────────────────────────

ALTER TABLE public.ds_published_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ds_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ds_published_select ON public.ds_published_designs;
CREATE POLICY ds_published_select ON public.ds_published_designs
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_published_service ON public.ds_published_designs;
CREATE POLICY ds_published_service ON public.ds_published_designs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS ds_shares_select ON public.ds_shares;
CREATE POLICY ds_shares_select ON public.ds_shares
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_shares_service ON public.ds_shares;
CREATE POLICY ds_shares_service ON public.ds_shares
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.ds_published_designs, public.ds_shares FROM anon, authenticated;
GRANT SELECT ON public.ds_published_designs, public.ds_shares TO authenticated;
GRANT ALL ON public.ds_published_designs, public.ds_shares TO service_role;

-- ── Create a link ────────────────────────────────────────────────────
-- Freezes the version's CURRENT design state (reusing an identical earlier
-- snapshot), makes a fresh 256-bit token, stores its hash, and returns the
-- token once. There is no per-project cap; a per-account hourly ceiling
-- only stops runaway automation.

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
      coalesce((SELECT jsonb_agg(o - 'provenance' ORDER BY n) FROM jsonb_array_elements(v_version.state->'objects') WITH ORDINALITY AS x(o, n)), '[]'::jsonb))
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

-- ── Revoke a link ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ds_revoke_share(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := public.auth_user_id();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DS_AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ds_shares WHERE id = p_share_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'DS_SHARE_NOT_OWNED';
  END IF;
  UPDATE public.ds_shares SET revoked_at = now() WHERE id = p_share_id AND revoked_at IS NULL;
END $$;

-- ── The public read ─────────────────────────────────────────────────
-- Anyone holding a token gets the presentation of that one frozen design,
-- or a plain state (REVOKED / EXPIRED / NOT_FOUND / UNAVAILABLE). Counting a
-- view never blocks the read.

CREATE OR REPLACE FUNCTION public.ds_public_share(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_share     record;
  v_pub       record;
  v_scene     jsonb;
  v_ceiling   text;
  v_codes     text[];
  v_materials text[];
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND');
  END IF;
  SELECT s.id, s.share_type, s.expires_at, s.revoked_at, s.published_id INTO v_share
    FROM public.ds_shares s WHERE s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  IF v_share.id IS NULL THEN RETURN jsonb_build_object('status', 'NOT_FOUND'); END IF;
  IF v_share.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'REVOKED'); END IF;
  IF v_share.expires_at IS NOT NULL AND v_share.expires_at <= now() THEN RETURN jsonb_build_object('status', 'EXPIRED'); END IF;

  SELECT d.state, d.title, d.created_at, src.canonical INTO v_pub
    FROM public.ds_published_designs d
    JOIN public.ds_spatial_sources src ON src.id = d.source_id
   WHERE d.id = v_share.published_id;
  v_scene := v_pub.canonical->'scene';
  IF v_pub.state IS NULL OR v_scene IS NULL THEN RETURN jsonb_build_object('status', 'UNAVAILABLE'); END IF;
  v_ceiling := v_pub.canonical->>'ceilingSource';

  SELECT array_agg(DISTINCT o->>'assetId') INTO v_codes
    FROM jsonb_array_elements(coalesce(v_pub.state->'objects', '[]'::jsonb)) o;
  SELECT array_agg(DISTINCT m) INTO v_materials FROM (
    SELECT s.value->>'materialId' AS m FROM jsonb_each(coalesce(v_pub.state->'surfaces', '{}'::jsonb)) s
     WHERE s.value->>'materialId' IS NOT NULL) x;

  BEGIN
    UPDATE public.ds_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = v_share.id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status', 'ACTIVE',
    'shareType', v_share.share_type,
    'title', v_pub.title,
    'sharedAt', v_pub.created_at,
    'geometryState', v_pub.canonical->>'geometryState',
    'ceilingSource', v_ceiling,
    'scene', v_scene,
    'state', v_pub.state,
    'assets', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'code', a.code, 'name', a.name, 'category', a.category, 'subcategory', a.subcategory,
        'room_kinds', a.room_kinds, 'style_tags', a.style_tags, 'color_tags', a.color_tags, 'material_tags', a.material_tags,
        'width_m', a.width_m, 'depth_m', a.depth_m, 'height_m', a.height_m, 'placement', a.placement, 'anchor', a.anchor,
        'clearance_m', a.clearance_m, 'procedural', a.procedural, 'material_slots', a.material_slots, 'variants', a.variants,
        'dominant_colors', a.dominant_colors, 'provenance', a.provenance, 'is_placeholder', a.is_placeholder, 'active', true,
        'capabilities', a.capabilities, 'interactions', a.interactions))
        FROM public.ds_catalog_assets a WHERE a.code = ANY (coalesce(v_codes, '{}'))), '[]'::jsonb),
    'materials', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'code', m.code, 'name', m.name, 'category', m.category, 'applies_to', m.applies_to,
        'style_tags', m.style_tags, 'color_family', m.color_family, 'pbr', m.pbr, 'provenance', m.provenance,
        'is_placeholder', m.is_placeholder, 'active', true))
        FROM public.ds_catalog_materials m WHERE m.id::text = ANY (coalesce(v_materials, '{}'))), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.ds_create_share(uuid, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_create_share(uuid, text, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.ds_revoke_share(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_revoke_share(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ds_public_share(text) FROM public;
GRANT EXECUTE ON FUNCTION public.ds_public_share(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_published_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ds_shares_guard() FROM public, anon, authenticated;
