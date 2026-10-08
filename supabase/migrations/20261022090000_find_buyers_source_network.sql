-- FIND BUYERS / FIND TENANTS — the source network, as Admin needs to see it.
--
-- Source discovery is the first stage of every campaign, so Admin must see
-- the network it grows, with the distinctions that matter kept apart:
--   DISCOVERED  found by a search; nothing about it is proven
--   VERIFIED    a real read proved it public and readable (an audit)
--   ACTIVE      switched on for reading
--   READ        actually read at least once (last success recorded)
-- A discovered group is not a readable group; a readable group is not a
-- searched one. Telegram's truth is community_targets (the native reader's
-- registry); every other network's is source_registry. community_directory is
-- the posting/recommendation directory — listed, never read — and is reported
-- on its own line so it is never mistaken for search coverage.
--
-- Additive and read-only: one STABLE, admin-gated function. No table changes.

create or replace function public.admin_find_buyers_source_network(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  with tg as (
    select 'TELEGRAM'::text as platform,
           t.lifecycle,
           t.lifecycle not in ('RETIRED') as discovered,
           t.readability = 'READABLE' and t.lifecycle in ('AUDITED', 'REACHABLE', 'PRODUCTIVE') as verified,
           t.discovery_enabled and t.lifecycle not in ('BLOCKED', 'RETIRED') as active,
           t.last_success_at is not null as was_read,
           t.lifecycle in ('BLOCKED', 'RETIRED', 'DEGRADED') as blocked,
           t.created_at >= v_since as is_new,
           coalesce(t.items_read, 0) as items, coalesce(t.comments_read, 0) as comments,
           coalesce(t.demand_found, 0) as demand, t.last_success_at as last_ok
      from public.community_targets t
     where t.platform = 'TELEGRAM'
  ), reg as (
    select r.platform::text as platform,
           r.lifecycle,
           coalesce(r.lifecycle, '') not in ('RETIRED') as discovered,
           r.access_state = 'PUBLIC' and r.lifecycle in ('AUDITED', 'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED', 'LIVE_TESTED', 'PRODUCTIVE') as verified,
           coalesce(r.active, false) and coalesce(r.lifecycle, '') not in ('BLOCKED', 'RETIRED') as active,
           coalesce(r.last_successful_at, r.last_collected_at) is not null as was_read,
           coalesce(r.lifecycle, '') in ('BLOCKED', 'RETIRED', 'DEGRADED') or r.access_state = 'INACCESSIBLE' as blocked,
           r.created_at >= v_since as is_new,
           coalesce(r.posts_observed, r.scanned_signal_count, 0) as items, 0 as comments,
           coalesce(r.useful_signal_count, 0) as demand, coalesce(r.last_successful_at, r.last_collected_at) as last_ok
      from public.source_registry r
     /* Telegram communities are counted from community_targets; a registry
        row that mirrors a target is not counted twice. */
     where not (r.platform::text = 'TELEGRAM' and exists (
             select 1 from public.community_targets t where t.source_registry_id = r.id or t.source_id = r.id
                or (t.platform = 'TELEGRAM' and t.external_id = r.external_id)))
  ), allsrc as (select * from tg union all select * from reg)
  select jsonb_build_object(
    'since', v_since,
    'platforms', coalesce((select jsonb_agg(p order by p ->> 'platform') from (
        select jsonb_build_object(
          'platform', platform,
          'discovered', count(*) filter (where discovered),
          'verified', count(*) filter (where verified),
          'active', count(*) filter (where active),
          'read', count(*) filter (where was_read),
          'inactive', count(*) filter (where discovered and not active),
          'blocked', count(*) filter (where blocked),
          'newInWindow', count(*) filter (where is_new),
          'itemsRead', sum(items), 'commentsRead', sum(comments), 'demandSignals', sum(demand),
          'lastRead', max(last_ok)) as p
          from allsrc group by platform) x), '[]'::jsonb),
    'directory', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'listed', n))
        from (select platform, count(*) n from public.community_directory group by platform) d), '[]'::jsonb),
    /* Telegram communities one by one: what the audit said and whether they are read. */
    'telegram', coalesce((select jsonb_agg(jsonb_build_object(
          'handle', t.external_id, 'name', t.name, 'lifecycle', t.lifecycle, 'readability', t.readability,
          'enabled', t.discovery_enabled, 'relevance', t.relevance_score, 'lastMessageAt', t.last_message_at,
          'auditReason', t.metadata -> 'audit' ->> 'reason', 'discoveredQuery', t.metadata ->> 'discovered_query',
          'itemsRead', t.items_read, 'demandFound', t.demand_found, 'lastSuccessAt', t.last_success_at,
          'lastError', t.last_error_code, 'createdAt', t.created_at)
          order by t.discovery_enabled desc, t.lifecycle, t.relevance_score desc nulls last)
        from (select * from public.community_targets where platform = 'TELEGRAM' order by created_at desc limit 300) t), '[]'::jsonb),
    /* What each recent campaign's discovery stage did (TELEGRAM_SOURCES jobs). */
    'campaigns', coalesce((select jsonb_agg(c order by c ->> 'at' desc) from (
        select jsonb_build_object(
          'jobId', q.matching_job_id, 'at', q.created_at, 'status', q.status,
          'communitiesFound', coalesce((q.metadata -> 'last_outcome' ->> 'communitiesFound')::int, q.result_count),
          'newlyRegistered', coalesce((q.metadata -> 'last_outcome' ->> 'newlyRegistered')::int, q.result_count),
          'audited', (q.metadata -> 'last_outcome' ->> 'audited')::int,
          'verified', (q.metadata -> 'last_outcome' ->> 'verified')::int,
          'activated', (q.metadata -> 'last_outcome' ->> 'activated')::int,
          'readNow', (q.metadata -> 'last_outcome' ->> 'readNow')::int,
          'languages', q.metadata -> 'last_outcome' -> 'languagesSearched',
          'city', q.metadata ->> 'city', 'error', q.last_error) as c
          from public.discovery_query_queue q
         where q.provider = 'TELEGRAM_SOURCES' and q.matching_job_id is not null
         order by q.created_at desc limit 20) y), '[]'::jsonb),
    'memo23Discovered', (select count(*) from public.source_registry r where r.discovered_via like 'memo23:%'),
    'autoEnable', coalesce((select value from public.admin_settings where key = 'telegram_source_auto_enable'), 'false'::jsonb)
  ) into v;
  return v;
end;
$function$;
revoke all on function public.admin_find_buyers_source_network(integer) from public, anon;
grant execute on function public.admin_find_buyers_source_network(integer) to authenticated;
