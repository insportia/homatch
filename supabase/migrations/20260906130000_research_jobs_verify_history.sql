-- Verify History sidebar (HOMATCH VERIFY — FINAL PRODUCTION COMPLETION PASS,
-- section 29): the user must be able to browse, search/filter, rename and
-- (soft-)delete every past research run they have ever kicked off — not just
-- the ones already linked to whichever Transaction Case happens to be open
-- right now (the previous history list, in CaseLinkCard, only ever queried
-- `research_jobs where case_id = <the currently attached case>`). This adds
-- the columns a global, per-user history list needs:
--
--   - title: user-settable display name (rename support). Null by default —
--     the UI falls back to the raw `query` string when unset.
--   - deleted_at: a SOFT delete marker only ("hide from history"), never a
--     real DELETE. research_jobs rows may still be referenced by
--     transaction_cases.research_job_id (ON DELETE SET NULL there, but a
--     real delete here would still destroy a case's own research trail for
--     no good reason) and by other research_jobs.supersedes_job_id chains —
--     hard-deleting a superseded version would break "View Previous
--     Versions" for every job that supersedes it. No DELETE RLS policy is
--     added: the client can never issue a real DELETE against this table,
--     only ever an UPDATE that sets deleted_at.
--   - entity_name / project_name / address / developer_name / company_name /
--     coverage_level: STORED generated columns, extracted from the existing
--     result_json via immutable jsonb path operators. These exist purely so
--     the history list can search, filter, and display a meaningful row
--     (title/cadastral/address/project/company/type/status/coverage) without
--     ever fetching the full per-row dossier — result_json can be a large
--     due-diligence document and the mandate explicitly requires opening
--     history to cost zero new research (it must also not require pulling
--     every dossier just to render a list).
alter table public.research_jobs
  add column if not exists title text,
  add column if not exists deleted_at timestamptz;

alter table public.research_jobs
  add column if not exists entity_name text
    generated always as (result_json ->> 'entityName') stored,
  add column if not exists project_name text
    generated always as (result_json -> 'projectProfile' ->> 'name') stored,
  add column if not exists address text
    generated always as (
      coalesce(result_json -> 'projectProfile' ->> 'address', result_json -> 'identifiedParent' ->> 'address')
    ) stored,
  add column if not exists developer_name text
    generated always as (
      coalesce(result_json -> 'projectProfile' ->> 'developer', result_json -> 'identifiedParent' ->> 'developer')
    ) stored,
  add column if not exists company_name text
    generated always as (result_json -> 'companyProfile' ->> 'name') stored,
  add column if not exists coverage_level text
    generated always as (result_json -> 'dueDiligenceCoverage' ->> 'level') stored,
  add column if not exists outstanding_count int
    generated always as (
      nullif(result_json -> 'dueDiligenceCoverage' ->> 'outstandingConfirmations', '')::int
    ) stored;

comment on column public.research_jobs.title is
  'User-set display name for the Verify History list; the UI falls back to `query` when null.';
comment on column public.research_jobs.deleted_at is
  'Soft-delete marker for the Verify History list ("hide"), never a real row delete — research_jobs may still be referenced by transaction_cases.research_job_id and by other rows'' supersedes_job_id chains.';

-- Fast path for "all of this user's history, newest first, excluding
-- hidden/deleted entries" — the exact query the sidebar always runs first.
create index if not exists research_jobs_user_history_idx
  on public.research_jobs (user_id, created_at desc)
  where deleted_at is null;

-- Search/filter itself (mandate: "search/filter by cadastral/address/
-- project/company/title/type") runs client-side over this same per-user
-- history list — a per-user row count small enough that a dedicated trigram
-- index isn't worth the extra migration risk (pg_trgm lives in the
-- `extensions` schema on this project per
-- 20260904060259_add_missing_fk_indexes_and_relocate_pg_trgm.sql, and no
-- other migration here has needed to qualify a gin_trgm_ops index against
-- it). The user_id/created_at btree index above is what actually matters —
-- it is the one query this list always runs first.

-- No RLS changes needed: research_jobs_select_own / research_jobs_update_own
-- (both `auth.uid() = user_id`, unrestricted by column) already cover every
-- read and every write this feature needs — rename is a title UPDATE,
-- soft-delete is a deleted_at UPDATE, and no new DELETE capability is ever
-- granted to the authenticated role.
