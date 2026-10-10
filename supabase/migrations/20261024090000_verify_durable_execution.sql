-- VERIFY DURABLE EXECUTION — tasks, leases, fencing, shared evidence, CAPTCHA ledger.
--
-- Why (2026-10-10 audit):
--   * The Railway worker kept every Verify job, its source steps and its
--     CAPTCHA accounting in process memory. A restart or deploy lost all of
--     it; replicas could not share work; every job held one Chromium even for
--     HTTP-only sources, behind a four-job in-memory queue.
--   * The customer's status poll and the cron driver could advance the same
--     research_jobs row at the same moment and start paid stages twice.
--   * Every start created a new job: a double submit ran the whole pipeline twice.
--   * 100 flats in one building meant 100 identical TAS reads.
--
-- What this adds (additive only; nothing existing is altered or dropped
-- except new nullable columns on research_jobs):
--   verify_tasks            one row per source stage of a Verify job, claimed
--                           atomically (FOR UPDATE SKIP LOCKED) under a lease
--                           with a fencing token; retried with backoff and
--                           jitter; dead-lettered after max_attempts.
--   verify_evidence_cache   evidence reusable across jobs at an explicit scope
--                           (PARCEL / UNIT / COMPANY), with provenance and a
--                           per-source freshness window. Single-flight: one
--                           producer per scope; concurrent jobs follow it.
--   verify_source_policy    per-source lane, freshness, sharing and a soft
--                           running cap (provider rate control).
--   verify_captcha_events   durable, idempotent CAPTCHA accounting.
--   research_jobs.client_request_id   idempotent start.
--   research_jobs.advance_lease_*     one advancer per job at a time.
--
-- Execution is at-least-once; business effects are exactly-once through the
-- fencing token (a stale lease holder cannot complete, fail or heartbeat) and
-- the unique (job_id, dedupe_key) / scope_key constraints.

-- ───────────────────────── source policy ─────────────────────────

create table if not exists public.verify_source_policy (
  source          text primary key,
  lane            text not null check (lane in ('HTTP','BROWSER')),
  scope_kind      text not null check (scope_kind in ('PARCEL','UNIT','COMPANY','NONE')),
  shareable       boolean not null default false,
  fresh_seconds   integer not null default 0 check (fresh_seconds >= 0),
  max_running     integer check (max_running is null or max_running > 0),
  max_attempts    integer not null default 4 check (max_attempts between 1 and 10),
  lease_seconds   integer not null default 180 check (lease_seconds between 30 and 3600),
  note            text,
  updated_at      timestamptz not null default now()
);

-- Freshness is per source, never a blanket rule. Ownership and mortgages
-- (Service 176 unit records) are reused only for a short window — a re-run of
-- the same flat minutes later — never across flats. Permits and court-free
-- municipal case files change slowly and are shared per parcel.
insert into public.verify_source_policy (source, lane, scope_kind, shareable, fresh_seconds, max_running, max_attempts, lease_seconds, note) values
  ('tas',     'HTTP',    'PARCEL',  true,  21600, 24, 3, 900, 'TAS API_FIRST case files: shared per resolved cadastral code for 6 h'),
  ('tas_legacy','BROWSER','PARCEL', true,  21600, 6,  3, 900, 'TAS browser workflow (fallback)'),
  ('TAS_MAP', 'BROWSER', 'PARCEL',  true,  21600, 8,  3, 600, 'MS map + NAPR popup: parcel facts, 6 h'),
  ('mygov',   'HTTP',    'UNIT',    true,  600,   16, 3, 600, 'Unit register (owner, mortgages): reused for 10 min, same flat only'),
  ('enreg',   'BROWSER', 'COMPANY', true,  86400, 6,  3, 600, 'Company registry extract: 24 h'),
  ('debtor',  'BROWSER', 'COMPANY', true,  21600, 6,  3, 300, 'Debtor registry: 6 h'),
  ('rstax',   'BROWSER', 'COMPANY', true,  86400, 4,  3, 600, 'RS taxpayer status: 24 h')
on conflict (source) do nothing;

