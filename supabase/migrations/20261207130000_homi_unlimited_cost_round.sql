-- ═══════════════════════════════════════════════════════════════════════
-- HOMI: unlimited chat and free voice messages (owner, 2026-10-29).
--
-- 1. HOMI voice messages are free and unlimited in every plan. The
--    per-minute price (0.3 credits, 20261204105000_homi_voice_messages) is
--    retired: the HOMI_VOICE_MESSAGE row is KEPT for history and for the
--    unbilled COGS rows homi-voice-transcribe still writes under it, with
--    pricing_active = false. `enabled` is left as it is, so the row's
--    enabled / kill_switch still turn voice off without a deploy.
--    homi_voice_consents is kept untouched (history); nothing reads it now.
--
--    ORDER: deploy homi-voice-transcribe BEFORE applying this migration.
--    The previous function treats pricing_active = false as "voice
--    unavailable"; the new one ignores pricing state.
--
-- 2. HOMI chat has no plan quota. The abuse safeguard that replaces the
--    per-plan daily cap reads these admin settings (defaults in
--    src/lib/homi/contextPlan.ts and homi-voice-transcribe/voiceLimits.ts
--    apply when a row is missing). They are rates a person never reaches,
--    not allowances, and nothing about them is shown to customers.
--
-- Additive data only: no schema change, nothing deleted.
-- ═══════════════════════════════════════════════════════════════════════

update public.billable_products
   set pricing_active = false,
       config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
         'pricing_policy', 'FREE_UNLIMITED',
         'free_since', '2026-10-29',
         'retired_price_credits_per_minute', config -> 'price_credits_per_minute',
         'scope_note', 'One HOMI voice message, at most 2 minutes, transcribed by Google chirp_3. '
           || 'Free and unlimited in every plan since 2026-10-29 (owner decision); COGS still recorded as unbilled usage. '
           || 'Was 0.3 credits per minute from 2026-10-25.'
       )
 where code = 'HOMI_VOICE_MESSAGE';

update public.finance_services
   set price_note = 'Free and unlimited in every plan since 2026-10-29 (was 0.3 credits per minute); Google chirp_3 COGS recorded as unbilled usage'
 where service_key = 'homi_voice';

insert into public.admin_settings (key, value, description) values
  ('homi_abuse_burst_per_minute', '20'::jsonb,
   'HOMI chat abuse safeguard (not a quota): turns per minute per account or anonymous address before a gentle "slow down".'),
  ('homi_abuse_hourly_ceiling', '300'::jsonb,
   'HOMI chat abuse safeguard (not a quota): turns per hour per account or address. Far above a person typing.'),
  ('homi_abuse_daily_ceiling', '2000'::jsonb,
   'HOMI chat abuse safeguard (not a quota): turns per 24 hours per account or address. Exists only to stop automation; never shown to customers.'),
  ('homi_voice_per_minute', '6'::jsonb,
   'HOMI voice messages abuse safeguard (not a quota): voice messages per minute per account.'),
  ('homi_voice_per_hour', '60'::jsonb,
   'HOMI voice messages abuse safeguard (not a quota): voice messages per hour per account.')
on conflict (key) do nothing;
