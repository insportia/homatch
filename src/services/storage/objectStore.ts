/**
 * THE BROWSER'S HALF OF OBJECT STORAGE, WHICH HOLDS NO CREDENTIAL.
 *
 * Everything here goes through the `storage-sign` edge function. The browser
 * asks for a key and a verb; the function decides, in Postgres, under the
 * signed-in person's own token, whether they may do that to that object; and
 * what comes back is a URL that works for one object, one verb, for about two
 * minutes. No R2 key is ever in the bundle, in a response, or in this file,
 * and a test fails the build if that stops being true.
 *
 * AN UPLOAD IS THREE STEPS, AND THE THIRD IS THE ONE PEOPLE SKIP
 *
 *   sign    the server authorises, checks the type and size, and records
 *           the object as PENDING before a byte has moved
 *   PUT     the browser sends the bytes straight to R2
 *   commit  the server asks R2 what actually arrived and records the real
 *           size and md5
 *
 * Without `commit` an abandoned upload is bytes in a bucket that nothing in
 * Postgres knows about. With it, an upload that never finished is a PENDING
 * row somebody can find.
 *
 * THE KEY CARRIES THE ACCOUNT, NOT THE PERSON
 *
 * `users/<account uuid>/<category>/…` — never an email, never a name, never
 * the filename from somebody's computer. The display name is metadata and
 * travels in the request body, not in the path.
 */

import { supabase } from '@/db/supabase';

export type StorageAction = 'READ' | 'WRITE' | 'DELETE';

/** What the caller should do about a refusal, in the caller's own terms. */
export type StorageDenial =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'NOT_ADMIN'
  | 'NO_CAPABILITY'
  | 'INVALID_KEY'
  | 'MIME_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'NOT_FOUND'
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
 * than something the browser tries to display inline. It is the one place a
 * human-readable name is reunited with the object, and it happens in a
 * header rather than in the key.
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

export interface UploadOptions {
  contentType?: string;
  /** Kept as metadata so the person sees the name they chose. */
  originalFilename?: string;
  /** PRIVATE unless the caller has a reason; the default is the safe one. */
  visibility?: 'PRIVATE' | 'AUTHENTICATED' | 'PUBLIC';
  purpose?: string;
}

/**
 * Send a file to object storage and confirm it arrived.
 *
 * Returns the key, not a URL: a URL to a private object expires, and storing
 * one in the database is how a photo becomes a broken image three minutes
 * later. The key is the durable thing; a URL is minted when somebody looks.
 */
export async function uploadObject(
  key: string, file: Blob, options: UploadOptions = {},
): Promise<{ key: string; size: number | null }> {
  const contentType = options.contentType || file.type || 'application/octet-stream';

  const signed = await callSigner<SignResponse>({
    op: 'sign',
    action: 'WRITE',
    key,
    contentType,
    // Declared up front so the size limit is enforced BEFORE a URL exists.
    byteSize: file.size,
    originalFilename: options.originalFilename,
    visibility: options.visibility ?? 'PRIVATE',
    purpose: options.purpose,
  });

  const put = await fetch(signed.url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!put.ok) {
    // The URL was valid when it was minted; a failure here is the transfer,
    // not the permission.
    throw new StorageError('UNAVAILABLE', `upload failed with ${put.status}`);
  }

  // Ask the server what actually landed. A PUT returning 200 proves a PUT
  // returned 200.
  const committed = await callSigner<{ key: string; size: number | null }>({
    op: 'commit', key,
  });
  return { key: committed.key, size: committed.size };
}

/** Does the object exist, and how big is it? */
export async function objectExists(
  key: string,
): Promise<{ exists: boolean; size: number | null }> {
  const res = await callSigner<{ exists: boolean; size: number | null }>({ op: 'exists', key });
  return { exists: res.exists, size: res.size };
}

/** Deletes happen on the server: a URL that destroys an object is a bad idea. */
export async function deleteObject(key: string): Promise<void> {
  await callSigner<{ deleted: boolean }>({ op: 'delete', key });
}

/**
 * Build an account-scoped key.
 *
 * The same shape the server validates, kept here so a caller never hand-rolls
 * a path. Note what is not an input: the uploaded filename. The extension
 * comes from the content type, so `passport — Nino.pdf` becomes `6f1c….pdf`
 * and the name it had survives only as metadata.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/heic': 'heic', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
};

export function accountObjectKey(input: {
  accountId: string;
  category: string;
  entityId?: string | null;
  contentType?: string;
  objectId?: string;
}): string {
  const objectId = input.objectId ?? crypto.randomUUID();
  const ext = EXT_BY_MIME[(input.contentType ?? '').split(';')[0].trim().toLowerCase()];
  const object = ext ? `${objectId}.${ext}` : objectId;
  return input.entityId
    ? `users/${input.accountId}/${input.category}/${input.entityId}/${object}`
    : `users/${input.accountId}/${input.category}/${object}`;
}
