-- FIND BUYERS / FIND TENANTS — source truth for the owner's screen.
--
-- The first owner-run search (job 7517daa6, 2026-10-04) showed "Telegram 33"
-- beside "0 qualified": 2 Telegram messages read plus 31 newly registered
-- Telegram COMMUNITIES (sources found by the community search), summed into
-- one "results" number that read like 33 buyers. Each source node now carries
-- checked (content read), communities (sources registered) and qualified
-- (this run's current matches from that network) separately, and the
-- readiness read returns the whole discovery network (every registered source
-- family, AVAILABLE or DISABLED) so the screen can show what was searched,
-- what could be, and what is switched off -- without a hardcoded list.
-- Apify restored (owner, 2026-10-04) for memo23 only: readiness treats
-- APIFY in provider_disabled_list (Admin → Providers) as social switched off.
-- Actor verification truth: the registry also records when a real run proved
-- the output contract (output_contract_verified_at) and when anything was
-- last verified (last_verified_at). Metadata verification never marks an
-- Actor healthy; only a real run does. The admin center returns both columns.
-- Additive: two columns added (nullable, no backfill), three functions
-- replaced, no data or switch changes.
-- (Plus find_buyers_reserve_actor_run: refuses APIFY_DISABLED_BY_ADMIN.)


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
    'executed', v_executed, 'stopReason', c.stop_reason, 'finalizedAt', c.finalized_at);
