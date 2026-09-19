-- HOMATCH HOME FINANCING — one value on the rule-type enum.
--
-- REFERENCE_RATE. The subsidy decree states its benefit as "the National
-- Bank's refinancing rate minus N percentage points, capped at M", so the
-- programme's actual worth to a borrower cannot be shown without the
-- current rate. That rate moves roughly every six weeks while the decree
-- moves yearly, so it is its own versioned row with its own
-- last_verified_at rather than a field buried inside the subsidy payload
-- — otherwise re-checking a policy rate would mean re-publishing a decree.
--
-- Its own migration because a value added to a Postgres enum inside a
-- transaction cannot be used inside that same transaction, and the row
-- that uses it is inserted by the migration immediately after this one.
--
-- APPLIED-AND-RECORDED, NOT PENDING. This file's version prefix is the
-- version supabase_migrations.schema_migrations actually holds for it,
-- and supabase/migration-baseline.json was extended in the same change.

alter type public.mortgage_rule_type add value if not exists 'REFERENCE_RATE';
