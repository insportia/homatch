-- HOMATCH DESIGN STUDIO — a shared design says truthfully where it came from.
--
-- The public viewer told every visitor "this space was drawn from a floor
-- plan", including for a home HOMATCH rebuilt from the owner's PICTURES: the
-- public payload carried geometryState but not the source's origin.
-- ds_public_share is redefined with exactly one addition, a coarse 'origin'
-- (PICTURES | FLOORPLAN | null) read from the frozen source's provenance.
-- Everything else is the 20260930094000 body, unchanged (verified identical to
-- production, prosrc md5 381d0e4d0fe4d0a8146103ea49614220, before writing).

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

  SELECT d.state, d.title, d.created_at, src.canonical, src.provenance->>'origin' AS origin INTO v_pub
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
    -- Where the space came from, coarsely: the viewer says "from pictures" or
    -- "from a floor plan" truthfully. Nothing else about the source is exposed.
    'origin', CASE v_pub.origin WHEN 'CUSTOMER_PICTURES' THEN 'PICTURES' WHEN 'CUSTOMER_FLOORPLAN' THEN 'FLOORPLAN' END,
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

REVOKE ALL ON FUNCTION public.ds_public_share(text) FROM public;
GRANT EXECUTE ON FUNCTION public.ds_public_share(text) TO anon, authenticated;
