-- HOMATCH FOR EXPATS — the tables the product needs and no others.
--
-- WHAT WAS DELIBERATELY NOT CREATED
--
-- No source registry. public.source_registry already holds 315 crawlable
-- sources with scan cursors and productivity counters, and FOR EXPATS
-- discovery uses it. What this migration adds is a CITATION ledger, which is
-- a different thing: a registry answers "where should we look next", a
-- citation answers "which page, read on which day, backs this sentence".
-- expat_citations.source_registry_id points at the registry row where one
-- exists, so the two are linked rather than duplicated.
--
-- No evidence model. research-core's Observation and the EvidenceItem bridge
-- stay authoritative for research output. expat_citations is the small,
-- human-curated end of the same idea, for content an editor wrote and
-- sourced by hand.
--
-- No billing ledger, no credits, no wallet. Provider research reserves and
-- settles through _shared/billing.ts like every other paid product.
--
-- No second notifications table. Reminders go through notify_emit.
--
-- WHY CONTENT IS JSONB KEYED BY LOCALE RATHER THAN A ROW PER LANGUAGE
--
-- A topic is read in one language at a time and always in full. A row per
-- (topic, locale) turns every read into a join and every publish into six
-- writes that can half-fail, leaving a topic that exists in Georgian and not
-- in English. One row, one write, one read, and a CHECK that English is
-- present because English is the language this product launches in.
--
-- WHY THE FACTS ARE SEPARATE FROM THE TOPIC
--
-- A topic is an article. A fact is a claim with a source, an observed date
-- and a review interval. They go stale independently: the explanation of how
-- a residence permit works is good for a year, and the fee in it is good for
-- three months. Storing the fee inside the article body would mean the whole
-- article ages at the speed of its fastest-moving number, or — far worse —
-- that the number quietly does not age at all.

