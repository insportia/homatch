-- FIND BUYERS: the campaign records how its last search ended
-- (20261021090000), while status/status_v2 keep meaning "monitoring on".
\set ON_ERROR_STOP on
insert into public.matching_campaigns (id, property_id, user_id, status_v2)
values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'ACTIVE');

do $$
declare c record;
begin
  /* a search starts → SEARCHING, nothing finished yet */
  insert into public.matching_jobs (id, user_id, property_id, campaign_id, idempotency_key, status, started_at)
  values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000005c1', 'last-1', 'searching_sources', now() - interval '3 minutes');
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_job_id = '00000000-0000-0000-0000-0000000005a1' and c.last_search_state = 'SEARCHING'
     and c.last_search_finished_at is null, 'running search recorded: ' || row_to_json(c)::text;

  /* the owner's 2026-10-04 shape: Telegram ran, nothing current → COMPLETED_NO_CURRENT_DEMAND */
  insert into public.discovery_query_queue (property_id, platform, language, query, status, result_count, provider, matching_job_id)
  values ('00000000-0000-0000-0000-0000000000b1', 'TELEGRAM', 'ka', 'sync', 'DONE', 0, 'TELEGRAM', '00000000-0000-0000-0000-0000000005a1');
  update public.matching_jobs set status = 'partially_completed', failure_reason = 'NO_CURRENT_DEMAND_FOUND', completed_at = now()
   where id = '00000000-0000-0000-0000-0000000005a1';
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_state = 'COMPLETED_NO_CURRENT_DEMAND' and c.last_search_finished_at is not null,
    'finished search no longer reads as running: ' || row_to_json(c)::text;
  assert c.status_v2::text = 'ACTIVE' and c.status::text = 'ACTIVE', 'continuous monitoring untouched: ' || row_to_json(c)::text;

  /* a newer search that could not start → UNAVAILABLE */
  insert into public.matching_jobs (id, user_id, property_id, campaign_id, idempotency_key, status, started_at)
  values ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000005c1', 'last-2', 'queued', now());
  update public.matching_jobs set status = 'failed', failure_reason = 'DISCOVERY_UNAVAILABLE', completed_at = now()
   where id = '00000000-0000-0000-0000-0000000005a2';
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_job_id = '00000000-0000-0000-0000-0000000005a2' and c.last_search_state = 'UNAVAILABLE', row_to_json(c)::text;

  /* an OLDER job changing late never overwrites the newer search */
  update public.matching_jobs set status = 'completed' where id = '00000000-0000-0000-0000-0000000005a1';
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_job_id = '00000000-0000-0000-0000-0000000005a2', 'older job did not overwrite: ' || row_to_json(c)::text;

  /* another user's job pointing at this campaign (even with a far-future start) never writes it */
  insert into public.matching_jobs (id, user_id, property_id, campaign_id, idempotency_key, status, started_at)
  values ('00000000-0000-0000-0000-0000000005a9', '00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000005c1', 'last-x', 'failed', now() + interval '10 years');
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_job_id = '00000000-0000-0000-0000-0000000005a2', 'cross-tenant job did not write: ' || row_to_json(c)::text;

  /* the owner's own future-dated start is clamped to now, so it cannot lock out later searches */
  insert into public.matching_jobs (id, user_id, property_id, campaign_id, idempotency_key, status, started_at)
  values ('00000000-0000-0000-0000-0000000005a8', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000005c1', 'last-f', 'queued', now() + interval '10 years');
  select * into c from public.matching_campaigns where id = '00000000-0000-0000-0000-0000000005c1';
  assert c.last_search_job_id = '00000000-0000-0000-0000-0000000005a8' and c.last_search_started_at <= now(), 'start clamped: ' || row_to_json(c)::text;
  update public.matching_jobs set status = 'cancelled', completed_at = now() where id = '00000000-0000-0000-0000-0000000005a8';

  /* a job with no campaign is ignored; the helper is server-only */
  insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
  values ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'last-3', 'queued');
  assert not has_function_privilege('authenticated', 'public.matching_job_search_state(uuid)', 'execute'), 'state helper is server-only';
end $$;

/* socialPlan: the 2026-10-04 failure is visible in the state the screen reads. */
do $$
declare s jsonb;
begin
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000005a1');
  assert s -> 'socialPlan' is null or jsonb_typeof(s -> 'socialPlan') = 'null', 'no planner event → no claim: ' || coalesce(s ->> 'socialPlan', 'null');
  insert into public.matching_job_events (job_id, event_type, payload, created_at)
  values ('00000000-0000-0000-0000-0000000005a1', 'SOCIAL_DISCOVERY_FAILED', '{"message": "db.from(...).upsert(...).catch is not a function"}', now() - interval '2 minutes');
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000005a1');
  assert s -> 'socialPlan' ->> 'outcome' = 'FAILED' and s -> 'socialPlan' ->> 'reason' = 'PLANNER_ERROR'
     and (s -> 'socialPlan' ->> 'queued')::int = 0, 'planner failure reported: ' || (s -> 'socialPlan')::text;
  insert into public.matching_job_events (job_id, event_type, payload)
  values ('00000000-0000-0000-0000-0000000005a2', 'SOCIAL_DISCOVERY_SKIPPED', '{"reason": "NO_ACTOR_READY", "queued": 0}'),
         ('00000000-0000-0000-0000-0000000005a3', 'SOCIAL_DISCOVERY_QUEUED', '{"reason": null, "queued": 7}');
  assert public.find_buyers_job_state('00000000-0000-0000-0000-0000000005a2') -> 'socialPlan' ->> 'reason' = 'NO_ACTOR_READY';
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000005a3');
  assert s -> 'socialPlan' ->> 'outcome' = 'QUEUED' and (s -> 'socialPlan' ->> 'queued')::int = 7, (s -> 'socialPlan')::text;
end $$;

select 'FIND BUYERS LAST SEARCH STATE CHECKS PASS';
