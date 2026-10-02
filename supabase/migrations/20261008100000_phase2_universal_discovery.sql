-- PHASE 2 — UNIVERSAL DISCOVERY (additive).
--
-- docs/claude/PHASE2_DISCOVERY.md. Nothing here changes a Verify object, an
-- existing column's meaning, or an existing policy. New tables, new columns
-- with defaults, one widened status check, and new functions beside the old
-- ones (claim_discovery_source_jobs v1 stays as it is; the driver moves to v2).
--
--   discovery_search_plans     the stored DiscoveryPlan of every run, both directions
--   discovery_runs             a FIND PROPERTY run (matching_jobs needs a property)
--   discovery_run_events       its customer-safe progress
--   discovery_source_live_checks  bounded live checks of a source, per route
--   discovery_query_queue      + plan/run/tranche/executor/direction/dedupe_key, PAUSED
--   matching_jobs              + search_plan_id, paused_at, paused_remaining_seconds
--   claim_discovery_source_jobs_v2  fair claim: one job per run per pass, provider caps,
--                                   executor-aware, paused runs held (not cancelled)
--   discovery_control          pause / resume / stop, owner-checked, atomic
--
-- Retired providers stay retired: v2 claims only TELEGRAM, TELEGRAM_SOURCES,
-- FORUM and PORTAL (the native portal route), named here and refused again by
-- the executor.

------------------------------------------------------------------------------
-- 1. Plans
------------------------------------------------------------------------------
create table if not exists public.discovery_search_plans (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('SUPPLY', 'DEMAND')),
  user_id uuid not null references public.users(id) on delete cascade,
  matching_job_id uuid references public.matching_jobs(id) on delete cascade,
  discovery_run_id uuid,
  market text not null,
  plan jsonb not null,
  plan_version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists discovery_search_plans_job_idx on public.discovery_search_plans (matching_job_id);
create index if not exists discovery_search_plans_run_idx on public.discovery_search_plans (discovery_run_id);
create index if not exists discovery_search_plans_user_idx on public.discovery_search_plans (user_id, created_at desc);

alter table public.discovery_search_plans enable row level security;
revoke all on table public.discovery_search_plans from anon, authenticated;
grant select on table public.discovery_search_plans to authenticated;
drop policy if exists dsp_owner_select on public.discovery_search_plans;
create policy dsp_owner_select on public.discovery_search_plans
  for select to authenticated using (user_id = public.auth_user_id() or public.is_admin());

------------------------------------------------------------------------------
-- 2. FIND PROPERTY runs and their progress
------------------------------------------------------------------------------
create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null default 'SUPPLY' check (direction in ('SUPPLY')),
  subscription_id uuid references public.active_search_subscriptions(id) on delete set null,
  intent_profile_id uuid,
  search_plan_id uuid references public.discovery_search_plans(id) on delete set null,
  idempotency_key text not null,
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED')),
  stage text not null default 'UNDERSTANDING',
  progress integer not null default 0 check (progress between 0 and 100),
  billing_grant jsonb,
  deadline_at timestamptz,
  paused_at timestamptz,
  paused_remaining_seconds integer,
  results_found integer not null default 0,
  provider_cost_usd numeric,
  credits_charged numeric,
  failure_reason text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists discovery_runs_user_idx on public.discovery_runs (user_id, created_at desc);
create index if not exists discovery_runs_open_idx on public.discovery_runs (status, deadline_at)
  where status in ('QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING');

alter table public.discovery_runs enable row level security;
revoke all on table public.discovery_runs from anon, authenticated;
grant select on table public.discovery_runs to authenticated;
drop policy if exists dr_owner_select on public.discovery_runs;
create policy dr_owner_select on public.discovery_runs
  for select to authenticated using (user_id = public.auth_user_id() or public.is_admin());

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_search_plans_run_fkey') then
    alter table public.discovery_search_plans
      add constraint discovery_search_plans_run_fkey
      foreign key (discovery_run_id) references public.discovery_runs(id) on delete cascade;
  end if;
end $$;

