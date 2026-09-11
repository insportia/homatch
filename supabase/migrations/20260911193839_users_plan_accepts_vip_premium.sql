-- users.plan was added in 20260830120000 with CHECK (plan IN ('FREE','PLUS','PRO'))
-- and a BEFORE UPDATE trigger that reverts the column unless the caller is the
-- service role.
--
-- TWO REAL PROBLEMS THIS FIXES
--
-- 1. The check constraint does not know about VIP or PREMIUM. Under a genuine
--    service-role call, subscription_apply_plan()'s mirror write would have hit
--    a constraint violation and rolled the whole subscription back. It did not
--    surface during acceptance testing only because a direct database session
--    has auth.role() = NULL, so the trigger silently reverted the value before
--    the constraint ever saw it. That is the worst kind of latent bug: green in
--    testing, red the first time a customer actually subscribes.
--
-- 2. The trigger keys off auth.role(), which is a request-level JWT claim.
--    subscription_apply_plan() is SECURITY DEFINER and is the ONLY sanctioned
--    writer of this column, but it had no way to say so. It now sets a
--    transaction-local flag -- the same mechanism
--    credit_lots_follow_legacy_debit() uses -- so the mirror works however the
--    RPC is reached while ordinary authenticated users stay locked out exactly
--    as before.
--
-- PLUS and PRO are KEPT. homatch-ai still reads them for its AI fair-use lookup
-- and src/components/matching/CommunityOutreachPanel.tsx still types them.
-- Removing them here would be a breaking change for working code; they are
-- simply no longer issued.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('FREE','PLUS','PRO','VIP','PREMIUM'));

CREATE OR REPLACE FUNCTION public.protect_privileged_user_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND COALESCE(current_setting('homatch.billing_engine', true), '') <> 'on' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.protect_privileged_user_columns() FROM PUBLIC, anon, authenticated;

-- is_admin is NOT reachable through the new flag: subscription_apply_plan only
-- ever writes plan, and nothing else sets homatch.billing_engine.
COMMENT ON FUNCTION public.protect_privileged_user_columns() IS
  'Blocks client-side writes to users.is_admin and users.plan. The service role, and subscription_apply_plan() via the transaction-local homatch.billing_engine flag, may write plan. Nothing may write is_admin from a client.';

