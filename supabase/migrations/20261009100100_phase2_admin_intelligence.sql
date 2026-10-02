-- PHASE 2 — ADMIN INTELLIGENCE (read-only, admin-only).
--
-- One RPC for the Admin Intelligence Center: what the engine is doing and
-- whether HOMATCH is actually learning. Counts, states, ids and timings only:
-- no message text, no listing description, no contact data, no token, no
-- credential. Nothing here writes.

create or replace function public.admin_discovery_intelligence()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    /* The Phase 2 switches, by name; never a token. */
    'switches', coalesce((
      select jsonb_object_agg(key, value) from public.admin_settings
       where key in ('find_property_discovery_enabled', 'discovery_worker_route_enabled',
                     'discovery_worker_portal_adapters', 'discovery_provider_concurrency')
         and key not like '%token%'), '{}'::jsonb),

    'runs', coalesce((
      select jsonb_agg(r order by r.started_at desc) from (
        select d.id, d.user_id, d.status, d.stage, d.progress, d.results_found, d.credits_charged,
               d.provider_cost_usd, d.failure_reason, d.started_at, d.completed_at,
               extract(epoch from (coalesce(d.completed_at, now()) - d.started_at))::int as elapsed_seconds,
               (select jsonb_object_agg(k, n) from (
                  select q.provider || ':' || q.executor || ':' || q.status as k, count(*) as n
                    from public.discovery_query_queue q where q.discovery_run_id = d.id group by 1) x) as source_jobs
          from public.discovery_runs d
         order by d.started_at desc limit 25) r), '[]'::jsonb),

    'plans_7d', coalesce((
      select jsonb_object_agg(direction, n) from (
        select direction, count(*) n from public.discovery_search_plans
         where created_at > now() - interval '7 days' group by 1) p), '{}'::jsonb),

    'queue', coalesce((
      select jsonb_agg(q) from (
        select upper(coalesce(provider, '?')) as provider, executor, status, count(*) as jobs,
               min(created_at) filter (where status in ('PENDING', 'RETRY_WAIT')) as oldest_waiting,
               max(coalesce(finished_at, claimed_at, created_at)) as last_activity,
               count(*) filter (where status = 'PROCESSING' and lease_expires_at < now()) as expired_leases
          from public.discovery_query_queue
         where created_at > now() - interval '30 days'
         group by 1, 2, 3 order by 1, 2, 3) q), '[]'::jsonb),

    'live_checks', coalesce((
      select jsonb_agg(c order by c.source_key, c.route) from (
        select distinct on (source_key, route)
               source_key, route, market, checked_at, ok, http_status, latency_ms, collection_items,
               detail_ok, normalized_ok, limitation
          from public.discovery_source_live_checks
         order by source_key, route, checked_at desc) c), '[]'::jsonb),

    'supply_by_adapter', coalesce((
      select jsonb_agg(s order by s.observations desc) from (
        select adapter_id, count(*) as observations, count(distinct entity_id) as entities,
               count(*) filter (where first_seen_at > now() - interval '7 days') as new_7d,
               max(last_seen_at) as last_seen,
               count(*) filter (where validation_state = 'VALID') as valid,
               count(*) filter (where validation_state in ('INVALID', 'REMOVED')) as gone,
               round(avg(structured_quality)::numeric, 2) as avg_quality
          from public.supply_observations group by 1) s), '[]'::jsonb),

    'entities', jsonb_build_object(
      'total', (select count(*) from public.supply_entities),
      'multi_observation', (select count(*) from public.supply_entities where observation_count > 1),
      'multi_source', (select count(*) from public.supply_entities where source_count > 1),
      'observations', (select count(*) from public.supply_observations),
      'resolved_observations', (select count(*) from public.supply_observations where entity_id is not null),
      'largest', coalesce((
        select jsonb_agg(e) from (
          select id, city, transaction, property_type, observation_count, source_count,
                 min_price, max_price, price_currency, price_spread, last_seen_at
            from public.supply_entities order by observation_count desc, last_seen_at desc limit 15) e), '[]'::jsonb)),

    'resolution_7d', coalesce((
      select jsonb_object_agg(verdict, n) from (
        select verdict, count(*) n from public.supply_resolution_decisions
         where decided_at > now() - interval '7 days' group by 1) v), '{}'::jsonb),

    'matches', jsonb_build_object(
      'external_listing', (select count(*) from public.supply_matches where source_kind = 'EXTERNAL_LISTING'),
      'external_intelligence', (select count(*) from public.supply_matches where source_kind = 'EXTERNAL_INTELLIGENCE'),
      'internal_homatch', (select count(*) from public.supply_matches where source_kind = 'INTERNAL_HOMATCH'),
      'demand_matches_30d', (select count(*) from public.matches where created_at > now() - interval '30 days')),

    'community_supply', jsonb_build_object(
      'listing_posts', (select count(*) from public.raw_signals where research_direction = 'SUPPLY'),
      'stored_as_supply', (select count(*) from public.supply_observations where adapter_id like '%-community'))
  ) into v;

  return v;
end;
$function$;

revoke all on function public.admin_discovery_intelligence() from public, anon, authenticated, service_role;
grant execute on function public.admin_discovery_intelligence() to authenticated;
