-- FIND BUYERS lifecycle truth (20261016090000). Run after find_buyers.sql and find_buyers_slots.sql.
\set ON_ERROR_STOP on
update public.users set preferred_language = 'ka';
update public.properties set user_id = '00000000-0000-0000-0000-0000000000a1', transaction_type = 'SALE';
update public.find_buyers_actor_registry set enabled = false;
update public.admin_settings set value = 'false' where key = 'find_buyers_social_enabled';
update public.find_buyers_actor_runs set cost_booked_at = coalesce(cost_booked_at, now()), status = case when status in ('RESERVED','STARTING','RUNNING') then 'SUCCEEDED' else status end;

do $$
declare r jsonb; s jsonb;
begin
  -- A. nothing executable → not ready, with a reason
  r := public.find_buyers_readiness();
  assert not (r->>'ready')::boolean and r->>'reason' = 'DISCOVERY_SWITCHED_OFF', 'switched off: ' || r::text;
  update public.admin_settings set value = 'true' where key = 'find_buyers_social_enabled';
  r := public.find_buyers_readiness();
  assert not (r->>'ready')::boolean and r->>'reason' = 'NO_ELIGIBLE_SOURCE', 'switch on, no actor: ' || r::text;
  update public.find_buyers_actor_registry set enabled = true where actor_key = 'FB_COMMENTS';
  r := public.find_buyers_readiness();
  assert (r->>'ready')::boolean and (r->>'eligibleActors')::int = 1 and r->'sources' ? 'FACEBOOK', 'one verified actor → ready: ' || r::text;
  update public.find_buyers_actor_registry set pricing_verified_at = null where actor_key = 'FB_COMMENTS';
  assert not (public.find_buyers_readiness()->>'ready')::boolean, 'unverified price is not executable';
  update public.find_buyers_actor_registry set pricing_verified_at = now() where actor_key = 'FB_COMMENTS';
end $$;

-- The 220 ms case: a campaign that queued nothing and ran nothing.
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k-e1', 'ranking');
update public.matching_jobs set status = 'partially_completed', failure_reason = 'NO_CURRENT_DEMAND_SOURCES_OFF' where id = '00000000-0000-0000-0000-0000000000e1';
do $$
declare s jsonb;
begin
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e1');
  assert s->>'state' = 'UNAVAILABLE' and not (s->>'executed')::boolean, 'no work ran → UNAVAILABLE, never completed-zero: ' || s::text;
  assert (select title from public.notifications where dedupe_key = 'matching-job-finished:00000000-0000-0000-0000-0000000000e1') = 'ძებნა ამ ეტაპზე ვერ დაიწყო',
    'notification must not say finished';
end $$;

-- A real campaign: queued, searching, started notification.
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k-e2', 'queued');
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'SALE', 100, 10, 10000000, 5000000);
update public.matching_jobs set status = 'searching_sources', discovery_deadline_at = now() + interval '30 minutes' where id = '00000000-0000-0000-0000-0000000000e2';
insert into public.discovery_query_queue (id, property_id, platform, language, query, provider, matching_job_id, executor, status, dedupe_key, metadata, priority) values
 ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'FACEBOOK', 'ka', 'q-a', 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000000e2', 'EDGE', 'PENDING', 'lc-a', '{"stage":"FB_COMMENTS"}', 50),
 ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', 'REDDIT', 'en', 'q-b', 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000000e2', 'EDGE', 'PENDING', 'lc-b', '{"stage":"REDDIT_SEARCH"}', 50),
 ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000b1', 'VK', 'ru', 'q-c', 'APIFY_MEMO23', '00000000-0000-0000-0000-0000000000e2', 'EDGE', 'PENDING', 'lc-c', '{"stage":"VK_WALL"}', 50);
