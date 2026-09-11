-- HOMATCH — the intelligence graph.
--
-- Written after auditing every existing structure (docs/INTELLIGENCE_SCHEMA_AUDIT.md).
-- The audit's conclusion decided the shape of this file: cost_events,
-- provider_price_book, research_cache, source_registry, developer_profiles,
-- canonical_property_groups and property_facts all stay exactly where they
-- are and keep doing what they do. Three things genuinely had no home, and
-- only those three are added.
--
-- WHAT WAS MISSING
--
--   1. An identity. The cadastral code — the one identifier that actually
--      identifies a Georgian property — existed only as research_jobs.query
--      and as free text inside result_json. Nothing could answer "have we
--      researched this before?", and every reuse idea depends on that
--      question having an answer.
--
--   2. A fact. property_facts has 54 columns and is a listing snapshot: it
--      can hold today's value and cannot hold a value's evidence, its
--      validity, or what it replaced.
--
--   3. A relationship. Unit → parcel → building → project → developer was
--      inferred inside one report and forgotten when that report ended.
--
-- THE UNIT OF REUSE IS NOT A CACHED REPORT. It is one fact about one entity,
-- from one source, at one version, with a freshness class and a change
-- history. A cached report cannot be partially refreshed, cannot say which of
-- its claims is now stale, and cannot be shared between two properties that
-- happen to be in the same building.

/* ══════════════════════════════════════════════════════════════════════
 * ENTITIES
 * ══════════════════════════════════════════════════════════════════════ */

create table if not exists public.intelligence_entities (
  id uuid primary key default gen_random_uuid(),

  entity_type text not null check (entity_type in (
    'PROPERTY_UNIT',
    'PARENT_PARCEL',
    'BUILDING',
    'PROJECT',
    'DEVELOPER',
    'COMPANY',
    'LOCATION',
    'LISTING'
  )),

  /*
   * WHAT ACTUALLY IDENTIFIES THIS THING.
   *
   * Normalised at write time — a cadastral code with its punctuation intact
   * and its whitespace gone — so that the same property found through two
   * different routes lands on one row rather than two.
   */
  key_kind text not null check (key_kind in (
    'CADASTRAL_CODE',
    'COMPANY_ID',
    'PROJECT_SLUG',
    'LISTING_URL',
    'LOCATION_SLUG'
  )),
  natural_key text not null check (length(btrim(natural_key)) > 0),

  display_name text,
  country text not null default 'GE',

  /*
   * Links OUT to the entity tables that already exist, rather than copying
   * them. developer_profiles knows about developers and has for a long time;
   * this table's job is to give that developer a node in the graph, not a
   * second profile that can drift from the first.
   */
  developer_profile_id uuid references public.developer_profiles (id) on delete set null,
  developer_project_id uuid references public.developer_projects (id) on delete set null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * One row per real-world thing. Deliberately NOT keyed on entity_type as
   * well: a cadastral code is either a parcel or a unit inside one, decided
   * by how many groups it has, and the same code must never exist as both.
   */
  constraint intelligence_entities_identity unique (key_kind, natural_key)
);

comment on table public.intelligence_entities is
  'Nodes of the internal intelligence graph. Never customer-facing.';

create index if not exists intelligence_entities_type on public.intelligence_entities (entity_type);

/* ══════════════════════════════════════════════════════════════════════
 * FACTS
 * ══════════════════════════════════════════════════════════════════════ */

