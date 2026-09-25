-- HOMATCH — how far a source has got, alongside how we can read it.
--
-- WHY A SECOND COLUMN AND NOT A BIGGER access_state
--
-- source_registry.access_state already says HOW a source can be read:
-- PUBLIC, AUTHENTICATED_ACCESS, JOIN_REQUIRED, INACCESSIBLE, DEGRADED. That
-- is a property of the source right now.
--
-- `lifecycle` says WHERE IN THE JOURNEY it is: we found a URL, we looked at
-- it, an adapter claims it, it has been read for real, it has produced enough
-- to be worth the slot. A source can be PUBLIC and still DISCOVERED — anyone
-- could read it, nobody has. Collapsing the two loses the one distinction
-- that says which of four hundred candidate domains is worth an afternoon.
--
-- WHAT THE EXISTING ROWS GET, AND WHY IT IS NOT A GUESS
--
-- 305 active rows exist, almost all written by the retired discovery
-- pipeline, and none of them has ever been read by an adapter that survives.
-- So they backfill to DISCOVERED: a URL that looks relevant and has not been
-- verified by anything still standing. That is not a demotion and it is not a
-- judgement about the sites — it is the honest reading of "we have a row and
-- no current evidence", and the alternative is inventing a history for
-- rows whose history was written by code that has since been retired.
--
-- A source climbs back out the moment an adapter audits it, which is the
-- point: the ladder is walked by evidence and the backfill gives it nothing
-- it did not earn.
--
-- THE TRANSITIONS ARE KEPT
--
-- source_lifecycle_events records every attempted move, including the ones
-- that were REFUSED. A refused transition is the interesting kind: a
-- successful fetch of a BLOCKED source means a control was bypassed, and a
-- scan of a RETIRED one means something is still scheduling it. Neither
-- changes the state, and both need somebody to see them.

-- ── the two new columns ──────────────────────────────────────────────────
alter table public.source_registry
  add column if not exists lifecycle text not null default 'DISCOVERED',
  add column if not exists source_family text,
  add column if not exists access_finding text,
  add column if not exists adapter_id text,
  add column if not exists lifecycle_changed_at timestamptz;

comment on column public.source_registry.lifecycle is
  'How far this source has got: DISCOVERED, AUDITED, PERMITTED, IMPLEMENTED, '
  'FIXTURE_TESTED, LIVE_TESTED, PRODUCTIVE, DEGRADED, BLOCKED, RETIRED. '
  'Advanced only by evidence -- see src/research-core/discovery/source-lifecycle.ts. '
  'Distinct from access_state, which says HOW it can be read rather than how '
  'far along it is.';

comment on column public.source_registry.source_family is
  'Which adapter family reads it. One implementation plus per-source '
  'configuration handles most members, so a new classifieds site is a config '
  'row rather than a new scraper.';

comment on column public.source_registry.access_finding is
  'What the audit found. ROBOTS_DISALLOWED, LOGIN_REQUIRED, ANTI_BOT and '
  'TERMS_PROHIBIT are reasons to stop, not problems to route around.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'source_registry_lifecycle_check') then
    alter table public.source_registry
      add constraint source_registry_lifecycle_check
      check (lifecycle in (
        'DISCOVERED', 'AUDITED', 'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED',
        'LIVE_TESTED', 'PRODUCTIVE', 'DEGRADED', 'BLOCKED', 'RETIRED'
      ))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'source_registry_family_check') then
    alter table public.source_registry
      add constraint source_registry_family_check
      check (source_family is null or source_family in (
        'PROPERTY_PORTAL', 'CLASSIFIEDS', 'AGENCY_SITE', 'DEVELOPER_SITE',
        'INVESTMENT_SITE', 'FORUM', 'PUBLIC_COMMUNITY', 'EXPAT_COMMUNITY',
        'REGIONAL_SITE', 'TELEGRAM', 'OTHER'
      ))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'source_registry_access_finding_check') then
    alter table public.source_registry
      add constraint source_registry_access_finding_check
      check (access_finding is null or access_finding in (
        'PUBLIC_HTML', 'API_AVAILABLE', 'FEED_AVAILABLE',
        'ROBOTS_DISALLOWED', 'LOGIN_REQUIRED', 'ANTI_BOT', 'TERMS_PROHIBIT',
        'GEO_BLOCKED', 'UNREACHABLE'
      ))
      not valid;
  end if;
end $$;

alter table public.source_registry validate constraint source_registry_lifecycle_check;
alter table public.source_registry validate constraint source_registry_family_check;
alter table public.source_registry validate constraint source_registry_access_finding_check;

-- Only proven sources are scanned on a customer's budget, so the selector
-- filters on exactly this and it is worth an index.
create index if not exists source_registry_lifecycle_idx
  on public.source_registry (lifecycle, country_code)
  where active is true;

create index if not exists source_registry_family_idx
  on public.source_registry (source_family)
  where source_family is not null;

-- ── every attempted move, including the refused ones ─────────────────────
create table if not exists public.source_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.source_registry(id) on delete cascade,
  from_state text not null,
  to_state text not null,
  evidence_kind text not null,
  -- Operator-facing, and always populated: a refusal with no reason is a
  -- dead end for whoever has to work out what happened.
  reason text not null,
  /*
   * REFUSED, NOT MERELY UNCHANGED.
   *
   * A scan that has not yet met the productivity bar leaves the state alone
   * and is ordinary progress. A successful fetch of a BLOCKED source also
   * leaves the state alone and is a control having been bypassed. Only this
   * flag separates them, and the second one needs a human.
   */
  rejected boolean not null default false,
  detail jsonb,
  created_at timestamptz not null default now()
);

comment on table public.source_lifecycle_events is
  'Every attempted lifecycle transition, including refusals. A refused move '
  'is the interesting kind: a successful fetch of a BLOCKED source means a '
  'control was bypassed, and a scan of a RETIRED one means something is '
  'still scheduling it.';

create index if not exists source_lifecycle_events_source_idx
  on public.source_lifecycle_events (source_id, created_at desc);

-- The whole point of recording refusals is being able to find them.
create index if not exists source_lifecycle_events_rejected_idx
  on public.source_lifecycle_events (created_at desc)
  where rejected is true;

alter table public.source_lifecycle_events enable row level security;
-- Operators only. A source's audit history is internal: it names which sites
-- refused us and why, which is not a customer-facing fact.
revoke all on public.source_lifecycle_events from anon, authenticated;

-- ── what is actually deliverable ─────────────────────────────────────────
--
-- A customer paying for a search should not be funding our first attempt at a
-- new site, so only LIVE_TESTED and PRODUCTIVE sources are scanned on a
-- campaign. DEGRADED is excluded on purpose: it is retried by the back-off
-- schedule, not by somebody's budget.
create or replace function public.source_may_scan_for_campaign(p_lifecycle text)
returns boolean
language sql
immutable
as $$ select p_lifecycle in ('LIVE_TESTED', 'PRODUCTIVE') $$;

comment on function public.source_may_scan_for_campaign is
  'Mirrors mayScanForCampaign() in src/research-core/discovery/source-lifecycle.ts; '
  'a test asserts the two agree.';
