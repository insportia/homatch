-- HOMATCH DESIGN STUDIO — admin "reprocess": re-validate and re-optimise
-- imported assets on the next importer run (e.g. after an optimiser fix).
--
-- Only READY or FAILED imports with a licence the pipeline already accepted
-- are re-queued; deletion candidates and deleted assets never are. The
-- catalogue row keeps its availability while it is re-processed (the
-- importer writes `active` from the import's lifecycle), so a published asset
-- stays published. Confirmed count, at most 5,000 at once, audited.

CREATE OR REPLACE FUNCTION public.ds_catalog_admin_requeue(p_ids text[], p_confirm_count integer, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_ids text[];
  v_actor uuid;
  v_queued text[];
  v_batches text[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'DS_CATALOG_ADMIN_ONLY'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_ids, '{}')) x WHERE x ~ '^hma_[0-9a-z]{26}$';
  v_ids := coalesce(v_ids, '{}');
  IF cardinality(v_ids) = 0 THEN RAISE EXCEPTION 'DS_CATALOG_NOTHING_SELECTED'; END IF;
  IF cardinality(v_ids) > 5000 THEN RAISE EXCEPTION 'DS_CATALOG_TOO_MANY: % (max 5000 at once)', cardinality(v_ids); END IF;
  IF p_confirm_count IS DISTINCT FROM cardinality(v_ids) THEN
    RAISE EXCEPTION 'DS_CATALOG_CONFIRM_MISMATCH: confirmed %, selected %', p_confirm_count, cardinality(v_ids);
  END IF;
  SELECT u.id INTO v_actor FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1;

  WITH q AS (
    UPDATE public.ds_catalog_imports
       SET state = 'QUEUED', attempts = 0, last_error = NULL, last_error_stage = NULL, lease_owner = NULL, lease_until = NULL, updated_at = now()
     WHERE homatch_asset_id = ANY (v_ids)
       AND state IN ('READY', 'FAILED')
       AND license_class IN ('CC0', 'ROYALTY_FREE')
       AND lifecycle NOT IN ('PENDING_DELETE', 'DELETED')
    RETURNING homatch_asset_id
  )
  SELECT coalesce(array_agg(homatch_asset_id), '{}') INTO v_queued FROM q;

  SELECT coalesce(array_agg(DISTINCT import_batch_id) FILTER (WHERE import_batch_id IS NOT NULL), '{}') INTO v_batches
    FROM public.ds_catalog_imports WHERE homatch_asset_id = ANY (v_ids);
  INSERT INTO public.ds_catalog_admin_events (actor_user_id, actor_kind, action, asset_count, homatch_asset_ids, import_batch_ids, reason, detail)
  VALUES (v_actor, 'ADMIN', 'REPROCESS', cardinality(v_queued), v_queued, v_batches, left(p_reason, 500),
          jsonb_build_object('selected', cardinality(v_ids), 'skipped', (SELECT coalesce(array_agg(x), '{}') FROM unnest(v_ids) x WHERE NOT x = ANY (v_queued))));
  RETURN jsonb_build_object('queued', cardinality(v_queued),
                            'skipped', to_jsonb((SELECT coalesce(array_agg(x), '{}') FROM unnest(v_ids) x WHERE NOT x = ANY (v_queued))));
END $$;
REVOKE ALL ON FUNCTION public.ds_catalog_admin_requeue(text[], integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_catalog_admin_requeue(text[], integer, text) TO authenticated;