-- Teach the subscription writers to raise the flag. Bodies are otherwise
-- identical to 20260911193422.
CREATE OR REPLACE FUNCTION public.subscription_apply_plan(
  p_user_id uuid,
  p_plan_code text,
  p_idempotency_key text,
  p_event_type text DEFAULT 'CREATED',
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_subscription_id text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_plan record;
  v_existing record;
  v_sub_id uuid;
  v_prev_plan text;
  v_start timestamptz;
  v_end timestamptz;
  v_grant record;
  v_granted numeric := 0;
  v_lot uuid;
  v_dup boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_plan from public.billing_plans where code = p_plan_code and enabled = true;
  if not found then raise exception 'UNKNOWN_PLAN: %', p_plan_code; end if;

  if exists (select 1 from public.subscription_events where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'plan_code', public.billing_current_plan(p_user_id));
  end if;

  perform pg_advisory_xact_lock(hashtext('sub:' || p_user_id::text));
  perform set_config('homatch.billing_engine', 'on', true);

  v_prev_plan := public.billing_current_plan(p_user_id);
  v_start := COALESCE(p_period_start, now());
  v_end   := COALESCE(p_period_end, v_start + interval '1 month');

  select * into v_existing from public.user_subscriptions
   where user_id = p_user_id and status in ('ACTIVE','PAST_DUE')
   order by current_period_end desc limit 1;

  if p_plan_code = 'FREE' then
    if v_existing.id is not null then
      update public.user_subscriptions
         set status = 'CANCELLED', ended_at = now(), cancel_at_period_end = false, updated_at = now()
       where id = v_existing.id;
      v_sub_id := v_existing.id;
    end if;
  elsif v_existing.id is not null then
    update public.user_subscriptions
       set plan_code = p_plan_code, status = 'ACTIVE',
           current_period_start = v_start, current_period_end = v_end,
           cancel_at_period_end = false,
           provider = COALESCE(p_provider, provider),
           provider_subscription_id = COALESCE(p_provider_subscription_id, provider_subscription_id),
           ended_at = NULL, updated_at = now()
     where id = v_existing.id
    returning id into v_sub_id;
  else
    insert into public.user_subscriptions
      (user_id, plan_code, status, current_period_start, current_period_end, provider, provider_subscription_id)
    values (p_user_id, p_plan_code, 'ACTIVE', v_start, v_end, p_provider, p_provider_subscription_id)
    returning id into v_sub_id;
  end if;

  update public.users set plan = p_plan_code, updated_at = now() where id = p_user_id;

  if v_plan.membership_credits_grant > 0
     and public.billing_setting_bool('billing_membership_grants_enabled', true) then
    select * into v_grant from public.wallet_grant_credits(
      p_user_id, 'MEMBERSHIP', v_plan.membership_credits_grant, 'MEMBERSHIP_GRANT',
      'membership', v_sub_id::text || ':' || to_char(v_start, 'YYYYMMDDHH24MISS'),
      v_end + interval '1 month',
      p_plan_code, NULL,
      jsonb_build_object('event', p_event_type, 'cycle_start', v_start));
    v_granted := COALESCE(v_grant.credits_granted, 0);
    v_lot := v_grant.lot_id;
    v_dup := COALESCE(v_grant.was_duplicate, false);
  end if;

  insert into public.subscription_events
    (user_id, subscription_id, event_type, plan_code, previous_plan_code, idempotency_key, payload)
  values (p_user_id, v_sub_id,
          case when v_granted > 0 then p_event_type else
            case when v_plan.membership_credits_grant > 0 then 'GRANT_SKIPPED' else p_event_type end end,
          p_plan_code, v_prev_plan, p_idempotency_key,
          COALESCE(p_payload,'{}'::jsonb) || jsonb_build_object(
            'credits_granted', v_granted, 'lot_id', v_lot,
            'grant_was_duplicate', v_dup,
            'rollover_capped', (v_plan.membership_credits_grant > 0 and v_granted < v_plan.membership_credits_grant)));

  return jsonb_build_object(
    'duplicate', false,
    'subscription_id', v_sub_id,
    'plan_code', p_plan_code,
    'previous_plan_code', v_prev_plan,
    'credits_granted', v_granted,
    'rollover_capped', (v_plan.membership_credits_grant > 0 and v_granted < v_plan.membership_credits_grant),
    'period_start', v_start,
    'period_end', v_end);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.subscription_expire_lapsed(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_row record; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  perform set_config('homatch.billing_engine', 'on', true);
  for v_row in
    select * from public.user_subscriptions
     where status in ('ACTIVE','PAST_DUE') and current_period_end <= now()
     order by current_period_end limit p_limit
  loop
    update public.user_subscriptions
       set status = 'EXPIRED', ended_at = now(), updated_at = now() where id = v_row.id;
    update public.users set plan = 'FREE', updated_at = now() where id = v_row.user_id;
    insert into public.subscription_events
      (user_id, subscription_id, event_type, plan_code, previous_plan_code, idempotency_key, payload)
    values (v_row.user_id, v_row.id, 'EXPIRED', 'FREE', v_row.plan_code,
            'expire:' || v_row.id::text || ':' || to_char(v_row.current_period_end,'YYYYMMDDHH24MISS'),
            jsonb_build_object('reason','period_ended_without_renewal'))
    on conflict (idempotency_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

REVOKE ALL ON FUNCTION public.subscription_apply_plan(uuid, text, text, text, timestamptz, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_apply_plan(uuid, text, text, text, timestamptz, timestamptz, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.subscription_expire_lapsed(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expire_lapsed(integer) TO service_role;
