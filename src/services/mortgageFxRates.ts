// The mortgage calculator's official exchange rates (public.mortgage_fx_rates,
// refreshed from the National Bank of Georgia by the mortgage-fx-rates Edge
// Function). Public figures: readable by anyone, written only server side.
import { supabase } from '@/db/supabase';
import type { FxRate } from '@/mortgage/fx';

export interface StoredFxRates {
  rates: FxRate[];
  /** Newest fetch time in ms, 0 when the table is empty. */
  newestFetch: number;
}

export async function readMortgageFxRates(): Promise<StoredFxRates> {
  const { data } = await supabase.from('mortgage_fx_rates').select('currency,gel_per_unit,rate_date,fetched_at');
  const rows = (data ?? []) as Array<{ currency: string; gel_per_unit: number | string; rate_date: string; fetched_at: string }>;
  return {
    rates: rows.map((r) => ({ currency: r.currency, gelPerUnit: Number(r.gel_per_unit), rateDate: r.rate_date })),
    newestFetch: rows.reduce((max, r) => Math.max(max, Date.parse(r.fetched_at) || 0), 0),
  };
}

/** Ask the Edge Function to refresh from the NBG (it skips the fetch when the table is fresh). */
export async function refreshMortgageFxRates(): Promise<FxRate[] | null> {
  const { data, error } = await supabase.functions.invoke('mortgage-fx-rates', { body: {} });
  if (error) return null;
  const rates = (data as { rates?: FxRate[] } | null)?.rates;
  return Array.isArray(rates) ? rates : null;
}
