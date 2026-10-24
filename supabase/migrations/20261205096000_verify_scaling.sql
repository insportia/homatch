-- Dynamic Railway scaling for Verify (owner 2026-10-24): the ledger and the live
-- signals behind Admin → Infrastructure → Verify Scaling.
--
--   worker_replicas        one row per worker process, refreshed every ~30 s by
--                          the worker itself (verify-queue replica_beat): the only
--                          honest "healthy replicas" count, plus its slots, busy
--                          tasks and memory. A replica that stops beating is not
--                          healthy, whatever Railway says.
--   verify_scaling_events  every scale request, refusal, apply and verification,
--                          with who asked (an admin, the autoscaler, or Claude Code
--                          acting on an owner approval). Append-only by design.
--   verify_scaling_metrics() the queue numbers the panel and the autoscaler read.
--
-- admin_settings.verify_scaling starts MANUAL: the autoscaler does nothing until
-- the owner switches it on. Service role only; the edge function checks is_admin.

create table if not exists public.worker_replicas (
  replica text primary key,
  deployment text,
  started_at timestamptz,
  last_seen timestamptz not null default now(),
  draining boolean not null default false,
  http_slots integer,
  browser_slots integer,
  running integer not null default 0,
  rss_mb integer,
  version text
);
alter table public.worker_replicas enable row level security;
revoke all on table public.worker_replicas from public, anon, authenticated;
grant select, insert, update, delete on table public.worker_replicas to service_role;

create table if not exists public.verify_scaling_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  actor uuid,
  source text not null check (source in ('admin', 'autoscaler', 'claude')),
  action text not null check (action in ('SCALE', 'SETTINGS')),
  status text not null check (status in ('REFUSED', 'APPLIED', 'VERIFIED', 'FAILED')),
  from_replicas integer,
  to_replicas integer,
  reason text,
  detail jsonb not null default '{}'::jsonb
);
alter table public.verify_scaling_events enable row level security;
revoke all on table public.verify_scaling_events from public, anon, authenticated;
grant select, insert on table public.verify_scaling_events to service_role;
-- Append-only for real: Supabase's default privileges would otherwise leave update/delete with service_role.
revoke update, delete, truncate on table public.verify_scaling_events from service_role;
grant usage on sequence public.verify_scaling_events_id_seq to service_role;
create index if not exists verify_scaling_events_created_idx on public.verify_scaling_events (created_at desc);

insert into public.admin_settings (key, value, updated_at)
values ('verify_scaling', '{"mode":"MANUAL","plan":"HOBBY","min":1,"normal":3,"burst":6,"approvedMax":3}'::jsonb, now())
on conflict (key) do nothing;

create or replace function public.verify_scaling_metrics()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'queued', (select count(*) from public.verify_tasks where state in ('QUEUED', 'WAITING_SHARED') and source <> 'rstax'),
    'queuedByLane', (select coalesce(jsonb_object_agg(lane, n), '{}'::jsonb) from (select lane, count(*) n from public.verify_tasks where state = 'QUEUED' and source <> 'rstax' group by lane) q),
    'running', (select count(*) from public.verify_tasks where state = 'RUNNING'),
    'oldestQueuedSeconds', coalesce((select extract(epoch from now() - min(greatest(created_at, run_after)))::integer from public.verify_tasks where state = 'QUEUED' and run_after <= now() and source <> 'rstax'), 0),
    'completedLast15m', (select count(*) from public.verify_tasks where state in ('SUCCEEDED', 'FAILED', 'DEAD') and finished_at > now() - interval '15 minutes'),
    'jobsPerMinute', round(((select count(*) from public.research_jobs where status = 'COMPLETE' and completed_at > now() - interval '60 minutes')::numeric / 60), 2),
    'activeJobs', (select count(*) from public.research_jobs where status in ('CREATED', 'RUNNING') and deleted_at is null and cancelled_at is null and updated_at > now() - interval '6 hours'),
    'taskP95Seconds', (select round(percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at))::numeric, 1)
                         from public.verify_tasks where state = 'SUCCEEDED' and started_at is not null and finished_at > now() - interval '24 hours'),
    'healthyReplicas', (select count(*) from public.worker_replicas where last_seen > now() - interval '90 seconds' and not draining),
    'replicas', (select coalesce(jsonb_agg(jsonb_build_object('replica', replica, 'lastSeen', last_seen, 'draining', draining, 'running', running, 'rssMb', rss_mb, 'slots', coalesce(http_slots, 0) + coalesce(browser_slots, 0)) order by replica), '[]'::jsonb)
                   from public.worker_replicas where last_seen > now() - interval '10 minutes')
  );
$function$;
revoke all on function public.verify_scaling_metrics() from public, anon, authenticated;
grant execute on function public.verify_scaling_metrics() to service_role;
