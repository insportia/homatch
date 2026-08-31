-- ============================================================
-- HOMATCH — Pricing / Payment / Wallet foundation (part 1 of 2)
-- Additive only. No existing column is dropped, renamed, or
-- retyped. Historical payments keep their legacy amount_usd /
-- credits_issued fields; new VAT-snapshot fields are populated
-- going forward only.
--
-- Part 1 must be applied (and committed) before part 2, because
-- Postgres does not allow a new enum value to be used in the same
-- transaction that adds it.
-- ============================================================

-- 1. New wallet-ledger lifecycle types for reserve/capture/release
--    semantics (Master Prompt §15, §19). REFUND already existed
--    but was never used by any code path; TOP_UP / MATCH_UNLOCK /
--    ADMIN_ADJUSTMENT are untouched.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'SERVICE_RESERVE';
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'SERVICE_CAPTURE';
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'SERVICE_RELEASE';

-- 2. Small helper mirroring the existing auth_user_id() pattern,
--    used by every new admin-only RLS policy below and by future
--    Live Chat moderation policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.is_admin = true
  );
$$;

-- 3. VAT / tax-snapshot + integer-cent columns on payments
--    (Master Prompt §12, §13, §16, §49, §50). All additive and
--    nullable so existing rows are untouched.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS subtotal_cents integer,
  ADD COLUMN IF NOT EXISTS vat_rate_bps integer,
  ADD COLUMN IF NOT EXISTS vat_amount_cents integer,
  ADD COLUMN IF NOT EXISTS total_cents integer,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS payment_fee_cents integer,
  ADD COLUMN IF NOT EXISTS invoice_id text,
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

COMMENT ON COLUMN public.payments.subtotal_cents IS 'VAT-exclusive amount in integer cents, snapshotted at payment time.';
COMMENT ON COLUMN public.payments.vat_rate_bps IS 'VAT rate in basis points at payment time (1800 = 18.00%). Historical payments keep their original rate even if admin_settings.vat_rate_bps later changes.';
COMMENT ON COLUMN public.payments.vat_amount_cents IS 'VAT amount in integer cents, snapshotted at payment time.';
COMMENT ON COLUMN public.payments.total_cents IS 'VAT-inclusive total in integer cents, snapshotted at payment time. Source of truth for new payments; amount_usd is kept in sync for backward compatibility.';
COMMENT ON COLUMN public.payments.provider_event_id IS 'Payment-provider webhook event id (e.g. Stripe event.id). Used for webhook idempotency alongside idempotency_key.';

-- Duplicate-webhook protection at the provider-event level, on top
-- of the existing idempotency_key unique constraint (Master Prompt §14).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_event_id_unique
  ON public.payments(provider_event_id) WHERE provider_event_id IS NOT NULL;

-- 4. Centrally-configurable VAT rate (Master Prompt §12). Stored in
--    the existing admin_settings key/value table — the dominant
--    config pattern already used for spend caps and kill switches.
INSERT INTO public.admin_settings (key, value, description)
VALUES ('vat_rate_bps', '1800'::jsonb, 'VAT rate in basis points applied to new research-product purchases and credit top-ups (1800 = 18.00%). Changing this does NOT recalculate historical payments — see payments.vat_rate_bps snapshot.')
ON CONFLICT (key) DO NOTHING;
