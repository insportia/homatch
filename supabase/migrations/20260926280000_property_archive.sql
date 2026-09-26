-- ARCHIVE IS NOT DELETE, AND NEITHER OF THEM IS "PAUSED".
--
-- Property management needs three different ways for a listing to stop being in
-- the way, and the product already had two of them:
--
--   matching_status = 'PAUSED'  the listing is fine, stop SEARCHING for it. A
--                               seller who has accepted an offer but not signed.
--   is_deleted = true           gone from the product. The existing soft delete.
--
-- What was missing is the middle one: a property the owner is finished with but
-- does not want to delete. Last year's flat, a listing that sold, a draft they
-- may come back to. Today the only way to express that is to delete it, which is
-- why it needs a column rather than a convention.
--
-- WHY NOT ANOTHER matching_status VALUE. Because matching_status says what the
-- MATCHING is doing, and archiving is a fact about the LISTING. Folding them
-- together would make "archived" and "not currently being matched" the same
-- state, and then un-archiving would have to guess whether matching should
-- resume -- a guess that costs the owner either a campaign they did not ask for
-- or a silence they did not expect. Two columns, two questions, no guess.
--
-- A TIMESTAMP RATHER THAN A BOOLEAN, for the same reason every other clock in
-- this system is a timestamp: "when" answers "whether" and a boolean does not.

begin;

alter table public.properties
  add column if not exists archived_at timestamptz;

comment on column public.properties.archived_at is
  'When the owner archived this property. Null means not archived. Distinct from '
  'is_deleted (gone) and from matching_status PAUSED (present, not being matched).';

-- The portfolio list reads "mine, not deleted, not archived" on every load, and
-- the archived tab reads its complement.
create index if not exists properties_owner_active_idx
  on public.properties (user_id, created_at desc)
  where is_deleted = false and archived_at is null;

create index if not exists properties_owner_archived_idx
  on public.properties (user_id, archived_at desc)
  where is_deleted = false and archived_at is not null;

-- RLS is already correct and is deliberately not touched: properties carries
-- props_select_own / props_insert_own / props_update_own / props_delete_own, all
-- keyed on `user_id = get_user_id()`, and property_facts and property_photos
-- both key on `user_owns_property(property_id)`. Ownership is therefore resolved
-- in the database rather than in a function that could forget, and one account
-- cannot reach another's property through any client. Archiving is an UPDATE and
-- is already covered by props_update_own.

commit;
