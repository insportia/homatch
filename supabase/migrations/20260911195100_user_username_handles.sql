-- Homatch — a unique handle, separate from the display name.
--
-- WHAT ALREADY EXISTED, AND WHY THIS IS NOT A DUPLICATE
--
--   users.full_name   the real/legal name
--   users.nickname    a user-chosen DISPLAY name (20260902072337). Not unique,
--                     not a handle, free to contain spaces and any script.
--   live_chat_profiles.nickname  a separate public identity for the chat room
--
-- None of those is an addressable handle. This adds one: unique,
-- case-insensitively, so @tarieli is @Tarieli is @TARIELI, and shaped so it can
-- safely appear in a URL later without any escaping.
--
-- THE ID NEVER MOVES
--
-- users.id stays the only thing anything references. A username is a label on
-- a row, never a key, so changing one cannot break a foreign key or orphan a
-- history record. That is the whole reason the change cooldown can be a
-- product decision rather than a data-integrity one.
--
-- WHAT IS REJECTED, AND WHY
--
--   length              3..24
--   charset             a-z, 0-9, underscore. ASCII only, deliberately:
--                       mixed-script handles enable homograph impersonation
--                       (a Cyrillic "а" in an otherwise Latin name), and a
--                       handle exists to be typed and trusted.
--   shape               must start with a letter; no leading/trailing or
--                       doubled underscore, so @_ and @a__b cannot be used to
--                       near-duplicate somebody else's handle
--   reserved            admin, support, billing, homatch and friends, so a
--                       customer cannot pass themselves off as the company;
--                       plus every current route name, so a future /u/:username
--                       can never shadow a real page
--
-- The cooldown is 30 days and configurable. The FIRST username is free to set
-- immediately; the cooldown only applies to changes, and re-setting the same
-- handle is a no-op that does not restart it.
--
-- VERIFIED ON PRODUCTION (probe accounts, since cleaned):
--   'tarieli' accepted; 'ab' TOO_SHORT; 25 chars TOO_LONG; '1abc'/'_abc'/
--   'tar ieli'/'tar-ieli' INVALID_CHARACTERS; 'abc_' TRAILING_UNDERSCORE;
--   'a__b' DOUBLE_UNDERSCORE; 'Admin'/'pricing'/'homatch' RESERVED;
--   a Cyrillic-а homograph INVALID_CHARACTERS; a second account taking
--   'TarieLi' TAKEN; an immediate change COOLDOWN with next_allowed_at.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS username_changed_at timestamptz;

COMMENT ON COLUMN public.users.username IS
  'Unique public handle, stored lowercase. Case-insensitively unique via uidx_users_username_lower. Never used as a foreign key: users.id is the identity.';

