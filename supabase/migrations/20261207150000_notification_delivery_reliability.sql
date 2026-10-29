-- saas-notify · reliable transactional notification delivery.
--
--   business event -> notify() -> notifications -> notification_deliveries -> Resend
--   -> email-webhook -> delivery status
--
-- Additive and backward compatible: every new column has a default or is nullable,
-- the status check only GAINS values, and code deployed before this migration keeps
-- writing QUEUED/SENT/FAILED/SKIPPED exactly as before.
--
-- 1 · notification types the subscription workstream emits through notify()
--     (SUBSCRIPTION_* already exist in production; restated idempotently so the
--     repository's enum contract test sees them) and TRIAL_USED (first free use
--     delivered). Added only; nothing below references them (Postgres requires that).
-- 2 · notification_deliveries: attempts, max_attempts, next/last attempt, last error,
--     the rendered payload (never the recipient address), essential + category, and
--     statuses RETRYING / DELIVERED / BOUNCED / COMPLAINED. FAILED stays terminal.
-- 3 · notification_preferences: per-category email switches and a bounce/complaint
--     suppression of OPTIONAL mail (essential mail is always sent).
-- 4 · service-role RPCs: claim due retries (lease, skip locked, idempotency window),
--     one-click unsubscribe.
-- 5 · admin RPCs: list deliveries, retry one now (audited in admin_audit_log).

alter type notification_type add value if not exists 'SUBSCRIPTION_ACTIVATED';
alter type notification_type add value if not exists 'SUBSCRIPTION_RENEWED';
alter type notification_type add value if not exists 'SUBSCRIPTION_ENDED';
alter type notification_type add value if not exists 'TRIAL_USED';
-- A period ending within 3 days with no recurring charge: the person pays next month by link.
alter type notification_type add value if not exists 'SUBSCRIPTION_PAYMENT_DUE';

-- ── 2. delivery reliability ────────────────────────────────────────────
alter table public.notification_deliveries
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 6,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text,
  add column if not exists payload jsonb,
  add column if not exists essential boolean,
  add column if not exists category text,
  add column if not exists delivered_at timestamptz,
  add column if not exists manual_retry_at timestamptz,
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.notification_deliveries.payload is
  'The rendered message (from, subject, html, text, headers) so a retry sends exactly the same email. Never the recipient address, which is read at send time. Admin-only (RLS).';
comment on column public.notification_deliveries.essential is
  'true: money or account state, always sent. false: optional, stopped by the email switch, a category switch or a bounce/complaint suppression. null: a legacy caller with its own policy.';

alter table public.notification_deliveries drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('QUEUED','RETRYING','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED','SKIPPED'));
alter table public.notification_deliveries drop constraint if exists notification_deliveries_attempts_check;
alter table public.notification_deliveries add constraint notification_deliveries_attempts_check
  check (attempts >= 0 and max_attempts between 1 and 20);

create index if not exists notification_deliveries_provider_message_idx
  on public.notification_deliveries (provider_message_id) where provider_message_id is not null;
create index if not exists notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at) where status in ('QUEUED','RETRYING');
create index if not exists notification_deliveries_created_idx
  on public.notification_deliveries (created_at desc);

-- ── 3. email preferences ───────────────────────────────────────────────
alter table public.notification_preferences
  add column if not exists email_categories jsonb not null default '{}'::jsonb,
  add column if not exists email_suppressed_at timestamptz,
  add column if not exists email_suppressed_reason text;
comment on column public.notification_preferences.email_categories is
  'Optional transactional email switches by category (ai_results, billing); false turns one off. Essential mail ignores it.';
comment on column public.notification_preferences.email_suppressed_at is
  'Set by email-webhook on a complaint or a permanent bounce: optional email stops. Lifting it is a human decision.';

-- ── 4a. claim due retries (jobs-worker, service role) ──────────────────
-- A row is due when it is RETRYING and its time has come, or QUEUED with a stale
-- lease (the sender died between claim and answer). Claiming moves it back to
-- QUEUED, counts the attempt and stamps the lease; the sender then writes the
-- outcome guarded on (status QUEUED, attempts). Rows past max_attempts, without a
-- payload, or older than 23 h (Resend keeps an Idempotency-Key for 24 h, so a later
-- resend could duplicate) are closed as FAILED instead of claimed.
create or replace function public.notification_delivery_claim_due(p_limit integer default 20, p_stale_seconds integer default 600)
returns setof public.notification_deliveries
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_stale interval := make_interval(secs => greatest(60, least(coalesce(p_stale_seconds, 600), 86400)));
begin
  update public.notification_deliveries d
     set status = 'FAILED', next_attempt_at = null, updated_at = now(), status_changed_at = now(),
         last_error = case
           when d.payload is null then 'NO_PAYLOAD_TO_RETRY'
           when d.attempts >= d.max_attempts then coalesce('MAX_ATTEMPTS ' || d.last_error, 'MAX_ATTEMPTS')
           else 'RETRY_WINDOW_EXPIRED' end,
         reason = coalesce(d.reason, 'RETRY_CLOSED')
   where d.channel = 'EMAIL'
     and ((d.status = 'RETRYING' and d.next_attempt_at <= now())
       or (d.status = 'QUEUED' and coalesce(d.last_attempt_at, d.created_at) < now() - v_stale))
     and (d.payload is null or d.attempts >= d.max_attempts
       or coalesce(d.manual_retry_at, d.created_at) < now() - interval '23 hours');

  return query
  with due as (
    select d.id from public.notification_deliveries d
     where d.channel = 'EMAIL' and d.payload is not null and d.attempts < d.max_attempts
       and coalesce(d.manual_retry_at, d.created_at) >= now() - interval '23 hours'
       and ((d.status = 'RETRYING' and d.next_attempt_at <= now())
         or (d.status = 'QUEUED' and coalesce(d.last_attempt_at, d.created_at) < now() - v_stale))
     order by coalesce(d.next_attempt_at, d.created_at)
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked)
  update public.notification_deliveries d
     set status = 'QUEUED', attempts = d.attempts + 1, last_attempt_at = now(), next_attempt_at = null,
         updated_at = now(), status_changed_at = now()
    from due where d.id = due.id
  returning d.*;