end;
$function$;
revoke all on function public.find_buyers_job_state(uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_job_state(uuid) to service_role;

create or replace function public.find_buyers_readiness()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with s as (
    select
      /* Social = the switch AND the Apify provider enabled on Admin → Providers
         (APIFY absent from provider_disabled_list): server-authoritative. */
      coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_buyers_social_enabled'), false)
        and not coalesce((select case jsonb_typeof(value) when 'array' then value ? 'APIFY' when 'string' then upper(value #>> '{}') like '%"APIFY"%' else false end
                            from public.admin_settings where key = 'provider_disabled_list'), false) as social,
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
  ), fam as (
    /* THE DISCOVERY NETWORK: every registered source family and whether a search
       could use it now. Built from the registry and the switches, never a fixed
       list, so a newly registered source appears by itself. */
    select g.source as family,
           bool_or(s.social and g.enabled and not g.emergency_disabled and g.health <> 'DISABLED'
                   and g.pricing_verified_at is not null and g.pricing_verified_at >= now() - make_interval(days => s.max_age)
                   and g.pricing_model <> 'UNKNOWN' and g.price_per_1k_micros is not null) as usable
      from public.find_buyers_actor_registry g, s
     group by g.source
    union all select 'TELEGRAM', (select s.native and s.telegram from s)
    union all select 'FORUM', (select s.native and s.forum from s)
  ), net as (
    select coalesce(jsonb_agg(jsonb_build_object('family', family, 'state', case when usable then 'AVAILABLE' else 'DISABLED' end)
                              order by usable desc, family), '[]'::jsonb) as network
      from (select family, bool_or(usable) as usable from fam group by family) f
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
      else 'DISCOVERY_UNAVAILABLE' end,
    'network', net.network)
  from s, a, net;
$function$;
revoke all on function public.find_buyers_readiness() from public, anon;
grant execute on function public.find_buyers_readiness() to authenticated, service_role;


------------------------------------------------------------------------------
-- Actor verification truth.
------------------------------------------------------------------------------
alter table public.find_buyers_actor_registry
  add column if not exists output_contract_verified_at timestamptz,
  add column if not exists last_verified_at timestamptz;

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
               g.pricing_verified_at, g.input_contract_verified_at, g.output_contract_verified_at, g.last_verified_at, g.priority, g.max_results, g.probe_size,
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


------------------------------------------------------------------------------
-- Apify provider switch at the money gate: a memo23 run is reserved only while
-- APIFY is enabled on Admin → Providers. Same body as 20261015090000 plus that
-- one refusal; grants unchanged.
------------------------------------------------------------------------------
create or replace function public.find_buyers_reserve_actor_run(
  p_matching_job_id uuid,
  p_actor_key text,
  p_idempotency_key text,
  p_queue_job_id uuid,
  p_operation text,
  p_language text,
  p_tranche integer,
  p_requested_limit integer,
  p_reason jsonb default '{}'::jsonb,
  p_retry_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c public.find_buyers_campaigns%rowtype;
  v_a public.find_buyers_actor_registry%rowtype;
  v_existing public.find_buyers_actor_runs%rowtype;
  v_enabled boolean;
  v_max_age integer;
  v_limit integer;
  v_estimate bigint;
  v_committed bigint;
  v_actor_campaign bigint;
  v_actor_day bigint;
  v_running integer;
  v_global_cap integer;
  v_global_running integer;
  v_id uuid;
begin
  /* Locks in one fixed order — campaign, then actor — so concurrent reserves
     for different campaigns serialise on the actor's caps too. */
  select * into v_c from public.find_buyers_campaigns where matching_job_id = p_matching_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_CAMPAIGN'); end if;
  perform 1 from public.find_buyers_actor_registry where actor_key = p_actor_key for update;

  /* Replay check AFTER the locks: a concurrent twin waits, then replays. */
  select * into v_existing from public.find_buyers_actor_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.matching_job_id <> p_matching_job_id then
      return jsonb_build_object('ok', false, 'reason', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
    return jsonb_build_object('ok', true, 'replay', true, 'runId', v_existing.id, 'status', v_existing.status,
                              'reservedMicros', v_existing.reserved_micros, 'requestedLimit', v_existing.requested_limit,
                              'actorId', v_existing.actor_id, 'timeoutSeconds', v_a.timeout_seconds,
                              'actorEnabled', v_a.enabled and not v_a.emergency_disabled and v_a.health <> 'DISABLED');
  end if;
  if v_c.finalized_at is not null then return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_FINALIZED'); end if;

  select coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_buyers_social_enabled'), false)
    into v_enabled;
  if not v_enabled then return jsonb_build_object('ok', false, 'reason', 'SOCIAL_DISABLED'); end if;
  /* Apify switched off on Admin → Providers: no memo23 run is reserved (no money moves). */
  if coalesce((select case jsonb_typeof(value) when 'array' then value ? 'APIFY' when 'string' then upper(value #>> '{}') like '%"APIFY"%' else false end
                 from public.admin_settings where key = 'provider_disabled_list'), false) then
    return jsonb_build_object('ok', false, 'reason', 'APIFY_DISABLED_BY_ADMIN');
  end if;

  select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACTOR'); end if;
  if not v_a.enabled or v_a.emergency_disabled or v_a.health = 'DISABLED' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DISABLED');
  end if;
  select coalesce((select (value #>> '{}')::int from public.admin_settings where key = 'find_buyers_pricing_max_age_days'), 30)
    into v_max_age;
  if v_a.pricing_verified_at is null or v_a.pricing_verified_at < now() - make_interval(days => v_max_age)
     or v_a.pricing_model = 'UNKNOWN' or v_a.price_per_1k_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_VERIFIED');
  end if;

  v_limit := greatest(1, least(coalesce(p_requested_limit, v_a.probe_size), v_a.max_results));
  v_estimate := v_a.start_fee_micros + ceil(v_limit::numeric * v_a.price_per_1k_micros / 1000)::bigint;

  select count(*) into v_running from public.find_buyers_actor_runs
   where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null
     and created_at > now() - interval '2 hours';
  if v_running >= v_a.concurrency then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_BUSY', 'retry', true);
  end if;

  /* GLOBAL SLOTS: at most N memo23 runs in flight across every actor and
     campaign (N = discovery_provider_concurrency.APIFY_MEMO23, default 4).
     A run holds its slot from reservation until its cost is booked, so a
     finished or released run frees the slot for the next queued job. The
     advisory lock serialises this check across actors (the actor row lock
     above only serialises one actor). */
  perform pg_advisory_xact_lock(hashtext('find_buyers:memo23_global_slots'));
  v_global_cap := greatest(1, coalesce((select (value ->> 'APIFY_MEMO23')::int from public.admin_settings
                                         where key = 'discovery_provider_concurrency'), 4));
  select count(*) into v_global_running from public.find_buyers_actor_runs
   where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null
     and created_at > now() - interval '2 hours';
  if v_global_running >= v_global_cap then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_BUSY', 'retry', true,
                              'running', v_global_running, 'cap', v_global_cap);
  end if;

  /* Committed = held reservations + booked actuals (+ the reservation of a
     run whose cost is still unknown: never treated as zero). */
  select coalesce(sum(case
           when status in ('RESERVED', 'STARTING', 'RUNNING') then reserved_micros
           when actual_micros is not null then actual_micros
           when status = 'RELEASED' then 0
           else reserved_micros end), 0)
    into v_committed from public.find_buyers_actor_runs where matching_job_id = p_matching_job_id;
  if v_committed + v_estimate > v_c.provider_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_BUDGET', 'committedMicros', v_committed,
                              'estimateMicros', v_estimate, 'budgetMicros', v_c.provider_budget_micros);
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_campaign from public.find_buyers_actor_runs
   where matching_job_id = p_matching_job_id and actor_key = p_actor_key;
  if v_actor_campaign + v_estimate > v_a.campaign_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_CAMPAIGN_CAP');
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_day from public.find_buyers_actor_runs
   where actor_key = p_actor_key and created_at >= date_trunc('day', now());
  if v_actor_day + v_estimate > v_a.daily_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DAILY_CAP');
  end if;

  insert into public.find_buyers_actor_runs (
    idempotency_key, matching_job_id, queue_job_id, actor_key, actor_id, source, operation, language,
    tranche, retry_of, attempt, requested_limit, status, reserved_micros, estimated_micros, reason)
  values (
    p_idempotency_key, p_matching_job_id, p_queue_job_id, v_a.actor_key, v_a.actor_id, v_a.source, p_operation,
    p_language, coalesce(p_tranche, 0), p_retry_of,
    case when p_retry_of is null then 1
         else 1 + coalesce((select attempt from public.find_buyers_actor_runs where id = p_retry_of), 0) end,
    v_limit, 'RESERVED', v_estimate, v_estimate, coalesce(p_reason, '{}'::jsonb))
  returning id into v_id;

  insert into public.find_buyers_cost_ledger (
    idempotency_key, matching_job_id, property_id, kind, provider, actor_key, actor_run_id, operation,
    requested_limit, estimated_micros, cost_state, cost_basis, status, retry_of, metadata)
  values (
    'reserve:' || v_id, p_matching_job_id, v_c.property_id, 'PROVIDER', 'APIFY_MEMO23', v_a.actor_key, v_id,
    p_operation, v_limit, v_estimate, 'ESTIMATED', 'RESERVATION', 'RESERVED', p_retry_of,
    jsonb_build_object('language', p_language, 'tranche', p_tranche, 'queueJobId', p_queue_job_id));

  update public.find_buyers_campaigns set last_activity_at = now() where matching_job_id = p_matching_job_id;
  return jsonb_build_object('ok', true, 'runId', v_id, 'requestedLimit', v_limit, 'reservedMicros', v_estimate,
    'actorId', v_a.actor_id, 'timeoutSeconds', v_a.timeout_seconds,
    'pricePer1kMicros', v_a.price_per_1k_micros, 'pricingModel', v_a.pricing_model,
    'remainingMicros', v_c.provider_budget_micros - v_committed - v_estimate);
end;
$function$;
revoke all on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) to service_role;
