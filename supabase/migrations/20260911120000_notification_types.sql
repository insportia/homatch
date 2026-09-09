-- Homatch — make the notification types the code actually sends legal.
--
-- WHAT WAS BROKEN
--
-- notifications.type is an enum with six values:
--
--   IMPORT_COMPLETED IMPORT_FAILED MATCHING_STARTED MATCHING_PAUSED
--   LOW_CREDITS MATCH_FOUND
--
-- The code sends four values that are NOT in it:
--
--   MATCH_AVAILABLE            (active-search-notify, run-matching, _shared/jobs)
--   CREDITS_TOPPED_UP          (payment-webhook)
--   RESEARCH_PRODUCT_PURCHASED (research-purchase)
--
-- Every one of those inserts is wrapped in `.catch(() => {})`, so the insert
-- failed and nothing anywhere reported it. A customer whose search matched a
-- new property, whose credits arrived, or whose research purchase completed
-- was never told. The notification bell has been counting a table that four
-- of its five producers could not write to.
--
-- The values are ADDED rather than the call sites rewritten, because the call
-- sites are right: "your credits arrived" is genuinely not "a match was
-- found", and collapsing them onto MATCH_FOUND to satisfy a constraint would
-- make the notification list lie about what happened.
--
-- Two more are added for events that now exist and deserve to be told:
-- VERIFY_COMPLETE and DOCUMENT_ANALYZED.
--
-- Additive only. No existing value is removed or renamed, so no stored row
-- becomes invalid and nothing that reads the enum breaks.

alter type public.notification_type add value if not exists 'MATCH_AVAILABLE';
alter type public.notification_type add value if not exists 'CREDITS_TOPPED_UP';
alter type public.notification_type add value if not exists 'RESEARCH_PRODUCT_PURCHASED';
alter type public.notification_type add value if not exists 'VERIFY_COMPLETE';
alter type public.notification_type add value if not exists 'DOCUMENT_ANALYZED';
