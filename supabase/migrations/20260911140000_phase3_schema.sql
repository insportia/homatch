-- Homatch — the schema behind src/types/phase3.ts.
--
-- WHAT WAS FOUND
--
-- An entire product layer is fully typed, wired into services, rendered by
-- pages and served by an Edge Function, and NONE of its tables exist:
--
--   developer_profiles          developer-score reads it; DeveloperProfilePage
--   developer_projects          renders the result at /developer/:id
--   property_trust_scores       getPropertyTrustScore()
--   canonical_property_groups   getCanonicalGroup() -- canonical linkage
--   canonical_property_sources
--   external_contact_unlocks    getUnlockedContacts() -- the unlock history
--   active_search_subscriptions getActiveSearchSubscriptions() and 3 writers
--   sponsored_placements        AdminSponsoredPage reads, inserts, updates
--
-- plus properties.developer_id and properties.canonical_group_id, which two
-- of those lookups pivot on.
--
-- Every one of those calls has been failing against a relation that is not
-- there. Several discard the Supabase error, so the pages render empty and
-- look like "no data yet" rather than "this feature has no storage".
--
-- The columns below are derived from the TypeScript interfaces that already
-- describe them, not invented: phase3.ts is the contract the frontend has
-- been compiled against all along.
--
-- ACCESS MODEL
--
--   owner-scoped   active_search_subscriptions, external_contact_unlocks
--                  -- these are a customer's own records. user_id references
--                  public.users(id), so policies compare against
--                  auth_user_id(), matching notifications and the rest of the
--                  app rather than inventing a second convention.
--
--   read-only      developer_*, property_trust_scores, canonical_*
--                  -- derived intelligence. A customer may read it; only the
--                  service role produces it, so a customer cannot manufacture
--                  a developer's trust score or a property's provenance.
--
--   admin-managed  sponsored_placements -- paid placement is a commercial
--                  decision, so writes are admin-only and reads are limited
--                  to enabled rows for everyone else.
--
-- RLS is enabled AND forced on every new table: none of them is written by a
-- SECURITY DEFINER function that relies on owner bypass, so forcing costs
-- nothing and closes the gap the older tables cannot.
--
-- Creates only. Nothing existing is altered except two nullable columns on
-- properties. Idempotent.

/* ---------------- developer / company intelligence ---------------- */

