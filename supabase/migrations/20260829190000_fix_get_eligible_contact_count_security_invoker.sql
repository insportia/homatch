-- Switch to SECURITY INVOKER: RLS policy owners_manage_outreach_contacts
-- (owner_id = get_user_id()) already scopes rows correctly, so DEFINER
-- privileges are unnecessary and were flagged by the security linter as
-- publicly-executable SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.get_eligible_contact_count(p_list_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT COUNT(*) FROM public.outreach_contacts
  WHERE list_id = p_list_id
    AND owner_id = public.get_user_id()
    AND suppressed = false
    AND do_not_contact = false
    AND unsubscribed = false;
$function$;