do $$
declare s jsonb; r jsonb; j record; s2 text;
begin
  assert (select title from public.notifications where dedupe_key = 'matching-job-started:00000000-0000-0000-0000-0000000000e2') = 'მყიდველების ძებნა დაიწყო', 'started notice';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'QUEUED' and (s->'queue'->>'queued')::int = 3 and jsonb_array_length(s->'sources') = 3, 'queued, three real nodes: ' || s::text;

  -- job A starts a provider run (handler releases the row with actorRunId) → SEARCHING
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000e2', 'FB_COMMENTS', 'lc-run-a', '00000000-0000-0000-0000-0000000000f1', 'FB_COMMENTS', 'ka', 0, 20);
  assert (r->>'ok')::boolean, 'reserve A ' || r::text;
  update public.find_buyers_actor_runs set status = 'RUNNING', provider_run_id = 'lc-pr-a', started_at = now() where id = (r->>'runId')::uuid;
  update public.discovery_query_queue set status = 'RETRY_WAIT', next_attempt_at = now(), metadata = metadata || jsonb_build_object('actorRunId', r->>'runId') where id = '00000000-0000-0000-0000-0000000000f1';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'SEARCHING' and (s->'runs'->>'inFlight')::int = 1, 'searching: ' || s::text;

  -- a lead arrives early → PARTIAL_RESULTS, first-results notice, campaign still running
  insert into public.find_buyers_persons (id, network, person_key) values ('00000000-0000-0000-0000-0000000000a9', 'FACEBOOK', 'p1');
  insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a9', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 88, 'STRONG');
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'PARTIAL_RESULTS' and (s->>'newResults')::int = 1 and (s->>'active')::boolean, 'partial results: ' || s::text;
  assert exists (select 1 from public.notifications where dedupe_key = 'find-buyers-first-result:00000000-0000-0000-0000-0000000000e2'), 'first results notice';

  -- PAUSE while A runs: unstarted jobs are held, A keeps being polled → PAUSING
  perform set_config('app.uid', '', true);
  r := public.discovery_control('MATCHING_JOB', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'pause');
  assert (r->>'ok')::boolean and (r->>'heldJobs')::int = 2, 'two unstarted held: ' || r::text;
  assert (select status from public.discovery_query_queue where id = '00000000-0000-0000-0000-0000000000f1') = 'RETRY_WAIT', 'started run not held';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'PAUSING', 'pausing while a run is in flight: ' || s::text;
  create temp table lc_claimed on commit drop as select * from public.claim_discovery_source_jobs_v2(4, 180, 4, 'EDGE', array['APIFY_MEMO23']);
  assert exists (select 1 from lc_claimed where id = '00000000-0000-0000-0000-0000000000f1'), 'the started run is still polled while paused';
  assert not exists (select 1 from lc_claimed where matching_job_id = '00000000-0000-0000-0000-0000000000e2' and id <> '00000000-0000-0000-0000-0000000000f1'),
    'nothing new starts while paused';
  select * into j from lc_claimed where id = '00000000-0000-0000-0000-0000000000f1';
  -- A finishes and is booked while paused
  perform public.find_buyers_book_run_cost((select id from public.find_buyers_actor_runs where idempotency_key = 'lc-run-a'), 'SUCCEEDED', 9000, 'RUN_PRICE_X_BILLED_UNITS', 18, 18);
  update public.discovery_query_queue set status = 'DONE', result_count = 1, claim_token = null where id = j.id;
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'PAUSED' and (s->'queue'->>'paused')::int = 2, 'paused once nothing is in flight: ' || s::text;
  assert (select count(*) from public.notifications where dedupe_key like 'matching-job-%:00000000-0000-0000-0000-0000000000e2') = 1, 'pause sends no finished/started notice';

  -- RESUME: same campaign, the two held jobs come back, no new start notice
  r := public.discovery_control('MATCHING_JOB', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'resume');
  assert (r->>'ok')::boolean and (r->>'resumedJobs')::int = 2, 'resume: ' || r::text;
  assert (select count(*) from public.notifications where dedupe_key = 'matching-job-started:00000000-0000-0000-0000-0000000000e2') = 1, 'resume is not a new start';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'PARTIAL_RESULTS' and (s->'queue'->>'queued')::int = 2, 'resumed: ' || s::text;

  -- all remaining work ends; results exist → COMPLETED_WITH_RESULTS
  update public.discovery_query_queue set status = 'DONE' where matching_job_id = '00000000-0000-0000-0000-0000000000e2' and status <> 'DONE';
  update public.matching_jobs set status = 'completed' where id = '00000000-0000-0000-0000-0000000000e2';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e2');
  assert s->>'state' = 'COMPLETED_WITH_RESULTS' and not (s->>'active')::boolean, 'completed with results: ' || s::text;
  select title into s2 from public.notifications where dedupe_key = 'matching-job-finished:00000000-0000-0000-0000-0000000000e2';
  assert s2 = 'ძებნა დასრულდა — ნაპოვნია 1 ახალი შესაბამისობა', 'finished notice counts social leads: ' || s2;