CREATE UNIQUE INDEX IF NOT EXISTS uidx_users_username_lower
  ON public.users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reserved_usernames (
  username text PRIMARY KEY,
  reason text NOT NULL DEFAULT 'RESERVED',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reserved_usernames ENABLE ROW LEVEL SECURITY;
CREATE POLICY reserved_usernames_read ON public.reserved_usernames
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY reserved_usernames_admin ON public.reserved_usernames
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY reserved_usernames_service ON public.reserved_usernames
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.reserved_usernames (username, reason) VALUES
  ('homatch','BRAND'), ('homatchai','BRAND'), ('homatch_ai','BRAND'), ('team','BRAND'),
  ('admin','IMPERSONATION'), ('administrator','IMPERSONATION'), ('moderator','IMPERSONATION'),
  ('mod','IMPERSONATION'), ('staff','IMPERSONATION'), ('official','IMPERSONATION'),
  ('support','IMPERSONATION'), ('help','IMPERSONATION'), ('billing','IMPERSONATION'),
  ('payments','IMPERSONATION'), ('security','IMPERSONATION'), ('verify','IMPERSONATION'),
  ('verified','IMPERSONATION'), ('system','IMPERSONATION'), ('root','IMPERSONATION'),
  ('about','ROUTE'), ('pricing','ROUTE'), ('credits','ROUTE'), ('profile','ROUTE'),
  ('dashboard','ROUTE'), ('settings','ROUTE'), ('auth','ROUTE'), ('login','ROUTE'),
  ('signup','ROUTE'), ('api','ROUTE'), ('null','ROUTE'), ('undefined','ROUTE'),
  ('me','ROUTE'), ('new','ROUTE'), ('search','ROUTE'), ('privacy','ROUTE'), ('terms','ROUTE')
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('username_change_cooldown_days', '30'::jsonb,
   'Days a customer must wait between username changes. The first username can be set immediately.'),
  ('username_min_length', '3'::jsonb, 'Minimum username length.'),
  ('username_max_length', '24'::jsonb, 'Maximum username length.')
ON CONFLICT (key) DO NOTHING;

-- Shape validation, shared by the check and the setter so they can never
-- disagree about what is valid.
CREATE OR REPLACE FUNCTION public.username_rejection_reason(p_username text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_min integer := public.billing_setting_num('username_min_length', 3)::integer;
  v_max integer := public.billing_setting_num('username_max_length', 24)::integer;
  v_u text := lower(trim(coalesce(p_username, '')));
begin
  if v_u = '' then return 'EMPTY'; end if;
  if length(v_u) < v_min then return 'TOO_SHORT'; end if;
  if length(v_u) > v_max then return 'TOO_LONG'; end if;
  -- ASCII only. A handle that can be spelled two ways cannot be trusted.
  if v_u !~ '^[a-z][a-z0-9_]*$' then return 'INVALID_CHARACTERS'; end if;
  if v_u ~ '__' then return 'DOUBLE_UNDERSCORE'; end if;
  if v_u ~ '_$' then return 'TRAILING_UNDERSCORE'; end if;
  if exists (select 1 from public.reserved_usernames r where r.username = v_u) then return 'RESERVED'; end if;
  return NULL;
end;
$fn$;

-- Availability, for the UI. Says nothing about who holds a taken handle.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_reason text := public.username_rejection_reason(p_username);
  v_u text := lower(trim(coalesce(p_username, '')));
  v_uid uuid := public.auth_user_id();
begin
  if v_reason is not null then
    return jsonb_build_object('available', false, 'reason', v_reason);
  end if;
  if exists (select 1 from public.users u
              where lower(u.username) = v_u and (v_uid is null or u.id <> v_uid)) then
    return jsonb_build_object('available', false, 'reason', 'TAKEN');
  end if;
  return jsonb_build_object('available', true, 'normalized', v_u);
end;
$fn$;

-- The only way a username is set. The owner calls it for themselves; the
-- cooldown, the shape and the uniqueness are all decided here rather than in a
-- form.
CREATE OR REPLACE FUNCTION public.set_my_username(p_username text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_uid uuid := public.auth_user_id();
  v_u text := lower(trim(coalesce(p_username, '')));
  v_reason text;
  v_cooldown integer := public.billing_setting_num('username_change_cooldown_days', 30)::integer;
  v_current record;
  v_next_allowed timestamptz;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  v_reason := public.username_rejection_reason(v_u);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  select username, username_changed_at into v_current from public.users where id = v_uid for update;

  -- Setting the same handle again is a no-op, not a change, so it must not
  -- start a 30-day cooldown.
  if v_current.username is not null and lower(v_current.username) = v_u then
    return jsonb_build_object('ok', true, 'username', v_u, 'unchanged', true);
  end if;

  -- The FIRST username is free. Only changes wait.
  if v_current.username is not null and v_current.username_changed_at is not null then
    v_next_allowed := v_current.username_changed_at + (v_cooldown || ' days')::interval;
    if now() < v_next_allowed then
      return jsonb_build_object(
        'ok', false, 'reason', 'COOLDOWN',
        'next_allowed_at', v_next_allowed,
        'cooldown_days', v_cooldown);
    end if;
  end if;

  begin
    update public.users
       set username = v_u, username_changed_at = now(), updated_at = now()
     where id = v_uid;
  exception when unique_violation then
    -- Somebody claimed it between the availability check and here. The index
    -- is the arbiter, not the check.
    return jsonb_build_object('ok', false, 'reason', 'TAKEN');
  end;

  return jsonb_build_object(
    'ok', true, 'username', v_u,
    'next_change_allowed_at', now() + (v_cooldown || ' days')::interval);
end;
$fn$;

REVOKE ALL ON FUNCTION public.username_rejection_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.username_rejection_reason(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_my_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_username(text) TO authenticated, service_role;

-- username and username_changed_at must not be writable directly: the whole
-- point of set_my_username() is that the cooldown cannot be skipped by a
-- client updating its own row, which users_update_own otherwise permits.
REVOKE UPDATE (username, username_changed_at) ON public.users FROM anon, authenticated;
