-- ============================================================================
-- HOMATCH VERIFY — official TAS visuals, TAS implementation switch, and the
-- MyHome.ge / SS.ge market-research switch.
--
-- 1. verify-official-visuals (PRIVATE bucket)
--
--    Genuine visuals selected from TAS official attachments (renders, site
--    plans, structural drawings, construction photos) — never marketplace
--    photos, never generated imagery. Objects are stored under
--    `tas/<sha256>.<ext>`: the content hash is both the name and the cache
--    key, so an unchanged visual is stored once and reused by every later
--    verification of the same project.
--
--    No storage.objects policy is created: anon and authenticated have NO
--    access. research-agent writes with the service role; verify-synthesis
--    mints short-lived signed URLs for the owner of a job at read time.
--
-- 2. admin_settings seeds (audited writes go through admin_set_setting):
--
--    verify_tas_implementation          {"active":"LEGACY","fallback":null}
--      Selects between the TWO implementations already deployed in the
--      official worker image. LEGACY until an administrator has TESTED and
--      ACTIVATED API_FIRST; rollback is setting LEGACY again.
--
--    verify_marketplace_market_enabled  false
--      MyHome.ge / SS.ge comparables in Verify Market Research. Off until the
--      coordinated release activates it.
--
--    verify_captcha_auto_solve          {"enabled":true, ...}
--      Automatic reCAPTCHA completion for NAPR/MyGov Service176 and RS.ge via
--      the worker's shared 2Captcha service (owner decision 2026-10-08). The
--      key lives only in the worker environment; this row holds no secret.
--
--    verify_developer_ads               {"enabled":false, ...}
--      Developer Advertising Intelligence: Verify's last research stage, one
--      bounded memo23 Meta Ad Library run per job (paid per result). Seeded
--      OFF: paid runs start only when the owner enables it in Admin. Also
--      governed by the APIFY switch in provider_disabled_list.
--
-- Additive only. Nothing existing is altered or removed.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verify-official-visuals', 'verify-official-visuals', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

insert into public.admin_settings (key, value, description)
values
  ('verify_tas_implementation', '{"active":"LEGACY","fallback":null}'::jsonb,
   'Verify TAS implementation: active LEGACY|API_FIRST, fallback LEGACY|null. Selects already-deployed worker code only.'),
  ('verify_marketplace_market_enabled', 'false'::jsonb,
   'Verify Market Research: fold MyHome.ge and SS.ge comparables (official worker /verify/market) into the market lane.'),
  ('verify_captcha_auto_solve', '{"enabled":true,"providers":{"mygov":true,"rstax":true},"maxAttemptsPerProvider":2,"maxSolvesPerJob":3}'::jsonb,
   'Verify official sources: automatic reCAPTCHA completion through the worker''s shared 2Captcha service (NAPR/MyGov Service176, RS.ge). Bounded per provider and per job; the worker also enforces its key, CAPTCHA_AUTO_SOLVE=off kill switch, daily cap and breaker.'),
  ('verify_developer_ads', '{"enabled":false,"actorId":"memo23~facebook-ads-library-scraper-ppe","country":"GE","maxTerms":2,"maxItems":30,"maxChargeUsd":0.05,"timeoutSeconds":120,"cacheHours":24}'::jsonb,
   'Verify Developer Advertising Intelligence: last research stage, one bounded memo23 Meta Ad Library run per job (paid per result, cached 24h). Off until the owner enables it; the APIFY provider switch also stops it.')
on conflict (key) do nothing;
