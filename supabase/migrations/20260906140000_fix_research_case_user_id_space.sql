-- Fixes a confirmed production bug found while tracing why a completed
-- Verify research report never showed up under /cases and its case_id was
-- always null: the two ownership-validation triggers added by
-- 20260905222923_transaction_case_crm.sql compare research_jobs.user_id
-- directly against transaction_cases.user_id, but those two columns live in
-- TWO DIFFERENT, INCOMPATIBLE id spaces:
--
--   - research_jobs.user_id is the raw Supabase AUTH uid — written
--     server-side by the research-agent edge function via
--     `(await sb.auth.getUser(token)).data.user.id`, and matched by RLS
--     policy research_jobs_select_own/update_own as `auth.uid() = user_id`.
--   - transaction_cases.user_id is `public.users.id` — a separate,
--     independently-generated uuid (see `user_id uuid NOT NULL REFERENCES
--     public.users(id)` in 20260905222923_transaction_case_crm.sql, and its
--     RLS policies checking `user_id = public.get_user_id()`, where
--     get_user_id() resolves `auth.uid()` through public.users.auth_id).
--
-- research_job_validate_case_link() checked
--   `transaction_cases.user_id = research_jobs.user_id`  (users.id = auth uid)
-- and transaction_case_validate_job_link() checked the same comparison the
-- other way around. Since a real user's `users.id` and their auth uid are
-- always DIFFERENT uuids, both checks were structurally impossible to
-- satisfy for ANY user — not a race, not an edge case, every single
-- attempt. This is why attachResearchToCase() (src/services/
-- transactionCases.ts) has never once succeeded since these triggers were
-- added: createTransactionCase() sets research_job_id at INSERT time,
-- which immediately fires transaction_case_validate_job_link() and raises;
-- production confirms transaction_cases has zero rows and every recent
-- research_jobs row has case_id = null, even though research-agent itself
-- was persisting completed reports correctly the whole time.
--
-- The fix keeps the exact same security intent (a case_id/research_job_id
-- link may only ever point at a row the SAME real person owns) but
-- resolves both sides through public.users so the comparison is apples to
-- apples, instead of changing what either table's user_id column means
-- (which would require touching RLS across both tables — out of scope and
-- unnecessary here; this is a trigger bug, not an RLS bug).

CREATE OR REPLACE FUNCTION public.research_job_validate_case_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.transaction_cases tc
    JOIN public.users u ON u.id = tc.user_id
    WHERE tc.id = NEW.case_id AND u.auth_id = NEW.user_id
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

CREATE OR REPLACE FUNCTION public.transaction_case_validate_job_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.research_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.research_jobs rj
    JOIN public.users u ON u.auth_id = rj.user_id
    WHERE rj.id = NEW.research_job_id AND u.id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'transaction_cases.research_job_id must reference a research_job owned by the same user';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.research_job_validate_case_link() IS
  'Ownership guard for research_jobs.case_id/supersedes_job_id. Resolves research_jobs.user_id (a Supabase auth uid) to public.users.id via public.users.auth_id before comparing against transaction_cases.user_id (a users.id) — these are two different id spaces and comparing them directly (the pre-20260906140000 version of this function) made the check impossible to ever satisfy.';
COMMENT ON FUNCTION public.transaction_case_validate_job_link() IS
  'Ownership guard for transaction_cases.research_job_id. Resolves research_jobs.user_id (a Supabase auth uid) to public.users.id via public.users.auth_id before comparing against transaction_cases.user_id (a users.id) — see research_job_validate_case_link() for the full explanation of the id-space bug this fixes.';
