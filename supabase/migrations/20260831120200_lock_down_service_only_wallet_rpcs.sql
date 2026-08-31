-- ============================================================
-- HOMATCH — lock down service-role-only wallet RPCs & trigger fns
--
-- Discovery: this project has a default-privileges rule that grants
-- EXECUTE on every newly created function to anon, authenticated
-- AND service_role automatically (confirmed via pg_proc.proacl).
-- Revoking from just anon/authenticated is not enough — PUBLIC and/or
-- the per-role default grant can still leave the function callable.
-- Must REVOKE explicitly from anon, authenticated, and PUBLIC.
--
-- capture_credit_reservation / release_credit_reservation /
-- credit_topup_atomic must only run from backend edge functions
-- using the service role key (their own internal auth.role() check
-- already enforces this; revoking EXECUTE removes the exposed
-- PostgREST RPC endpoint entirely as defense in depth).
-- reserve_credits_for_product is a legitimate self-service RPC for
-- the owning authenticated user, so only anon (unauthenticated) is
-- revoked there. The two live_chat_* trigger functions are never
-- meant to be called directly via RPC at all — only by their
-- triggers — so all client-facing EXECUTE is revoked.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.capture_credit_reservation(uuid, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_credit_reservation(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_topup_atomic(uuid, numeric, text, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_credits_for_product(uuid, text, text) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.capture_credit_reservation(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_topup_atomic(uuid, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_credits_for_product(uuid, text, text) TO service_role, authenticated;

-- These two only run as BEFORE UPDATE triggers; no role needs to
-- call them directly via /rest/v1/rpc/...
REVOKE EXECUTE ON FUNCTION public.live_chat_messages_guard_update() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.live_chat_profiles_protect_moderation_fields() FROM anon, authenticated, PUBLIC;