create table if not exists public.discovery_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.discovery_runs(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists discovery_run_events_run_idx on public.discovery_run_events (run_id, id);

alter table public.discovery_run_events enable row level security;
revoke all on table public.discovery_run_events from anon, authenticated;
grant select on table public.discovery_run_events to authenticated;
drop policy if exists dre_owner_select on public.discovery_run_events;
create policy dre_owner_select on public.discovery_run_events
  for select to authenticated using (
    exists (select 1 from public.discovery_runs r
             where r.id = run_id and (r.user_id = public.auth_user_id() or public.is_admin())));

------------------------------------------------------------------------------
-- 3. Bounded live checks of a source (§64): timestamp, route, result, latency,
--    limitations. Written by the probe, read by admins.
------------------------------------------------------------------------------
create table if not exists public.discovery_source_live_checks (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  market text not null default 'GE',
  route text not null check (route in ('EDGE_HTTP', 'WORKER_HTTP', 'WORKER_BROWSER', 'TELEGRAM')),
  checked_at timestamptz not null default now(),
  http_status integer,
  ok boolean not null,
  latency_ms integer,
  collection_items integer,
  detail_ok boolean,
  normalized_ok boolean,
  limitation text,
  evidence jsonb not null default '{}'::jsonb
);
create index if not exists discovery_source_live_checks_idx
  on public.discovery_source_live_checks (source_key, checked_at desc);

alter table public.discovery_source_live_checks enable row level security;
revoke all on table public.discovery_source_live_checks from anon, authenticated;
grant select on table public.discovery_source_live_checks to authenticated;
drop policy if exists dslc_admin_select on public.discovery_source_live_checks;
create policy dslc_admin_select on public.discovery_source_live_checks
  for select to authenticated using (public.is_admin());

------------------------------------------------------------------------------
-- 4. Queue and campaign-job columns (additive; defaults keep old rows valid)
------------------------------------------------------------------------------
alter table public.discovery_query_queue
  add column if not exists search_plan_id uuid references public.discovery_search_plans(id) on delete set null,
  add column if not exists discovery_run_id uuid references public.discovery_runs(id) on delete cascade,
  add column if not exists tranche smallint,
  add column if not exists executor text not null default 'EDGE',
  add column if not exists search_direction text,
  add column if not exists dedupe_key text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'discovery_query_queue_executor_check') then
    alter table public.discovery_query_queue
      add constraint discovery_query_queue_executor_check check (executor in ('EDGE', 'WORKER'));
  end if;
end $$;

/* A FIND PROPERTY run has no property: its source jobs hang off the run. */
alter table public.discovery_query_queue alter column property_id drop not null;

create unique index if not exists discovery_query_queue_dedupe_key_uidx
  on public.discovery_query_queue (dedupe_key) where dedupe_key is not null;
create index if not exists discovery_query_queue_run_idx
  on public.discovery_query_queue (discovery_run_id) where discovery_run_id is not null;

/* PAUSED joins the status vocabulary: a paused run's jobs are held, never
   cancelled, so resume continues from durable progress. */
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.discovery_query_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%BUDGET_REACHED%' and pg_get_constraintdef(oid) not like '%PAUSED%';
  if v_name is not null then
    execute format('alter table public.discovery_query_queue drop constraint %I', v_name);
    alter table public.discovery_query_queue add constraint discovery_query_queue_status_check
      check (status = any (array['PENDING','PROCESSING','RETRY_WAIT','DONE','FAILED','CANCELLED','BUDGET_REACHED','PAUSED']));
  end if;
end $$;

alter table public.matching_jobs
  add column if not exists search_plan_id uuid references public.discovery_search_plans(id) on delete set null,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_remaining_seconds integer;

/* Provider concurrency caps for the claim. The Telegram gateway is one serial
   session, so one at a time; portals are polite at two. Operator-tunable. */
insert into public.admin_settings (key, value)
values ('discovery_provider_concurrency', '{"TELEGRAM":1,"TELEGRAM_SOURCES":1,"FORUM":1,"PORTAL":2}'::jsonb)
on conflict (key) do nothing;
insert into public.admin_settings (key, value) values ('find_property_discovery_enabled', 'false'::jsonb)
on conflict (key) do nothing;
insert into public.admin_settings (key, value) values ('discovery_worker_lease_enabled', 'false'::jsonb)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 5. Fair claim (v2)
------------------------------------------------------------------------------
create or replace function public.claim_discovery_source_jobs_v2(
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 4,
  p_executor text default 'EDGE',
  p_providers text[] default null
)
returns setof public.discovery_query_queue
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed text[] := array['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'];
  v_caps jsonb := coalesce((select value from public.admin_settings where key = 'discovery_provider_concurrency'), '{}'::jsonb);
  v_executor text := upper(coalesce(p_executor, 'EDGE'));