/* ────────────────────────────────────────────────────────────────────────
 * CITATIONS
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_citations (
  id            uuid primary key default gen_random_uuid(),
  -- Who published it, in their own name. Never blank: a claim whose
  -- publisher we cannot name is a claim the product does not make.
  publisher     text not null check (length(btrim(publisher)) > 0),
  url           text,
  -- True only for a government body, a regulator, or the legal text itself.
  -- A law firm's summary of a decree is not official however accurate.
  official      boolean not null default false,
  -- The date the source itself carries.
  published_on  date,
  -- When the rule TAKES EFFECT, where the source says so. Distinct from
  -- published_on: a decree published in March can bite in September.
  effective_from date,
  -- When we last read it. The number freshness is computed from.
  observed_at   timestamptz not null default now(),
  language      text not null default 'en',
  -- The crawlable source this came from, when it is one we track.
  source_registry_id uuid references public.source_registry(id) on delete set null,
  -- A short quotation in the ORIGINAL language, so a reader can check us.
  excerpt       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.expat_citations is
  'Sources behind FOR EXPATS content. A citation ledger, not a crawl registry — see source_registry for that.';

create index if not exists expat_citations_observed_idx on public.expat_citations (observed_at desc);
create index if not exists expat_citations_official_idx on public.expat_citations (official) where official;

/* ────────────────────────────────────────────────────────────────────────
 * TOPICS
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_topics (
  id          uuid primary key default gen_random_uuid(),
  -- The URL segment. Stable for ever once published: it is what search
  -- engines and a customer's bookmark both hold.
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country     text not null default 'GE',
  -- MOVE, RESIDENCY, LEGAL, TAX, BANKING, PROPERTY, COST_OF_LIVING,
  -- HEALTHCARE, FAMILY, TRANSPORT, BUSINESS, DAILY_LIFE.
  domain      text not null,
  -- Which of the four pathways this belongs under, for navigation.
  pathway     text check (pathway in ('MOVE', 'LIVE', 'BUY', 'INVEST')),
  -- { "en": {...}, "ka": {...}, ... }. English is required; a topic that
  -- exists only in a language most of its readers cannot read is not
  -- published content, it is a draft.
  content     jsonb not null default '{}'::jsonb
                check (jsonb_typeof(content) = 'object'),
  -- How fast this ages. Drives review_due_at and the staleness banner.
  fact_class  text not null default 'GENERAL'
                check (fact_class in ('LEGAL','FEE','DEADLINE','PROCESS','PRICE','MARKET','GENERAL')),
  -- Highest authority register any of its facts reaches.
  register    text not null default 'PRACTICAL_CONTEXT'
                check (register in ('OFFICIAL_REQUIREMENT','PRACTICAL_CONTEXT','COMMUNITY_EXPERIENCE','HOMATCH_ANALYSIS')),
  -- Ordering within a domain. Lower first.
  sort_order  integer not null default 100,
  published   boolean not null default false,
  -- An editor or the change detector flagged this for a human.
  needs_review boolean not null default false,
  review_reason text,
  last_verified_at timestamptz,
  review_due_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A published topic must be readable in English and must have been
  -- verified by somebody. The constraint is the publish gate: there is no
  -- code path that can put unverified content in front of a customer,
  -- because the database refuses the row.
  constraint expat_topics_publishable check (
    not published
    or (content ? 'en' and last_verified_at is not null)
  )
);

comment on table public.expat_topics is
  'Structured FOR EXPATS knowledge. Content is per-locale JSONB; changing facts live in expat_topic_facts with their own sources.';

create index if not exists expat_topics_domain_idx on public.expat_topics (country, domain, sort_order);
create index if not exists expat_topics_published_idx on public.expat_topics (published) where published;
create index if not exists expat_topics_review_idx on public.expat_topics (review_due_at) where needs_review or review_due_at is not null;

/* ────────────────────────────────────────────────────────────────────────
 * FACTS
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_topic_facts (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references public.expat_topics(id) on delete cascade,
  -- Stable within the topic, so the UI can place a specific fact.
  fact_key    text not null,
  fact_class  text not null default 'GENERAL'
                check (fact_class in ('LEGAL','FEE','DEADLINE','PROCESS','PRICE','MARKET','GENERAL')),
  register    text not null
                check (register in ('OFFICIAL_REQUIREMENT','PRACTICAL_CONTEXT','COMMUNITY_EXPERIENCE','HOMATCH_ANALYSIS')),
  -- ESTABLISHED, ESTABLISHED_NEGATIVE, UNKNOWN, COVERAGE_GAP, STALE.
  -- The three non-established values are how the product says "we do not
  -- know" without saying "no".
  availability text not null default 'ESTABLISHED'
                check (availability in ('ESTABLISHED','ESTABLISHED_NEGATIVE','UNKNOWN','COVERAGE_GAP','STALE')),
  -- The statement, per locale: { "en": "...", "ka": "..." }.
  statement   jsonb not null default '{}'::jsonb,
  -- Structured value where the fact is a number: { amount, currency, unit }.
  value       jsonb,
  -- ISO 3166-1 alpha-2 codes, or null for "everyone". Never an empty array:
  -- that reads as "nobody" and is always a slip for null.
  applies_to_nationalities text[]
                check (applies_to_nationalities is null or cardinality(applies_to_nationalities) > 0),
  needs_review boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (topic_id, fact_key),
  -- A fact that claims something about the world must be able to say who
  -- says so. Enforced below by a trigger, because it is a statement about
  -- a JOIN and no CHECK can see one.
  constraint expat_topic_facts_statement_object check (jsonb_typeof(statement) = 'object')
);

create table if not exists public.expat_fact_citations (
  fact_id     uuid not null references public.expat_topic_facts(id) on delete cascade,
  citation_id uuid not null references public.expat_citations(id) on delete restrict,
  primary key (fact_id, citation_id)
);

create index if not exists expat_topic_facts_topic_idx on public.expat_topic_facts (topic_id);

/*
 * THE RULE THAT CANNOT BE WRITTEN AS A CHECK.
 *
 * A fact that states something about the world — ESTABLISHED or
 * ESTABLISHED_NEGATIVE — must have at least one citation. UNKNOWN and
 * COVERAGE_GAP may have none, because they are statements about our
 * knowledge rather than about Georgia.
 *
 * This is the database half of the guarantee the TypeScript makes in
 * src/expats/types.ts. Two halves, because the edge functions and any
 * future admin tool write here directly and a guarantee that lives only in
 * one client is not a guarantee.
 *
 * It fires on the CITATION table too, so removing the last citation from a
 * published claim is refused rather than quietly leaving an unsourced
 * assertion behind.
 *
 * DEFERRED, on purpose. A fact and its citation are two INSERTs and either
 * can come first; checking at statement time would make the order matter
 * and would reject a perfectly good transaction halfway through. Deferring
 * to COMMIT means the rule is about the state the transaction leaves
 * behind, which is the thing actually worth constraining.
 *
 * WHY THE BRANCHING IS `if` AND NOT A `case` EXPRESSION
 *
 * It was a CASE, and it aborted every insert with `record "old" has no
 * field "fact_id"`. PL/pgSQL resolves record field references when it
 * evaluates the expression, not only when a branch is taken, so naming
 * old.fact_id anywhere in an expression that runs on INSERT is fatal even
 * though that branch is dead. `if` keeps each reference inside the path
 * that actually executes.
 */
