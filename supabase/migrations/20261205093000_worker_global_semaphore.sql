-- Shared limits across worker replicas (Verify at scale).
--
-- A limit kept in one process (MyHome's one-run-at-a-time, a source's polite
-- concurrency, a proxy's spending pace) multiplies by the number of replicas.
-- These slots live in the database instead: a holder takes a slot under a key
-- while fewer than p_max are live, keeps it with the same call, and gives it
-- back (or it expires at its TTL if the process died). Service role only;
-- reached by the worker through verify-queue.

create table if not exists public.worker_semaphore_slots (
  key text not null,
  holder text not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  primary key (key, holder)
);
alter table public.worker_semaphore_slots enable row level security;
revoke all on table public.worker_semaphore_slots from public, anon, authenticated;
grant select, insert, update, delete on table public.worker_semaphore_slots to service_role;

create or replace function public.worker_semaphore_acquire(p_key text, p_holder text, p_max integer, p_ttl_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_live integer;
begin
  if p_key is null or p_holder is null or p_max is null or p_max < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('worker_semaphore:' || p_key));
  delete from public.worker_semaphore_slots where key = p_key and expires_at < now();
  -- Re-acquiring a slot already held renews it.
  update public.worker_semaphore_slots
     set expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 5))
   where key = p_key and holder = p_holder;
  if found then return true; end if;
  select count(*) into v_live from public.worker_semaphore_slots where key = p_key;
  if v_live >= p_max then return false; end if;
  insert into public.worker_semaphore_slots (key, holder, expires_at)
  values (p_key, p_holder, now() + make_interval(secs => greatest(p_ttl_seconds, 5)));
  return true;
end;
$function$;

create or replace function public.worker_semaphore_release(p_key text, p_holder text)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  with d as (delete from public.worker_semaphore_slots where key = p_key and holder = p_holder returning 1)
  select exists (select 1 from d);
$function$;

revoke all on function public.worker_semaphore_acquire(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.worker_semaphore_release(text, text) from public, anon, authenticated;
grant execute on function public.worker_semaphore_acquire(text, text, integer, integer) to service_role;
grant execute on function public.worker_semaphore_release(text, text) to service_role;