create table if not exists public.intelligence_facts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.intelligence_entities (id) on delete cascade,

  -- A normalised key, not free text: 'ownership.owner', 'encumbrance.mortgage',
  -- 'project.floors'. Two facts about the same thing must collide.
  fact_key text not null check (length(btrim(fact_key)) > 0),

  -- One of these carries the value. Numbers stay numbers so they can be
  -- compared and aggregated without parsing prose back out of a string.
  value_text text,
  value_number numeric,
  value_json jsonb,
  value_unit text,

  /*
   * WHERE IT CAME FROM — AND WHAT MAY NOT.
   *
   * This CHECK is the privacy rule, enforced rather than documented. There is
   * deliberately no value here for an uploaded contract, a deal-room
   * document, a private note, a chat message, an unverified user claim or a
   * model's prose. A fact sourced from any of those cannot be written,
   * because there is nothing to write in this column.
   *
   * DETERMINISTIC_DERIVATION is for facts computed in code from other facts
   * already in this table — a parent parcel read off a cadastral code, say —
   * never for anything a model concluded.
   */
  source_kind text not null check (source_kind in (
    'OFFICIAL_REGISTRY',
    'OFFICIAL_DOCUMENT',
    'PUBLIC_WEB',
    'MARKET_LISTING',
    'PARTNER_PUBLICATION',
    'DEVELOPER_STATEMENT',
    'MEDIA_REPORT',
    'DETERMINISTIC_DERIVATION'
  )),

  -- The source RECORD, in the store that already exists for fetched records.
  source_id uuid references public.research_cache (id) on delete set null,
  -- A human-followable reference: a document number, a registry version, a URL.
  source_ref text,
  -- The evidence id inside the originating job's bundle.
  evidence_ref text,
  -- Which verification first learned this. Attribution, not ownership: the
  -- fact belongs to the entity, and survives the job being deleted.
  first_job_id uuid references public.research_jobs (id) on delete set null,

  /*
   * NO EVIDENCE = NO FACT, as a constraint rather than a convention.
   *
   * A row must carry at least one way to get back to what established it.
   * The single exception is a deterministic derivation, which is reproducible
   * from code and needs no external record to point at.
   */
  constraint fact_has_provenance check (
    source_kind = 'DETERMINISTIC_DERIVATION'
    or source_id is not null
    or nullif(btrim(coalesce(source_ref, '')), '') is not null
    or nullif(btrim(coalesce(evidence_ref, '')), '') is not null
  ),

  -- When the SOURCE says it was true, which is not when we read it.
  observed_at timestamptz,
  retrieved_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),

  -- The window this value is asserted for. valid_to null means "still".
  valid_from timestamptz,
  valid_to timestamptz,

  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),

  /*
   * How fast this KIND of fact goes out of date. Ownership changes on a
   * Tuesday; a building's floor count does not. One TTL for both is either
   * wasteful or wrong, and usually both.
   */
  freshness_class text not null default 'MEDIUM_VOLATILITY' check (freshness_class in (
    'HIGH_VOLATILITY',
    'MEDIUM_VOLATILITY',
    'LOW_VOLATILITY'
  )),

  -- What the source looked like when we read it. Same hash, same source,
  -- nothing to re-interpret and nothing to pay for.
  content_hash text,

  status text not null default 'CURRENT' check (status in (
    'CURRENT',
    'STALE',
    'SUPERSEDED',
    'CONFLICTING'
  )),

  supersedes uuid references public.intelligence_facts (id) on delete set null,
  superseded_by uuid references public.intelligence_facts (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fact_period_is_ordered check (valid_to is null or valid_from is null or valid_to > valid_from),
  -- A row must actually assert something.
  constraint fact_has_a_value check (
    value_text is not null or value_number is not null or value_json is not null
  )
);

comment on table public.intelligence_facts is
  'One fact about one entity, with its provenance, validity and history. Internal only.';

/*
 * ONE CURRENT VALUE.
 *
 * The audit found this was exactly what nothing held: result_json is current
 * for one job, never for the entity. A partial unique index says it directly
 * — an entity may carry a whole history of a fact and at most one answer to
 * "what is it now", so a write that forgets to supersede the old value fails
 * instead of quietly producing two truths.
 */
create unique index if not exists intelligence_facts_one_current
  on public.intelligence_facts (entity_id, fact_key)
  where status = 'CURRENT';

create index if not exists intelligence_facts_lookup
  on public.intelligence_facts (entity_id, fact_key, status);
create index if not exists intelligence_facts_staleness
  on public.intelligence_facts (freshness_class, last_verified_at)
  where status = 'CURRENT';
