// A listing photo's short-lived URL, for the admin's posting view and the browser
// worker. Property photos live in R2 under `users/…/property-photos/…`
// (docs/infra/R2_STORAGE_ARCHITECTURE.md); a legacy path is still served by the
// Supabase `property-photos` bucket. Authorisation is the caller's: both callers
// are server-side and read only the photos the listing itself names.

import { signedUrl } from '../_shared/objectStore.ts';

export type Signer = (input: { action: 'READ'; key: string; expiresIn: number }) => Promise<{ url: string }>;

export async function signPhoto(db: any, storagePath: string | null | undefined, seconds: number, sign: Signer = signedUrl as unknown as Signer): Promise<string | null> {
  const path = String(storagePath ?? '').trim();
  if (!path) return null;
  if (/^https:\/\//i.test(path)) return path;
  if (path.startsWith('users/')) {
    try { return (await sign({ action: 'READ', key: path, expiresIn: seconds })).url; } catch { return null; }
  }
  const { data } = await db.storage.from('property-photos').createSignedUrl(path.replace(/^property-photos\//, ''), seconds);
  return data?.signedUrl ?? null;
}
