-- Earlier suites deliberately ran several searches on one property; close
-- them so the one-active-search index (20261017090000) can be created.
update public.matching_jobs set status = 'completed'
 where status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached');
