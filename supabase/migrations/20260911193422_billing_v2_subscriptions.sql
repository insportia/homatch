-- HOMATCH BILLING v2 — part 4 of 4: subscriptions, promotions, and the
-- customer-safe quote.
--
-- The rule this file exists to enforce: a subscription and a wallet are
-- different things. Buying VIP changes the plan, the quality tier, the member
-- rate and the monthly grant. It does not touch a single purchased credit.
-- Cancelling VIP does not take one back.
--
-- NOTE: subscription_apply_plan is revised twice after this
-- (20260911193839 teaches it to write the users.plan mirror,
--  20260911193914 makes its grant reporting truthful). The original is kept so
-- a replay from zero follows the same history production did.

-- Customer-safe price quote: same engine, none of the economics. Enough for
-- informed consent, never the provider's wholesale price or our margin.
CREATE OR REPLACE FUNCTION public.billing_quote_for_me(
  p_product_code text,
  p_expected_units numeric DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_uid uuid;
  v_plan text;
  v_q record;
  v_product record;
  v_spread numeric;
  v_expected numeric;
  v_min numeric;
  v_max numeric;
  v_ent record;
  v_period_key text;
  v_used integer;
  v_remaining integer;
begin
  v_uid := public.auth_user_id();
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found or not v_product.enabled then raise exception 'UNKNOWN_PRODUCT'; end if;

  v_plan := public.billing_current_plan(v_uid);

  select e.* into v_ent from public.product_plan_entitlements e
   where e.plan_code = v_plan and e.product_code = p_product_code;
  v_period_key := public.billing_period_key(v_uid, v_plan, COALESCE(v_ent.period,'CALENDAR_MONTH'));
  select count(*) into v_used from public.allowance_consumptions
   where user_id = v_uid and product_code = p_product_code and period_key = v_period_key and released_at is null;
  v_remaining := greatest(COALESCE(v_ent.included_per_period,0) - v_used, 0);

  -- An included run costs nothing and needs no authorization dialog.
  if v_remaining > 0 then
    return jsonb_build_object(
      'product_code', p_product_code, 'plan_code', v_plan,
      'quality_tier', COALESCE(v_ent.quality_tier,'STANDARD'),
      'funding', 'INCLUDED',
      'included_remaining', v_remaining,
      'estimate_min_credits', 0, 'estimate_max_credits', 0, 'authorized_max_credits', 0,
      'result_ceiling', v_ent.result_ceiling);
  end if;

  if not v_product.pricing_active or v_product.kill_switch
     or not public.billing_setting_bool('billing_payg_enabled', true) then
    return jsonb_build_object(
      'product_code', p_product_code, 'plan_code', v_plan,
      'quality_tier', COALESCE(v_ent.quality_tier,'STANDARD'),
      'funding', 'UNAVAILABLE', 'included_remaining', 0);
  end if;

  select * into v_q from public.billing_price_quote(p_product_code, v_plan, NULL);

  v_expected := round(v_q.credits * greatest(COALESCE(p_expected_units,1), 0.0001), 4);
  v_spread := COALESCE((v_product.config->>'estimate_spread_bps')::numeric, 2500) / 10000.0;
  v_min := round(v_expected * (1 - v_spread), 2);
  v_max := round(v_expected * (1 + v_spread), 2);

  return jsonb_build_object(
    'product_code', p_product_code,
    'plan_code', v_plan,
    'quality_tier', COALESCE(v_ent.quality_tier,'STANDARD'),
    'funding', 'PAYG',
    'included_remaining', 0,
    'unit_credits', v_q.credits,
    'estimate_min_credits', v_min,
    'estimate_max_credits', v_max,
    -- What we will hold. The customer pays actual usage, never more than this.
    'authorized_max_credits', v_max,
    'result_ceiling', v_ent.result_ceiling,
    'credits_per_usd', public.billing_setting_num('credits_per_usd', 10),
    'member_rate_key', case v_plan when 'FREE' then 'rate_standard'
                                   when 'VIP'  then 'rate_vip' else 'rate_best' end);
end;
$fn$;

-- The one way a subscription changes. Verified provider webhook only.
-- Idempotent on p_idempotency_key: a redelivered renewal cannot grant a second
-- month of credits.
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

  -- Membership credits. One grant per (subscription, cycle start), enforced by
  -- the lot's unique (user, source_type, source_ref), so an upgrade in the
  -- middle of a cycle cannot mint a second month.
  if v_plan.membership_credits_grant > 0
     and public.billing_setting_bool('billing_membership_grants_enabled', true) then
    select * into v_grant from public.wallet_grant_credits(
      p_user_id, 'MEMBERSHIP', v_plan.membership_credits_grant, 'MEMBERSHIP_GRANT',
      'membership', v_sub_id::text || ':' || to_char(v_start, 'YYYYMMDDHH24MISS'),
      -- Membership credits expire at the rollover horizon rather than the cycle
      -- end, so an unused cycle genuinely rolls over.
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

-- Subscriptions whose period ran out without renewal drop to FREE. Wallet
-- untouched.
CREATE OR REPLACE FUNCTION public.subscription_expire_lapsed(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_row record; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
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

-- Top-up with the once-per-customer activation bonus. Eligibility is decided
-- HERE, atomically, from the payment record. Not from the frontend, not from a
-- metadata field a client could shape, and not from a read-then-write "have
-- they had it?" check that two concurrent webhook deliveries would both pass.
--
-- The INSERT into promotion_redemptions IS the eligibility check: concurrent
-- duplicates, retries and a second account on the same card all collide on a
-- unique index rather than on an application-level read.
CREATE OR REPLACE FUNCTION public.wallet_topup_with_promo(
  p_user_id uuid,
  p_amount_cents integer,
  p_payment_id uuid,
  p_payment_reference text,
  p_payment_fingerprint text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_credits numeric;
  v_purchased record;
  v_promo record;
  v_bonus numeric := 0;
  v_bonus_lot uuid;
  v_bonus_grant record;
  v_eligible boolean := false;
  v_min_cents numeric;
  v_expires timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  v_min_cents := public.billing_setting_num('billing_min_topup_cents', 100);
  if p_amount_cents < v_min_cents then
    raise exception 'BELOW_MINIMUM_TOPUP: % < %', p_amount_cents, v_min_cents;
  end if;

  -- Credits are derived from the amount actually paid, server side. The client
  -- never tells us how many credits it bought.
  v_credits := public.billing_cents_to_credits(p_amount_cents);

  select * into v_purchased from public.wallet_grant_credits(
    p_user_id, 'PURCHASED', v_credits, 'TOP_UP', 'topup', p_payment_reference,
    NULL, NULL, p_payment_id,
    jsonb_build_object('amount_cents', p_amount_cents));

  -- A duplicate top-up means a redelivered webhook: no second bonus either.
  if v_purchased.was_duplicate then
    return jsonb_build_object('duplicate', true,
      'credits_purchased', v_purchased.credits_granted,
      'credits_bonus', 0,
      'balance_after', v_purchased.balance_after);
  end if;

  if public.billing_setting_bool('billing_first_topup_promo_enabled', true) then
    select * into v_promo from public.promotions
     where code = 'FIRST_TOPUP_DOUBLE' and enabled = true and kind = 'FIRST_TOPUP';
    if found and p_amount_cents >= v_promo.min_amount_cents then
      v_eligible := true;
    end if;
  end if;

  if v_eligible then
    v_bonus := least(
      round(v_credits * v_promo.bonus_match_bps / 10000.0, 4),
      v_promo.max_bonus_credits);

    if v_promo.bonus_expires_after_days is not null then
      v_expires := now() + (v_promo.bonus_expires_after_days || ' days')::interval;
    end if;

    begin
      insert into public.promotion_redemptions
        (user_id, promo_code, payment_id, payment_fingerprint, credits_granted)
      values (p_user_id, 'FIRST_TOPUP_DOUBLE', p_payment_id, p_payment_fingerprint, v_bonus);

      select * into v_bonus_grant from public.wallet_grant_credits(
        p_user_id, 'PROMOTIONAL', v_bonus, 'FIRST_TOPUP_BONUS',
        'promo', 'FIRST_TOPUP_DOUBLE:' || p_payment_reference,
        v_expires, NULL, p_payment_id,
        jsonb_build_object('promo_code','FIRST_TOPUP_DOUBLE','amount_cents',p_amount_cents));

      v_bonus_lot := v_bonus_grant.lot_id;
      update public.promotion_redemptions set lot_id = v_bonus_lot
       where user_id = p_user_id and promo_code = 'FIRST_TOPUP_DOUBLE';

      return jsonb_build_object('duplicate', false,
        'credits_purchased', v_purchased.credits_granted,
        'credits_bonus', v_bonus_grant.credits_granted,
        'bonus_granted', true,
        'balance_after', v_bonus_grant.balance_after);
    exception when unique_violation then
      -- Already redeemed. The top-up above still stands; only the bonus is
      -- declined. This is the normal path for every top-up after the first.
      v_bonus := 0;
    end;
  end if;

  return jsonb_build_object('duplicate', false,
    'credits_purchased', v_purchased.credits_granted,
    'credits_bonus', 0,
    'bonus_granted', false,
    'balance_after', v_purchased.balance_after);
end;
$fn$;

-- Admin adjustment, through the ledger like everything else.
CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
  p_user_id uuid,
  p_credits numeric,
  p_reason text,
  p_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_r record;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_credits is null or p_credits = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_credits < 0 then raise exception 'NEGATIVE_ADJUSTMENT_NOT_SUPPORTED: reverse the original entry instead'; end if;

  select * into v_r from public.wallet_grant_credits(
    p_user_id, 'ADJUSTMENT', p_credits, 'ADMIN_ADJUSTMENT', 'adjustment', p_reference,
    NULL, NULL, NULL, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('lot_id', v_r.lot_id, 'credits', v_r.credits_granted,
                            'balance_after', v_r.balance_after, 'duplicate', v_r.was_duplicate);
end;
$fn$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.subscription_apply_plan(uuid, text, text, text, timestamptz, timestamptz, text, text, jsonb)',
    'public.subscription_expire_lapsed(integer)',
    'public.wallet_topup_with_promo(uuid, integer, uuid, text, text)',
    'public.wallet_admin_adjust(uuid, numeric, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.billing_quote_for_me(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_quote_for_me(text, numeric) TO authenticated, service_role;
