-- HOMATCH DESIGN STUDIO — permanent project deletion.
--
-- A project is deleted by the server, in three steps, never by the browser:
--
--   1. ds_project_delete_begin (the OWNER, as themselves)
--        marks the project deleting and revokes every public share at once.
--        From here the project is gone from lists, cannot be edited, and no
--        share link exposes anything (ds_public_share answers REVOKED).
--   2. the edge route deletes every object under the project's storage
--        prefixes from R2 and marks each storage_objects row DELETED.
--   3. ds_project_delete_finish (SERVICE ONLY)
--        refuses while any ACTIVE or PENDING storage row is left, writes an
--        anonymous tombstone, and deletes the project; every Design Studio
--        row cascades from ds_projects.
--
-- What is deliberately KEPT: usage_events and every credit/billing ledger row
-- (they reference jobs by text, with no foreign key, so they are untouched),
-- and the storage_objects rows themselves, now DELETED, as the audit of what
-- was removed. The tombstone holds ids and counts only (no name, brief,
-- picture or design) so a kept usage row still resolves to "a project that
-- was deleted", not to nothing.
--
-- The direct client DELETE is removed: a row deleted from the browser would
-- cascade the database and leave every uploaded file in R2, ACTIVE, forever.

ALTER TABLE public.ds_projects ADD COLUMN IF NOT EXISTS deleting_at timestamptz;
COMMENT ON COLUMN public.ds_projects.deleting_at IS
  'Set by ds_project_delete_begin. A deleting project is hidden, immutable and unshared until ds_project_delete_finish removes it.';

