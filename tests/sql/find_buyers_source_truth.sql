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

/* Actor verification truth: the admin center carries the new columns. */
do $$
declare a jsonb;
begin
  update public.find_buyers_actor_registry set last_verified_at = now() where actor_key = (select min(actor_key) from public.find_buyers_actor_registry);
  perform set_config('app.admin', 'on', true);
  select x into a from jsonb_array_elements(public.admin_find_buyers_center(30) -> 'actors') x where x ? 'last_verified_at' and x ->> 'last_verified_at' is not null limit 1;
  assert a is not null and a ? 'output_contract_verified_at' and a ->> 'output_contract_verified_at' is null, 'admin sees verification columns: ' || coalesce(a::text, 'none');
  perform set_config('app.admin', '', true);
end $$;

/* Apify provider switch (Admin → Providers): server-authoritative at the
   money gate and in readiness. Rolled back: the fixture is left as it was. */
begin;
do $$
declare r jsonb; rd jsonb;
begin
  update public.find_buyers_actor_registry set enabled = true, emergency_disabled = false, health = 'UNKNOWN',
         pricing_model = 'PAY_PER_RESULT', price_per_1k_micros = 500000, pricing_verified_at = now()
   where actor_key = 'FB_COMMENTS';
  insert into public.admin_settings (key, value) values ('find_buyers_social_enabled', 'true'::jsonb)
    on conflict (key) do update set value = excluded.value;
  insert into public.admin_settings (key, value) values ('provider_disabled_list', '["APIFY","DATAFORSEO"]'::jsonb)
    on conflict (key) do update set value = excluded.value;

  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 'apify-off-1', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r ->> 'reason' = 'APIFY_DISABLED_BY_ADMIN' and not (r ->> 'ok')::boolean, 'Apify off: no reservation: ' || r::text;
  assert not exists (select 1 from public.find_buyers_actor_runs where idempotency_key = 'apify-off-1'), 'Apify off: no run row';
  rd := public.find_buyers_readiness();
  assert (rd ->> 'social')::boolean is false, 'Apify off: readiness social false: ' || rd::text;
  assert not exists (select 1 from jsonb_array_elements(rd -> 'network') x
                      where x ->> 'family' = 'FACEBOOK' and x ->> 'state' = 'AVAILABLE'), 'Apify off: no social family AVAILABLE';

  /* Stored as JSON text instead of an array: still read as disabled (fail safe). */
  update public.admin_settings set value = to_jsonb('["apify","DATAFORSEO"]'::text) where key = 'provider_disabled_list';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 'apify-off-2', null, 'FB_COMMENTS', 'en', 0, 20);
  assert r ->> 'reason' = 'APIFY_DISABLED_BY_ADMIN', 'Apify off (text form): ' || r::text;
  update public.admin_settings set value = '["DATAFORSEO"]'::jsonb where key = 'provider_disabled_list';
  r := public.find_buyers_reserve_actor_run('00000000-0000-0000-0000-0000000000c2', 'FB_COMMENTS', 'apify-on-1', null, 'FB_COMMENTS', 'en', 0, 20);
  assert coalesce(r ->> 'reason', '') <> 'APIFY_DISABLED_BY_ADMIN', 'Apify on: the switch no longer refuses: ' || r::text;
  rd := public.find_buyers_readiness();
  assert (rd ->> 'social')::boolean is true, 'Apify on + a verified enabled Actor: readiness social true: ' || rd::text;
end $$;
rollback;

select 'FIND BUYERS SOURCE TRUTH CHECKS PASS';
