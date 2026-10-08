-- FIND BUYERS / FIND TENANTS — the campaign records how its last search ended.
--
-- matching_campaigns.status / status_v2 mean "continuous monitoring is on":
-- continuous-matching-worker selects status_v2 = 'ACTIVE' to keep re-matching
-- the property against HOMATCH's own demand, and the live trigger
-- sync_matching_campaign_status_columns keeps status = status_v2. Neither
-- column ever said how a SEARCH ended, so after the owner's searches of
-- 2026-10-04 (jobs 7517daa6, 123bd287) the campaign still read ACTIVE/ACTIVE
-- although both searches had finished with no current demand.
--
-- The search outcome is now recorded at its source — every status change of
-- the campaign's matching_job — from the same authoritative mapping the owner
-- screen uses (find_buyers_job_state):
--   SEARCHING · COMPLETED_WITH_RESULTS · COMPLETED_NO_CURRENT_DEMAND ·
--   DEGRADED · UNAVAILABLE · FAILED · CANCELLED · PAUSED
-- Monitoring (status/status_v2) is unchanged: switching it off when a search
-- ends would silently stop continuous matching, which is an owner decision.
-- Additive: four nullable columns, one trigger function, one trigger, and a
-- backfill of each campaign's latest search through the same function.
-- find_buyers_job_state (definition of 20261018090000, grants unchanged)
-- also reports socialPlan: whether the memo23 planner queued, skipped or
-- failed for that search — the 2026-10-04 failure was invisible on screen.

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

  /* Source nodes: only networks this campaign actually queued. `checked` is
     content read (messages, posts, comments); `communities` is new sources a
     discovery job registered (Telegram community search) -- NOT demand, never
     counted as people; `qualified` is this run's current matches/leads from
     that network. `results` keeps the checked count for older readers. */
  select coalesce(jsonb_agg(n order by n ->> 'source'), '[]'::jsonb) into v_nodes from (
    select jsonb_build_object(
      'source', q.src,
      'total', count(*),
      'running', count(*) filter (where status = 'PROCESSING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is not null)),
      'queued', count(*) filter (where status in ('PENDING', 'PAUSED') or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is null)),
      'done', count(*) filter (where status = 'DONE'),
      'failed', count(*) filter (where status in ('FAILED', 'BUDGET_REACHED')),
      'results', coalesce(sum(result_count) filter (where status = 'DONE' and upper(coalesce(provider, '')) <> 'TELEGRAM_SOURCES'), 0),
      'checked', coalesce(sum(result_count) filter (where status = 'DONE' and upper(coalesce(provider, '')) <> 'TELEGRAM_SOURCES'), 0),
      'communities', coalesce(sum(result_count) filter (where status = 'DONE' and upper(coalesce(provider, '')) = 'TELEGRAM_SOURCES'), 0),
      'qualified', (select count(*) from public.find_buyers_leads l
                     where l.matching_job_id = p_job_id and upper(l.source) = q.src
                       and public.find_buyers_signal_is_current(l.signal_at))
                 + (select count(*) from public.matches m
                     where m.job_id = p_job_id and upper(coalesce(m.preview_platform::text, '')) = q.src and m.status::text <> 'REJECTED'
                       and (m.status::text = 'UNLOCKED' or (m.demand_published_at >= now() - interval '30 days'
                                                            and m.demand_published_at <= now() + interval '24 hours'))),
      'state', case
        when count(*) filter (where status = 'PROCESSING' or (status = 'RETRY_WAIT' and nullif(metadata ->> 'actorRunId', '') is not null)) > 0 then 'RUNNING'
        when count(*) filter (where status in ('PENDING', 'RETRY_WAIT', 'PAUSED')) > 0 then 'QUEUED'
        when count(*) filter (where status = 'DONE') > 0 then 'DONE'
        when count(*) filter (where status in ('FAILED', 'BUDGET_REACHED')) > 0 then 'FAILED'
        else 'CANCELLED' end) as n
      from (select dq.*, upper(coalesce(dq.platform, dq.provider, 'WEB')) as src
              from public.discovery_query_queue dq where dq.matching_job_id = p_job_id) q
     group by q.src) s;

  select count(*) filter (where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null),
         count(*) filter (where cost_booked_at is not null and status <> 'RELEASED'),
         count(*) filter (where status = 'SUCCEEDED'),
         count(*) filter (where status in ('FAILED', 'TIMED_OUT', 'ABORTED'))
    into v_in_flight, v_runs_booked, v_runs_ok, v_runs_failed
    from public.find_buyers_actor_runs where matching_job_id = p_job_id;

  /* Current leads only (the 30-day rule at read time, same window as ingest). */
  select count(*), count(*) filter (where strength = 'STRONG') into v_leads, v_strong
    from public.find_buyers_leads where matching_job_id = p_job_id
     and public.find_buyers_signal_is_current(signal_at);
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
    'signalsChecked', coalesce((select sum((x ->> 'checked')::int) from jsonb_array_elements(v_nodes) x), 0),
    'communitiesFound', coalesce((select sum((x ->> 'communities')::int) from jsonb_array_elements(v_nodes) x), 0),
    'newResults', v_new, 'newLeads', v_leads, 'newMatches', v_matches, 'strong', v_strong,
    'executed', v_executed, 'stopReason', c.stop_reason, 'finalizedAt', c.finalized_at,
    /* What the social (memo23) planner did for THIS search, from the event
       match-campaign writes: QUEUED / SKIPPED (with its reason) / FAILED. A
       search where it failed or was skipped never reads as a full multi-source run. */
    'socialPlan', (select jsonb_build_object(
        'outcome', case e.event_type when 'SOCIAL_DISCOVERY_QUEUED' then 'QUEUED'
                                     when 'SOCIAL_DISCOVERY_SKIPPED' then 'SKIPPED' else 'FAILED' end,
        'reason', coalesce(e.payload ->> 'reason', case when e.event_type = 'SOCIAL_DISCOVERY_FAILED' then 'PLANNER_ERROR' end),
        'queued', coalesce((e.payload ->> 'queued')::int, 0))
      from public.matching_job_events e
     where e.job_id = p_job_id and e.event_type in ('SOCIAL_DISCOVERY_QUEUED', 'SOCIAL_DISCOVERY_SKIPPED', 'SOCIAL_DISCOVERY_FAILED')
     order by e.created_at desc limit 1));