alter table public.verify_source_policy enable row level security;
alter table public.verify_source_policy force row level security;
revoke all on public.verify_source_policy from public, anon, authenticated;
grant select, insert, update on public.verify_source_policy to service_role;

-- ───────────────────────── evidence cache ─────────────────────────

create table if not exists public.verify_evidence_cache (
  id                 uuid primary key default gen_random_uuid(),
  scope_key          text not null unique,
  source             text not null,
  scope_kind         text not null,
  result             jsonb not null,
  evidence_refs      jsonb not null default '[]'::jsonb,
  content_hash       text,
  fetched_at         timestamptz not null default now(),
  fresh_until        timestamptz not null,
  producing_task_id  uuid,
  producing_job_id   uuid,
  hit_count          integer not null default 0,
  last_hit_at        timestamptz,
  invalidated_at     timestamptz,
  invalidated_reason text
);
create index if not exists verify_evidence_cache_source_idx on public.verify_evidence_cache (source, fetched_at desc);

alter table public.verify_evidence_cache enable row level security;
alter table public.verify_evidence_cache force row level security;
revoke all on public.verify_evidence_cache from public, anon, authenticated;
grant select, insert, update, delete on public.verify_evidence_cache to service_role;

-- ───────────────────────── tasks ─────────────────────────

create table if not exists public.verify_tasks (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.research_jobs(id) on delete cascade,
  source            text not null,
  lane              text not null check (lane in ('HTTP','BROWSER')),
  dedupe_key        text not null,
  scope_key         text,
  input             jsonb not null default '{}'::jsonb,
  state             text not null default 'QUEUED'
                    check (state in ('QUEUED','RUNNING','WAITING_SHARED','SUCCEEDED','FAILED','DEAD','CANCELLED')),
  priority          integer not null default 100,
  attempts          integer not null default 0,
  max_attempts      integer not null default 4,
  run_after         timestamptz not null default now(),
  lease_owner       text,
  lease_expires_at  timestamptz,
  lease_seconds     integer not null default 180,
  fencing_token     bigint not null default 0,
  heartbeat_at      timestamptz,
  cancel_requested  boolean not null default false,
  shared_task_id    uuid references public.verify_tasks(id) on delete set null,
  cache_id          uuid references public.verify_evidence_cache(id) on delete set null,
  reused            text check (reused in ('CACHE','SHARED')),
  result            jsonb,
  evidence_refs     jsonb not null default '[]'::jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  unique (job_id, dedupe_key)
);

-- The claim path: QUEUED tasks of a lane, by priority then age.
create index if not exists verify_tasks_claim_idx on public.verify_tasks (lane, priority, run_after, created_at) where state = 'QUEUED';
-- Lease recovery and per-source running counts.
create index if not exists verify_tasks_running_idx on public.verify_tasks (lease_expires_at) where state = 'RUNNING';
create index if not exists verify_tasks_running_source_idx on public.verify_tasks (source) where state = 'RUNNING';
create index if not exists verify_tasks_job_idx on public.verify_tasks (job_id);
create index if not exists verify_tasks_followers_idx on public.verify_tasks (shared_task_id) where state = 'WAITING_SHARED';
-- SINGLE-FLIGHT: at most one live producer per scope.
create unique index if not exists verify_tasks_one_producer_per_scope
  on public.verify_tasks (scope_key) where scope_key is not null and state in ('QUEUED','RUNNING');

alter table public.verify_tasks enable row level security;
alter table public.verify_tasks force row level security;
revoke all on public.verify_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.verify_tasks to service_role;

-- ───────────────────────── CAPTCHA ledger ─────────────────────────

create table if not exists public.verify_captcha_events (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  task_id          uuid references public.verify_tasks(id) on delete set null,
  job_id           uuid references public.research_jobs(id) on delete set null,
  source           text not null,
  provider         text not null default '2captcha',
  kind             text,
  outcome          text not null,
  cost_usd         numeric(10,5) not null default 0,
  solve_ms         integer,
  error_code       text,
  created_at       timestamptz not null default now()
);
create index if not exists verify_captcha_events_day_idx on public.verify_captcha_events (created_at desc);
create index if not exists verify_captcha_events_job_idx on public.verify_captcha_events (job_id);

