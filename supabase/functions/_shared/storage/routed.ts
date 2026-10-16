/**
 * ROUTED OBJECTS: ONE CALL SITE, TWO STORES, NO REWRITTEN ROWS.
 *
 * The product stores a PATH for each file (meta_creatives.media[].path,
 * deal_room_documents.storage_path, ...). That path is the identity. In
 * Supabase Storage it lives in its bucket; in R2 the same file lives at
 * `<bucket>/<path>` (keys.ts keyForLegacyObject) — the shape storage-migrate
 * copies to. So moving a bucket to R2 never rewrites a row, and rolling it back
 * is reading from the old place again.
 *
 *   read / sign   R2 first, Supabase Storage second. Works for a file in
 *                 either place, before, during and after a migration, and is
 *                 independent of the write switch.
 *   write         where the bucket's switch says (storage_write_target):
 *                 SUPABASE until an admin moves it, R2 after. An R2 write is
 *                 confirmed with a HEAD (size must match) and indexed in
 *                 storage_objects; if either fails the object is removed, so a
 *                 failed upload never leaves an orphan.
 *   remove        both stores, so nothing survives in the one not looked at.
 *
 * Authorisation is NOT this file's job: callers are edge functions that have
 * already decided, with the caller's own client or a domain row, that this
 * request may touch this path. Browser code goes through storage-sign instead
 * (services/storage/routed.ts), where storage_authorize decides.
 */
import {
  deleteObject as r2Delete, getObject as r2Get, headObject as r2Head, putObject as r2Put,
  signedUrl as r2Sign, type ObjectFacts,
} from '../objectStore.ts';
import { keyForLegacyObject } from './keys.ts';

/** Buckets whose files may live in R2 under `<bucket>/<path>`. */
export const ROUTED_BUCKETS = [
  'meta-ads-media', 'deal-room-documents', 'mortgage-offer-documents', 'developer-documents',
] as const;
export type RoutedBucket = typeof ROUTED_BUCKETS[number];
export type Store = 'R2' | 'SUPABASE';

/** The R2 operations, injectable so the routing is unit-testable. */
export interface ObjectStore {
  get(key: string): Promise<Response>;
  head(key: string): Promise<ObjectFacts>;
  put(key: string, body: Uint8Array, contentType: string): Promise<{ etag: string | null }>;
  remove(key: string): Promise<unknown>;
  sign(key: string, expiresIn: number, downloadAs?: string): Promise<{ url: string }>;
}

export const r2Store: ObjectStore = {
  get: r2Get,
  head: r2Head,
  put: (key, body, contentType) => r2Put(key, body as unknown as BodyInit, contentType),
  remove: r2Delete,
  sign: (key, expiresIn, downloadAs) => r2Sign({ action: 'READ', key, expiresIn, downloadAs }),
};

// deno-lint-ignore no-explicit-any
type Db = any;

const sha256Hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

export const r2KeyFor = (bucket: RoutedBucket, path: string): string => keyForLegacyObject(bucket, path);

/** Where NEW uploads of this bucket go. Unknown, unset or unreadable is SUPABASE. */
export async function writeTarget(db: Db, bucket: RoutedBucket): Promise<Store> {
  try {
    const { data, error } = await db.rpc('storage_write_target', { p_bucket: bucket });
    return !error && data === 'R2' ? 'R2' : 'SUPABASE';
  } catch {
    return 'SUPABASE';
  }
}

export interface ReadResult { bytes: Uint8Array; contentType: string | null; source: Store }

/** The file's bytes from wherever it is, R2 first. null when it is in neither. */
export async function readRouted(
  db: Db, bucket: RoutedBucket, path: string, store: ObjectStore = r2Store,
): Promise<ReadResult | null> {
  try {
    const res = await store.get(r2KeyFor(bucket, path));
    if (res.ok) {
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type'), source: 'R2' };
    }
    await res.body?.cancel();
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'storage_routed', op: 'read', bucket, r2: String(e instanceof Error ? e.message : e).slice(0, 120) }));
  }
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null, source: 'SUPABASE' };
}

