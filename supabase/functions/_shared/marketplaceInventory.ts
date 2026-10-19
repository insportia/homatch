// PROPERTY INVENTORY WRITE-THROUGH (owner, 2026-10-19) — research-core/marketplace/inventory.ts has the rules.
//
//   recordInventory        every worker report: one upsert_marketplace_inventory statement for
//                          the batch, then (R2 configured) a gzip snapshot of each listing that is
//                          new or whose content changed, registered in storage_objects and
//                          referenced from supply_observations.snapshot_object_key. Runs after
//                          the worker has its answer (EdgeRuntime.waitUntil): never slows ingest,
//                          never fails a report.
//   indexSnapshot*         Home.ge / Allhome worker index survives a restart: the worker is
//                          handed a 5-minute signed PUT for one key, the commit re-reads the
//                          object and checks its sha256 and size before registering it, and only
//                          the newest INDEX_KEEP snapshots per provider are kept.
//
// property-inventory/ is deliberately NOT a storage/keys.ts namespace: storage-sign and
// storage_authorize refuse every key outside that list, so no browser, owner or admin
// session can ever be signed for these objects. Only this module (service role) writes
// them; every object is registered in storage_objects (namespace 'property-inventory').
import {
  INDEX_KEY_PATTERN, inventoryRow, listingSnapshotKey, portalIndexKey, sha256Hex, snapshotOf,
} from '../../../src/research-core/marketplace/inventory.ts';
import type { ExternalListingCandidate } from '../../../src/research-core/marketplace/worker-contract.ts';
import { deleteObject, envReport, getObject, putObject, signedUrl } from './objectStore.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

/** Snapshots written per report; a larger first sighting is snapshotted on its next change. */
export const MAX_SNAPSHOTS_PER_REPORT = 60;
export const INDEX_KEEP = 3;
export const INDEX_MAX_BYTES = 64 * 1024 * 1024;
/** Workers whose index lives in memory (official-worker portals adapters with `indexed: true`). */
export const INDEXED_WORKERS = new Set(['homege-agent', 'allhome-agent']);
const NAMESPACE = 'property-inventory';
const COUNTRY = 'ge';

export async function gzipJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const log = (event: string, facts: Record<string, unknown>) => console.log(JSON.stringify({ event, ...facts }));

async function pool<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

export interface InventoryOutcome { inserted: number; changed: number; seen: number; snapshots: number; snapshotFailures: number }

