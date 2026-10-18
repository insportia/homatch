-- VERIFY — the 30-second driver no longer reads every completed report (capacity audit 2026-10-18, P1 #4).
--
-- research-agent's drive tick (pg_cron every 30 s) runs pollMarketRefreshes(), which asked for
-- COMPLETE jobs whose result_json->'_marketRefresh'->>'state' is RUNNING. No index covered the
-- JSON path, so every tick de-toasted every completed report: in production 51.7 ms and ~12 MB
-- of buffer reads per call with only 76 completed jobs (pg_stat_statements, 2026-10-18), growing
-- linearly with history. On a throwaway Postgres 16 with 2,000 completed jobs of production size
-- (~108 KB JSON each) the same query took 181 ms / ~33,000 buffers; with the partial index below,
-- 0.05 ms / 2 buffers.
--
-- 1. research_jobs_market_refresh_running_idx — partial expression index whose predicate IS the
--    sweep's filter; it only ever holds the few jobs with a refresh in flight.
-- 2. research_jobs_market_refresh_running(p_limit) — the sweep's read with LITERAL predicates, so
--    the planner can always prove the partial index applies (a generic plan with bound parameters
--    could not). Same columns, same filter, same limit semantics as the PostgREST query it replaces;
--    research-agent falls back to that query while this function is not yet applied.
-- 3. research_jobs_developer_ads_cache_idx — the Developer Ads 24 h cache lookup (once per Verify
--    job) filtered on result_json->'_developerAds' with no usable index either.
--
-- Additive only: no data is changed. Rollback:
--   drop function if exists public.research_jobs_market_refresh_running(integer);
--   drop index if exists public.research_jobs_market_refresh_running_idx;
--   drop index if exists public.research_jobs_developer_ads_cache_idx;

create index if not exists research_jobs_market_refresh_running_idx
  on public.research_jobs ((result_json -> '_marketRefresh' ->> 'state'))
  where status = 'COMPLETE' and (result_json -> '_marketRefresh' ->> 'state') = 'RUNNING';

create index if not exists research_jobs_developer_ads_cache_idx
  on public.research_jobs ((result_json -> '_developerAds' ->> 'cacheKey'), updated_at desc)
  where (result_json -> '_developerAds' ->> 'state') = 'COMPLETE';

create or replace function public.research_jobs_market_refresh_running(p_limit integer default 3)
returns table (
  id uuid,
  query text,
  mode text,
  result_json jsonb,
  synthesis_json jsonb,
  synthesis_state text
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select j.id, j.query::text, j.mode::text, j.result_json, j.synthesis_json, j.synthesis_state::text
    from public.research_jobs j
   where j.status = 'COMPLETE'
     and (j.result_json -> '_marketRefresh' ->> 'state') = 'RUNNING'
   limit greatest(1, least(coalesce(p_limit, 3), 50));
$function$;

comment on function public.research_jobs_market_refresh_running(integer) is
  'research-agent drive: COMPLETE jobs with a Verify market refresh in flight (served by research_jobs_market_refresh_running_idx).';

revoke all on function public.research_jobs_market_refresh_running(integer) from public, anon, authenticated;
grant execute on function public.research_jobs_market_refresh_running(integer) to service_role;
