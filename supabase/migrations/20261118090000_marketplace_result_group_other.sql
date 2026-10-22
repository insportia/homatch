-- Find Property free search: every valid home found is browsable (owner, 2026-10-18).
--
-- The pipeline used to drop the homes that fall outside the request (another district, area,
-- price band, ...) and keep only their keys; a narrow request then showed 13 of 95 homes.
-- They are now stored too, as result_group OTHER, with what each one does not meet, and the
-- results list shows them after the homes that fit. Only the allowed values change; no row
-- is rewritten. NOT VALID + VALIDATE keeps the lock short on a large table.
alter table public.discovery_marketplace_properties
  drop constraint if exists discovery_marketplace_properties_result_group_check;
alter table public.discovery_marketplace_properties
  add constraint discovery_marketplace_properties_result_group_check
  check (result_group in ('BEST', 'OWNER', 'UPGRADE', 'MORE', 'OTHER')) not valid;
alter table public.discovery_marketplace_properties
  validate constraint discovery_marketplace_properties_result_group_check;
