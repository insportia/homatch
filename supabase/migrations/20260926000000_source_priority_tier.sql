-- WHICH SOURCES ACTUALLY MATTER, recorded where the sources already live.
--
-- source_registry.priority already exists and is NOT this. It carries a
-- legacy scan-ordering scale -- observed values 1, 3, 5, 75, 80, most of them
-- on Reddit subreddits -- and repurposing it would silently change whatever
-- still reads it. So this is a second, explicitly-named column on the SAME
-- table rather than a parallel registry.
--
-- The tier is a business judgement about market importance, not a technical
-- one: a source can be P0 and unreadable (myhome.ge), or P3 and productive.
-- Keeping the two axes separate is the point -- lifecycle says what we can
-- read, priority_tier says what we should want to read, and the gap between
-- them is the coverage question worth reporting.
--
-- P0 CRITICAL     a market's primary portal; its absence is a hole in coverage
-- P1 HIGH         major portal, real inventory share
-- P2 SECONDARY    agency sites, developer sites, long tail with real listings
-- P3 EXPERIMENTAL discovery candidates, unproven value

alter table public.source_registry
  add column if not exists priority_tier smallint,
  add column if not exists priority_rationale text;

comment on column public.source_registry.priority_tier is
  'Business priority: 0=P0 critical, 1=P1 high, 2=P2 secondary, 3=P3 experimental. Independent of lifecycle, which says what we can read rather than what we want.';
comment on column public.source_registry.priority_rationale is
  'Why this tier, in a sentence, with the evidence date. A tier assigned without a reason is a guess with a number on it.';

alter table public.source_registry
  add constraint source_registry_priority_tier_range
  check (priority_tier is null or priority_tier between 0 and 3);

-- Partial: the tiered sources are the few that matter, not the 314 discovered.
create index if not exists source_registry_priority_tier_idx
  on public.source_registry (priority_tier)
  where priority_tier is not null;
