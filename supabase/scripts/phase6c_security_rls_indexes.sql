-- Homatch Phase 6c — Security Hardening, RLS, EXECUTE Grants, FK Indexes
-- Idempotent. Apply after Phase 6a/6b.
-- Run via: supabase db push or psql against lxatsnjscesjzniylksl

-- 1. Cost ledger — service-role only
ALTER TABLE public.cost_ledger ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cost_ledger' AND policyname='cost_ledger_service_only') THEN
    CREATE POLICY cost_ledger_service_only ON public.cost_ledger AS RESTRICTIVE FOR ALL TO authenticated USING (false);
  END IF;
END $$;

-- 2. discovery_query_queue — owner read only
ALTER TABLE public.discovery_query_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='discovery_query_queue' AND policyname='discovery_queue_owner_read') THEN
    CREATE POLICY discovery_queue_owner_read ON public.discovery_query_queue FOR SELECT TO authenticated
    USING (property_id IN (SELECT id FROM public.properties WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)));
  END IF;
END $$;

-- 3. property_signal_candidates — owner read
ALTER TABLE public.property_signal_candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_signal_candidates' AND policyname='signal_candidates_owner_read') THEN
    CREATE POLICY signal_candidates_owner_read ON public.property_signal_candidates FOR SELECT TO authenticated
    USING (property_id IN (SELECT id FROM public.properties WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)));
  END IF;
END $$;

-- 4. eligibility_decisions — owner read
ALTER TABLE public.eligibility_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='eligibility_decisions' AND policyname='eligibility_decisions_owner_read') THEN
    CREATE POLICY eligibility_decisions_owner_read ON public.eligibility_decisions FOR SELECT TO authenticated
    USING (property_id IN (SELECT id FROM public.properties WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)));
  END IF;
END $$;

-- 5. get_fresh_strong_match_count — refresh search_path
CREATE OR REPLACE FUNCTION public.get_fresh_strong_match_count(p_property_id uuid, p_min_score numeric, p_since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.count(*)::integer FROM public.matches
  WHERE property_id=p_property_id AND match_score>=p_min_score AND status IN ('NEW','PREVIEWED','UNLOCKED') AND created_at>=p_since;
$$;
REVOKE ALL ON FUNCTION public.get_fresh_strong_match_count(uuid,numeric,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fresh_strong_match_count(uuid,numeric,timestamptz) TO authenticated, service_role;

-- 6. complete_discovery_job
CREATE OR REPLACE FUNCTION public.complete_discovery_job(p_job_id uuid, p_claim_token text, p_success boolean, p_result_count integer DEFAULT 0, p_cost_usd numeric DEFAULT 0, p_error_msg text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer; v_max integer; v_matched boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.discovery_query_queue WHERE id=p_job_id AND claim_token=p_claim_token AND status='PROCESSING') INTO v_matched;
  IF NOT v_matched THEN RETURN false; END IF;
  SELECT attempts FROM public.discovery_query_queue WHERE id=p_job_id INTO v_attempts;
  SELECT COALESCE(replace(value,'"','')::integer,4) FROM public.admin_settings WHERE key='max_job_attempts' INTO v_max;
  IF p_success THEN
    UPDATE public.discovery_query_queue SET status='DONE',claim_token=NULL,completed_at=pg_catalog.now(),result_count=p_result_count,actual_cost_usd=p_cost_usd WHERE id=p_job_id;
  ELSIF COALESCE(v_attempts,1)<COALESCE(v_max,4) THEN
    UPDATE public.discovery_query_queue SET status='PENDING',claim_token=NULL,claimed_at=NULL,claimed_by=NULL,error_msg=p_error_msg,next_run_at=pg_catalog.now()+(INTERVAL '1 minute'*pg_catalog.power(2,COALESCE(v_attempts,1)-1)) WHERE id=p_job_id;
  ELSE
    UPDATE public.discovery_query_queue SET status='FAILED',claim_token=NULL,error_msg=p_error_msg,completed_at=pg_catalog.now() WHERE id=p_job_id;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.complete_discovery_job(uuid,text,boolean,integer,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_discovery_job(uuid,text,boolean,integer,numeric,text) TO service_role;

-- 7. FK performance indexes
CREATE INDEX IF NOT EXISTS idx_matches_property_score_status ON public.matches(property_id,match_score DESC,status) WHERE status IN('NEW','PREVIEWED','UNLOCKED');
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON public.notifications(user_id,type,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_property_job ON public.cost_ledger(property_id,job_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_decisions_property ON public.eligibility_decisions(property_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_queue_property_status ON public.discovery_query_queue(property_id,status,priority DESC,next_run_at) WHERE status IN('PENDING','PROCESSING');
CREATE INDEX IF NOT EXISTS idx_signal_candidates_property ON public.property_signal_candidates(property_id,signal_id);
CREATE INDEX IF NOT EXISTS idx_notifications_nav_path ON public.notifications(user_id,nav_path) WHERE nav_path IS NOT NULL;

-- 8. Revoke public execute on sensitive helpers
REVOKE EXECUTE ON FUNCTION public.get_user_id() FROM PUBLIC;

-- 9. Force-reset safety invariants
UPDATE public.admin_settings SET value='"false"' WHERE key='external_discovery_enabled';
UPDATE public.admin_settings SET value='"true"'  WHERE key='provider_kill_switch';
UPDATE public.admin_settings SET value='"0"' WHERE key IN('spend_cap_zenrows','spend_cap_scrapingbee','spend_cap_brightdata');

-- Verification
DO $$ DECLARE v_ext text; v_kill text;
BEGIN
  SELECT value INTO v_ext  FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT value INTO v_kill FROM public.admin_settings WHERE key='provider_kill_switch';
  IF v_ext  != '"false"' THEN RAISE EXCEPTION 'SAFETY VIOLATION: external_discovery_enabled must be "false"'; END IF;
  IF v_kill != '"true"'  THEN RAISE EXCEPTION 'SAFETY VIOLATION: provider_kill_switch must be "true"'; END IF;
  RAISE NOTICE 'Phase 6c SAFETY VERIFIED: external=false kill_switch=true';
END $$;
