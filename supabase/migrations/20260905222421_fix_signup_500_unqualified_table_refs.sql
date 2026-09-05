-- Fix: POST /auth/v1/signup returning 500 in production.
--
-- Root cause (confirmed from live Supabase auth logs, 2026-09-05 20:43 UTC):
--   "failed to close prepared statement: ERROR: current transaction is
--   aborted, commands ignored until end of transaction block (SQLSTATE
--   25P02): ERROR: relation \"credit_accounts\" does not exist (SQLSTATE
--   42P01)"
--
-- 20260829130100_secure_internal_helper_functions.sql locked down several
-- SECURITY DEFINER functions with `ALTER FUNCTION ... SET search_path = ''`
-- (a correct hardening against search_path-injection). That statement only
-- changes the function's runtime config — it does not touch the function
-- body. Two of the four functions it altered still referenced their tables
-- unqualified in the function body (public.get_user_id() and
-- public.user_owns_property() were already schema-qualified and were
-- unaffected):
--   - create_credit_account_for_user(): `INSERT INTO credit_accounts ...`
--   - increment_source_failure(uuid):   `UPDATE source_registry ...`
-- With an empty search_path, an unqualified relation name resolves against
-- no schema at all, so both functions started raising 42P01 the moment the
-- hardening migration landed. create_credit_account_for_user() runs from
-- trg_create_credit_account (AFTER INSERT ON public.users), which itself
-- runs from on_auth_user_created (AFTER INSERT ON auth.users) — so every
-- signup's auth.users insert now fails inside Supabase Auth's own
-- transaction, surfacing to the client as a generic 500.
--
-- Fix: re-declare both functions with their table references schema-
-- qualified, changing nothing else (same signature, same SECURITY DEFINER,
-- same empty search_path, same grants — grants attach to the function
-- object and survive CREATE OR REPLACE unchanged).

CREATE OR REPLACE FUNCTION public.create_credit_account_for_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.credit_accounts (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_source_failure(p_source_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  UPDATE public.source_registry
  SET failure_count = failure_count + 1,
      updated_at    = now()
  WHERE id = p_source_id;
$function$;
