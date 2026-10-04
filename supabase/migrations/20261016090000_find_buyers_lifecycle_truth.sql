-- FIND BUYERS / FIND TENANTS — lifecycle truth (additive; no data changes).
--
-- Production case 693e6d75 (2026-10-04): a paid campaign finished 220 ms
-- after it was created with zero queue jobs and zero actor runs (social
-- switch off, every Actor disabled, native source discovery off), settled
-- 25 credits for internal matching only, and told the owner "Your client
-- search finished: 0 new matches". This migration makes the database say
-- what actually happened:
--
--   1. find_buyers_job_state(job)   ONE server-side derivation of a campaign's
--      state (PREPARING … UNAVAILABLE) and real counters, used by the owner
--      read (find_buyers_campaign_status) and the admin center alike.
--   2. find_buyers_readiness()      can a search execute anything right now?
--      (switch + at least one eligible Actor, or native source discovery).
--   3. Pause = PAUSING then PAUSED: started memo23 runs keep being polled and
--      booked; nothing new starts (claim + discovery_control).
--   4. Notifications follow the lifecycle: "finished, 0 new" only when real
--      work ran; a search that executed nothing says it could not start.
--      Localised by users.preferred_language.
--   5. Admin center campaigns carry the lifecycle block.


------------------------------------------------------------------------------
-- 1. The one state derivation.
------------------------------------------------------------------------------
create or replace function public.find_buyers_job_state(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  j public.matching_jobs%rowtype;
  c public.find_buyers_campaigns%rowtype;
  v_q jsonb;
  v_nodes jsonb;
  v_runs jsonb;
  v_pending int; v_running int; v_done int; v_failed int; v_cancelled int; v_paused int; v_total int;
  v_in_flight int; v_runs_booked int; v_runs_ok int; v_runs_failed int;
  v_leads int; v_strong int; v_matches int;
  v_new int; v_executed boolean; v_state text; v_stage text;
begin
  select * into j from public.matching_jobs where id = p_job_id;
  if not found then return null; end if;
  select * into c from public.find_buyers_campaigns where matching_job_id = p_job_id;

  select count(*) filter (where status = 'PENDING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is null)),
         count(*) filter (where status = 'PROCESSING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is not null)),
         count(*) filter (where status = 'DONE'),
         count(*) filter (where status in ('FAILED', 'BUDGET_REACHED')),
         count(*) filter (where status = 'CANCELLED'),
         count(*) filter (where status = 'PAUSED'),
         count(*)
    into v_pending, v_running, v_done, v_failed, v_cancelled, v_paused, v_total
    from public.discovery_query_queue where matching_job_id = p_job_id;

  /* Source nodes: only networks this campaign actually queued. */
  select coalesce(jsonb_agg(n order by n ->> 'source'), '[]'::jsonb) into v_nodes from (
    select jsonb_build_object(
      'source', upper(coalesce(platform, provider, 'WEB')),
      'total', count(*),
      'running', count(*) filter (where status = 'PROCESSING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is not null)),
      'queued', count(*) filter (where status in ('PENDING', 'PAUSED') or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is null)),
      'done', count(*) filter (where status = 'DONE'),
      'failed', count(*) filter (where status in ('FAILED', 'BUDGET_REACHED')),
      'results', coalesce(sum(result_count) filter (where status = 'DONE'), 0),
      'state', case
        when count(*) filter (where status = 'PROCESSING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is not null)) > 0 then 'RUNNING'
        when count(*) filter (where status in ('PENDING', 'RETRY_WAIT', 'PAUSED')) > 0 then 'QUEUED'
        when count(*) filter (where status = 'DONE') > 0 then 'DONE'
        when count(*) filter (where status in ('FAILED', 'BUDGET_REACHED')) > 0 then 'FAILED'
        else 'CANCELLED' end) as n
      from public.discovery_query_queue where matching_job_id = p_job_id
     group by upper(coalesce(platform, provider, 'WEB'))) s;

  select count(*) filter (where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null),
         count(*) filter (where cost_booked_at is not null and status <> 'RELEASED'),
         count(*) filter (where status = 'SUCCEEDED'),
         count(*) filter (where status in ('FAILED', 'TIMED_OUT', 'ABORTED'))
    into v_in_flight, v_runs_booked, v_runs_ok, v_runs_failed
    from public.find_buyers_actor_runs where matching_job_id = p_job_id;

  select count(*), count(*) filter (where strength = 'STRONG') into v_leads, v_strong
    from public.find_buyers_leads where matching_job_id = p_job_id;
  /* New matches of THIS campaign that are current demand (30-day rule). */
  select count(*) into v_matches from public.matches m
   where m.job_id = p_job_id and m.status::text <> 'REJECTED'
     and (m.status::text = 'UNLOCKED' or (m.demand_published_at >= now() - interval '30 days'
                                          and m.demand_published_at <= now() + interval '24 hours'));
  v_new := v_leads + v_matches;
  /* Real work = a source job reached a terminal outcome, or a provider run was booked. */
  v_executed := (v_done + v_failed) > 0 or v_runs_booked > 0;

  v_state := case
    when j.status::text in ('queued', 'analysing_property', 'generating_queries') then 'PREPARING'
    when j.status::text = 'searching_sources' then
      case when v_running = 0 and v_in_flight = 0 and v_done + v_failed = 0 then 'QUEUED'
           when v_new > 0 then 'PARTIAL_RESULTS' else 'SEARCHING' end
    when j.status::text in ('collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking') then
      case when v_new > 0 then 'PARTIAL_RESULTS' else 'SEARCHING' end
    when j.status::text = 'paused' then case when v_in_flight > 0 or v_running > 0 then 'PAUSING' else 'PAUSED' end
    when j.status::text in ('completed', 'partially_completed', 'budget_reached') then
      case when v_new > 0 or coalesce(j.fresh_matches_created, 0) > 0 then 'COMPLETED_WITH_RESULTS'
           when not v_executed then 'UNAVAILABLE'
           when v_done = 0 and v_runs_ok = 0 then 'DEGRADED_COMPLETED'
           else 'COMPLETED_NO_RESULTS' end
    when j.status::text = 'failed' then
      case when j.failure_reason in ('DISCOVERY_UNAVAILABLE', 'NO_EXECUTABLE_WORK') then 'UNAVAILABLE' else 'FAILED' end
    when j.status::text = 'cancelled' then 'CANCELLED'
    else 'FAILED' end;
  v_stage := case
    when j.status::text in ('collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking') then 'FINISHING'
    else null end;

  return jsonb_build_object(
    'jobId', j.id, 'campaignId', j.campaign_id, 'propertyId', j.property_id,
    'state', v_state, 'stage', v_stage, 'jobStatus', j.status::text, 'failureReason', j.failure_reason,
    'active', v_state in ('PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'),
    'createdAt', j.created_at, 'startedAt', j.started_at, 'completedAt', j.completed_at,
    'pausedAt', j.paused_at, 'deadlineAt', j.discovery_deadline_at,
    'lastActivityAt', greatest(j.updated_at, c.last_activity_at),
    'transaction', coalesce(c.transaction, null), 'languages', coalesce(to_jsonb(c.languages), to_jsonb(j.search_languages)),
    'queue', jsonb_build_object('total', v_total, 'queued', v_pending, 'running', v_running, 'done', v_done,
                                'failed', v_failed, 'cancelled', v_cancelled, 'paused', v_paused),
    'runs', jsonb_build_object('inFlight', v_in_flight, 'succeeded', v_runs_ok, 'failed', v_runs_failed),
    'sources', v_nodes,
    'signalsAnalyzed', coalesce((c.stats ->> 'signalsAnalyzed')::int, 0) + coalesce(j.signals_classified, 0),
    'staleSkipped', coalesce((c.stats ->> 'staleSkipped')::int, 0),
    'duplicatesRemoved', coalesce((c.stats ->> 'duplicatesRemoved')::int, 0),
    'newResults', v_new, 'newLeads', v_leads, 'newMatches', v_matches, 'strong', v_strong,
    'executed', v_executed, 'stopReason', c.stop_reason, 'finalizedAt', c.finalized_at);
end;
$function$;
revoke all on function public.find_buyers_job_state(uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_job_state(uuid) to service_role;

------------------------------------------------------------------------------
-- 2. Can a search execute anything right now? (No provider names, no costs.)
------------------------------------------------------------------------------
create or replace function public.find_buyers_readiness()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with s as (
    select
      coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_buyers_social_enabled'), false) as social,
      coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'campaign_source_discovery_enabled'), false) as native,
      coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'telegram_discovery_enabled'), false) as telegram,
      coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'forum_discovery_enabled'), false) as forum,
      coalesce((select (value #>> '{}')::int from public.admin_settings where key = 'find_buyers_pricing_max_age_days'), 30) as max_age
  ), a as (
    select count(*) as eligible, coalesce(jsonb_agg(distinct g.source), '[]'::jsonb) as sources
      from public.find_buyers_actor_registry g, s
     where g.enabled and not g.emergency_disabled and g.health <> 'DISABLED'
       and g.pricing_verified_at is not null and g.pricing_verified_at >= now() - make_interval(days => s.max_age)
       and g.pricing_model <> 'UNKNOWN' and g.price_per_1k_micros is not null
  )
  select jsonb_build_object(
    'ready', (s.social and a.eligible > 0) or (s.native and (s.telegram or s.forum)),
    'social', s.social and a.eligible > 0,
    'native', s.native and (s.telegram or s.forum),
    'eligibleActors', case when s.social then a.eligible else 0 end,
    'sources', case when s.social and a.eligible > 0 then a.sources else '[]'::jsonb end
              || case when s.native and s.telegram then '["TELEGRAM"]'::jsonb else '[]'::jsonb end
              || case when s.native and s.forum then '["FORUM"]'::jsonb else '[]'::jsonb end,
    'reason', case
      when (s.social and a.eligible > 0) or (s.native and (s.telegram or s.forum)) then null
      when not s.social and not s.native then 'DISCOVERY_SWITCHED_OFF'
      when s.social and a.eligible = 0 then 'NO_ELIGIBLE_SOURCE'
      else 'DISCOVERY_UNAVAILABLE' end)
  from s, a;
$function$;
revoke all on function public.find_buyers_readiness() from public, anon;
grant execute on function public.find_buyers_readiness() to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. The owner's read: readiness + the property's latest campaign state.
------------------------------------------------------------------------------
create or replace function public.find_buyers_campaign_status(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_job uuid;
begin
  if not exists (select 1 from public.properties p where p.id = p_property_id
                  and (p.user_id = public.auth_user_id() or public.is_admin())) then
    raise exception 'FORBIDDEN';
  end if;
  select id into v_job from public.matching_jobs where property_id = p_property_id
   order by created_at desc limit 1;
  return jsonb_build_object(
    'readiness', public.find_buyers_readiness(),
    'campaign', case when v_job is null then null else public.find_buyers_job_state(v_job) end);
end;
$function$;
revoke all on function public.find_buyers_campaign_status(uuid) from public, anon;
grant execute on function public.find_buyers_campaign_status(uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- 4. Pause = PAUSING then PAUSED.
------------------------------------------------------------------------------
create or replace function public.claim_discovery_source_jobs_v2(
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 4,
  p_executor text default 'EDGE',
  p_providers text[] default null
)
returns setof public.discovery_query_queue
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed text[] := array['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23'];
  v_caps jsonb := coalesce((select value from public.admin_settings where key = 'discovery_provider_concurrency'), '{}'::jsonb);
  v_executor text := upper(coalesce(p_executor, 'EDGE'));
begin
  if p_providers is not null then
    v_allowed := array(select upper(x) from unnest(p_providers) x where upper(x) = any (v_allowed));
  end if;

  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'CAMPAIGN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.matching_jobs j
   where j.id = q.matching_job_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and j.status::text in ('completed','partially_completed','failed','cancelled','budget_reached');

  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'RUN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.discovery_runs r
   where r.id = q.discovery_run_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and r.status in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED');

  update public.discovery_query_queue q
     set status = case when q.attempts >= p_max_attempts then 'FAILED' else 'RETRY_WAIT' end,
         last_error = 'LEASE_EXPIRED: the worker holding this job stopped before finishing',
         next_attempt_at = now() + make_interval(secs => least(600, 30 * power(2, greatest(q.attempts - 1, 0)))),
         finished_at = case when q.attempts >= p_max_attempts then now() else q.finished_at end,
         lease_expires_at = null, claim_token = null
   where q.status = 'PROCESSING'
     and q.lease_expires_at is not null and q.lease_expires_at < now()
     and upper(coalesce(q.provider, '')) in ('TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23');

  return query
  with busy as (
    select upper(q.provider) as provider, count(*) as n
      from public.discovery_query_queue q
     where q.status = 'PROCESSING'
     group by 1
  ),
  runnable as (
    select q.id, q.priority, q.created_at, upper(q.provider) as provider,
           coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key
      from public.discovery_query_queue q
      left join public.matching_jobs j on j.id = q.matching_job_id
      left join public.discovery_runs r on r.id = q.discovery_run_id
     where q.status in ('PENDING', 'RETRY_WAIT')
       and coalesce(q.next_attempt_at, now()) <= now()
       and q.executor = v_executor
       and upper(coalesce(q.provider, '')) = any (v_allowed)
       and (j.id is null or j.status::text = 'searching_sources'
            /* PAUSING: a memo23 run that already started keeps being polled
               (and booked) while its campaign is paused; nothing new starts. */
            or (j.status::text = 'paused' and upper(coalesce(q.provider, '')) = 'APIFY_MEMO23'
                and nullif(q.metadata ->> 'actorRunId', '') is not null))
       and (r.id is null or r.status = 'SEARCHING')
       and coalesce(
             (select b.n from busy b where b.provider = upper(q.provider)), 0
           ) < coalesce((v_caps ->> upper(q.provider))::int, 1)
  ),
  last_claim as (
    select coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key, max(q.claimed_at) as at
      from public.discovery_query_queue q
     where q.claimed_at is not null and q.claimed_at > now() - interval '1 day'
     group by 1
  ),
  ranked as (
    select rn.id,
           row_number() over (partition by rn.run_key order by rn.priority desc, rn.created_at) as per_run,
           lc.at as run_last_claim, rn.priority, rn.created_at
      from runnable rn
      left join last_claim lc on lc.run_key = rn.run_key
  ),
  candidates as (
    select id from ranked
     where per_run = 1
     order by run_last_claim asc nulls first, priority desc, created_at asc
     limit greatest(1, least(p_limit, 25)) * 4
  ),
  picked as (
    select q.id
      from public.discovery_query_queue q
     where q.id in (select id from candidates)
       and q.status in ('PENDING', 'RETRY_WAIT')
     for update of q skip locked
     limit greatest(1, least(p_limit, 25))
  )
  update public.discovery_query_queue q
     set status = 'PROCESSING',
         claimed_at = now(),
         claim_token = gen_random_uuid(),
         started_at = coalesce(q.started_at, now()),
         attempts = coalesce(q.attempts, 0) + 1,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800)))
    from picked
   where q.id = picked.id
  returning q.*;
end;
$function$;

revoke all on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) to service_role;

