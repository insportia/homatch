/*
 * WHAT A MEMBER ALLOWS OWNERS TO DO, AS A LEAD.
 *
 * The member's own consent row (lead_contact_preferences), read and written through
 * my_lead_contact_preferences / set_my_lead_contact_preferences, which resolve the
 * caller from the session. Owners never read this table; the server re-checks it on
 * every read of a lead, so a withdrawal applies at once.
 *
 * Defaults (no row yet): offers on, phone and email not shared, marketing email off.
 * An unlock never implies marketing consent.
 */

import { supabase } from '@/db/supabase';

export interface LeadContactPreferences {
  acceptPropertyOffers: boolean;
  sharePhoneOnUnlock: boolean;
  shareEmailOnUnlock: boolean;
  acceptMarketingEmail: boolean;
}

export const DEFAULT_LEAD_CONTACT_PREFERENCES: LeadContactPreferences = {
  acceptPropertyOffers: true,
  sharePhoneOnUnlock: false,
  shareEmailOnUnlock: false,
  acceptMarketingEmail: false,
};

function normalize(raw: unknown): LeadContactPreferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LEAD_CONTACT_PREFERENCES;
  const b = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    acceptPropertyOffers: b(r.acceptPropertyOffers, d.acceptPropertyOffers),
    sharePhoneOnUnlock: b(r.sharePhoneOnUnlock, d.sharePhoneOnUnlock),
    shareEmailOnUnlock: b(r.shareEmailOnUnlock, d.shareEmailOnUnlock),
    acceptMarketingEmail: b(r.acceptMarketingEmail, d.acceptMarketingEmail),
  };
}

export async function getMyLeadContactPreferences(): Promise<LeadContactPreferences> {
  const { data, error } = await supabase.rpc('my_lead_contact_preferences');
  if (error) throw error;
  return normalize(data);
}

/** Writes only the keys passed; returns the stored result. */
export async function setMyLeadContactPreferences(patch: Partial<LeadContactPreferences>): Promise<LeadContactPreferences> {
  const { data, error } = await supabase.rpc('set_my_lead_contact_preferences', { p: patch });
  if (error) throw error;
  return normalize(data);
}
