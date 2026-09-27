-- Homatch — a native match has no external signal, and the column said it must.
--
-- FOUND BY THE PROOF, NOT BY READING. The first native row written in a rolled-back
-- transaction failed on `signal_id` NOT NULL. That column was correct for as long as
-- every supply_match had an external post on the demand side; a demand a customer typed
-- through Find Property has no post, and requiring one would mean inventing a signal —
-- which is the same fabrication as inventing a user, one column over.
--
-- So the column becomes nullable and the RULE moves into the kind constraint, where it
-- is stated rather than implied:
--
--   EXTERNAL_INTELLIGENCE  must carry a signal, and must not carry a property
--   INTERNAL_HOMATCH       must carry a property, and must carry neither a signal
--                          nor an observation
--
-- Strictly tighter than what it replaces for external rows: NOT NULL only said "some
-- signal"; this says an external row is external and a native row is native, and neither
-- can borrow half of the other identity.

alter table public.supply_matches alter column signal_id drop not null;

alter table public.supply_matches drop constraint if exists supply_matches_one_supply_kind;

alter table public.supply_matches
  add constraint supply_matches_one_supply_kind
  check (
    (source_kind = 'INTERNAL_HOMATCH'
      and property_id is not null
      and signal_id is null
      and observation_id is null)
    or
    (source_kind = 'EXTERNAL_INTELLIGENCE'
      and property_id is null
      and signal_id is not null)
  )
  not valid;

comment on column public.supply_matches.signal_id is
  'The external demand signal. Null on an INTERNAL_HOMATCH row, where the demand is a plan a customer confirmed rather than a post somebody read.';
