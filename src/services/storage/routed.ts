/*
 * Routed objects, browser side: one call per operation, R2 or Supabase Storage
 * underneath (the server half and the full reasoning live in
 * supabase/functions/_shared/storage/routed.ts).
 *
 * The product keeps storing the same PATH it always stored. In R2 that file is
 * `<bucket>/<path>`; reads try R2 first and fall back to Supabase Storage, so a
 * file works wherever it is. Writes go where the bucket's switch says
 * (storage_write_target): SUPABASE until an admin moves the bucket, then R2 —
 * through storage-sign, where storage_authorize decides ownership exactly as
 * the bucket's own policies do.
 */
import { supabase } from '@/db/supabase';
import { StorageError, deleteObject, signedReadUrl, uploadObject } from './objectStore';

export type RoutedBucket = 'meta-ads-media' | 'deal-room-documents' | 'mortgage-offer-documents' | 'developer-documents';
export type Store = 'R2' | 'SUPABASE';

export const routedKey = (bucket: RoutedBucket, path: string): string => `${bucket}/${path}`;

/** Where NEW uploads of this bucket go. Anything unreadable is SUPABASE: today's behaviour. */
export async function writeTarget(bucket: RoutedBucket): Promise<Store> {
  try {
    const { data, error } = await supabase.rpc('storage_write_target', { p_bucket: bucket });
    return !error && data === 'R2' ? 'R2' : 'SUPABASE';
  } catch {
    return 'SUPABASE';
  }
}

/**
 * Upload a new file to `path`. Resolves `{ error: null }` on success, the same
 * shape supabase-js upload() returns, so a call site changes one line.
 */
export async function uploadRouted(
  bucket: RoutedBucket, path: string, file: Blob,
  opts: { contentType?: string; originalFilename?: string; purpose?: string } = {},
): Promise<{ error: Error | null; source: Store }> {
  const contentType = opts.contentType || file.type || 'application/octet-stream';
  if (await writeTarget(bucket) === 'R2') {
    try {
      await uploadObject(routedKey(bucket, path), file, {
        contentType, originalFilename: opts.originalFilename, purpose: opts.purpose ?? bucket,
      });
      return { error: null, source: 'R2' };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)), source: 'R2' };
    }
  }
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false });
  return { error: error ? new Error(error.message) : null, source: 'SUPABASE' };
}

/** A short-lived URL for the file, R2 first. Throws when it is in neither store. */
export async function signedRoutedUrl(
  bucket: RoutedBucket, path: string, expiresIn: number,
  /** A filename forces a download under it; `true` keeps the stored name. */
  opts: { downloadAs?: string | true } = {},
): Promise<string> {
  const downloadName = opts.downloadAs === true ? path.split('/').pop() : opts.downloadAs;
  try {
    const { url } = await signedReadUrl(routedKey(bucket, path), {
      expiresIn: Math.min(expiresIn, 900), downloadAs: downloadName, requireExists: true,
    });
    return url;
  } catch (e) {
    // NOT_FOUND: not in R2 (never copied). Anything else (R2 unavailable,
    // signer down): Supabase Storage is still the source of truth for it.
    if (!(e instanceof StorageError)) throw e;
  }
  const { data, error } = await supabase.storage.from(bucket)
    .createSignedUrl(path, expiresIn, opts.downloadAs ? { download: opts.downloadAs } : undefined);
  if (error || !data?.signedUrl) throw error ?? new Error('storage_url_unavailable');
  return data.signedUrl;
}

/** Remove the file from both stores. Resolves `{ error }` like supabase-js remove(). */
export async function removeRouted(bucket: RoutedBucket, paths: string[]): Promise<{ error: Error | null }> {
  let firstError: Error | null = null;
  for (const path of paths) {
    try {
      await deleteObject(routedKey(bucket, path));
    } catch (e) {
      // NOT_FOUND / INVALID_KEY: it was never in R2. Anything else is real.
      if (!(e instanceof StorageError) || !['NOT_FOUND', 'INVALID_KEY'].includes(e.reason)) {
        firstError ??= e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) firstError ??= new Error(error.message);
  return { error: firstError };
}
