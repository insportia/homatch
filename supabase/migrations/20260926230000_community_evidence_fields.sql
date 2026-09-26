-- COMMUNITY EVIDENCE JOINS THE STORE THAT ALREADY EXISTS.
--
-- Audited before adding anything, and raw_signals turned out to hold most of the
-- community evidence contract already: platform, external_id, source_url,
-- author_public_name/url, original_text, language, published_at, discovered_at,
-- last_seen_at, last_verified_at, content_changed_at, content_fingerprint,
-- content_type, access_class, research_direction + direction_confidence,
-- validation_state, expires_at, last_revalidation_outcome, provider, parent_url,
-- parent_excerpt.
--
-- And raw_signals_platform_external_id_key is ALREADY a unique index on
-- (platform, external_id) — so "the same native object is one row" is already
-- enforced by the database rather than by convention. The stable-identity rule
-- was structural before this wave started.
--
-- Existing indexes already serve the time questions too: discovered_at DESC,
-- (research_direction, discovered_at DESC) and the freshness triple mean "new
-- Demand today" was already indexed.
--
-- So this migration adds ONLY what is genuinely absent. No second evidence table,
-- no parallel time model, no renamed duplicate of a column that already exists.
--
-- WHY EACH ADDITION IS NOT A DUPLICATE
--
-- source_updated_at vs content_changed_at — different facts, and the difference
-- matters. content_changed_at is when WE noticed the text differ.
-- source_updated_at is when the PLATFORM says the author edited it. A platform
-- that reports an edit timestamp tells us an edit happened even when the visible
-- text is identical; one that reports none leaves the fingerprint as the only
-- evidence. Collapsing them makes our polling interval look like the author's
-- behaviour.
--
-- became_unavailable_at — validation_state already records THAT content is gone.
-- This records WHEN, which is what makes "was this still up after 30 days"
-- answerable. Deleted content stays as historical intelligence; it is never
-- erased and never presented as freshly verified.
--
-- parent_external_id / thread_external_id — parent_url exists, and a URL is not
-- an identity: locale prefixes, ?comment_id= and mobile hostnames give one
-- comment several URLs. Native ids link a comment to its post the same way the
-- signal itself is identified.
--
-- connection_id / target_id / acquisition_mode — provenance for the shared
-- engine. Without them, "read over the public web" and "read through an
-- authorized Page" are indistinguishable after the fact, and that distinction is
-- the whole compliance record.
--
-- content_version — a counter, so an edit is countable without storing a full
-- copy of every revision.
--
-- target_id deliberately does NOT imply an intent. A community holds sellers and
-- buyers both; research_direction is per row.
--
-- APPLIED TO PRODUCTION 2026-09-26 ahead of the code that reads it, and verified:
-- all eight columns present, all three indexes present, and the acquisition_mode
-- check exercised against the live database with a value that must be refused.

alter table public.raw_signals
  add column if not exists connection_id        uuid references public.integration_connections(id) on delete set null,
  add column if not exists target_id            uuid references public.community_targets(id) on delete set null,
  add column if not exists acquisition_mode     text,
  add column if not exists parent_external_id   text,
  add column if not exists thread_external_id   text,
  add column if not exists source_updated_at    timestamptz,
  add column if not exists became_unavailable_at timestamptz,
  add column if not exists content_version      integer not null default 1;

alter table public.raw_signals
  drop constraint if exists raw_signals_acquisition_mode_check;
alter table public.raw_signals
  add constraint raw_signals_acquisition_mode_check
    check (acquisition_mode is null or acquisition_mode in
      ('OFFICIAL_API','BUSINESS_API','AUTHORIZED_ACCOUNT','PUBLIC_WEB','PUBLIC_FEED','WEBHOOK'));

comment on column public.raw_signals.source_updated_at is
  'When the PLATFORM says the author edited it. Distinct from content_changed_at, '
  'which is when WE noticed the text differ — conflating them makes our polling '
  'interval look like the author''s behaviour.';

comment on column public.raw_signals.became_unavailable_at is
  'When the content went away. validation_state records THAT it is gone; this records '
  'WHEN. Historical intelligence is kept, never deleted.';

comment on column public.raw_signals.target_id is
  'The community it came from. A community holds sellers and buyers both, so intent is '
  'classified per row and never per target.';

comment on column public.raw_signals.content_version is
  'Increments when an edit is observed for the same native identity. One lead, several '
  'versions — never a second purchasable lead because somebody fixed a typo.';

-- ── The two genuinely uncovered access paths, plus keyset pagination ─────────

-- SOURCE time, which is not our time. "Published in the last 24 hours" is a
-- different question from "we found it in the last 24 hours", and only the
-- second had an index.
create index if not exists raw_signals_published_idx
  on public.raw_signals (published_at desc nulls last)
  where published_at is not null;

-- Per-target incremental sync and per-target aggregation: the two queries the
-- scheduler and the admin analytics both run.
create index if not exists raw_signals_target_time_idx
  on public.raw_signals (target_id, discovered_at desc)
  where target_id is not null;

-- Keyset pagination over the whole store. Millions of rows must not be walked
-- with OFFSET, and an export or a monthly aggregation should resume from a
-- cursor rather than re-count from the beginning.
create index if not exists raw_signals_keyset_idx
  on public.raw_signals (discovered_at desc, id desc);
