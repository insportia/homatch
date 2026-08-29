-- 20260829181000_outreach_helper_functions
-- get_eligible_contact_count was referenced by outreach-campaign-preview but
-- never actually created in the live database (it only existed, unapplied,
-- inside 00033_phase7_community_outreach_engine.sql — see the reconciliation
-- migration above for full context). Every campaign-preview call that
-- attached a contact_list_id has been throwing "function does not exist".
CREATE OR REPLACE FUNCTION public.get_eligible_contact_count(p_list_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COUNT(*) FROM public.outreach_contacts
  WHERE list_id = p_list_id
    AND owner_id = public.get_user_id()
    AND suppressed = false
    AND do_not_contact = false
    AND unsubscribed = false;
$$;
