-- THE RECEIPT: WHICH SOURCES THIS SWEEP ACTUALLY READ.
--
-- Expand Search sells the sources a campaign's first sweep did not reach. To do
-- that without selling one twice it needs to know which ones it DID reach, and
-- until now nothing recorded that: the per-source report lived in the
-- supply-discovery response, was summarised into an event, and the adapter ids
-- were never kept anywhere a later run could read them.
--
-- WHY NOT IN discovery_headroom
--
-- Because that column has a contract, stated in its own comment: it holds the
-- customer's vocabulary and nothing else -- no tier numbers, no adapter ids, no
-- supplier names, no costs. Putting `portal:myhome.ge` in it would break that
-- for the convenience of not writing this migration, and the next person to
-- render the blob would leak a supplier name onto a customer's screen.
--
-- So the two facts live in two columns, because they have two audiences.
-- discovery_headroom is read by the screen. sources_read is read by the next
-- sweep.
--
-- WHY BY ID AND NOT BY TIER
--
-- The obvious alternative was to record the ceiling the sweep used and have an
-- expansion cover everything above it. That is wrong in both directions. A
-- source can be missed for reasons that have nothing to do with its tier -- it
-- was DEGRADED that morning, its breaker was open, its adapter reported
-- UNSUPPORTED for that city -- and a "tier N+1 upwards" rule would never reach
-- it again, because the arithmetic believes its whole tier is done. And a source
-- inside the original ceiling can be re-read by a rule that does not know it was
-- already read, which is the customer paying for it twice.
--
-- What was read is a receipt. A tier is a budget. They are not the same thing.
--
-- ONLY SUCCESSFUL READS GO IN HERE. A source that errored or was unsupported for
-- the city gave the customer nothing, so a later expansion is free to try it
-- again. A source that answered with zero listings WAS read, and "there is
-- nothing here" is a real answer worth not paying for twice.

alter table public.matching_jobs
  add column if not exists sources_read text[];

comment on column public.matching_jobs.sources_read is
  'Adapter ids this sweep successfully read, as a receipt. Expand Search excludes '
  'exactly this set so a campaign never pays to read the same source twice. '
  'Internal vocabulary: never rendered to a customer -- discovery_headroom is the '
  'customer-facing column. Only successful reads are recorded; a source that '
  'errored may be retried by a later sweep.';

-- Partial, because the only query that uses it asks "what has this campaign
-- already read", and a job with no receipt has nothing to contribute.
create index if not exists matching_jobs_sources_read_campaign
  on public.matching_jobs (campaign_id)
  where sources_read is not null;
