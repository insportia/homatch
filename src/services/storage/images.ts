/**
 * TURNING A STORED VALUE INTO SOMETHING AN <img> CAN ACTUALLY LOAD.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * `property-photos` is a PRIVATE bucket. The upload path called
 * `getPublicUrl()` on it, which does not ask the server anything — it
 * concatenates a string and always succeeds. The URL it returns is a real
 * URL to a real object that answers 403 to everybody, for ever. That string
 * was then written into `property_photos.public_url`, `storage_path` AND
 * `properties.cover_photo_url`, so a single upload recorded the same broken
 * URL in three columns. Nobody had hit it yet only because the bucket has
 * been empty since it was created.
 *
 * WHAT IS STORED NOW
 *
 * The PATH, never a URL. A URL to a private object expires; a path does not.
 * A URL is minted when somebody actually looks at the image, lives about ten
 * minutes, and is never written down.
 *
 * WHY ONE RESOLVER FOR BOTH KINDS OF VALUE
 *
 * `cover_photo_url` legitimately holds two different things: an absolute
 * http(s) URL for a property imported from a listing site, and a storage path
 * for a photo somebody uploaded here. Asking every display site to tell them
 * apart is how one of them gets it wrong. They ask this instead, and the rule
 * is a single line: it starts with http, it is already a URL; otherwise it is
 * a path and needs signing.
 */

import { supabase } from '@/db/supabase';

/**
 * WHERE THE BYTES ACTUALLY ARE TODAY.
 *
 * Supabase Storage. Nothing has been migrated to R2 — the bucket is proven
 * and the door is built, but no production object has moved, and moving them
 * is a separate, reversible operation with its own plan.
 *
 * When they do move, this constant becomes 'R2' and `signPath` routes through
 * `objectStore.signedReadUrl` instead. That is the entire switch, which is
 * the point of routing every display through one function.
 */
const PHOTO_PROVIDER: 'SUPABASE' | 'R2' = 'SUPABASE';

const PHOTO_BUCKET = 'property-photos';

/**
 * Long enough to load a gallery on a slow connection and to survive a scroll
 * back up; short enough that a URL copied out of devtools is dead by the time
 * it is pasted anywhere.
 */
const SIGNED_SECONDS = 600;

/** Already a URL — an imported listing's own image, or a data: preview. */
function isAbsolute(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value);
}

/**
 * A tiny cache, because a gallery renders the same path several times.
 *
 * Keyed by path, holding the URL and the moment it stops being usable. It is
 * deliberately re-signed a minute EARLY: an image that starts loading just as
 * its URL expires fails silently and leaves a blank square.
 */
const cache = new Map<string, { url: string; until: number }>();

async function signPath(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;

  if (PHOTO_PROVIDER === 'R2') {
    const { signedReadUrl } = await import('./objectStore');
    try {
      const signed = await signedReadUrl(`${PHOTO_BUCKET}/${path}`, { expiresIn: 600 });
      cache.set(path, { url: signed.url, until: Date.now() + (SIGNED_SECONDS - 60) * 1000 });
      return signed.url;
    } catch {
      return null;
    }
  }

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_SECONDS);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_SECONDS - 60) * 1000 });
  return data.signedUrl;
}

/**
 * The one question every display site asks: what do I put in `src`?
 *
 * Null means "there is nothing to show" — an empty value, or an object this
 * person may not read. Both cases want the placeholder, and neither wants a
 * broken image icon.
 */
export async function resolveImageSrc(
  value: string | null | undefined,
): Promise<string | null> {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed)) return trimmed;
  return signPath(trimmed);
}

/** Only for tests and for signing out: forget every minted URL. */
export function clearImageUrlCache(): void {
  cache.clear();
}
