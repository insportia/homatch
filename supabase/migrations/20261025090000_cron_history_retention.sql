-- CRON HISTORY RETENTION (infrastructure; prepared for review, NOT applied).
--
-- Production, 2026-10-09 (docs/infra/SCALABILITY_AUDIT.md): pg_cron has kept
-- every run since 2026-08-28. cron.job_run_details holds ~228k rows / 179 MB —
-- more than half of the whole 315 MB database — grows ~12.4k rows/day (15 jobs,
-- two every 30 s, five every minute), has never been vacuumed and has no index
-- but its primary key, so any read by time is a full 179 MB scan. Every run
-- writes its row twice (insert, then the status update).
--
-- This keeps 7 days of history and deletes the rest gradually: at most
-- p_batch rows per call, oldest first, walking the primary key (runid rises with
-- time) so no call scans the table. Scheduled hourly, the ~141k-row backlog is
-- gone in about 7 hours at ~20k rows/hour, and steady state is ~520 rows/hour.
--
-- Safety: only cron.job_run_details rows are deleted — never cron.job, so no
-- schedule is touched — and never a row still 'starting'/'running'. DELETE takes
-- row locks only (pg_cron keeps inserting new rows meanwhile); lock_timeout 5s
-- means a call gives up rather than waits. The job is (re)scheduled by name, so
-- applying twice leaves exactly one job.
--
-- Nothing else changes: no job, schedule, setting or application table is
-- touched. The space is reused by new rows; the file does not shrink (that would
-- need VACUUM FULL, an exclusive lock — deliberately not done here).
--
-- Rollback: select cron.unschedule('homatch-cron-history-retention');
--           drop function public.purge_cron_history(interval, integer);
-- Deleted history cannot be restored; nothing reads it except diagnostics.
--
-- Append-only. The runner owns the transaction. Idempotent: safe to apply twice.

create or replace function public.purge_cron_history(
  p_keep interval default interval '7 days',
  p_batch integer default 20000)
returns integer
language plpgsql
security definer
set search_path to ''
set lock_timeout to '5s'
as $function$
declare
  v_cutoff timestamptz := now() - greatest(coalesce(p_keep, interval '7 days'), interval '1 day');
  v_deleted integer;
begin
  with oldest as (
    select d.runid from cron.job_run_details d
     order by d.runid
     limit greatest(1, least(coalesce(p_batch, 20000), 50000)))
  delete from cron.job_run_details d
   using oldest
   where d.runid = oldest.runid
     and d.start_time < v_cutoff
     and d.status not in ('starting', 'running');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_cron_history(interval, integer) from public, anon, authenticated;
grant execute on function public.purge_cron_history(interval, integer) to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'homatch-cron-history-retention') then
      perform cron.unschedule('homatch-cron-history-retention');
    end if;
    perform cron.schedule('homatch-cron-history-retention', '41 * * * *',
      $cron$ select public.purge_cron_history(); $cron$);
  end if;
end $$;
