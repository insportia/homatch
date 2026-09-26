-- ONE PERSON, ONE MATCH PER PROPERTY.
--
-- run-matching-v2 de-duplicated on intent_profile_id:
--
--   .eq('property_id', property.id).eq('intent_profile_id', profile.id)
--
-- and that id does not survive re-classification. classify-signals-v2 DELETES
-- the intent_profiles row for a signal and inserts a fresh one, so the same
-- forum post comes back with a new profile id and the guard matches nothing.
--
-- Measured in production 2026-09-26. forum.ge post 14328580 -- one buyer, one
-- post -- held two matches on property c5c1a6a4: 920dcdea at score 84, already
-- UNLOCKED for 35 credits, and ca13d573 at score 78 offered for another 20.
-- The customer was being invited to buy the same person twice.
--
-- The application guard now keys on signal_id, which is the person. This is
-- the second line: a constraint means a future caller, a backfill or a
-- hand-written insert cannot reintroduce it.
--
-- WHY THE PARTIAL PREDICATE. matches.signal_id is ON DELETE SET NULL, so a
-- signal that is deleted leaves its match with a null. Two such matches are
-- not a duplicate offer -- there is no person left to offer twice -- and a
-- plain unique index would not have constrained them anyway, since NULLs never
-- collide. Stating the predicate makes that deliberate rather than incidental.
--
-- NO HISTORY IS TOUCHED. The one duplicate that existed was removed only
-- because it was NEW, had no match_unlocks row and had no ledger entry: an
-- offer nobody had accepted. The UNLOCKED match, its unlock record and its
-- 35-credit ledger line are the record of what the customer bought and are
-- untouched.

create unique index if not exists matches_one_per_signal_per_property
  on public.matches (property_id, signal_id)
  where signal_id is not null;
