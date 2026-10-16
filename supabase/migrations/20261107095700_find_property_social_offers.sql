-- Find Property — paid social OFFER campaign (Facebook / Instagram / Telegram / VK).
--
-- Owner scope (2026-10-16, third Apify scope): Find Property may run memo23 Actors,
-- only through _shared/findBuyers/memo23Client.ts, to find property offers people
-- posted for one buyer's or tenant's confirmed search. Its own switch
-- find_property_social_enabled (default FALSE) and Admin → Providers' APIFY switch
-- (provider_disabled_list) both stop every run, here, server-side, before money moves.
--
-- Money: the 37/63 paid discovery policy. The campaign's provider budget is 63% of
-- the price the customer authorised (discovery_runs.provider_budget_micros); every
-- Actor run is reserved against it here (committed + estimate <= budget) and capped at
-- Apify by maxTotalChargeUsd = its reservation. Settlement charges consumed / 0.63,
-- capped by the wallet reservation (edge: findPropertySettlement + paidDiscoveryPolicy).
-- A run whose cost is unknown counts at its reservation — never as zero.
--
-- Additive: new columns (nullable), a new table, new service-role functions, two
-- settings (OFF), one inactive source_registry row for keyword-search results.
-- Rollback: leave find_property_social_enabled false; the objects are inert.

alter table public.discovery_runs
  add column if not exists pricing_policy text check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1')),
  add column if not exists credits_per_usd numeric,
  add column if not exists customer_value_micros bigint check (customer_value_micros is null or customer_value_micros >= 0),
  add column if not exists provider_budget_micros bigint check (provider_budget_micros is null or provider_budget_micros >= 0),
  add column if not exists offer_networks text[],
  add column if not exists offer_plan jsonb,
  add column if not exists offers_found integer not null default 0;
comment on column public.discovery_runs.provider_budget_micros is
  'Paid social offer campaign: hard ceiling on provider spend (63% of the authorised price, paid_discovery_37_63_v1).';

insert into public.admin_settings (key, value) values
  ('find_property_social_enabled', 'false'::jsonb),
  ('find_property_social_networks', '["FACEBOOK","INSTAGRAM","TELEGRAM","VK"]'::jsonb)
on conflict (key) do nothing;

/* Keyword-search results have no group of their own: one inactive registry row holds them. */
insert into public.source_registry (platform, source_type, name, url, external_id, country_code, active, lifecycle, access_state)
values ('FACEBOOK', 'SEARCH_RESULT', 'Facebook public post search (memo23, Find Property)',
        'https://www.facebook.com/search/posts/', 'homatch:fp-fb-post-search', 'GE', false, 'DISCOVERED', 'PUBLIC')
on conflict (platform, external_id) do nothing;

