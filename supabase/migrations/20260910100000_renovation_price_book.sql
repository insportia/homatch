-- Homatch Renovation — versioned price book + real-market price survey
--
-- THE PROBLEM THIS SOLVES
-- ----------------------
-- The recovered calculation engine is deterministic and correct, but it ships
-- with a 13-item Tbilisi seed that is explicitly PROVISIONAL: a plausible
-- range read off published contractor pages, never verified. Showing a
-- customer "your renovation costs 78,400 GEL" on that basis would be
-- fabricating market data with a confident number attached.
--
-- So the schema is built around one invariant, enforced in SQL rather than
-- only in application code:
--
--   A CUSTOMER ESTIMATE MAY ONLY READ PRICES FROM A **PUBLISHED** BOOK
--   VERSION, AND ONLY ITEMS WITH STATUS 'VERIFIED'.
--
-- Provisional, stale and rejected prices are readable by admins (they are the
-- working set of the survey) and are invisible to customers. A book version
-- with no verified items simply yields no estimate — the calculator says "we
-- do not have enough verified price data yet", which is honest, instead of
-- guessing.
--
-- WHY VERSIONS RATHER THAN MUTABLE ROWS
-- ------------------------------------
-- A saved renovation scenario must remain explainable months later. If prices
-- were edited in place, reopening an old estimate would silently produce a
-- different number with no record of why. Each scenario therefore pins the
-- price_book_version_id it was computed against, and published versions are
-- immutable.
--
-- NOT APPLIED. Written locally for review; deployment is a separate decision.

-- ---------------------------------------------------------------------------
-- renovation_price_book_versions
-- ---------------------------------------------------------------------------
create table if not exists public.renovation_price_book_versions (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'tbilisi',
  version integer not null,
  currency text not null default 'GEL',

  status text not null default 'DRAFT'
    check (status in ('DRAFT','PUBLISHED','ARCHIVED')),

  -- Free-text description of what changed and on what evidence.
  notes text,

  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists renovation_price_book_versions_market_version_uidx
  on public.renovation_price_book_versions (market, version);

-- At most ONE published version per market. A second published version would
-- make "the current price book" ambiguous, and the calculator would silently
-- pick one.
create unique index if not exists renovation_price_book_versions_one_published_uidx
  on public.renovation_price_book_versions (market)
  where status = 'PUBLISHED';

-- ---------------------------------------------------------------------------
-- renovation_price_items
-- ---------------------------------------------------------------------------
create table if not exists public.renovation_price_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.renovation_price_book_versions(id) on delete cascade,

  -- Stable key shared with the calculation engine's TBILISI_PRICE_BOOK items,
  -- so a book row and an engine line item refer to the same thing.
  item_key text not null,
  category text not null,
  label text not null,

  unit text not null check (unit in ('m2','lm','point','unit','set','project')),
  -- Which half of the cost this row represents. Split rows let the estimate
  -- show a labour/material breakdown; COMBINED is a single all-in rate.
  cost_kind text not null default 'COMBINED'
    check (cost_kind in ('LABOR','MATERIAL','COMBINED')),

  -- low <= base <= high, enforced below. `base` is what the engine uses.
  price_low numeric(12,2),
  price_base numeric(12,2) not null,
  price_high numeric(12,2),
  currency text not null default 'GEL',

  -- Category-appropriate material waste, mirroring the engine's WASTE table.
  -- Labour is not wasted; material is — so this multiplies material quantity
  -- only. Bounded to the same range validatePriceBook() enforces, so a book
  -- loaded from the database cannot violate a rule the in-code book obeys.
  waste_factor numeric(4,3) not null default 0
    check (waste_factor >= 0 and waste_factor <= 0.3),

  status text not null default 'PROVISIONAL'
    check (status in ('PROVISIONAL','VERIFIED','STALE','REJECTED')),

  -- Provenance. `source_date` is when the SOURCE stated the price;
  -- `collected_at` is when Homatch recorded it. They are different facts and
  -- conflating them is how a price book silently goes stale.
  source text,
  source_url text,
  source_date date,
  collected_at timestamptz not null default now(),

  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,

  active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint renovation_price_items_range_ck
    check (
      (price_low is null or price_low <= price_base)
      and (price_high is null or price_high >= price_base)
    ),
  constraint renovation_price_items_positive_ck
    check (price_base > 0),
  -- A price cannot claim to be VERIFIED without recording who verified it and
  -- where it came from. This is the database refusing to hold an unfalsifiable
  -- claim, rather than trusting the admin UI to be careful.
  constraint renovation_price_items_verified_needs_evidence_ck
    check (
      status <> 'VERIFIED'
      or (verified_by is not null and verified_at is not null and source is not null)
    )
);

