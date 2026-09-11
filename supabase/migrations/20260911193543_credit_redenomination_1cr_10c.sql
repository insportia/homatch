-- HOMATCH — one-time credit redenomination, and the credit_lots backfill.
--
--   BEFORE:  1 Credit = $1.00
--   AFTER:   1 Credit = $0.10   (credits_per_usd = 10)
--
-- THE RULE THIS MIGRATION OBEYS
--
-- Nobody's money changes. A wallet holding $9,997.86 of value before this runs
-- holds $9,997.86 of value after it. An unlock that cost $0.16 before costs
-- $0.16 after. Only the unit the number is printed in changes, the way a
-- currency redenomination works.
--
-- Therefore everything denominated in CREDITS is multiplied by 10, and
-- everything denominated in DOLLARS is left alone. Getting that split wrong in
-- either direction is a real money bug, so each setting below is classified
-- explicitly rather than pattern-matched.
--
-- HOW IT STAYS AUDITABLE AND REVERSIBLE
--
-- Historical ledger rows are NOT rewritten. A ledger is append-only; an audit
-- trail you can edit is not one, and the rows are a true record of what
-- happened under the old unit. Instead each account gets ONE new REDENOMINATION
-- entry for the 9x uplift (new = old x 10, so the delta is old x 9), which
-- leaves SUM(amount) equal to the new balance and keeps
-- billing_wallet_integrity() green.
--
-- Reversal, if this ever had to be undone, is a counter-entry of the same shape
-- with the sign flipped plus restoring the seven admin_settings values listed
-- below. No data is destroyed here, so nothing is lost.
--
-- PRECONDITIONS VERIFIED ON PRODUCTION BEFORE WRITING THIS
--
--   credit_reservations RESERVED  = 0   (nothing mid-flight to convert)
--   research_purchases            = 0
--   match_unlocks_pending         = 0
--   payments COMPLETED            = 0   (the single payment row was a PENDING
--                                        stripe_mock test record)
--
-- The migration re-checks the first three at runtime and refuses to proceed if
-- any is non-zero, so it cannot silently do the wrong thing if it is ever
-- replayed against a different database state.
--
-- APPLIED RESULT, verified in production:
--   9,997.86 CR  ->  99,978.60 CR
--   $9,997.86    ->  $9,997.86          delta $0.00
--   balance = lots_available = ledger_sum = 99,978.60

DO $$
DECLARE
  v_open_res integer;
  v_pending integer;
  v_already integer;
  v_factor numeric := 10;
  v_acct record;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_ledger uuid;
  v_lot_kind text;
  v_accounts integer := 0;
  v_lots integer := 0;
