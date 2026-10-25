-- HOMATCH — a finished background job tells its owner, once, on every channel.
--
-- THE DEFECT (owner, 2026-10-25: "when Verify jobs and jobs in general finish I
-- get no notification by email, nor via the PWA, nor inside the site")
--
-- Read-only production evidence, last 30 days:
--   * 14 Find Buyers / Find Tenants searches COMPLETED and not one of them
--     produced a notification: nothing ever emitted one for FIND_CLIENTS.
--   * a contract analysis COMPLETED with no DOCUMENT_ANALYZED row: only the
--     worker path announced it, never the interactive one.
--   * 21 VERIFY_COMPLETE notifications, 0 email deliveries: the email leg
--     looked the recipient up by the auth id the producer passed (fixed in
--     _shared/notify.ts, which now emails the RESOLVED account).
--   * the only push subscription on record is revoked (fixed client side: a
--     granted browser re-registers itself).
--
-- THE SHAPE
--
-- One trigger on the one table every product's lifecycle already passes
-- through. background_jobs goes terminal in exactly one place per row
-- (background_job_finish refuses a second terminal write), so a transition
-- into COMPLETED or FAILED is the natural event. The trigger writes an OUTBOX
-- row, nothing else: no network call inside a customer's transaction, and a
-- failure to enqueue can never fail the job it describes.
--
-- jobs-worker (already ticking, already holding the service key) drains the
-- outbox through _shared/jobNotify.ts and calls notify(), which is the one
-- door: notify_emit (dedupe + in-app row + realtime), push-send (preferences,
-- quiet hours, category), and the transactional email (email_enabled,
-- default on, the switch already in Settings → Notifications).
--
-- IDEMPOTENCY, LAYERED
--   1. one outbox row per (job, terminal state): ON CONFLICT DO NOTHING
--   2. claim with FOR UPDATE SKIP LOCKED: two ticks never take the same row
--   3. notify_emit dedupe keys per job: a retried dispatch returns the
--      existing notification instead of a second one
--   4. push-send stamps pushed_at; email claims notification_deliveries
--      (unique on notification, channel) before it sends
--
-- Nothing is backfilled: only transitions after this migration are announced.
-- Telling somebody today about a verification they read last week is noise.

create table if not exists public.job_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.background_jobs(id) on delete cascade,
  terminal_state text not null check (terminal_state in ('COMPLETED', 'FAILED')),
  -- background_jobs.user_id: the AUTH id. notify_emit resolves it to the account.
  user_auth_id uuid not null,
  product_type text not null,
  subject_type text,
  subject_id uuid,
  subject_label text,
  result_ref text,
  user_safe_error text,
  job_created_at timestamptz,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts smallint not null default 0,
  dispatched_at timestamptz,
  -- What the dispatcher decided: NOTIFIED, ALREADY_TOLD, SKIP:<reason>, NO_RECIPIENT…
  outcome text,
  notification_id uuid,
  last_error text,
  unique (job_id, terminal_state)
);

comment on table public.job_notification_outbox is
  'One row per background job reaching COMPLETED or FAILED, written by trigger, drained by jobs-worker (_shared/jobNotify.ts) into notify(). Service role only.';

create index if not exists job_notification_outbox_pending_idx
  on public.job_notification_outbox (created_at)
  where dispatched_at is null;

alter table public.job_notification_outbox enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                 where c.relname = 'job_notification_outbox' and p.polname = 'job_notification_outbox_service') then
    create policy job_notification_outbox_service on public.job_notification_outbox
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on public.job_notification_outbox from public, anon, authenticated;
grant select, insert, update on public.job_notification_outbox to service_role;

-- ── The trigger ────────────────────────────────────────────────────────────

create or replace function public.background_jobs_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state not in ('COMPLETED', 'FAILED') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.state = new.state then
    return new;
  end if;
  begin
    insert into public.job_notification_outbox (
      job_id, terminal_state, user_auth_id, product_type, subject_type, subject_id,
      subject_label, result_ref, user_safe_error, job_created_at
    ) values (
      new.id, new.state, new.user_id, new.product_type, new.subject_type, new.subject_id,
      new.subject_label, new.result_ref, new.user_safe_error, new.created_at
    )
    on conflict (job_id, terminal_state) do nothing;
  exception when others then
    -- Telling somebody is a side effect of the job finishing. It must never
    -- be the reason the job could not finish.
    raise warning 'job notification enqueue failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.background_jobs_enqueue_notification() from public, anon, authenticated;

drop trigger if exists trg_background_jobs_enqueue_notification on public.background_jobs;
create trigger trg_background_jobs_enqueue_notification
  after insert or update of state on public.background_jobs
  for each row execute function public.background_jobs_enqueue_notification();

-- ── Draining ───────────────────────────────────────────────────────────────

/**
 * Take up to p_limit undispatched rows. A row claimed by a tick that died is
 * taken again after five minutes; after five attempts it stays for a person
 * to look at (outcome and last_error say why).
 */
create or replace function public.job_notification_claim(p_limit integer default 20)
returns setof public.job_notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  with picked as (
    select o.id
      from public.job_notification_outbox o
     where o.dispatched_at is null
       and o.attempts < 5
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
  ), claimed as (
    update public.job_notification_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.*
  )
  select * from claimed;
end $$;

create or replace function public.job_notification_done(
  p_id uuid,
  p_outcome text,
  p_notification_id uuid default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_error is not null then
    -- Not dispatched: released for the next tick, with the reason kept.
    update public.job_notification_outbox
       set claimed_at = null, last_error = left(p_error, 500), outcome = left(p_outcome, 80)
     where id = p_id;
  else
    update public.job_notification_outbox
       set dispatched_at = now(), outcome = left(p_outcome, 80),
           notification_id = p_notification_id, last_error = null
     where id = p_id;
  end if;
end $$;

revoke all on function public.job_notification_claim(integer) from public, anon, authenticated;
revoke all on function public.job_notification_done(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.job_notification_claim(integer) to service_role;
grant execute on function public.job_notification_done(uuid, text, uuid, text) to service_role;
