-- A GROUP, SUBREDDIT, CHANNEL OR PAGE WE MIGHT READ — AND WHETHER WE ACTUALLY CAN.
--
-- Separate from integration_connections on purpose. A connection is an authorized
-- ACCOUNT; a target is a PLACE. One Facebook connection may serve many groups,
-- one Reddit adapter serves hundreds of subreddits, and there is never one
-- adapter per group.
--
-- THE DISTINCTION THIS TABLE EXISTS TO HOLD
--
-- membership_state and readability are two columns, because being a member does
-- not mean the platform will let us read programmatically. A Facebook group we
-- have joined, whose content Meta exposes through no supported mechanism since
-- the Groups API was removed on 2024-04-22, is MEMBER + API_UNAVAILABLE.
--
-- Storing one column and inferring the other is the specific failure this schema
-- refuses: it would render a group we can see and cannot read as working, and the
-- admin screen would show a green row above a sync that returns nothing forever.
--
-- APPLIED TO PRODUCTION 2026-09-26 ahead of any code that reads it, and both
-- constraints were exercised against the live database rather than assumed —
-- MEMBER + API_UNAVAILABLE inserts, a token in metadata is refused.

create table if not exists public.community_targets (
  id                uuid primary key default gen_random_uuid(),

  platform          text not null
                      check (platform in ('FACEBOOK','INSTAGRAM','REDDIT','TELEGRAM','VK','FORUM','OTHER')),
  /* The platform's own id for the place, verbatim. Never parsed or tidied. */
  external_id       text not null,
  name              text,
  url               text,

  /* Which authorized account reaches it, when one is needed. */
  connection_id     uuid references public.integration_connections(id) on delete set null,

  /* Evidence properties, not campaign constraints: UNKNOWN is a real answer. */
  market            text,
  languages         text[] not null default '{}',
  community_type    text,

  visibility        text not null default 'UNKNOWN'
                      check (visibility in ('UNKNOWN','PUBLIC','PRIVATE','RESTRICTED')),

  /* What the ACCOUNT can see. */
  membership_state  text not null default 'UNKNOWN'
                      check (membership_state in
                        ('UNKNOWN','PUBLIC','JOIN_REQUIRED','JOIN_REQUESTED','MEMBER','ADMIN','INACCESSIBLE')),

  /*
   * What the PLATFORM will let us read programmatically. Never inferred from
   * membership_state: "I am a member" and "there is an API" are independent.
   */
  readability       text not null default 'UNVERIFIED'
                      check (readability in
                        ('READABLE','AUTHORIZATION_REQUIRED','API_UNAVAILABLE','BLOCKED','DISABLED','UNVERIFIED')),

  /* How we would read it, from the acquisition matrix in research-core. */
  acquisition_mode  text
                      check (acquisition_mode is null or acquisition_mode in
                        ('OFFICIAL_API','BUSINESS_API','AUTHORIZED_ACCOUNT','PUBLIC_WEB','PUBLIC_FEED','WEBHOOK')),

  capabilities      jsonb not null default '{}'::jsonb,

  /* Earned, never set. Mirrors source-lifecycle.ts. */
  lifecycle         text not null default 'DISCOVERED'
                      check (lifecycle in
                        ('DISCOVERED','AUDITED','REACHABLE','PRODUCTIVE','LOW_SIGNAL','DEGRADED','BLOCKED','RETIRED')),

  /* Operator switch. A readable target is not thereby scanned. */
  discovery_enabled boolean not null default false,

  /* ── incremental sync state: read forward, never re-read everything ──── */
  cursor            text,
  /* The newest native content id we have seen, so a resume is exact. */
  last_seen_external_id text,
  last_checked_at   timestamptz,
  last_success_at   timestamptz,
  last_error_at     timestamptz,
  last_error_code   text,
  rate_limited_until timestamptz,

  /* ── measured productivity. Zero is a measurement, not a default. ────── */
  items_read        integer not null default 0,
  comments_read     integer not null default 0,
  demand_found      integer not null default 0,
  supply_found      integer not null default 0,
  duplicates_seen   integer not null default 0,

  /* Provenance: the registry row this came from, when it was reclassified. */
  source_registry_id uuid references public.source_registry(id) on delete set null,

  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint community_targets_metadata_holds_no_secret
    check (
      not (metadata ?| array[
        'access_token','accessToken','token','refresh_token','refreshToken',
        'client_secret','clientSecret','password','api_key','apiKey'
      ])
    )
);

create unique index if not exists community_targets_unique
  on public.community_targets (platform, external_id);

-- The only query the sync worker runs: what may I read right now.
create index if not exists community_targets_scannable
  on public.community_targets (platform, readability, discovery_enabled)
  where discovery_enabled and readability = 'READABLE';

create index if not exists community_targets_connection
  on public.community_targets (connection_id)
  where connection_id is not null;

comment on table public.community_targets is
  'A place we might read: a group, subreddit, channel or page. Separate from '
  'integration_connections, which is an authorized ACCOUNT. membership_state and '
  'readability are independent columns: being a member does not mean the platform '
  'exposes a supported programmatic mechanism, and MEMBER + API_UNAVAILABLE is the '
  'honest state for a Facebook group since the Groups API was removed 2024-04-22.';

comment on column public.community_targets.readability is
  'What the PLATFORM permits programmatically. Never inferred from membership_state.';

comment on column public.community_targets.discovery_enabled is
  'Operator switch. A readable target is not thereby scanned.';

-- Nothing customer-facing reads this, and the admin screen goes through an edge
-- function that filters to safe fields. RLS on with no policy denies anon and
-- authenticated while leaving the service role unaffected — the whole access
-- decision, stated rather than left to look like an oversight.
alter table public.community_targets enable row level security;
revoke all on public.community_targets from anon, authenticated;
