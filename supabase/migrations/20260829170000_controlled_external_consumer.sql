-- Controlled external discovery consumer foundation.
-- Paid launch flags remain unchanged. This migration adds atomic persistence,
-- provider-cycle accounting, one-at-a-time reservations, and dataset reconciliation.

ALTER TABLE public.cost_events
  ADD COLUMN IF NOT EXISTS discovery_job_id uuid;

ALTER TABLE public.apify_actor_runs
  ADD COLUMN IF NOT EXISTS discovery_job_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cost_events_discovery_job_id_fkey') THEN
    ALTER TABLE public.cost_events
      ADD CONSTRAINT cost_events_discovery_job_id_fkey
      FOREIGN KEY (discovery_job_id) REFERENCES public.discovery_query_queue(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='apify_actor_runs_discovery_job_id_fkey') THEN
    ALTER TABLE public.apify_actor_runs
      ADD CONSTRAINT apify_actor_runs_discovery_job_id_fkey
      FOREIGN KEY (discovery_job_id) REFERENCES public.discovery_query_queue(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cost_events_discovery_job_id
  ON public.cost_events(discovery_job_id) WHERE discovery_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apify_actor_runs_discovery_job_id
  ON public.apify_actor_runs(discovery_job_id) WHERE discovery_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.external_discovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.discovery_query_queue(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_discovery_events_job_created
  ON public.external_discovery_events(job_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_discovery_events_property_created
  ON public.external_discovery_events(property_id,created_at DESC);

ALTER TABLE public.external_discovery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_discovery_events_service_all ON public.external_discovery_events;
DROP POLICY IF EXISTS external_discovery_events_owner_select ON public.external_discovery_events;
CREATE POLICY external_discovery_events_service_all
  ON public.external_discovery_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY external_discovery_events_owner_select
  ON public.external_discovery_events FOR SELECT TO authenticated
  USING (
    property_id IN (
      SELECT p.id FROM public.properties p WHERE p.user_id=public.auth_user_id()
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid=pr.prpubid
    JOIN pg_class c ON c.oid=pr.prrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE p.pubname='supabase_realtime'
      AND n.nspname='public'
      AND c.relname='external_discovery_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.external_discovery_events;
  END IF;
END $$;

INSERT INTO public.admin_settings(key,value,description)
VALUES
  ('external_estimated_cost_dataforseo','0.01'::jsonb,'Conservative cost reservation per DataForSEO queue job.'),
  ('external_estimated_cost_apify','2.00'::jsonb,'Conservative cost reservation per Apify actor queue job.'),
  ('external_consumer_max_results','100'::jsonb,'Maximum normalized records persisted per external queue job.'),
  ('external_reconcile_batch_size','10'::jsonb,'Maximum already-paid Apify datasets reconciled per consumer call.'),
  ('external_provider_reported_cap_apify','29'::jsonb,'Apify account platform-usage limit reported by the provider.'),
  ('external_provider_billing_cycle_day_apify','28'::jsonb,'Apify billing cycle begins on this UTC calendar day.'),
  ('external_provider_spend_floor_apify','29'::jsonb,'Temporary floor reflecting provider-reported current-cycle usage.'),
  ('external_provider_spend_floor_apify_until','"2026-09-28T00:00:00Z"'::jsonb,'Current Apify spend floor expires at the next provider billing cycle.')
ON CONFLICT (key) DO NOTHING;

UPDATE public.discovery_query_queue
SET estimated_cost_usd = CASE upper(provider)
  WHEN 'APIFY' THEN 2.00
  WHEN 'DATAFORSEO' THEN 0.01
  ELSE estimated_cost_usd
END
WHERE status='PENDING'
  AND estimated_cost_usd IS NULL
  AND upper(coalesce(provider,'')) IN ('APIFY','DATAFORSEO');

CREATE OR REPLACE FUNCTION public.external_provider_budget_allows(
  p_provider text,
  p_estimated_cost numeric DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_provider text := upper(COALESCE(p_provider,''));
  v_est numeric := GREATEST(COALESCE(p_estimated_cost,0),0);
  v_provider_cap numeric := 0;
  v_reported_cap numeric := 0;
  v_global_cap numeric := 0;
  v_provider_spend numeric := 0;
  v_global_spend numeric := 0;
  v_provider_reserved numeric := 0;
  v_global_reserved numeric := 0;
  v_spend_floor numeric := 0;
  v_floor_until timestamptz := NULL;
  v_cycle_day integer := 1;
  v_cycle_start timestamptz := date_trunc('month',now());
  v_kill boolean := true;
  v_enabled boolean := false;
  v_disabled jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE((value #>> '{}')::boolean,false) INTO v_enabled
  FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT COALESCE((value #>> '{}')::boolean,true) INTO v_kill
  FROM public.admin_settings WHERE key='provider_kill_switch';
  SELECT COALESCE(value,'[]'::jsonb) INTO v_disabled
  FROM public.admin_settings WHERE key='provider_disabled_list';

  IF NOT v_enabled OR v_kill OR v_provider='' OR (v_disabled ? v_provider) THEN
    RETURN false;
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_global_cap
  FROM public.admin_settings WHERE key='spend_cap_global';
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_provider_cap
  FROM public.admin_settings WHERE key='spend_cap_'||lower(v_provider);
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_reported_cap
  FROM public.admin_settings WHERE key='external_provider_reported_cap_'||lower(v_provider);
  IF v_reported_cap > 0 THEN v_provider_cap := LEAST(v_provider_cap,v_reported_cap); END IF;
  IF v_global_cap <= 0 OR v_provider_cap <= 0 THEN RETURN false; END IF;

  SELECT COALESCE((value #>> '{}')::integer,1) INTO v_cycle_day
  FROM public.admin_settings WHERE key='external_provider_billing_cycle_day_'||lower(v_provider);
  v_cycle_day := LEAST(28,GREATEST(COALESCE(v_cycle_day,1),1));
  IF extract(day from now())::integer >= v_cycle_day THEN
    v_cycle_start := make_timestamptz(extract(year from now())::integer,extract(month from now())::integer,v_cycle_day,0,0,0,'UTC');
  ELSE
    v_cycle_start := make_timestamptz(extract(year from (now()-interval '1 month'))::integer,extract(month from (now()-interval '1 month'))::integer,v_cycle_day,0,0,0,'UTC');
  END IF;

  SELECT COALESCE(sum(cost_usd),0) INTO v_global_spend
  FROM public.cost_events
  WHERE timestamp >= date_trunc('month',now()) AND success IS TRUE;
  SELECT COALESCE(sum(cost_usd),0) INTO v_provider_spend
  FROM public.cost_events
  WHERE timestamp >= v_cycle_start
    AND success IS TRUE
    AND upper(provider::text)=v_provider;

  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_spend_floor
  FROM public.admin_settings WHERE key='external_provider_spend_floor_'||lower(v_provider);
  BEGIN
    SELECT (value #>> '{}')::timestamptz INTO v_floor_until
    FROM public.admin_settings WHERE key='external_provider_spend_floor_'||lower(v_provider)||'_until';
  EXCEPTION WHEN others THEN v_floor_until := NULL;
  END;
  IF v_floor_until IS NOT NULL AND now() < v_floor_until THEN
    v_provider_spend := GREATEST(v_provider_spend,v_spend_floor);
  END IF;

  SELECT COALESCE(sum(estimated_cost_usd),0) INTO v_global_reserved
  FROM public.discovery_query_queue WHERE status='PROCESSING';
  SELECT COALESCE(sum(estimated_cost_usd),0) INTO v_provider_reserved
  FROM public.discovery_query_queue
  WHERE status='PROCESSING' AND upper(coalesce(provider,''))=v_provider;

  RETURN v_global_spend + v_global_reserved + v_est <= v_global_cap
     AND v_provider_spend + v_provider_reserved + v_est <= v_provider_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.external_provider_budget_allows(text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.external_provider_budget_allows(text,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.external_discovery_job_execution_allows(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_job public.discovery_query_queue%ROWTYPE;
  v_enabled boolean := false;
  v_kill boolean := true;
  v_disabled jsonb := '[]'::jsonb;
  v_provider text;
  v_provider_cap numeric := 0;
  v_reported_cap numeric := 0;
  v_global_cap numeric := 0;
  v_provider_spend numeric := 0;
  v_global_spend numeric := 0;
  v_provider_reserved numeric := 0;
  v_global_reserved numeric := 0;
  v_est numeric := 0;
  v_cycle_day integer := 1;
  v_cycle_start timestamptz := date_trunc('month',now());
  v_spend_floor numeric := 0;
  v_floor_until timestamptz := NULL;
BEGIN
  SELECT * INTO v_job FROM public.discovery_query_queue
  WHERE id=p_job_id AND status='PROCESSING' AND claim_token=p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_provider := upper(coalesce(v_job.provider,''));
  v_est := greatest(coalesce(v_job.estimated_cost_usd,0),0);

  SELECT COALESCE((value #>> '{}')::boolean,false) INTO v_enabled FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT COALESCE((value #>> '{}')::boolean,true) INTO v_kill FROM public.admin_settings WHERE key='provider_kill_switch';
  SELECT COALESCE(value,'[]'::jsonb) INTO v_disabled FROM public.admin_settings WHERE key='provider_disabled_list';
  IF NOT v_enabled OR v_kill OR v_provider='' OR (v_disabled ? v_provider) THEN RETURN false; END IF;

  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_global_cap FROM public.admin_settings WHERE key='spend_cap_global';
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_provider_cap FROM public.admin_settings WHERE key='spend_cap_'||lower(v_provider);
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_reported_cap FROM public.admin_settings WHERE key='external_provider_reported_cap_'||lower(v_provider);
  IF v_reported_cap > 0 THEN v_provider_cap := LEAST(v_provider_cap,v_reported_cap); END IF;
  IF v_global_cap <= 0 OR v_provider_cap <= 0 THEN RETURN false; END IF;

  SELECT COALESCE((value #>> '{}')::integer,1) INTO v_cycle_day FROM public.admin_settings WHERE key='external_provider_billing_cycle_day_'||lower(v_provider);
  v_cycle_day := LEAST(28,GREATEST(COALESCE(v_cycle_day,1),1));
  IF extract(day from now())::integer >= v_cycle_day THEN
    v_cycle_start := make_timestamptz(extract(year from now())::integer,extract(month from now())::integer,v_cycle_day,0,0,0,'UTC');
  ELSE
    v_cycle_start := make_timestamptz(extract(year from (now()-interval '1 month'))::integer,extract(month from (now()-interval '1 month'))::integer,v_cycle_day,0,0,0,'UTC');
  END IF;
  SELECT COALESCE(sum(cost_usd),0) INTO v_global_spend FROM public.cost_events WHERE timestamp>=date_trunc('month',now()) AND success IS TRUE;
  SELECT COALESCE(sum(cost_usd),0) INTO v_provider_spend FROM public.cost_events WHERE timestamp>=v_cycle_start AND success IS TRUE AND upper(provider::text)=v_provider;
  SELECT COALESCE((value #>> '{}')::numeric,0) INTO v_spend_floor FROM public.admin_settings WHERE key='external_provider_spend_floor_'||lower(v_provider);
  BEGIN
    SELECT (value #>> '{}')::timestamptz INTO v_floor_until FROM public.admin_settings WHERE key='external_provider_spend_floor_'||lower(v_provider)||'_until';
  EXCEPTION WHEN others THEN v_floor_until := NULL;
  END;
  IF v_floor_until IS NOT NULL AND now()<v_floor_until THEN v_provider_spend:=GREATEST(v_provider_spend,v_spend_floor); END IF;
  SELECT COALESCE(sum(estimated_cost_usd),0) INTO v_global_reserved FROM public.discovery_query_queue WHERE status='PROCESSING' AND id<>p_job_id;
  SELECT COALESCE(sum(estimated_cost_usd),0) INTO v_provider_reserved FROM public.discovery_query_queue WHERE status='PROCESSING' AND id<>p_job_id AND upper(coalesce(provider,''))=v_provider;
  RETURN v_global_spend+v_global_reserved+v_est<=v_global_cap AND v_provider_spend+v_provider_reserved+v_est<=v_provider_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.external_discovery_job_execution_allows(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.external_discovery_job_execution_allows(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_external_discovery_jobs_for_property(
  p_property_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.discovery_query_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean := false;
  v_kill boolean := true;
  v_disabled jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('homatch_external_discovery_budget_claim'));
  SELECT COALESCE((value #>> '{}')::boolean,false) INTO v_enabled FROM public.admin_settings WHERE key='external_discovery_enabled';
  SELECT COALESCE((value #>> '{}')::boolean,true) INTO v_kill FROM public.admin_settings WHERE key='provider_kill_switch';
  SELECT COALESCE(value,'[]'::jsonb) INTO v_disabled FROM public.admin_settings WHERE key='provider_disabled_list';
  IF NOT v_enabled OR v_kill THEN RETURN; END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id,
      COALESCE(q.estimated_cost_usd,CASE upper(q.provider) WHEN 'APIFY' THEN 2.00 WHEN 'DATAFORSEO' THEN 0.01 ELSE 999999 END) estimate
    FROM public.discovery_query_queue q
    WHERE q.property_id=p_property_id
      AND q.status='PENDING'
      AND COALESCE(q.next_attempt_at,now())<=now()
      AND q.provider IS NOT NULL
      AND upper(q.provider) IN ('APIFY','DATAFORSEO')
      AND NOT (v_disabled ? upper(q.provider))
      AND public.external_provider_budget_allows(q.provider,COALESCE(q.estimated_cost_usd,CASE upper(q.provider) WHEN 'APIFY' THEN 2.00 WHEN 'DATAFORSEO' THEN 0.01 ELSE 999999 END))
    ORDER BY q.priority DESC,q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.discovery_query_queue q
  SET status='PROCESSING',claimed_at=now(),claim_token=gen_random_uuid(),
      started_at=COALESCE(q.started_at,now()),attempts=COALESCE(q.attempts,0)+1,
      estimated_cost_usd=picked.estimate
  FROM picked WHERE q.id=picked.id
  RETURNING q.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_external_discovery_jobs_for_property(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_external_discovery_jobs_for_property(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.persist_external_discovery_results(
  p_job_id uuid,
  p_results jsonb,
  p_actual_cost_usd numeric DEFAULT 0,
  p_external_run_id text DEFAULT NULL,
  p_dataset_id text DEFAULT NULL,
  p_claim_token uuid DEFAULT NULL,
  p_reconcile boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_job public.discovery_query_queue%ROWTYPE;
  v_item jsonb;
  v_provider text;
  v_platform public.signal_platform;
  v_source_type public.source_type;
  v_source_id uuid;
  v_signal_id uuid;
  v_new boolean;
  v_text text;
  v_url text;
  v_source_url text;
  v_source_external_id text;
  v_external_id text;
  v_published timestamptz;
  v_processed integer := 0;
  v_inserted integer := 0;
  v_linked integer := 0;
  v_input_count integer := 0;
  v_cost numeric := greatest(coalesce(p_actual_cost_usd,0),0);
  v_share numeric := 0;
BEGIN
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'RESULTS_MUST_BE_ARRAY'; END IF;
  v_input_count:=jsonb_array_length(p_results);
  IF v_input_count>500 THEN RAISE EXCEPTION 'RESULT_LIMIT_EXCEEDED'; END IF;

  SELECT * INTO v_job FROM public.discovery_query_queue WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DISCOVERY_JOB_NOT_FOUND'; END IF;
  IF p_reconcile THEN
    IF v_job.status<>'DONE' THEN RAISE EXCEPTION 'RECONCILE_REQUIRES_DONE_JOB'; END IF;
  ELSE
    IF v_job.status<>'PROCESSING' OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'CLAIM_TOKEN_MISMATCH'; END IF;
  END IF;
  v_provider:=upper(coalesce(v_job.provider,''));
  IF v_provider NOT IN ('APIFY','DATAFORSEO') THEN RAISE EXCEPTION 'UNSUPPORTED_PROVIDER'; END IF;
  v_share:=CASE WHEN v_input_count>0 THEN v_cost/v_input_count ELSE 0 END;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    v_text:=trim(coalesce(nullif(v_item->>'text',''),nullif(v_item->>'original_text',''),nullif(v_item->>'snippet',''),nullif(v_item->>'title','')));
    IF length(v_text)<5 THEN CONTINUE; END IF;
    v_url:=nullif(coalesce(v_item->>'source_url',v_item->>'url'),'');
    IF v_provider='DATAFORSEO' THEN v_platform:='GOOGLE'::public.signal_platform;
    ELSE
      v_platform:=CASE upper(coalesce(v_item->>'platform',v_job.platform,''))
        WHEN 'FACEBOOK' THEN 'FACEBOOK'::public.signal_platform
        WHEN 'TELEGRAM' THEN 'TELEGRAM'::public.signal_platform
        WHEN 'INSTAGRAM' THEN 'INSTAGRAM'::public.signal_platform
        WHEN 'VK' THEN 'VK'::public.signal_platform
        WHEN 'REDDIT' THEN 'FORUM'::public.signal_platform
        WHEN 'FORUM' THEN 'FORUM'::public.signal_platform
        WHEN 'WEB' THEN 'WEBSITE'::public.signal_platform
        WHEN 'WEBSITE' THEN 'WEBSITE'::public.signal_platform
        ELSE 'OTHER'::public.signal_platform END;
    END IF;
    v_source_type:=CASE v_platform
      WHEN 'FACEBOOK'::public.signal_platform THEN 'FACEBOOK_GROUP'::public.source_type
      WHEN 'TELEGRAM'::public.signal_platform THEN 'TELEGRAM_GROUP'::public.source_type
      WHEN 'INSTAGRAM'::public.signal_platform THEN 'INSTAGRAM_PROFILE'::public.source_type
      WHEN 'VK'::public.signal_platform THEN 'VK_COMMUNITY'::public.source_type
      WHEN 'FORUM'::public.signal_platform THEN 'FORUM'::public.source_type
      WHEN 'GOOGLE'::public.signal_platform THEN 'SEARCH_RESULT'::public.source_type
      WHEN 'BING'::public.signal_platform THEN 'SEARCH_RESULT'::public.source_type
      ELSE 'WEBSITE'::public.source_type END;
    v_source_url:=coalesce(nullif(v_item->>'source_root_url',''),v_url,CASE v_platform
      WHEN 'FACEBOOK'::public.signal_platform THEN 'https://facebook.com/'
      WHEN 'TELEGRAM'::public.signal_platform THEN 'https://t.me/'
      WHEN 'INSTAGRAM'::public.signal_platform THEN 'https://instagram.com/'
      WHEN 'VK'::public.signal_platform THEN 'https://vk.com/'
      WHEN 'FORUM'::public.signal_platform THEN 'https://reddit.com/'
      WHEN 'GOOGLE'::public.signal_platform THEN 'https://google.com/'
      ELSE 'https://www.homatch.online/' END);
    v_source_external_id:=coalesce(nullif(v_item->>'source_external_id',''),nullif(v_item->>'domain',''),v_provider||':'||v_platform::text);

    INSERT INTO public.source_registry(platform,source_type,external_id,name,url,country_code,language,active,priority,quality_score,provider,last_collected_at,last_successful_at)
    VALUES(v_platform,v_source_type,v_source_external_id,coalesce(nullif(v_item->>'source_name',''),v_source_external_id),v_source_url,coalesce(nullif(v_item->>'country_code',''),'GE'),coalesce(nullif(v_item->>'language',''),v_job.language),true,80,7,v_provider,now(),now())
    ON CONFLICT(platform,external_id) DO UPDATE SET
      url=excluded.url,provider=excluded.provider,last_collected_at=now(),last_successful_at=now(),updated_at=now()
    RETURNING id INTO v_source_id;

    v_external_id:=coalesce(nullif(v_item->>'external_id',''),v_url,md5(v_platform::text||':'||v_text));
    v_published:=NULL;
    BEGIN
      IF nullif(v_item->>'published_at','') IS NOT NULL THEN v_published:=(v_item->>'published_at')::timestamptz; END IF;
    EXCEPTION WHEN others THEN v_published:=NULL;
    END;
    INSERT INTO public.raw_signals(source_id,platform,external_id,source_url,author_public_name,author_public_url,original_text,language,published_at,content_fingerprint,provider,classification_status,mock_mode,profile_url,title,snippet_text,domain,rank_position,query_text,dataforseo_task_id,actor_run_id,actor_dataset_id)
    VALUES(v_source_id,v_platform,v_external_id,v_url,nullif(v_item->>'author_name',''),nullif(v_item->>'author_url',''),v_text,coalesce(nullif(v_item->>'language',''),v_job.language),v_published,coalesce(nullif(v_item->>'content_fingerprint',''),md5(lower(v_text))),v_provider,'PENDING'::public.classification_status,false,nullif(v_item->>'profile_url',''),nullif(v_item->>'title',''),nullif(v_item->>'snippet',''),nullif(v_item->>'domain',''),nullif(v_item->>'rank_position','')::integer,v_job.query,nullif(v_item->>'provider_task_id',''),CASE WHEN v_provider='APIFY' THEN p_external_run_id ELSE NULL END,CASE WHEN v_provider='APIFY' THEN p_dataset_id ELSE NULL END)
    ON CONFLICT(platform,external_id) DO UPDATE SET
      source_id=coalesce(raw_signals.source_id,excluded.source_id),
      last_seen_at=now(),
      provider=coalesce(raw_signals.provider,excluded.provider),
      actor_run_id=coalesce(raw_signals.actor_run_id,excluded.actor_run_id),
      actor_dataset_id=coalesce(raw_signals.actor_dataset_id,excluded.actor_dataset_id),
      dataforseo_task_id=coalesce(raw_signals.dataforseo_task_id,excluded.dataforseo_task_id),
      title=coalesce(raw_signals.title,excluded.title),
      snippet_text=coalesce(raw_signals.snippet_text,excluded.snippet_text),
      domain=coalesce(raw_signals.domain,excluded.domain),
      rank_position=coalesce(raw_signals.rank_position,excluded.rank_position),
      query_text=coalesce(raw_signals.query_text,excluded.query_text)
    RETURNING id,(xmax=0) INTO v_signal_id,v_new;
    v_processed:=v_processed+1;
    IF v_new THEN v_inserted:=v_inserted+1; END IF;

    INSERT INTO public.property_signal_candidates(property_id,signal_id,query_id,acquisition_cost_usd,first_seen_at,last_seen_at,metadata)
    VALUES(v_job.property_id,v_signal_id,v_job.id,v_share,now(),now(),jsonb_build_object('provider',v_provider,'external_run_id',p_external_run_id,'dataset_id',p_dataset_id,'reconciled',p_reconcile))
    ON CONFLICT(property_id,signal_id) DO UPDATE SET
      query_id=excluded.query_id,last_seen_at=now(),
      acquisition_cost_usd=greatest(property_signal_candidates.acquisition_cost_usd,excluded.acquisition_cost_usd),
      metadata=property_signal_candidates.metadata||excluded.metadata;
    v_linked:=v_linked+1;
  END LOOP;

  IF v_provider='APIFY' AND nullif(p_external_run_id,'') IS NOT NULL THEN
    INSERT INTO public.apify_actor_runs(discovery_job_id,platform,actor_id,run_id,dataset_id,status,items_returned,cost_usd,started_at,finished_at,dataset_fetched,updated_at)
    VALUES(v_job.id,v_job.platform,v_job.actor_id,p_external_run_id,p_dataset_id,'SUCCEEDED',v_processed,v_cost,coalesce(v_job.started_at,now()),now(),true,now())
    ON CONFLICT(run_id) DO UPDATE SET
      discovery_job_id=excluded.discovery_job_id,dataset_id=coalesce(excluded.dataset_id,apify_actor_runs.dataset_id),status='SUCCEEDED',items_returned=excluded.items_returned,cost_usd=greatest(apify_actor_runs.cost_usd,excluded.cost_usd),finished_at=now(),dataset_fetched=true,updated_at=now();
  END IF;

  IF p_reconcile THEN
    UPDATE public.discovery_query_queue SET
      metadata=metadata||jsonb_build_object('reconciled_at',now(),'reconciled_items',v_processed,'reconciled_inserted',v_inserted),
      result_count=greatest(result_count,v_processed),
      external_run_id=coalesce(p_external_run_id,external_run_id),dataset_id=coalesce(p_dataset_id,dataset_id)
    WHERE id=v_job.id;
  ELSE
    INSERT INTO public.cost_events(provider,operation_type,source,market,request_id,units,cost_usd,success,cache_hit,property_id,discovery_job_id)
    VALUES(v_provider::public.cost_provider,'EXTERNAL_DISCOVERY_'||v_provider,'queue:'||v_job.id::text||':'||left(v_job.query,120),coalesce(v_job.metadata->>'country_code','GE'),coalesce(p_external_run_id,v_job.id::text),v_input_count,v_cost,true,false,v_job.property_id,v_job.id);
    UPDATE public.discovery_query_queue SET
      status='DONE',result_count=v_processed,actual_cost_usd=v_cost,
      external_run_id=coalesce(p_external_run_id,external_run_id),dataset_id=coalesce(p_dataset_id,dataset_id),
      processed_at=now(),finished_at=now(),last_error=NULL,claim_token=NULL,claimed_at=NULL,
      metadata=metadata||jsonb_build_object('persisted_at',now(),'persisted_items',v_processed,'inserted_signals',v_inserted)
    WHERE id=v_job.id;
    IF NOT public.external_provider_budget_allows(v_provider,0) THEN
      UPDATE public.admin_settings SET value='true'::jsonb,updated_at=now() WHERE key='provider_kill_switch';
    END IF;
  END IF;

  INSERT INTO public.external_discovery_events(job_id,property_id,event_type,payload)
  VALUES(v_job.id,v_job.property_id,CASE WHEN p_reconcile THEN 'DATASET_RECONCILED' ELSE 'RESULTS_PERSISTED' END,
         jsonb_build_object('provider',v_provider,'input',v_input_count,'processed',v_processed,'inserted',v_inserted,'linked',v_linked,'cost_usd',CASE WHEN p_reconcile THEN 0 ELSE v_cost END,'external_run_id',p_external_run_id,'dataset_id',p_dataset_id));
  RETURN jsonb_build_object('jobId',v_job.id,'propertyId',v_job.property_id,'provider',v_provider,'inputCount',v_input_count,'processed',v_processed,'inserted',v_inserted,'linked',v_linked,'reconciled',p_reconcile);
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_external_discovery_results(uuid,jsonb,numeric,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_external_discovery_results(uuid,jsonb,numeric,text,text,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_non_demand_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_signal record; v_intent record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.property_signal_candidates c WHERE c.property_id=NEW.property_id AND c.signal_id=NEW.signal_id) THEN RAISE EXCEPTION 'SIGNAL_NOT_SCOPED_TO_PROPERTY'; END IF;
  SELECT classification_status,intent_type,original_text INTO v_signal FROM public.raw_signals WHERE id=NEW.signal_id;
  SELECT intent_type,intent_confidence INTO v_intent FROM public.intent_profiles WHERE id=NEW.intent_profile_id;
  IF v_signal.classification_status IS DISTINCT FROM 'CLASSIFIED'::public.classification_status
     OR COALESCE(v_intent.intent_type::text,'') NOT IN ('BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT')
     OR COALESCE(v_intent.intent_confidence,0)<0.65
     OR COALESCE(v_signal.intent_type,'') NOT IN ('BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT')
     OR COALESCE(v_signal.original_text,'') ~* '(apartment|house|villa|land|office|commercial|studio|penthouse).{0,25}for[[:space:]]+(rent|sale)|(^|[^[:alpha:]])(იყიდება|ქირავდება|сда[её]тся|прода[её]тся|kiralık|satılık|للإيجار|للبيع|להשכרה|למכירה)'
  THEN RAISE EXCEPTION 'NON_DEMAND_SIGNAL_REJECTED'; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_non_demand_match() FROM PUBLIC;
