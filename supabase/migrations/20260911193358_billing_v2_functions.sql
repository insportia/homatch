-- HOMATCH BILLING v2 — part 3 of 4: the engine.
--
-- Everything that decides money lives here, in the database, because financial
-- logic must be server-authoritative and because a second copy of the pricing
-- formula in TypeScript is a second answer waiting to disagree with this one.
-- The frontend and the admin simulator both CALL billing_price_quote();
-- neither computes a price.
--
-- ARITHMETIC
--
-- numeric throughout. No float ever touches money or credits. Credits are
-- numeric(18,4); cents are numeric(14,4) internally and integers at the
-- boundary.
--
-- CALLER RULES
--
-- Every function that MOVES credits checks auth.role() = 'service_role' in its
-- own body AND has EXECUTE revoked from PUBLIC/anon/authenticated at the bottom
-- of this file. This project grants EXECUTE on new functions to
-- anon/authenticated/service_role by default, and revoking from
-- anon+authenticated alone does NOT remove it - PUBLIC must be revoked too.
-- Read-only quote/entitlement functions are deliberately callable by
-- authenticated users.
--
-- NOTE: wallet_settle and wallet_release as defined here contain an OUT
-- parameter shadowing bug, fixed in 20260911193725. The original is kept so a
-- replay from zero follows the same history production did.

CREATE OR REPLACE FUNCTION public.billing_setting_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT value::text::numeric FROM public.admin_settings WHERE key = p_key), p_default);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT value::text::boolean FROM public.admin_settings WHERE key = p_key), p_default);
$fn$;