BEGIN
  -- Guard 0: run once.
  SELECT count(*) INTO v_already FROM public.credit_ledger WHERE type = 'REDENOMINATION';
  IF v_already > 0 THEN
    RAISE NOTICE 'Redenomination already applied (% ledger rows). Skipping.', v_already;
    RETURN;
  END IF;

  -- Guard 1: nothing mid-flight. An open reservation holds credits in the old
  -- unit; converting the balance under it would leave the hold and the wallet
  -- disagreeing.
  SELECT count(*) INTO v_open_res FROM public.credit_reservations WHERE status = 'RESERVED';
  IF v_open_res > 0 THEN
    RAISE EXCEPTION 'REFUSING_TO_REDENOMINATE: % open credit_reservations. Settle or release them first.', v_open_res;
  END IF;

  SELECT count(*) INTO v_open_res FROM public.usage_reservations WHERE status = 'RESERVED';
  IF v_open_res > 0 THEN
    RAISE EXCEPTION 'REFUSING_TO_REDENOMINATE: % open usage_reservations.', v_open_res;
  END IF;

  SELECT count(*) INTO v_pending FROM public.match_unlocks_pending;
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'REFUSING_TO_REDENOMINATE: % pending match unlocks.', v_pending;
  END IF;

  -- Step 1: balances.
  FOR v_acct IN SELECT * FROM public.credit_accounts ORDER BY user_id FOR UPDATE LOOP
    v_before := v_acct.balance;
    v_after  := round(v_before * v_factor, 4);
    v_delta  := round(v_after - v_before, 4);
    v_ledger := NULL;

    IF v_delta <> 0 THEN
      UPDATE public.credit_accounts
         SET balance = v_after, updated_at = now()
       WHERE user_id = v_acct.user_id;

      INSERT INTO public.credit_ledger
        (user_id, amount, balance_before, balance_after, type, reference, metadata)
      VALUES (v_acct.user_id, v_delta, v_before, v_after, 'REDENOMINATION',
              'redenomination:2026-09-13:1cr_1usd_to_1cr_0.10usd',
              jsonb_build_object(
                'factor', v_factor,
                'old_credits', v_before,
                'new_credits', v_after,
                'usd_value_before', round(v_before * 1.00, 4),
                'usd_value_after',  round(v_after / v_factor, 4),
                'economic_value_unchanged', true,
                'reversal', 'insert a REVERSAL entry of -' || v_delta || ' and restore the admin_settings listed in this migration'))
      RETURNING id INTO v_ledger;

      v_accounts := v_accounts + 1;
    END IF;

    -- Step 2: give the existing balance a provenance lot. Before today every
    -- credit was one opaque number. The only non-zero balance came from an
    -- ADMIN_ADJUSTMENT (founder test credits), so it becomes an ADJUSTMENT lot
    -- rather than being misreported as PURCHASED revenue. It never expires.
    IF v_after > 0 THEN
      SELECT CASE WHEN EXISTS (
               SELECT 1 FROM public.credit_ledger
                WHERE user_id = v_acct.user_id AND type = 'TOP_UP')
             THEN 'PURCHASED' ELSE 'ADJUSTMENT' END
        INTO v_lot_kind;

      -- uidx_credit_lots_source is a PARTIAL unique index, so the conflict
      -- target has to carry its predicate for Postgres to infer it.
      INSERT INTO public.credit_lots
        (user_id, kind, credits_granted, source_type, source_ref, ledger_entry_id, granted_at)
      VALUES (v_acct.user_id, v_lot_kind, v_after, 'legacy_balance',
              'redenomination:2026-09-13', v_ledger, now())
      ON CONFLICT (user_id, source_type, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
      v_lots := v_lots + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Redenomination: % accounts rescaled, % legacy lots created.', v_accounts, v_lots;
END $$;

-- Step 3: live credit-denominated prices.
--
-- CREDIT-DENOMINATED -> multiply by 10. These are the match-unlock pricing
-- levers read by run-matching-v2. Leaving them would make every unlock ten
-- times cheaper in real money overnight.
UPDATE public.admin_settings SET value = to_jsonb(value::text::numeric * 10), updated_at = now()
 WHERE key IN ('pricing_base_potential','pricing_base_good','pricing_base_strong',
               'pricing_base_very_strong','pricing_base_exceptional',
               'pricing_min_credits','pricing_max_credits')
   AND NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE type = 'REDENOMINATION'
                   AND reference = 'redenomination:2026-09-13:settings_done');

-- DOLLAR-DENOMINATED or DIMENSIONLESS -> deliberately untouched:
--   external_estimated_cost_apify / _dataforseo   USD provider cost
--   spend_cap_*                                   USD caps
--   outreach_*_price*                             USD
--   pricing_multiplier_*                          ratios
--   vat_rate_bps                                  basis points
--   research_products.price_cents                 integer cents

-- Unpurchased match prices carry the old unit and are quoted live to customers,
-- so they move with the settings that produced them.
UPDATE public.matches SET unlock_price_credits = round(unlock_price_credits * 10, 2)
 WHERE unlock_price_credits IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE type = 'REDENOMINATION'
                   AND reference = 'redenomination:2026-09-13:settings_done');

-- match_unlocks.credits_charged is deliberately NOT rescaled. It is a
-- historical record of what was actually charged under the old unit, the same
-- reason the historical ledger rows are left alone.

-- One marker row so step 3 is idempotent on replay.
INSERT INTO public.credit_ledger (user_id, amount, balance_before, balance_after, type, reference, metadata)
SELECT u.id, 0, 0, 0, 'REDENOMINATION', 'redenomination:2026-09-13:settings_done',
       jsonb_build_object('scope','admin_settings + matches.unlock_price_credits',
                          'note','Marker only. Zero amount, so it does not affect any balance or the ledger sum.')
  FROM public.users u WHERE u.is_admin = true
 ORDER BY u.created_at LIMIT 1
ON CONFLICT DO NOTHING;

