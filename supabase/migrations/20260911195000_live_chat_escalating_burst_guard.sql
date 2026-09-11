-- Homatch — stop bursts without punishing conversation.
--
-- WHAT WAS THERE
--
-- live_chat_messages_insert carried `NOT EXISTS (... created_at > now() -
-- interval '2 seconds')`. That is a flat throttle, and it has the wrong shape
-- for the problem: it blocks the second message of a normal exchange (people
-- do send "yes" then "when?" a second apart) while doing nothing at all to
-- someone who paces a flood at one message every 2.1 seconds.
--
-- WHAT REPLACES IT
--
-- A burst counter with an escalating, decaying cooldown. Three messages inside
-- a short window is a burst; the first burst costs 5 seconds, then 10, 20, 60,
-- and an hour if it keeps happening. Every number is a setting.
--
--   live_chat_burst_count           3      messages that constitute a burst
--   live_chat_burst_window_seconds  5      the window they must fall inside
--   live_chat_cooldown_ladder    [5,10,20,60,3600]  seconds, by strike
--   live_chat_strike_decay_hours    24     quiet time that clears the record
--
-- DECAY IS THE POINT
--
-- "Old violations must not permanently follow a user." A day of normal
-- behaviour resets the ladder to zero, so somebody who got excited once in
-- March does not start at a one-hour cooldown in June. The strike count is
-- decayed on READ as well as on write, so the reset needs no cron job.
--
-- WHY A TRIGGER AND NOT RLS
--
-- An RLS policy can only say yes or no. A customer who is throttled needs to
-- know for how long, and a BEFORE INSERT trigger can raise a message carrying
-- the remaining seconds. The ownership and suspension checks stay in RLS,
-- where they belong.
--
-- VERIFIED ON PRODUCTION, against a probe account since removed:
--   strike0=>5s | strike1=>10s | strike2=>20s | strike3=>60s | strike4=>3600s
--   strike5=>3600s (the top rung repeats rather than wrapping to 5s)
--   two_rapid=>0s (ordinary conversation costs nothing)
--   after_24h_decay_strikes=>0
--   during_cooldown=>LIVE_CHAT_COOLDOWN:30

ALTER TABLE public.live_chat_profiles
  ADD COLUMN IF NOT EXISTS burst_strikes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_strike_at timestamptz;

COMMENT ON COLUMN public.live_chat_profiles.burst_strikes IS
  'Escalation position on the cooldown ladder. Decays to 0 after live_chat_strike_decay_hours of no new strike, so a past burst does not follow someone forever.';

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('live_chat_burst_count', '3'::jsonb,
   'How many messages inside the burst window count as a burst. Ordinary back-and-forth must stay under this.'),
  ('live_chat_burst_window_seconds', '5'::jsonb,
   'The window a burst has to fit inside, in seconds.'),
  ('live_chat_cooldown_ladder', '[5, 10, 20, 60, 3600]'::jsonb,
   'Cooldown in seconds by strike number. The last value repeats for further strikes.'),
  ('live_chat_strike_decay_hours', '24'::jsonb,
   'Quiet hours after which the strike count returns to zero.')
ON CONFLICT (key) DO NOTHING;

-- Read-only: what the composer should show right now. Safe for a customer to
-- call about themselves; the countdown it returns is advisory and the trigger
-- is what actually enforces.
CREATE OR REPLACE FUNCTION public.live_chat_cooldown_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_uid uuid;
  v_p record;
  v_decay integer;
  v_strikes integer;
begin
  v_uid := public.auth_user_id();
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select burst_strikes, cooldown_until, last_strike_at, suspended
    into v_p from public.live_chat_profiles where user_id = v_uid;
  if not found then
    return jsonb_build_object('cooldown_seconds_remaining', 0, 'strikes', 0, 'suspended', false);
  end if;

  v_decay := public.billing_setting_num('live_chat_strike_decay_hours', 24)::integer;
  -- Decay on read, so the customer sees a cleared record without waiting for
  -- their next message to clear it.
  v_strikes := case
    when v_p.last_strike_at is null then 0
    when v_p.last_strike_at < now() - (v_decay || ' hours')::interval then 0
    else v_p.burst_strikes end;

  return jsonb_build_object(
    'cooldown_seconds_remaining',
      greatest(0, ceil(extract(epoch from (coalesce(v_p.cooldown_until, now()) - now()))))::integer,
    'strikes', v_strikes,
    'suspended', coalesce(v_p.suspended, false));
