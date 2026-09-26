-- AN ALLOWANCE IS ALSO A PAID SEARCH.
--
-- match-campaign stamps every result a billed search produced with the
-- reservation that funded it, and atomic_match_unlock reveals those for zero:
--
--   if (grant.reservationId) { ...update unlock_included_reservation_id... }
--
-- grant.reservationId is present for PAYG runs ONLY. An INCLUDED run -- the
-- one the customer's plan already covers -- carries grant.allowanceId and a
-- NULL reservationId, so that condition is false and its results are stamped
-- with nothing at all.
--
-- The consequence, on the FREE plan where FIND_CLIENTS includes one search per
-- calendar month: the first search of the month produces matches with
-- unlock_included_reservation_id NULL, so the results screen blurs them and
-- offers "Unlock · 35.00 CR" for findings the allowance already paid for.
-- That is charging twice for one thing, which is precisely what the comment
-- above the marking code says must never happen.
--
-- WHY A SECOND COLUMN RATHER THAN REUSING THE FIRST. A reservation id and an
-- allowance id are different id spaces -- credit reservations and billing
-- allowances -- and the ledger, the refund path and every historical audit
-- read them as such. Writing an allowance id into a column named
-- unlock_included_reservation_id would make the two indistinguishable forever
-- to keep one boolean simple.
--
-- HISTORY IS UNTOUCHED. No existing row is rewritten: matches already stamped
-- with a reservation keep it, every match_unlocks row and ledger entry stays
-- exactly as it is, and a NULL here on an older match still means what it
-- meant.

alter table public.matches
  add column if not exists unlock_included_allowance_id uuid;

comment on column public.matches.unlock_included_allowance_id is
  'The included-allowance execution that paid for discovering this match, when the run was allowance-funded rather than PAYG. Either this or unlock_included_reservation_id being set means the customer has already paid and the result must not be sold again.';

create index if not exists matches_included_allowance_idx
  on public.matches (unlock_included_allowance_id)
  where unlock_included_allowance_id is not null;

/*
 * atomic_match_unlock has to agree with the screen, and it is PATCHED FROM
 * ITS OWN LIVE DEFINITION rather than retyped.
 *
 * A first attempt at this migration rewrote the function from what a
 * truncated read had shown, and that reconstruction silently dropped six
 * things the real body does: mock_mode reads from match_unlocks_pending, the
 * three-way payload precedence (pending > raw_signals > intent_profiles),
 * coalescing author_public_url ahead of profile_url, updated_at on the status
 * change, deleting the pending row afterwards, and the column order of the
 * match_unlocks insert.
 *
 * So this takes pg_get_functiondef, changes exactly two lines, and refuses to
 * run if either line was not found -- which also makes the migration fail
 * loudly rather than quietly if somebody edits the function later.
 */
do $patch$
declare
  def text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'atomic_match_unlock';
  if def is null then
    raise exception 'atomic_match_unlock not found; nothing patched';
  end if;

  -- 1. Fetch the new column alongside the reservation one.
  patched := replace(
    def,
    'm.unlock_price_credits, m.unlock_included_reservation_id',
    'm.unlock_price_credits, m.unlock_included_reservation_id, m.unlock_included_allowance_id'
  );
  if patched = def then
    raise exception 'the SELECT of unlock_included_reservation_id was not found; refusing to patch blindly';
  end if;
  def := patched;

  -- 2. Either funding source means the search was already paid for.
  patched := replace(
    def,
    'v_included := v_match.unlock_included_reservation_id is not null;',
    'v_included := v_match.unlock_included_reservation_id is not null'
    || ' or v_match.unlock_included_allowance_id is not null;'
  );
  if patched = def then
    raise exception 'the v_included assignment was not found; refusing to patch blindly';
  end if;

  execute patched;
end $patch$;

-- The ACL this function already had, restated: CREATE OR REPLACE keeps it,
-- but stating it means a replay on a fresh database cannot default to PUBLIC.
revoke execute on function public.atomic_match_unlock(uuid, uuid) from public;
revoke execute on function public.atomic_match_unlock(uuid, uuid) from anon;
grant execute on function public.atomic_match_unlock(uuid, uuid) to authenticated, service_role;
