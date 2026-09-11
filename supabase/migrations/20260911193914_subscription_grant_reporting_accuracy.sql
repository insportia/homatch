-- A duplicate membership grant was reporting the EXISTING lot's size as
-- credits_granted. Nothing was minted, but subscription_events said 90 and so
-- did the value returned to the webhook handler. Any "credits granted this
-- month" report built on that would over-count every redelivered renewal.
--
-- v_granted now means "credits actually minted by THIS call": 0 for a
-- duplicate, 0 when the rollover cap swallowed it, the real figure otherwise.
-- The event type follows, so GRANT_SKIPPED covers both no-op cases.
-- grant_was_duplicate is surfaced to the caller so a webhook can tell "already
-- processed" apart from "capped".

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
  v_capped boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_plan from public.billing_plans where code = p_plan_code and enabled = true;
  if not found then raise exception 'UNKNOWN_PLAN: %', p_plan_code; end if;

  if exists (select 1 from public.subscription_events where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('duplicate', true, 'credits_granted', 0,
                              'plan_code', public.billing_current_plan(p_user_id));
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
    -- Downgrade / cancellation. The wallet is not touched; purchased credits
    -- stay exactly where they are.
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

    v_dup := COALESCE(v_grant.was_duplicate, false);
    -- Credits actually minted by THIS call. A duplicate mints nothing.
    v_granted := case when v_dup then 0 else COALESCE(v_grant.credits_granted, 0) end;
    v_lot := v_grant.lot_id;
    v_capped := (not v_dup) and v_granted < v_plan.membership_credits_grant;
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
            'rollover_capped', v_capped,
            'requested_event_type', p_event_type));

  return jsonb_build_object(
    'duplicate', false,
    'subscription_id', v_sub_id,
    'plan_code', p_plan_code,
    'previous_plan_code', v_prev_plan,
    'credits_granted', v_granted,
    'grant_was_duplicate', v_dup,
    'rollover_capped', v_capped,
    'period_start', v_start,
    'period_end', v_end);
end;
$fn$;

REVOKE ALL ON FUNCTION public.subscription_apply_plan(uuid, text, text, text, timestamptz, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_apply_plan(uuid, text, text, text, timestamptz, timestamptz, text, text, jsonb) TO service_role;
