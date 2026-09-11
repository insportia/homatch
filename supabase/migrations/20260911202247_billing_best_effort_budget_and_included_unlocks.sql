-- Homatch — a smaller wallet should buy a smaller search, not a refusal.
--
-- TWO DECISIONS IMPLEMENTED HERE
--
-- 1. A paid Find Clients search includes its results. Charging for the search
--    and again to reveal what it found is charging twice for one thing.
--
-- 2. A balance below the estimated maximum is no longer a hard failure. The
--    customer is offered the search their balance CAN buy, the engine scopes
--    the work to that ceiling, and only actual usage is charged.
--
-- WHAT A BUDGET ACTUALLY BUYS, AND WHY VIP AND PREMIUM GET MORE FOR IT
--
-- The pricing engine charges cogs * effective_multiple, where
--
--   multiple            = standard_retail / reference_landed_cogs
--   effective_multiple  = 1 + (multiple - 1) * (1 - share_to_customer)
--
-- Inverting that gives the provider spend a given credit budget authorises:
--
--   max_cogs = authorized_cents / max(effective_multiple, 1/(1 - min_margin))
--
-- FREE concedes nothing, so its effective multiple is the full 4.2373x and 10
-- Credits authorises 23.6c of provider work. Premium concedes half the pool,
-- so its effective multiple is 2.6186x and the SAME 10 Credits authorises
-- 38.2c. Measured on production: FREE 23.60c, VIP 29.17c (+23.6%), PREMIUM
-- 38.19c (+61.8%). That is the member rate doing real work rather than being a
-- label, and it falls out of the pricing model rather than being a separate
-- rule bolted on.
--
-- The margin floor is inside the max() because a budget must never authorise
-- spend the engine would then be unable to charge for without a loss.

