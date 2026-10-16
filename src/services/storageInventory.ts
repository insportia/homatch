/*
 * Admin → Storage → "Storage by service": what lives where, from the two
 * indexes HOMATCH keeps (storage.objects for Supabase Storage,
 * storage_objects for Cloudflare R2), and the per-bucket switch that decides
 * where NEW uploads go (migration 20261107090000). Admin-only on the server.
 */
import { supabase } from '@/db/supabase';
import type { InventoryR2Row } from './storageInventoryView';

export { r2ByService, serviceOf, type ServiceUsage } from './storageInventoryView';

export type Store = 'R2' | 'SUPABASE';

export interface InventorySupabaseBucket {
  bucket: string; public: boolean; objects: number; bytes: number; copied_to_r2: number; last_upload: string | null;
}
export type { InventoryR2Row } from './storageInventoryView';
export interface StorageInventory {
  generated_at: string;
  routing: Record<string, Store>;
  supabase: InventorySupabaseBucket[];
  r2: InventoryR2Row[];
  totals: { supabase_bytes: number; supabase_objects: number; r2_bytes: number; r2_objects: number };
}

/** null = not installed in this environment, or not an admin. */
export async function storageInventory(): Promise<StorageInventory | null> {
  const { data, error } = await supabase.rpc('storage_admin_inventory');
  return error || !data ? null : (data as StorageInventory);
}

export async function setWriteTarget(bucket: string, target: Store, reason: string): Promise<Record<string, Store>> {
  const { data, error } = await supabase.rpc('storage_admin_set_write_target', { p_bucket: bucket, p_target: target, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Record<string, Store>;
}

