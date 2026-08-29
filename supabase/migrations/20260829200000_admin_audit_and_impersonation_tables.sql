-- Minimal audit trail + impersonation session tracking, gated on the
-- existing users.is_admin boolean (the pattern already used everywhere
-- else in the app) rather than introducing a separate granular RBAC
-- system. Both tables are written only by service-role edge functions;
-- RLS here just protects them from ever being readable/writable directly
-- by a non-admin client.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,           -- auth.uid() of the acting admin
  target_id uuid,                   -- public.users.id of the affected user, if any
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON public.admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON public.admin_audit_log(target_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_read_admin_audit_log ON public.admin_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true)
  );

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,           -- auth.uid() of the acting admin
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  audit_log_id uuid REFERENCES public.admin_audit_log(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_admin ON public.impersonation_sessions(admin_id, started_at DESC);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_read_impersonation_sessions ON public.impersonation_sessions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE users.auth_id = auth.uid() AND users.is_admin = true)
  );
