-- Production safety hardening: restore the budget guard required by the
-- property-scoped claim engine and make retry limits admin-configurable.

CREATE OR REPLACE FUNCTION public.external_provider_budget_allows(p_provider text, p_estimated_cost numeric DEFAULT 0)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_provider text := upper(COALESCE(p_provider,''));
  v_est numeric := GREATEST(COALESCE(p_estimated_cost,0),0);
  v_provider_cap numeric := 0;
  v_global_cap numeric := 0;
  v_provider_spend numeric := 0;
  v_global_spend numeric := 0;
  v_kill boolean := true;
  v_enabled boolean := false;
  v_disabled jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE((value #>> '{}')::boolean,false) INTO v_enabled FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT COALESCE((value #>> '{}')::boolean,true) INTO v_kill FROM public.admin_settings WHERE key='provider_kill_switch';
  SELECT COALESCE(value,'[]'::jsonb) INTO v_disabled FROM public.admin_settings WHERE key='provider_disabled_list';

  IF NOT v_enabled OR v_kill OR v_provider='' OR (v_disabled ? v_provider) THEN
    RETURN false;
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_global_cap FROM public.admin_settings WHERE key='spend_cap_global';
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_provider_cap FROM public.admin_settings WHERE key='spend_cap_'||lower(v_provider);

  IF v_global_cap <= 0 OR v_provider_cap <= 0 THEN
    RETURN false;
  END IF;

  SELECT COALESCE(sum(cost_usd),0) INTO v_global_spend
  FROM public.cost_events
  WHERE timestamp >= date_trunc('month',now()) AND success IS TRUE;

  SELECT COALESCE(sum(cost_usd),0) INTO v_provider_spend
  FROM public.cost_events
  WHERE timestamp >= date_trunc('month',now())
    AND success IS TRUE
    AND upper(provider::text)=v_provider;

  RETURN v_global_spend + v_est <= v_global_cap
     AND v_provider_spend + v_est <= v_provider_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.external_provider_budget_allows(text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.external_provider_budget_allows(text,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_external_discovery_job(p_job_id uuid, p_claim_token uuid, p_error text, p_retryable boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_attempts integer;
  v_max_attempts integer := 4;
BEGIN
  SELECT COALESCE((value #>> '{}')::integer,4) INTO v_max_attempts
  FROM public.admin_settings WHERE key='external_discovery_max_attempts';
  v_max_attempts := GREATEST(COALESCE(v_max_attempts,4),1);

  SELECT attempts INTO v_attempts
  FROM public.discovery_query_queue
  WHERE id=p_job_id AND status='PROCESSING' AND claim_token=p_claim_token
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.discovery_query_queue SET
    status=CASE WHEN p_retryable AND COALESCE(v_attempts,0)<v_max_attempts THEN 'PENDING' ELSE 'FAILED' END,
    last_error=left(COALESCE(p_error,'unknown error'),1000),
    next_attempt_at=CASE
      WHEN p_retryable AND COALESCE(v_attempts,0)<v_max_attempts
      THEN now()+(interval '5 minutes' * power(2,GREATEST(COALESCE(v_attempts,1)-1,0)))
      ELSE next_attempt_at END,
    claim_token=NULL,
    claimed_at=NULL,
    finished_at=CASE WHEN NOT p_retryable OR COALESCE(v_attempts,0)>=v_max_attempts THEN now() ELSE finished_at END
  WHERE id=p_job_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.fail_external_discovery_job(uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_external_discovery_job(uuid,uuid,text,boolean) TO service_role;