-- ── 1. A minimum below which a search is not worth running ──
ALTER TABLE public.billable_products
  ADD COLUMN IF NOT EXISTS min_viable_budget_credits numeric(18,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billable_products.min_viable_budget_credits IS
  'Below this authorised budget the product must not run at all. Spending a customer''s last 2 Credits on a search that cannot produce anything useful is worse than telling them to top up.';

UPDATE public.billable_products SET min_viable_budget_credits = 3  WHERE code = 'VERIFY';
UPDATE public.billable_products SET min_viable_budget_credits = 5  WHERE code = 'FIND_CLIENTS';
UPDATE public.billable_products SET min_viable_budget_credits = 4  WHERE code = 'CONTRACT_INTELLIGENCE';
UPDATE public.billable_products SET min_viable_budget_credits = 5  WHERE code = 'BROKER_FINDER';

-- ── 2. Budget -> provider spend ceiling ─────────────────────
CREATE OR REPLACE FUNCTION public.billing_budget_to_cogs_ceiling(
  p_product_code text,
  p_plan_code text,
  p_authorized_credits numeric
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_p record;
  v_plan record;
  v_multiple numeric;
  v_effective numeric;
  v_floor_multiple numeric;
  v_min_bps numeric;
  v_cents numeric;
begin
  select * into v_p from public.billable_products where code = p_product_code;
  if not found or v_p.reference_landed_cogs_cents <= 0 then return 0; end if;
  select * into v_plan from public.billing_plans where code = p_plan_code;
  if not found then return 0; end if;

  v_multiple := v_p.standard_retail_cents::numeric / v_p.reference_landed_cogs_cents;
  v_effective := 1 + (v_multiple - 1) * (1 - v_plan.profit_share_to_customer_bps / 10000.0);

  v_min_bps := greatest(
    COALESCE(v_p.min_gross_margin_bps, 3000),
    public.billing_setting_num('billing_min_gross_margin_bps', 3000));
  v_floor_multiple := 1 / (1 - v_min_bps/10000.0);

  -- The stricter of the two: a budget must never authorise spend we could not
  -- charge for at the floor.
  v_effective := greatest(v_effective, v_floor_multiple);
  if v_effective <= 0 then return 0; end if;

  v_cents := public.billing_credits_to_cents(greatest(COALESCE(p_authorized_credits, 0), 0));
  return round(v_cents / v_effective, 4);
end;
$fn$;

-- ── 3. The offer a customer is shown ────────────────────────
-- Replaces "Insufficient balance" with "search with what you have", except
-- where that would buy something not worth running.
CREATE OR REPLACE FUNCTION public.billing_budget_offer(
  p_product_code text,
  p_expected_units numeric DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_uid uuid := public.auth_user_id();
  v_quote jsonb;
  v_product record;
  v_balance numeric;
  v_min_viable numeric;
  v_est_max numeric;
  v_est_min numeric;
  v_funding text;
  v_offer numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Reuse the customer-facing quote, so the estimate a customer is offered is
  -- the same one the engine produced.
  v_quote := public.billing_quote_for_me(p_product_code, p_expected_units);

  if (v_quote->>'funding') <> 'PAYG' then
    -- INCLUDED or UNAVAILABLE: no budget question to answer.
    return v_quote || jsonb_build_object('offer', v_quote->>'funding');
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  select COALESCE(balance, 0) into v_balance from public.credit_accounts where user_id = v_uid;
  v_balance := COALESCE(v_balance, 0);
  v_min_viable := COALESCE(v_product.min_viable_budget_credits, 0);
  v_est_min := (v_quote->>'estimate_min_credits')::numeric;
  v_est_max := (v_quote->>'estimate_max_credits')::numeric;

  if v_balance >= v_est_max then
    v_funding := 'PAYG_FULL';
    v_offer := v_est_max;
  elsif v_balance >= greatest(v_min_viable, 0) and v_balance > 0 then
    -- Best effort: authorise exactly what they have and scope the work to it.
    v_funding := 'PAYG_PARTIAL';
    v_offer := round(v_balance, 2);
  else
    -- Below the minimum useful budget. Do not burn the remainder on a search
    -- that cannot produce anything worth having.
    v_funding := 'TOPUP_REQUIRED';
    v_offer := 0;
  end if;

  return v_quote || jsonb_build_object(
    'offer', v_funding,
    'available_balance', v_balance,
    'min_viable_budget_credits', v_min_viable,
    'offered_authorized_max_credits', v_offer,
    -- What the customer would need to add to reach a full-depth search.
    'credits_short_of_full', greatest(round(v_est_max - v_balance, 2), 0),
    'credits_short_of_viable', greatest(round(v_min_viable - v_balance, 2), 0));
end;
$fn$;

REVOKE ALL ON FUNCTION public.billing_budget_to_cogs_ceiling(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_budget_to_cogs_ceiling(text, text, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.billing_budget_offer(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_budget_offer(text, numeric) TO authenticated, service_role;

-- ── 4. wallet_reserve enforces the minimum viable budget ────
-- Body is otherwise identical to 20260911193358; only the new floor check and
-- the budget snapshot are added.
--
-- VERIFIED ON PRODUCTION (probe account, since removed), FIND_CLIENTS at FREE,
-- estimate 17.50-32.50, minimum viable 5:
--   balance 40 -> PAYG_FULL,    authorise 32.50
--   balance 10 -> PAYG_PARTIAL, authorise 10.00, short of full 22.50
--   balance  5 -> PAYG_PARTIAL, authorise  5.00  (boundary is inclusive)
--   balance  2 -> TOPUP_REQUIRED, short of viable 3.00
--   reserve 10 -> provider budget snapshot 23c (the budget, not the plan's 200c)
--   actual 7.4 -> charged 7.40, released 2.60
--   provider wants 26 against 10 authorised -> charged 10.00, clamped
--   reserve 3  -> BELOW_MIN_VIABLE_BUDGET
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
  v_budget_cents numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_authorized_max_credits is null or p_authorized_max_credits <= 0 then raise exception 'INVALID_AUTHORIZED_MAX'; end if;

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

  -- A budget below the minimum useful one buys a search not worth running.
  -- Refusing here is kinder than spending the customer's last credits on it.
  if p_authorized_max_credits < COALESCE(v_product.min_viable_budget_credits, 0) then
    raise exception 'BELOW_MIN_VIABLE_BUDGET: % < %',
      p_authorized_max_credits, v_product.min_viable_budget_credits;
  end if;

  v_plan_code := public.billing_current_plan(p_user_id);
  select * into v_plan from public.billing_plans where code = v_plan_code;
  select * into v_ent from public.product_plan_entitlements
   where plan_code = v_plan_code and product_code = p_product_code;

  v_need := round(p_authorized_max_credits, 4);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_need then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_need;
  update public.credit_accounts
     set balance = v_after, reserved = reserved + v_need, updated_at = now()
   where user_id = p_user_id;

  -- The provider spend this budget authorises, at THIS plan's member rate.
  -- Snapshotted as the stricter of the plan's operational ceiling and what the
  -- money actually buys, so the worker has one number to obey.
  v_budget_cents := public.billing_budget_to_cogs_ceiling(p_product_code, v_plan_code, v_need);
  if v_ent.provider_budget_ceiling_cents is not null then
    v_budget_cents := least(v_budget_cents, v_ent.provider_budget_ceiling_cents);
  end if;

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
    v_plan.profit_share_to_customer_bps, v_ent.result_ceiling, floor(v_budget_cents)::integer,
    round(COALESCE(p_estimate_min_credits,0),4), round(COALESCE(p_estimate_max_credits,0),4),
    v_need, v_need,
    p_job_ref, p_idempotency_key,
    COALESCE(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'budget_mode', case when v_need < round(COALESCE(p_estimate_max_credits,0),4) then 'PARTIAL' else 'FULL' end),
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

  if v_need > 0 then
    raise exception 'WALLET_LOT_DRIFT: balance covered the reservation but lots are short by % credits', v_need;
  end if;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (p_user_id, -round(p_authorized_max_credits,4), v_before, v_after, 'SERVICE_RESERVE',
          'res:' || v_res::text,
          jsonb_build_object('reservation_id', v_res, 'product_code', p_product_code,
                             'plan_code', v_plan_code, 'allocations', v_alloc,
                             'provider_budget_cents', floor(v_budget_cents)::integer))
  returning id into v_ledger;

  update public.usage_reservations set ledger_reserve_id = v_ledger where id = v_res;

  return query select v_res, round(p_authorized_max_credits,4), v_after, false;
end;
$fn$;
REVOKE ALL ON FUNCTION public.wallet_reserve(uuid, text, numeric, text, numeric, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_reserve(uuid, text, numeric, text, numeric, numeric, text, jsonb) TO service_role;

-- ── 5. A paid search includes its results ───────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS unlock_included_reservation_id uuid REFERENCES public.usage_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_matches_unlock_included
  ON public.matches(unlock_included_reservation_id) WHERE unlock_included_reservation_id IS NOT NULL;

COMMENT ON COLUMN public.matches.unlock_included_reservation_id IS
  'Set when this match was produced by a Find Clients search the customer already paid for. atomic_match_unlock charges 0 for these. Historical unlocks predating this column are untouched and keep their real charge.';