alter table public.verify_captcha_events enable row level security;
alter table public.verify_captcha_events force row level security;
revoke all on public.verify_captcha_events from public, anon, authenticated;
grant select, insert on public.verify_captcha_events to service_role;

-- ───────────────────────── research_jobs additions ─────────────────────────

alter table public.research_jobs add column if not exists client_request_id text;
alter table public.research_jobs add column if not exists advance_lease_until timestamptz;
alter table public.research_jobs add column if not exists advance_lease_token uuid;

-- Idempotent start: one job per (owner, client request id).
create unique index if not exists research_jobs_client_request_idx
  on public.research_jobs ((coalesce(user_id::text, anon_session_id::text)), client_request_id)
  where client_request_id is not null;

-- ───────────────────────── functions ─────────────────────────

-- Backoff with jitter: 15 s × 2^(attempt-1), capped at 10 min, ±50 %.
create or replace function public.verify_task_backoff(p_attempts integer)
returns interval
language sql volatile set search_path to ''
as $$
  select make_interval(secs => least(600, 15 * power(2, greatest(p_attempts - 1, 0)))::numeric * (0.5 + random()));
$$;

-- Compact public view of a task (bounded: result is passed through as stored;
-- the worker gateway caps what it stores).
create or replace function public.verify_task_json(t public.verify_tasks)
returns jsonb
language sql stable set search_path to ''
as $$
  select jsonb_build_object(
    'id', t.id, 'jobId', t.job_id, 'source', t.source, 'lane', t.lane, 'dedupeKey', t.dedupe_key,
    'scopeKey', t.scope_key, 'input', t.input, 'state', t.state, 'attempts', t.attempts,
    'maxAttempts', t.max_attempts, 'fencingToken', t.fencing_token, 'leaseSeconds', t.lease_seconds,
    'leaseExpiresAt', t.lease_expires_at, 'sharedTaskId', t.shared_task_id, 'reused', t.reused,
    'error', t.error, 'createdAt', t.created_at, 'startedAt', t.started_at, 'finishedAt', t.finished_at);
$$;

/*
 * ENQUEUE — idempotent per (job, dedupe_key); cache-aware; single-flight.
 *
 *   fresh cache for scope_key      → task is born SUCCEEDED (reused = CACHE)
 *   a live producer for scope_key  → task WAITING_SHARED on it (reused = SHARED)
 *   otherwise                      → task QUEUED as the scope's producer
 *
 * A transaction-scoped advisory lock on the scope serialises the decision, so
 * a thousand concurrent enqueues for one building create exactly one producer.
 */
create or replace function public.verify_task_enqueue(
  p_job_id uuid, p_source text, p_dedupe_key text, p_scope_key text default null,
  p_input jsonb default '{}'::jsonb, p_priority integer default 100)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_policy public.verify_source_policy;
  v_existing public.verify_tasks;
  v_cache public.verify_evidence_cache;
  v_producer public.verify_tasks;
  v_task public.verify_tasks;
  v_scope text;
