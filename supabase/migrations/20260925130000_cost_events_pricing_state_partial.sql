-- HOMATCH — the fifth state: a cost that is real, and incomplete.
--
-- 20260925120000 added pricing_state with four states, written against the
-- discovery providers. Wiring it to the writer that is actually still running
-- -- research-agent, pricing Verify stages from provider_price_book -- turned
-- up a case those four cannot say.
--
-- src/verify/cogs.ts prices each stage dimension by dimension: fresh input,
-- cached input, output, reasoning, web searches, tool calls. It returns
-- `priced: false` the moment ANY consumed dimension has no rate, and names
-- them in `unpricedUnits`. So a stage can easily be half-answered: tokens
-- priced at the model's rate, web searches not, because WEB_SEARCH_CALL was
-- never entered for that model. The figure that comes out is real money, and
-- it is less than what was actually spent.
--
--   ESTIMATED would assert a total we do not have.
--   UNPRICED would throw away spend we do.
--
-- Neither is true, so neither should be written. PARTIAL says what the number
-- is: a floor. Analytics can sum PARTIAL rows into spend while knowing the
-- result understates, which is a different and much more useful thing than
-- either excluding them or trusting them.
--
-- cogs.ts has carried the concept since it was written -- CogsState is
-- 'PRICED' | 'PARTIALLY_PRICED' | 'UNPRICED' -- for the verification as a
-- whole. This is the same distinction, per row, in the column that readers
-- can actually filter on.
--
-- NOTHING IS BACKFILLED. Every existing row keeps pricing_state NULL, meaning
-- "recorded before Homatch tracked pricing provenance". The historical rows
-- that would qualify are the retired providers' -- Apify and DataForSEO, last
-- written 2026-08-29 -- and deciding after the fact what an Apify run in
-- August cost would be inventing financial history.

-- Rebuilt rather than extended: a CHECK constraint's expression cannot be
-- altered in place. Dropped and re-added inside one transaction, so there is
-- no window in which an invalid state could be written.
alter table public.cost_events
  drop constraint if exists cost_events_pricing_state_check;

alter table public.cost_events
  add constraint cost_events_pricing_state_check
  check (pricing_state is null or pricing_state in (
    -- The provider told us what it charged.
    'ACTUAL',
    -- No actual figure, but every dimension the call consumed had a rate in
    -- provider_price_book and cost_usd is the total derived from them.
    'ESTIMATED',
    -- Some dimensions had a rate and at least one did not. cost_usd is real
    -- spend and a FLOOR: the true figure is higher by an unknown amount.
    'PARTIAL',
    -- Nothing could be priced. cost_usd is a placeholder, not spend.
    'UNPRICED',
    -- Genuinely free: a cache hit, or a call that consumed nothing billable.
    -- A real zero, and the only one worth trusting.
    'ZERO_REAL'
  ))
  -- NOT VALID, then validated below: the 925 existing rows all carry NULL and
  -- satisfy it trivially, but saying so explicitly keeps the ACCESS EXCLUSIVE
  -- lock off the table while it is checked.
  not valid;

alter table public.cost_events
  validate constraint cost_events_pricing_state_check;

comment on column public.cost_events.pricing_state is
  'How much the cost_usd figure beside it is worth: ACTUAL (provider reported '
  'it), ESTIMATED (derived from provider_price_book, complete), PARTIAL '
  '(derived, but a dimension had no rate -- a floor), UNPRICED (a placeholder, '
  'not spend), ZERO_REAL (genuinely free). NULL means the row predates pricing '
  'provenance (2026-09-25).';
