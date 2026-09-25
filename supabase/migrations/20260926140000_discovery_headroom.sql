-- WHAT THIS SEARCH DID NOT REACH, recorded so the product can offer it later.
--
-- supply-discovery already computes it: with a campaign it derives the
-- customer's entitlement, gates sources by priority_tier, and returns
-- sourcesOutsideEntitlement -- sources that exist, are LIVE_TESTED and
-- active, and that this plan does not reach. On a FREE plan that is five of
-- eight; on VIP it is two.
--
-- But it only ever existed in one HTTP response. Once the sweep returned,
-- nothing in the system remembered that more was available, so an eventual
-- "search deeper" action would have had to re-run a search to discover that
-- a deeper one was possible.
--
-- WHAT THIS DELIBERATELY DOES NOT STORE.
--
-- No tier numbers, no adapter ids, no source names, no costs. Those are ours.
-- A customer surface reading this column should be able to render "more
-- discovery is available" and nothing that requires understanding P0, a
-- crawler or a supplier -- the same line the progress panel had to be cleaned
-- of. Admin reads the sweep's own response for the detail.
--
-- NOT A SECOND BILLING SYSTEM either: it records what the entitlement DID,
-- it does not decide or price anything. product_plan_entitlements remains the
-- only place a plan's limits live.

alter table public.matching_jobs
  add column if not exists discovery_headroom jsonb;

comment on column public.matching_jobs.discovery_headroom is
  'Customer-safe summary of what this search did not reach, for an eventual '
  '"search deeper" offer: {searchDepth, sourcesSearched, sourcesAvailableDeeper, '
  'resultCeiling, moreAvailable}. Never tier numbers, adapter ids or costs.';
