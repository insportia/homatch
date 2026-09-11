-- Homatch — the external unlock path gets the same three guarantees its
-- sibling already has.
--
-- WHAT WAS FOUND
--
-- atomic_external_match_unlock does the same job as atomic_match_unlock for
-- external-signal matches, and is missing three things that one has:
--
-- (1) NO OWNERSHIP CHECK. It selects the match by id and reveals it. The
--     caller, unlock-external-contact, does not check either: it fetches
--     `matches` by id with the SERVICE ROLE, so RLS does not apply, and never
--     compares the match's property to the caller. Any authenticated customer
--     who had a match id could therefore unlock a lead attached to somebody
--     else's property. They pay their own credits for it, so this is not theft
--     of money -- it is disclosure of another customer's discovered lead,
--     which is the actual product.
--
--     atomic_match_unlock has had the NOT_YOUR_PROPERTY check since
--     20260911180000. This brings the external path level.
--
-- (2) NO CALLER GUARD. Its siblings all check auth.role() or ownership before
--     moving credits. This one took whatever p_user_id it was handed.
--
-- (3) NO INCLUDED-RESULT HANDLING. A Find Clients search is now a paid
--     execution that includes its results, and external-signal matches are
--     most of what such a search produces. Without this they would be charged
--     a second time on reveal, which is the exact thing the billing decision
--     forbids.
--
-- Behaviour for a legitimate caller unlocking their own match is unchanged
-- apart from the price, which is zero when the search already paid for it.

create or replace function public.atomic_external_match_unlock(p_user_id uuid, p_match_id uuid)
returns table(unlock_id uuid, ledger_entry_id uuid, credits_charged numeric, balance_after numeric, already_unlocked boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_price numeric;
  v_balance numeric;
  v_before numeric;
  v_ledger uuid;
  v_unlock uuid;
  v_match record;
  v_signal_text text;
  v_source_url text;
  v_profile_url text;
  v_intent jsonb;
begin
  if p_user_id is null or p_match_id is null then raise exception 'INVALID_ARGUMENT'; end if;

  -- (2) Defence in depth, matching atomic_match_unlock.
  if auth.role() <> 'service_role' and p_user_id <> public.auth_user_id() then
    raise exception 'FORBIDDEN';
  end if;

  select mu.id, mu.ledger_entry_id, mu.credits_charged
    into v_unlock, v_ledger, v_price
  from public.match_unlocks mu
  where mu.user_id = p_user_id and mu.match_id = p_match_id;
  if v_unlock is not null then
    select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
    return query select v_unlock, v_ledger, v_price, coalesce(v_balance, 0), true;
    return;
  end if;

  select m.unlock_price_credits, m.signal_id, m.property_id, m.unlock_included_reservation_id
    into v_match
  from public.matches m where m.id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if v_match.signal_id is null then raise exception 'EXTERNAL_SIGNAL_REQUIRED'; end if;

  -- (1) The lead belongs to the property's owner.
  perform 1 from public.properties p
   where p.id = v_match.property_id and p.user_id = p_user_id;
  if not found then raise exception 'NOT_YOUR_PROPERTY'; end if;

  -- (3) Produced by a search this customer already paid for.
  v_price := case when v_match.unlock_included_reservation_id is not null
                  then 0 else v_match.unlock_price_credits end;

  select rs.original_text, rs.source_url, coalesce(rs.profile_url, rs.author_public_url), rs.intent_json
    into v_signal_text, v_source_url, v_profile_url, v_intent
  from public.raw_signals rs where rs.id = v_match.signal_id;
  if not found then raise exception 'SIGNAL_NOT_FOUND'; end if;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price then raise exception 'INSUFFICIENT_CREDITS'; end if;
  v_balance := v_before - v_price;

  -- Nothing moved when the search already paid, so nothing is written to the
  -- account or the ledger.
  if v_price > 0 then
    update public.credit_accounts set balance = v_balance, updated_at = now() where user_id = p_user_id;
    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference)
    values (p_user_id, -v_price, v_before, v_balance, 'MATCH_UNLOCK', 'external-match:' || p_match_id::text)
    returning id into v_ledger;
  end if;

  insert into public.match_unlocks(match_id, user_id, credits_charged, ledger_entry_id,
                                   full_signal_text, full_source_url, full_profile_url, full_intent_json)
  values (p_match_id, p_user_id, v_price, v_ledger, v_signal_text, v_source_url, v_profile_url, v_intent)
  returning id into v_unlock;

  update public.matches set status = 'UNLOCKED', updated_at = now() where id = p_match_id;

  return query select v_unlock, v_ledger, v_price, v_balance, false;
end; $fn$;

comment on function public.atomic_external_match_unlock(uuid, uuid) is
  'Reveals an external-signal match in one transaction. Checks property ownership (NOT_YOUR_PROPERTY) and the caller identity, and charges ZERO when the match carries unlock_included_reservation_id because the Find Clients search that produced it was already paid for.';

revoke all on function public.atomic_external_match_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.atomic_external_match_unlock(uuid, uuid) to service_role;
