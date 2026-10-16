-- FIND BUYERS / FIND TENANTS — evidence-backed lead qualification.
--
-- The first production campaign (VILLION, 2026-10-09) showed 37 "qualified"
-- leads of which 4 were real purchase requests: job seekers, rental seekers
-- and sale advertisements were scored as buyers. Qualification is now an
-- explicit, recorded decision per assessed signal and per lead:
--   role             BUY_SEEKER | RENT_SEEKER | SALE_OFFER | RENT_OFFER |
--                    AGENT | SERVICE | JOB | IRRELEVANT | UNCLEAR
--   match_category   STRONG | POTENTIAL | WEAK | REJECTED
--   rejection_reasons  explicit codes (WRONG_TRANSACTION, JOB_SEARCH, …)
--   budget_fit / location_fit / requirements_fit
--                    COMPATIBLE | NEARBY | INCOMPATIBLE | UNKNOWN …
-- UNKNOWN is never COMPATIBLE. Rejected leads are KEPT (evidence and
-- financial history are never deleted) and leave the customer-facing view.
-- Additive: columns, one view redefinition, campaign strategy/metrics.

alter table public.find_buyers_assessments
  add column if not exists role text,
  add column if not exists transaction text,
  add column if not exists match_category text,
  add column if not exists rejection_reasons text[] not null default '{}',
  add column if not exists budget_fit text,
  add column if not exists location_fit text,
  add column if not exists requirements_fit text,
  add column if not exists qualification jsonb,
  add column if not exists qualification_version integer;

alter table public.find_buyers_leads
  add column if not exists role text,
  add column if not exists transaction text,
  add column if not exists match_category text,
  add column if not exists rejection_reasons text[] not null default '{}',
  add column if not exists budget_fit text,
  add column if not exists location_fit text,
  add column if not exists requirements_fit text,
  add column if not exists qualification jsonb,
  add column if not exists qualification_version integer,
  add column if not exists requalified_at timestamptz;

do $$ begin
  alter table public.find_buyers_leads add constraint find_buyers_leads_match_category_chk
    check (match_category is null or match_category in ('STRONG', 'POTENTIAL', 'WEAK', 'REJECTED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.find_buyers_assessments add constraint find_buyers_assessments_match_category_chk
    check (match_category is null or match_category in ('STRONG', 'POTENTIAL', 'WEAK', 'REJECTED'));
exception when duplicate_object then null; end $$;

create index if not exists find_buyers_leads_job_category_idx
  on public.find_buyers_leads (matching_job_id, match_category);
create index if not exists find_buyers_assessments_job_category_idx
  on public.find_buyers_assessments (matching_job_id, match_category);

/* The property-specific search strategy (personas, budget band, places,
   languages, query hypotheses) and the campaign's measured timings. */
alter table public.find_buyers_campaigns
  add column if not exists strategy jsonb,
  add column if not exists metrics jsonb not null default '{}'::jsonb;

/* What the owner sees: current AND not rejected. A legacy row without a
   category (written before qualification) stays visible until it is
   re-qualified; re-qualification sets a category on every row. */
create or replace view public.find_buyers_current_leads with (security_invoker = true) as
  select l.* from public.find_buyers_leads l
   where public.find_buyers_signal_is_current(l.signal_at)
     and coalesce(l.match_category, 'POTENTIAL') <> 'REJECTED';
revoke all on public.find_buyers_current_leads from public, anon;
grant select on public.find_buyers_current_leads to authenticated, service_role;

/* Why a discovered community is (not) read for a campaign: relevance score
   and reasons from its public name/description (job boards, rental-only
   groups for a SALE search …). Registration still happens either way. */
alter table public.source_registry add column if not exists relevance jsonb;

/* LinkedIn group search needs a logged-in session (input.cookies) that
   HOMATCH does not hold: the VILLION run was refused with HTTP 400. Off and
   marked until that requirement is genuinely supported — never with
   someone's personal cookies. Its history stays. */
update public.find_buyers_actor_registry
   set enabled = false,
       emergency_disabled = true,
       health = 'DISABLED',
       last_error = 'QUARANTINED: requires an authenticated LinkedIn session (input.cookies); not supported',
       updated_at = now()
 where actor_key = 'LINKEDIN_GROUPS';

/* Comments are now fetched only under listings comparable to the property
   (same transaction), so the similarity gate moves from 70/85 to 55/75. An
   operator-customised value is left untouched. */
update public.admin_settings
   set value = '{"skipBelow": 55, "eligibleFrom": 75}'::jsonb
 where key = 'find_buyers_comment_gate'
   and value = '{"skipBelow": 70, "eligibleFrom": 85}'::jsonb;

-- find_buyers_job_state (definition of 20261021090000; grants unchanged):
-- rejected leads are never counted as results; Strong / Potential / Weak and
-- the measured timings (metrics) are reported.
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
  v_leads int; v_strong int; v_matches int; v_potential int; v_weak int;
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
                       and public.find_buyers_signal_is_current(l.signal_at)
                       and coalesce(l.match_category, 'POTENTIAL') <> 'REJECTED')
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
  /* Rejected leads (re-qualified or judged at ingest) are never results. */
  select count(*), count(*) filter (where coalesce(match_category, case when strength = 'STRONG' then 'STRONG' end) = 'STRONG'),
         count(*) filter (where match_category = 'POTENTIAL'), count(*) filter (where match_category = 'WEAK')
    into v_leads, v_strong, v_potential, v_weak
    from public.find_buyers_leads where matching_job_id = p_job_id
     and public.find_buyers_signal_is_current(signal_at)
     and coalesce(match_category, 'POTENTIAL') <> 'REJECTED';
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
    'potential', v_potential, 'weak', v_weak, 'metrics', coalesce(c.metrics, '{}'::jsonb),
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
