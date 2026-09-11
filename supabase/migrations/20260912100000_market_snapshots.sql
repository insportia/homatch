/* ══════════════════════════════════════════════════════════════════════
 * A MARKET IS A PLACE, NOT A PROPERTY
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every verification bought the same knowledge again. The market stage swept
 * five bands of listings, the deterministic layer turned them into a median
 * and a range, the report quoted it, and all of it was discarded. The next
 * flat in the same building started from zero and paid for the same sweep —
 * and that sweep is 45% of what a Verify costs, most of it web search at about
 * $0.04 a call.
 *
 * "What do flats cost in this project" is not a fact about one flat. It is a
 * fact about a market segment, true for every flat in it until the market
 * moves.
 *
 * WHY A TABLE RATHER THAN intelligence_facts. That table holds one current
 * value per (entity, fact_key). A snapshot is an aggregate over many listings
 * carrying a sample count, a spread, a source count and a confidence, keyed by
 * a SEGMENT which is not an entity at all. Forcing it into the graph would
 * flatten the structure that makes it trustworthy, and the one-value-per-key
 * rule would silently drop the spread.
 *
 * The segment key is deliberately four dimensions and not twelve. Every extra
 * dimension divides the pool of properties that can share an answer, and a
 * segment nobody else lands in saves nothing.
 *
 * Versioned by supersession rather than mutation: a refreshed snapshot is a
 * new row and the old one is marked SUPERSEDED, so "what did we believe this
 * market was last week, and why did it change" stays answerable. The same
 * shape intelligence_facts already uses.
 */

create table if not exists public.market_snapshots (
  id            uuid primary key default gen_random_uuid(),

  /* ── the segment ─────────────────────────────────────────────────── */
  scope_type    text not null check (scope_type in ('PROJECT','MICRO_LOCATION','DISTRICT','CITY')),
  scope_key     text not null,
  property_type text not null default 'RESIDENTIAL',
  room_band     text not null default 'UNKNOWN' check (room_band in ('1','2','3','4_PLUS','UNKNOWN')),
  segment_key   text not null,

  country        text not null default 'GE',
  city           text,
  district       text,
  micro_location text,
  project_entity_id uuid references public.intelligence_entities(id) on delete set null,

  /* ── what the market looks like ──────────────────────────────────── */
  currency             text not null default 'USD',
  median_price_per_sqm numeric not null check (median_price_per_sqm > 0),
  lower_price_per_sqm  numeric check (lower_price_per_sqm is null or lower_price_per_sqm > 0),
  upper_price_per_sqm  numeric check (upper_price_per_sqm is null or upper_price_per_sqm > 0),

  /* ── how much it can be leaned on ────────────────────────────────── */
  sample_count            int not null default 0 check (sample_count >= 0),
  usable_comparable_count int not null default 0 check (usable_comparable_count >= 0),
  source_count            int not null default 1 check (source_count >= 1),
  basis_tier              text,
  confidence              text not null check (confidence in ('HIGH','MEDIUM','LOW')),

  /* ── provenance and age ──────────────────────────────────────────── */
  built_by_job_id   uuid references public.research_jobs(id) on delete set null,
  refresh_reason    text not null default 'INITIAL',
  built_at          timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),

  status        text not null default 'CURRENT' check (status in ('CURRENT','SUPERSEDED')),
  superseded_by uuid references public.market_snapshots(id) on delete set null,
  content_hash  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint snapshot_band_is_ordered check (
    lower_price_per_sqm is null or upper_price_per_sqm is null
    or upper_price_per_sqm >= lower_price_per_sqm
  ),
  constraint snapshot_key_not_blank check (length(btrim(segment_key)) > 0)
);

/* One current snapshot per segment. A refresh supersedes rather than
 * overwrites, so history survives and the read path never has to choose
 * between two live answers for one market. */
create unique index if not exists market_snapshots_one_current
  on public.market_snapshots (segment_key)
  where status = 'CURRENT';

create index if not exists market_snapshots_lookup
  on public.market_snapshots (segment_key, status, last_refreshed_at desc);

create index if not exists market_snapshots_project
  on public.market_snapshots (project_entity_id) where project_entity_id is not null;

comment on table public.market_snapshots is
  'Reusable market intelligence for a segment (scope + property type + room band). Built only from comparables that were actually gathered; a thin one says so through its confidence rather than pretending. Never a cache of asking prices - listing price and status stay volatile and refresh on their own clock.';

comment on column public.market_snapshots.segment_key is
  'scope_type|scope_key|property_type|room_band. Four dimensions on purpose: every extra one divides the pool of properties that can share an answer.';

comment on column public.market_snapshots.confidence is
  'HIGH needs 5+ usable comparables from a narrow band and 2+ sources. Three levels rather than a percentage, because the decision it feeds is three-way and a number would imply precision this evidence does not have.';

alter table public.market_snapshots enable row level security;
alter table public.market_snapshots force row level security;

drop policy if exists market_snapshots_service_all on public.market_snapshots;
create policy market_snapshots_service_all
  on public.market_snapshots for all to service_role using (true) with check (true);

drop policy if exists market_snapshots_admin_read on public.market_snapshots;
create policy market_snapshots_admin_read
  on public.market_snapshots for select to authenticated using (true);

revoke all on public.market_snapshots from anon;
grant select on public.market_snapshots to authenticated;
grant all on public.market_snapshots to service_role;

/* Was a refresh worth buying?
 *
 * Spending money per search to add zero usable comparables and move confidence
 * nowhere is a pattern worth finding and stopping. This makes it visible
 * without anyone having to instrument a report by hand. */
create or replace view public.market_refresh_roi as
select
  s.segment_key,
  s.scope_type,
  s.refresh_reason,
  s.built_at,
  s.confidence,
  s.usable_comparable_count,
  prev.confidence              as previous_confidence,
  prev.usable_comparable_count as previous_usable,
  s.usable_comparable_count - coalesce(prev.usable_comparable_count, 0) as usable_gained,
  s.built_by_job_id,
  (select round(sum(c.model_cost_usd + c.search_cost_usd), 6)
     from public.verify_stage_cogs c
    where c.job_id = s.built_by_job_id and c.stage = 'market') as market_cogs_usd,
  (select c.web_searches from public.verify_stage_cogs c
    where c.job_id = s.built_by_job_id and c.stage = 'market') as market_searches
from public.market_snapshots s
left join public.market_snapshots prev on prev.id = (
  select p.id from public.market_snapshots p
   where p.segment_key = s.segment_key and p.built_at < s.built_at
   order by p.built_at desc limit 1
);

comment on view public.market_refresh_roi is
  'What each market refresh cost and what it bought. A row showing money spent for zero usable comparables and no confidence gain is waste, and should eventually stop happening.';

revoke all on public.market_refresh_roi from anon, authenticated;
grant select on public.market_refresh_roi to service_role;