create unique index if not exists renovation_price_items_version_key_kind_uidx
  on public.renovation_price_items (version_id, item_key, cost_kind);
create index if not exists renovation_price_items_lookup_idx
  on public.renovation_price_items (version_id, status, active);

-- ---------------------------------------------------------------------------
-- renovation_price_observations  (the survey evidence layer)
--
-- One observed price from one lawful public source at one point in time. Items
-- are DERIVED from observations by an admin; observations are never shown to
-- customers and are never averaged automatically across incompatible units.
-- ---------------------------------------------------------------------------
create table if not exists public.renovation_price_observations (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'tbilisi',
  item_key text not null,
  category text,

  observed_value numeric(12,2) not null check (observed_value > 0),
  -- The unit AS PUBLISHED. Normalization to the canonical unit is explicit and
  -- recorded, so an m2 rate is never silently compared with a per-room price.
  observed_unit text not null,
  normalized_value numeric(12,2),
  normalized_unit text,
  normalization_note text,
  currency text not null default 'GEL',

  source_type text not null default 'PUBLIC_PRICE_LIST'
    check (source_type in (
      'PUBLIC_PRICE_LIST','CONTRACTOR_SITE','SUPPLIER_CATALOG',
      'MARKETPLACE_LISTING','MANUAL_QUOTATION','ADMIN_ENTRY'
    )),
  source_name text not null,
  source_url text,
  source_date date,
  collected_at timestamptz not null default now(),
  collected_by uuid references auth.users(id) on delete set null,

  review_state text not null default 'PENDING'
    check (review_state in ('PENDING','APPROVED','REJECTED','OUTLIER')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,

  -- Set when this observation was folded into a price item, so the chain from
  -- customer estimate back to the original published page stays walkable.
  applied_to_item_id uuid references public.renovation_price_items(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists renovation_price_observations_key_idx
  on public.renovation_price_observations (market, item_key, review_state);
create index if not exists renovation_price_observations_review_idx
  on public.renovation_price_observations (review_state, collected_at desc);

-- The same URL stating the same item at the same date is one observation, not
-- three. Prevents a re-run of the survey from inflating apparent corroboration.
create unique index if not exists renovation_price_observations_dedupe_uidx
  on public.renovation_price_observations (market, item_key, source_url, source_date)
  where source_url is not null;

-- ---------------------------------------------------------------------------
-- Scenario pinning
-- ---------------------------------------------------------------------------
alter table public.renovation_scenarios
  add column if not exists price_book_version_id uuid
    references public.renovation_price_book_versions(id) on delete set null,
  -- Records whether the customer was shown real numbers or an explicit
  -- "not enough verified data" state, so an old scenario is never
  -- misremembered as having been a real quote.
  add column if not exists estimate_state text not null default 'NOT_PRICED'
    check (estimate_state in ('NOT_PRICED','PRICED','INSUFFICIENT_PRICE_DATA'));

-- ---------------------------------------------------------------------------
-- The customer-facing read path
--
-- A security-invoker view, so RLS on the underlying tables still applies. It
-- is the ONLY thing the calculator reads: nothing else can reach a
-- provisional price by accident, because the filter lives here rather than in
-- whichever query a future page happens to write.
-- ---------------------------------------------------------------------------
create or replace view public.renovation_active_prices
with (security_invoker = true)
as
  select
    i.id, i.version_id, v.market, v.version,
    i.item_key, i.category, i.label, i.unit, i.cost_kind, i.waste_factor,
    i.price_low, i.price_base, i.price_high, i.currency,
    i.source, i.source_date, i.verified_at
  from public.renovation_price_items i
  join public.renovation_price_book_versions v on v.id = i.version_id
  where v.status = 'PUBLISHED'
    and i.status = 'VERIFIED'
    and i.active = true;

comment on view public.renovation_active_prices is
  'The only price source a customer estimate may read: VERIFIED items in the single PUBLISHED book version. Provisional/stale/rejected prices are deliberately invisible here.';

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Price data is reference data, not user data:
--   * any authenticated user may READ a published version's verified items
--     (that is what the calculator needs),
--   * everything else — drafts, provisional items, every observation, and all
--     writes — is admin-only.
-- ---------------------------------------------------------------------------
alter table public.renovation_price_book_versions enable row level security;
alter table public.renovation_price_items         enable row level security;
alter table public.renovation_price_observations  enable row level security;

alter table public.renovation_price_book_versions force row level security;
alter table public.renovation_price_items         force row level security;
alter table public.renovation_price_observations  force row level security;

drop policy if exists renovation_price_versions_read  on public.renovation_price_book_versions;
drop policy if exists renovation_price_versions_admin on public.renovation_price_book_versions;

create policy renovation_price_versions_read on public.renovation_price_book_versions
  for select to authenticated
  using (status = 'PUBLISHED' or public.is_admin());

create policy renovation_price_versions_admin on public.renovation_price_book_versions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists renovation_price_items_read  on public.renovation_price_items;
drop policy if exists renovation_price_items_admin on public.renovation_price_items;

-- A non-admin can only ever see a VERIFIED, active item inside a PUBLISHED
-- version. This is the same rule as the view, restated at the table, so it
-- holds even for a query that bypasses the view.
create policy renovation_price_items_read on public.renovation_price_items
  for select to authenticated
  using (
    public.is_admin()
    or (
      status = 'VERIFIED'
      and active = true
      and exists (
        select 1 from public.renovation_price_book_versions v
        where v.id = version_id and v.status = 'PUBLISHED'
      )
    )
  );

create policy renovation_price_items_admin on public.renovation_price_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists renovation_price_observations_admin on public.renovation_price_observations;
create policy renovation_price_observations_admin on public.renovation_price_observations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.renovation_price_book_versions from anon;
revoke all on public.renovation_price_items         from anon;
revoke all on public.renovation_price_observations  from anon;
revoke all on public.renovation_active_prices       from anon;

-- ---------------------------------------------------------------------------
-- Published versions are immutable
--
-- Editing a published price would retroactively change every saved estimate
-- that pinned it. Corrections are made by drafting a NEW version.
-- ---------------------------------------------------------------------------
create or replace function public.guard_published_price_items()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.renovation_price_book_versions
  where id = coalesce(new.version_id, old.version_id);

  if v_status = 'PUBLISHED' then
    raise exception
      'price book version is PUBLISHED and immutable; create a new version instead'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists renovation_price_items_immutable on public.renovation_price_items;
create trigger renovation_price_items_immutable
  before insert or update or delete on public.renovation_price_items
  for each row execute function public.guard_published_price_items();

-- ---------------------------------------------------------------------------
-- Staleness
--
-- A price whose SOURCE is older than the window is stale whether or not
-- anyone remembered to look. Called by an admin action or a scheduled job;
-- deliberately not a trigger, so marking stale is an explicit, audited event.
-- ---------------------------------------------------------------------------
create or replace function public.mark_stale_price_items(p_max_age_days integer default 180)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.renovation_price_items i
     set status = 'STALE', updated_at = now()
    from public.renovation_price_book_versions v
   where v.id = i.version_id
     and v.status <> 'PUBLISHED'
     and i.status = 'VERIFIED'
     and coalesce(i.source_date, i.collected_at::date) < (current_date - p_max_age_days);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_stale_price_items(integer) from public, anon;
grant execute on function public.mark_stale_price_items(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: version 1 as a DRAFT holding the engine's 13 provisional items.
--
-- Deliberately DRAFT and deliberately PROVISIONAL. This makes the current,
-- honest state explicit in the database — the survey has a starting point,
-- and the calculator still refuses to price anything, because no version is
-- published and no item is verified.
-- ---------------------------------------------------------------------------
insert into public.renovation_price_book_versions (market, version, currency, status, notes)
values (
  'tbilisi', 1, 'GEL', 'DRAFT',
  'Initial provisional seed carried over from the calculation engine. Published contractor ranges, not verified quotations. Not publishable until items are individually verified against real sourced evidence.'
)
on conflict (market, version) do nothing;