begin
  select * into v_policy from public.verify_source_policy where source = p_source;
  if not found then
    raise exception 'verify_task_enqueue: unknown source %', p_source using errcode = '22023';
  end if;

  select * into v_existing from public.verify_tasks where job_id = p_job_id and dedupe_key = p_dedupe_key;
  if found then
    return public.verify_task_json(v_existing) || jsonb_build_object('created', false);
  end if;

  v_scope := case when v_policy.shareable then nullif(p_scope_key, '') else null end;

  if v_scope is not null then
    perform pg_advisory_xact_lock(hashtextextended('verify_scope:' || v_scope, 0));

    select * into v_cache from public.verify_evidence_cache
     where scope_key = v_scope and fresh_until > now() and invalidated_at is null;
    if found then
      insert into public.verify_tasks (job_id, source, lane, dedupe_key, scope_key, input, state, priority,
                                       max_attempts, lease_seconds, cache_id, reused, result, evidence_refs,
                                       started_at, finished_at)
      values (p_job_id, p_source, v_policy.lane, p_dedupe_key, null, p_input, 'SUCCEEDED', p_priority,
              v_policy.max_attempts, v_policy.lease_seconds, v_cache.id, 'CACHE', v_cache.result, v_cache.evidence_refs,
              now(), now())
      on conflict (job_id, dedupe_key) do nothing
      returning * into v_task;
      if v_task.id is null then
        select * into v_task from public.verify_tasks where job_id = p_job_id and dedupe_key = p_dedupe_key;
        return public.verify_task_json(v_task) || jsonb_build_object('created', false);
      end if;
      update public.verify_evidence_cache set hit_count = hit_count + 1, last_hit_at = now() where id = v_cache.id;
      return public.verify_task_json(v_task) || jsonb_build_object('created', true);
    end if;

    select * into v_producer from public.verify_tasks
     where scope_key = v_scope and state in ('QUEUED','RUNNING');
    if found then
      insert into public.verify_tasks (job_id, source, lane, dedupe_key, scope_key, input, state, priority,
                                       max_attempts, lease_seconds, shared_task_id, reused)
      values (p_job_id, p_source, v_policy.lane, p_dedupe_key, null, p_input, 'WAITING_SHARED', p_priority,
              v_policy.max_attempts, v_policy.lease_seconds, v_producer.id, 'SHARED')
      on conflict (job_id, dedupe_key) do nothing
      returning * into v_task;
      if v_task.id is null then
        select * into v_task from public.verify_tasks where job_id = p_job_id and dedupe_key = p_dedupe_key;
        return public.verify_task_json(v_task) || jsonb_build_object('created', false);
      end if;
      -- An earlier-priority follower lifts its producer.
      update public.verify_tasks set priority = least(priority, p_priority) where id = v_producer.id and state = 'QUEUED';
      return public.verify_task_json(v_task) || jsonb_build_object('created', true);
    end if;
  end if;

  insert into public.verify_tasks (job_id, source, lane, dedupe_key, scope_key, input, priority, max_attempts, lease_seconds)
  values (p_job_id, p_source, v_policy.lane, p_dedupe_key, v_scope, p_input, p_priority, v_policy.max_attempts, v_policy.lease_seconds)
  on conflict (job_id, dedupe_key) do nothing
  returning * into v_task;
  if v_task.id is null then
    select * into v_task from public.verify_tasks where job_id = p_job_id and dedupe_key = p_dedupe_key;
    return public.verify_task_json(v_task) || jsonb_build_object('created', false);
  end if;
  return public.verify_task_json(v_task) || jsonb_build_object('created', true);
end;
$$;

/*
 * LEASE RECOVERY — RUNNING tasks whose lease expired (crashed or stalled
 * worker) go back to the queue with backoff, or to DEAD after max_attempts.
 * Called opportunistically by every claim; also callable on its own.
 */
create or replace function public.verify_task_recover_expired(p_limit integer default 100)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  v_n integer;
begin
  with expired as (
    select id from public.verify_tasks
     where state = 'RUNNING' and lease_expires_at < now()
     order by lease_expires_at
     for update skip locked
     limit greatest(p_limit, 1)
  )
  update public.verify_tasks t
     set state = case when t.attempts >= t.max_attempts then 'DEAD' else 'QUEUED' end,
         run_after = now() + public.verify_task_backoff(t.attempts),
         error = coalesce(t.error || ' | ', '') || 'LEASE_EXPIRED owner=' || coalesce(t.lease_owner, '?'),
         lease_owner = null, lease_expires_at = null,
         finished_at = case when t.attempts >= t.max_attempts then now() else null end,
         updated_at = now()
    from expired e
   where t.id = e.id;
  get diagnostics v_n = row_count;
  -- Followers of producers that just died are released with the failure.
  perform public.verify_task_settle_followers(t.id)
     from public.verify_tasks t
    where t.state = 'DEAD' and t.finished_at >= now() and t.error like '%LEASE_EXPIRED%';
  return v_n;
end;
$$;

/*
 * CLAIM — up to p_limit QUEUED tasks of the given lanes, atomically, under a
 * new lease and a new fencing token. FOR UPDATE SKIP LOCKED lets any number of
 * worker replicas claim at once without blocking or double-claiming.
 * Sources at their running cap are skipped (soft cap: concurrent claimers may
 * overshoot by at most their batch size).
 */
