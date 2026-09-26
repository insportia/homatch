-- TWO TABLES, BECAUSE THEY ARE TWO DIFFERENT FACTS.
--
-- broker_intelligence      — a firm we FOUND. Provenance, freshness, dedup. No
--                            commercial relationship, and no column that could
--                            claim one.
-- broker_directory_listings — a firm that REGISTERED and is PAYING. An owning
--                            account and a paid-until instant, both mandatory.
--
-- The separation is structural rather than procedural. It is not enforced by
-- remembering to filter: broker_intelligence has no status, no plan, no paid
-- flag and no verified flag, so there is nothing for a discovery path to set and
-- no field for a renderer to misread. Promotion cannot be done by accident
-- because there is nothing to promote — a registration has to be INSERTed by the
-- registration path, with a user_id that discovery does not have.
--
-- WHY NOT ONE TABLE WITH A FLAG. Because a flag is one UPDATE away from being
-- wrong, and the failure is a customer being told that a company we scraped is a
-- Homatch-registered partner. A missing column cannot be set by mistake.

begin;

-- ── 1. Discovered broker intelligence ───────────────────────────────────────

create table if not exists public.broker_intelligence (
  id uuid primary key default gen_random_uuid(),

  -- IDENTITY. Only keys a firm controls and does not share. A display name is
  -- deliberately not one of them: "Tbilisi Real Estate" is several companies and
  -- deduplicating on it would attribute one firm's listings to another.
  key_kind text not null,
  natural_key text not null,

  role text not null,
  display_name text,

  country_code text not null default 'GE',
  cities text[] not null default '{}',
  languages text[] not null default '{}',
  deal_kinds text[] not null default '{}',

  -- FOUR CLOCKS, kept apart for the same reason they are kept apart on
  -- observations. When we first saw the firm, when we last saw it, when we last
  -- confirmed it still resolves, and when what it says about itself changed.
  -- None of these is a listing's publication date.
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  content_changed_at timestamptz,

  validation_state text not null default 'UNVERIFIED',
  failed_checks integer not null default 0,

  observation_count integer not null default 0,
  source_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The dedup contract, in the database rather than in a function's memory.
  constraint broker_intelligence_identity unique (key_kind, natural_key),

  constraint broker_intelligence_key_kind_check
    check (key_kind in ('COMPANY_ID', 'DOMAIN', 'TELEGRAM', 'PHONE', 'PROFILE_URL')),
  constraint broker_intelligence_natural_key_check
    check (length(btrim(natural_key)) > 0),
  -- Only the two roles that are brokers in the directory sense. A DEVELOPER
  -- selling its own units is supply, not a broker, and has its own product.
  constraint broker_intelligence_role_check
    check (role in ('AGENCY', 'BROKER')),
  -- The ValidationState vocabulary, not the DeliveryVerdict one. Writing FRESH
  -- into a column like this has already cost a day once.
  constraint broker_intelligence_validation_state_check
    check (validation_state in ('UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE')),
  constraint broker_intelligence_counts_check
    check (observation_count >= 0 and source_count >= 0 and failed_checks >= 0)
);

comment on table public.broker_intelligence is
  'Brokers and agencies discovered externally. Never a Homatch registration: this '
  'table has no paid, verified or plan column because it cannot know one.';

create index if not exists broker_intelligence_role_country_idx
  on public.broker_intelligence (role, country_code);
create index if not exists broker_intelligence_last_seen_idx
  on public.broker_intelligence (last_seen_at desc);
create index if not exists broker_intelligence_cities_idx
  on public.broker_intelligence using gin (cities);
create index if not exists broker_intelligence_state_idx
  on public.broker_intelligence (validation_state) where validation_state <> 'VALID';

-- ── 2. Lineage: which source told us, and which observation ─────────────────
--
-- Separate from the broker row so that a firm seen on four portals has four
-- provenance rows and one identity, and so that source_count is derivable rather
-- than merely asserted.

create table if not exists public.broker_intelligence_sources (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.broker_intelligence (id) on delete cascade,
  source_id uuid not null,
  adapter_id text not null,
  -- The listing the attribution was read from, when there was one.
  observation_id uuid references public.supply_observations (id) on delete set null,
  canonical_url text,
  -- Which key this particular sighting carried. Lets a phone-only sighting be
  -- told apart from the domain sighting that created the record.
  key_kind text not null,
  natural_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint broker_intelligence_sources_identity
    unique (broker_id, source_id, key_kind, natural_key),
  constraint broker_intelligence_sources_key_kind_check
    check (key_kind in ('COMPANY_ID', 'DOMAIN', 'TELEGRAM', 'PHONE', 'PROFILE_URL'))
);

comment on table public.broker_intelligence_sources is
  'Provenance for broker_intelligence: which source, which adapter, which '
  'observation, which key. One row per (broker, source, key).';

create index if not exists broker_intelligence_sources_broker_idx
  on public.broker_intelligence_sources (broker_id);
create index if not exists broker_intelligence_sources_source_idx
  on public.broker_intelligence_sources (source_id);
create index if not exists broker_intelligence_sources_observation_idx
  on public.broker_intelligence_sources (observation_id);

