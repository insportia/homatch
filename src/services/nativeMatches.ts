/*
 * NATIVE RELATIONSHIPS — two real Homatch accounts, and what either may do about it.
 *
 * Every call here is a SECURITY DEFINER function that resolves the caller from their own
 * session and refuses anybody who is not one of the two accounts the row names. Nothing
 * in the browser supplies a counterparty, a property or a phone number; it supplies the id
 * of a relationship it was shown, and the server decides the rest.
 */

import { supabase } from '@/db/supabase';

export type NativeKind = 'MATCH' | 'RELATIONSHIP';

export interface NativeMatchRow {
  kind: NativeKind;
  id: string;
  /** OWNER when the caller owns the property; SEEKER when they are the one looking. */
  role: 'OWNER' | 'SEEKER';
  property_id: string;
  homatch_id: number | null;
  property_title: string | null;
  /** The name the other person chose to show. Never an email, never a number. */
  counterparty_name: string | null;
  match_score: number | null;
  agreed: string[];
  preference_misses: string[];
  deal_kind: string | null;
  /** MATCHED for a requirements match; INTERESTED for a stated interest. */
  state: string;
  viewing_requested: boolean;
  has_conversation: boolean;
  updated_at: string;
  /* The listing as a counterparty may see it — facts only, never an address or contact. */
  city: string | null;
  district: string | null;
  property_type: string | null;
  transaction_type: string | null;
  price: number | null;
  currency: string | null;
  area: number | null;
  rooms: number | null;
  bedrooms: number | null;
}

export async function listNativeMatches(propertyId?: string | null): Promise<NativeMatchRow[]> {
  const { data, error } = await supabase.rpc('my_native_matches', {
    p_property_id: propertyId ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as NativeMatchRow[]).map((row) => ({
    ...row,
    agreed: row.agreed ?? [],
    preference_misses: row.preference_misses ?? [],
  }));
}

/** The existing conversation for this relationship, or a new one. Same id every time. */
export async function openNativeConversation(kind: NativeKind, id: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_native_conversation', { p_kind: kind, p_id: id });
  if (error) throw error;
  return String(data);
}

export interface NativeContact {
  phone: string | null;
  /** Why there is no number: NOT_SHARED (the other person never shared one) or NO_NUMBER. */
  reason: 'NOT_SHARED' | 'NO_NUMBER' | null;
}

/** The number this relationship entitles the caller to, recorded server-side. */
export async function revealNativeContact(kind: NativeKind, id: string): Promise<NativeContact> {
  const { data, error } = await supabase.rpc('reveal_native_contact', { p_kind: kind, p_id: id });
  if (error) throw error;
  const value = (data ?? {}) as { phone?: string | null; reason?: string | null };
  return {
    phone: value.phone ?? null,
    reason: value.reason === 'NOT_SHARED' || value.reason === 'NO_NUMBER' ? value.reason : null,
  };
}
