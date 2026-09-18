/**
 * TURNING A STORED VALUE INTO SOMETHING AN <img> CAN ACTUALLY LOAD.
 *
 * THE BUG THIS BEGAN AS
 *
 * `property-photos` is a PRIVATE bucket, and the upload path finished with
 * `getPublicUrl()` — which asks the server nothing, concatenates a string and
 * always succeeds. Every upload produced a URL that answers 403 to everybody,
 * and that same broken string was written into `storage_path`, `public_url`
 * AND `properties.cover_photo_url`. The bucket had been empty since it was
 * created, which is the only reason nobody had hit it.
 *
 * WHAT IS STORED NOW
 *
 * The KEY, never a URL. A URL to a private object expires; a key does not. A
 * URL is minted when somebody actually looks, lives about ten minutes, and is
 * never written down.
 *
 * R2 FIRST, SUPABASE SECOND, AND THE DIFFERENCE MATTERS
 *
 * Every object has been copied to R2 and verified, but the Supabase original
 * is still there and is still the rollback. So a read tries R2 and falls back
 * — and the fallback is for ONE thing only: the object is not in R2 yet.
 *
 * A 403 is NEVER a reason to fall back. If `storage-sign` said NOT_OWNER,
 * asking Supabase the same question with a different mechanism would be
 * routing around the answer, which is the precise shape of an authorisation
 * bypass. Only NOT_FOUND falls through; every refusal is final, and the
 * counters below record which happened.
 */

import { supabase } from '@/db/supabase';
import { StorageError, signedReadUrl } from './objectStore';

/**
 * Where reads go first.
 *
 * Flipping this to 'SUPABASE' is the rollback: one constant, one deploy, and
 * every read is served from the originals again — which are still there,
 * untouched, because the migration only ever copied.
 */
const PRIMARY: 'R2' | 'SUPABASE' = 'R2';

/** The bucket a bare (unprefixed) photo path belongs to. */
const PHOTO_BUCKET = 'property-photos';

/**
 * Long enough to load a gallery on a slow connection and survive a scroll
 * back up; short enough that a URL copied out of devtools is dead before it
 * can be pasted anywhere.
 */
const SIGNED_SECONDS = 600;

/**
 * What actually happened, counted.
 *
 * A fallback that nobody measures is a migration nobody can finish: these
 * numbers are how you know whether the Supabase originals are still load
 * bearing or are finally just a backup.
 */
export const storageReadStats = {
  r2: 0,
  supabaseFallback: 0,
  refused: 0,
  failed: 0,
};

/** Already a URL — an imported listing's own image, or a local preview. */
function isAbsolute(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value);
}

/**
 * A tiny cache, because a gallery renders the same key several times.
 *
 * Re-signed a minute EARLY on purpose: an image that starts loading just as
 * its URL expires fails silently and leaves a blank square.
 */
const cache = new Map<string, { url: string; until: number }>();

/**
 * A stored value is either a full object key (`users/…`, `property-photos/…`)
 * or a bare path from before the prefix existed. Both resolve; the second by
 * being given the bucket it must have come from.
 */
function toObjectKey(stored: string): string {
  return stored.includes('/') && /^[a-z0-9-]+\//.test(stored)
    && (stored.startsWith('users/') || stored.startsWith(`${PHOTO_BUCKET}/`))
    ? stored
    : `${PHOTO_BUCKET}/${stored}`;
}

/** The Supabase path for a stored value, which is the key without a prefix. */
function toSupabasePath(stored: string): string {
  return stored.startsWith(`${PHOTO_BUCKET}/`)
    ? stored.slice(PHOTO_BUCKET.length + 1)
    : stored;
}

async function signFromSupabase(stored: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(toSupabasePath(stored), SIGNED_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function signKey(stored: string): Promise<string | null> {
  const hit = cache.get(stored);
  if (hit && hit.until > Date.now()) return hit.url;

  const remember = (url: string) => {
    cache.set(stored, { url, until: Date.now() + (SIGNED_SECONDS - 60) * 1000 });
    return url;
  };

  if (PRIMARY === 'SUPABASE') {
    const url = await signFromSupabase(stored);
    if (url) { storageReadStats.supabaseFallback += 1; return remember(url); }
    storageReadStats.failed += 1;
    return null;
  }

  try {
    const signed = await signedReadUrl(toObjectKey(stored), { expiresIn: SIGNED_SECONDS });
    storageReadStats.r2 += 1;
    return remember(signed.url);
  } catch (err) {
    const reason = err instanceof StorageError ? err.reason : 'UNAVAILABLE';
    // THE LINE THAT MATTERS. A refusal is an answer, not an outage.
    if (reason !== 'NOT_FOUND' && reason !== 'UNAVAILABLE') {
      storageReadStats.refused += 1;
      return null;
    }
    // Not there, or the object store is down: the original is still in
    // Supabase, and serving it is a compatibility measure, not a bypass —
    // Supabase Storage applies its own RLS to the same person.
    const url = await signFromSupabase(stored);
    if (url) { storageReadStats.supabaseFallback += 1; return remember(url); }
    storageReadStats.failed += 1;
    return null;
  }
}

/**
 * The one question every display site asks: what do I put in `src`?
 *
 * Null means "there is nothing to show" — an empty value, an object this
 * person may not read, or one that is genuinely gone. All three want the
 * placeholder, and none of them wants a broken image icon.
 */
export async function resolveImageSrc(
  value: string | null | undefined,
): Promise<string | null> {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed)) return trimmed;
  return signKey(trimmed);
}

/** Only for tests and for signing out: forget every minted URL. */
export function clearImageUrlCache(): void {
  cache.clear();
}