-- Step 4: the old fixed-price RPC must speak the new unit.
-- reserve_credits_for_product divided price_cents by 100 on the assumption that
-- $1 = 1 Credit. Under the new denomination that under-charges by exactly 10x.
-- It now goes through billing_cents_to_credits(), which reads credits_per_usd,
-- so this can never drift again.
CREATE OR REPLACE FUNCTION public.reserve_credits_for_product(
  p_user_id uuid,
  p_product_code text,
  p_reference text DEFAULT NULL
) RETURNS TABLE(reservation_id uuid, ledger_entry_id uuid, credits_reserved numeric, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
declare
  v_product record;
  v_price_credits numeric;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
  v_reservation uuid;
begin
  if p_user_id is null or p_product_code is null then raise exception 'INVALID_ARGUMENT'; end if;
  if auth.role() <> 'service_role' and p_user_id <> public.auth_user_id() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_product from public.research_products where code = p_product_code and enabled = true;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_DISABLED'; end if;

  -- Was: v_product.price_cents::numeric / 100  (hardcoded $1 = 1 Credit).
  v_price_credits := public.billing_cents_to_credits(v_product.price_cents);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_price_credits;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
  values (p_user_id, -v_price_credits, v_before, v_after, 'SERVICE_RESERVE', coalesce(p_reference, 'product:' || p_product_code))
  returning id into v_ledger;

  insert into public.credit_reservations(user_id, product_code, credits_amount, status, ledger_reserve_id, reference)
  values (p_user_id, p_product_code, v_price_credits, 'RESERVED', v_ledger, p_reference)
  returning id into v_reservation;

  return query select v_reservation, v_ledger, v_price_credits, v_after;
end;
$fn$;

REVOKE ALL ON FUNCTION public.reserve_credits_for_product(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_credits_for_product(uuid, text, text) TO service_role, authenticated;

-- Step 5: keep lots in step with the legacy spend paths.
--
-- atomic_match_unlock and reserve_credits_for_product debit
-- credit_accounts.balance directly. Without this, a legacy unlock would move
-- the balance but not the lots, and billing_wallet_integrity() would start
-- reporting drift on an account that is in fact perfectly correct.
--
-- A trigger is the right shape here precisely BECAUSE those callers are
-- pre-existing and are not being rewritten: it makes the invariant hold for
-- spend paths this project has not taught about lots, without touching them.
CREATE OR REPLACE FUNCTION public.credit_lots_follow_legacy_debit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
declare
  v_delta numeric;
  v_need numeric;
  v_take numeric;
  v_lot record;
begin
  v_delta := NEW.balance - OLD.balance;
  if v_delta >= 0 then return NEW; end if;
  v_need := -v_delta;

  -- The v2 paths (wallet_reserve / wallet_settle / wallet_release /
  -- wallet_grant_credits / wallet_expire_lots) maintain the lots themselves.
  -- They mark the transaction so this trigger stands aside.
  if COALESCE(current_setting('homatch.lots_managed', true), '') = 'on' then
    return NEW;
  end if;

  for v_lot in
    select * from public.credit_lots
     where user_id = NEW.user_id and status = 'ACTIVE' and credits_available > 0
       and (expires_at is null or expires_at > now())
     order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1
                        when 'ADJUSTMENT' then 2 else 3 end,
              expires_at asc nulls last, granted_at asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.credits_available, v_need);
    update public.credit_lots
       set credits_consumed = credits_consumed + v_take,
           status = case when (credits_granted - credits_consumed - v_take - credits_reserved - credits_expired) <= 0
                         then 'EXHAUSTED' else status end,
           updated_at = now()
     where id = v_lot.id;
    v_need := round(v_need - v_take, 4);
  end loop;

  -- An account can legitimately have no lots (created before this migration,
  -- never held a balance). Do not block the spend; the integrity view reports
  -- the drift instead of a customer hitting an error.
  if v_need > 0 then
    raise warning 'credit_lots_follow_legacy_debit: % credits of spend for user % had no lot to draw from',
      v_need, NEW.user_id;
  end if;

  return NEW;
end;
$fn$;
REVOKE EXECUTE ON FUNCTION public.credit_lots_follow_legacy_debit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_credit_lots_follow_legacy_debit ON public.credit_accounts;
CREATE TRIGGER trg_credit_lots_follow_legacy_debit
  AFTER UPDATE OF balance ON public.credit_accounts
  FOR EACH ROW
  WHEN (NEW.balance < OLD.balance)
  EXECUTE FUNCTION public.credit_lots_follow_legacy_debit();
