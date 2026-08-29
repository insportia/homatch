-- ============================================================
-- Security hardening: safe search_path, revoke PUBLIC,
-- restrict privileged functions to correct roles
-- ============================================================

-- 1. auth_user_id: SECURITY INVOKER + safe search_path
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT auth.uid()
$$;
REVOKE ALL ON FUNCTION auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_id() FROM anon;
GRANT EXECUTE ON FUNCTION auth_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_id() TO service_role;

-- 2. increment_job_signals: must DROP first (param rename p_count→p_signals not allowed)
DROP FUNCTION IF EXISTS increment_job_signals(uuid, integer);
CREATE FUNCTION increment_job_signals(
  p_job_id uuid,
  p_count  integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.matching_jobs
  SET signals_collected = COALESCE(signals_collected, 0) + p_count,
      updated_at = now()
  WHERE id = p_job_id;
END;
$$;
REVOKE ALL ON FUNCTION increment_job_signals(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_job_signals(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION increment_job_signals(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_job_signals(uuid, integer) TO service_role;

-- 3. resolve_campaign_for_property: drop SECURITY DEFINER, safe search_path
CREATE OR REPLACE FUNCTION resolve_campaign_for_property(p_property_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  SELECT id INTO v_campaign_id
  FROM public.matching_campaigns
  WHERE property_id = p_property_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN v_campaign_id;
END;
$$;
REVOKE ALL ON FUNCTION resolve_campaign_for_property(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_campaign_for_property(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_campaign_for_property(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_campaign_for_property(uuid) TO service_role;

-- 4. set_updated_at: safe search_path, revoke PUBLIC
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION set_updated_at() TO service_role;

-- 5. Job-scoped unique constraint on query_packs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'query_packs_query_hash_key'
      AND conrelid = 'public.query_packs'::regclass
  ) THEN
    ALTER TABLE public.query_packs DROP CONSTRAINT query_packs_query_hash_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'query_packs_job_id_query_hash_key'
      AND conrelid = 'public.query_packs'::regclass
  ) THEN
    ALTER TABLE public.query_packs
      ADD CONSTRAINT query_packs_job_id_query_hash_key UNIQUE (job_id, query_hash);
  END IF;
END $$;