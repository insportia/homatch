-- THE SPEND-WHILE-VIEWED GUARD NO LONGER BREAKS EVERY RESERVATION.
--
-- 20260928400000 attached public.homatch_refuse_spend_while_viewed() BEFORE INSERT on
-- credit_ledger, credit_reservations (when present) and usage_reservations. Its first
-- statement was
--
--     if tg_table_name = 'credit_ledger' and coalesce(new.amount, 0) >= 0 then
--
-- PL/pgSQL does not short-circuit that AND: on a usage_reservations or
-- credit_reservations row, which has no amount column, evaluating new.amount raises
-- 42703 (record "new" has no field "amount"). Every wallet_reserve() therefore failed
-- at its insert into public.usage_reservations, and every PAYG product reported
-- reason 'ERROR' from beginExecution. Production logs show the 42703 inside
-- wallet_reserve on 2026-10-03; the last reservation row written is from 2026-09-22.
--
-- The fix reads new.amount only inside a credit_ledger-only branch. Semantics are
-- otherwise identical: positive ledger rows (top-ups, refunds) always pass; debits and
-- reservations for an account an administrator is viewing are refused with 42501.
-- Triggers, wallet_reserve and every table are untouched.

create or replace function public.homatch_refuse_spend_while_viewed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'credit_ledger' then
    if coalesce(new.amount, 0) >= 0 then
      return new;
    end if;
  end if;
  if public.account_is_being_viewed(new.user_id) then
    raise exception 'READ_ONLY_IMPERSONATION: no spend on % while an administrator is viewing this account',
      tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.homatch_refuse_spend_while_viewed() from public, anon, authenticated;
