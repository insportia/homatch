-- BACKFILL. This migration was applied to production on 2026-09-14 and had no
-- file in this directory; the statement below is the one recorded in
-- supabase_migrations.schema_migrations for version 20260914110207, so the
-- repository now says what the database already did.
--
-- A bare 401 cannot tell a revoked key from a voice this plan may not use, and
-- those two need opposite actions from an operator: rotate a credential, or
-- change a subscription. The audition screen was showing "failed" for both.

alter table public.voice_audition_samples
  add column if not exists error_detail text;

comment on column public.voice_audition_samples.error_detail is
  'The provider''s own message, bounded. A bare 401 cannot tell a revoked key from a voice this plan may not use, and those need different actions.';
