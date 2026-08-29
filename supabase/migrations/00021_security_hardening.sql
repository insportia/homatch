-- ================================================================
-- Homatch — Security Hardening Migration
-- Version  : 20260829000002_security_hardening
-- Fixes    : Safe search_path on helper functions,
--            revoke PUBLIC execute where not needed,
--            restrict privileged mutations to service_role,
--            remove SECURITY DEFINER where not genuinely required.
-- Resolves : supabase security advisor warnings for
--            auth_user_id, increment_job_signals,
--            resolve_campaign_for_property
-- ================================================================

-- ── 1. auth_user_id ──────────────────────────────────────────
-- SECURITY DEFINER is required here (reads auth.uid() via users join).
-- Fix: add SET search_path, revoke PUBLIC execute, grant only authenticated.
CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_id() FROM anon;
GRANT  EXECUTE ON FUNCTION public.auth_user_id() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.auth_user_id() TO service_role;

-- ── 2. increment_job_signals ─────────────────────────────────
-- Mutates matching_jobs.signals_collected.
-- Called only from Edge Function (service_role JWT).
-- Fix: safe search_path, restrict to service_role only.
CREATE OR REPLACE FUNCTION public.increment_job_signals(
  p_job_id uuid,
  p_count  integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.matching_jobs
  SET signals_collected = signals_collected + p_count,
      updated_at = now()
  WHERE id = p_job_id;
$$;

REVOKE ALL  ON FUNCTION public.increment_job_signals(uuid, integer) FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.increment_job_signals(uuid, integer) FROM anon;
REVOKE ALL  ON FUNCTION public.increment_job_signals(uuid, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_job_signals(uuid, integer) TO service_role;

-- ── 3. resolve_campaign_for_property ────────────────────────
-- Read-only lookup — SECURITY DEFINER is NOT required.
-- Rewrite as SECURITY INVOKER (default) with safe search_path.
CREATE OR REPLACE FUNCTION public.resolve_campaign_for_property(
  p_property_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT id FROM public.matching_campaigns
  WHERE property_id = p_property_id
  ORDER BY created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_for_property(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_campaign_for_property(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.resolve_campaign_for_property(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_campaign_for_property(uuid) TO service_role;

-- ── 4. set_updated_at trigger helper ────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;

-- ── 5. Ensure anon cannot select matching_jobs via RLS ───────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'matching_jobs' AND policyname = 'mj_anon_deny'
  ) THEN
    CREATE POLICY mj_anon_deny ON public.matching_jobs
      FOR ALL TO anon USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'matching_job_events' AND policyname = 'mje_anon_deny'
  ) THEN
    CREATE POLICY mje_anon_deny ON public.matching_job_events
      FOR ALL TO anon USING (false);
  END IF;
END $$;

-- ── 6. job-scoped unique constraint on query_packs ───────────
-- Prevents one job from overwriting another job's query_pack history.
-- Drop old global unique on query_hash if it exists, add job-scoped one.
DO $$ BEGIN
  ALTER TABLE public.query_packs DROP CONSTRAINT IF EXISTS query_packs_query_hash_key;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.query_packs
    ADD CONSTRAINT query_packs_job_id_query_hash_key UNIQUE (job_id, query_hash);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL; END $$;