end;
$fn$;
REVOKE ALL ON FUNCTION public.live_chat_cooldown_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_chat_cooldown_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.live_chat_burst_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
declare
  v_burst_count integer := public.billing_setting_num('live_chat_burst_count', 3)::integer;
  v_window integer := public.billing_setting_num('live_chat_burst_window_seconds', 5)::integer;
  v_decay integer := public.billing_setting_num('live_chat_strike_decay_hours', 24)::integer;
  v_ladder jsonb;
  v_p record;
  v_strikes integer;
  v_recent integer;
  v_cooldown integer;
  v_remaining integer;
begin
  -- Admins and moderators are not throttled: they need to be able to answer a
  -- flood, and support tooling must not be rate-limited out of a live incident.
  if public.is_admin() then return NEW; end if;

  select burst_strikes, cooldown_until, last_strike_at
    into v_p from public.live_chat_profiles where user_id = NEW.user_id for update;
  if not found then return NEW; end if;

  -- 1. Still cooling down?
  if v_p.cooldown_until is not null and v_p.cooldown_until > now() then
    v_remaining := ceil(extract(epoch from (v_p.cooldown_until - now())))::integer;
    raise exception 'LIVE_CHAT_COOLDOWN:%', v_remaining
      using hint = 'Wait before sending again.';
  end if;

  -- 2. Decay first, so a long-quiet account starts from zero.
  v_strikes := case
    when v_p.last_strike_at is null then 0
    when v_p.last_strike_at < now() - (v_decay || ' hours')::interval then 0
    else v_p.burst_strikes end;

  -- 3. Is THIS message the one that completes a burst? Count the messages
  --    already inside the window; this one makes v_recent + 1.
  select count(*) into v_recent
    from public.live_chat_messages m
   where m.user_id = NEW.user_id
     and m.created_at > now() - (v_window || ' seconds')::interval;

  if v_recent + 1 >= v_burst_count then
    v_ladder := coalesce(
      (select value from public.admin_settings where key = 'live_chat_cooldown_ladder'),
      '[5, 10, 20, 60, 3600]'::jsonb);

    -- The ladder's last rung repeats, so continued abuse stays at the top
    -- rather than wrapping around to 5 seconds again.
    v_cooldown := coalesce(
      (v_ladder ->> least(v_strikes, jsonb_array_length(v_ladder) - 1))::integer, 5);

    update public.live_chat_profiles
       set burst_strikes = v_strikes + 1,
           last_strike_at = now(),
           cooldown_until = now() + (v_cooldown || ' seconds')::interval,
           updated_at = now()
     where user_id = NEW.user_id;

    -- The message that TRIGGERED the cooldown is still delivered. Swallowing
    -- it would lose something the customer actually wrote, and the point is to
    -- slow the next one down, not to punish this one.
    return NEW;
  end if;

  -- 4. Normal message. If the decay cleared the record, persist that.
  if v_strikes <> v_p.burst_strikes then
    update public.live_chat_profiles
       set burst_strikes = 0, updated_at = now()
     where user_id = NEW.user_id;
  end if;

  return NEW;
end;
$fn$;
REVOKE EXECUTE ON FUNCTION public.live_chat_burst_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_live_chat_burst_guard ON public.live_chat_messages;
CREATE TRIGGER trg_live_chat_burst_guard
  BEFORE INSERT ON public.live_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.live_chat_burst_guard();

-- Replace the flat 2-second throttle in RLS. Ownership and suspension stay;
-- pacing is now the trigger's job, because only the trigger can tell the
-- customer how long is left.
DROP POLICY IF EXISTS live_chat_messages_insert ON public.live_chat_messages;
CREATE POLICY live_chat_messages_insert ON public.live_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.auth_user_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.live_chat_profiles p
       WHERE p.user_id = public.auth_user_id() AND p.suspended = true)
  );
