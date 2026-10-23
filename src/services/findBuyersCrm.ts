// Find Buyers → CRM. A discovered external lead becomes a CRM PROSPECT on the owner's request —
// never automatically, never with an invented address, never with consent. See
// supabase/migrations/20261126090000_find_buyers_leads_crm.sql.
import { supabase } from '@/db/supabase';

export class FindBuyersCrmError extends Error {
  constructor(public code: string) { super(code); }
}

const KNOWN = ['LEAD_NOT_FOUND', 'LEAD_REJECTED', 'NOT_A_SEEKER', 'CONTACT_NOT_FOUND', 'INVALID_EMAIL', 'INVALID_PHONE', 'ORIGIN_REQUIRED'] as const;
const codeOf = (message: string) => KNOWN.find((c) => message.includes(c)) ?? 'REQUEST_FAILED';

export async function saveLeadToCrm(leadId: string): Promise<{ contactId: string; created: boolean }> {
  const { data, error } = await supabase.rpc('save_find_buyers_lead_to_crm', { p_lead_id: leadId });
  if (error) throw new FindBuyersCrmError(codeOf(error.message));
  return data as { contactId: string; created: boolean };
}

/** lead id → CRM contact id, for the caller's leads already saved. */
export async function leadCrmContacts(leadIds: string[]): Promise<Record<string, string>> {
  if (!leadIds.length) return {};
  const { data, error } = await supabase.rpc('find_buyers_lead_crm_contacts', { p_lead_ids: leadIds });
  if (error) return {};
  return Object.fromEntries(((data ?? []) as Array<{ lead_id: string; contact_id: string }>).map((r) => [r.lead_id, r.contact_id]));
}

export type ContactDetailOrigin = 'OWNER_ENTERED' | 'PERSON_PROVIDED' | 'PUBLIC_POST';

export async function setContactDetails(contactId: string, email: string | null, phone: string | null, origin: ContactDetailOrigin | null) {
  const { data, error } = await supabase.rpc('my_outreach_contact_set_contact_details', {
    p_contact: contactId, p_email: email, p_phone: phone, p_origin: origin,
  });
  if (error) throw new FindBuyersCrmError(codeOf(error.message));
  return data as { email: string | null; phone: string | null; origin: ContactDetailOrigin | null; consentStatus: string };
}

export { crmLadder, type CrmLadderStep } from '@/crm/prospectLadder';