end;
$function$;
revoke all on function public.find_buyers_job_state(uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_job_state(uuid) to service_role;

alter table public.matching_campaigns
  add column if not exists last_search_job_id uuid,
  add column if not exists last_search_state text,
  add column if not exists last_search_started_at timestamptz,
  add column if not exists last_search_finished_at timestamptz;

comment on column public.matching_campaigns.status_v2 is
  'Continuous monitoring (continuous-matching-worker re-matches ACTIVE campaigns). Not the state of a search; see last_search_state.';
comment on column public.matching_campaigns.last_search_state is
  'How the latest search of this campaign stands: SEARCHING, COMPLETED_WITH_RESULTS, COMPLETED_NO_CURRENT_DEMAND, DEGRADED, UNAVAILABLE, FAILED, CANCELLED, PAUSED.';

/* The owner-facing search state of one job, from find_buyers_job_state. */
create or replace function public.matching_job_search_state(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case s ->> 'state'
    when 'PREPARING' then 'SEARCHING'
    when 'QUEUED' then 'SEARCHING'
    when 'SEARCHING' then 'SEARCHING'
    when 'PARTIAL_RESULTS' then 'SEARCHING'
    when 'PAUSING' then 'PAUSED'
    when 'PAUSED' then 'PAUSED'
    when 'COMPLETED_WITH_RESULTS' then 'COMPLETED_WITH_RESULTS'
    when 'COMPLETED_NO_RESULTS' then 'COMPLETED_NO_CURRENT_DEMAND'
    when 'DEGRADED_COMPLETED' then 'DEGRADED'
    when 'UNAVAILABLE' then 'UNAVAILABLE'
    when 'CANCELLED' then 'CANCELLED'
    when 'FAILED' then 'FAILED'
    else null end
  from (select public.find_buyers_job_state(p_job_id) as s) x;
$function$;
revoke all on function public.matching_job_search_state(uuid) from public, anon, authenticated;
grant execute on function public.matching_job_search_state(uuid) to service_role;

create or replace function public.matching_campaign_record_search()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_state text;
  v_started timestamptz;
  v_lock_timeout text;
begin
  if new.campaign_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status::text is not distinct from old.status::text then return new; end if;
  /* started_at is writable by the job owner: never trust a future value for ordering. */
  v_started := least(coalesce(new.started_at, new.created_at, now()), now());
  v_lock_timeout := current_setting('lock_timeout');
  begin
    v_state := public.matching_job_search_state(new.id);
    if v_state is not null then
      /* A busy campaign row must not stall the job write: wait briefly, then give up (caught below). */
      perform set_config('lock_timeout', '2s', true);
      /* Only the owner's own campaign for the same property, and only its latest search
         (an older job finishing late never overwrites a newer one). This function runs as
         definer, so the ownership check here is what keeps one user from writing another's row. */
      update public.matching_campaigns c set
        last_search_job_id = new.id,
        last_search_state = v_state,
        last_search_started_at = v_started,
        last_search_finished_at = case when v_state in ('SEARCHING', 'PAUSED') then null
                                       else least(coalesce(new.completed_at, now()), now()) end
       where c.id = new.campaign_id
         and c.user_id = new.user_id
         and c.property_id = new.property_id
         and (c.last_search_started_at is null or c.last_search_job_id = new.id
              or v_started >= c.last_search_started_at);
      perform set_config('lock_timeout', v_lock_timeout, true);
    end if;
  exception when others then
    /* Recording the outcome never blocks the job itself. */
    perform set_config('lock_timeout', v_lock_timeout, true);
    raise warning 'matching_campaign_record_search(%): %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.matching_campaign_record_search() from public, anon, authenticated;

drop trigger if exists trg_matching_campaign_record_search on public.matching_jobs;
create trigger trg_matching_campaign_record_search
  after insert or update of status on public.matching_jobs
  for each row execute function public.matching_campaign_record_search();

/* Backfill: each campaign's latest search by its owner, through the same mapping (state computed once per campaign). */
update public.matching_campaigns c set
  last_search_job_id = j.id,
  last_search_state = j.state,
  last_search_started_at = least(j.started, now()),
  last_search_finished_at = case when j.state in ('SEARCHING', 'PAUSED') then null
                                 else coalesce(j.completed_at, j.updated_at) end
  from (select x.*, public.matching_job_search_state(x.id) as state
          from (select distinct on (mj.campaign_id) mj.id, mj.campaign_id, mj.user_id, mj.property_id,
                       coalesce(mj.started_at, mj.created_at) as started, mj.completed_at, mj.updated_at
                  from public.matching_jobs mj where mj.campaign_id is not null
                 order by mj.campaign_id, coalesce(mj.started_at, mj.created_at) desc, mj.id desc) x) j
 where j.campaign_id = c.id and c.user_id = j.user_id and c.property_id = j.property_id
   and c.last_search_job_id is null and j.state is not null;
