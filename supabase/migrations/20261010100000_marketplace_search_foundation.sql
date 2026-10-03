-- MARKETPLACE SEARCH FOUNDATION (additive; prepared for review, NOT applied).
--
-- The rebuilt Find Property: a free Marketplace Search fanned out to N
-- independent marketplace workers, processed deterministically into canonical
-- properties. No real worker exists yet; this is the foundation they plug into.
--
--   discovery_search_plans          EXTENDED: plan_kind DISCOVERY | MARKETPLACE
--   discovery_marketplace_workers   the worker registry (a row is never a running worker)
--   discovery_marketplace_searches  one customer search and its lifecycle
--   discovery_marketplace_worker_runs   one worker's part of one search
--   discovery_marketplace_listings  raw worker candidates (source truth) + normalised copy
--   discovery_marketplace_properties    the processed, ranked canonical properties of a search
--   claim_marketplace_worker_runs() concurrent, bounded leasing to an authenticated worker (service role)
--   admin_marketplace_search_intelligence()  admin-only observability
--   admin_settings.marketplace_search_enabled  seeded OFF
--
-- WHY NEW TABLES AND NOT discovery_runs: discovery_runs is the billed,
-- queue-driven run (billing_grant, settlement, the driver advances it by
-- status). A free marketplace search sharing it would be one status value away
-- from being advanced and settled by that driver. The plan itself IS shared:
-- discovery_search_plans gains a kind. Raw worker candidates are kept per
-- search (they are evidence of what one search saw); canonical properties link
-- to supply_entities for later promotion and never replace it.
--
-- ACCESS: every new table is service-role only for writes and admin-only for
-- reads. Customers read through the marketplace-search edge function, which
-- enforces ownership and strips internal ranking/cost data. Workers write only
-- through marketplace-worker-ingest with their own registry token; they never
-- hold a service-role key.
--
-- Append-only. The runner owns the transaction. Idempotent: safe to apply twice.

-------------------------------------------------------------------------------
-- 1. discovery_search_plans: a plan kind
-------------------------------------------------------------------------------
alter table public.discovery_search_plans
  add column if not exists plan_kind text not null default 'DISCOVERY';

do $$ begin
  alter table public.discovery_search_plans
    add constraint discovery_search_plans_kind_check check (plan_kind in ('DISCOVERY', 'MARKETPLACE'));
exception when duplicate_object then null; end $$;