export async function recordInventory(db: Db, sourceKey: string, candidates: ExternalListingCandidate[], now = new Date()): Promise<InventoryOutcome> {
  const outcome: InventoryOutcome = { inserted: 0, changed: 0, seen: 0, snapshots: 0, snapshotFailures: 0 };
  if (!candidates.length) return outcome;
  const rows = await Promise.all(candidates.map((c) => inventoryRow(c)));
  const { data, error } = await db.rpc('upsert_marketplace_inventory', { p_source_key: sourceKey, p_rows: rows });
  if (error) throw new Error(`inventory upsert: ${error.message}`);
  const results = (data ?? []) as Array<{ observation_id: string; external_id: string; outcome: string; first_seen_at: string }>;
  for (const r of results) {
    if (r.outcome === 'INSERTED') outcome.inserted++; else if (r.outcome === 'CHANGED') outcome.changed++; else outcome.seen++;
  }
  if (!envReport().allPresent) return outcome;
  const byId = new Map(candidates.map((c) => [c.sourceListingId, c]));
  const due = results.filter((r) => r.outcome !== 'SEEN' && byId.has(r.external_id)).slice(0, MAX_SNAPSHOTS_PER_REPORT);
  await pool(due, 6, async (r) => {
    try {
      const candidate = snapshotOf(byId.get(r.external_id)!);
      const body = await gzipJson({ contract: 'property-inventory-snapshot-1', provider: sourceKey, observationId: r.observation_id, capturedAt: now.toISOString(), candidate });
      const sha = await sha256Hex(body);
      const key = listingSnapshotKey(sourceKey, COUNTRY, r.external_id, new Date(r.first_seen_at), now, sha);
      await putObject(key, body, 'application/gzip');
      const { error: regError } = await db.from('storage_objects').upsert({
        provider: 'R2', namespace: NAMESPACE, object_key: key, entity_type: 'supply_observation', entity_id: r.observation_id,
        purpose: 'PROPERTY_INVENTORY_SNAPSHOT', content_type: 'application/gzip', byte_size: body.byteLength, checksum_sha256: sha,
        visibility: 'PRIVATE', lifecycle: 'ACTIVE', verified_at: now.toISOString(),
      }, { onConflict: 'object_key', ignoreDuplicates: true });
      if (regError) throw new Error(regError.message);
      const { error: refError } = await db.from('supply_observations').update({ snapshot_object_key: key }).eq('id', r.observation_id);
      if (refError) throw new Error(refError.message);
      outcome.snapshots++;
    } catch (e) {
      outcome.snapshotFailures++;
      log('inventory_snapshot_failed', { sourceKey, externalId: r.external_id, message: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  });
  return outcome;
}

/** After the answer where the runtime can keep working; awaited otherwise (tests, local). */
export function afterResponse(work: Promise<unknown>): Promise<unknown> | null {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) { runtime.waitUntil(work); return null; }
  return work;
}

const providerPrefix = (sourceKey: string) => `${NAMESPACE}/${sourceKey}/${COUNTRY}/portal-index/`;

export async function indexSnapshotLatest(db: Db, sourceKey: string) {
  const { data, error } = await db.from('storage_objects').select('object_key,checksum_sha256,byte_size,created_at')
    .eq('namespace', NAMESPACE).eq('purpose', 'PROPERTY_INVENTORY_INDEX').eq('lifecycle', 'ACTIVE')
    .like('object_key', `${providerPrefix(sourceKey)}%`).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { snapshot: null };
  const { url, expiresAt } = await signedUrl({ action: 'READ', key: data.object_key, expiresIn: 300 });
  return { snapshot: { key: data.object_key, sha256: data.checksum_sha256, bytes: Number(data.byte_size), createdAt: data.created_at, url, expiresAt } };
}

export async function indexSnapshotUpload(sourceKey: string, sha256: string, bytes: number, now = new Date()) {
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(bytes) || bytes <= 0 || bytes > INDEX_MAX_BYTES) return { error: 'BAD_SNAPSHOT' };
  const key = portalIndexKey(sourceKey, COUNTRY, now, sha256);
  const { url, expiresAt } = await signedUrl({ action: 'WRITE', key, expiresIn: 300 });
  return { key, url, expiresAt };
}

export async function indexSnapshotCommit(db: Db, sourceKey: string, input: { key: string; sha256: string; bytes: number; entries: number }, now = new Date()) {
  const { key, sha256, bytes } = input;
  if (!INDEX_KEY_PATTERN.test(key) || !key.startsWith(providerPrefix(sourceKey))) return { error: 'BAD_KEY' };
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(bytes) || bytes <= 0 || bytes > INDEX_MAX_BYTES) return { error: 'BAD_SNAPSHOT' };
  /* The upload is proven by reading it back, never by trusting the worker's word. */
  const res = await getObject(key);
  if (res.status === 404) return { error: 'NOT_UPLOADED' };
  if (!res.ok) throw new Error(`index read-back failed: ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength !== bytes || (await sha256Hex(body)) !== sha256) {
    await deleteObject(key).catch(() => undefined);
    return { error: 'CHECKSUM_MISMATCH' };
  }
  const { error } = await db.from('storage_objects').upsert({
    provider: 'R2', namespace: NAMESPACE, object_key: key, entity_type: 'portal_index', purpose: 'PROPERTY_INVENTORY_INDEX',
    content_type: 'application/gzip', byte_size: bytes, checksum_sha256: sha256, visibility: 'PRIVATE', lifecycle: 'ACTIVE',
    verified_at: now.toISOString(), original_filename: `${Math.max(0, Math.trunc(Number(input.entries) || 0))} entries`,
  }, { onConflict: 'object_key' });
  if (error) throw new Error(error.message);
  /* Bounded cleanup: only the newest INDEX_KEEP index snapshots per provider stay. */
  const { data: older } = await db.from('storage_objects').select('id,object_key')
    .eq('namespace', NAMESPACE).eq('purpose', 'PROPERTY_INVENTORY_INDEX').eq('lifecycle', 'ACTIVE')
    .like('object_key', `${providerPrefix(sourceKey)}%`).order('created_at', { ascending: false }).range(INDEX_KEEP, INDEX_KEEP + 9);
  let removed = 0;
  for (const row of (older ?? []) as Array<{ id: string; object_key: string }>) {
    try {
      await deleteObject(row.object_key);
      await db.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', row.id);
      removed++;
    } catch (e) { log('inventory_index_cleanup_failed', { key: row.object_key, message: String((e as Error)?.message ?? e).slice(0, 200) }); }
  }
  return { committed: key, removed };
}
