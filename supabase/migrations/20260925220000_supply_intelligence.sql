-- HOMATCH — a listing is not a property.
--
-- WHY TWO TABLES AND NOT ONE
--
-- The same flat appears on ss.ge at $150,000, on an agency site at $162,000
-- and on a portal at $155,000. Those are THREE OBSERVATIONS of ONE PROPERTY,
-- and collapsing them loses the thing that makes the difference interesting:
-- a customer asking "why is this listed at three prices" is asking a question
-- Homatch should be able to answer.
--
-- So:
--
--   supply_observations   what a source said, once, at a time. Immutable in
--                         identity, revisable in content. Never merged.
--   supply_entities       the canonical property those observations are
--                         about. Created only when resolution is confident.
--
-- An observation with no entity is not a failure. It is a listing we have not
-- yet matched to anything, which is the normal state of the first sighting of
-- everything.
--
-- WHY THE CAMPAIGN OWNS NEITHER
--
-- Both are global. A campaign REFERENCES them, and a second campaign in the
-- same market reuses the same rows rather than re-fetching — which is the
-- whole economic argument for a discovery network over a per-campaign
-- scraper. There is deliberately no campaign_id on either table.
--
-- WHY RESOLUTION IS RECORDED RATHER THAN APPLIED
--
-- supply_resolution_decisions keeps every comparison and its verdict,
-- including the ones that decided NOT to merge. An ambiguous pair stays two
-- entities and the doubt is written down, because a destructive merge cannot
-- be undone once the evidence that justified it has aged out.
--
-- FRESHNESS IS THE SAME CONTRACT AS raw_signals
--
-- Same five timestamps, same validation states, same rules: first_seen_at is
-- immutable, last_verified_at advances only on a conclusive check, and an
-- inconclusive re-read advances nothing. A second set of freshness semantics
-- would be a second set of ways to be wrong.

-- ── what a source said ───────────────────────────────────────────────────
create table if not exists public.supply_observations (
  id uuid primary key default gen_random_uuid(),

  source_id uuid not null references public.source_registry(id) on delete restrict,
  adapter_id text not null,
  /* The source's OWN id for this listing. With source_id it is the identity:
     the same listing read twice is one row, updated. */
  external_id text not null,
  canonical_url text not null,

  /* Null until resolution is confident. Not a failure -- it is what the
     first sighting of anything looks like. */
  entity_id uuid,

  transaction text,
  property_type text,
  country_code text,
  city text,
  district text,

  /* Sale and rent NEVER pool. basis says what kind of number it is, and
     there is no constructor for a price without one. */
  sale_amount numeric,
  sale_currency text,
  sale_basis text,
  rent_amount numeric,
  rent_currency text,
  rent_period text,

  area_sqm numeric,
  rooms integer,
  bedrooms integer,
  floor integer,
  total_floors integer,
  year_built integer,

  title text,
  description text,
  /* What the evidence was WRITTEN in. Observed, never the campaign's search
     language: a Russian listing found by a Georgian query is Russian. */
  detected_language text,

  /* The source's own publication date. Never the time we read it. */
  published_at timestamptz,
  source_status text,

  content_fingerprint text not null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  content_changed_at timestamptz,
  expires_at timestamptz,
  validation_state text not null default 'UNVERIFIED',
  failed_checks integer not null default 0,
  last_revalidation_outcome text,

  /* Per-field provenance: JSON_LD, OPEN_GRAPH, URL, TEXT. This is what
     decides whose observation wins when two sources disagree. */
  field_origins jsonb not null default '{}'::jsonb,
  structured_quality numeric,

  /* Which code read it. A parse that changes meaning must be attributable. */
  parser_version text,
  adapter_version text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint supply_observations_identity unique (source_id, external_id),
  constraint supply_observations_transaction_check
    check (transaction is null or transaction in ('SALE', 'RENT', 'SHORT_STAY')),
  constraint supply_observations_validation_check
    check (validation_state in ('UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE')),
  constraint supply_observations_verification_coherence
    check (validation_state <> 'UNVERIFIED' or last_verified_at is null),
  /* An asking price and a transaction price are different facts. None of the
     sources read so far publishes the second. */
  constraint supply_observations_sale_basis_check
    check (sale_basis is null or sale_basis in (
      'ASKING_SALE_PRICE', 'TRANSACTION_PRICE', 'DEVELOPER_PRICE', 'UNKNOWN'))
);

comment on table public.supply_observations is
  'What ONE source said about ONE listing. Global and reusable: no campaign_id, '
  'because a second campaign in the same market reuses these rows rather than '
  're-fetching. Identity is (source_id, external_id).';

create index if not exists supply_observations_entity_idx on public.supply_observations (entity_id) where entity_id is not null;
create index if not exists supply_observations_market_idx on public.supply_observations (country_code, city, transaction);
create index if not exists supply_observations_fingerprint_idx on public.supply_observations (content_fingerprint);
create index if not exists supply_observations_freshness_idx
  on public.supply_observations (validation_state, last_verified_at nulls first, first_seen_at);

