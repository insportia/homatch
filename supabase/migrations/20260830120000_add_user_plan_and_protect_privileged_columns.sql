-- 1. Add a plan tier column for freemium gating (community discovery, etc).
--    No billing integration exists yet — this is set by admins (or a future
--    billing webhook using the service role key) until real billing is wired up.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'FREE'
  CHECK (plan IN ('FREE', 'PLUS', 'PRO'));

-- 2. Security fix: users_update_own currently has no WITH CHECK, meaning any
--    authenticated user can update ANY column on their own row via a direct
--    client call — including is_admin. That means a user could self-promote
--    to admin today. Lock is_admin and plan so only the service role
--    (edge functions / future billing webhooks) can change them; every other
--    column (full_name, avatar_url, etc.) remains freely self-editable.
CREATE OR REPLACE FUNCTION public.protect_privileged_user_columns()
RETURNS trigger AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_privileged_user_columns ON public.users;
CREATE TRIGGER trg_protect_privileged_user_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_user_columns();

-- 3. Column to hold a generated promotional graphic for a social post draft.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS image_url text;
