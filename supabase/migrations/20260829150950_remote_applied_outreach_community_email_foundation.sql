-- 20260829150950_outreach_community_email_foundation
--
-- Applied directly to production before repository migration-history
-- synchronization. This file was left deliberately empty, with a note saying
-- "the production schema is captured by later idempotent migrations".
--
-- It is not. Nothing in this repository ever creates
--
--   outreach_contact_lists  outreach_contacts
--   community_directory     property_community_recommendations
--
-- The very next migration, 20260829180000_outreach_schema_reconciliation,
-- opens with `ALTER TABLE public.outreach_contact_lists RENAME COLUMN ...`.
-- Against production that works, because the tables were made by hand. Against
-- an empty database it fails on the first statement, so the outreach subsystem
-- could not be rebuilt from this repository at all -- no fresh environment, no
-- restore, no reviewable definition of what these tables actually are.
--
-- The DDL below is transcribed from the live production catalog, so it states
-- what is really there rather than what someone intended. It is CREATE TABLE
-- IF NOT EXISTS throughout: production already has this migration recorded as
-- applied and will never re-run it, and on a fresh database it now produces
-- the schema the following migration expects.
--
-- Columns are given here with their ORIGINAL names. The reconciliation
-- migration that follows renames several of them (user_id -> owner_id,
-- source_type -> source_format, status -> import_status, raw_data -> raw_row,
-- country_code -> country) and adds the rest; replaying both in order
-- reproduces production.
--
-- RLS and policies are intentionally left to the reconciliation migration,
-- which is where they are already defined.

/* ---------------- contact lists ---------------- */

create table if not exists public.outreach_contact_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  source_type text not null default 'UPLOAD',
  original_filename text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  status text not null default 'PENDING',
  mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ---------------- contacts ---------------- */

create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.outreach_contact_lists(id) on delete cascade,
  user_id uuid not null,
  email text,
  full_name text,
  company text,
  phone text,
  language text,
  country_code text,
  city text,
  tags text[] not null default '{}'::text[],
  consent_status text not null default 'UNKNOWN',
  consent_source text,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_status text not null default 'UNVERIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_outreach_contacts_list on public.outreach_contacts (list_id);

/* ---------------- community directory ----------------
   The one table here that carries real data (28 curated communities). Its
   uniqueness key is (platform, canonical_url): the same group reached through
   two different URLs is two rows, the same URL twice is one. */

create table if not exists public.community_directory (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('TELEGRAM','FACEBOOK','VK','REDDIT','LINKEDIN','THREADS','WHATSAPP','OTHER')),
  canonical_id text,
  canonical_url text not null,
  name text not null,
  description text,
  language text,
  country text,
  region text,
  city text,
  member_count bigint,
  last_activity_at timestamptz,
  posting_policy text not null default 'UNKNOWN'
    check (posting_policy in ('OPEN','APPROVAL_REQUIRED','CLOSED','UNKNOWN')),
  posting_allowed boolean,
  tags text[] not null default '{}'::text[],
  topics text[] default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean default true,
  -- Whether Homatch may post here without a human pressing the button. Default
  -- false, and nothing in the product currently sets it true.
  allows_auto_post boolean default false,
  -- 'primary' = a dedicated housing/real-estate group; 'secondary' = a general
  -- expat or classifieds group that tolerates listings. Ranking treats them
  -- differently rather than hiding the second kind.
  housing_focus text not null default 'primary'
    check (housing_focus in ('primary','secondary')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, canonical_url)
);
create index if not exists idx_community_directory_market
  on public.community_directory (country, language, platform);
create index if not exists idx_community_directory_activity
  on public.community_directory (last_activity_at desc nulls last);
create index if not exists idx_community_directory_housing_focus
  on public.community_directory (housing_focus);

/* ---------------- property -> community recommendations ----------------
   owner_id references auth.users(id), NOT public.users(id). The two id spaces
   are different UUIDs for the same person and mixing them up here has already
   caused one silent-failure bug; the column comment below records which one
   this is so the next writer does not have to rediscover it. */

create table if not exists public.property_community_recommendations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  community_id uuid not null references public.community_directory(id) on delete cascade,
  owner_id uuid references auth.users(id),
  score numeric not null default 0,
  rationale text,
  status text not null default 'PENDING'
    check (status in ('PENDING','OPEN','POST_GENERATED','COPIED','POSTED','SKIPPED')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (property_id, community_id)
);
create index if not exists idx_property_community_recs_property
  on public.property_community_recommendations (property_id, score desc);
create index if not exists idx_property_community_recommendations_community_id
  on public.property_community_recommendations (community_id);
create index if not exists idx_property_community_recommendations_owner_id
  on public.property_community_recommendations (owner_id);

comment on column public.property_community_recommendations.owner_id is
  'auth.users(id) -- the JWT subject, NOT public.users(id).';