-- first_seen_at is immutable here for the same reason it is on raw_signals:
-- if it moves, every age in the product is wrong and nothing says so.
create or replace function public.supply_observations_freeze_first_seen()
returns trigger language plpgsql as $$
begin
  if new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'supply_observations.first_seen_at is immutable (%, % -> %)',
      old.id, old.first_seen_at, new.first_seen_at
      using hint = 'Use last_seen_at for an observation and last_verified_at for a confirmation.';
  end if;
  return new;
end $$;

drop trigger if exists supply_observations_freeze_first_seen on public.supply_observations;
create trigger supply_observations_freeze_first_seen
  before update on public.supply_observations
  for each row execute function public.supply_observations_freeze_first_seen();

-- ── the property those observations are about ────────────────────────────
create table if not exists public.supply_entities (
  id uuid primary key default gen_random_uuid(),

  country_code text not null,
  city text,
  district text,
  transaction text,
  property_type text,

  /* Representative values, taken from the highest-provenance observation
     rather than averaged. An average of three asking prices is a number no
     source published. */
  area_sqm numeric,
  rooms integer,
  bedrooms integer,

  observation_count integer not null default 0,
  source_count integer not null default 0,

  /* What the sources disagree about, kept rather than resolved. This is the
     answer to "the same property appears on four sources at different
     prices". */
  min_price numeric,
  max_price numeric,
  price_currency text,
  price_spread numeric,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  /* Set when this entity is also a Homatch property, so the external market
     and our own inventory are one graph rather than two. */
  property_id uuid references public.properties(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.supply_entities is
  'The canonical property a set of observations is about. min/max price are '
  'kept rather than averaged: an average of three asking prices is a number '
  'no source published.';

create index if not exists supply_entities_market_idx on public.supply_entities (country_code, city, district);
create index if not exists supply_entities_property_idx on public.supply_entities (property_id) where property_id is not null;

-- ── every comparison, including the ones that refused to merge ───────────
create table if not exists public.supply_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  left_observation_id uuid not null references public.supply_observations(id) on delete cascade,
  right_observation_id uuid not null references public.supply_observations(id) on delete cascade,
  verdict text not null,
  /* 0..1. How sure, and the reasons, so a merge can be argued with later. */
  confidence numeric not null default 0,
  signals jsonb not null default '[]'::jsonb,
  decided_at timestamptz not null default now(),

  constraint supply_resolution_verdict_check
    check (verdict in ('EXACT_DUPLICATE', 'LIKELY_SAME_ENTITY', 'RELATED', 'DISTINCT', 'UNRESOLVED')),
  constraint supply_resolution_pair_key unique (left_observation_id, right_observation_id)
);

comment on table public.supply_resolution_decisions is
  'Every pair compared and what was decided, INCLUDING the refusals. An '
  'ambiguous pair stays two entities and the doubt is written down, because a '
  'destructive merge cannot be undone once the evidence that justified it has '
  'aged out.';

create index if not exists supply_resolution_left_idx on public.supply_resolution_decisions (left_observation_id);
create index if not exists supply_resolution_verdict_idx on public.supply_resolution_decisions (verdict, decided_at desc);

-- ── a campaign REFERENCES intelligence; it does not own it ───────────────
create table if not exists public.campaign_supply_references (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.matching_campaigns(id) on delete cascade,
  observation_id uuid not null references public.supply_observations(id) on delete cascade,
  job_id uuid references public.matching_jobs(id) on delete set null,

  /* Did this campaign PAY to discover it, or reuse something already held?
     The distinction is the campaign promise: reusable intelligence plus
     incremental discovery, and a customer is owed both. */
  origin text not null,
  /* What the freshness contract said when this campaign referenced it. */
  evidence_freshness text,

  created_at timestamptz not null default now(),

  constraint campaign_supply_reference_key unique (campaign_id, observation_id),
  constraint campaign_supply_origin_check
    check (origin in ('DISCOVERED_BY_THIS_CAMPAIGN', 'REUSED_EXISTING', 'REVALIDATED_FOR_THIS_CAMPAIGN'))
);

comment on table public.campaign_supply_references is
  'The join between a campaign and the global intelligence it used. `origin` '
  'separates what the campaign paid to discover from what it reused, which is '
  'the campaign promise made countable.';

create index if not exists campaign_supply_references_campaign_idx on public.campaign_supply_references (campaign_id);
create index if not exists campaign_supply_references_observation_idx on public.campaign_supply_references (observation_id);

-- ── access ───────────────────────────────────────────────────────────────
alter table public.supply_observations enable row level security;
alter table public.supply_entities enable row level security;
alter table public.supply_resolution_decisions enable row level security;
alter table public.campaign_supply_references enable row level security;

-- Engine only for now. Customer-facing reads go through a campaign's own
-- delivered results, which apply the freshness gate; a direct read of the
-- observation table would bypass it.
revoke all on public.supply_observations from anon, authenticated;
revoke all on public.supply_entities from anon, authenticated;
revoke all on public.supply_resolution_decisions from anon, authenticated;
revoke all on public.campaign_supply_references from anon, authenticated;