-- Dollars <-> Credits. One place, so "1 Credit = $0.10" is never a magic
-- number in a component.
CREATE OR REPLACE FUNCTION public.billing_cents_to_credits(p_cents numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round(p_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 4);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_credits_to_cents(p_credits numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round(p_credits * 100.0 / public.billing_setting_num('credits_per_usd', 10), 4);
$fn$;

-- Landed COGS: raw provider + AI + enrichment + infra, then the configurable
-- tax/fee layer. raw 10.0c + 18% = 11.8c, the mandate's worked example. The 18%
-- is a SETTING, not a constant, because tax treatment depends on entity
-- structure, provider, jurisdiction and customer tax status.
CREATE OR REPLACE FUNCTION public.billing_landed_cogs_cents(
  p_raw_provider_cents numeric,
  p_ai_cents numeric DEFAULT 0,
  p_enrichment_cents numeric DEFAULT 0,
  p_infra_cents numeric DEFAULT 0
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_base numeric;
  v_tax_bps numeric := public.billing_setting_num('billing_cogs_tax_bps', 1800);
  v_fee_bps numeric := public.billing_setting_num('billing_cogs_fee_bps', 0);
begin
  v_base := COALESCE(p_raw_provider_cents,0) + COALESCE(p_ai_cents,0)
          + COALESCE(p_enrichment_cents,0) + COALESCE(p_infra_cents,0);
  if v_base < 0 then raise exception 'NEGATIVE_COGS'; end if;
  return round(v_base * (1 + v_tax_bps/10000.0 + v_fee_bps/10000.0), 4);
end;
$fn$;

-- THE PRICE QUOTE.
--
-- WHY THE STANDARD PRICE IS DERIVED FROM A MARKUP MULTIPLE RATHER THAN BEING A
-- FLAT PER-EXECUTION FIGURE
--
-- These are variable-cost products. If the standard retail price were a
-- constant and the profit pool were (constant - actual_cogs), then a run that
-- cost twice as much would produce a SMALLER pool and therefore a SMALLER
-- charge. Expensive work would be cheaper than cheap work, and a sufficiently
-- expensive run would price below cost.
--
-- So the reference pair (standard_retail_cents, reference_landed_cogs_cents)
-- defines a markup multiple, and the standard price scales with the work
-- actually done:
--
--   multiple       = standard_retail / reference_landed_cogs
--   standard_price = actual_landed_cogs * multiple
--   base_pool      = standard_price - actual_landed_cogs
--   plan_price     = actual_landed_cogs + base_pool * (1 - share_to_customer)
--
-- At the reference point this reproduces the mandate's worked example exactly:
-- cogs 11.8c, standard 50c, pool 38.2c, FREE 50c (76.40% margin, 323.73%
-- markup), VIP 40.45c, PREMIUM 30.9c.
--
-- Then the floor. Gross margin = (price - cogs)/price >= m implies
-- price >= cogs / (1 - m). If a provider's price jumps, the Premium concession
-- is clamped here rather than producing a loss-making execution.
CREATE OR REPLACE FUNCTION public.billing_price_quote(
  p_product_code text,
  p_plan_code text,
  p_landed_cogs_cents numeric DEFAULT NULL
) RETURNS TABLE (
  product_code text,
  plan_code text,
  landed_cogs_cents numeric,
  standard_price_cents numeric,
  base_profit_pool_cents numeric,
  plan_price_before_floor_cents numeric,
  floor_price_cents numeric,
  floor_applied boolean,
  final_price_cents numeric,
  gross_profit_cents numeric,
  gross_margin_bps integer,
  markup_bps integer,
  credits numeric,
  pricing_version integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_p record;
  v_plan record;
  v_cogs numeric;
  v_multiple numeric;
  v_standard numeric;
  v_pool numeric;
  v_plan_price numeric;
  v_floor numeric;
  v_min_bps numeric;
  v_final numeric;
  v_credits numeric;
  v_dp integer := public.billing_setting_num('billing_credit_rounding_dp', 2)::integer;
begin
  select * into v_p from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT: %', p_product_code; end if;
  if not v_p.pricing_active then
    raise exception 'PRODUCT_PRICING_INACTIVE: % is registered but has no approved pricing', p_product_code;
  end if;

  select * into v_plan from public.billing_plans where code = p_plan_code;
  if not found then raise exception 'UNKNOWN_PLAN: %', p_plan_code; end if;

  v_cogs := round(COALESCE(p_landed_cogs_cents, v_p.reference_landed_cogs_cents), 4);
  if v_cogs < 0 then raise exception 'NEGATIVE_COGS'; end if;
  if v_p.reference_landed_cogs_cents <= 0 then
    raise exception 'PRODUCT_HAS_NO_REFERENCE_COGS: % cannot be priced', p_product_code;
  end if;

  v_multiple := v_p.standard_retail_cents::numeric / v_p.reference_landed_cogs_cents;
  v_standard := round(v_cogs * v_multiple, 4);
  v_pool     := v_standard - v_cogs;
  -- The member concession. FREE concedes nothing and lands on v_standard.
  v_plan_price := round(v_cogs + v_pool * (1 - v_plan.profit_share_to_customer_bps / 10000.0), 4);

  -- Per-product floor wins over the global one when it is stricter.
  v_min_bps := greatest(COALESCE(v_p.min_gross_margin_bps, 3000), 0);
  v_min_bps := greatest(v_min_bps, public.billing_setting_num('billing_min_gross_margin_bps', 3000));
  if v_min_bps >= 10000 then raise exception 'INVALID_MIN_MARGIN'; end if;

  v_floor := round(v_cogs / (1 - v_min_bps/10000.0), 4);
  v_final := greatest(v_plan_price, v_floor);

  -- Rounding happens on CREDITS, then the cents figure is restated from it, so
  -- the number the customer is charged and the number reported as revenue are
  -- the same number. Never let rounding down cross the floor.
  v_credits := round(public.billing_cents_to_credits(v_final), v_dp);
  if public.billing_credits_to_cents(v_credits) < v_floor then
    v_credits := round(v_credits + power(10, -v_dp)::numeric, v_dp);
  end if;
  v_final := public.billing_credits_to_cents(v_credits);

  return query select
    p_product_code, p_plan_code, v_cogs, v_standard, v_pool, v_plan_price,
    v_floor, (v_floor > v_plan_price), v_final,
    round(v_final - v_cogs, 4),
    case when v_final > 0 then round((v_final - v_cogs) / v_final * 10000)::integer else 0 end,
    case when v_cogs  > 0 then round((v_final - v_cogs) / v_cogs  * 10000)::integer else 0 end,
    v_credits,
    public.billing_setting_num('billing_pricing_version', 1)::integer;
end;
$fn$;

-- user_subscriptions is the truth; users.plan is a mirror kept in sync so
-- existing readers keep working.
CREATE OR REPLACE FUNCTION public.billing_current_plan(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT s.plan_code FROM public.user_subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('ACTIVE','PAST_DUE')
        AND s.current_period_end > now()
      ORDER BY s.current_period_end DESC LIMIT 1),
    'FREE');
$fn$;

-- FREE allowances run on the calendar month; a paid plan runs on its own
-- billing cycle, because that is the month the customer paid for. Both are
-- DERIVED, never stored in a counter a cron job has to reset.
CREATE OR REPLACE FUNCTION public.billing_period_key(p_user_id uuid, p_plan_code text, p_period text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_sub record;
begin
  if p_period = 'BILLING_CYCLE' then
    select id, current_period_start into v_sub
      from public.user_subscriptions
     where user_id = p_user_id and status in ('ACTIVE','PAST_DUE') and current_period_end > now()
     order by current_period_end desc limit 1;
    if found then
      return 'SUB:' || v_sub.id::text || ':' || to_char(v_sub.current_period_start, 'YYYYMMDDHH24MISS');
    end if;
  end if;
  return 'CAL:' || to_char(now() at time zone 'UTC', 'YYYY-MM');
end;
$fn$;

-- THE ENTITLEMENT ENGINE. The single answer to "what is this customer allowed
-- to do", so that no component anywhere has to ask `if (plan === 'PREMIUM')`.
CREATE OR REPLACE FUNCTION public.billing_entitlements(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_plan_code text;
  v_plan record;
  v_sub record;
  v_products jsonb := '[]'::jsonb;
  v_row record;
  v_period_key text;
  v_used integer;
  v_acct record;
begin
  v_plan_code := public.billing_current_plan(p_user_id);
  select * into v_plan from public.billing_plans where code = v_plan_code;

  select * into v_sub from public.user_subscriptions
   where user_id = p_user_id and status in ('ACTIVE','PAST_DUE') and current_period_end > now()
   order by current_period_end desc limit 1;

  select balance, reserved into v_acct from public.credit_accounts where user_id = p_user_id;

  for v_row in
    select e.*, p.name as product_name, p.enabled, p.pricing_active, p.kill_switch, p.billing_mode
      from public.product_plan_entitlements e
      join public.billable_products p on p.code = e.product_code
     where e.plan_code = v_plan_code and p.enabled = true
     order by p.sort_order
  loop
    v_period_key := public.billing_period_key(p_user_id, v_plan_code, v_row.period);
    select count(*) into v_used
      from public.allowance_consumptions
     where user_id = p_user_id and product_code = v_row.product_code
       and period_key = v_period_key and released_at is null;

    v_products := v_products || jsonb_build_object(
      'product_code',      v_row.product_code,
      'name',              v_row.product_name,
      'quality_tier',      v_row.quality_tier,
      'included_per_period', v_row.included_per_period,
      'included_used',     v_used,
      'included_remaining', greatest(v_row.included_per_period - v_used, 0),
      'period',            v_row.period,
      'period_key',        v_period_key,
      'result_ceiling',    v_row.result_ceiling,
      'priority_level',    v_row.priority_level,
      -- PAYG is unlimited on every plan. The only gates are the global kill
      -- switch, the product kill switch, and having funds.
      'payg_available',    (v_row.pricing_active and not v_row.kill_switch
                            and public.billing_setting_bool('billing_payg_enabled', true)),
      'billing_mode',      v_row.billing_mode
    );
  end loop;

  return jsonb_build_object(
    'plan_code',        v_plan_code,
    'plan_name',        v_plan.name,
    'quality_tier',     v_plan.quality_tier,
    'badge_key',        v_plan.badge_key,
    'priority_level',   v_plan.priority_level,
    'member_rate_key',  case v_plan_code when 'FREE' then 'rate_standard'
                                         when 'VIP' then 'rate_vip'
                                         else 'rate_best' end,
    'ai_fair_use_daily', public.billing_setting_num(v_plan.ai_fair_use_key, 100),
    'membership_credits_grant', v_plan.membership_credits_grant,
    'membership_rollover_cap',  v_plan.membership_rollover_cap,
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
        'id', v_sub.id, 'status', v_sub.status,
        'current_period_start', v_sub.current_period_start,
        'current_period_end', v_sub.current_period_end,
        'cancel_at_period_end', v_sub.cancel_at_period_end) end,
    'wallet', jsonb_build_object(
        'balance',  COALESCE(v_acct.balance, 0),
        'reserved', COALESCE(v_acct.reserved, 0),
        'credits_per_usd', public.billing_setting_num('credits_per_usd', 10)),
    'products', v_products,
    -- Drives the activation offer without the frontend deciding eligibility.
    'first_topup_promo_available', (
        public.billing_setting_bool('billing_first_topup_promo_enabled', true)
        and exists (select 1 from public.promotions where code='FIRST_TOPUP_DOUBLE' and enabled)
        and not exists (select 1 from public.promotion_redemptions
                         where user_id = p_user_id and promo_code = 'FIRST_TOPUP_DOUBLE')
    )
  );
end;
$fn$;

-- The customer's own view of the same thing. Deliberately takes no user id.
CREATE OR REPLACE FUNCTION public.billing_my_entitlements()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_uid uuid;
begin
  v_uid := public.auth_user_id();
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return public.billing_entitlements(v_uid);
end;
$fn$;

-- Claiming an included execution. Atomic: the advisory lock serialises the slot
-- calculation and the partial unique index is the backstop if it somehow does
-- not. Two concurrent 4th-Verify attempts cannot both take slot 3.
CREATE OR REPLACE FUNCTION public.billing_claim_allowance(
  p_user_id uuid,
  p_product_code text,
  p_job_ref text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_plan_code text;
  v_ent record;
  v_period_key text;
  v_used integer;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  v_plan_code := public.billing_current_plan(p_user_id);

  select e.*, p.enabled, p.kill_switch into v_ent
    from public.product_plan_entitlements e
    join public.billable_products p on p.code = e.product_code
   where e.plan_code = v_plan_code and e.product_code = p_product_code;
  if not found then return null; end if;
  if not v_ent.enabled or v_ent.kill_switch then return null; end if;
  if v_ent.included_per_period <= 0 then return null; end if;

  v_period_key := public.billing_period_key(p_user_id, v_plan_code, v_ent.period);

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_product_code || ':' || v_period_key));

  select count(*) into v_used
    from public.allowance_consumptions
   where user_id = p_user_id and product_code = p_product_code
     and period_key = v_period_key and released_at is null;

  if v_used >= v_ent.included_per_period then return null; end if;

  insert into public.allowance_consumptions
    (user_id, product_code, period_key, slot_index, plan_code, quality_tier, job_ref)
  values (p_user_id, p_product_code, v_period_key, v_used + 1, v_plan_code, v_ent.quality_tier, p_job_ref)
  returning id into v_id;

  return v_id;
end;
$fn$;

-- An included run that failed before producing anything gives the slot back.
-- The row is not deleted: released_at is set, so the history survives and the
-- partial unique index stops blocking the reclaimed slot number.
CREATE OR REPLACE FUNCTION public.billing_release_allowance(
  p_allowance_id uuid,
  p_reason text DEFAULT 'execution_failed'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update public.allowance_consumptions
     set released_at = now(), release_reason = p_reason
   where id = p_allowance_id and released_at is null;
  return found;
end;
$fn$;

-- Every credit that exists is created here, and every one of them lands in a
-- lot with an origin. Idempotent on (user, source_type, source_ref), so a
-- redelivered webhook, a retried renewal and a double-clicked admin button all
-- land in the same place.
CREATE OR REPLACE FUNCTION public.wallet_grant_credits(
  p_user_id uuid,
  p_kind text,
  p_credits numeric,
  p_ledger_type text,
  p_source_type text,
  p_source_ref text,
  p_expires_at timestamptz DEFAULT NULL,
  p_plan_code text DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (lot_id uuid, ledger_entry_id uuid, credits_granted numeric, balance_after numeric, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_existing record;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
  v_lot uuid;
  v_reference text;
  v_cap numeric;
  v_held numeric;
  v_grant numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_credits is null or p_credits <= 0 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_kind not in ('PURCHASED','MEMBERSHIP','PROMOTIONAL','ADJUSTMENT') then raise exception 'INVALID_LOT_KIND'; end if;
  if p_source_ref is null then raise exception 'SOURCE_REF_REQUIRED'; end if;
  if p_kind = 'PURCHASED' and p_expires_at is not null then raise exception 'PURCHASED_CREDITS_MUST_NOT_EXPIRE'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  -- Idempotency first, before any lock or write.
  select * into v_existing from public.credit_lots
   where user_id = p_user_id and source_type = p_source_type and source_ref = p_source_ref;
  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = p_user_id;
    return query select v_existing.id, v_existing.ledger_entry_id, v_existing.credits_granted, v_after, true;
    return;
  end if;

  v_grant := round(p_credits, 4);

  -- Membership credits must not accumulate forever. The cap applies to the
  -- whole MEMBERSHIP bucket, so one unused cycle rolls over and a second unused
  -- cycle is trimmed rather than banked.
  if p_kind = 'MEMBERSHIP' and p_plan_code is not null then
    select membership_rollover_cap into v_cap from public.billing_plans where code = p_plan_code;
    if v_cap is not null and v_cap > 0 then
      select COALESCE(sum(credits_available), 0) into v_held
        from public.credit_lots
       where user_id = p_user_id and kind = 'MEMBERSHIP' and status = 'ACTIVE';
      v_grant := least(v_grant, greatest(v_cap - v_held, 0));
      if v_grant <= 0 then
        return query select null::uuid, null::uuid, 0::numeric,
               (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id), false;
        return;
      end if;
    end if;
  end if;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then
    insert into public.credit_accounts(user_id, balance) values (p_user_id, 0)
      on conflict (user_id) do nothing;
    select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  end if;

  v_after := v_before + v_grant;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = p_user_id;

  v_reference := p_source_type || ':' || p_source_ref;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, payment_id, metadata)
  values (p_user_id, v_grant, v_before, v_after, p_ledger_type::public.ledger_type, v_reference, p_payment_id,
          p_metadata || jsonb_build_object('lot_kind', p_kind, 'plan_code', p_plan_code))
  returning id into v_ledger;

  insert into public.credit_lots
    (user_id, kind, credits_granted, expires_at, source_type, source_ref, plan_code, ledger_entry_id)
  values (p_user_id, p_kind, v_grant, p_expires_at, p_source_type, p_source_ref, p_plan_code, v_ledger)
  returning id into v_lot;

  update public.credit_ledger set metadata = metadata || jsonb_build_object('lot_id', v_lot) where id = v_ledger;

  return query select v_lot, v_ledger, v_grant, v_after, false;
end;
$fn$;

-- RESERVE. Holds the authorized maximum, drawing from lots in spend order, and
-- records which lot gave what so settlement can return the unused part to the
-- same buckets.
--
-- SPEND ORDER: promotional expiring soonest, then membership expiring soonest,
-- then purchased. Spend the credits that can evaporate before the ones that
-- cannot, and spend the customer's own money last.
CREATE OR REPLACE FUNCTION public.wallet_reserve(
  p_user_id uuid,
  p_product_code text,
  p_authorized_max_credits numeric,
  p_idempotency_key text,
  p_estimate_min_credits numeric DEFAULT 0,
  p_estimate_max_credits numeric DEFAULT 0,
  p_job_ref text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (reservation_id uuid, reserved_credits numeric, balance_after numeric, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_existing record;
  v_plan_code text;
  v_plan record;
  v_ent record;
  v_product record;
  v_before numeric;
  v_after numeric;
  v_need numeric;
  v_take numeric;
  v_lot record;
  v_rank integer := 0;
  v_res uuid;
  v_ledger uuid;
  v_alloc jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_authorized_max_credits is null or p_authorized_max_credits <= 0 then raise exception 'INVALID_AUTHORIZED_MAX'; end if;

  -- The legacy-debit trigger on credit_accounts keeps lots in step for the
  -- pre-v2 spend paths. This function maintains the lots itself, so it tells
  -- the trigger to stand aside for the rest of this transaction.
  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_existing from public.usage_reservations where idempotency_key = p_idempotency_key;
  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_existing.user_id;
    return query select v_existing.id, v_existing.reserved_credits, v_after, true;
    return;
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT'; end if;
  if not v_product.enabled then raise exception 'PRODUCT_DISABLED'; end if;
  if v_product.kill_switch then raise exception 'PRODUCT_KILL_SWITCH'; end if;
  if not v_product.pricing_active then raise exception 'PRODUCT_PRICING_INACTIVE'; end if;
  if not public.billing_setting_bool('billing_payg_enabled', true) then raise exception 'PAYG_DISABLED'; end if;

  v_plan_code := public.billing_current_plan(p_user_id);
  select * into v_plan from public.billing_plans where code = v_plan_code;
  select * into v_ent from public.product_plan_entitlements
   where plan_code = v_plan_code and product_code = p_product_code;

  v_need := round(p_authorized_max_credits, 4);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  -- No accidental negative balance. Either the whole authorization is covered
  -- or nothing is reserved at all.
  if v_before < v_need then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_need;
  update public.credit_accounts
     set balance = v_after, reserved = reserved + v_need, updated_at = now()
   where user_id = p_user_id;

  insert into public.usage_reservations (
    user_id, product_code, status,
    plan_code_snapshot, quality_tier_snapshot, pricing_version_snapshot,
    profit_share_bps_snapshot, result_ceiling_snapshot, provider_budget_ceiling_cents_snapshot,
    estimate_min_credits, estimate_max_credits, authorized_max_credits, reserved_credits,
    job_ref, idempotency_key, metadata, expires_at
  ) values (
    p_user_id, p_product_code, 'RESERVED',
    v_plan_code, COALESCE(v_ent.quality_tier, v_plan.quality_tier),
    public.billing_setting_num('billing_pricing_version', 1)::integer,
    v_plan.profit_share_to_customer_bps, v_ent.result_ceiling, v_ent.provider_budget_ceiling_cents,
    round(COALESCE(p_estimate_min_credits,0),4), round(COALESCE(p_estimate_max_credits,0),4),
    v_need, v_need,
    p_job_ref, p_idempotency_key, COALESCE(p_metadata,'{}'::jsonb),
    now() + (public.billing_setting_num('billing_reservation_ttl_minutes', 60) || ' minutes')::interval
  ) returning id into v_res;

  for v_lot in
    select * from public.credit_lots
     where user_id = p_user_id and status = 'ACTIVE' and credits_available > 0
       and (expires_at is null or expires_at > now())
     order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1
                        when 'ADJUSTMENT' then 2 else 3 end,
              expires_at asc nulls last,
              granted_at asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.credits_available, v_need);
    if v_take <= 0 then continue; end if;

    update public.credit_lots
       set credits_reserved = credits_reserved + v_take, updated_at = now()
     where id = v_lot.id;

    insert into public.credit_lot_allocations (reservation_id, lot_id, allocated_credits, spend_rank)
    values (v_res, v_lot.id, v_take, v_rank);

    v_alloc := v_alloc || jsonb_build_object('lot_id', v_lot.id, 'kind', v_lot.kind, 'credits', v_take);
    v_need := round(v_need - v_take, 4);
    v_rank := v_rank + 1;
  end loop;

  -- balance said the money was there, so the lots must have covered it. If they
  -- did not, the materialised balance and the lots have drifted and this
  -- transaction must not be allowed to commit.
  if v_need > 0 then
    raise exception 'WALLET_LOT_DRIFT: balance covered the reservation but lots are short by % credits', v_need;
  end if;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (p_user_id, -round(p_authorized_max_credits,4), v_before, v_after, 'SERVICE_RESERVE',
          'res:' || v_res::text,
          jsonb_build_object('reservation_id', v_res, 'product_code', p_product_code,
                             'plan_code', v_plan_code, 'allocations', v_alloc))
  returning id into v_ledger;

  update public.usage_reservations set ledger_reserve_id = v_ledger where id = v_res;

  return query select v_res, round(p_authorized_max_credits,4), v_after, false;
end;
$fn$;

-- SETTLE: charge the ACTUAL usage, return the rest. Idempotent: a duplicate
-- provider callback re-reads the settled row and charges nothing more.
--
-- The settlement is clamped to the authorization the customer gave. If the
-- provider genuinely cost more than that, Homatch eats the difference and the
-- overrun is recorded on the usage event for the operator to see. A customer
-- who authorised 20 is never charged 37.
--
-- SUPERSEDED by 20260911193725 (OUT parameter shadowing fix).
CREATE OR REPLACE FUNCTION public.wallet_settle(
  p_reservation_id uuid,
  p_actual_credits numeric,
  p_usage jsonb DEFAULT '{}'::jsonb,
  p_outcome text DEFAULT 'SUCCESS'
) RETURNS TABLE (reservation_id uuid, settled_credits numeric, released_credits numeric, balance_after numeric, was_duplicate boolean, clamped boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_res record;
  v_charge numeric;
  v_release numeric;
  v_clamped boolean := false;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_left numeric;
  v_take numeric;
  v_ledger_cap uuid;
  v_ledger_rel uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.settled_credits, v_res.released_credits, v_after, true, false;
    return;
  end if;

  v_charge := round(greatest(COALESCE(p_actual_credits, 0), 0), 4);
  if v_charge > v_res.authorized_max_credits then
    v_charge := v_res.authorized_max_credits;
    v_clamped := true;
  end if;
  v_release := round(v_res.reserved_credits - v_charge, 4);

  v_left := v_charge;
  for v_alloc in
    select * from public.credit_lot_allocations
     where reservation_id = p_reservation_id order by spend_rank
     for update
  loop
    v_take := least(v_alloc.allocated_credits, greatest(v_left, 0));
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits,
           credits_consumed = credits_consumed + v_take,
           status = case when (credits_granted - credits_consumed - v_take - (credits_reserved - v_alloc.allocated_credits) - credits_expired) <= 0
                         then 'EXHAUSTED' else status end,
           updated_at = now()
     where id = v_alloc.lot_id;

    update public.credit_lot_allocations
       set settled_credits = v_take, released_credits = v_alloc.allocated_credits - v_take
     where id = v_alloc.id;

    v_left := round(v_left - v_take, 4);
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_release;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  -- The hold already moved the money out of the available balance, so the
  -- capture entry is a zero-amount marker carrying the real figure in its
  -- metadata. This is the shape SERVICE_CAPTURE already had.
  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, 0, v_before, v_before, 'SERVICE_CAPTURE', 'res:' || p_reservation_id::text || ':cap',
          jsonb_build_object('reservation_id', p_reservation_id, 'product_code', v_res.product_code,
                             'charged_credits', v_charge, 'authorized_max', v_res.authorized_max_credits,
                             'clamped', v_clamped, 'outcome', p_outcome,
                             'plan_code', v_res.plan_code_snapshot))
  returning id into v_ledger_cap;

  if v_release > 0 then
    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
    values (v_res.user_id, v_release, v_before, v_after, 'SERVICE_RELEASE', 'res:' || p_reservation_id::text || ':rel',
            jsonb_build_object('reservation_id', p_reservation_id, 'reason', 'unused_reservation'))
    returning id into v_ledger_rel;
  end if;

  update public.usage_reservations
     set status = 'SETTLED', settled_credits = v_charge, released_credits = v_release,
         ledger_capture_id = v_ledger_cap, ledger_release_id = COALESCE(v_ledger_rel, ledger_release_id),
         settled_at = now(), updated_at = now(),
         metadata = metadata || jsonb_build_object('clamped', v_clamped)
   where id = p_reservation_id;

  insert into public.usage_events (
    user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
    provider, provider_operation, provider_request_id, model,
    input_tokens, cached_tokens, output_tokens, search_count, provider_units, enrichment_units, duration_ms,
    raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
    charged_credits, reserved_credits, released_credits,
    allowance_funded, billable, outcome, failure_reason, job_ref, metadata
  ) values (
    v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
    v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
    p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id', p_usage->>'model',
    (p_usage->>'input_tokens')::bigint, (p_usage->>'cached_tokens')::bigint, (p_usage->>'output_tokens')::bigint,
    (p_usage->>'search_count')::integer, (p_usage->>'provider_units')::numeric,
    (p_usage->>'enrichment_units')::numeric, (p_usage->>'duration_ms')::integer,
    COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'tax_cents')::numeric, 0),
    COALESCE((p_usage->>'fee_cents')::numeric, 0),
    COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
    v_charge, v_res.reserved_credits, v_release,
    false, (v_charge > 0), p_outcome, p_usage->>'failure_reason', v_res.job_ref,
    COALESCE(p_usage->'metadata', '{}'::jsonb) || jsonb_build_object('clamped', v_clamped)
  );

  return query select p_reservation_id, v_charge, v_release, v_after, false, v_clamped;
end;
$fn$;

-- RELEASE: full release, nothing charged. A job that failed before meaningful
-- provider spend, or failed because of our own bug, costs the customer nothing.
-- Provider cost we did incur is still recorded, against Homatch.
--
-- SUPERSEDED by 20260911193725 (OUT parameter shadowing fix).
CREATE OR REPLACE FUNCTION public.wallet_release(
  p_reservation_id uuid,
  p_reason text DEFAULT 'execution_failed',
  p_usage jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (reservation_id uuid, released_credits numeric, balance_after numeric, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_res record;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_ledger uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.released_credits, v_after, true;
    return;
  end if;

  for v_alloc in
    select * from public.credit_lot_allocations where reservation_id = p_reservation_id for update
  loop
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits, updated_at = now()
     where id = v_alloc.lot_id;
    update public.credit_lot_allocations
       set released_credits = v_alloc.allocated_credits where id = v_alloc.id;
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_res.reserved_credits;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, v_res.reserved_credits, v_before, v_after, 'SERVICE_RELEASE',
          'res:' || p_reservation_id::text || ':rel',
          jsonb_build_object('reservation_id', p_reservation_id, 'reason', p_reason))
  returning id into v_ledger;

  update public.usage_reservations
     set status = 'RELEASED', released_credits = v_res.reserved_credits, settled_credits = 0,
         ledger_release_id = v_ledger, failure_reason = p_reason, settled_at = now(), updated_at = now()
   where id = p_reservation_id;

  -- The allowance slot goes back too, if the run was allowance-funded.
  if v_res.allowance_consumption_id is not null then
    perform public.billing_release_allowance(v_res.allowance_consumption_id, p_reason);
  end if;

  -- Cost we genuinely incurred is still recorded, marked non-billable so the
  -- margin reports show it against Homatch, not the customer.
  if COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0) > 0
     or COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0) > 0 then
    insert into public.usage_events (
      user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
      provider, provider_operation, provider_request_id,
      raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
      charged_credits, reserved_credits, released_credits,
      allowance_funded, billable, outcome, failure_reason, job_ref, metadata
    ) values (
      v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
      v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
      p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id',
      COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'tax_cents')::numeric, 0),
      COALESCE((p_usage->>'fee_cents')::numeric, 0),
      COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
      0, v_res.reserved_credits, v_res.reserved_credits,
      false, false, 'FAILED', p_reason, v_res.job_ref, COALESCE(p_usage->'metadata','{}'::jsonb)
    );
  end if;

  return query select p_reservation_id, v_res.reserved_credits, v_after, false;
end;
$fn$;

-- Sweepers. Never leave wallet funds stuck because a worker crashed.
CREATE OR REPLACE FUNCTION public.wallet_sweep_expired_reservations(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_row record; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  for v_row in
    select id from public.usage_reservations
     where status = 'RESERVED' and expires_at < now()
     order by expires_at limit p_limit
  loop
    perform public.wallet_release(v_row.id, 'reservation_expired');
    update public.usage_reservations set status = 'EXPIRED' where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_expire_lots(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_lot record; v_count integer := 0; v_before numeric; v_after numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  perform set_config('homatch.lots_managed', 'on', true);

  for v_lot in
    select * from public.credit_lots
     where status = 'ACTIVE' and expires_at is not null and expires_at <= now()
       and credits_available > 0
     order by expires_at limit p_limit
     for update
  loop
    select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_lot.user_id for update;
    v_after := v_before - v_lot.credits_available;

    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
    values (v_lot.user_id, -v_lot.credits_available, v_before, v_after, 'EXPIRATION',
            'lot_expire:' || v_lot.id::text,
            jsonb_build_object('lot_id', v_lot.id, 'kind', v_lot.kind));

    update public.credit_accounts set balance = v_after, updated_at = now() where user_id = v_lot.user_id;
    update public.credit_lots
       set credits_expired = credits_expired + v_lot.credits_available,
           status = 'EXPIRED', updated_at = now()
     where id = v_lot.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- The ledger is the source of truth; credit_accounts.balance is a materialised
-- convenience. This proves they still agree, and is what the acceptance
-- evidence is taken from.
CREATE OR REPLACE FUNCTION public.billing_wallet_integrity(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, account_balance numeric, lots_available numeric,
               account_reserved numeric, lots_reserved numeric,
               ledger_sum numeric, balance_ok boolean, reserved_ok boolean, ledger_ok boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT a.user_id,
         a.balance,
         COALESCE(l.avail, 0),
         a.reserved,
         COALESCE(l.resv, 0),
         COALESCE(g.total, 0),
         a.balance = COALESCE(l.avail, 0),
         a.reserved = COALESCE(l.resv, 0),
         a.balance = COALESCE(g.total, 0)
    FROM public.credit_accounts a
    LEFT JOIN (SELECT cl.user_id, SUM(cl.credits_available) avail, SUM(cl.credits_reserved) resv
                 FROM public.credit_lots cl WHERE cl.status <> 'EXPIRED' GROUP BY cl.user_id) l
      ON l.user_id = a.user_id
    LEFT JOIN (SELECT cg.user_id, SUM(cg.amount) total
                 FROM public.credit_ledger cg GROUP BY cg.user_id) g
      ON g.user_id = a.user_id
   WHERE p_user_id IS NULL OR a.user_id = p_user_id
   ORDER BY a.user_id;
$fn$;

-- Permissions. This project grants EXECUTE on new functions to
-- anon/authenticated/service_role by default, and revoking from
-- anon+authenticated alone does NOT remove it: PUBLIC must be revoked too.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.billing_setting_num(text, numeric)',
    'public.billing_setting_bool(text, boolean)',
    'public.billing_landed_cogs_cents(numeric, numeric, numeric, numeric)',
    'public.billing_entitlements(uuid)',
    'public.billing_period_key(uuid, text, text)',
    'public.billing_current_plan(uuid)',
    'public.billing_claim_allowance(uuid, text, text)',
    'public.billing_release_allowance(uuid, text)',
    'public.wallet_grant_credits(uuid, text, numeric, text, text, text, timestamptz, text, uuid, jsonb)',
    'public.wallet_reserve(uuid, text, numeric, text, numeric, numeric, text, jsonb)',
    'public.wallet_settle(uuid, numeric, jsonb, text)',
    'public.wallet_release(uuid, text, jsonb)',
    'public.wallet_sweep_expired_reservations(integer)',
    'public.wallet_expire_lots(integer)',
    'public.billing_price_quote(text, text, numeric)',
    'public.billing_wallet_integrity(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- These two were granted to authenticated here and revoked again in
-- 20260911194005 once nothing on the client turned out to call them.
REVOKE ALL ON FUNCTION public.billing_cents_to_credits(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_cents_to_credits(numeric) TO service_role, authenticated;
REVOKE ALL ON FUNCTION public.billing_credits_to_cents(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_credits_to_cents(numeric) TO service_role, authenticated;
REVOKE ALL ON FUNCTION public.billing_my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_my_entitlements() TO authenticated, service_role;