create or replace function public.expat_fact_requires_citation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fact_id uuid;
  v_availability text;
  v_count int;
begin
  if tg_table_name = 'expat_fact_citations' then
    if tg_op = 'DELETE' then
      v_fact_id := old.fact_id;
    else
      v_fact_id := new.fact_id;
    end if;
  else
    v_fact_id := new.id;
  end if;

  select availability into v_availability
  from public.expat_topic_facts where id = v_fact_id;

  -- The fact itself is going away; there is nothing left to protect.
  if v_availability is null then
    return null;
  end if;

  if v_availability not in ('ESTABLISHED', 'ESTABLISHED_NEGATIVE') then
    return null;
  end if;

  select count(*) into v_count
  from public.expat_fact_citations where fact_id = v_fact_id;

  if v_count = 0 then
    raise exception
      'a fact stated as %, about the world, needs at least one citation', v_availability
      using errcode = 'check_violation';
  end if;

  -- An AFTER trigger's return value is discarded; null is the honest one.
  return null;
end;
$$;

drop trigger if exists expat_fact_citation_required on public.expat_topic_facts;
create constraint trigger expat_fact_citation_required
  after insert or update on public.expat_topic_facts
  deferrable initially deferred
  for each row execute function public.expat_fact_requires_citation();

drop trigger if exists expat_fact_citation_required_on_unlink on public.expat_fact_citations;
create constraint trigger expat_fact_citation_required_on_unlink
  after delete on public.expat_fact_citations
  deferrable initially deferred
  for each row execute function public.expat_fact_requires_citation();

