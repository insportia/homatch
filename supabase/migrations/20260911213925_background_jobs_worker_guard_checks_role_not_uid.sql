-- SECURITY: the worker guard let an unauthenticated caller through.
--
-- background_jobs_assert_worker() was written as
--
--   if auth.uid() is not null and not is_admin() then raise; end if;
--
-- on the reasoning that a service-role caller has no auth.uid(). That is true
-- and it is not sufficient: `anon` has no auth.uid() either. The anon key is
-- the PUBLISHABLE one, shipped inside the JavaScript bundle, so it is not a
-- secret — which made every worker RPC callable by anybody on the internet.
--
-- REPRODUCED against production before the fix, as role anon with no subject
-- claim:
--
--   auth.uid() = NULL, auth.role() = anon
--   background_job_progress(<any job id>, 'PROCESSING', 99, 'PWNED')  -> ok
--   background_job_finish(<any job id>, 'COMPLETED', '/pwned')        -> ok
--   the job then read back:  COMPLETED / PWNED / /pwned
--
-- The third line is the one that matters. result_ref is where the job centre
-- navigates when the customer presses "Open result", so finish() could point
-- anybody's completed work at an arbitrary in-app destination, as well as
-- marking live jobs complete or failed and stranding their reservations.
--
-- The right test is the ROLE. wallet_release() has always checked
-- `auth.role() <> 'service_role'`, which is exactly why that function was
-- never exposed the same way — I had the working example in front of me and
-- reached for a cleverer test. An absent uid proves nothing; the role does.
--
-- AND THE GRANTS. Supabase's default privileges grant EXECUTE on new public
-- functions to anon, authenticated and service_role, so the original
-- migration's `revoke ... from public` never removed anon's own grant. Both
-- layers are fixed here: the guard so it holds if a grant is ever restored by
-- a future CREATE OR REPLACE, and the grants so the guard is never the only
-- thing standing between the internet and a worker RPC.
--
-- Found by running the Supabase security advisor after the feature was
-- otherwise finished, and then testing what it flagged rather than reading
-- the finding and assuming it was the same false positive as the other
-- seventy.

create or replace function public.background_jobs_assert_worker()
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  -- The worker holds the service key. Nothing else is a worker.
  if auth.role() = 'service_role' then return; end if;
  -- An operator driving a job by hand from the admin console (§45), audited
  -- at the call site.
  if public.is_admin() then return; end if;
  raise exception 'worker or admin only' using errcode = '42501';
end;
$$;

-- The four helpers the advisor flagged for a mutable search_path, pinned for
-- the same reason every other function in this feature pins it.

create or replace function public.background_jobs_touch()
returns trigger language plpgsql set search_path to '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.background_job_can_cancel(j public.background_jobs)
returns boolean language sql stable set search_path to '' as $$
  select j.state not in ('COMPLETED', 'FAILED', 'CANCELLED')
     and j.committed_at is null
     and now() < j.cancel_deadline_at;
$$;

create or replace function public.background_job_effective_state(j public.background_jobs)
returns text language sql stable set search_path to '' as $$
  select case
    when j.state in ('COMPLETED', 'FAILED', 'CANCELLED') then j.state
    when j.committed_at is null and now() < j.cancel_deadline_at then 'CANCELLABLE'
    when j.state in ('QUEUED', 'STARTING', 'CANCELLABLE') then 'COMMITTED'
    else j.state
  end;
$$;

create or replace function public.background_job_public(j public.background_jobs)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'id', j.id,
    'productType', j.product_type,
    'subjectType', j.subject_type,
    'subjectId', j.subject_id,
    'subjectLabel', j.subject_label,
    'state', public.background_job_effective_state(j),
    'storedState', j.state,
    'canCancel', public.background_job_can_cancel(j),
    'progress', j.progress,
    'currentStage', j.current_stage,
    'stages', j.stages,
    'createdAt', j.created_at,
    'startedAt', j.started_at,
    'cancelDeadlineAt', j.cancel_deadline_at,
    'committedAt', j.committed_at,
    'completedAt', j.completed_at,
    'failedAt', j.failed_at,
    'cancelledAt', j.cancelled_at,
    'lastHeartbeatAt', j.last_heartbeat_at,
    'userSafeError', j.user_safe_error,
    'attempt', j.attempt,
    'resultRef', j.result_ref,
    'reservationId', j.reservation_id,
    'authorizedBudgetCredits', j.authorized_budget_credits,
    'metadata', j.metadata
  );
$$;

-- Nothing in this feature is reachable without signing in, and the four
-- worker RPCs are not reachable by a signed-in customer either.
revoke execute on function public.background_job_start(text, text, text, uuid, text, text, uuid, numeric, jsonb) from anon;
revoke execute on function public.background_job_cancel(uuid) from anon;
revoke execute on function public.background_job_progress(uuid, text, smallint, text, text, jsonb) from anon, authenticated;
revoke execute on function public.background_job_finish(uuid, text, text, text, text, text) from anon, authenticated;
revoke execute on function public.background_jobs_mine(integer, integer) from anon;
revoke execute on function public.background_job_get(uuid) from anon;
revoke execute on function public.background_job_for_subject(text, uuid) from anon;
revoke execute on function public.background_jobs_recover_stuck(integer, integer) from anon, authenticated;
revoke execute on function public.background_jobs_release_cancelled(integer) from anon, authenticated;
revoke execute on function public.background_jobs_assert_worker() from anon, authenticated;
revoke execute on function public.background_job_admin_force(uuid, text, text) from anon;