-- ── 3. The paid directory ───────────────────────────────────────────────────
--
-- A row here is a commercial relationship. Note what it REQUIRES and what
-- discovery therefore cannot supply: an owning user account.

create table if not exists public.broker_directory_listings (
  id uuid primary key default gen_random_uuid(),

  -- NOT NULL, no default. This is the column discovery cannot fill, and it is
  -- what makes automatic promotion impossible rather than merely forbidden.
  owner_user_id uuid not null references auth.users (id) on delete cascade,

  -- The link to what we know about them, when they are also a firm we had
  -- observed. Optional and nullable in this direction on purpose: a registration
  -- exists whether or not we ever scraped them, and the link is drawn by
  -- registration, never by discovery.
  broker_id uuid references public.broker_intelligence (id) on delete set null,

  display_name text not null,
  role text not null,
  country_code text not null default 'GE',
  cities text[] not null default '{}',
  languages text[] not null default '{}',
  contact_phone text,
  contact_email text,
  website text,

  status text not null default 'PENDING_REVIEW',
  -- ACTIVE without a current paid_until is not a listing. Enforced in the view
  -- below, where now() is allowed, rather than in a CHECK, where it is not.
  paid_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint broker_directory_listings_role_check
    check (role in ('AGENCY', 'BROKER')),
  constraint broker_directory_listings_status_check
    check (status in ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'EXPIRED')),
  constraint broker_directory_listings_name_check
    check (length(btrim(display_name)) > 0),
  -- One registration per account per firm identity.
  constraint broker_directory_listings_owner_broker_key
    unique (owner_user_id, broker_id)
);

comment on table public.broker_directory_listings is
  'Paid HOMATCH broker directory registrations. owner_user_id is mandatory, which '
  'is why no discovery path can create one.';

create index if not exists broker_directory_listings_active_idx
  on public.broker_directory_listings (status, paid_until desc);
create index if not exists broker_directory_listings_broker_idx
  on public.broker_directory_listings (broker_id);

-- ── 4. The one thing customers see as "the directory" ───────────────────────
--
-- A view rather than a filter the callers remember: the paid-and-current test
-- lives in exactly one place, and a query that forgets it reads this instead of
-- the table. security_invoker so the caller's RLS still applies.

create or replace view public.broker_directory_public
with (security_invoker = true) as
select
  l.id,
  l.broker_id,
  l.display_name,
  l.role,
  l.country_code,
  l.cities,
  l.languages,
  l.contact_phone,
  l.contact_email,
  l.website,
  l.paid_until
from public.broker_directory_listings l
where l.status = 'ACTIVE'
  and l.paid_until is not null
  and l.paid_until > now();

comment on view public.broker_directory_public is
  'The HOMATCH BROKER DIRECTORY. Only ACTIVE registrations with a current '
  'paid_until. Discovered brokers are never here.';

-- ── 5. Attribution on observations ──────────────────────────────────────────
--
-- Until now the matcher read the supply role out of source_status, a column that
-- holds AVAILABLE or null. Every one of the 25 persisted matches therefore has
-- supply_role null and PARTICIPANTS unknown: BROKER and AGENCY were declared
-- participants that had never once participated. These are the columns that were
-- missing.

alter table public.supply_observations
  add column if not exists supply_role text,
  add column if not exists broker_id uuid references public.broker_intelligence (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'supply_observations_supply_role_check'
  ) then
    alter table public.supply_observations
      add constraint supply_observations_supply_role_check
      check (supply_role is null or supply_role in
        ('SELLER', 'LANDLORD', 'DEVELOPER', 'AGENCY', 'BROKER'));
  end if;
end $$;

create index if not exists supply_observations_supply_role_idx
  on public.supply_observations (supply_role) where supply_role is not null;
create index if not exists supply_observations_broker_idx
  on public.supply_observations (broker_id) where broker_id is not null;

comment on column public.supply_observations.supply_role is
  'Who is offering, when the page said so. Null is the honest and common answer; '
  'it must not be read from source_status, which holds availability.';

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
--
-- Enabled with no policies on the intelligence tables: the service role reaches
-- them, nothing else does, matching supply_observations and supply_matches. The
-- directory is different because a broker has to be able to see their own
-- registration, and everyone has to be able to read the public view.

alter table public.broker_intelligence enable row level security;
alter table public.broker_intelligence_sources enable row level security;
alter table public.broker_directory_listings enable row level security;

drop policy if exists broker_directory_owner_reads on public.broker_directory_listings;
create policy broker_directory_owner_reads on public.broker_directory_listings
  for select using (auth.uid() = owner_user_id);

-- And the directory itself is public, because a directory nobody can read is not
-- a directory. The policy repeats the view's test rather than trusting it: a view
-- with security_invoker reads the table as the caller, so without this the
-- directory would be empty for everyone except its own owners, and a future
-- `select * from broker_directory_listings` still cannot see a lapsed or
-- pending-review registration.
drop policy if exists broker_directory_current_is_public on public.broker_directory_listings;
create policy broker_directory_current_is_public on public.broker_directory_listings
  for select using (status = 'ACTIVE' and paid_until is not null and paid_until > now());

grant select on public.broker_directory_public to anon, authenticated;

commit;
