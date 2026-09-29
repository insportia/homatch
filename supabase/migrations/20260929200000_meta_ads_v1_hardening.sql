-- META ADS v1 — security hardening, straight from the advisor findings on
-- the freshly applied domain. Four fixes, each closing a real gap:
--
-- 1. meta_wallet_balances was a default (SECURITY DEFINER) view, which
--    would have let any authenticated PostgREST query read EVERY user's
--    balance, bypassing the ledger's RLS. security_invoker makes the view
--    run under the querying role: browsers see only their own ledger rows,
--    and the edge functions (service_role) keep seeing everything.
ALTER VIEW public.meta_wallet_balances SET (security_invoker = on);

-- 2. The ledger-immutability trigger ran with a role-mutable search_path.
ALTER FUNCTION public.meta_ads_ledger_immutable() SET search_path = 'public';

-- 3. meta_ads_setting was SECURITY DEFINER over ALL of admin_settings and
--    executable by anon — an arbitrary-settings read (including private
--    worker tokens) one RPC away. Nothing calls it from the browser today
--    (the edge function reads settings under service_role), so: constrain
--    it to the meta_ads_% namespace AND revoke public execution. If a
--    frontend ever needs a public setting, it goes through meta-ads-api.
CREATE OR REPLACE FUNCTION public.meta_ads_setting(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT value FROM public.admin_settings
  WHERE key = p_key AND key LIKE 'meta\_ads\_%'
$$;
REVOKE EXECUTE ON FUNCTION public.meta_ads_setting(text) FROM PUBLIC, anon, authenticated;

-- 4. Trigger guard functions are for triggers, not for RPC. PostgREST
--    cannot invoke a trigger-returning function usefully, but there is no
--    reason to leave EXECUTE granted at all.
REVOKE EXECUTE ON FUNCTION public.meta_campaigns_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.meta_creatives_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.meta_leads_guard() FROM PUBLIC, anon, authenticated;
