/*
 * Retention (docs/infra/STORAGE_RETENTION.md): what the customer is told about
 * how long a Verify report or Contracts analysis stays available.
 *
 * The dates come from the server (retention_my_records, the customer's own
 * rows only). Nothing here computes an expiry — there is exactly one rule and
 * it lives in Postgres. Until retention is activated the RPC returns nothing
 * (or does not exist yet), and every caller renders nothing.
 */
import { supabase } from '@/db/supabase';
import type { RetentionProduct, RetentionRow } from './retentionView';

export * from './retentionView';

export async function fetchRetention(product: RetentionProduct): Promise<RetentionRow[]> {
  try {
    const { data, error } = await supabase.rpc('retention_my_records', { p_product: product });
    if (error || !Array.isArray(data)) return [];
    return data as RetentionRow[];
  } catch {
    return [];
  }
}