/** A short-lived URL for the file, R2 first. null when it is in neither. */
export async function signRouted(
  db: Db, bucket: RoutedBucket, path: string, expiresIn: number,
  opts: { downloadAs?: string } = {}, store: ObjectStore = r2Store,
): Promise<{ url: string; source: Store } | null> {
  const key = r2KeyFor(bucket, path);
  try {
    if ((await store.head(key)).exists) {
      // R2 URLs are capped at 15 minutes by the presigner (objectStore.ts).
      const { url } = await store.sign(key, Math.min(expiresIn, 900), opts.downloadAs);
      return { url, source: 'R2' };
    }
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'storage_routed', op: 'sign', bucket, r2: String(e instanceof Error ? e.message : e).slice(0, 120) }));
  }
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expiresIn, opts.downloadAs ? { download: opts.downloadAs } : undefined);
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, source: 'SUPABASE' };
}

export interface WriteOptions {
  ownerUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  upsert?: boolean;
  /** Force a store (tests and the self-test); production callers follow the switch. */
  target?: Store;
}

/**
 * Write a new file where the bucket's switch says. Resolves `{ error: null }`
 * on success, or `{ error }` — the shape supabase-js upload() returns, so a
 * call site changes one line.
 */
export async function writeRouted(
  db: Db, bucket: RoutedBucket, path: string, bytes: Uint8Array, contentType: string,
  opts: WriteOptions = {}, store: ObjectStore = r2Store,
): Promise<{ error: Error | null; source: Store }> {
  const target = opts.target ?? await writeTarget(db, bucket);
  if (target === 'SUPABASE') {
    const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: opts.upsert ?? false });
    return { error: error ? new Error(String(error.message ?? error)) : null, source: 'SUPABASE' };
  }

  const key = r2KeyFor(bucket, path);
  let written = false;
  try {
    if (!opts.upsert && (await store.head(key)).exists) throw new Error('already exists');
    const { etag } = await store.put(key, bytes, contentType);
    written = true;
    // A PUT that returned 200 proves a PUT returned 200: ask what landed.
    const facts = await store.head(key);
    if (!facts.exists || facts.size !== bytes.byteLength) {
      throw new Error(`r2 write not confirmed (size ${facts.size ?? 'none'} of ${bytes.byteLength})`);
    }
    const now = new Date().toISOString();
    const { error: idxErr } = await db.from('storage_objects').upsert({
      provider: 'R2', namespace: bucket, category: bucket, object_key: key,
      owner_user_id: opts.ownerUserId ?? null, entity_type: opts.entityType ?? null, entity_id: opts.entityId ?? null,
      content_type: contentType, byte_size: bytes.byteLength,
      checksum_md5: facts.etag ?? etag ?? null, checksum_sha256: await sha256Hex(bytes),
      visibility: 'PRIVATE', lifecycle: 'ACTIVE', verified_at: now, updated_at: now, deleted_at: null,
    }, { onConflict: 'object_key' });
    if (idxErr) throw new Error(`index: ${idxErr.message ?? idxErr}`);
    return { error: null, source: 'R2' };
  } catch (e) {
    // No orphans: an object nothing in Postgres knows about is removed.
    if (written) await store.remove(key).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ scope: 'storage_routed', op: 'write', bucket, error: message.slice(0, 160) }));
    return { error: new Error(message), source: 'R2' };
  }
}

/** Remove the file from both stores; the R2 index row is kept, marked DELETED. */
export async function removeRouted(
  db: Db, bucket: RoutedBucket, paths: string[], store: ObjectStore = r2Store,
): Promise<{ error: Error | null }> {
  let firstError: Error | null = null;
  for (const path of paths) {
    const key = r2KeyFor(bucket, path);
    try {
      if ((await store.head(key)).exists) {
        await store.remove(key);
        const now = new Date().toISOString();
        await db.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: now, updated_at: now }).eq('object_key', key);
      }
    } catch (e) {
      firstError ??= new Error(e instanceof Error ? e.message : String(e));
    }
  }
  const { error } = await db.storage.from(bucket).remove(paths);
  if (error) firstError ??= new Error(String(error.message ?? error));
  return { error: firstError };
}