create or replace function public.verify_task_claim(
  p_worker text, p_lanes text[], p_limit integer default 1)
returns setof jsonb
language plpgsql security definer set search_path to ''
as $$
begin
  perform public.verify_task_recover_expired(50);
  return query
  with saturated as (
    select r.source
      from (select source, count(*) as n from public.verify_tasks where state = 'RUNNING' group by source) r
      join public.verify_source_policy p on p.source = r.source
     where p.max_running is not null and r.n >= p.max_running
  ),
  pick as (
    select t.id from public.verify_tasks t
     where t.state = 'QUEUED' and t.lane = any(p_lanes) and t.run_after <= now()
       and not t.cancel_requested
       and t.source not in (select source from saturated)
     order by t.priority, t.run_after, t.created_at
     for update skip locked
     limit greatest(least(p_limit, 50), 1)
  )
  update public.verify_tasks t
     set state = 'RUNNING', attempts = t.attempts + 1, lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => t.lease_seconds),
         fencing_token = t.fencing_token + 1, heartbeat_at = now(),
         started_at = coalesce(t.started_at, now()), updated_at = now()
    from pick
   where t.id = pick.id
  returning public.verify_task_json(t);
end;
$$;

-- HEARTBEAT — extends the lease only for the current holder (fencing token).
-- Answers 'LOST' to a stale holder and 'CANCEL' when the job was cancelled.
create or replace function public.verify_task_heartbeat(p_task_id uuid, p_token bigint)
returns text
language plpgsql security definer set search_path to ''
as $$
declare
  v_cancel boolean;
begin
  update public.verify_tasks
     set lease_expires_at = now() + make_interval(secs => lease_seconds), heartbeat_at = now(), updated_at = now()
   where id = p_task_id and state = 'RUNNING' and fencing_token = p_token
  returning cancel_requested into v_cancel;
  if not found then return 'LOST'; end if;
  return case when v_cancel then 'CANCEL' else 'OK' end;
end;
$$;

-- Followers whose producer finished take its outcome. Scoped to ONE producer:
-- a global sweep made every completion O(all waiting followers) — measured
-- 2.2 s p50 claim latency at 10,000 jobs before this was scoped.
create or replace function public.verify_task_settle_followers(p_producer_id uuid)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  v_p public.verify_tasks;
  v_n integer := 0;
  v_heir uuid;
begin
  select * into v_p from public.verify_tasks where id = p_producer_id;
  if not found then return 0; end if;

  if v_p.state = 'SUCCEEDED' then
    update public.verify_tasks f
       set state = 'SUCCEEDED', result = v_p.result, evidence_refs = v_p.evidence_refs, cache_id = v_p.cache_id,
           finished_at = now(), updated_at = now(), started_at = coalesce(f.started_at, v_p.started_at)
     where f.shared_task_id = v_p.id and f.state = 'WAITING_SHARED';
    get diagnostics v_n = row_count;
  elsif v_p.state in ('DEAD','FAILED') then
    update public.verify_tasks f
       set state = 'FAILED', error = 'SHARED_PRODUCER_' || v_p.state || coalesce(': ' || v_p.error, ''),
           finished_at = now(), updated_at = now()
     where f.shared_task_id = v_p.id and f.state = 'WAITING_SHARED';
    get diagnostics v_n = row_count;
  elsif v_p.state = 'CANCELLED' then
    -- The producer's own job was cancelled: the oldest follower inherits the
    -- work and becomes the scope's producer; the others follow it.
    select id into v_heir from public.verify_tasks
     where shared_task_id = v_p.id and state = 'WAITING_SHARED' order by created_at limit 1;
    if v_heir is not null then
      update public.verify_tasks
         set state = 'QUEUED', shared_task_id = null, reused = null, scope_key = v_p.input->>'_scope',
             run_after = now(), updated_at = now()
       where id = v_heir;
      update public.verify_tasks set shared_task_id = v_heir
       where shared_task_id = v_p.id and state = 'WAITING_SHARED';
      v_n := 1;
    end if;
  end if;
  return v_n;
end;
$$;

