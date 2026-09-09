-- Homatch — the function that creates credits should say who may call it.
--
-- WHAT WAS FOUND
--
-- Of the five SECURITY DEFINER functions that move credits, four state their
-- caller rule in the body:
--
--   reserve_credits_for_product   service_role, or the account's own owner
--   capture_credit_reservation    service_role only
--   release_credit_reservation    service_role only
--   atomic_match_unlock           service_role, or the account's own owner
--
-- credit_topup_atomic -- the one that ADDS credits, i.e. the one that mints
-- the thing everything else spends -- states nothing. It validates its
-- arguments and then increases a balance for whatever user id it was handed.
--
-- Today that is safe, because EXECUTE is not granted to authenticated or anon;
-- only the service role can reach it. But that is the whole defence, and it
-- lives somewhere other than the function. A future `grant execute ... to
-- authenticated` -- the kind of line that gets added to make one screen work
-- -- would turn it into a self-service money printer, and nothing in the
-- function would object.
--
-- This adds the same guard its four siblings already have. Behaviour is
-- unchanged for every current caller: payment-webhook and credits-topup run
-- under the service role.
--
-- The body is otherwise identical to what is deployed, including the
-- create-account-if-missing branch. search_path is tightened to put pg_temp
-- last rather than leaving it implicitly first.

create or replace function public.credit_topup_atomic(
  p_user_id uuid,
  p_credits numeric,
  p_reference text,
  p_payment_id uuid default null::uuid
)
returns table(ledger_entry_id uuid, balance_after numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before numeric;
  v_after  numeric;
  v_ledger uuid;
begin
  if p_user_id is null or p_credits is null or p_credits <= 0 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Adding credits is a server-side act. A customer topping up goes through
  -- the payment provider and the webhook, never through here directly.
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select ca.balance into v_before
    from public.credit_accounts ca
   where ca.user_id = p_user_id
     for update;

  if not found then
    insert into public.credit_accounts(user_id, balance) values (p_user_id, 0);
    v_before := 0;
  end if;

  v_after := v_before + p_credits;

  update public.credit_accounts
     set balance = v_after, updated_at = now()
   where user_id = p_user_id;

  -- A retried webhook delivery trips credit_ledger_user_type_reference_uidx
  -- here and the whole transaction rolls back, balance included, rather than
  -- crediting the customer twice.
  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, payment_id)
  values (p_user_id, p_credits, v_before, v_after, 'TOP_UP', p_reference, p_payment_id)
  returning id into v_ledger;

  return query select v_ledger, v_after;
end;
$$;

revoke all on function public.credit_topup_atomic(uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.credit_topup_atomic(uuid, numeric, text, uuid) to service_role;
