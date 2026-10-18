-- Paid Find Property Deep Search paused by the owner (2026-10-18) before the first paid Find
-- Buyers test: Find Property runs as the free portal search only until Admin turns it back on
-- (Admin → Service Control Center, service find_property_deep; later changes are audited by
-- the service-control function).
--
-- Two switches move, nothing else:
--   * service_controls.find_property_deep → frontend and backend OFF: the Deep Search UI is
--     hidden and find-property-run refuses `start` with 503 SERVICE_DISABLED before any
--     credit reservation;
--   * admin_settings.find_property_social_enabled → false: the worker starts no social OFFER
--     run (SOCIAL_DISABLED) and the free search offers no paid campaign.
-- Nothing is deleted or rewritten: campaigns, results, actor runs, reservations, ledger rows,
-- prices and the other switches (find_property, find_buyers, marketplace_search_enabled,
-- find_property_discovery_enabled) stay exactly as they are. Idempotent: re-running changes
-- nothing that is already off.
update public.service_controls
   set frontend_enabled = false,
       backend_enabled = false,
       version = version + 1,
       reason = 'Owner decision 2026-10-18: paid Deep Search paused; free portal search only',
       updated_at = now()
 where service_key = 'find_property_deep'
   and (frontend_enabled or backend_enabled);

update public.admin_settings
   set value = 'false'::jsonb,
       updated_at = now()
 where key = 'find_property_social_enabled'
   and value is distinct from 'false'::jsonb;