create table if not exists public.find_property_actor_runs (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  discovery_run_id uuid not null references public.discovery_runs(id) on delete cascade,
  queue_job_id     uuid,
  actor_key        text not null,
  actor_id         text not null,
  stage            text not null,
  network          text not null,
  source_id        uuid,
  requested_limit  integer not null check (requested_limit > 0),
  status           text not null default 'RESERVED'
                   check (status in ('RESERVED', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED_OUT', 'RELEASED')),
  reserved_micros  bigint not null check (reserved_micros >= 0),
  actual_micros    bigint check (actual_micros is null or actual_micros >= 0),
  cost_basis       text,
  provider_run_id  text unique,
  dataset_id       text,
  results_billed   integer,
  items_fetched    integer,
  offers_found     integer not null default 0,
  error            text,
  cost_booked_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.find_property_actor_runs is
  'memo23 Actor runs of paid Find Property social offer campaigns. Reserved against discovery_runs.provider_budget_micros; cost booked once into cost_events. Service role only.';
create index if not exists find_property_actor_runs_run_idx on public.find_property_actor_runs (discovery_run_id, status);
create index if not exists find_property_actor_runs_open_idx on public.find_property_actor_runs (created_at)
  where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null;
alter table public.find_property_actor_runs enable row level security;
revoke all on public.find_property_actor_runs from public, anon, authenticated;
grant select, insert, update on public.find_property_actor_runs to service_role;

/* What the campaign has committed: held reservations, booked actuals, and the reservation of a run whose cost is unknown. */
create or replace function public.find_property_committed_micros(p_run_id uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(case
           when status in ('RESERVED', 'STARTING', 'RUNNING') then reserved_micros
           when actual_micros is not null then actual_micros
           when status = 'RELEASED' then 0
           else reserved_micros end), 0)::bigint
    from public.find_property_actor_runs where discovery_run_id = p_run_id
$$;
revoke all on function public.find_property_committed_micros(uuid) from public, anon, authenticated;
grant execute on function public.find_property_committed_micros(uuid) to service_role;

create or replace function public.find_property_reserve_actor_run(
  p_run_id uuid, p_actor_key text, p_idempotency_key text, p_queue_job_id uuid,
  p_stage text, p_network text, p_source_id uuid, p_requested_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run public.discovery_runs%rowtype;
  v_a public.find_buyers_actor_registry%rowtype;
  v_existing public.find_property_actor_runs%rowtype;
  v_max_age int; v_limit int; v_estimate bigint; v_committed bigint;
  v_running int; v_global_cap int; v_global_running int; v_id uuid;
begin
  select * into v_run from public.discovery_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_RUN'); end if;
  perform 1 from public.find_buyers_actor_registry where actor_key = p_actor_key for update;

  select * into v_existing from public.find_property_actor_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.discovery_run_id <> p_run_id then return jsonb_build_object('ok', false, 'reason', 'IDEMPOTENCY_KEY_REUSED'); end if;
    select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
    return jsonb_build_object('ok', true, 'replay', true, 'runId', v_existing.id, 'status', v_existing.status,
      'reservedMicros', v_existing.reserved_micros, 'requestedLimit', v_existing.requested_limit,
      'actorId', v_existing.actor_id, 'timeoutSeconds', v_a.timeout_seconds);
  end if;

  if v_run.status <> 'SEARCHING' then return jsonb_build_object('ok', false, 'reason', 'RUN_NOT_SEARCHING'); end if;
  if v_run.pricing_policy is distinct from 'paid_discovery_37_63_v1' or v_run.provider_budget_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_SOCIAL_CAMPAIGN');
  end if;
  if not coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_property_social_enabled'), false) then
    return jsonb_build_object('ok', false, 'reason', 'SOCIAL_DISABLED');
  end if;
  if coalesce((select case jsonb_typeof(value) when 'array' then value ? 'APIFY' when 'string' then upper(value #>> '{}') like '%"APIFY"%' else false end
                 from public.admin_settings where key = 'provider_disabled_list'), false) then
    return jsonb_build_object('ok', false, 'reason', 'APIFY_DISABLED_BY_ADMIN');
  end if;

  select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACTOR'); end if;
  if not v_a.enabled or v_a.emergency_disabled or v_a.health = 'DISABLED' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DISABLED');
  end if;
  select coalesce((select (value #>> '{}')::int from public.admin_settings where key = 'find_buyers_pricing_max_age_days'), 30) into v_max_age;
  if v_a.pricing_verified_at is null or v_a.pricing_verified_at < now() - make_interval(days => v_max_age)
     or v_a.pricing_model = 'UNKNOWN' or v_a.price_per_1k_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_VERIFIED');
  end if;

  v_limit := greatest(1, least(coalesce(p_requested_limit, v_a.probe_size), v_a.max_results));
  v_estimate := v_a.start_fee_micros + ceil(v_limit::numeric * v_a.price_per_1k_micros / 1000)::bigint;

  select count(*) into v_running from (
    select 1 from public.find_buyers_actor_runs where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING')
       and cost_booked_at is null and created_at > now() - interval '2 hours'
    union all
    select 1 from public.find_property_actor_runs where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING')
       and cost_booked_at is null and created_at > now() - interval '2 hours') x;
  if v_running >= v_a.concurrency then return jsonb_build_object('ok', false, 'reason', 'ACTOR_BUSY', 'retry', true); end if;

  /* The same global memo23 lane Find Buyers uses (same lock, both tables counted). */
  perform pg_advisory_xact_lock(hashtext('find_buyers:memo23_global_slots'));
  v_global_cap := greatest(1, coalesce((select (value ->> 'APIFY_MEMO23')::int from public.admin_settings where key = 'discovery_provider_concurrency'), 4));
  select count(*) into v_global_running from (
    select 1 from public.find_buyers_actor_runs where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null and created_at > now() - interval '2 hours'
    union all
    select 1 from public.find_property_actor_runs where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null and created_at > now() - interval '2 hours') x;
  if v_global_running >= v_global_cap then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_BUSY', 'retry', true, 'running', v_global_running, 'cap', v_global_cap);
  end if;

  v_committed := public.find_property_committed_micros(p_run_id);
  if v_committed + v_estimate > v_run.provider_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_BUDGET', 'committedMicros', v_committed,
                              'estimateMicros', v_estimate, 'budgetMicros', v_run.provider_budget_micros);
  end if;

  insert into public.find_property_actor_runs (idempotency_key, discovery_run_id, queue_job_id, actor_key, actor_id, stage, network,
    source_id, requested_limit, status, reserved_micros)
  values (p_idempotency_key, p_run_id, p_queue_job_id, v_a.actor_key, v_a.actor_id, p_stage, p_network, p_source_id, v_limit, 'RESERVED', v_estimate)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'runId', v_id, 'requestedLimit', v_limit, 'reservedMicros', v_estimate,
    'actorId', v_a.actor_id, 'timeoutSeconds', v_a.timeout_seconds, 'startFeeMicros', v_a.start_fee_micros,
    'pricePer1kMicros', v_a.price_per_1k_micros, 'inputContract', v_a.input_contract,
    'remainingMicros', v_run.provider_budget_micros - v_committed - v_estimate);
end $$;
revoke all on function public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer) to service_role;

/* Book a run's cost exactly once (cost_events + the run's provider total). */
create or replace function public.find_property_book_actor_cost(
  p_actor_run_id uuid, p_status text, p_actual_micros bigint, p_cost_basis text,
  p_results_billed integer, p_items_fetched integer, p_offers integer, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.find_property_actor_runs%rowtype; v_micros bigint;
begin
  select * into v_r from public.find_property_actor_runs where id = p_actor_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_RUN'); end if;
  if v_r.cost_booked_at is not null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_status not in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED_OUT', 'RELEASED') then raise exception 'BAD_STATUS'; end if;
  /* RELEASED only for a run that never reached the provider. */
  if p_status = 'RELEASED' and (v_r.provider_run_id is not null or v_r.status in ('STARTING', 'RUNNING')) then
    raise exception 'RUN_MAY_HAVE_STARTED';
  end if;
  v_micros := case when p_status = 'RELEASED' then 0 else p_actual_micros end;
  update public.find_property_actor_runs
     set status = p_status, actual_micros = v_micros, cost_basis = coalesce(p_cost_basis, case when v_micros is null then 'UNKNOWN' end),
         results_billed = p_results_billed, items_fetched = p_items_fetched, offers_found = coalesce(p_offers, 0),
         error = left(p_error, 500), cost_booked_at = now(), updated_at = now()
   where id = p_actor_run_id;
  if p_status <> 'RELEASED' then
    insert into public.cost_events (provider, operation_type, source, request_id, units, cost_usd, success, pricing_state, timestamp)
    values ('APIFY_MEMO23', 'FIND_PROPERTY_ACTOR_RUN', 'find_property_social', v_r.discovery_run_id::text,
            coalesce(p_results_billed, 0), coalesce(v_micros, v_r.reserved_micros) / 1e6, p_status = 'SUCCEEDED',
            case when v_micros is null then 'UNPRICED' when p_cost_basis = 'PROVIDER_REPORTED' then 'ACTUAL' else 'ESTIMATED' end, now());
  end if;
  update public.discovery_runs
     set provider_cost_usd = public.find_property_committed_micros(v_r.discovery_run_id) / 1e6,
         offers_found = offers_found + coalesce(p_offers, 0), updated_at = now()
   where id = v_r.discovery_run_id;
  return jsonb_build_object('ok', true, 'bookedMicros', coalesce(v_micros, v_r.reserved_micros), 'unknownCost', v_micros is null);
end $$;
revoke all on function public.find_property_book_actor_cost(uuid, text, bigint, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.find_property_book_actor_cost(uuid, text, bigint, text, integer, integer, integer, text) to service_role;

/* The customer's own campaign, live: per-network progress, money held and used. Never another person's run. */
create or replace function public.my_find_property_campaign(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_run public.discovery_runs%rowtype;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_run from public.discovery_runs where id = p_run_id and user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', v_run.id, 'status', v_run.status, 'stage', v_run.stage, 'createdAt', v_run.created_at,
    'deadlineAt', v_run.deadline_at, 'completedAt', v_run.completed_at, 'failureReason', v_run.failure_reason,
    'networks', coalesce(to_jsonb(v_run.offer_networks), '[]'::jsonb), 'policy', v_run.pricing_policy,
    'creditsAuthorized', (v_run.billing_grant ->> 'authorizedMaxCredits')::numeric,
    'creditsCharged', v_run.credits_charged,
    /* Credits the work so far would cost (consumed / 0.63, up to the cent, never above the
       authorised price) — the customer's figure; provider dollars stay in Admin. */
    'creditsUsed', least(coalesce((v_run.billing_grant ->> 'authorizedMaxCredits')::numeric, 0),
      round(ceil(ceil(public.find_property_committed_micros(v_run.id) * 10000.0 / public.paid_discovery_provider_share_bps()) / 10000.0)
            * coalesce(v_run.credits_per_usd, 10) / 100.0, 2)),
    'offersFound', v_run.offers_found, 'resultsFound', v_run.results_found,
    'unavailable', coalesce(v_run.offer_plan -> 'unavailable', '[]'::jsonb),
    'skippedForBudget', coalesce((v_run.offer_plan ->> 'skippedForBudget')::int, 0),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('network', n, 'planned', planned, 'done', done, 'running', running,
                                 'failed', failed, 'budget', budget) order by n) from (
        select coalesce(q.metadata ->> 'network', q.provider) n,
               count(*) planned,
               count(*) filter (where q.status = 'DONE') done,
               count(*) filter (where q.status in ('PROCESSING', 'RETRY_WAIT', 'PENDING')) running,
               count(*) filter (where q.status = 'FAILED') failed,
               count(*) filter (where q.status = 'BUDGET_REACHED') budget
          from public.discovery_query_queue q where q.discovery_run_id = v_run.id group by 1) s), '[]'::jsonb));
end $$;
revoke all on function public.my_find_property_campaign(uuid) from public, anon;
grant execute on function public.my_find_property_campaign(uuid) to authenticated;

/* Admin → Discovery shows the new switch beside the others (same body as 20261009100100, one key added). */
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
       where key in ('find_property_discovery_enabled', 'find_property_social_enabled', 'discovery_worker_route_enabled',
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
