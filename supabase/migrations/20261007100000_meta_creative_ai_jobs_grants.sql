-- META ADS — meta_creative_ai_jobs: no direct writes from customer roles.
--
-- The table is written only by meta-ads-api (service role). The schema's
-- default privileges had also handed `authenticated` INSERT / UPDATE / DELETE
-- (and TRUNCATE / REFERENCES / TRIGGER) on it. Row-level security already
-- denied every such write — the table has a SELECT policy only — but a grant
-- nobody needs is a defence that rests on one layer. Revoked explicitly;
-- the owner's read (policy meta_creative_ai_jobs_own) is unchanged.

revoke insert, update, delete, truncate, references, trigger on public.meta_creative_ai_jobs from authenticated;
revoke all on public.meta_creative_ai_jobs from anon;
grant select on public.meta_creative_ai_jobs to authenticated;
