/**
 * THE BROWSER'S HALF OF OBJECT STORAGE, WHICH HOLDS NO CREDENTIAL.
 *
 * Everything here goes through the `storage-sign` edge function. The browser
 * asks for a key and a verb; the function decides, in Postgres, under the
 * signed-in user's own token, whether that person may do that to that object;
 * and what comes back is a URL that works once, for one object, for about two
 * minutes. No R2 key is ever in the bundle, in a response, or in this file.
 *
 * WHY THE UPLOAD IS TWO CALLS AND NOT ONE
 *
 * A fifty-megabyte plan streamed through an edge function costs the function
 * its memory limit and the person their patience. So the function issues a
 * presigned PUT and the browser sends the bytes straight to R2. The decision
 * stays on the server; only the transfer moves.
 *
 * WHAT IS NOT HERE YET, DELIBERATELY
 *
 * Nothing in the product reads or writes through this path in production
 * today, because no object has been migrated. The bytes still live in
 * Supabase Storage and `images.ts` still signs them there. This module is the
 * door the migration walks through, and it is proven against the real bucket
 * by supabase/functions/storage-selftest — not by a mock.
 */

import { supabase } from '@/db/supabase';

/** Mirrors the verbs the authoriser understands. */
export type StorageAction = 'READ' | 'WRITE' | 'DELETE';

/** What the caller must do about a refusal, in the caller's own terms. */
export type StorageDenial =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'NOT_ADMIN'
  | 'NO_CAPABILITY'
  | 'INVALID_KEY'
  | 'UNAVAILABLE';

export class StorageError extends Error {
  constructor(readonly reason: StorageDenial, message?: string) {
    super(message ?? reason);
    this.name = 'StorageError';
  }
}

interface SignResponse { url: string; expiresAt: string; key: string }

async function callSigner<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('storage-sign', { body });
  if (error) {
    // The function answers with a machine word and a status; invoke() hides
    // the status, so the word is read back out of the body.
    let reason: StorageDenial = 'UNAVAILABLE';
    try {
      const text = await (error as { context?: Response }).context?.text();
      const parsed = text ? JSON.parse(text) : null;
      if (typeof parsed?.error === 'string') reason = parsed.error as StorageDenial;
    } catch {
      /* the body was not JSON; UNAVAILABLE is the honest fallback */
    }
    throw new StorageError(reason);
  }
  return data as T;
}

/** Is object storage configured at all? One bit, for a health panel. */
export async function storageConfigured(): Promise<boolean> {
  const res = await callSigner<{ configured: boolean }>({ op: 'status' });
  return res.configured === true;
}

/**
 * A short-lived URL for reading one object.
 *
 * `downloadAs` turns the response into a download with that filename rather
 * than something the browser tries to display inline.
 */
export async function signedReadUrl(
  key: string, options?: { expiresIn?: number; downloadAs?: string },
): Promise<{ url: string; expiresAt: string }> {
  const res = await callSigner<SignResponse>({
    op: 'sign',
    action: 'READ',
    key,
    expiresIn: options?.expiresIn,
    downloadAs: options?.downloadAs,
  });
  return { url: res.url, expiresAt: res.expiresAt };
}

/**
 * Send a file to object storage.
 *
 * Returns the key, not a URL: a URL to a private object expires, and storing
 * one in the database is how a photo becomes a broken image three minutes
 * later. The key is the durable thing; a URL is minted when somebody looks.
 */
export async function uploadObject(
  key: string, file: Blob, options?: { contentType?: string },
): Promise<{ key: string }> {
  const res = await callSigner<SignResponse>({ op: 'sign', action: 'WRITE', key });
  const put = await fetch(res.url, {
    method: 'PUT',
    headers: { 'content-type': options?.contentType || file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) {
    // The presigned URL was valid when it was minted; a failure here is the
    // transfer, not the permission.
    throw new StorageError('UNAVAILABLE', `upload failed with ${put.status}`);
  }
  return { key: res.key };
}

/** Does the object exist, and how big is it? */
export async function objectExists(key: string): Promise<{ exists: boolean; size: number | null }> {
  const res = await callSigner<{ exists: boolean; size: number | null }>({ op: 'exists', key });
  return { exists: res.exists, size: res.size };
}

/** Deletes happen on the server: a URL that destroys an object is a bad idea. */
export async function deleteObject(key: string): Promise<void> {
  await callSigner<{ deleted: boolean }>({ op: 'delete', key });
}
