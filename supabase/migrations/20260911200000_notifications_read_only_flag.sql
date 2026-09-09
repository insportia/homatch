-- Homatch — a customer may mark a notification read, not rewrite it.
--
-- WHAT WAS FOUND
--
-- notifications grants UPDATE on every column to authenticated:
--
--   body, created_at, id, metadata, property_id, read, title, type, user_id
--
-- notif_update_own scopes the ROW correctly -- its USING and WITH CHECK both
-- pin user_id to auth_user_id(), so nobody can reassign a notification to
-- someone else or edit another person's. But within their own rows a customer
-- can rewrite anything: the type, the title, the body, the metadata, the
-- property_id.
--
-- The only write the product makes is markNotificationRead() and
-- markAllNotificationsRead(), both of which set exactly one field.
--
-- The blast radius is small -- a customer can only mislead themselves -- but
-- `metadata` is not only decoration: NotificationsPage routes on
-- metadata.kind, metadata.conversation_id and metadata.viewing_request_id, and
-- the low-credit warning added alongside this migration records the balance
-- and the price that triggered it. Those are the server's statements about
-- what happened, and a support conversation that reads them back should not
-- have to wonder whether the customer edited them.
--
-- SELECT is untouched. service_role is untouched -- every producer writes
-- under it.

revoke update on public.notifications from authenticated, anon;
grant update (read) on public.notifications to authenticated;
