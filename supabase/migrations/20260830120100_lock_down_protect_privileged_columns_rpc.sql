-- protect_privileged_user_columns() is a trigger function only — it relies on
-- NEW/OLD which are unbound outside trigger context, and it should never be
-- callable directly as a public RPC endpoint. Revoke direct execute access;
-- trigger firing does not require an EXECUTE grant on the invoking role.
REVOKE EXECUTE ON FUNCTION public.protect_privileged_user_columns() FROM PUBLIC, anon, authenticated;
