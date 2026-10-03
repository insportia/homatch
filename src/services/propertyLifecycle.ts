// The owner's lifecycle actions, all server-side RPCs keyed on the caller's own
// identity (get_user_id()); the browser never sends a user id and never sets a
// timestamp. See supabase/migrations/20261011100000_property_owner_lifecycle.sql.

import { supabase } from '@/db/supabase';
import type { PropertyLifecycle } from '@/property/lifecycle';

/**
 * The server's answer for these properties, or an empty map when the lifecycle is
 * not available (a database without it yet): then the page simply shows no
 * freshness line rather than inventing one.
 */
export async function fetchLifecycle(propertyIds: string[]): Promise<Map<string, PropertyLifecycle>> {
  const out = new Map<string, PropertyLifecycle>();
  if (propertyIds.length === 0) return out;
  const { data, error } = await supabase.rpc('my_property_lifecycle', { p_property_ids: propertyIds });
  if (error || !Array.isArray(data)) return out;
  for (const row of data as PropertyLifecycle[]) out.set(String(row.property_id), row);
  return out;
}

export interface RenewResult {
  ok: boolean;
  renewed?: boolean;
  reason?: 'ALREADY_RENEWED' | 'NOT_AVAILABLE';
  matching_resumed?: boolean;
}

/** Free. Zero credits, zero reservations, zero charges. Idempotent on the server. */
export async function renewProperty(propertyId: string): Promise<RenewResult> {
  const { data, error } = await supabase.rpc('renew_property', { p_property_id: propertyId });
  if (error) throw new Error(error.message);
  return data as RenewResult;
}

/** "No longer available" / "available again", on the existing archive semantics. */
export async function setPropertyAvailability(propertyId: string, available: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_property_availability', { p_property_id: propertyId, p_available: available });
  if (error) throw new Error(error.message);
}