/* ────────────────────────────────────────────────────────────────────────
 * COST OF LIVING OBSERVATIONS
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_cost_observations (
  id          uuid primary key default gen_random_uuid(),
  country     text not null default 'GE',
  city        text not null,
  district    text,
  -- Matches src/expats/costOfLiving.ts COST_CATEGORIES.
  category    text not null,
  -- A RANGE, always. low = high is allowed for a published official tariff,
  -- which genuinely is one number; everything observed in a market is not.
  low         numeric(14,2) not null check (low >= 0),
  high        numeric(14,2) not null check (high >= 0),
  currency    text not null default 'GEL',
  unit        text not null default 'PER_MONTH'
                check (unit in ('PER_MONTH','PER_YEAR','ONE_OFF','PER_SQM','PER_VISIT','PER_ITEM')),
  -- How many independent observations, and from how many sources. Both,
  -- because "12 prices from 1 shop" and "12 prices from 12 shops" are
  -- different evidence and a single count hides which one this is.
  sample_size integer not null default 1 check (sample_size >= 1),
  source_count integer not null default 1 check (source_count >= 1),
  observed_at timestamptz not null default now(),
  citation_id uuid references public.expat_citations(id) on delete restrict,
  -- Superseded rather than overwritten, so "what did we think last quarter"
  -- stays answerable and a price change is visible as a change.
  status      text not null default 'CURRENT' check (status in ('CURRENT','SUPERSEDED')),
  notes       text,
  created_at  timestamptz not null default now(),
  check (high >= low)
);

-- One current observation per (city, district, category, unit).
create unique index if not exists expat_cost_current_uidx
  on public.expat_cost_observations (country, city, coalesce(district,''), category, unit)
  where status = 'CURRENT';

create index if not exists expat_cost_lookup_idx
  on public.expat_cost_observations (country, city, category) where status = 'CURRENT';

/* ────────────────────────────────────────────────────────────────────────
 * PLACES AND PROVIDERS
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_places (
  id          uuid primary key default gen_random_uuid(),
  country     text not null default 'GE',
  city        text not null,
  district    text,
  -- RESTAURANT, CAFE, GYM, COWORKING, SUPERMARKET, CLINIC, PHARMACY,
  -- SCHOOL, BANK, INSURER, ACCOUNTANT, LAWYER, TRANSLATOR, NOTARY,
  -- VET, CAR_SERVICE, OTHER.
  category    text not null,
  name        text not null check (length(btrim(name)) > 0),
  address     text,
  lat         numeric(9,6),
  lon         numeric(9,6),
  website     text,
  phone       text,
  -- Languages the place itself states it serves in. Never inferred.
  languages   text[],
  -- A published price band, when one was published. Null is UNKNOWN and
  -- must render as unknown, never as free and never as a guess.
  price_low   numeric(14,2),
  price_high  numeric(14,2),
  price_currency text,
  -- Ratings stay per-platform in expat_place_ratings. There is no
  -- aggregate column here on purpose: a single number would be shown
  -- everywhere and the evidence nowhere.
  citation_id uuid references public.expat_citations(id) on delete set null,
  observed_at timestamptz not null default now(),
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (price_high is null or price_low is null or price_high >= price_low),
  check ((price_low is null and price_high is null) or price_currency is not null)
);

create index if not exists expat_places_lookup_idx
  on public.expat_places (country, city, category) where published;

create table if not exists public.expat_place_ratings (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.expat_places(id) on delete cascade,
  -- The platform, on ITS OWN scale. Normalising to a common 0-5 here would
  -- lose the fact that two platforms' 4.2 are different measurements.
  publisher   text not null,
  value       numeric(4,2) not null check (value >= 0),
  out_of      numeric(4,2) not null check (out_of > 0),
  review_count integer not null default 0 check (review_count >= 0),
  observed_at timestamptz not null default now(),
  citation_id uuid references public.expat_citations(id) on delete set null,
  unique (place_id, publisher),
  check (value <= out_of)
);

/* ────────────────────────────────────────────────────────────────────────
 * THE PLAN
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_profiles (
  -- One plan per person. The primary key IS the user, which makes a second
  -- plan impossible rather than merely discouraged.
  user_id     uuid primary key references public.users(id) on delete cascade,
  intents     text[] not null default '{}',
  nationality text check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  current_country text,
  household   text check (household is null or household in ('ALONE','COUPLE','FAMILY')),
  children_count integer check (children_count is null or children_count >= 0),
  pets        boolean,
  arrival_date date,
  intended_stay_months integer check (intended_stay_months is null or intended_stay_months > 0),
  city        text,
  work_status text check (work_status is null or work_status in
                ('REMOTE','EMPLOYED_LOCALLY','BUSINESS_OWNER','STUDENT','RETIRED','NOT_WORKING')),
  housing_plan text check (housing_plan is null or housing_plan in ('RENT','BUY','ALREADY_OWN','UNDECIDED')),
  already_owns_property boolean,
  has_vehicle boolean,
  home_currency text,
  -- Reminder settings live with the plan rather than in a second table:
  -- they are four values and they are never queried without it.
  reminders_enabled boolean not null default true,
  reminder_channels text[] not null default '{IN_APP,PUSH}',
  reminder_lead_days integer[] not null default '{30,7,1}',
  reminder_max_per_day integer not null default 3 check (reminder_max_per_day between 0 and 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.expat_profiles is
  'Sensitive: citizenship, family shape, travel intent. Readable only by its owner. Never exposed publicly (brief §78).';

create table if not exists public.expat_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  -- The catalogue key from src/expats/plan/roadmap.ts, or null for a task
  -- the person wrote themselves.
  template_key text,
  category    text not null,
  stage       text not null check (stage in
                ('PREPARE','ARRIVAL','FIRST_WEEK','FIRST_30','FIRST_90','SETTLE','LONG_TERM','RENEWALS')),
  -- i18n keys for catalogue tasks; free text for the person's own.
  title_key   text,
  why_key     text,
  custom_title text,
  topic_slug  text,
  handoff     text check (handoff is null or handoff in ('VERIFY','MORTGAGE','INVESTMENT','CONTRACTS','PROPERTY')),
  -- Template keys, not row ids: a dependency survives the plan being
  -- regenerated, and a row id would not.
  depends_on  text[] not null default '{}',
  status      text not null default 'NOT_STARTED'
                check (status in ('NOT_STARTED','IN_PROGRESS','WAITING','DONE','NOT_APPLICABLE')),
  due_date    date,
  -- SUGGESTED is ours. OFFICIAL means an authority set this date and a
  -- sourced fact says so. USER means they set it. The three must never be
  -- rendered with the same words (brief §45).
  deadline_basis text not null default 'SUGGESTED'
                check (deadline_basis in ('SUGGESTED','OFFICIAL','USER')),
  -- The fact that establishes an OFFICIAL date. Required for one, below.
  deadline_fact_id uuid references public.expat_topic_facts(id) on delete set null,
  completed_at timestamptz,
  notes       text,
  sort_order  integer not null default 0,
  recurs_every_months integer check (recurs_every_months is null or recurs_every_months > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One row per catalogue task per person. Regenerating a plan updates
  -- rather than duplicating, so a completion is never lost to a re-run.
  unique (user_id, template_key),
  -- A completion timestamp exists if and only if the task is done.
  constraint expat_tasks_completion_coherent check (
    (status = 'DONE') = (completed_at is not null)
  ),
  -- Calling a date official requires the fact that makes it official.
  constraint expat_tasks_official_needs_source check (
    deadline_basis <> 'OFFICIAL' or deadline_fact_id is not null
  ),
  -- A task has a name of some kind.
  constraint expat_tasks_named check (title_key is not null or custom_title is not null)
);

create index if not exists expat_tasks_user_idx on public.expat_tasks (user_id, stage, sort_order);
create index if not exists expat_tasks_due_idx on public.expat_tasks (due_date)
  where status not in ('DONE','NOT_APPLICABLE') and due_date is not null;

/*
 * WHAT HAS ALREADY BEEN SENT.
 *
 * The only persisted part of the reminder system. Reminders themselves are
 * derived from the tasks on every tick (see src/expats/plan/reminders.ts),
 * so moving a date moves every reminder for free. What cannot be derived is
 * whether we already told somebody, and that is a fact about the past, so
 * it is the thing written down.
 */
