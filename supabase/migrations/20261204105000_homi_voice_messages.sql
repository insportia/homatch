-- ═══════════════════════════════════════════════════════════════════════
-- HOMI VOICE MESSAGES: the person records a voice message, Google
-- Speech-to-Text (chirp_3, the AI TALK credential on homatch-official-worker)
-- turns it into text, and the text is sent to HOMI as their message.
--
-- PRICE (owner decision, 2026-10-25): 0.3 credits per minute = $0.03 per
-- minute, FIXED, VAT included, PAYG. Billed by actual duration in steps of
-- every started 10 seconds = 0.05 credits (10 s → 0.05, 31 s → 0.20,
-- 60 s → 0.30, 120 s → 0.60). Duration is what Google itself billed for the
-- clip (totalBilledDuration); a voice message is at most 2 minutes.
--
-- COGS is recorded, never assumed zero: Google chirp_3 is priced from
-- provider_price_book (GOOGLE / chirp_3 / AUDIO_SECOND, $0.016 per minute,
-- 20260918185631_ai_talk_cogs) and written on the usage_events row by
-- settleExecution. A clip Google did not report a duration for is charged at
-- the length the browser recorded and its cost is marked ESTIMATED.
--
-- MARGIN NOTE (for Finance): landed COGS at the 18 % uplift is ≈ $0.0189 per
-- minute, so $0.03 is ≈ 37 % gross margin, below the global 55 % cost-based
-- floor. That is the owner's fixed price and the product is marked CUSTOM, so
-- the edge function settles the fixed per-minute price (settleExecution
-- priceCredits) and never the cost-based quote. The quote is used only to
-- size the reservation (wallet_settle clamps the charge to it).
--
-- CONSENT: the first time a person taps the microphone they are told the
-- price once and accept it. Acceptance is stored here, per account, so it is
-- asked once across devices. The edge function refuses a transcription
-- without it (CONSENT_REQUIRED).
-- ═══════════════════════════════════════════════════════════════════════

insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values (
  'HOMI_VOICE_MESSAGE', 'HOMI voice message transcription', 'FIXED', true,
  -- One reference unit = one minute of audio: $0.03 retail, ≈ 1.888 c landed.
  3, 1.888, 3000, 'PER_UNIT', true, true, 0, 75,
  jsonb_build_object(
    'pricing_policy', 'CUSTOM',
    'unit', 'MINUTE',
    'price_credits_per_minute', 0.3,
    'billing_increment_seconds', 10,
    'max_message_seconds', 120,
    'provider', 'GOOGLE',
    'provider_model', 'chirp_3',
    'credit_rounding_dp', 2,
    'scope_note', 'One HOMI voice message, at most 2 minutes, transcribed by Google chirp_3. '
      || '0.3 credits per minute, billed per started 10 seconds (0.05 credits). Owner decision 2026-10-25.'
  )
)
on conflict (code) do nothing;

insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select 'HOMI_VOICE_MESSAGE', p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
on conflict (product_code, plan_code) do nothing;

insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note, service_control_key, sort_order)
values ('homi_voice', 'HOMI voice messages', '{HOMI_VOICE_MESSAGE}', 'fixed_retail_v1', 'FIXED',
        '0.3 credits ($0.03) per minute, per started 10 seconds; Google chirp_3 COGS from the price book', 'ai_assistant', 72)
on conflict (service_key) do nothing;

-- ── Consent, once per account ─────────────────────────────────────────────
create table if not exists public.homi_voice_consents (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  accepted_at              timestamptz not null default now(),
  -- The price the person was shown when they accepted. A later price change
  -- is a new decision for them, which the edge function can compare against.
  price_credits_per_minute numeric(8,3) not null
);
comment on table public.homi_voice_consents is
  'HOMI voice messages: the account accepted the per-minute price once (shown on the first microphone tap). Written by the homi-voice-transcribe edge function.';

alter table public.homi_voice_consents enable row level security;
revoke all on public.homi_voice_consents from anon;
grant select on public.homi_voice_consents to authenticated;

drop policy if exists homi_voice_consents_select_own on public.homi_voice_consents;
create policy homi_voice_consents_select_own on public.homi_voice_consents
  for select to authenticated using (user_id = auth.uid());
-- No insert/update policy: only the edge function (service role) writes,
-- with the price it read from billable_products, never a client-chosen one.
