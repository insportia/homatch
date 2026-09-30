-- HOMATCH DESIGN STUDIO — a space built from pictures says so.
--
-- ds_create_floorplan_source recorded every plan-built space as
-- origin CUSTOMER_FLOORPLAN, including the plans HOMATCH read from a
-- customer's PICTURES (a ds_floorplans row with purpose = 'REFERENCE'). The
-- space then told its owner it came "from your floor plan" when it came from
-- their pictures. The function is redefined with exactly one change: it reads
-- the plan row's purpose and records CUSTOMER_PICTURES for a picture reading.
-- Everything else (ownership, the ESTIMATED/CALIBRATED/VERIFIED checks, the
-- supersede-never-overwrite rule) is the 20260930090000 body, unchanged.
--
-- Existing picture-built sources are corrected in place. A READY source is
-- immutable to everyone but the service role (ds_sources_guard), so the
-- backfill acts as the service role for this transaction only, and changes
-- nothing but provenance.origin.

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
  SELECT f.id, f.project_id, f.status, f.purpose INTO v_plan
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
     jsonb_build_object('origin', CASE WHEN v_plan.purpose = 'REFERENCE' THEN 'CUSTOMER_PICTURES' ELSE 'CUSTOMER_FLOORPLAN' END, 'verified_by',
       CASE WHEN p_geometry_state = 'VERIFIED' THEN 'CUSTOMER_MEASUREMENTS' END))
  RETURNING id INTO v_source;

  RETURN v_source;
END $$;

REVOKE ALL ON FUNCTION public.ds_create_floorplan_source(uuid, jsonb, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_create_floorplan_source(uuid, jsonb, text, jsonb, text) TO authenticated;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.ds_spatial_sources s
     SET provenance = s.provenance || jsonb_build_object('origin', 'CUSTOMER_PICTURES')
    FROM public.ds_floorplans f
   WHERE s.floorplan_id = f.id
     AND f.purpose = 'REFERENCE'
     AND s.kind = 'FLOORPLAN_SCENE'
     AND coalesce(s.provenance->>'origin', '') <> 'CUSTOMER_PICTURES';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