/*
 * COMPLETE — only the current lease holder (fencing token) can complete.
 * A shareable result is written to the evidence cache with provenance, and
 * every follower receives it in the same transaction.
 * p_cache_scope lets the worker store the result under the scope it actually
 * resolved (e.g. TAS fell back from the flat's code to the parcel's).
 */
create or replace function public.verify_task_complete(
  p_task_id uuid, p_token bigint, p_result jsonb, p_evidence_refs jsonb default '[]'::jsonb,
  p_content_hash text default null, p_cache_scope text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_task public.verify_tasks;
  v_policy public.verify_source_policy;
  v_cache_id uuid;
  v_scope text;
begin
  update public.verify_tasks
     set state = 'SUCCEEDED', result = p_result, evidence_refs = coalesce(p_evidence_refs, '[]'::jsonb),
         error = null, lease_owner = null, lease_expires_at = null, finished_at = now(), updated_at = now()
   where id = p_task_id and state = 'RUNNING' and fencing_token = p_token
  returning * into v_task;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'STALE_OR_UNKNOWN_LEASE');
  end if;

  select * into v_policy from public.verify_source_policy where source = v_task.source;
  v_scope := coalesce(nullif(p_cache_scope, ''), v_task.scope_key);
  if v_policy.shareable and v_policy.fresh_seconds > 0 and v_scope is not null then
    insert into public.verify_evidence_cache (scope_key, source, scope_kind, result, evidence_refs, content_hash,
                                              fetched_at, fresh_until, producing_task_id, producing_job_id)
    values (v_scope, v_task.source, v_policy.scope_kind, p_result, coalesce(p_evidence_refs, '[]'::jsonb), p_content_hash,
            now(), now() + make_interval(secs => v_policy.fresh_seconds), v_task.id, v_task.job_id)
    on conflict (scope_key) do update
       set result = excluded.result, evidence_refs = excluded.evidence_refs, content_hash = excluded.content_hash,
           fetched_at = excluded.fetched_at, fresh_until = excluded.fresh_until,
           producing_task_id = excluded.producing_task_id, producing_job_id = excluded.producing_job_id,
           invalidated_at = null, invalidated_reason = null
    returning id into v_cache_id;
    update public.verify_tasks set cache_id = v_cache_id where id = v_task.id;
  end if;

  perform public.verify_task_settle_followers(v_task.id);
  return jsonb_build_object('ok', true, 'cacheId', v_cache_id);
end;
$$;

/*
 * FAIL — current holder only. Retryable failures go back to the queue with
 * backoff + jitter (or an explicit retry-after from the provider); the last
 * attempt, or a non-retryable failure, ends the task (DEAD / FAILED).
 */
create or replace function public.verify_task_fail(
  p_task_id uuid, p_token bigint, p_error text, p_retryable boolean default true,
  p_retry_after_seconds integer default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_task public.verify_tasks;
begin
  update public.verify_tasks
     set state = case
                   when not p_retryable then 'FAILED'
                   when attempts >= max_attempts then 'DEAD'
                   else 'QUEUED' end,
         run_after = case when p_retry_after_seconds is not null
                          then now() + make_interval(secs => greatest(p_retry_after_seconds, 1))
                          else now() + public.verify_task_backoff(attempts) end,
         error = left(coalesce(p_error, 'FAILED'), 2000),
         lease_owner = null, lease_expires_at = null,
         finished_at = case when not p_retryable or attempts >= max_attempts then now() else null end,
         updated_at = now()
   where id = p_task_id and state = 'RUNNING' and fencing_token = p_token
  returning * into v_task;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'STALE_OR_UNKNOWN_LEASE');
  end if;
  perform public.verify_task_settle_followers(v_task.id);
  return jsonb_build_object('ok', true, 'state', v_task.state, 'runAfter', v_task.run_after);
end;
$$;

-- RELEASE — graceful shutdown: hand the task back without spending an attempt.
create or replace function public.verify_task_release(p_task_id uuid, p_token bigint)
returns boolean
language plpgsql security definer set search_path to ''
as $$
begin
  update public.verify_tasks
     set state = 'QUEUED', attempts = greatest(attempts - 1, 0), run_after = now(),
         lease_owner = null, lease_expires_at = null, updated_at = now()
   where id = p_task_id and state = 'RUNNING' and fencing_token = p_token;
  return found;