begin
  if p_providers is not null then
    v_allowed := array(select upper(x) from unnest(p_providers) x where upper(x) = any (v_allowed));
  end if;

  /* Jobs whose run ENDED are cancelled (their money is settled or released).
     A PAUSED run is not ended: its jobs stay PAUSED until resume. */
  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'CAMPAIGN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.matching_jobs j
   where j.id = q.matching_job_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and j.status::text in ('completed','partially_completed','failed','cancelled','budget_reached');

  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'RUN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.discovery_runs r
   where r.id = q.discovery_run_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and r.status in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED');

  /* Expired leases: back to RETRY_WAIT with backoff, or FAILED at the limit. */
  update public.discovery_query_queue q
     set status = case when q.attempts >= p_max_attempts then 'FAILED' else 'RETRY_WAIT' end,
         last_error = 'LEASE_EXPIRED: the worker holding this job stopped before finishing',
         next_attempt_at = now() + make_interval(secs => least(600, 30 * power(2, greatest(q.attempts - 1, 0)))),
         finished_at = case when q.attempts >= p_max_attempts then now() else q.finished_at end,
         lease_expires_at = null, claim_token = null
   where q.status = 'PROCESSING'
     and q.lease_expires_at is not null and q.lease_expires_at < now()
     and upper(coalesce(q.provider, '')) in ('TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL');

  return query
  with busy as (
    select upper(q.provider) as provider, count(*) as n
      from public.discovery_query_queue q
     where q.status = 'PROCESSING'
     group by 1
  ),
  runnable as (
    select q.id, q.priority, q.created_at, upper(q.provider) as provider,
           coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key
      from public.discovery_query_queue q
      left join public.matching_jobs j on j.id = q.matching_job_id
      left join public.discovery_runs r on r.id = q.discovery_run_id
     where q.status in ('PENDING', 'RETRY_WAIT')
       and coalesce(q.next_attempt_at, now()) <= now()
       and q.executor = v_executor
       and upper(coalesce(q.provider, '')) = any (v_allowed)
       and (j.id is null or j.status::text = 'searching_sources')
       and (r.id is null or r.status = 'SEARCHING')
       and coalesce(
             (select b.n from busy b where b.provider = upper(q.provider)), 0
           ) < coalesce((v_caps ->> upper(q.provider))::int, 1)
  ),
  last_claim as (
    select coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key, max(q.claimed_at) as at
      from public.discovery_query_queue q
     where q.claimed_at is not null and q.claimed_at > now() - interval '1 day'
     group by 1
  ),
  ranked as (
    /* One job per run per pass, runs served least-recently-claimed first: a
       large campaign cannot monopolise the queue. */
    select rn.id,
           row_number() over (partition by rn.run_key order by rn.priority desc, rn.created_at) as per_run,
           lc.at as run_last_claim, rn.priority, rn.created_at
      from runnable rn
      left join last_claim lc on lc.run_key = rn.run_key
  ),
  candidates as (
    select id from ranked
     where per_run = 1
     order by run_last_claim asc nulls first, priority desc, created_at asc
     limit greatest(1, least(p_limit, 25)) * 4
  ),
  picked as (
    select q.id
      from public.discovery_query_queue q
     where q.id in (select id from candidates)
       and q.status in ('PENDING', 'RETRY_WAIT')
     for update of q skip locked
     limit greatest(1, least(p_limit, 25))
  )
  update public.discovery_query_queue q
     set status = 'PROCESSING',
         claimed_at = now(),
         claim_token = gen_random_uuid(),
         started_at = coalesce(q.started_at, now()),
         attempts = coalesce(q.attempts, 0) + 1,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800)))
    from picked
   where q.id = picked.id
  returning q.*;
end;
$function$;

revoke all on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) to service_role;