create table if not exists public.expat_reminder_log (
  user_id     uuid not null references public.users(id) on delete cascade,
  -- expat_task:<task id>:<due date>:<lead days>. Also the notify_emit
  -- dedupe key, so the two layers agree on what "the same reminder" means.
  dedupe_key  text not null,
  task_id     uuid references public.expat_tasks(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  notification_id uuid,
  primary key (user_id, dedupe_key)
);

create index if not exists expat_reminder_log_task_idx on public.expat_reminder_log (task_id);

/* ────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_updates (
  id          uuid primary key default gen_random_uuid(),
  country     text not null default 'GE',
  domain      text not null,
  -- Per-locale, same reasoning as expat_topics.content.
  content     jsonb not null default '{}'::jsonb,
  -- What kind of change. Drives whose plan it is relevant to.
  change_type text not null check (change_type in
                ('RULE_CHANGED','FEE_CHANGED','PROCESS_CHANGED','DEADLINE_CHANGED','NEW_REQUIREMENT','SOURCE_UNAVAILABLE','OTHER')),
  -- Which topic it affects, so "this may affect 2 tasks in your plan" is a
  -- join rather than a guess.
  topic_id    uuid references public.expat_topics(id) on delete set null,
  -- Which plan templates it touches. Same vocabulary as expat_tasks.
  affects_template_keys text[] not null default '{}',
  -- Who it applies to, null for everyone.
  applies_to_nationalities text[]
                check (applies_to_nationalities is null or cardinality(applies_to_nationalities) > 0),
  citation_id uuid references public.expat_citations(id) on delete restrict,
  effective_from date,
  published   boolean not null default false,
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  -- An update that changes a rule must cite the thing that changed it.
  -- A "what changed" feed with unsourced entries is a rumour mill.
  constraint expat_updates_sourced check (
    not published or (citation_id is not null and content ? 'en')
  )
);

create index if not exists expat_updates_feed_idx
  on public.expat_updates (country, published_at desc) where published;

/* ────────────────────────────────────────────────────────────────────────
 * PROVIDER RESEARCH
 * ──────────────────────────────────────────────────────────────────────── */

create table if not exists public.expat_provider_research (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  -- LAWYER, ACCOUNTANT, TRANSLATOR, NOTARY, INSURER, CLINIC, SCHOOL,
  -- RELOCATION, PROPERTY_MANAGER, OTHER.
  provider_category text not null,
  country     text not null default 'GE',
  city        text,
  -- What the person actually asked for, in their own words. Used to score
  -- relevance and shown back to them so the result is legible.
  request     text,
  language_needed text,
  status      text not null default 'QUEUED'
                check (status in ('QUEUED','RUNNING','COMPLETE','FAILED','CANCELLED')),
  -- The honest research outcome, separate from the job's own lifecycle.
  -- A job can COMPLETE and still be a COVERAGE_GAP, and conflating the two
  -- is how a crawler's bad afternoon becomes a verdict on a profession.
  research_status text check (research_status in
                ('LIVE_PROVEN','PARTIAL','BLOCKED','INACCESSIBLE','NO_EVIDENCE','STALE','NEEDS_REVIEW')),
  -- Per-source outcomes, from src/expats/research/coverage.ts.
  coverage    jsonb not null default '{}'::jsonb,
  providers_found integer not null default 0,
  providers_shortlisted integer not null default 0,
  sources_reviewed integer not null default 0,
  -- Set by _shared/billing.ts. Nothing in this table computes money.
  reservation_id uuid,
  allowance_id uuid,
  credits_charged numeric(14,4),
  error       text,
  started_at  timestamptz,
  completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expat_provider_research_user_idx
  on public.expat_provider_research (user_id, created_at desc);

create table if not exists public.expat_research_providers (
  id          uuid primary key default gen_random_uuid(),
  research_id uuid not null references public.expat_provider_research(id) on delete cascade,
  name        text not null,
  website     text,
  phone       text,
  email       text,
  address     text,
  languages   text[],
  -- The assessment from src/expats/research/reputation.ts, stored whole:
  -- support counts, per-platform ratings, limitations. Stored rather than
  -- recomputed because the evidence it rests on is a snapshot of one day
  -- and recomputing it later against different evidence would silently
  -- change a result the customer has already read.
  assessment  jsonb not null default '{}'::jsonb,
  -- The evidence itself, preserved (brief §39). This is what the drawer
  -- shows and what makes the conclusion checkable.
  evidence    jsonb not null default '[]'::jsonb,
  shortlisted boolean not null default false,
  rank        integer,
  -- Paid placement. Recorded so paid and organic can be told apart in
  -- reporting, and deliberately NOT an input to rank: see
  -- src/expats/research/reputation.ts, RankingInputs, which cannot receive it.
  sponsored   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists expat_research_providers_research_idx
  on public.expat_research_providers (research_id, rank);

create table if not exists public.expat_outbound_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  provider_row_id uuid references public.expat_research_providers(id) on delete set null,
  place_id    uuid references public.expat_places(id) on delete set null,
  research_id uuid references public.expat_provider_research(id) on delete set null,
  action      text not null check (action in
                ('PROVIDER_VIEWED','PROVIDER_OPENED','WEBSITE_OPENED','PHONE_REVEALED',
                 'EMAIL_REVEALED','WHATSAPP_OPENED','DIRECTIONS_OPENED','ENQUIRY_SUBMITTED')),
  -- Derived from the action by src/expats/research/attribution.ts and
  -- constrained here to the four Homatch can actually observe. BOOKED and
  -- CONVERTED are absent from this CHECK on purpose: no process confirms
  -- them, so no row may claim them (brief §55).
  stage       text not null check (stage in ('VIEW','CLICK','CONTACT_INTENT','LEAD_SUBMITTED')),
  sponsored   boolean not null default false,
  occurred_at timestamptz not null default now()
);

create index if not exists expat_outbound_events_provider_idx
  on public.expat_outbound_events (provider_row_id, occurred_at desc);
create index if not exists expat_outbound_events_stage_idx
  on public.expat_outbound_events (stage, occurred_at desc);

/* ────────────────────────────────────────────────────────────────────────
 * ROW LEVEL SECURITY
 *
 * Three shapes, and every table is exactly one of them.
 *
 *   PUBLISHED CONTENT  anyone, signed in or not, may read the published
 *                      rows. Nothing may write but service_role and an
 *                      admin. This is the free layer §66 asks for.
 *   PRIVATE TO OWNER   the plan, the profile, the research, the reminder
 *                      log. Readable and writable only by the person it
 *                      belongs to. Never public, never cross-user (§78).
 *   WRITE ONLY BY US   the outbound funnel. A person may insert their own
 *                      events and may not read anybody's, including their
 *                      own, because there is no product reason to and a
 *                      readable funnel is an analytics export.
 * ──────────────────────────────────────────────────────────────────────── */

alter table public.expat_citations          enable row level security;
alter table public.expat_topics             enable row level security;
alter table public.expat_topic_facts        enable row level security;
alter table public.expat_fact_citations     enable row level security;
alter table public.expat_cost_observations  enable row level security;
alter table public.expat_places             enable row level security;
alter table public.expat_place_ratings      enable row level security;
alter table public.expat_profiles           enable row level security;
alter table public.expat_tasks              enable row level security;
alter table public.expat_reminder_log       enable row level security;
alter table public.expat_updates            enable row level security;
alter table public.expat_provider_research  enable row level security;
alter table public.expat_research_providers enable row level security;
alter table public.expat_outbound_events    enable row level security;

/* ── Published content: world-readable, admin-writable ────────────────── */

do $$
declare t text;
begin
  foreach t in array array[
    'expat_citations','expat_topics','expat_topic_facts','expat_fact_citations',
    'expat_cost_observations','expat_places','expat_place_ratings','expat_updates'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_all', t);
  end loop;
end $$;

-- Only PUBLISHED rows leave the database for a reader. A draft topic is not
-- "hidden by the UI"; it is not selectable.
create policy expat_topics_public_read on public.expat_topics
  for select to anon, authenticated using (published);
create policy expat_updates_public_read on public.expat_updates
  for select to anon, authenticated using (published);
create policy expat_places_public_read on public.expat_places
  for select to anon, authenticated using (published);

-- Facts, citations and ratings are readable only through a published
-- parent. A citation is harmless on its own; a fact attached to an
-- unpublished topic is unreviewed content and stays unreadable.
create policy expat_topic_facts_public_read on public.expat_topic_facts
  for select to anon, authenticated
  using (exists (select 1 from public.expat_topics t where t.id = topic_id and t.published));
create policy expat_fact_citations_public_read on public.expat_fact_citations
  for select to anon, authenticated
  using (exists (
    select 1 from public.expat_topic_facts f
    join public.expat_topics t on t.id = f.topic_id
    where f.id = fact_id and t.published));
create policy expat_place_ratings_public_read on public.expat_place_ratings
  for select to anon, authenticated
  using (exists (select 1 from public.expat_places p where p.id = place_id and p.published));
create policy expat_citations_public_read on public.expat_citations
  for select to anon, authenticated using (true);
create policy expat_cost_observations_public_read on public.expat_cost_observations
  for select to anon, authenticated using (status = 'CURRENT');

do $$
declare t text;
begin
  foreach t in array array[
    'expat_citations','expat_topics','expat_topic_facts','expat_fact_citations',
    'expat_cost_observations','expat_places','expat_place_ratings','expat_updates'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_all', t);
  end loop;
end $$;

/* ── Private to the owner ─────────────────────────────────────────────── */

create policy expat_profiles_own on public.expat_profiles
  for all to authenticated
  using (user_id = (select public.auth_user_id()))
  with check (user_id = (select public.auth_user_id()));
create policy expat_profiles_service on public.expat_profiles
  for all to service_role using (true) with check (true);

create policy expat_tasks_own on public.expat_tasks
  for all to authenticated
  using (user_id = (select public.auth_user_id()))
  with check (user_id = (select public.auth_user_id()));
create policy expat_tasks_service on public.expat_tasks
  for all to service_role using (true) with check (true);

-- Readable by its owner so the UI can show "reminded on the 3rd", and
-- writable only by the tick: a person cannot mark a reminder as sent and
-- thereby suppress one they were about to receive.
create policy expat_reminder_log_own_read on public.expat_reminder_log
  for select to authenticated using (user_id = (select public.auth_user_id()));
create policy expat_reminder_log_service on public.expat_reminder_log
  for all to service_role using (true) with check (true);

create policy expat_provider_research_own on public.expat_provider_research
  for select to authenticated using (user_id = (select public.auth_user_id()));
-- A customer may ASK for research. They may not write its status, its
-- coverage or its charge: those are the worker's, through service_role.
create policy expat_provider_research_own_insert on public.expat_provider_research
  for insert to authenticated with check (user_id = (select public.auth_user_id()));
create policy expat_provider_research_service on public.expat_provider_research
  for all to service_role using (true) with check (true);

create policy expat_research_providers_own_read on public.expat_research_providers
  for select to authenticated
  using (exists (
    select 1 from public.expat_provider_research r
    where r.id = research_id and r.user_id = (select public.auth_user_id())));
create policy expat_research_providers_service on public.expat_research_providers
  for all to service_role using (true) with check (true);

/* ── Write-only funnel ────────────────────────────────────────────────── */

-- Insert your own, read nothing. Reporting runs as service_role.
create policy expat_outbound_events_own_insert on public.expat_outbound_events
  for insert to authenticated
  with check (user_id is null or user_id = (select public.auth_user_id()));
create policy expat_outbound_events_anon_insert on public.expat_outbound_events
  for insert to anon with check (user_id is null);
create policy expat_outbound_events_admin_read on public.expat_outbound_events
  for select to authenticated using (public.is_admin());
create policy expat_outbound_events_service on public.expat_outbound_events
  for all to service_role using (true) with check (true);

/* ────────────────────────────────────────────────────────────────────────
 * THE PUBLIC MARKET READING
 *
 * market_snapshots is not readable by anon, and its columns include job
 * ids, content hashes and supersession bookkeeping that no customer needs.
 * Rather than loosen that table's policies — it belongs to Verify — this
 * function returns the handful of fields a market reading actually
 * consists of, for CURRENT rows only.
 *
 * security definer with a pinned empty search_path, and the only parameter
 * is a country/city pair used in an equality test, so there is no injection
 * surface and nothing user-controlled reaches a dynamic statement.
 * ──────────────────────────────────────────────────────────────────────── */

create or replace function public.expat_market_readings(p_city text)
returns table (
  scope_type text,
  scope_key text,
  property_type text,
  room_band text,
  city text,
  district text,
  currency text,
  median_price_per_sqm numeric,
  lower_price_per_sqm numeric,
  upper_price_per_sqm numeric,
  sample_count integer,
  usable_comparable_count integer,
  source_count integer,
  confidence text,
  basis_tier text,
  last_refreshed_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    s.scope_type::text,
    s.scope_key,
    s.property_type::text,
    s.room_band::text,
    s.city,
    s.district,
    s.currency::text,
    s.median_price_per_sqm,
    s.lower_price_per_sqm,
    s.upper_price_per_sqm,
    s.sample_count,
    s.usable_comparable_count,
    s.source_count,
    s.confidence::text,
    s.basis_tier::text,
    s.last_refreshed_at
  from public.market_snapshots s
  where s.status = 'CURRENT'
    and s.city is not null
    and (p_city is null or s.city = p_city)
$$;

revoke all on function public.expat_market_readings(text) from public;
grant execute on function public.expat_market_readings(text) to anon, authenticated, service_role;

comment on function public.expat_market_readings(text) is
  'Public, field-limited view of CURRENT market snapshots for FOR EXPATS. Deliberately omits job ids, content hashes and supersession state.';
