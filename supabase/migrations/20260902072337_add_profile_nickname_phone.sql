-- ============================================================
-- HOMATCH — Profile Center support columns
-- Adds a user-editable display name (nickname) and phone number to
-- public.users. Both are ordinary, non-privileged profile fields:
-- the existing users_update_own RLS policy (auth_id = auth.uid())
-- already allows the owner to update their own row, and the
-- existing trg_protect_privileged_user_columns trigger already
-- reverts any client-side change to is_admin/plan for non
-- service_role callers — verified present before this migration,
-- so no new lockdown is needed for these two safe columns.
--
-- Applied directly to the project via the Supabase MCP tool; this
-- file mirrors that change for repo history / `supabase db push`.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nickname text,
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.users.nickname IS 'User-chosen display name shown in the app; distinct from full_name (legal/real name).';
COMMENT ON COLUMN public.users.phone IS 'Optional contact phone number, self-reported by the user.';
