-- Link research_jobs (the Verify due-diligence pipeline) to transaction_cases
-- (the "My Deals" CRM added in 20260905222923_transaction_case_crm.sql), so
-- that:
--   1. A research report survives a page refresh and lives under
--      "My Deals" (/cases), not only in transient React state.
--   2. An old report can be reopened by id with a plain status read
--      (research-agent's 'status' action already never re-runs anything —
--      it only reads the row) — "reopen without rerun" therefore falls out
--      of persisting the job id, not from any new pipeline behavior.
--   3. Clicking "Refresh Research" starts a brand-new research_jobs row
--      (research-agent's 'start' action already always inserts a fresh
--      row — it never overwrites one) and the OLD row is left completely
--      untouched. supersedes_job_id is the only new thing needed to chain
--      the new run to the one it replaces, so a case's full report history
--      (every version, oldest report included) can be listed and reopened.
--
-- Deliberately additive and client-driven: no change to the research-agent
-- edge function itself. The client sets these two research_jobs columns
-- with a normal RLS-scoped UPDATE (research_jobs_update_own already allows
-- the owner to update any column of their own row) right after a job is
-- created or completes — see src/services/researchJobs.ts and the
-- attachResearchToCase() flow in src/services/transactionCases.ts. Keeping
-- this out of the Deno pipeline avoids adding any new regression surface to
-- code that this sandbox cannot live-test against ENREG/TAS/MSMAP/My.gov.

ALTER TABLE public.research_jobs
  ADD COLUMN case_id uuid REFERENCES public.transaction_cases(id) ON DELETE SET NULL,
  ADD COLUMN supersedes_job_id uuid REFERENCES public.research_jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.research_jobs.case_id IS
  'Transaction case this research run belongs to. Set client-side once the case is known (found by dedupe_key) or created — never written by research-agent itself. Lets /cases list every research report ever run for a case and reopen any of them without re-running research.';
COMMENT ON COLUMN public.research_jobs.supersedes_job_id IS
  'Previous research_jobs row this run replaces, set only when the user clicks "Refresh Research" on a case that already has a report. The old row and its result_json are never deleted or modified — this column is purely a forward pointer so the report history can be ordered/chained.';

CREATE INDEX idx_research_jobs_case ON public.research_jobs(case_id, created_at DESC) WHERE case_id IS NOT NULL;
CREATE INDEX idx_research_jobs_supersedes ON public.research_jobs(supersedes_job_id) WHERE supersedes_job_id IS NOT NULL;

-- dedupe_key lets the client find-or-create exactly ONE case per
-- property/entity per user (normalized cadastral code, or normalized
-- entity name+type when no cadastral code was identified) instead of
-- creating a duplicate case on every research run of the same property.
ALTER TABLE public.transaction_cases
  ADD COLUMN dedupe_key text;

COMMENT ON COLUMN public.transaction_cases.dedupe_key IS
  'Normalized identity of the property/entity this case tracks (e.g. "cad:01.18.06.019.055.03.01.603" or "name:project:some project"), computed client-side from a completed research report. Used to find-or-create one case per property per user rather than creating duplicates on every research run — see computeResearchDedupeKey() in src/services/transactionCases.ts.';

CREATE INDEX idx_transaction_cases_user_dedupe ON public.transaction_cases(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── integrity guards (defense in depth) ──────────────────────────────────────
-- RLS already prevents a user from reading/writing another user's
-- research_jobs or transaction_cases rows outright. These triggers close a
-- narrower gap: without them, a client could point its OWN research_jobs
-- row at a transaction_cases id it doesn't own (or vice versa) — the FK
-- alone only checks the row exists, not who owns it. Neither table's RLS
-- policy can express a cross-table ownership check on its own, so this is
-- done the same way user_owns_case() already is: a small SECURITY-neutral
-- validation function plus a targeted trigger, not a broadening of RLS.

CREATE OR REPLACE FUNCTION public.research_job_validate_case_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transaction_cases WHERE id = NEW.case_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'research_jobs.case_id must reference a transaction_case owned by the same user';
  END IF;
  IF NEW.supersedes_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.research_jobs WHERE id = NEW.supersedes_job_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'research_jobs.supersedes_job_id must reference a research_job owned by the same user';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_research_job_validate_case_link
  BEFORE INSERT OR UPDATE OF case_id, supersedes_job_id ON public.research_jobs
  FOR EACH ROW EXECUTE FUNCTION public.research_job_validate_case_link();

CREATE OR REPLACE FUNCTION public.transaction_case_validate_job_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.research_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.research_jobs WHERE id = NEW.research_job_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'transaction_cases.research_job_id must reference a research_job owned by the same user';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_transaction_case_validate_job_link
  BEFORE INSERT OR UPDATE OF research_job_id ON public.transaction_cases
  FOR EACH ROW EXECUTE FUNCTION public.transaction_case_validate_job_link();
