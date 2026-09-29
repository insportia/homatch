-- The contact number an owner can SET but could never CHANGE.
--
-- 20260911170000 revoked UPDATE on public.properties and granted it back
-- column by column. 20260927110000 then added the contact phone columns and
-- a client edit path (setPropertyContact) — but no UPDATE grant for them, so
-- every phone edit from the browser has been refused by Postgres at the
-- column level while the page said "saved". INSERT was granted (the add flow
-- persists), UPDATE was not (the edit flow could not).
--
-- The columns stay owner-only through RLS (user_id = get_user_id()); this
-- grant only lets the owner change their own property's number. anon stays
-- without, as everywhere on this table.
grant update (contact_phone_e164, contact_phone_raw, contact_phone_country)
  on public.properties to authenticated;