CREATE TABLE IF NOT EXISTS public.ds_project_tombstones (
  project_id   uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  job_ids      uuid[] NOT NULL DEFAULT '{}',
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE public.ds_project_tombstones IS
  'A permanently deleted Design Studio project: ids and counts only, so kept billing/usage rows that name its jobs still resolve.';
ALTER TABLE public.ds_project_tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ds_project_tombstones_admin ON public.ds_project_tombstones;
CREATE POLICY ds_project_tombstones_admin ON public.ds_project_tombstones
  FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS ds_project_tombstones_service ON public.ds_project_tombstones;
CREATE POLICY ds_project_tombstones_service ON public.ds_project_tombstones
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.ds_project_tombstones FROM public, anon, authenticated;
GRANT SELECT ON public.ds_project_tombstones TO authenticated;
GRANT ALL ON public.ds_project_tombstones TO service_role;

-- No deleting from the browser. The owner deletes through the server route.
DROP POLICY IF EXISTS ds_projects_delete ON public.ds_projects;
REVOKE DELETE ON public.ds_projects FROM authenticated;

-- The guard, as before, plus: deleting_at is the server's, and a deleting
-- project cannot be changed by anyone but the service role.
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
    NEW.deleting_at := NULL;
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'DS_OWNER_IMMUTABLE';
    END IF;
    IF OLD.deleting_at IS NOT NULL THEN
      RAISE EXCEPTION 'DS_PROJECT_DELETING';
    END IF;
    -- Only ds_project_delete_begin sets it, for exactly this project.
    IF NEW.deleting_at IS DISTINCT FROM OLD.deleting_at
       AND coalesce(current_setting('homatch.ds_project_deleting', true), '') <> OLD.id::text THEN
      RAISE EXCEPTION 'DS_SERVER_FIELD';
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
REVOKE ALL ON FUNCTION public.ds_projects_guard() FROM public, anon, authenticated;

-- 1. The owner begins. Anyone else, admins included, reads it as not found.
CREATE OR REPLACE FUNCTION public.ds_project_delete_begin(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_me uuid := public.auth_user_id();
  v_project record;
  v_revoked integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'DS_NOT_AUTHENTICATED'; END IF;
  SELECT id, user_id, name, deleting_at INTO v_project
    FROM public.ds_projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.id IS NULL OR v_project.user_id <> v_me THEN
    RAISE EXCEPTION 'DS_NOT_FOUND';
  END IF;

  -- Idempotent: a retried delete (say, after a dropped connection) resumes.
  IF v_project.deleting_at IS NULL THEN
    PERFORM set_config('homatch.ds_project_deleting', p_project_id::text, true);
    UPDATE public.ds_projects SET deleting_at = now() WHERE id = p_project_id;
    PERFORM set_config('homatch.ds_project_deleting', '', true);
  END IF;
  UPDATE public.ds_shares SET revoked_at = now() WHERE project_id = p_project_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  RETURN jsonb_build_object('projectId', v_project.id, 'userId', v_project.user_id,
                            'name', v_project.name, 'sharesRevoked', v_revoked);
END $$;
REVOKE ALL ON FUNCTION public.ds_project_delete_begin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ds_project_delete_begin(uuid) TO authenticated, service_role;

-- 3. The server finishes, only once storage is empty.
CREATE OR REPLACE FUNCTION public.ds_project_delete_finish(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_project record;
  v_left integer;
  v_jobs uuid[];
  v_counts jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DS_SERVICE_ONLY'; END IF;
  SELECT id, user_id, deleting_at INTO v_project
    FROM public.ds_projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.id IS NULL THEN
    RETURN jsonb_build_object('state', 'ALREADY_DELETED');
  END IF;
  IF v_project.deleting_at IS NULL THEN RAISE EXCEPTION 'DS_DELETE_NOT_BEGUN'; END IF;

  SELECT count(*) INTO v_left FROM public.storage_objects o
   WHERE o.lifecycle IN ('ACTIVE', 'PENDING')
     AND ((o.entity_type = 'ds_project' AND o.entity_id = p_project_id)
          OR o.object_key LIKE 'users/' || v_project.user_id::text || '/design-studio-%/' || p_project_id::text || '/%');
  IF v_left > 0 THEN RAISE EXCEPTION 'DS_STORAGE_NOT_EMPTY'; END IF;

  -- A job still at work would write into a row that no longer exists (and,
  -- once AI work is priced, hold a reservation nothing could settle). Wait
  -- for it; a job silent for 15 minutes is dead and is closed here instead.
  IF EXISTS (SELECT 1 FROM public.ds_jobs j WHERE j.project_id = p_project_id
               AND j.status IN ('QUEUED', 'RUNNING')
               AND coalesce(j.started_at, j.created_at) > now() - interval '15 minutes') THEN
    RAISE EXCEPTION 'DS_JOBS_ACTIVE';
  END IF;
  UPDATE public.ds_jobs SET status = 'CANCELLED', error = 'PROJECT_DELETED', finished_at = now()
   WHERE project_id = p_project_id AND status IN ('QUEUED', 'RUNNING');

  SELECT coalesce(array_agg(j.id), '{}') INTO v_jobs FROM public.ds_jobs j WHERE j.project_id = p_project_id;
  v_counts := jsonb_build_object(
    'versions',        (SELECT count(*) FROM public.ds_versions        WHERE project_id = p_project_id),
    'sources',         (SELECT count(*) FROM public.ds_spatial_sources WHERE project_id = p_project_id),
    'floorplans',      (SELECT count(*) FROM public.ds_floorplans      WHERE project_id = p_project_id),
    'reconstructions', (SELECT count(*) FROM public.ds_reconstructions WHERE project_id = p_project_id),
    'published',       (SELECT count(*) FROM public.ds_published_designs WHERE project_id = p_project_id),
    'shares',          (SELECT count(*) FROM public.ds_shares          WHERE project_id = p_project_id),
    'savedViews',      (SELECT count(*) FROM public.ds_saved_views     WHERE project_id = p_project_id),
    'jobs',            cardinality(v_jobs));

  INSERT INTO public.ds_project_tombstones (project_id, user_id, requested_at, job_ids, counts)
  VALUES (v_project.id, v_project.user_id, v_project.deleting_at, v_jobs, v_counts)
  ON CONFLICT (project_id) DO NOTHING;
  DELETE FROM public.ds_projects WHERE id = p_project_id;

  RETURN jsonb_build_object('state', 'DELETED', 'counts', v_counts);
END $$;
REVOKE ALL ON FUNCTION public.ds_project_delete_finish(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ds_project_delete_finish(uuid) TO service_role;

-- Nothing is added to, or changed inside, a project while it is being
-- deleted: a plan, version or picture arriving mid-deletion would otherwise
-- leave the deletion stuck behind storage it cannot finish. Share UPDATEs
-- stay allowed, because revoking them is exactly what deleting does.
CREATE OR REPLACE FUNCTION public.ds_refuse_if_project_deleting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.ds_projects p WHERE p.id = NEW.project_id AND p.deleting_at IS NOT NULL) THEN
    RAISE EXCEPTION 'DS_PROJECT_DELETING';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ds_refuse_if_project_deleting() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ds_floorplans_not_deleting ON public.ds_floorplans;
CREATE TRIGGER trg_ds_floorplans_not_deleting BEFORE INSERT OR UPDATE ON public.ds_floorplans
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
DROP TRIGGER IF EXISTS trg_ds_versions_not_deleting ON public.ds_versions;
CREATE TRIGGER trg_ds_versions_not_deleting BEFORE INSERT OR UPDATE ON public.ds_versions
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
DROP TRIGGER IF EXISTS trg_ds_saved_views_not_deleting ON public.ds_saved_views;
CREATE TRIGGER trg_ds_saved_views_not_deleting BEFORE INSERT OR UPDATE ON public.ds_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
DROP TRIGGER IF EXISTS trg_ds_reconstructions_not_deleting ON public.ds_reconstructions;
CREATE TRIGGER trg_ds_reconstructions_not_deleting BEFORE INSERT OR UPDATE ON public.ds_reconstructions
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
DROP TRIGGER IF EXISTS trg_ds_published_not_deleting ON public.ds_published_designs;
CREATE TRIGGER trg_ds_published_not_deleting BEFORE INSERT ON public.ds_published_designs
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
DROP TRIGGER IF EXISTS trg_ds_shares_not_deleting ON public.ds_shares;
CREATE TRIGGER trg_ds_shares_not_deleting BEFORE INSERT ON public.ds_shares
  FOR EACH ROW EXECUTE FUNCTION public.ds_refuse_if_project_deleting();