end $$;
revoke all on function public.notification_delivery_claim_due(integer, integer) from public, anon, authenticated;
grant execute on function public.notification_delivery_claim_due(integer, integer) to service_role;

-- ── 4b. one-click unsubscribe (email-webhook, service role, after HMAC check) ──
-- Turns one optional category off for the account. Returns the account language for
-- the confirmation page. Idempotent. Never touches essential mail.
create or replace function public.notification_email_unsubscribe(p_user_id uuid, p_category text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lang text;
  v_already boolean;
begin
  if p_category not in ('ai_results', 'billing') then
    return jsonb_build_object('ok', false, 'error', 'BAD_CATEGORY');
  end if;
  select preferred_language into v_lang from public.users where id = p_user_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select coalesce((email_categories ->> p_category) = 'false', false) into v_already
    from public.notification_preferences where user_id = p_user_id;
  insert into public.notification_preferences (user_id, email_categories)
  values (p_user_id, jsonb_build_object(p_category, false))
  on conflict (user_id) do update
    set email_categories = coalesce(public.notification_preferences.email_categories, '{}'::jsonb) || jsonb_build_object(p_category, false),
        updated_at = now();
  return jsonb_build_object('ok', true, 'already', coalesce(v_already, false), 'language', v_lang);
end $$;
revoke all on function public.notification_email_unsubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_email_unsubscribe(uuid, text) to service_role;

-- ── 5a. admin: the delivery log ────────────────────────────────────────
-- Metadata only: no payload, no address, no message text.
create or replace function public.admin_notification_deliveries(p_filter text default 'ALL', p_days integer default 7, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select d.id, d.created_at, d.source, d.event_key, d.status, d.attempts, d.max_attempts,
             d.next_attempt_at, d.last_attempt_at, d.status_changed_at, d.delivered_at, d.manual_retry_at,
             left(coalesce(d.last_error, d.reason), 300) as last_error, d.essential, d.category,
             d.notification_id, d.user_id, (d.provider_message_id is not null) as has_provider_id,
             (d.payload is not null) as retryable_payload
        from public.notification_deliveries d
       where d.channel = 'EMAIL' and d.created_at >= v_since
         and (coalesce(p_filter, 'ALL') = 'ALL'
           or (p_filter = 'PROBLEMS' and d.status in ('RETRYING','FAILED','BOUNCED','COMPLAINED','QUEUED'))
           or d.status = p_filter)
       order by d.created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_notification_deliveries(text, integer, integer) from public, anon;
grant execute on function public.admin_notification_deliveries(text, integer, integer) to authenticated;

-- ── 5b. admin: retry one delivery now (audited) ────────────────────────
-- Schedules the delivery for the next jobs-worker tick under the SAME delivery id,
-- so the provider idempotency key is reused within 24 h of this request. Delivered,
-- bounced, complained and skipped rows are refused: retrying those would send a
-- second copy or mail somebody who must not be mailed.
create or replace function public.admin_notification_delivery_retry(p_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.notification_deliveries%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.notification_deliveries where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if v.channel <> 'EMAIL' then return jsonb_build_object('ok', false, 'error', 'NOT_EMAIL'); end if;
  if v.payload is null then return jsonb_build_object('ok', false, 'error', 'NO_PAYLOAD'); end if;
  if v.status not in ('FAILED', 'RETRYING', 'QUEUED') then
    return jsonb_build_object('ok', false, 'error', 'NOT_RETRYABLE_' || v.status);
  end if;
  update public.notification_deliveries
     set status = 'RETRYING', next_attempt_at = now(), manual_retry_at = now(),
         max_attempts = least(20, greatest(max_attempts, attempts + 1)),
         updated_at = now(), status_changed_at = now()
   where id = p_id;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), v.user_id,
          'notification_delivery.retry', 'notification_deliveries', p_id::text,
          jsonb_build_object('from_status', v.status, 'attempts', v.attempts, 'event_key', v.event_key,
                             'note', left(coalesce(p_note, ''), 300)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_notification_delivery_retry(uuid, text) from public, anon;
grant execute on function public.admin_notification_delivery_retry(uuid, text) to authenticated;