-------------------------------------------------------------------------------
-- 2. Worker registry
-------------------------------------------------------------------------------
create table if not exists public.discovery_marketplace_workers (
  worker_id            text primary key check (worker_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  source_key           text not null,
  source_name          text not null,
  source_type          text not null default 'MARKETPLACE'
                         check (source_type in ('MARKETPLACE', 'AGENCY', 'DEVELOPER', 'AGGREGATOR')),
  execution_mode       text not null check (execution_mode in ('BROWSER', 'HTTP', 'API')),
  supported_markets    text[] not null default '{}',
  supported_languages  text[] not null default '{}',
  supported_property_types    text[] not null default '{}',
  supported_transaction_types text[] not null default '{}',
  supported_filters    text[] not null default '{}',
  timeout_ms           integer not null default 120000 check (timeout_ms between 1000 and 900000),
  max_results          integer not null default 200 check (max_results between 1 and 2000),
  /* Per-provider bound: live leases this worker may hold at once (dispatch.ts). */
  max_concurrency      integer not null default 2 check (max_concurrency between 1 and 50),
  /* Retry budget per run: an expired lease or a retryable failure is re-queued until this. */
  max_attempts         integer not null default 3 check (max_attempts between 1 and 10),
  state                text not null default 'REGISTERED'
                         check (state in ('REGISTERED', 'TESTING', 'PROVEN', 'ACTIVE', 'DISABLED', 'BLOCKED')),
  enabled              boolean not null default false,
  health               jsonb not null default '{"status":"UNKNOWN","checkedAt":null}'::jsonb,
  /* sha256 hex of the worker's ingestion token; the token itself is never stored. */
  token_hash           text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  proven_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  /* Only a proven worker can be switched on. */
  constraint discovery_marketplace_workers_enabled_requires_active check (not enabled or state = 'ACTIVE')
);

-------------------------------------------------------------------------------
-- 3. Searches
-------------------------------------------------------------------------------
create table if not exists public.discovery_marketplace_searches (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  search_plan_id       uuid references public.discovery_search_plans(id) on delete set null,
  idempotency_key      text not null check (length(idempotency_key) between 8 and 120),
  status               text not null default 'CREATED'
                         check (status in ('CREATED', 'READY', 'DISPATCHING', 'SEARCHING', 'PROCESSING',
                                           'RESULTS_AVAILABLE', 'COMPLETE', 'PARTIAL_COMPLETE', 'FAILED', 'CANCELLED')),
  brief                jsonb not null,
  request              jsonb not null,
  failure_reason       text,
  workers_total        integer not null default 0,
  workers_terminal     integer not null default 0,
  properties_count     integer not null default 0,
  strong_matches       integer not null default 0,
  stats                jsonb not null default '{}'::jsonb,
  ai_status            text not null default 'NOT_STARTED'
                         check (ai_status in ('NOT_STARTED', 'DONE', 'SKIPPED', 'FAILED')),
  telemetry            jsonb not null default '{"ai":[],"workers":[],"processingMs":[]}'::jsonb,
  deadline_at          timestamptz,
  results_available_at timestamptz,
  processed_at         timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists discovery_marketplace_searches_user_idx
  on public.discovery_marketplace_searches (user_id, created_at desc);
create index if not exists discovery_marketplace_searches_open_idx
  on public.discovery_marketplace_searches (status, deadline_at)
  where status in ('CREATED', 'READY', 'DISPATCHING', 'SEARCHING', 'PROCESSING', 'RESULTS_AVAILABLE');

-------------------------------------------------------------------------------
-- 4. Worker runs: one worker's part of one search
-------------------------------------------------------------------------------
create table if not exists public.discovery_marketplace_worker_runs (
  id                   uuid primary key default gen_random_uuid(),
  search_id            uuid not null references public.discovery_marketplace_searches(id) on delete cascade,
  worker_id            text not null references public.discovery_marketplace_workers(worker_id),
  status               text not null default 'QUEUED'
                         check (status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING',
                                           'COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED')),
  request              jsonb not null,
  query_applied        jsonb not null default '{}'::jsonb,
  discovered_count     integer not null default 0,
  returned_count       integer not null default 0,
  rejected_count       integer not null default 0,
  errors               jsonb not null default '[]'::jsonb,
  metrics              jsonb not null default '{}'::jsonb,
  attempts             integer not null default 0,
  claimed_at           timestamptz,
  /* Independent lease per run: extended by every report/heartbeat, reaped when it lapses. */
  lease_expires_at     timestamptz,
  last_heartbeat_at    timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  deadline_at          timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (search_id, worker_id)
);
create index if not exists discovery_marketplace_worker_runs_inflight_idx
  on public.discovery_marketplace_worker_runs (worker_id, lease_expires_at)
  where status in ('SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING');
create index if not exists discovery_marketplace_worker_runs_claim_idx
  on public.discovery_marketplace_worker_runs (worker_id, status, created_at)
  where status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED');

-------------------------------------------------------------------------------
-- 5. Listings: raw candidate (source truth) + normalised copy
-------------------------------------------------------------------------------
create table if not exists public.discovery_marketplace_listings (
  id                   uuid primary key default gen_random_uuid(),
  search_id            uuid not null references public.discovery_marketplace_searches(id) on delete cascade,
  worker_run_id        uuid not null references public.discovery_marketplace_worker_runs(id) on delete cascade,
  source_key           text not null,
  source_listing_id    text not null,
  exact_url            text not null check (exact_url ~ '^https?://'),
  raw                  jsonb not null,
  observed_at          timestamptz not null,
  /* Set when the listing is promoted into supply_observations later; never by this foundation. */
  observation_id       uuid references public.supply_observations(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (search_id, source_key, source_listing_id)
);
create index if not exists discovery_marketplace_listings_search_idx
  on public.discovery_marketplace_listings (search_id, created_at);

-------------------------------------------------------------------------------
-- 6. Processed canonical properties of a search
-------------------------------------------------------------------------------
create table if not exists public.discovery_marketplace_properties (
  id                   uuid primary key default gen_random_uuid(),
  search_id            uuid not null references public.discovery_marketplace_searches(id) on delete cascade,
  property_key         text not null,
  result_group         text not null check (result_group in ('BEST', 'OWNER', 'UPGRADE', 'MORE')),
  rank                 integer not null check (rank >= 1),
  score                numeric(6, 3) not null,
  /* What a customer may see (pipeline publicView). */
  view                 jsonb not null,
  /* Ranking components, resolution and seller evidence: admin only. */
  internal             jsonb not null default '{}'::jsonb,
  entity_id            uuid references public.supply_entities(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (search_id, property_key)
);
create index if not exists discovery_marketplace_properties_page_idx
  on public.discovery_marketplace_properties (search_id, result_group, rank);

-------------------------------------------------------------------------------
-- 7. Access: service role writes, admins read, customers via the edge function
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['discovery_marketplace_workers', 'discovery_marketplace_searches',
    'discovery_marketplace_worker_runs', 'discovery_marketplace_listings', 'discovery_marketplace_properties']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_select', t);
  end loop;
end $$;

/* The token hash is never readable by anyone but the service role, admins included. */
revoke select on public.discovery_marketplace_workers from authenticated;
grant select (worker_id, source_key, source_name, source_type, execution_mode, supported_markets, supported_languages,
              supported_property_types, supported_transaction_types, supported_filters, timeout_ms, max_results,
              state, enabled, health, proven_at, created_at, updated_at)
  on public.discovery_marketplace_workers to authenticated;

-------------------------------------------------------------------------------
-- 8. Leasing work (called by marketplace-worker-ingest only)
--
-- Concurrent by construction: every eligible worker has its own QUEUED runs and
-- claims them independently; no run waits for another worker. Bounded: a claim
-- takes at most min(requested, worker max_concurrency - its live leases,
-- global limit - all live leases). The advisory lock makes the two counts and
-- the claim one atomic step, so parallel claims can never exceed the bounds.
-------------------------------------------------------------------------------
drop function if exists public.claim_marketplace_worker_runs(text, integer);
create or replace function public.claim_marketplace_worker_runs(
  p_worker_id text, p_limit integer default 5, p_lease_seconds integer default 120)
returns setof public.discovery_marketplace_worker_runs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_worker public.discovery_marketplace_workers%rowtype;
  v_global integer;
  v_global_live integer;
  v_worker_live integer;
  v_slots integer;
  v_lease integer := greatest(15, least(coalesce(p_lease_seconds, 120), 900));
begin
  /* A worker that is not ACTIVE and enabled gets nothing, whatever it asks for. */
  select * into v_worker from public.discovery_marketplace_workers w
   where w.worker_id = p_worker_id and w.state = 'ACTIVE' and w.enabled;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('discovery_marketplace_claim'));

  v_global := coalesce((select nullif(value #>> '{}', '')::integer from public.admin_settings
                         where key = 'marketplace_max_concurrent_runs'), 40);
  select count(*) filter (where true), count(*) filter (where r.worker_id = p_worker_id)
    into v_global_live, v_worker_live
    from public.discovery_marketplace_worker_runs r
   where r.status in ('SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING') and r.lease_expires_at > now();

  v_slots := least(greatest(1, least(coalesce(p_limit, 5), 20)),
                   v_worker.max_concurrency - v_worker_live,
                   greatest(1, v_global) - v_global_live);
  if v_slots <= 0 then
    return;
  end if;

  return query
  update public.discovery_marketplace_worker_runs r
     set status = 'SEARCHING', claimed_at = now(), started_at = coalesce(r.started_at, now()),
         lease_expires_at = least(now() + make_interval(secs => v_lease), r.deadline_at),
         last_heartbeat_at = now(), attempts = r.attempts + 1, updated_at = now()
   where r.id in (
     select q.id from public.discovery_marketplace_worker_runs q
       join public.discovery_marketplace_searches s on s.id = q.search_id
      where q.worker_id = p_worker_id and q.status = 'QUEUED' and q.deadline_at > now()
        and q.attempts < v_worker.max_attempts
        and s.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE')
      order by q.created_at
      limit v_slots
      for update of q skip locked)
  returning r.*;
end;
$function$;

revoke all on function public.claim_marketplace_worker_runs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_marketplace_worker_runs(text, integer, integer) to service_role;

-------------------------------------------------------------------------------
-- 9. Admin observability (read-only, admin-only; no listing text, no contacts, no tokens)
-------------------------------------------------------------------------------
create or replace function public.admin_marketplace_search_intelligence(p_search_id uuid default null)
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

  if p_search_id is null then
    select jsonb_build_object(
      'generated_at', now(),
      'enabled', coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'marketplace_search_enabled'), false),
      'workers', coalesce((
        select jsonb_agg(jsonb_build_object('worker_id', w.worker_id, 'source_key', w.source_key, 'state', w.state,
                 'enabled', w.enabled, 'execution_mode', w.execution_mode, 'health', w.health) order by w.worker_id)
          from public.discovery_marketplace_workers w), '[]'::jsonb),
      'searches', coalesce((
        select jsonb_agg(s order by s.created_at desc) from (
          select m.id, m.user_id, m.status, m.failure_reason, m.workers_total, m.workers_terminal, m.properties_count,
                 m.strong_matches, m.ai_status, m.created_at, m.completed_at,
                 m.telemetry -> 'ai' as ai, m.stats
            from public.discovery_marketplace_searches m
           order by m.created_at desc limit 25) s), '[]'::jsonb)
    ) into v;
    return v;
  end if;

  select jsonb_build_object(
    'search', (select jsonb_build_object('id', m.id, 'status', m.status, 'failure_reason', m.failure_reason,
                 'request', m.request, 'brief_readiness', m.brief -> 'readiness', 'stats', m.stats, 'ai_status', m.ai_status,
                 'telemetry', m.telemetry, 'created_at', m.created_at, 'results_available_at', m.results_available_at,
                 'processed_at', m.processed_at, 'completed_at', m.completed_at)
                 from public.discovery_marketplace_searches m where m.id = p_search_id),
    'plan', (select p.plan from public.discovery_search_plans p
              join public.discovery_marketplace_searches m on m.search_plan_id = p.id where m.id = p_search_id),
    'worker_runs', coalesce((
      select jsonb_agg(jsonb_build_object('worker_id', r.worker_id, 'status', r.status, 'discovered', r.discovered_count,
               'returned', r.returned_count, 'rejected', r.rejected_count, 'errors', r.errors, 'metrics', r.metrics,
               'started_at', r.started_at, 'completed_at', r.completed_at,
               'latency_ms', (extract(epoch from (coalesce(r.completed_at, now()) - coalesce(r.started_at, r.created_at))) * 1000)::bigint)
               order by r.worker_id)
        from public.discovery_marketplace_worker_runs r where r.search_id = p_search_id), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.property_key, 'group', p.result_group, 'rank', p.rank, 'score', p.score,
               'internal', p.internal, 'source_count', p.view -> 'sourceCount', 'seller', p.view -> 'seller',
               'price_discrepancy', p.view -> 'priceDiscrepancy') order by p.result_group, p.rank)
        from public.discovery_marketplace_properties p where p.search_id = p_search_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

revoke all on function public.admin_marketplace_search_intelligence(uuid) from public, anon;
grant execute on function public.admin_marketplace_search_intelligence(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 10. The switch, seeded OFF
-------------------------------------------------------------------------------
insert into public.admin_settings (key, value, description)
values ('marketplace_search_enabled', 'false'::jsonb,
        'Marketplace Search (free, worker fan-out). OFF until a worker is proven and the owner enables it.')
on conflict (key) do nothing;

insert into public.admin_settings (key, value, description)
values ('marketplace_max_concurrent_runs', '40'::jsonb,
        'Global bound on live marketplace worker leases across all workers (per-worker bound: discovery_marketplace_workers.max_concurrency).')
on conflict (key) do nothing;
