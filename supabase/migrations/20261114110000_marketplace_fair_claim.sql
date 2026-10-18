-- FIND PROPERTY (free portal search) — fair claim order across requesters (capacity audit 2026-10-18, P1 #2).
--
-- Each portal runtime on the Railway worker searches ONE run at a time (measured p50 13–146 s per
-- source). claim_marketplace_worker_runs handed out QUEUED runs strictly by created_at, so a single
-- requester who started many searches with different criteria put every other customer behind all
-- of them, source by source.
--
-- This re-creates the function with ONE change: the ORDER of the candidate queued runs (see the
-- comment in the body). Every other line is the 20261010100000 definition verbatim — worker
-- eligibility, the global advisory lock, marketplace_max_concurrent_runs, per-worker
-- max_concurrency, lease clamp, deadline/attempt filters, SKIP LOCKED and the returned rows.
-- Nothing is limited or refused that was not before; with one requester the order is FIFO as before.
--
-- Rollback: re-run the function definition from 20261010100000_marketplace_search_foundation.sql
-- (section 8) — the signature is unchanged, so no caller changes either way — and
--   drop index if exists public.discovery_marketplace_worker_runs_served_idx;

-- Serves the "claimed by this worker in the last hour" count of the fair order.
create index if not exists discovery_marketplace_worker_runs_served_idx
  on public.discovery_marketplace_worker_runs (worker_id, claimed_at)
  where claimed_at is not null;

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
       join (
         /* Fair order across requesters (capacity audit 2026-10-18):
              1. requesters THIS worker served least in the last hour first
                 (claimed runs, finished or not — the portal runtimes run one
                 search at a time, so "in flight" alone is almost always 0),
              2. then each requester's oldest queued run before anyone's second,
              3. then arrival time.
            One requester alone is plain FIFO, exactly as before. No limit is
            added: every queued run is still claimed, only the order changes,
            so one person's burst of searches no longer queues everyone else
            behind it on these one-at-a-time portal workers. */
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
          where c.worker_id = p_worker_id and c.status = 'QUEUED' and c.deadline_at > now()
            and c.attempts < v_worker.max_attempts
            and cs.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE')) k on k.id = q.id
       join public.discovery_marketplace_searches s on s.id = q.search_id
      where q.worker_id = p_worker_id and q.status = 'QUEUED' and q.deadline_at > now()
        and q.attempts < v_worker.max_attempts
        and s.status not in ('CANCELLED', 'FAILED', 'COMPLETE', 'PARTIAL_COMPLETE')
      order by k.requester_served, k.requester_turn, q.created_at, q.id
      limit v_slots
      for update of q skip locked)
  returning r.*;
end;
$function$;

revoke all on function public.claim_marketplace_worker_runs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_marketplace_worker_runs(text, integer, integer) to service_role;
