-- Paid Find Property Deep Search paused by the owner (2026-10-18): Find Property runs as
-- the free portal search only until Admin turns "Find Property — Paid Deep Search" back on
-- (Admin → Service Control Center, service find_property_deep; that change is audited by
-- the service-control function).
--
-- Only the switch moves. Nothing is deleted or rewritten: campaigns, results, actor runs,
-- reservations and ledger rows stay as they are. Campaigns already running finish their
-- started provider runs and settle normally; the worker starts no new run while OFF.
-- The separate switches find_property_social_enabled and find_property_test_campaign are
-- untouched.
update public.service_controls
   set frontend_enabled = false,
       backend_enabled = false,
       version = version + 1,
       reason = 'Owner decision 2026-10-18: paid Deep Search paused; free portal search only',
       updated_at = now()
 where service_key = 'find_property_deep';
