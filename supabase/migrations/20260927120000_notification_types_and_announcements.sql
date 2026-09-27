-- Homatch — four notification types that were being borrowed, and a place for
-- platform announcements to come from.
--
-- ── THE BORROWED TYPES ───────────────────────────────────────────────────
--
-- `send-message` emits MATCH_FOUND when somebody writes to you, and
-- `viewing-request` emits MATCH_FOUND when somebody asks to see your flat.
-- Both are wrong in the same way the earlier notification_types migration
-- described: the type is the stable thing a client keys an icon, a route and a
-- translation off, and collapsing three different events onto one makes the
-- notification list unable to tell a customer what actually happened. Those
-- call sites read `metadata.kind` to recover the distinction — which works,
-- and which is a workaround for the enum not having the value.
--
--   NEW_MESSAGE               somebody wrote to you
--   PROPERTY_ACTION_REQUIRED  your property cannot proceed until you do
--                             something — the contact number a new discovery
--                             campaign needs, most often
--   SEARCH_COMPLETE           an asynchronous discovery finished and has
--                             something to show
--   ANNOUNCEMENT              Homatch itself has something to say
--
-- Additive. No value is removed or renamed, so no stored row becomes invalid.

alter type public.notification_type add value if not exists 'NEW_MESSAGE';
alter type public.notification_type add value if not exists 'PROPERTY_ACTION_REQUIRED';
alter type public.notification_type add value if not exists 'SEARCH_COMPLETE';
alter type public.notification_type add value if not exists 'ANNOUNCEMENT';
