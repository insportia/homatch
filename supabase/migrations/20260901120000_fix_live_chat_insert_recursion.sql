-- ============================================================
-- HOMATCH — Fix Live Chat "send message" 500 error
-- Root cause (confirmed via postgres_logs): the INSERT policy's
-- rate-limit check subqueried live_chat_messages from inside its
-- own policy. Postgres RLS re-applies the table's policies to any
-- subquery that reads the same table, which formed a cycle:
--   "infinite recursion detected in policy for relation
--    live_chat_messages" (SQLSTATE 42P17), surfaced to the client
--   as a generic PostgREST 500 on every send attempt.
-- Fix: move the self-referencing check into a SECURITY DEFINER
-- function. Its internal SELECT runs as the function owner (which
-- bypasses RLS in this project, same as every other SECURITY
-- DEFINER helper already in use), so it no longer re-triggers the
-- table's own policies.
-- ============================================================

CREATE OR REPLACE FUNCTION public.live_chat_rate_limit_ok(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.live_chat_messages m
    WHERE m.user_id = p_user_id AND m.created_at > now() - interval '2 seconds'
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.live_chat_rate_limit_ok(uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_chat_rate_limit_ok(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS live_chat_messages_insert ON public.live_chat_messages;
CREATE POLICY live_chat_messages_insert ON public.live_chat_messages
  FOR INSERT WITH CHECK (
    user_id = public.auth_user_id()
    AND NOT EXISTS (SELECT 1 FROM public.live_chat_profiles p WHERE p.user_id = public.auth_user_id() AND p.suspended = true)
    AND public.live_chat_rate_limit_ok(public.auth_user_id())
  );