create table if not exists public.developer_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  country text,
  city text,
  website text,
  description text,
  -- Derived, never customer-supplied. Nullable because "we have not assessed
  -- this developer" is a real state and must not read as a score of zero.
  score integer check (score is null or (score >= 0 and score <= 100)),
  score_breakdown jsonb not null default '{}'::jsonb,
  completed_projects integer not null default 0,
  active_projects integer not null default 0,
  years_active integer,
  permits jsonb,
  restrictions jsonb,
  -- Evidence, with provenance. An empty array means "nothing found", which is
  -- not the same as "nothing exists".
  public_risk_evidence jsonb not null default '[]'::jsonb,
  is_sponsored boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.developer_projects (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developer_profiles(id) on delete cascade,
  name text not null,
  city text,
  status text not null default 'UNKNOWN',
  units integer,
  floors integer,
  completion_year integer,
  commissioned boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists developer_projects_developer_idx
  on public.developer_projects (developer_id, status);

/* ---------------- canonical property linkage ---------------- */

create table if not exists public.canonical_property_groups (
  id uuid primary key default gen_random_uuid(),
  canonical_property_id uuid,
  source_count integer not null default 0,
  min_price numeric(14,2),
  max_price numeric(14,2),
  price_currency text,
  -- The spread between the cheapest and dearest listing of the SAME property
  -- across sources. The whole point of grouping duplicates.
  price_diff numeric(14,2),
  last_deduped_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.canonical_property_sources (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.canonical_property_groups(id) on delete cascade,
  property_id uuid,
  source_url text,
  source_name text,
  price numeric(14,2),
  price_currency text,
  is_canonical boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists canonical_property_sources_group_idx
  on public.canonical_property_sources (group_id);
-- One listing appears once per group.
create unique index if not exists canonical_property_sources_group_property_uidx
  on public.canonical_property_sources (group_id, property_id)
  where property_id is not null;

/* ---------------- property trust ---------------- */

create table if not exists public.property_trust_scores (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  score integer not null check (score >= 0 and score <= 100),
  confidence text not null default 'LOW'
    check (confidence in ('HIGH','MEDIUM','LOW','VERY_LOW')),
  risk_indicators jsonb not null default '[]'::jsonb,
  price_conflict boolean not null default false,
  area_conflict boolean not null default false,
  location_conflict boolean not null default false,
  duplicate_images boolean not null default false,
  data_stale boolean not null default false,
  cadastral_mismatch boolean not null default false,
  source_confidence numeric(5,2),
  last_checked_at timestamptz not null default now()
);
create unique index if not exists property_trust_scores_property_uidx
  on public.property_trust_scores (property_id);

/* ---------------- paid contact unlocks ---------------- */

create table if not exists public.external_contact_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  match_id uuid not null,
  signal_id uuid,
  lead_type text not null
    check (lead_type in ('BUYER_INTENT','RENTER_INTENT','INVESTOR_INTENT','POSSIBLE_BUYER','POSSIBLE_RENTER')),
  lead_label text not null,
  match_score numeric(5,2),
  location_label text,
  transaction text,
  budget_min numeric(14,2),
  budget_max numeric(14,2),
  budget_currency text,
  requirements text,
  source text,
  confidence numeric(5,2),
  freshness_days integer,
  credits_charged integer not null default 0,
  actual_cost numeric(12,4) not null default 0,
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);
-- One paid unlock per user per match. The same protection match_unlocks
-- already has, for the same reason: a retry must not charge twice.
create unique index if not exists external_contact_unlocks_user_match_uidx
  on public.external_contact_unlocks (user_id, match_id);

/* ---------------- active search ---------------- */

create table if not exists public.active_search_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  intent_id uuid,
  search_criteria jsonb,
  property_id uuid,
  side text not null check (side in ('DEMAND','SUPPLY')),
  is_active boolean not null default true,
  last_notified_at timestamptz,
  notify_in_app boolean not null default true,
  notify_push boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists active_search_subscriptions_user_idx
  on public.active_search_subscriptions (user_id, is_active);

/* ---------------- sponsored placements ---------------- */

create table if not exists public.sponsored_placements (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null,
  category text not null default 'developer',
  headline text not null,
  sub_headline text,
  cta_label text not null default 'Learn more',
  destination_url text not null,
  placement text not null default 'dashboard',
  market text not null default 'tbilisi',
  language text not null default 'en',
  start_date date,
  end_date date,
  enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsored_placements_live_idx
  on public.sponsored_placements (placement, market, language, enabled, sort_order);

/* ---------------- properties pivots ---------------- */

alter table public.properties
  add column if not exists developer_id uuid references public.developer_profiles(id) on delete set null,
  add column if not exists canonical_group_id uuid references public.canonical_property_groups(id) on delete set null;

create index if not exists properties_developer_idx on public.properties (developer_id);
create index if not exists properties_canonical_group_idx on public.properties (canonical_group_id);

/* ---------------- RLS ---------------- */

alter table public.developer_profiles          enable row level security;
alter table public.developer_profiles          force row level security;
alter table public.developer_projects          enable row level security;
alter table public.developer_projects          force row level security;
alter table public.canonical_property_groups   enable row level security;
alter table public.canonical_property_groups   force row level security;
alter table public.canonical_property_sources  enable row level security;
alter table public.canonical_property_sources  force row level security;
alter table public.property_trust_scores       enable row level security;
alter table public.property_trust_scores       force row level security;
alter table public.external_contact_unlocks    enable row level security;
alter table public.external_contact_unlocks    force row level security;
alter table public.active_search_subscriptions enable row level security;
alter table public.active_search_subscriptions force row level security;
alter table public.sponsored_placements        enable row level security;
alter table public.sponsored_placements        force row level security;

do $$
begin
  -- Derived intelligence: readable, never customer-writable.
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='developer_profiles_read') then
    create policy developer_profiles_read on public.developer_profiles
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='developer_projects_read') then
    create policy developer_projects_read on public.developer_projects
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='property_trust_scores_read') then
    create policy property_trust_scores_read on public.property_trust_scores
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='canonical_groups_read') then
    create policy canonical_groups_read on public.canonical_property_groups
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='canonical_sources_read') then
    create policy canonical_sources_read on public.canonical_property_sources
      for select to authenticated using (true);
  end if;

  -- A customer's own records.
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='external_unlocks_own') then
    create policy external_unlocks_own on public.external_contact_unlocks
      for select to authenticated
      using (user_id = (select public.auth_user_id()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='active_search_own') then
    create policy active_search_own on public.active_search_subscriptions
      for all to authenticated
      using (user_id = (select public.auth_user_id()))
      with check (user_id = (select public.auth_user_id()));
  end if;

  -- Paid placement is a commercial decision: admins write, everyone else
  -- sees only what is actually live.
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='sponsored_read_enabled') then
    create policy sponsored_read_enabled on public.sponsored_placements
      for select to authenticated using (enabled = true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='sponsored_admin_all') then
    create policy sponsored_admin_all on public.sponsored_placements
      for all to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- Writes to derived intelligence and to paid unlocks belong to the service
-- role, which bypasses RLS. No client INSERT/UPDATE policy is created for
-- them on purpose: a customer must not be able to author a developer's score,
-- a property's trust rating, or a record of a purchase they did not make.
revoke insert, update, delete on
  public.developer_profiles, public.developer_projects, public.property_trust_scores,
  public.canonical_property_groups, public.canonical_property_sources,
  public.external_contact_unlocks
  from authenticated, anon;
