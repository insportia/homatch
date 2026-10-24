// Mortgage interest for a listing, recorded when a signed-in person's calculation for it is on
// screen. No form and no consent step: the server takes the area and type from the listing and
// keeps only the price they calculated with (rounded). Nothing from the calculation is sent.
// Matching shows the person under its own safeguards (see migration 20261201093000).

import { supabase } from '@/db/supabase';

export async function recordMortgageInterest(propertyId: string, price: number, currency: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_my_mortgage_interest', { p_property_id: propertyId, p_budget: price, p_currency: currency });
  if (error) return false;
  return data === true;
}
