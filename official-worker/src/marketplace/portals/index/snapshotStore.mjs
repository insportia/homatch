import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';

const gzip = promisify(gzipCb), gunzip = promisify(gunzipCb);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const MINUTE = 60000;

/*
 * The portal index's snapshot in HOMATCH's R2 (owner, 2026-10-19), through the ingest door
 * the worker already has: it never holds an R2 or Supabase credential. The edge function
 * hands out one signed URL for one key (5 minutes), and registers the upload only after
 * reading it back and matching its sha256 (marketplaceInventory.ts).
 *
 *   start    restore the newest snapshot (3 tries, 2 minutes apart: the edge may deploy
 *            after the worker), then save every `intervalMs` while the index has read
 *            something new since the last save.
 */
export function createIndexPersistence({ index, ingest, fetcher = fetch, log = () => {}, signal, intervalMs = 60 * MINUTE, retryMs = 2 * MINUTE, minEntries = 50 }) {
  const state = { restored: null, lastSavedAt: null, lastSaveEntries: null, lastError: null, saves: 0 };
  let savedReads = -1, timer = null;
  const readsNow = () => { const c = index.stats().counters; return c.detailReads + c.restored; };

  async function restoreLatest() {
    const reply = await ingest({ action: 'inventory-index-latest' });
    const snap = reply?.snapshot;
    if (!snap?.url) return 0;
    const res = await fetcher(snap.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2 * MINUTE)].filter(Boolean)) });
    if (!res.ok) throw Error(`snapshot GET ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (sha256(body) !== snap.sha256) throw Error('SNAPSHOT_CHECKSUM');
    return index.restore(JSON.parse((await gunzip(body)).toString('utf8')));
  }

  async function save() {
    const snapshot = index.exportSnapshot();
    if (snapshot.entries.length < minEntries) return null;
    const body = await gzip(Buffer.from(JSON.stringify(snapshot)));
    const digest = sha256(body);
    const upload = await ingest({ action: 'inventory-index-upload', sha256: digest, bytes: body.length });
    const put = await fetcher(upload.url, { method: 'PUT', body, headers: { 'content-type': 'application/gzip' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5 * MINUTE)].filter(Boolean)) });
    if (!put.ok) throw Error(`snapshot PUT ${put.status}`);
    const commit = await ingest({ action: 'inventory-index-commit', key: upload.key, sha256: digest, bytes: body.length, entries: snapshot.entries.length });
    state.saves++; state.lastSavedAt = new Date().toISOString(); state.lastSaveEntries = snapshot.entries.length;
    log('portal_index_saved', { key: upload.key, bytes: body.length, entries: snapshot.entries.length, removed: commit?.removed ?? 0 });
    return commit;
  }

  async function tick() {
    const reads = readsNow();
    if (reads === savedReads) return;
    try { await save(); savedReads = reads; state.lastError = null; }
    catch (e) { state.lastError = String(e?.message ?? e).slice(0, 120); log('portal_index_save_failed', { message: state.lastError }); }
  }

  async function start() {
    for (let attempt = 1; attempt <= 3 && !signal?.aborted; attempt++) {
      try { state.restored = await restoreLatest(); savedReads = readsNow(); break; }
      catch (e) {
        state.lastError = String(e?.message ?? e).slice(0, 120);
        log('portal_index_restore_failed', { attempt, message: state.lastError });
        if (attempt < 3) await new Promise((done) => { const t = setTimeout(done, retryMs); t.unref?.(); });
      }
    }
    if (signal?.aborted) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
  }

  return { start, save, restoreLatest, tick, stop: () => { if (timer) clearInterval(timer); }, status: () => ({ ...state }) };
}
