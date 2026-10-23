/*
 * The Verify retail price (20261127090000_verify_fixed_price_validity.sql).
 *
 * The price lives in billable_products.VERIFY and is changed only through the
 * audited admin_set_verify_price RPC; nothing here decides a price. The pure
 * helpers mirror the server's validation so the admin sees the equivalent
 * credits as they type, but the server stays the authority (a price that is
 * not whole credits is refused there too).
 */
import { supabase } from '@/db/supabase';

export { creditsForCents, parseUsdToCents } from '@/verify/verifyPrice';

export interface VerifyFixedPrice {
  mode: 'FIXED' | 'VARIABLE';
  cents?: number;
  credits?: number;
  pricingVersion?: number;
  validityDays: number;
}

export interface VerifyPriceChange {
  changed_at: string;
  admin_email: string | null;
  old_cents: number | null;
  old_credits: number | null;
  new_cents: number | null;
  new_credits: number | null;
  pricing_version: number | null;
  reason: string | null;
}

export async function fetchVerifyPrice(): Promise<VerifyFixedPrice | null> {
  const { data, error } = await supabase.rpc('verify_fixed_price');
  if (error || !data) return null;
  return data as VerifyFixedPrice;
}

export async function fetchVerifyPriceHistory(limit = 10): Promise<VerifyPriceChange[]> {
  const { data, error } = await supabase.rpc('admin_verify_price_history', { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data as VerifyPriceChange[];
}

export async function setVerifyPrice(cents: number, reason: string): Promise<VerifyFixedPrice> {
  const { data, error } = await supabase.rpc('admin_set_verify_price', { p_cents: cents, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as VerifyFixedPrice;
}
