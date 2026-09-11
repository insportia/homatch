-- Homatch — the events billing v2 emits need to be nameable.
--
-- notification_type and activity_event_type are ENUMS, not free text. A
-- subscription activating, renewing or ending had no label, so payment-webhook
-- would have thrown on its first real subscription.
--
-- A PRE-EXISTING BUG FOUND ON THE WAY
--
-- payment-webhook has always written
--
--   activity_events { event_type: 'CREDITS_TOPPED_UP' }
--
-- and activity_event_type has never contained that value. The insert is
-- awaited but its error is never checked, so every successful top-up has been
-- silently failing to record an activity row. Adding the value fixes that too.
-- (The matching notification_type DID exist, which is why only half of it was
-- ever visible.)
--
-- Own migration because a new enum value cannot be USED in the transaction
-- that adds it.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_RENEWED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ENDED';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'INCLUDED_USAGE_EXHAUSTED';

ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'CREDITS_TOPPED_UP';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'BALANCE_ACTIVATED';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_RENEWED';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ENDED';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'PAYG_EXECUTION';
