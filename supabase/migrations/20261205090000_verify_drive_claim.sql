-- Verify at scale: the driver claims a batch of live jobs atomically and fairly.
--
-- The driver used to read six job ids and step them one after another, each
-- holding its invocation for up to 55 s: one cron tick advanced about one
-- job. A burst of hundreds of verifications waited hours. Now each driver
-- invocation claims its own small batch here (FOR UPDATE SKIP LOCKED, so two
-- invocations never get the same job) and fans out to further invocations
-- while work remains (research-agent driveLiveJobs).
--
-- Fair: every customer's oldest waiting job comes before anyone's second
-- (row_number per customer), so one account cannot occupy the driver.
-- A claim is the existing driver_claimed_at stamp with the existing TTL
-- semantics; an expired claim is reclaimable, a release clears it.

create or replace function public.verify_drive_claim(
  p_limit integer,
  p_claim_ttl_seconds integer default 150,
  p_stale_seconds integer default 30,
  p_max_age_hours integer default 6
)
returns setof uuid
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return query
  with candidates as (
    select j.id, j.updated_at,
           row_number() over (partition by coalesce(j.user_id::text, j.id::text) order by j.updated_at) as rn
      from public.research_jobs j
     where j.status in ('CREATED', 'RUNNING')
       and j.deleted_at is null
       and j.cancelled_at is null
       and j.updated_at < now() - make_interval(secs => greatest(p_stale_seconds, 0))
       and j.created_at > now() - make_interval(hours => greatest(p_max_age_hours, 1))
       and (j.driver_claimed_at is null or j.driver_claimed_at < now() - make_interval(secs => greatest(p_claim_ttl_seconds, 10)))
  ),
  pick as (
    select r.id
      from public.research_jobs r
      join candidates c on c.id = r.id
     -- Re-checked on the row as it stands after the lock: a job another driver claimed and committed after
     -- this statement's snapshot is not locked any more, so SKIP LOCKED alone would hand it out twice.
     where r.status in ('CREATED', 'RUNNING')
       and r.deleted_at is null
       and r.cancelled_at is null
       and (r.driver_claimed_at is null or r.driver_claimed_at < now() - make_interval(secs => greatest(p_claim_ttl_seconds, 10)))
     order by c.rn, c.updated_at
     limit greatest(least(p_limit, 50), 1)
     for update of r skip locked
  )
  update public.research_jobs t
     set driver_claimed_at = now()
    from pick
   where t.id = pick.id
  returning t.id;
end;
$function$;

revoke all on function public.verify_drive_claim(integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.verify_drive_claim(integer, integer, integer, integer) to service_role;

-- The claim query's filter, kept cheap at hundreds of live jobs.
create index if not exists research_jobs_drive_live_idx
  on public.research_jobs (updated_at)
  where status in ('CREATED', 'RUNNING') and deleted_at is null and cancelled_at is null;