create or replace function public.discovery_control(
  p_kind text,
  p_id uuid,
  p_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text := upper(coalesce(p_kind, ''));
  v_action text := lower(coalesce(p_action, ''));
  v_status text;
  v_deadline timestamptz;
  v_remaining integer;
  v_owner uuid;
  v_jobs integer := 0;
begin
  if v_action not in ('pause', 'resume', 'stop') then
    return jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  end if;

  if v_kind = 'MATCHING_JOB' then
    select status::text, discovery_deadline_at, paused_remaining_seconds, user_id
      into v_status, v_deadline, v_remaining, v_owner
      from public.matching_jobs where id = p_id for update;
  elsif v_kind = 'DISCOVERY_RUN' then
    select status, deadline_at, paused_remaining_seconds, user_id
      into v_status, v_deadline, v_remaining, v_owner
      from public.discovery_runs where id = p_id for update;
  else
    return jsonb_build_object('ok', false, 'error', 'BAD_KIND');
  end if;

  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if p_user_id is null or v_owner <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_status := lower(v_status);

  if v_action = 'pause' then
    if v_status not in ('searching_sources', 'searching') then
      return jsonb_build_object('ok', false, 'error', 'NOT_RUNNING', 'status', v_status);
    end if;
    v_remaining := greatest(0, extract(epoch from (coalesce(v_deadline, now()) - now()))::int);
    if v_kind = 'MATCHING_JOB' then
      update public.matching_jobs
         set status = 'paused', paused_at = now(), paused_remaining_seconds = v_remaining,
             current_step = 'Paused by you', updated_at = now()
       where id = p_id;
      /* Started memo23 runs are left to finish and be booked (PAUSING);
         every job that has not started is held. */
      update public.discovery_query_queue set status = 'PAUSED'
       where matching_job_id = p_id and status in ('PENDING', 'RETRY_WAIT')
         and not (upper(coalesce(provider, '')) = 'APIFY_MEMO23' and nullif(metadata ->> 'actorRunId', '') is not null);
    else
      update public.discovery_runs
         set status = 'PAUSED', stage = 'PAUSED', paused_at = now(), paused_remaining_seconds = v_remaining, updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PAUSED'
       where discovery_run_id = p_id and status in ('PENDING', 'RETRY_WAIT');
    end if;
    get diagnostics v_jobs = row_count;
    return jsonb_build_object('ok', true, 'status', 'paused', 'heldJobs', v_jobs, 'remainingSeconds', v_remaining);
  end if;

  if v_action = 'resume' then
    if v_status <> 'paused' then
      return jsonb_build_object('ok', false, 'error', 'NOT_PAUSED', 'status', v_status);
    end if;
    v_deadline := now() + make_interval(secs => greatest(60, coalesce(v_remaining, 0)));
    if v_kind = 'MATCHING_JOB' then
      update public.matching_jobs
         set status = 'searching_sources', discovery_deadline_at = v_deadline, paused_at = null,
             paused_remaining_seconds = null, current_step = 'Searching sources', updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PENDING', next_attempt_at = now()
       where matching_job_id = p_id and status = 'PAUSED';
    else
      update public.discovery_runs
         set status = 'SEARCHING', stage = 'SEARCHING_SOURCES', deadline_at = v_deadline, paused_at = null,
             paused_remaining_seconds = null, updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PENDING', next_attempt_at = now()
       where discovery_run_id = p_id and status = 'PAUSED';
    end if;
    get diagnostics v_jobs = row_count;
    return jsonb_build_object('ok', true, 'status', 'searching', 'resumedJobs', v_jobs, 'deadline', v_deadline);
  end if;

  /* stop */
  if v_status not in ('searching_sources', 'searching', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'NOT_RUNNING', 'status', v_status);
  end if;
  if v_kind = 'MATCHING_JOB' then
    update public.matching_jobs
       set status = 'searching_sources', discovery_deadline_at = now(), paused_at = null,
           paused_remaining_seconds = null, current_step = 'Stopping: finishing with what arrived', updated_at = now()
     where id = p_id;
    update public.discovery_query_queue
       set status = 'CANCELLED', cancel_reason = 'STOPPED_BY_CUSTOMER', finished_at = now()
     where matching_job_id = p_id and status in ('PENDING', 'RETRY_WAIT', 'PAUSED');
  else
    update public.discovery_runs
       set status = 'SEARCHING', deadline_at = now(), paused_at = null, paused_remaining_seconds = null, updated_at = now()
     where id = p_id;
    update public.discovery_query_queue
       set status = 'CANCELLED', cancel_reason = 'STOPPED_BY_CUSTOMER', finished_at = now()
     where discovery_run_id = p_id and status in ('PENDING', 'RETRY_WAIT', 'PAUSED');
  end if;
  get diagnostics v_jobs = row_count;
  return jsonb_build_object('ok', true, 'status', 'stopping', 'cancelledJobs', v_jobs);
end;
$function$;

revoke all on function public.discovery_control(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.discovery_control(text, uuid, uuid, text) to service_role;
revoke all on function public.discovery_control(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.discovery_control(text, uuid, uuid, text) to service_role;

------------------------------------------------------------------------------
-- 5. Notifications that follow the lifecycle.
------------------------------------------------------------------------------
create or replace function public.find_buyers_notice_text(p_lang text, p_key text, p_rent boolean, p_n integer default 0)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select case coalesce(nullif(lower(left(p_lang, 2)), ''), 'ka')
    when 'en' then case p_key
      when 'started' then array[case when p_rent then 'Tenant search started' else 'Buyer search started' end,
                                'We are looking for active public demand from the last 30 days. Results appear as they arrive.']
      when 'first' then array['First matches found', 'The search is still running. Open the property to see them.']
      when 'done_results' then array['Search finished: ' || p_n || case when p_n = 1 then ' new match found' else ' new matches found' end, 'Open the property to review them.']
      when 'done_zero' then array['Search finished: no new active demand found for now', 'Every source was searched; demand older than 30 days is not counted.']
      when 'failed' then array['The search could not finish', 'Open the property to see what happened; you can start again from there.']
      else array['The search could not start right now', 'Search sources are unavailable at the moment. Please try again later.'] end
    when 'ru' then case p_key
      when 'started' then array[case when p_rent then 'Поиск арендаторов начался' else 'Поиск покупателей начался' end,
                                'Ищем активный публичный спрос за последние 30 дней. Результаты появятся по мере поступления.']
      when 'first' then array['Первые совпадения уже найдены', 'Поиск продолжается. Откройте объект, чтобы посмотреть.']
      when 'done_results' then array['Поиск завершён: найдено новых совпадений — ' || p_n, 'Откройте объект, чтобы их просмотреть.']
      when 'done_zero' then array['Поиск завершён: нового активного спроса пока не найдено', 'Все источники проверены; спрос старше 30 дней не учитывается.']
      when 'failed' then array['Поиск не удалось завершить', 'Откройте объект, чтобы узнать подробности и начать заново.']
      else array['Поиск сейчас не удалось начать', 'Источники поиска временно недоступны. Попробуйте позже.'] end
    when 'tr' then case p_key
      when 'started' then array[case when p_rent then 'Kiracı araması başladı' else 'Alıcı araması başladı' end,
                                'Son 30 günün aktif, herkese açık talebini arıyoruz. Sonuçlar geldikçe görünür.']
      when 'first' then array['İlk eşleşmeler bulundu', 'Arama sürüyor. Görmek için mülkü açın.']
      when 'done_results' then array['Arama tamamlandı: ' || p_n || ' yeni eşleşme bulundu', 'İncelemek için mülkü açın.']
      when 'done_zero' then array['Arama tamamlandı: şimdilik yeni aktif talep bulunamadı', 'Tüm kaynaklar tarandı; 30 günden eski talepler sayılmaz.']
      when 'failed' then array['Arama tamamlanamadı', 'Ne olduğunu görmek ve yeniden başlatmak için mülkü açın.']
      else array['Arama şu anda başlatılamadı', 'Arama kaynakları şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.'] end
    when 'ar' then case p_key
      when 'started' then array[case when p_rent then 'بدأ البحث عن مستأجرين' else 'بدأ البحث عن مشترين' end,
                                'نبحث عن طلب عام نشط من آخر 30 يومًا. تظهر النتائج فور وصولها.']
      when 'first' then array['وجدنا أولى التطابقات', 'البحث مستمر. افتح العقار لرؤيتها.']
      when 'done_results' then array['انتهى البحث: تم العثور على ' || p_n || ' تطابقات جديدة', 'افتح العقار لمراجعتها.']
      when 'done_zero' then array['انتهى البحث: لم يُعثر على طلب نشط جديد حاليًا', 'تم البحث في جميع المصادر؛ لا يُحتسب الطلب الأقدم من 30 يومًا.']
      when 'failed' then array['تعذّر إكمال البحث', 'افتح العقار لمعرفة ما حدث والبدء من جديد.']
      else array['تعذّر بدء البحث الآن', 'مصادر البحث غير متاحة حاليًا. يرجى المحاولة لاحقًا.'] end
    when 'he' then case p_key
      when 'started' then array[case when p_rent then 'החיפוש אחר שוכרים התחיל' else 'החיפוש אחר קונים התחיל' end,
                                'אנחנו מחפשים ביקוש ציבורי פעיל מ־30 הימים האחרונים. התוצאות יופיעו כשיגיעו.']
      when 'first' then array['נמצאו התאמות ראשונות', 'החיפוש עדיין פועל. פתחו את הנכס כדי לראות אותן.']
      when 'done_results' then array['החיפוש הסתיים: נמצאו ' || p_n || ' התאמות חדשות', 'פתחו את הנכס כדי לעיין בהן.']
      when 'done_zero' then array['החיפוש הסתיים: לא נמצא כרגע ביקוש פעיל חדש', 'כל המקורות נסרקו; ביקוש ישן מ־30 יום אינו נספר.']
      when 'failed' then array['לא ניתן היה להשלים את החיפוש', 'פתחו את הנכס כדי לראות מה קרה ולהתחיל מחדש.']
      else array['לא ניתן היה להתחיל את החיפוש כעת', 'מקורות החיפוש אינם זמינים כרגע. נסו שוב מאוחר יותר.'] end
    else case p_key
      when 'started' then array[case when p_rent then 'მოიჯარეების ძებნა დაიწყო' else 'მყიდველების ძებნა დაიწყო' end,
                                'ვეძებთ ბოლო 30 დღის აქტიურ საჯარო მოთხოვნას. შედეგები გამოჩნდება, როგორც კი მოვა.']
      when 'first' then array['პირველი შესაბამისობები უკვე ვიპოვეთ', 'ძებნა გრძელდება — გახსენით ქონება მათ სანახავად.']
      when 'done_results' then array['ძებნა დასრულდა — ნაპოვნია ' || p_n || ' ახალი შესაბამისობა', 'გახსენით ქონება მათ სანახავად.']
      when 'done_zero' then array['ძებნა დასრულდა — ამ ეტაპზე ახალი აქტიური მოთხოვნა ვერ მოიძებნა', 'ყველა წყარო დამუშავდა; 30 დღეზე ძველი მოთხოვნა არ ითვლება.']
      when 'failed' then array['ძებნა ვერ დასრულდა', 'გახსენით ქონება, რომ ნახოთ რა მოხდა — იქიდან ძებნის თავიდან დაწყებაც შეგიძლიათ.']
      else array['ძებნა ამ ეტაპზე ვერ დაიწყო', 'საძიებო წყაროები ამჟამად მიუწვდომელია. სცადეთ მოგვიანებით.'] end
  end;
$function$;
revoke all on function public.find_buyers_notice_text(text, text, boolean, integer) from public, anon, authenticated;

create or replace function public.matching_jobs_notify_finished()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lang text;
  v_rent boolean;
  v_state jsonb;
  v_new int;
  v_key text;
  v_txt text[];
  v_link text := '/property/' || new.property_id::text || '/matches';
begin
  if new.status::text = old.status::text or new.user_id is null then return new; end if;
  begin
    select preferred_language into v_lang from public.users where id = new.user_id;
    select upper(coalesce(transaction_type::text, 'SALE')) = 'RENT' into v_rent from public.properties where id = new.property_id;

    /* STARTED: the first move into searching (a resume is not a new start). */
    if new.status::text = 'searching_sources' and old.status::text <> 'paused' then
      v_txt := public.find_buyers_notice_text(v_lang, 'started', coalesce(v_rent, false));
      perform public.notify_emit(new.user_id, 'MATCHING_STARTED'::public.notification_type, v_txt[1], v_txt[2],
        'NORMAL', v_link, 'matching_jobs', new.id, 'matching-job-started:' || new.id::text);
      return new;
    end if;

    if new.status::text not in ('completed', 'partially_completed', 'budget_reached', 'failed') then return new; end if;
    v_state := public.find_buyers_job_state(new.id);
    v_new := greatest(coalesce((v_state ->> 'newResults')::int, 0), coalesce(new.fresh_matches_created, 0));
    v_key := case v_state ->> 'state'
      when 'COMPLETED_WITH_RESULTS' then 'done_results'
      when 'COMPLETED_NO_RESULTS' then 'done_zero'
      when 'DEGRADED_COMPLETED' then 'done_zero'
      when 'UNAVAILABLE' then 'unavailable'
      else case when new.status::text = 'failed' then 'failed' when v_new > 0 then 'done_results' else 'unavailable' end end;
    v_txt := public.find_buyers_notice_text(v_lang, v_key, coalesce(v_rent, false), v_new);
    perform public.notify_emit(new.user_id,
      (case when v_key in ('done_results', 'done_zero') then 'CAMPAIGN_COMPLETED' else 'CAMPAIGN_NEEDS_REVIEW' end)::public.notification_type,
      v_txt[1], v_txt[2], 'NORMAL', v_link, 'matching_jobs', new.id, 'matching-job-finished:' || new.id::text);
  exception when others then
    /* A notification must never fail the job's own state change. */
    raise warning 'matching_jobs_notify_finished: %', sqlerrm;
  end;
  return new;
end $function$;
revoke all on function public.matching_jobs_notify_finished() from public, anon, authenticated;

/* FIRST RESULTS: the first qualified lead of a campaign that is still running. */
create or replace function public.find_buyers_notify_first_result()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.matching_jobs%rowtype;
  v_lang text;
  v_txt text[];
begin
  begin
    select * into v_job from public.matching_jobs where id = new.matching_job_id;
    if not found or v_job.status::text not in ('searching_sources', 'paused', 'classifying', 'ranking') then return new; end if;
    select preferred_language into v_lang from public.users where id = v_job.user_id;
    v_txt := public.find_buyers_notice_text(v_lang, 'first', false);
    perform public.notify_emit(v_job.user_id, 'MATCH_FOUND'::public.notification_type, v_txt[1], v_txt[2],
      'NORMAL', '/property/' || v_job.property_id::text || '/matches', 'matching_jobs', v_job.id,
      'find-buyers-first-result:' || v_job.id::text);
  exception when others then
    raise warning 'find_buyers_notify_first_result: %', sqlerrm;
  end;
  return new;
end $function$;
revoke all on function public.find_buyers_notify_first_result() from public, anon, authenticated;
drop trigger if exists trg_find_buyers_first_result on public.find_buyers_leads;
create trigger trg_find_buyers_first_result after insert on public.find_buyers_leads
  for each row execute function public.find_buyers_notify_first_result();

------------------------------------------------------------------------------
-- 6. Admin center: every campaign carries its lifecycle block.
------------------------------------------------------------------------------
create or replace function public.admin_find_buyers_center(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_since timestamptz := case when coalesce(p_days, 0) <= 0 then '-infinity'::timestamptz
                              else now() - make_interval(days => p_days) end;
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  with camp as (
    select c.*,
      coalesce((select sum(coalesce(l.actual_micros, l.estimated_micros)) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'PROVIDER' and l.idempotency_key like 'book:%'), 0) as provider_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'AI'), 0) as ai_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'TRANSLATION'), 0) as translation_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'OTHER'), 0) as other_micros,
      coalesce((select sum(r.reserved_micros) from public.find_buyers_actor_runs r
                 where r.matching_job_id = c.matching_job_id and r.status in ('RESERVED','STARTING','RUNNING')), 0) as reserved_micros,
      (select count(*) from public.find_buyers_leads fl where fl.matching_job_id = c.matching_job_id) as leads,
      (select count(*) from public.find_buyers_leads fl where fl.matching_job_id = c.matching_job_id and fl.strength = 'STRONG') as strong,
      (select u.settled_credits from public.usage_reservations u
        where u.id = nullif(j.billing_grant->>'reservationId','')::uuid) as credits_charged,
      j.status::text as job_status
      from public.find_buyers_campaigns c
      join public.matching_jobs j on j.id = c.matching_job_id
     where c.created_at >= v_since
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', p_days,
    'switches', coalesce((select jsonb_object_agg(key, value) from public.admin_settings
                           where key like 'find_buyers_%' and key not like '%token%'), '{}'::jsonb),
    'overview', (select jsonb_build_object(
        'campaigns', count(*),
        'credits_committed', coalesce(sum(credits_committed), 0),
        'customer_value_micros', coalesce(sum(customer_value_micros), 0),
        /* Revenue = what settlement actually charged, never the authorised budget. */
        'revenue_micros', coalesce(sum(floor(coalesce(credits_charged, 0) * 1000000 / credits_per_usd)), 0)::bigint,
        'provider_micros', coalesce(sum(provider_micros), 0),
        'ai_micros', coalesce(sum(ai_micros), 0),
        'translation_micros', coalesce((select sum(actual_micros) from public.find_buyers_cost_ledger
                                         where kind = 'TRANSLATION' and occurred_at >= v_since), 0),
        'other_micros', coalesce(sum(other_micros), 0),
        'qualified_leads', coalesce(sum(leads), 0),
        'strong_leads', coalesce(sum(strong), 0)) from camp),
    'campaigns', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select matching_job_id, campaign_id, property_id, user_id, transaction, credits_committed, credits_per_usd,
               credits_charged, floor(coalesce(credits_charged, 0) * 1000000 / credits_per_usd)::bigint as revenue_micros,
               customer_value_micros, provider_budget_micros, reserved_micros, provider_micros, ai_micros,
               translation_micros, other_micros,
               provider_micros + ai_micros + translation_micros + other_micros as total_cogs_micros,
               languages, stats, leads, strong, job_status, stop_reason, created_at, last_activity_at, finalized_at,
               public.find_buyers_job_state(matching_job_id) as lifecycle
          from camp order by created_at desc limit 100) x), '[]'::jsonb),
    'actors', coalesce((select jsonb_agg(a order by a.source, a.priority desc) from (
        select g.actor_key, g.actor_id, g.source, g.purpose, g.role, g.enabled, g.emergency_disabled,
               case when not g.enabled or g.emergency_disabled then 'DISABLED' else g.health end as health,
               g.pricing_model, g.price_per_1k_micros, g.start_fee_micros, g.currency, g.pricing_source,
               g.pricing_verified_at, g.input_contract_verified_at, g.priority, g.max_results, g.probe_size,
               g.deepen_steps, g.timeout_seconds, g.retry_cap, g.concurrency, g.daily_spend_cap_micros,
               g.campaign_spend_cap_micros, g.fallback_actor_key, g.last_error, g.last_run_at,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as runs,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since and r.status = 'SUCCEEDED') as succeeded,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since and r.status in ('FAILED','ABORTED','TIMED_OUT')) as failed,
               (select coalesce(sum(r.results_billed), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as results_billed,
               (select coalesce(sum(r.useful_results), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as useful_results,
               (select coalesce(sum(r.qualified_leads), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as qualified_leads,
               (select coalesce(sum(r.strong_leads), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as strong_leads,
               (select coalesce(sum(coalesce(r.actual_micros, case when r.status in ('RESERVED','STARTING','RUNNING','RELEASED') then 0 else r.reserved_micros end)), 0)
                  from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as spend_micros,
               (select percentile_disc(0.5) within group (order by r.latency_ms) from public.find_buyers_actor_runs r
                 where r.actor_key = g.actor_key and r.created_at >= v_since and r.latency_ms is not null) as latency_p50_ms
          from public.find_buyers_actor_registry g) a), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(s) from (
        select sr.id, sr.platform::text as platform, sr.name, sr.url, sr.city, sr.languages, sr.member_count,
               sr.discovered_via, sr.created_at as first_discovered, sr.last_checked_at, sr.posts_observed,
               sr.fb_spend_micros, sr.fb_qualified_leads, sr.fb_strong_leads, sr.quality_score, sr.access_state, sr.lifecycle,
               case when sr.fb_qualified_leads > 0 then sr.fb_spend_micros / sr.fb_qualified_leads end as cost_per_qualified_micros
          from public.source_registry sr
         where sr.discovered_via like 'memo23:%' or sr.fb_spend_micros > 0 or sr.fb_qualified_leads > 0
         order by sr.fb_qualified_leads desc, sr.last_checked_at desc nulls last limit 200) s), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(lg) from (
        select lang,
               coalesce((select sum(coalesce(r.actual_micros, case when r.status in ('RESERVED','STARTING','RUNNING','RELEASED') then 0 else r.reserved_micros end))
                           from public.find_buyers_actor_runs r
                          where r.language = lang and r.created_at >= v_since), 0) as spend_micros,
               (select count(*) from public.find_buyers_assessments fa where fa.language = lang and fa.created_at >= v_since) as signals,
               (select count(*) from public.find_buyers_leads fl where fl.language = lang and fl.created_at >= v_since) as qualified,
               (select count(*) from public.find_buyers_leads fl where fl.language = lang and fl.created_at >= v_since and fl.strength = 'STRONG') as strong
          from unnest(array['ka','ru','en','ar','he','tr']) as lang) lg), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(l order by l.occurred_at desc) from (
        select l.id, l.occurred_at, l.matching_job_id, l.kind, l.provider, l.actor_key, l.actor_run_id, l.provider_run_id,
               l.operation, l.model, l.requested_limit, l.billed_units, l.estimated_micros, l.actual_micros, l.cost_state,
               l.cost_basis, l.status, l.error, l.retry_of, l.after_settlement, r.source
          from public.find_buyers_cost_ledger l
          left join public.find_buyers_actor_runs r on r.id = l.actor_run_id
         where l.occurred_at >= v_since
         order by l.occurred_at desc limit 300) l), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;
revoke all on function public.admin_find_buyers_center(integer) from public, anon;
grant execute on function public.admin_find_buyers_center(integer) to authenticated;
