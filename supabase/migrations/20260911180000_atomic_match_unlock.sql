-- Homatch — make the unlock that is called "atomic" actually atomic.
--
-- WHAT WAS FOUND
--
-- supabase/functions/atomic-unlock does the whole money operation as three
-- separate PostgREST round trips with hand-written compensation:
--
--   1. update credit_accounts set balance = newBalance
--        where user_id = ... and balance = balance      -- "optimistic lock"
--   2. insert into credit_ledger ...                    -- on failure: put the
--                                                       --   old balance back
--   3. insert into match_unlocks ...                    -- on failure: put the
--                                                       --   old balance back
--                                                       --   AND delete the
--                                                       --   ledger row
--
-- Three things are wrong with that, and the first one gives the product away.
--
-- (1) THE DEBIT IS NEVER CHECKED FOR ROWS.
--
--     Step 1 checks `debitErr` and nothing else. The `.eq('balance', balance)`
--     guard is the entire concurrency story, and when it does its job -- when
--     a concurrent unlock or top-up has moved the balance -- the statement
--     matches ZERO rows. PostgREST answers a zero-row UPDATE with 204 and no
--     error. So `debitErr` is null, the code proceeds to write the ledger
--     entry, the unlock row and the full seller reveal, and NOTHING WAS
--     CHARGED. The customer gets the contact details for free, and the ledger
--     says they paid.
--
--     The same 204-on-zero-rows behaviour was proven in this database earlier
--     against public.matches: rows_updated=0 with no error raised.
--
-- (2) THE COMPENSATION CLOBBERS CONCURRENT WRITES.
--
--     Both rollback paths do `update credit_accounts set balance = <the value
--     we read at the start>` with no guard at all. If a top-up landed in
--     between, restoring the stale balance silently deletes the customer's
--     purchase. A compensating write with no optimistic lock is strictly worse
--     than the forward write it is compensating for, which does have one.
--
-- (3) IT DELETES A LEDGER ROW.
--
--     Step 3's rollback removes the credit_ledger entry written by step 2. A
--     ledger is an append-only record of what happened; deleting from it means
--     the audit trail cannot be trusted to show a failed attempt.
--
-- There is no transaction anywhere in this: each PostgREST call commits on its
-- own, so a function timeout or a cold-start kill between any two steps leaves
-- the account debited with no unlock, or unlocked with no debit.
--
-- The codebase already knows how to do this properly. Sibling function
-- atomic_external_match_unlock does the identical job for external signal
-- matches in ONE transaction with SELECT ... FOR UPDATE. This gives the normal
-- unlock path the same treatment, so both unlock routes are transactional and
-- shaped the same way.
--
-- WHAT THIS FUNCTION GUARANTEES
--
--   * one transaction -- balance, ledger, unlock row and match status either
--     all happen or none do, so there is no compensation to get wrong
--   * SELECT ... FOR UPDATE on the credit account, so a concurrent unlock
--     waits rather than racing; no zero-row debit can slip through, because
--     the debit is keyed on the row this transaction holds
--   * the caller must own the property the match belongs to
--   * a second unlock returns the first one instead of charging again, backed
--     by the existing UNIQUE (match_id, user_id) on match_unlocks
--   * the reveal payload keeps the exact precedence the Edge Function used:
--     the pending mock row, then raw_signals, then intent_profiles
--
-- Reveal data is returned by the function rather than re-read afterwards, so
-- the caller never has to query match_unlocks again and cannot accidentally
-- read a row belonging to someone else.

