-- FIND PROPERTY (free portal search) — capacity: one portal run per identical request, fair
-- scheduling, no doomed runs, and a per-user limit on NEW LIVE portal searches only.
--
-- Measured 2026-10-18: each portal runtime reads one or two searches at a time (Home.ge 1 slot,
-- p50 146 s; Place.ge 1 slot, p95 queue wait 300 s; SS.ge 2 slots, p95 884 s). The platform can
-- run roughly 25–60 fresh portal searches an hour, whatever any per-user limit says, and every
-- search queued one run per portal. This migration lets the edge function:
--
--   1. SHARE: a search whose request (minus its own identity) equals one a portal is already
--      reading, or finished reading within 30 minutes, gets a FOLLOWER run (shared_run_id) that
--      no worker ever claims; it is answered from the leader's fresh listings by reference.
--      At most one live run per (worker, request) exists (unique index).
--   2. ADMIT: a new live run is created only if it can finish before its deadline given the
--      portal's queue and its mean run time, and only if the portal's admission is free within
--      ~100 ms (backpressure); otherwise the source answers from the HOMATCH listing pool at
--      once (run closed TIMED_OUT, code SOURCE_BUSY) instead of waiting to fail.
--   3. LIMIT: new LIVE portal searches per user — 3 at once / 20 per rolling hour / 100 per
--      rolling 24 h; 1 / 5 / 20 for suspicious traffic (an account under 24 h old, or on an IP
--      that started 60+ live searches in the last hour, AND neither 7 days old nor holding a
--      confirmed email or phone). Over the limit nothing is refused: the search answers from
--      the pool and shared runs (code LIVE_REFRESH_LIMIT, with the time it frees up). Shared,
--      reused, cached and refused-as-busy searches are not counted.
--   4. FAIR: claim_marketplace_worker_runs orders queued runs by how little this worker served
--      each requester in the last hour, then each requester's oldest first, then arrival
--      (20261115110000 in #253, moved here), never hands out a follower, and skips a run with
--      less than half the portal's median run time left before its deadline.
--
-- Free search only: no wallet, reservation, price or provider-spend object is read or written.
-- Append-only; additive columns and indexes; existing rows keep request_key NULL (they are never
-- shared and never conflict). The runner owns the transaction. Idempotent.
--
-- Rollback: re-run claim_marketplace_worker_runs from 20261010100000 (section 8), then
--   drop function if exists public.marketplace_dispatch_search(uuid, uuid, text, jsonb);
--   drop function if exists public.marketplace_hand_over_shared_runs(uuid);
--   drop function if exists public.marketplace_portal_finish_seconds(text, uuid);
--   drop function if exists public.marketplace_expected_run_seconds(text);
--   drop index if exists public.discovery_marketplace_worker_runs_live_request_uidx;
-- (the columns and the other indexes are harmless to keep).

-------------------------------------------------------------------------------
-- 1. Columns and indexes
-------------------------------------------------------------------------------
alter table public.discovery_marketplace_worker_runs
  add column if not exists request_key text,
  /* The run that reads the portal for this one. No foreign key: a leader removed with its
     search must never cascade into another customer's run; a missing leader is settled as
     SHARED_RUN_GONE and the source answers from the pool. */
  add column if not exists shared_run_id uuid,
  /* The instant pool answer for this run is still owed. Answered a few sources per request
     within a CPU budget (the start, then status polls), so no one Edge request ranks every
     source's pool at once. Existing runs stay false: their behaviour is unchanged. */
  add column if not exists pool_pending boolean not null default false;

/* At most one live portal run per (worker, request). */
create unique index if not exists discovery_marketplace_worker_runs_live_request_uidx
  on public.discovery_marketplace_worker_runs (worker_id, request_key)
  where request_key is not null and shared_run_id is null
    and status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING');
create index if not exists discovery_marketplace_worker_runs_followers_idx
  on public.discovery_marketplace_worker_runs (shared_run_id) where shared_run_id is not null;
create index if not exists discovery_marketplace_worker_runs_recent_request_idx
  on public.discovery_marketplace_worker_runs (worker_id, request_key, completed_at desc)
  where request_key is not null and status in ('COMPLETE', 'PARTIAL');
create index if not exists discovery_marketplace_worker_runs_runtime_idx
  on public.discovery_marketplace_worker_runs (worker_id, completed_at desc)
  where status in ('COMPLETE', 'PARTIAL') and shared_run_id is null and started_at is not null;
/* Serves the "claimed by this worker in the last hour" count of the fair order. */
create index if not exists discovery_marketplace_worker_runs_served_idx
  on public.discovery_marketplace_worker_runs (worker_id, claimed_at) where claimed_at is not null;
/* The quota reads rate_limit_events through idx_rate_limit_user_op and idx_rate_limit_ip_op
   (20260828194650), already in production. */

-------------------------------------------------------------------------------
-- 2. Mean portal run time (the last 50 runs that really read the portal). The MEAN, not the
--    median: a queue drains at the mean, and portal run times have long tails (SS.ge median
--    114 s, p95 884 s), so a median would admit runs that then die at their deadline.
-------------------------------------------------------------------------------
create or replace function public.marketplace_expected_run_seconds(p_worker_id text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(avg(x.secs), 60)::numeric
    from (select extract(epoch from (r.completed_at - r.started_at)) as secs
            from public.discovery_marketplace_worker_runs r
           where r.worker_id = p_worker_id and r.status in ('COMPLETE', 'PARTIAL')
             and r.shared_run_id is null and r.started_at is not null and r.completed_at is not null
           order by r.completed_at desc
           limit 50) x;
$function$;

-------------------------------------------------------------------------------
-- 2b. Seconds until a new run for this requester would finish on this portal: the queue ahead
--     (fair order: one turn for every other requester waiting, then this requester's own runs),
--     at the portal's slots and mean run time, plus its own run.
-------------------------------------------------------------------------------
create or replace function public.marketplace_portal_finish_seconds(p_worker_id text, p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_conc integer;
  v_expected numeric := public.marketplace_expected_run_seconds(p_worker_id);
  v_inflight integer;
  v_ahead integer;
begin
  select greatest(coalesce(w.max_concurrency, 1), 1) into v_conc from public.discovery_marketplace_workers w where w.worker_id = p_worker_id;
  select count(*) into v_inflight from public.discovery_marketplace_worker_runs x
   where x.worker_id = p_worker_id and x.status in ('SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING') and x.lease_expires_at > now();
  select coalesce(count(distinct s.user_id) filter (where s.user_id <> p_user_id), 0)
       + coalesce(count(*) filter (where s.user_id = p_user_id), 0)
    into v_ahead
    from public.discovery_marketplace_worker_runs x join public.discovery_marketplace_searches s on s.id = x.search_id
   where x.worker_id = p_worker_id and x.status = 'QUEUED' and x.shared_run_id is null and x.deadline_at > now()
     and s.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE');
  return floor(v_ahead::numeric / coalesce(v_conc, 1)) * v_expected
       + case when v_inflight >= coalesce(v_conc, 1) then v_expected / 2 else 0 end
       + v_expected;
end;
$function$;

-------------------------------------------------------------------------------
-- 3. Dispatch: one decision per source, the live-search quota, all in one transaction
-------------------------------------------------------------------------------
-- p_runs: [{ "worker_id", "request" (jsonb), "request_key", "deadline_at" }, ...]
-- Per source, in order: REUSED (identical run finished < 30 min ago with fresh listings),
-- SHARED (identical run live now), LIVE (new portal run), or deferred to the pool:
-- LIVE_REFRESH_LIMIT (this user's live quota) / SOURCE_BUSY (cannot finish before its deadline).
create or replace function public.marketplace_dispatch_search(
  p_search_id uuid, p_user_id uuid, p_ip text, p_runs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_share_window constant interval := interval '30 minutes';
  c_op constant text := 'marketplace_search_live';
  c_ip_soft_hour constant integer := 60;
  v_created timestamptz;
  v_confirmed boolean;
  v_established boolean;
  v_ip_hot boolean := false;
  v_tier text;
  v_max_active integer;
  v_max_hour integer;
  v_max_day integer;
  v_active integer;
  v_hour integer;
  v_day integer;
  v_quota_checked boolean := false;
  v_live_ok boolean;
  v_limit_reason text;
  v_limit_retry timestamptz;
  v_live integer := 0;
  r jsonb;
  v_worker_id text;
  v_key text;
  v_deadline timestamptz;
  v_leader uuid;
  v_mode text;
  v_retry timestamptz;
  v_id uuid;
  v_admit boolean;
  v_try integer;
  v_finish numeric;
  v_out jsonb := '[]'::jsonb;
begin
  perform 1 from public.discovery_marketplace_searches s where s.id = p_search_id and s.user_id = p_user_id;
  if not found then raise exception 'SEARCH_NOT_OWNED'; end if;
  /* One dispatch per user at a time: the quota is read and recorded atomically. */
  perform pg_advisory_xact_lock(hashtext('marketplace_live_quota:' || p_user_id::text));

  for r in select value from jsonb_array_elements(coalesce(p_runs, '[]'::jsonb)) order by value->>'worker_id' loop
    v_worker_id := r->>'worker_id';
    v_key := r->>'request_key';
    v_deadline := (r->>'deadline_at')::timestamptz;
    v_leader := null; v_mode := null; v_retry := null; v_admit := false;
    /* Requests are decided one at a time per (worker, request): two identical starts never both go live. */
    perform pg_advisory_xact_lock(hashtext('marketplace_request:' || v_worker_id || ':' || coalesce(v_key, '')));

    if v_key is not null then
      /* A live run past its deadline, or whose search already ended (no worker claims it any
         more), is closed so it can neither lead followers nor block a new run. */
      update public.discovery_marketplace_worker_runs x
         set status = case when x.returned_count > 0 then 'PARTIAL' else 'TIMED_OUT' end,
             lease_expires_at = null, completed_at = now(), updated_at = now(),
             errors = x.errors || jsonb_build_array(jsonb_build_object('code',
                        case when x.deadline_at <= now() then 'DEADLINE' else 'SEARCH_ENDED' end, 'message', ''))
        from public.discovery_marketplace_searches s
       where s.id = x.search_id and x.worker_id = v_worker_id and x.request_key = v_key and x.shared_run_id is null
         and x.status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING')
         and (x.deadline_at <= now() or s.status in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE'));

      select x.id into v_leader from public.discovery_marketplace_worker_runs x
       where x.worker_id = v_worker_id and x.request_key = v_key and x.status in ('COMPLETE', 'PARTIAL')
         and x.shared_run_id is null and x.returned_count > 0 and x.completed_at >= now() - c_share_window
       order by x.completed_at desc limit 1;
      if v_leader is not null then
        v_mode := 'REUSED';
      else
        select x.id into v_leader from public.discovery_marketplace_worker_runs x
         where x.worker_id = v_worker_id and x.request_key = v_key and x.shared_run_id is null
           and x.status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING')
         limit 1;
        if v_leader is not null then v_mode := 'SHARED'; end if;
      end if;
    end if;

    if v_mode is null and not v_quota_checked then
      v_quota_checked := true;
      select u.created_at into v_created from public.users u where u.id = p_user_id;
      select (a.email_confirmed_at is not null or a.phone_confirmed_at is not null) into v_confirmed
        from public.users u join auth.users a on a.id = u.auth_id where u.id = p_user_id;
      /* False-positive guard: an account 7+ days old or with a confirmed email/phone is never
         treated as suspicious, whatever its network (offices, campuses and mobile carriers share IPs). */
      v_established := coalesce(v_created <= now() - interval '7 days', true) or coalesce(v_confirmed, false);
      if p_ip is not null and p_ip <> '' then
        v_ip_hot := (select count(*) from public.rate_limit_events e
                      where e.ip_address = p_ip and e.operation = c_op and e.created_at > now() - interval '1 hour') >= c_ip_soft_hour;
      end if;
      if not v_established and (v_created > now() - interval '24 hours' or v_ip_hot) then
        v_tier := 'SUSPICIOUS'; v_max_active := 1; v_max_hour := 5; v_max_day := 20;
      else
        v_tier := 'NORMAL'; v_max_active := 3; v_max_hour := 20; v_max_day := 100;
      end if;

      select count(distinct x.search_id) into v_active
        from public.discovery_marketplace_worker_runs x
        join public.discovery_marketplace_searches s on s.id = x.search_id
       where s.user_id = p_user_id and x.search_id <> p_search_id and x.shared_run_id is null
         and x.status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING') and x.deadline_at > now()
         and s.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE');
      select count(*) filter (where e.created_at > now() - interval '1 hour'), count(*)
        into v_hour, v_day
        from public.rate_limit_events e
       where e.user_id = p_user_id and e.operation = c_op and e.created_at > now() - interval '24 hours';

      v_live_ok := true;
      if v_active >= v_max_active then
        v_live_ok := false; v_limit_reason := 'CONCURRENT';
        select min(x.deadline_at) into v_limit_retry
          from public.discovery_marketplace_worker_runs x join public.discovery_marketplace_searches s on s.id = x.search_id
         where s.user_id = p_user_id and x.search_id <> p_search_id and x.shared_run_id is null
           and x.status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING') and x.deadline_at > now();
      elsif v_hour >= v_max_hour then
        v_live_ok := false; v_limit_reason := 'HOURLY';
        select min(t.created_at) + interval '1 hour' into v_limit_retry
          from (select e.created_at from public.rate_limit_events e
                 where e.user_id = p_user_id and e.operation = c_op and e.created_at > now() - interval '1 hour'
                 order by e.created_at desc limit v_max_hour) t;
      elsif v_day >= v_max_day then
        v_live_ok := false; v_limit_reason := 'DAILY';
        select min(t.created_at) + interval '24 hours' into v_limit_retry
          from (select e.created_at from public.rate_limit_events e
                 where e.user_id = p_user_id and e.operation = c_op and e.created_at > now() - interval '24 hours'
                 order by e.created_at desc limit v_max_day) t;
      end if;
    end if;

    if v_mode is null then
      if not v_live_ok then
        v_mode := 'LIVE_REFRESH_LIMIT'; v_retry := v_limit_retry;
      else
        /* Can a new run finish before its deadline (marketplace_portal_finish_seconds)?
           1. Without any lock: committed runs only, so the queue can only be under-counted; if
              even that cannot finish, the portal is full and the pool answers at once.
           2. Otherwise one admission per portal at a time, so a burst of different requests sees
              each other's queued runs, and the estimate is taken again. BACKPRESSURE: the turn is
              awaited at most ~100 ms (try-lock, never blocks: no lock-order deadlock); a portal
              that busy answers from the pool. */
        v_finish := public.marketplace_portal_finish_seconds(v_worker_id, p_user_id);
        if now() + make_interval(secs => v_finish::double precision) <= v_deadline then
          for v_try in 1..20 loop
            v_admit := pg_try_advisory_xact_lock(hashtext('marketplace_admit:' || v_worker_id));
            exit when v_admit;
            perform pg_sleep(0.005);
          end loop;
          if v_admit then v_finish := public.marketplace_portal_finish_seconds(v_worker_id, p_user_id); end if;
        end if;
        if v_admit and now() + make_interval(secs => v_finish::double precision) <= v_deadline then
          v_mode := 'LIVE';
        else
          v_mode := 'SOURCE_BUSY';
          v_retry := now() + make_interval(secs => greatest(60, v_finish - extract(epoch from (v_deadline - now())))::double precision);
        end if;
      end if;
    end if;

    if v_mode in ('LIVE', 'SHARED', 'REUSED') then
      insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at, request_key, shared_run_id, query_applied, pool_pending)
      values (p_search_id, v_worker_id, r->'request', v_deadline, v_key,
              case when v_mode = 'LIVE' then null else v_leader end,
              case when v_mode = 'LIVE' then '{}'::jsonb else jsonb_build_object('sharedFromRun', v_leader) end, true)
      returning id into v_id;
      if v_mode = 'LIVE' then v_live := v_live + 1; end if;
    else
      /* Deferred to the pool: closed at once, never claimed; the pool answers it (serveCachedListings). */
      insert into public.discovery_marketplace_worker_runs (search_id, worker_id, request, deadline_at, request_key, status,
                                                            completed_at, errors, query_applied, pool_pending)
      values (p_search_id, v_worker_id, r->'request', v_deadline, v_key, 'TIMED_OUT', now(),
              jsonb_build_array(jsonb_build_object('code', v_mode, 'message', '', 'retryAt', v_retry)),
              jsonb_build_object('deferred', v_mode), true)
      returning id into v_id;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'workerId', v_worker_id, 'mode', v_mode,
                                                           'sharedRunId', v_leader, 'retryAt', v_retry));
  end loop;

  /* Only a search that really started a portal run counts against the quota. */
  if v_live > 0 then
    insert into public.rate_limit_events (user_id, ip_address, operation) values (p_user_id, nullif(p_ip, ''), c_op);
  end if;

  return jsonb_build_object('tier', coalesce(v_tier, 'NOT_CHECKED'), 'ipSignal', v_ip_hot, 'live', v_live,
                            'limit', case when v_limit_reason is null then null
                                          else jsonb_build_object('reason', v_limit_reason, 'retryAt', v_limit_retry,
                                                                  'maxActive', v_max_active) end,
                            'runs', v_out);
end;
$function$;

-------------------------------------------------------------------------------
-- 4. A cancelled search hands its live runs over to the searches sharing them
-------------------------------------------------------------------------------
create or replace function public.marketplace_hand_over_shared_runs(p_search_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  l record;
  v_next uuid;
  v_n integer := 0;
begin
  for l in select x.id, x.worker_id, x.request_key from public.discovery_marketplace_worker_runs x
            where x.search_id = p_search_id and x.shared_run_id is null and x.request_key is not null loop
    perform pg_advisory_xact_lock(hashtext('marketplace_request:' || l.worker_id || ':' || l.request_key));
    /* Only once the cancelled run is closed; a live one still leads. */
    perform 1 from public.discovery_marketplace_worker_runs x
     where x.id = l.id and x.status in ('QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING');
    if found then continue; end if;
    select f.id into v_next from public.discovery_marketplace_worker_runs f
      join public.discovery_marketplace_searches s on s.id = f.search_id
     where f.shared_run_id = l.id and f.status = 'QUEUED' and f.deadline_at > now()
       and s.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE')
     order by f.created_at, f.id limit 1;
    if v_next is null then continue; end if;
    update public.discovery_marketplace_worker_runs set shared_run_id = null, query_applied = '{}'::jsonb, updated_at = now()
     where id = v_next;
    update public.discovery_marketplace_worker_runs
       set shared_run_id = v_next, query_applied = jsonb_build_object('sharedFromRun', v_next), updated_at = now()
     where shared_run_id = l.id and status = 'QUEUED';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-------------------------------------------------------------------------------
-- 5. Claim: fair across requesters, never a follower, never a run that cannot finish
-------------------------------------------------------------------------------
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
  v_min_left interval;
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
  /* A run with less than half the portal's mean run time left would be killed by its deadline
     mid-read: it is left for the deadline to close (the pool answers it) and the slot goes to one
     that can finish. */
  v_min_left := make_interval(secs => (public.marketplace_expected_run_seconds(p_worker_id) / 2)::double precision);

  return query
  update public.discovery_marketplace_worker_runs r
     set status = 'SEARCHING', claimed_at = now(), started_at = coalesce(r.started_at, now()),
         lease_expires_at = least(now() + make_interval(secs => v_lease), r.deadline_at),
         last_heartbeat_at = now(), attempts = r.attempts + 1, updated_at = now()
   where r.id in (
     select q.id from public.discovery_marketplace_worker_runs q
       join (
         /* Fair order across requesters:
              1. requesters THIS worker served least in the last hour first
                 (the portal runtimes read one search at a time, so "in flight"
                 alone is almost always 0),
              2. then each requester's oldest queued run before anyone's second,
              3. then arrival time.
            One requester alone is plain FIFO. */
         select c.id,
                coalesce(a.served, 0) as requester_served,
                row_number() over (partition by cs.user_id order by c.created_at, c.id) as requester_turn
           from public.discovery_marketplace_worker_runs c
           join public.discovery_marketplace_searches cs on cs.id = c.search_id
           left join (
             select ls.user_id, count(*) as served
               from public.discovery_marketplace_worker_runs l
               join public.discovery_marketplace_searches ls on ls.id = l.search_id
              where l.worker_id = p_worker_id and l.claimed_at > now() - interval '1 hour'
              group by ls.user_id) a on a.user_id = cs.user_id
          where c.worker_id = p_worker_id and c.status = 'QUEUED' and c.shared_run_id is null
            and c.deadline_at > now() + v_min_left
            and c.attempts < v_worker.max_attempts
            and cs.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE')) k on k.id = q.id
      where q.worker_id = p_worker_id and q.status = 'QUEUED' and q.shared_run_id is null
      order by k.requester_served, k.requester_turn, q.created_at, q.id
      limit v_slots
      for update of q skip locked)
  returning r.*;
end;
$function$;

revoke all on function public.marketplace_expected_run_seconds(text) from public, anon, authenticated;
revoke all on function public.marketplace_portal_finish_seconds(text, uuid) from public, anon, authenticated;
revoke all on function public.marketplace_dispatch_search(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.marketplace_hand_over_shared_runs(uuid) from public, anon, authenticated;
revoke all on function public.claim_marketplace_worker_runs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.marketplace_expected_run_seconds(text) to service_role;
grant execute on function public.marketplace_portal_finish_seconds(text, uuid) to service_role;
grant execute on function public.marketplace_dispatch_search(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.marketplace_hand_over_shared_runs(uuid) to service_role;
grant execute on function public.claim_marketplace_worker_runs(text, integer, integer) to service_role;