create index if not exists intelligence_facts_by_hash
  on public.intelligence_facts (content_hash)
  where content_hash is not null;

/* ══════════════════════════════════════════════════════════════════════
 * RELATIONSHIPS
 * ══════════════════════════════════════════════════════════════════════ */

create table if not exists public.intelligence_relationships (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references public.intelligence_entities (id) on delete cascade,
  to_entity_id uuid not null references public.intelligence_entities (id) on delete cascade,

  relation text not null check (relation in (
    'HAS_PARENT_PARCEL',
    'IN_BUILDING',
    'PART_OF_PROJECT',
    'DEVELOPED_BY',
    'IS_COMPANY',
    'LOCATED_IN',
    'LISTED_AS',
    'COMPARABLE_TO'
  )),

  -- A relationship is a fact and carries the same provenance rules. "This
  -- flat is in that project" is a claim, and an unevidenced claim about which
  -- project a flat belongs to is how a developer's reputation gets attached
  -- to a building they never touched.
  source_kind text not null check (source_kind in (
    'OFFICIAL_REGISTRY',
    'OFFICIAL_DOCUMENT',
    'PUBLIC_WEB',
    'MARKET_LISTING',
    'PARTNER_PUBLICATION',
    'DEVELOPER_STATEMENT',
    'MEDIA_REPORT',
    'DETERMINISTIC_DERIVATION'
  )),
  source_id uuid references public.research_cache (id) on delete set null,
  source_ref text,
  evidence_ref text,
  first_job_id uuid references public.research_jobs (id) on delete set null,

  constraint relationship_has_provenance check (
    source_kind = 'DETERMINISTIC_DERIVATION'
    or source_id is not null
    or nullif(btrim(coalesce(source_ref, '')), '') is not null
    or nullif(btrim(coalesce(evidence_ref, '')), '') is not null
  ),

  observed_at timestamptz,
  retrieved_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'CURRENT' check (status in ('CURRENT', 'STALE', 'SUPERSEDED', 'CONFLICTING')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint relationship_is_between_two_things check (from_entity_id <> to_entity_id),
  constraint intelligence_relationships_unique unique (from_entity_id, to_entity_id, relation)
);

comment on table public.intelligence_relationships is
  'Evidenced edges of the intelligence graph. Never inferred without a source.';

create index if not exists intelligence_relationships_from
  on public.intelligence_relationships (from_entity_id, relation) where status = 'CURRENT';
create index if not exists intelligence_relationships_to
  on public.intelligence_relationships (to_entity_id, relation) where status = 'CURRENT';

/* ══════════════════════════════════════════════════════════════════════
 * FRESHNESS POLICY
 * ══════════════════════════════════════════════════════════════════════ */

/*
 * How long a kind of fact stays trustworthy.
 *
 * A table rather than constants because the right answer is a judgement that
 * changes with experience, and because "how old is too old for a mortgage
 * record" is a business question somebody should be able to answer without a
 * deploy.
 *
 * OLD IS NOT WRONG. A stale fact is one that must be RE-CHECKED before a
 * report leans on it — not one that is known to be false, and not one to
 * throw away.
 */
create table if not exists public.intelligence_freshness_policy (
  id uuid primary key default gen_random_uuid(),
  -- Matches a fact_key exactly, or a prefix ending in '.' — 'encumbrance.'
  -- covers every encumbrance without listing them.
  fact_key_pattern text not null unique check (length(btrim(fact_key_pattern)) > 0),
  freshness_class text not null check (freshness_class in (
    'HIGH_VOLATILITY', 'MEDIUM_VOLATILITY', 'LOW_VOLATILITY'
  )),
  max_age_hours integer not null check (max_age_hours > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intelligence_freshness_policy is
  'Per-fact-kind staleness thresholds. Old is not wrong: stale means re-check.';

/*
 * The starting policy, from the mandate's own volatility lists.
 *
 * HIGH: anything that can change between agreeing a price and signing. These
 * are the facts a buyer is actually exposed to, so they are re-checked on
 * every verification regardless of what we already hold.
 *
 * MEDIUM: things that move over weeks — a permit, a construction stage, a
 * company's status.
 *
 * LOW: things that essentially do not move. A building does not gain a floor.
 */
insert into public.intelligence_freshness_policy (fact_key_pattern, freshness_class, max_age_hours, notes)
values
  ('ownership.',        'HIGH_VOLATILITY',   6,    'Can change between agreeing a price and signing.'),
  ('encumbrance.',      'HIGH_VOLATILITY',   6,    'Mortgages, liens, seizures, restrictions.'),
  ('rights.',           'HIGH_VOLATILITY',   6,    'Registered rights and public-law restrictions.'),
  ('registry.',         'HIGH_VOLATILITY',   6,    'Current registry state of the exact unit.'),
  ('listing.price',     'HIGH_VOLATILITY',   24,   'An asking price is only current while it is asked.'),
  ('listing.status',    'HIGH_VOLATILITY',   24,   'Active, withdrawn, sold.'),
  -- Only the price and the status of a listing move while it is live. Its
  -- area, rooms, floor, condition and address do not, and without a rule of
  -- their own they would default to STALE and keep the market stage at full
  -- effort for ever. Found by reading a real plan: seven listing facts came
  -- back stale thirty minutes after being written.
  ('listing.',          'MEDIUM_VOLATILITY', 336,  'Everything about a listing except its price and status.'),
  ('company.representation', 'HIGH_VOLATILITY', 24, 'Who can sign, when a signature is imminent.'),

  ('commissioning.',    'MEDIUM_VOLATILITY', 336,  'Two weeks. Moves, but not daily.'),
  ('construction.',     'MEDIUM_VOLATILITY', 336,  'Progress and current physical status.'),
  ('permit.',           'MEDIUM_VOLATILITY', 720,  'A month.'),
  ('company.status',    'MEDIUM_VOLATILITY', 720,  'Active, dissolved, in liquidation.'),
  ('project.inventory', 'MEDIUM_VOLATILITY', 336,  'Units still available.'),
  ('amenities.',        'MEDIUM_VOLATILITY', 2160, 'Three months.'),

  ('project.identity',  'LOW_VOLATILITY',    8760, 'A year. A project does not change its name.'),
  ('building.',         'LOW_VOLATILITY',    8760, 'Floors, structure, materials.'),
  ('address.',          'LOW_VOLATILITY',    8760, 'Addresses are essentially permanent.'),
  ('location.',         'LOW_VOLATILITY',    4320, 'Six months. Infrastructure moves slowly.'),
  ('parcel.',           'LOW_VOLATILITY',    8760, 'Parcel identity and geometry.')
on conflict (fact_key_pattern) do nothing;

/* ══════════════════════════════════════════════════════════════════════
 * WHO MAY READ ANY OF IT
 * ══════════════════════════════════════════════════════════════════════ */

/*
 * Nobody, except the service role and an admin.
 *
 * This is internal intelligence. A customer reads their REPORT, which is
 * written from these facts and sanitised on the way out. Reading the graph
 * directly would show them facts gathered while researching other people's
 * properties, and there is no version of that which is acceptable.
 *
 * No policy exists for anon or authenticated beyond the admin one, so RLS
 * denies them every row whatever table-level grants Postgres hands out.
 */
do $$
declare t text;
begin
  foreach t in array array[
    'intelligence_entities',
    'intelligence_facts',
    'intelligence_relationships',
    'intelligence_freshness_policy'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_all', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_all', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.users u where u.auth_id = (select auth.uid()) and u.is_admin = true))',
      t || '_admin_read', t
    );
  end loop;
end $$;

/* ── updated_at, without four copies of the same trigger ─────────────── */

create or replace function public.touch_intelligence_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'intelligence_entities',
    'intelligence_facts',
    'intelligence_relationships',
    'intelligence_freshness_policy'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_intelligence_row()',
      t || '_touch', t
    );
  end loop;
end $$;