end $$;

-- Real work, zero results → COMPLETED_NO_RESULTS (and only then).
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k-e3', 'searching_sources');
insert into public.discovery_query_queue (property_id, platform, language, query, provider, matching_job_id, executor, status, dedupe_key)
values ('00000000-0000-0000-0000-0000000000b1', 'TELEGRAM', 'ka', 'q-t', 'TELEGRAM', '00000000-0000-0000-0000-0000000000e3', 'EDGE', 'DONE', 'lc-t');
-- historical / stale matches of the property never count as this campaign's results
insert into public.matches (property_id, job_id, status, demand_published_at) values
 ('00000000-0000-0000-0000-0000000000b1', null, 'LOCKED', now() - interval '2 days'),
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 'LOCKED', now() - interval '45 days');
update public.matching_jobs set status = 'partially_completed' where id = '00000000-0000-0000-0000-0000000000e3';
do $$
declare s jsonb;
begin
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e3');
  assert s->>'state' = 'COMPLETED_NO_RESULTS' and (s->>'executed')::boolean and (s->>'newResults')::int = 0,
    'real work, zero fresh results (old and stale matches excluded): ' || s::text;
  assert (select title from public.notifications where dedupe_key = 'matching-job-finished:00000000-0000-0000-0000-0000000000e3')
    = 'ძებნა დასრულდა — ამ ეტაპზე ახალი აქტიური მოთხოვნა ვერ მოიძებნა', 'true zero notice';
end $$;

-- Unavailable failure and the owner read.
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'k-e4', 'queued');
update public.matching_jobs set status = 'failed', failure_reason = 'DISCOVERY_UNAVAILABLE' where id = '00000000-0000-0000-0000-0000000000e4';
do $$
declare s jsonb; ok boolean := false;
begin
  assert public.find_buyers_job_state('00000000-0000-0000-0000-0000000000e4')->>'state' = 'UNAVAILABLE', 'unavailable failure';
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000000a1', true);
  s := public.find_buyers_campaign_status('00000000-0000-0000-0000-0000000000b1');
  assert s->'campaign'->>'jobId' = '00000000-0000-0000-0000-0000000000e4' and s ? 'readiness', 'owner reads latest campaign: ' || s::text;
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000000ff', true);
  begin perform public.find_buyers_campaign_status('00000000-0000-0000-0000-0000000000b1'); exception when others then ok := true; end;
  assert ok, 'another user cannot read the campaign';
  perform set_config('app.uid', '', true);
  assert not has_function_privilege('authenticated', 'public.find_buyers_job_state(uuid)', 'execute'), 'state helper is server-only';
  perform set_config('app.admin', 'on', true);
  assert jsonb_typeof(public.admin_find_buyers_center(30)->'campaigns'->0->'lifecycle') = 'object', 'admin sees lifecycle';
  perform set_config('app.admin', '', true);
end $$;
select 'FIND BUYERS LIFECYCLE CHECKS: PASS' as result;