create or replace function public.atomic_match_unlock(p_user_id uuid, p_match_id uuid)
returns table (
  unlock_id         uuid,
  ledger_entry_id   uuid,
  credits_charged   numeric,
  balance_after     numeric,
  already_unlocked  boolean,
  full_signal_text  text,
  full_source_url   text,
  full_profile_url  text,
  full_intent_json  jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match     record;
  v_existing  record;
  v_price     numeric;
  v_before    numeric;
  v_after     numeric;
  v_ledger    uuid;
  v_unlock    uuid;
  v_text      text;
  v_source    text;
  v_profile   text;
  v_intent    jsonb;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  -- Defence in depth. The Edge Function authenticates the caller and passes
  -- their own id, but a SECURITY DEFINER function that moves money should not
  -- take that on trust: reserve_credits_for_product makes the same check.
  if auth.role() <> 'service_role' and p_user_id <> public.auth_user_id() then
    raise exception 'FORBIDDEN';
  end if;

  -- Already paid for? Return what they bought; never charge twice.
  select mu.id, mu.ledger_entry_id, mu.credits_charged,
         mu.full_signal_text, mu.full_source_url, mu.full_profile_url, mu.full_intent_json
    into v_existing
    from public.match_unlocks mu
   where mu.user_id = p_user_id and mu.match_id = p_match_id;

  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = p_user_id;
    return query select v_existing.id, v_existing.ledger_entry_id, v_existing.credits_charged,
                        coalesce(v_after, 0), true,
                        v_existing.full_signal_text, v_existing.full_source_url,
                        v_existing.full_profile_url, v_existing.full_intent_json;
    return;
  end if;

  select m.id, m.property_id, m.signal_id, m.intent_profile_id, m.mock_mode, m.unlock_price_credits
    into v_match
    from public.matches m
   where m.id = p_match_id
     for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  -- The buyer signal belongs to the property's owner. Checked here as well as
  -- in the Edge Function so the guarantee does not depend on the caller.
  perform 1 from public.properties p
   where p.id = v_match.property_id and p.user_id = p_user_id;
  if not found then raise exception 'NOT_YOUR_PROPERTY'; end if;

  v_price := v_match.unlock_price_credits;

  -- FOR UPDATE: a concurrent unlock for the same account waits here instead of
  -- reading the same balance and both spending it.
  select ca.balance into v_before
    from public.credit_accounts ca
   where ca.user_id = p_user_id
     for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price then raise exception 'INSUFFICIENT_CREDITS'; end if;

  -- Reveal payload, in the Edge Function's original precedence:
  -- pending mock row > raw_signals > intent_profiles.
  if v_match.mock_mode then
    select p.full_signal_text, p.full_source_url, p.full_profile_url, p.full_intent_json
      into v_text, v_source, v_profile, v_intent
      from public.match_unlocks_pending p
     where p.match_id = p_match_id;
  end if;

  if v_match.signal_id is not null then
    select coalesce(v_text, rs.original_text),
           coalesce(v_source, rs.source_url),
           coalesce(v_profile, rs.author_public_url, rs.profile_url),
           coalesce(v_intent, rs.intent_json)
      into v_text, v_source, v_profile, v_intent
      from public.raw_signals rs
     where rs.id = v_match.signal_id;
  end if;

  if v_intent is null and v_match.intent_profile_id is not null then
    select to_jsonb(ip) into v_intent
      from public.intent_profiles ip
     where ip.id = v_match.intent_profile_id;
  end if;

  v_after := v_before - v_price;

  update public.credit_accounts
     set balance = v_after, updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
  values (p_user_id, -v_price, v_before, v_after, 'MATCH_UNLOCK', 'match:' || p_match_id::text)
  returning id into v_ledger;

  insert into public.match_unlocks(
    match_id, user_id, credits_charged, ledger_entry_id,
    full_signal_text, full_source_url, full_profile_url, full_intent_json)
  values (p_match_id, p_user_id, v_price, v_ledger, v_text, v_source, v_profile, v_intent)
  returning id into v_unlock;

  update public.matches set status = 'UNLOCKED', updated_at = now() where id = p_match_id;

  -- The pending reveal has been consumed.
  if v_match.mock_mode then
    delete from public.match_unlocks_pending where match_id = p_match_id;
  end if;

  return query select v_unlock, v_ledger, v_price, v_after, false,
                      v_text, v_source, v_profile, v_intent;
end $$;

comment on function public.atomic_match_unlock(uuid, uuid) is
  'Charges credits and reveals a match in one transaction. Replaces the three-round-trip compensation dance in the atomic-unlock Edge Function, whose debit could match zero rows without raising an error.';

-- `authenticated` is named explicitly. Supabase's default privileges grant
-- EXECUTE on every new function in public directly to anon and authenticated,
-- so revoking from PUBLIC alone leaves that direct grant in place -- checked
-- after the first apply, where has_function_privilege('authenticated', ...)
-- still came back true. Only the server calls this.
revoke all on function public.atomic_match_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.atomic_match_unlock(uuid, uuid) to service_role;

/* ---------------- a balance may not go negative ----------------

   Every path that spends credits checks the balance first, so this should
   never fire. That is exactly why it is worth having: it is the backstop that
   turns "we believe every spend path checks" into something the database
   enforces, and the next spend path that forgets fails loudly instead of
   quietly putting an account underwater.

   Verified before adding: zero accounts currently hold a negative balance. */

alter table public.credit_accounts drop constraint if exists credit_accounts_balance_non_negative;
alter table public.credit_accounts add constraint credit_accounts_balance_non_negative
  check (balance >= 0);
