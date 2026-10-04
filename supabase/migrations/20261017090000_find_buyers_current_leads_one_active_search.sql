-- FIND BUYERS / FIND TENANTS — two invariants the server now enforces itself.
--
-- 1. THE 30-DAY RULE AT READ TIME. Ingest already drops anything older than
--    30 days (src/research-core/findBuyers/freshness.ts). A lead accepted at
--    25 days old must also leave current results when it turns 31, so every
--    customer-facing read and count goes through ONE predicate on the lead's
--    publication/evidence time (signal_at; never the time it was observed).
--    Unknown publication time is never current. Rows are kept for audit.
-- 2. ONE ACTIVE SEARCH PER PROPERTY. A unique index over lifecycle-active
--    jobs: two simultaneous starts cannot both hold a running search, and
--    match-campaign claims this row BEFORE it reserves any credits, so the
--    loser of a race reserves nothing. Finished searches never block a new one.


------------------------------------------------------------------------------
-- 1. The 30-day rule at read time.
------------------------------------------------------------------------------
create or replace function public.find_buyers_signal_is_current(p_signal_at timestamptz)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select p_signal_at is not null
     and p_signal_at >= now() - interval '30 days'
     and p_signal_at <= now() + interval '24 hours';
$function$;
grant execute on function public.find_buyers_signal_is_current(timestamptz) to authenticated, service_role;

/* What the owner sees as current potential buyers/tenants. Security invoker:
   find_buyers_leads' own row-level security (the owner's rows) still applies. */
create or replace view public.find_buyers_current_leads with (security_invoker = true) as
  select l.* from public.find_buyers_leads l
   where public.find_buyers_signal_is_current(l.signal_at);
revoke all on public.find_buyers_current_leads from public, anon;
grant select on public.find_buyers_current_leads to authenticated, service_role;

/* The campaign's result count (owner status, completion, notifications)
   counts current leads only, so the card and the list always agree. */
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
    'newResults', v_new, 'newLeads', v_leads, 'newMatches', v_matches, 'strong', v_strong,
    'executed', v_executed, 'stopReason', c.stop_reason, 'finalizedAt', c.finalized_at);
end;
$function$;
revoke all on function public.find_buyers_job_state(uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_job_state(uuid) to service_role;

------------------------------------------------------------------------------
-- 2. One lifecycle-active search per property.
------------------------------------------------------------------------------
create unique index if not exists uidx_matching_jobs_one_active_per_property
  on public.matching_jobs (property_id)
  where status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached');