end;
$$;

/*
 * DELEGATE — a running task hands its work to another scope (single-flight at
 * that scope). Used by TAS: a flat with no case files of its own resolves to
 * the parcel, whose read is shared by every flat in the building.
 */
create or replace function public.verify_task_delegate(
  p_task_id uuid, p_token bigint, p_scope_key text, p_input jsonb default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_task public.verify_tasks;
  v_cache public.verify_evidence_cache;
  v_producer public.verify_tasks;
begin
  select * into v_task from public.verify_tasks
   where id = p_task_id and state = 'RUNNING' and fencing_token = p_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'STALE_OR_UNKNOWN_LEASE');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('verify_scope:' || p_scope_key, 0));

  select * into v_cache from public.verify_evidence_cache
   where scope_key = p_scope_key and fresh_until > now() and invalidated_at is null;
  if found then
    update public.verify_tasks
       set state = 'SUCCEEDED', result = v_cache.result, evidence_refs = v_cache.evidence_refs,
           cache_id = v_cache.id, reused = 'CACHE', lease_owner = null, lease_expires_at = null,
           finished_at = now(), updated_at = now()
     where id = v_task.id;
    update public.verify_evidence_cache set hit_count = hit_count + 1, last_hit_at = now() where id = v_cache.id;
    perform public.verify_task_settle_followers(v_task.id);
    return jsonb_build_object('ok', true, 'outcome', 'CACHE');
  end if;

  select * into v_producer from public.verify_tasks
   where scope_key = p_scope_key and state in ('QUEUED','RUNNING') and id <> v_task.id;
  if found then
    update public.verify_tasks
       set state = 'WAITING_SHARED', shared_task_id = v_producer.id, reused = 'SHARED',
           lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = v_task.id;
    -- This task's own followers now wait on the same producer.
    update public.verify_tasks set shared_task_id = v_producer.id where shared_task_id = v_task.id and state = 'WAITING_SHARED';
    return jsonb_build_object('ok', true, 'outcome', 'SHARED', 'producerId', v_producer.id);
  end if;

  -- Nobody holds the scope: this task becomes its producer and keeps running.
  update public.verify_tasks
     set scope_key = p_scope_key, input = coalesce(p_input, input), updated_at = now()
   where id = v_task.id;
  return jsonb_build_object('ok', true, 'outcome', 'PRODUCE');
end;
$$;

-- CANCEL — durable job cancellation. Queued work stops; running work is told
-- through its heartbeat; a producer other jobs are waiting on keeps running.
create or replace function public.verify_job_cancel_tasks(p_job_id uuid)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  v_n integer;
begin
  update public.verify_tasks t
     set state = 'CANCELLED', finished_at = now(), updated_at = now(),
         input = case when t.scope_key is not null then t.input || jsonb_build_object('_scope', t.scope_key) else t.input end,
         scope_key = null
   where t.job_id = p_job_id and t.state in ('QUEUED','WAITING_SHARED')
     and not exists (select 1 from public.verify_tasks f where f.shared_task_id = t.id and f.state = 'WAITING_SHARED' and f.job_id <> p_job_id);
  get diagnostics v_n = row_count;
  update public.verify_tasks t
     set cancel_requested = true, updated_at = now()
   where t.job_id = p_job_id and t.state = 'RUNNING'
     and not exists (select 1 from public.verify_tasks f where f.shared_task_id = t.id and f.state = 'WAITING_SHARED' and f.job_id <> p_job_id);
  return v_n;
end;
$$;

-- CAPTCHA ACCOUNTING — idempotent per attempt.
create or replace function public.verify_captcha_record(
  p_idempotency_key text, p_task_id uuid, p_job_id uuid, p_source text, p_outcome text,
  p_cost_usd numeric default 0, p_solve_ms integer default null, p_kind text default null,
  p_error_code text default null, p_provider text default '2captcha')