------------------------------------------------------------------------------
-- 6. Pause / resume / stop — owner-checked, atomic, for both run kinds.
--
-- pause   SEARCHING -> PAUSED. Open source jobs are held as PAUSED (a job
--         already PROCESSING finishes under its lease). The remaining search
--         window is remembered.
-- resume  PAUSED -> SEARCHING. Held jobs return to PENDING; the window
--         restarts with what was left (at least a minute).
-- stop    SEARCHING/PAUSED -> SEARCHING with the window closed now, open
--         jobs CANCELLED. The driver then finishes the run with what arrived
--         and settles only for what was delivered.
------------------------------------------------------------------------------
create or replace function public.discovery_control(
  p_kind text,
  p_id uuid,
  p_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text := upper(coalesce(p_kind, ''));
  v_action text := lower(coalesce(p_action, ''));
  v_status text;
  v_deadline timestamptz;
  v_remaining integer;
  v_owner uuid;
  v_jobs integer := 0;
begin
  if v_action not in ('pause', 'resume', 'stop') then
    return jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  end if;

  if v_kind = 'MATCHING_JOB' then
    select status::text, discovery_deadline_at, paused_remaining_seconds, user_id
      into v_status, v_deadline, v_remaining, v_owner
      from public.matching_jobs where id = p_id for update;
  elsif v_kind = 'DISCOVERY_RUN' then
    select status, deadline_at, paused_remaining_seconds, user_id
      into v_status, v_deadline, v_remaining, v_owner
      from public.discovery_runs where id = p_id for update;
  else
    return jsonb_build_object('ok', false, 'error', 'BAD_KIND');
  end if;

  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if p_user_id is null or v_owner <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_status := lower(v_status);

  if v_action = 'pause' then
    if v_status not in ('searching_sources', 'searching') then
      return jsonb_build_object('ok', false, 'error', 'NOT_RUNNING', 'status', v_status);
    end if;
    v_remaining := greatest(0, extract(epoch from (coalesce(v_deadline, now()) - now()))::int);
    if v_kind = 'MATCHING_JOB' then
      update public.matching_jobs
         set status = 'paused', paused_at = now(), paused_remaining_seconds = v_remaining,
             current_step = 'Paused by you', updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PAUSED'
       where matching_job_id = p_id and status in ('PENDING', 'RETRY_WAIT');
    else
      update public.discovery_runs
         set status = 'PAUSED', stage = 'PAUSED', paused_at = now(), paused_remaining_seconds = v_remaining, updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PAUSED'
       where discovery_run_id = p_id and status in ('PENDING', 'RETRY_WAIT');
    end if;
    get diagnostics v_jobs = row_count;
    return jsonb_build_object('ok', true, 'status', 'paused', 'heldJobs', v_jobs, 'remainingSeconds', v_remaining);
  end if;

  if v_action = 'resume' then
    if v_status <> 'paused' then
      return jsonb_build_object('ok', false, 'error', 'NOT_PAUSED', 'status', v_status);
    end if;
    v_deadline := now() + make_interval(secs => greatest(60, coalesce(v_remaining, 0)));
    if v_kind = 'MATCHING_JOB' then
      update public.matching_jobs
         set status = 'searching_sources', discovery_deadline_at = v_deadline, paused_at = null,
             paused_remaining_seconds = null, current_step = 'Searching sources', updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PENDING', next_attempt_at = now()
       where matching_job_id = p_id and status = 'PAUSED';
    else
      update public.discovery_runs
         set status = 'SEARCHING', stage = 'SEARCHING_SOURCES', deadline_at = v_deadline, paused_at = null,
             paused_remaining_seconds = null, updated_at = now()
       where id = p_id;
      update public.discovery_query_queue set status = 'PENDING', next_attempt_at = now()
       where discovery_run_id = p_id and status = 'PAUSED';
    end if;
    get diagnostics v_jobs = row_count;
    return jsonb_build_object('ok', true, 'status', 'searching', 'resumedJobs', v_jobs, 'deadline', v_deadline);
  end if;

  /* stop */
  if v_status not in ('searching_sources', 'searching', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'NOT_RUNNING', 'status', v_status);
  end if;
  if v_kind = 'MATCHING_JOB' then
    update public.matching_jobs
       set status = 'searching_sources', discovery_deadline_at = now(), paused_at = null,
           paused_remaining_seconds = null, current_step = 'Stopping: finishing with what arrived', updated_at = now()
     where id = p_id;
    update public.discovery_query_queue
       set status = 'CANCELLED', cancel_reason = 'STOPPED_BY_CUSTOMER', finished_at = now()
     where matching_job_id = p_id and status in ('PENDING', 'RETRY_WAIT', 'PAUSED');
  else
    update public.discovery_runs
       set status = 'SEARCHING', deadline_at = now(), paused_at = null, paused_remaining_seconds = null, updated_at = now()
     where id = p_id;
    update public.discovery_query_queue
       set status = 'CANCELLED', cancel_reason = 'STOPPED_BY_CUSTOMER', finished_at = now()
     where discovery_run_id = p_id and status in ('PENDING', 'RETRY_WAIT', 'PAUSED');
  end if;
  get diagnostics v_jobs = row_count;
  return jsonb_build_object('ok', true, 'status', 'stopping', 'cancelledJobs', v_jobs);
end;
$function$;

revoke all on function public.discovery_control(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.discovery_control(text, uuid, uuid, text) to service_role;

------------------------------------------------------------------------------
-- 7. FIND PROPERTY can deliver an EXTERNAL listing to a customer's own search.
--
-- supply_matches allowed two shapes: INTERNAL_HOMATCH (a plan × a HOMATCH
-- property) and EXTERNAL_INTELLIGENCE (an external demand signal × an external
-- listing). A customer's confirmed plan × an external listing fit neither, so
-- no external listing had ever reached a Find Property search (production
-- 2026-10-02: 72 rows, all EXTERNAL_INTELLIGENCE). The third shape:
--
--   EXTERNAL_LISTING  intent_profile (the plan) × supply_observation; no signal,
--                     no HOMATCH property.
--
-- Keyed by (intent_profile_id, observation_id): unique across every row today
-- (checked: 0 duplicate pairs), non-partial so the upsert can name it.
------------------------------------------------------------------------------
alter table public.supply_matches drop constraint if exists supply_matches_one_supply_kind;
alter table public.supply_matches
  add constraint supply_matches_one_supply_kind
  check (
    (source_kind = 'INTERNAL_HOMATCH'
      and property_id is not null and signal_id is null and observation_id is null)
    or
    (source_kind = 'EXTERNAL_INTELLIGENCE'
      and property_id is null and signal_id is not null and observation_id is not null)
    or
    (source_kind = 'EXTERNAL_LISTING'
      and property_id is null and signal_id is null and observation_id is not null
      and intent_profile_id is not null)
  )
  not valid;

create unique index if not exists supply_matches_profile_observation_key
  on public.supply_matches (intent_profile_id, observation_id);

------------------------------------------------------------------------------
-- 8. FIND_PROPERTY — PAYG exactly like FIND_CLIENTS (owner decision
--    2026-10-02): the same retail, reference COGS, margin floor and 50-credit
--    minimum; no plan includes a run. Copied, not invented.
------------------------------------------------------------------------------
insert into public.billable_products (
  code, name, config, enabled, sort_order, kill_switch, billing_mode, pricing_active, pricing_version,
  estimate_strategy, min_gross_margin_bps, requires_reservation, standard_retail_cents,
  min_viable_budget_credits, reference_landed_cogs_cents)
select 'FIND_PROPERTY', 'Find Property', config || jsonb_build_object('priced_like', 'FIND_CLIENTS'),
       enabled, 3, kill_switch, billing_mode, pricing_active, pricing_version,
       estimate_strategy, min_gross_margin_bps, requires_reservation, standard_retail_cents,
       min_viable_budget_credits, reference_landed_cogs_cents
  from public.billable_products where code = 'FIND_CLIENTS'
on conflict (code) do nothing;

insert into public.product_plan_entitlements
select (jsonb_populate_record(null::public.product_plan_entitlements,
          to_jsonb(e) || jsonb_build_object('product_code', 'FIND_PROPERTY', 'included_per_period', 0))).*
  from public.product_plan_entitlements e
 where e.product_code = 'FIND_CLIENTS'
on conflict do nothing;

------------------------------------------------------------------------------
-- 9. The driver also wakes for paused campaigns and FIND PROPERTY runs, so a
--    pause can be expired honestly and a run is never stranded with a held
--    reservation when a switch is turned off. Same function, same token.
------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron absent (fixture); driver schedule unchanged';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'homatch-discovery-driver') then
    perform cron.unschedule('homatch-discovery-driver');
  end if;
  perform cron.schedule(
    'homatch-discovery-driver',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/discovery-queue-worker',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'discovery_driver_token')),
      body := '{"mode":"drive","source":"cron"}'::jsonb,
      timeout_milliseconds := 55000
    )
    where ((select value #>> '{}' from public.admin_settings where key = 'campaign_source_discovery_enabled') = 'true'
       or (select value #>> '{}' from public.admin_settings where key = 'find_property_discovery_enabled') = 'true'
       or exists (select 1 from public.matching_jobs where discovery_deadline_at is not null
                   and status::text in ('searching_sources','classifying','ranking','paused'))
       or exists (select 1 from public.discovery_runs where status in ('SEARCHING','PAUSED','MATCHING')));
    $cron$
  );
end $$;
