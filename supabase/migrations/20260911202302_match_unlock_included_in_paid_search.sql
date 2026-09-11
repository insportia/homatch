-- Homatch — never charge twice for one thing.
--
-- A Find Clients search is now a billed execution in its own right. Charging
-- again to reveal what that search found would mean the customer pays for the
-- work and then pays again for the answer, which is the one thing the pricing
-- model must not do.
--
-- So a match carrying unlock_included_reservation_id is revealed for zero.
-- Everything else about the path is unchanged: the same ownership check, the
-- same single transaction, the same match_unlocks row, the same reveal
-- payload. Only the price is zero, and no ledger entry is written, because
-- nothing moved.
--
-- WHY A match_unlocks ROW IS STILL WRITTEN AT ZERO
--
-- It is the record of what was revealed and when, it is what makes a second
-- reveal idempotent, and lead-exposure ranking reads it. Skipping it to "save"
-- a row would break all three. credits_charged = 0 and ledger_entry_id = null
-- say plainly that this reveal was already paid for upstream.
--
-- LEGACY DATA IS UNTOUCHED
--
-- Unlocks that predate this keep their real charge and their ledger entry.
-- This changes what happens NEXT, not what happened.
--
-- VERIFIED ON PRODUCTION (probe, since removed):
--   paid-search result       -> charged 0, balance unchanged, NO ledger row
--   separately-priced result -> charged 4.00, ledger row written
--   re-reveal of the included one -> charged 0, already_unlocked = true
--   1 MATCH_UNLOCK ledger row, 2 match_unlocks history rows

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
as $fn$
declare
  v_match     record;
  v_existing  record;
  v_price     numeric;
  v_included  boolean := false;
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

  if auth.role() <> 'service_role' and p_user_id <> public.auth_user_id() then
    raise exception 'FORBIDDEN';
  end if;

  -- Already revealed? Return what they have; never charge twice.
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

  select m.id, m.property_id, m.signal_id, m.intent_profile_id, m.mock_mode,
         m.unlock_price_credits, m.unlock_included_reservation_id
    into v_match
    from public.matches m
   where m.id = p_match_id
     for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  perform 1 from public.properties p
   where p.id = v_match.property_id and p.user_id = p_user_id;
  if not found then raise exception 'NOT_YOUR_PROPERTY'; end if;

  -- THE CHANGE. A result produced by a search the customer already paid for
  -- costs nothing to reveal.
  v_included := v_match.unlock_included_reservation_id is not null;
  v_price := case when v_included then 0 else v_match.unlock_price_credits end;

  select ca.balance into v_before
    from public.credit_accounts ca
   where ca.user_id = p_user_id
     for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price then raise exception 'INSUFFICIENT_CREDITS'; end if;

  -- Reveal payload, in the original precedence:
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

  -- Nothing moved, so nothing is written to the account or the ledger. A
  -- zero-amount MATCH_UNLOCK entry would misreport an unlock that was already
  -- paid for as a second, free one.
  if v_price > 0 then
    update public.credit_accounts
       set balance = v_after, updated_at = now()
     where user_id = p_user_id;

    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
    values (p_user_id, -v_price, v_before, v_after, 'MATCH_UNLOCK', 'match:' || p_match_id::text)
    returning id into v_ledger;
  end if;

  insert into public.match_unlocks(
    match_id, user_id, credits_charged, ledger_entry_id,
    full_signal_text, full_source_url, full_profile_url, full_intent_json)
  values (p_match_id, p_user_id, v_price, v_ledger, v_text, v_source, v_profile, v_intent)
  returning id into v_unlock;

  update public.matches set status = 'UNLOCKED', updated_at = now() where id = p_match_id;

  if v_match.mock_mode then
    delete from public.match_unlocks_pending where match_id = p_match_id;
  end if;

  return query select v_unlock, v_ledger, v_price, v_after, false,
                      v_text, v_source, v_profile, v_intent;
end $fn$;

comment on function public.atomic_match_unlock(uuid, uuid) is
  'Reveals a match in one transaction. Charges unlock_price_credits, or ZERO when the match carries unlock_included_reservation_id because the Find Clients search that produced it was already paid for. Historical unlocks keep their original charge.';

revoke all on function public.atomic_match_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.atomic_match_unlock(uuid, uuid) to service_role;
