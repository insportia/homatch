/**
 * THE STORAGE EXPLORER'S DATA LAYER.
 *
 * Everything here is a call to a SECURITY DEFINER function that checks
 * `is_admin()` INSIDE itself, under the caller's own token. That is the whole
 * access control. The page is also behind an admin route, but a route guard
 * is a convenience for the admin, not a defence against anybody else: a
 * non-admin who calls these functions directly gets an empty result set, not
 * a hidden page they could have unhidden.
 *
 * WHY THE EXPLORER STARTS FROM ACCOUNTS AND NOT FROM R2
 *
 * Registering creates no object and no prefix — a prefix in object storage is
 * a substring of a key, not a directory. Enumerating the bucket would
 * therefore never show a new account at all. The account list comes from
 * `users` with the objects LEFT JOINed, so somebody who signed up an hour ago
 * appears with zero files and zero bytes, which is the correct answer.
 *
 * And the email is never copied onto a storage row. It is joined from the
 * authoritative record, because an address duplicated in a thousand places is
 * an address that is wrong in a thousand places the day somebody changes it.
 */

import { supabase } from '@/db/supabase';

export interface StorageAccountRow {
  user_id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  registered_at: string;
  object_count: number;
  total_bytes: number;
  categories: string[];
  last_upload_at: string | null;
}

export interface StorageObjectRow {
  id: string;
  provider: string;
  namespace: string;
  category: string | null;
  object_key: string;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_registered_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  purpose: string | null;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number;
  checksum_sha256: string | null;
  visibility: string;
  lifecycle: string;
  source_bucket: string | null;
  source_path: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  total_matched: number;
}

export interface AccountFilters {
  email?: string | null;
  userId?: string | null;
  registeredFrom?: string | null;
  registeredTo?: string | null;
  onlyWithFiles?: boolean;
  limit?: number;
  offset?: number;
}

export async function searchStorageAccounts(
  filters: AccountFilters = {},
): Promise<StorageAccountRow[]> {
  const { data, error } = await supabase.rpc('storage_admin_accounts', {
    p_email: filters.email || null,
    p_user_id: filters.userId || null,
    p_registered_from: filters.registeredFrom || null,
    p_registered_to: filters.registeredTo || null,
    p_only_with_files: filters.onlyWithFiles ?? false,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StorageAccountRow[];
}

export interface ObjectFilters {
  email?: string | null;
  userId?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  contentType?: string | null;
  visibility?: string | null;
  lifecycle?: string | null;
  provider?: string | null;
  uploadedFrom?: string | null;
  uploadedTo?: string | null;
  registeredFrom?: string | null;
  registeredTo?: string | null;
  minBytes?: number | null;
  maxBytes?: number | null;
  limit?: number;
  offset?: number;
}

export async function searchStorageObjects(
  filters: ObjectFilters = {},
): Promise<StorageObjectRow[]> {
  const { data, error } = await supabase.rpc('storage_admin_objects', {
    p_email: filters.email || null,
    p_user_id: filters.userId || null,
    p_category: filters.category || null,
    p_entity_type: filters.entityType || null,
    p_entity_id: filters.entityId || null,
    p_content_type: filters.contentType || null,
    p_visibility: filters.visibility || null,
    p_lifecycle: filters.lifecycle || null,
    p_provider: filters.provider || null,
    p_uploaded_from: filters.uploadedFrom || null,
    p_uploaded_to: filters.uploadedTo || null,
    p_registered_from: filters.registeredFrom || null,
    p_registered_to: filters.registeredTo || null,
    p_min_bytes: filters.minBytes ?? null,
    p_max_bytes: filters.maxBytes ?? null,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StorageObjectRow[];
}

export interface AccountStorageSummary {
  account: {
    user_id: string; email: string; full_name: string | null;
    is_admin: boolean; plan: string; registered_at: string;
  } | null;
  totals: { object_count: number; total_bytes: number; last_upload_at: string | null };
  by_category: { category: string | null; object_count: number; total_bytes: number }[];
}

export async function accountStorageSummary(
  userId: string,
): Promise<AccountStorageSummary | null> {
  const { data, error } = await supabase.rpc('storage_account_summary', { p_user_id: userId });
  if (error) throw new Error(error.message);
  return (data ?? null) as AccountStorageSummary | null;
}

/**
 * Open one file.
 *
 * Through the same short-lived signed-read flow every other reader uses —
 * `storage-sign` re-checks `storage_authorize` for this caller and this key,
 * and an admin read of somebody else's object is written to admin_audit_log
 * before the URL is returned. There is no permanent URL for a private file,
 * for an admin or for anybody.
 */
export async function openStorageObject(key: string): Promise<string> {
  const { signedReadUrl } = await import('@/services/storage/objectStore');
  const { url } = await signedReadUrl(key, { expiresIn: 120 });
  return url;
}

/** Bytes, in the unit a person would say out loud. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
