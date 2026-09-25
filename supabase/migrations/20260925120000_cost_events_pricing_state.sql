-- HOMATCH — a provider cost nobody knows is not a provider cost of zero.
--
-- WHAT PRODUCTION ACTUALLY SHOWS
--
-- 602 of 925 cost_events carry cost_usd = 0. Some of those are honest: a
-- cache hit costs nothing, and a call that failed before anything billable
-- ran costs nothing. Most are not:
--
--   DATAFORSEO / SERP_SEARCH        275 events, 248 zero,
--                                   227 of them successful AND uncached,
--                                   while the same operation's
--                                   maximum recorded cost is $0.026
--   APIFY / QUEUE_THREADS            32 events, 32 zero, max cost 0
--   APIFY / SOURCE_MONITOR_PUBLIC    15 events, 15 zero
--   OPENAI / VERIFY_OFFICIAL         18 events, 18 zero
--
-- The cause is in the writers. apify-discover inserts four operations with a
-- literal `cost_usd: 0`, regardless of what Apify charged; the discovery
-- worker does the same on its failure path. The correct pattern already
-- exists twelve lines away in that same worker:
--
--   execution.costUsd > 0 ? execution.costUsd : job.estimated_cost_usd
--
-- actual when known, configured estimate otherwise. Never a silent zero.
--
-- WHY A COLUMN AND NOT JUST A CODE FIX
--
-- Because for these providers there is no estimate to fall back to either:
-- provider_price_book has rows for OPENAI, CARTESIA, ELEVENLABS, GOOGLE,
-- RAILWAY and SUPABASE, and NONE for APIFY or DATAFORSEO. So the truthful
-- answer for an Apify discovery call today is neither an amount nor zero --
-- it is "we do not know what this cost", and the schema had no way to say so.
--
-- cost_usd stays NOT NULL, because every existing reader sums it and a null
-- would silently poison those sums. The number carries the best available
-- figure; pricing_state carries how much that figure is worth.
--
-- WHAT HAPPENS TO THE 602 HISTORICAL ROWS
--
-- Nothing. They keep their recorded amounts and their pricing_state stays
-- NULL, which reads as "recorded before Homatch tracked pricing provenance".
-- Reconstructing what Apify charged in August from rows that never held it
-- would be inventing financial history, and a wrong number asserted with
-- confidence is worse than an honest absence. Analytics can exclude NULL and
-- UNPRICED from margin rather than counting them as free work.

-- ── pricing_state ────────────────────────────────────────────────────────
alter table public.cost_events
  add column if not exists pricing_state text;

comment on column public.cost_events.pricing_state is
  'How much the cost_usd figure beside it is worth. NULL means the row '
  'predates pricing provenance (2026-09-25). See the CHECK for the states.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cost_events_pricing_state_check'
  ) then
    alter table public.cost_events
      add constraint cost_events_pricing_state_check
      check (pricing_state is null or pricing_state in (
        -- The provider told us what it charged.
        'ACTUAL',
        -- No actual figure, but provider_price_book has a rate for it and
        -- cost_usd holds the amount derived from that rate.
        'ESTIMATED',
        -- Neither. cost_usd is a placeholder and must not be read as spend.
        'UNPRICED',
        -- Genuinely free: a cache hit, or a call that failed before anything
        -- billable ran. A real zero, and the only one worth trusting.
        'ZERO_REAL'
      ))
      not valid;
  end if;
end $$;

-- NOT VALID, then validated separately: the check is enforced for every new
-- and updated row immediately, while the 925 existing rows are not scanned
-- under an ACCESS EXCLUSIVE lock. They all satisfy it anyway -- pricing_state
-- is NULL on every one of them -- so the validation below is a formality that
-- takes only a SHARE UPDATE EXCLUSIVE lock and does not block writers.
alter table public.cost_events
  validate constraint cost_events_pricing_state_check;

-- Analytics asks two questions of this column: "what did we actually spend"
-- and "how much of our cost base is unknown". Both filter on the state, and
-- both are per-provider.
create index if not exists idx_cost_events_pricing_state
  on public.cost_events (pricing_state, provider)
  where pricing_state is not null;

-- ── the estimate, from the existing price book ───────────────────────────
--
-- Reuses provider_price_book rather than introducing a second pricing source.
-- Returns NULL when the provider/unit has no active rate, which is what makes
-- UNPRICED distinguishable from ESTIMATED at the call site instead of being
-- guessed at.
create or replace function public.provider_estimated_cost_usd(
  p_provider text,
  p_unit text,
  p_units numeric,
  p_model text default null,
  p_at timestamptz default now()
)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select round(pb.rate * (coalesce(p_units, 0) / nullif(pb.per_units, 0)), 6)
    from public.provider_price_book pb
   where upper(pb.provider) = upper(p_provider)
     and upper(pb.unit) = upper(p_unit)
     and (p_model is null or pb.model is null or pb.model = p_model)
     and pb.effective_from <= p_at
     and (pb.effective_to is null or pb.effective_to > p_at)
   order by pb.model nulls last, pb.effective_from desc
   limit 1
$$;

comment on function public.provider_estimated_cost_usd is
  'The configured cost of a provider operation, or NULL when the price book '
  'has no active rate for it. NULL is the signal for UNPRICED -- never 0.';

revoke all on function public.provider_estimated_cost_usd(text, text, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.provider_estimated_cost_usd(text, text, numeric, text, timestamptz) to service_role;
