-- HOMATCH — "Log in as user", made real and made read-only.
--
-- HOW A SESSION IS RECOGNISED
--
-- impersonate-user mints a short-lived Supabase session for the target (a
-- magic link generated and verified server-side; the link never leaves the
-- function, and the refresh token is never returned). Every access token of
-- that session carries its `session_id` claim, and the function records that
-- id on the impersonation_sessions row. So "is this request an admin viewing
-- as somebody?" is one indexed equality on a signed claim — not a header the
-- browser could omit, not a flag the client could clear.
--
-- A session_id recorded here stays an impersonation session FOREVER, ended or
-- not. An access token outlives the Exit button by up to its own expiry, and a
-- rule that only held "while active" would hand the rest of that hour back as
-- a fully-writable login.
--
-- WHAT READ-ONLY MEANS, IN THE DATABASE
--
--   * RESTRICTIVE row-level policies on the tables a customer writes through
--     PostgREST (messages, conversations, properties, payments, push
--     subscriptions, their profile, ...). Restrictive policies are ANDed with
--     every permissive one, so no existing policy can accidentally re-open a
--     write.
--   * BEFORE triggers on the money and message tables, because SECURITY
--     DEFINER functions run as their owner and bypass RLS — a trigger fires
--     whoever the function runs as, and reads the CALLER's JWT.
--
-- Service-role writes (webhooks, workers) carry no session_id and are
-- untouched. Edge functions that act with the service role on a customer's
-- behalf check is_impersonated_session themselves (see
-- supabase/functions/_shared/impersonation.ts).

alter table public.impersonation_sessions add column if not exists auth_session_id uuid;
alter table public.impersonation_sessions add column if not exists target_auth_id uuid;
alter table public.impersonation_sessions add column if not exists expires_at timestamptz;
alter table public.impersonation_sessions add column if not exists ended_reason text;
alter table public.impersonation_sessions add column if not exists revoked_at timestamptz;

create unique index if not exists impersonation_sessions_auth_session_key
  on public.impersonation_sessions (auth_session_id) where auth_session_id is not null;
create index if not exists impersonation_sessions_open_idx
  on public.impersonation_sessions (admin_id) where ended_at is null;

/*
 * True when the CALLER's token belongs to a session minted for impersonation.
 *
 * SECURITY DEFINER so it can read impersonation_sessions (admins-only RLS)
 * from inside a customer's policy check. It reveals one boolean about the
 * caller's own token and nothing else.
 */
create or replace function public.is_impersonated_session()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
begin
  /* Branch, then cast: a claim that is not a uuid is simply not ours. */
  if v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.impersonation_sessions i
     where i.auth_session_id = v_sid::uuid);
end $$;

revoke all on function public.is_impersonated_session() from public, anon;
grant execute on function public.is_impersonated_session() to authenticated, service_role;

-- ── restrictive policies ────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'conversations', 'conversation_contact_shares', 'live_chat_messages',
    'properties', 'property_facts', 'property_photos', 'viewing_requests',
    'matching_campaigns', 'payments', 'payment_methods', 'push_subscriptions',
    'users', 'user_preferences', 'notification_preferences', 'ai_messages'
  ] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists impersonation_no_insert on public.%I', t);
    execute format('drop policy if exists impersonation_no_update on public.%I', t);
    execute format('drop policy if exists impersonation_no_delete on public.%I', t);
    execute format(
      'create policy impersonation_no_insert on public.%I as restrictive for insert to authenticated '
      'with check (not (select public.is_impersonated_session()))', t);
    execute format(
      'create policy impersonation_no_update on public.%I as restrictive for update to authenticated '
      'using (not (select public.is_impersonated_session())) with check (not (select public.is_impersonated_session()))', t);
    execute format(
      'create policy impersonation_no_delete on public.%I as restrictive for delete to authenticated '
      'using (not (select public.is_impersonated_session()))', t);
  end loop;
end $$;

-- ── triggers where RLS does not reach ───────────────────────────────────
create or replace function public.homatch_refuse_when_impersonated()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_impersonated_session() then
    raise exception 'READ_ONLY_IMPERSONATION: % on % is not allowed while an administrator is viewing as this user',
      tg_op, tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.homatch_refuse_when_impersonated() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'credit_ledger', 'credit_reservations', 'usage_reservations', 'credit_accounts',
    'payments', 'payment_methods', 'push_subscriptions',
    'messages', 'live_chat_messages', 'conversation_contact_shares'
  ] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop trigger if exists trg_refuse_when_impersonated on public.%I', t);
    execute format(
      'create trigger trg_refuse_when_impersonated before insert or update or delete on public.%I '
      'for each row execute function public.homatch_refuse_when_impersonated()', t);
  end loop;
end $$;

-- ── the sessions, for the admin who ran them ───────────────────────────
create or replace function public.admin_impersonation_sessions(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'enabled', coalesce((select s.value in ('true'::jsonb, '"true"'::jsonb)
                           from public.admin_settings s where s.key = 'admin_impersonation_enabled'), false),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'admin', (select jsonb_build_object('id', u.id, 'email', u.email)
                    from public.users u where u.auth_id = i.admin_id limit 1),
        'target', public.homatch_user_brief(i.target_user_id),
        'reason', i.reason,
        'started_at', i.started_at,
        'expires_at', i.expires_at,
        'ended_at', i.ended_at,
        'ended_reason', i.ended_reason,
        'revoked', i.revoked_at is not null) order by i.started_at desc)
        from (select * from public.impersonation_sessions
               order by started_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) i),
      '[]'::jsonb));
end $$;

revoke all on function public.admin_impersonation_sessions(integer) from public, anon;
grant execute on function public.admin_impersonation_sessions(integer) to authenticated;

-- ── the switch, present and OFF ─────────────────────────────────────────
-- impersonate-user refuses to start unless admin_impersonation_enabled is
-- true. The row did not exist, so the Settings page (which lists existing
-- rows) had nothing to show and the only way to turn the feature on was SQL.
-- It is created OFF; turning it on remains a deliberate, audited
-- admin_set_setting call. An existing value is never overwritten.
insert into public.admin_settings (key, value, description)
values ('admin_impersonation_enabled', 'false'::jsonb,
        'Allows administrators to "Log in as user": a short-lived, read-only session as the customer, audited at start and end. Off unless deliberately enabled.')
on conflict (key) do nothing;
