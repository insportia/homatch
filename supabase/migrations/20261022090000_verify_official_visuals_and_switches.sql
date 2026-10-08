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
   'Verify Market Research: fold MyHome.ge and SS.ge comparables (official worker /verify/market) into the market lane.')
on conflict (key) do nothing;
