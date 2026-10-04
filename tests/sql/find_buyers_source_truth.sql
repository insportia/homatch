-- FIND BUYERS: per-source truth (20261018090000). Run after
-- find_buyers_current_leads.sql. The owner's first run: 2 Telegram messages
-- read + 31 communities registered must never read as "33 results".
\set ON_ERROR_STOP on
alter table public.matches add column if not exists preview_platform text;
update public.matching_jobs set status = 'completed'
 where status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached');

insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'truth-1', 'ranking');
insert into public.discovery_query_queue (property_id, platform, language, query, status, result_count, provider, matching_job_id)
values ('00000000-0000-0000-0000-0000000000b1', 'TELEGRAM', 'ka', 'sync', 'DONE', 2, 'TELEGRAM', '00000000-0000-0000-0000-0000000003a1'),
       ('00000000-0000-0000-0000-0000000000b1', 'TELEGRAM', 'ka', 'discover', 'DONE', 31, 'TELEGRAM_SOURCES', '00000000-0000-0000-0000-0000000003a1');
update public.matching_jobs set status = 'partially_completed', failure_reason = 'NO_CURRENT_DEMAND_FOUND' where id = '00000000-0000-0000-0000-0000000003a1';

do $$
declare s jsonb; n jsonb; r jsonb;
begin
  s := public.find_buyers_job_state('00000000-0000-0000-0000-0000000003a1');
  assert jsonb_array_length(s -> 'sources') = 1, 'one Telegram node: ' || s::text;
  n := s -> 'sources' -> 0;
  assert n ->> 'source' = 'TELEGRAM' and (n ->> 'checked')::int = 2 and (n ->> 'communities')::int = 31
     and (n ->> 'qualified')::int = 0 and (n ->> 'results')::int = 2, 'checked/communities/qualified kept apart: ' || n::text;
  assert (s ->> 'signalsChecked')::int = 2 and (s ->> 'communitiesFound')::int = 31 and (s ->> 'newResults')::int = 0, 'totals: ' || s::text;
  assert s ->> 'state' = 'COMPLETED_NO_RESULTS', 'a real search that found nothing current: ' || s::text;

  /* a current match from this run on Telegram is counted as qualified for Telegram */
  insert into public.matches (property_id, job_id, status, demand_published_at, preview_platform)
  values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000003a1', 'LOCKED', now() - interval '2 days', 'TELEGRAM');
  n := public.find_buyers_job_state('00000000-0000-0000-0000-0000000003a1') -> 'sources' -> 0;
  assert (n ->> 'qualified')::int = 1, 'qualified per source: ' || n::text;

  /* the network: every registered family, AVAILABLE only when usable now */
  r := public.find_buyers_readiness();
  assert jsonb_typeof(r -> 'network') = 'array' and jsonb_array_length(r -> 'network') >= 3, 'network listed: ' || r::text;
  assert exists (select 1 from jsonb_array_elements(r -> 'network') x where x ->> 'family' = 'TELEGRAM'), 'Telegram in the network';
  assert exists (select 1 from jsonb_array_elements(r -> 'network') x where x ->> 'family' = 'FORUM'), 'forums in the network';
  assert not exists (select 1 from jsonb_array_elements(r -> 'network') x
                      where x ->> 'state' not in ('AVAILABLE', 'DISABLED')), 'only AVAILABLE / DISABLED: ' || r::text;
  update public.find_buyers_actor_registry set enabled = false;
  update public.admin_settings set value = 'false' where key in ('find_buyers_social_enabled', 'campaign_source_discovery_enabled');
  r := public.find_buyers_readiness();
  assert not exists (select 1 from jsonb_array_elements(r -> 'network') x where x ->> 'state' = 'AVAILABLE'), 'everything off -> nothing AVAILABLE: ' || r::text;
end $$;

select 'FIND BUYERS SOURCE TRUTH CHECKS PASS';