returns boolean
language plpgsql security definer set search_path to ''
as $$
begin
  insert into public.verify_captcha_events (idempotency_key, task_id, job_id, source, provider, kind, outcome, cost_usd, solve_ms, error_code)
  values (p_idempotency_key, p_task_id, p_job_id, p_source, coalesce(p_provider, '2captcha'), p_kind, p_outcome,
          coalesce(p_cost_usd, 0), p_solve_ms, p_error_code)
  on conflict (idempotency_key) do nothing;
  return found;
end;
$$;

/*
 * ONE ADVANCER PER JOB — the customer's status poll and the cron driver used
 * to advance the same row at once (duplicate paid launches). Whoever holds
 * the lease advances; everyone else reads.
 */
create or replace function public.research_job_advance_acquire(p_job_id uuid, p_seconds integer default 60)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.research_jobs
     set advance_lease_token = v_token,
         advance_lease_until = now() + make_interval(secs => least(greatest(p_seconds, 5), 300))
   where id = p_job_id and (advance_lease_until is null or advance_lease_until < now());
  if not found then return null; end if;
  return v_token;
end;
$$;

create or replace function public.research_job_advance_release(p_job_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $$
begin
  update public.research_jobs set advance_lease_until = null, advance_lease_token = null
   where id = p_job_id and advance_lease_token = p_token;
  return found;
end;
$$;

-- Queue health for Admin and autoscaling decisions.
create or replace function public.verify_queue_metrics()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'byLaneState', coalesce((select jsonb_object_agg(lane || ':' || state, n) from (
        select lane, state, count(*) as n from public.verify_tasks
         where state in ('QUEUED','RUNNING','WAITING_SHARED') group by lane, state) s), '{}'::jsonb),
    'oldestQueuedSeconds', (select extract(epoch from now() - min(created_at))::integer
                              from public.verify_tasks where state = 'QUEUED'),
    'runningBySource', coalesce((select jsonb_object_agg(source, n) from (
        select source, count(*) as n from public.verify_tasks where state = 'RUNNING' group by source) r), '{}'::jsonb),
    'dead24h', (select count(*) from public.verify_tasks where state = 'DEAD' and finished_at > now() - interval '24 hours'),
    'cacheHits24h', (select count(*) from public.verify_tasks where reused is not null and created_at > now() - interval '24 hours'),
    'captcha24h', (select jsonb_build_object('solves', count(*), 'costUsd', coalesce(sum(cost_usd), 0))
                     from public.verify_captcha_events where created_at > now() - interval '24 hours'));
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.verify_task_backoff(integer)',
    'public.verify_task_json(public.verify_tasks)',
    'public.verify_task_enqueue(uuid, text, text, text, jsonb, integer)',
    'public.verify_task_recover_expired(integer)',
    'public.verify_task_claim(text, text[], integer)',
    'public.verify_task_heartbeat(uuid, bigint)',
    'public.verify_task_settle_followers(uuid)',
    'public.verify_task_complete(uuid, bigint, jsonb, jsonb, text, text)',
    'public.verify_task_fail(uuid, bigint, text, boolean, integer)',
    'public.verify_task_release(uuid, bigint)',
    'public.verify_task_delegate(uuid, bigint, text, jsonb)',
    'public.verify_job_cancel_tasks(uuid)',
    'public.verify_captcha_record(text, uuid, uuid, text, text, numeric, integer, text, text, text)',
    'public.research_job_advance_acquire(uuid, integer)',
    'public.research_job_advance_release(uuid, uuid)',
    'public.verify_queue_metrics()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke execute on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- FULL EVIDENCE. Complete source documents (every case text, register
-- extract and company record a worker read) are stored here by content hash,
-- never truncated. Private: no storage.objects policy, so anon and
-- authenticated have no access; the worker uploads through short-lived signed
-- upload URLs minted by the verify-queue function (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verify-evidence', 'verify-evidence', false, 52428800, array['text/plain', 'application/json'])
on conflict (id) do nothing;

-- Execution mode switch: LEGACY (worker HTTP jobs) stays the default until the
-- owner turns QUEUE on from Admin.
insert into public.admin_settings (key, value, description)
values ('verify_execution_mode', '"LEGACY"'::jsonb,
        'Verify execution: LEGACY (worker in-memory jobs) or QUEUE (durable verify_tasks claimed by worker replicas)')
on conflict (key) do nothing;
