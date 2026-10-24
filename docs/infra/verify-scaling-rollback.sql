-- Verify at scale — emergency removal of the seven 20261205* migrations' objects.
--
-- NOT a migration and NOT needed for an ordinary rollback: every object below is
-- new, nothing existing was altered, and the code reverted to main never calls
-- them, so leaving them in place after a revert is harmless (the recommended
-- path). Use this only if the owner explicitly wants the schema back as it was;
-- the ledger rows must then be removed by the release runner, not by hand.
-- Order: functions first, then tables, then the two indexes on existing tables.
-- Proven on production's own table definitions by
-- scripts/verify/prod-shape-migrations-check.mjs.

drop function if exists public.verify_drive_claim(integer, integer, integer, integer);
drop function if exists public.verify_queue_position(uuid);
drop function if exists public.worker_semaphore_acquire(text, text, integer, integer);
drop function if exists public.worker_semaphore_release(text, text);
drop function if exists public.openai_rate_reserve(text, integer, integer, integer);
drop function if exists public.verify_scaling_metrics();
drop function if exists public.proxy_usage_prune(integer);

drop table if exists public.verify_market_runs;
drop table if exists public.worker_semaphore_slots;
drop table if exists public.proxy_usage_events;
drop table if exists public.openai_rate_minutes;
drop table if exists public.worker_replicas;
drop table if exists public.verify_scaling_events;

drop index if exists public.research_jobs_drive_live_idx;
drop index if exists public.verify_tasks_finished_recent_idx;

delete from public.admin_settings where key = 'verify_scaling';
