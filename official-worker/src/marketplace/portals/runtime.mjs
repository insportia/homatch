import { setTimeout as delay } from 'node:timers/promises';
import { acquirePortal } from './acquire.mjs';
import { createPortalIndex } from './index/PortalIndex.mjs';
import { createIndexPersistence } from './index/snapshotStore.mjs';

/*
 * One runtime per portal, all on the existing official worker (no new service).
 * Same claim → acquire → report contract as MyHome and SS.ge; each portal has
 * its own worker id, token and enable flag, and runs one search at a time.
 *
 *   <PREFIX>_WORKER_TOKEN          ingest token for this worker id
 *   <PREFIX>_MARKETPLACE_ENABLED   'true' to claim runs (default off)
 *   PORTAL_INDEX_ENABLED           'false' stops the worker-local index (default on) for
 *                                  adapters with `indexed: true`; it only runs while that
 *                                  portal is enabled and configured (index/PortalIndex.mjs)
 *   PORTAL_INDEX_PERSIST           'false' stops saving/restoring the index in HOMATCH's R2
 *                                  (default on; index/snapshotStore.mjs)
 *
 * Several replicas (Verify at scale): `lead(key)` takes a cluster-wide slot
 * (official-worker queue/globalSemaphore.ts) and only the replica holding
 * `portal:<workerId>` crawls the index and claims searches — the same one
 * reader per site as a single replica, never N crawlers. The others retry
 * every 30 s and take over when the holder stops. Without `lead` (one
 * replica, or no coordinator) the runtime starts at once, as before.
 */
export function startPortalRuntime(adapter, env = process.env, fetcher = fetch, acquire = acquirePortal, createIndex = createPortalIndex, createPersistence = createIndexPersistence, lead = null) {
  const token = env[`${adapter.envPrefix}_WORKER_TOKEN`] ?? '', base = env.SUPABASE_URL ?? '';
  const enabled = env[`${adapter.envPrefix}_MARKETPLACE_ENABLED`] === 'true';
  const configured = token.length >= 32 && /^https:\/\/[^/]+$/.test(base);
  const controller = new AbortController();
  let active = 0, lastClaimAt = null, lastError = null, lastRun = null;
  let leading = !lead, slot = null, index = null, persistence = null;
  const log = (event, facts) => console.log(JSON.stringify({ service: adapter.workerId, event, ...facts }));
  const indexOn = adapter.indexed === true && enabled && configured && env.PORTAL_INDEX_ENABLED !== 'false';
  function startIndex() {
    index = indexOn ? createIndex(adapter, { log }) : null;
    index?.start();
    /* The index survives a redeploy: newest snapshot restored at start, saved while it learns. */
    persistence = index && env.PORTAL_INDEX_PERSIST !== 'false'
      ? createPersistence({ index, ingest, fetcher, log, signal: controller.signal }) : null;
    void persistence?.start().catch(() => {});
  }
  if (leading) startIndex();
  async function ingest(body) {
    const response = await fetcher(`${base}/functions/v1/marketplace-worker-ingest`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-homatch-worker': adapter.workerId },
      body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
    if (!response.ok) throw Error(`Marketplace ingest HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw Error(`Marketplace ingest rejected ${adapter.workerId} request`);
    return result;
  }
  async function run(job) {
    active++;
    const heartbeat = setInterval(() => { void ingest({ action: 'heartbeat', runId: job.runId, leaseSeconds: 120 }).catch(() => { lastError = 'HEARTBEAT_FAILED'; }); }, 30000);
    heartbeat.unref();
    const release = index?.hold(); // one site reader at a time: the crawler yields to a search
    try {
      const outcome = await acquire(adapter, job.request, { deadlineAt: job.deadlineAt, signal: controller.signal, index, report: async (result) => {
        const reply = await ingest({ action: 'report', runId: job.runId, result });
        if (reply.rejected?.length || reply.accepted !== result.listings.length) throw Error(`${adapter.workerId} report rejected`);
        log('ingested', { runId: job.runId, status: result.status, accepted: reply.accepted, pagesVisited: result.metrics.pagesVisited });
      } });
      lastRun = { at: new Date().toISOString(), ...outcome };
    } catch { lastError = 'RUN_FAILED'; }
    finally { clearInterval(heartbeat); release?.(); active--; }
  }
  async function loop() {
    if (!enabled || !configured) return;
    while (!leading && !controller.signal.aborted) {
      slot = await lead(`portal:${adapter.workerId}`).catch(() => null);
      if (slot) { leading = true; log('leading', {}); startIndex(); break; }
      await delay(30000, undefined, { signal: controller.signal }).catch(() => {});
    }
    while (!controller.signal.aborted) {
      try {
        if (!active) {
          const result = await ingest({ action: 'claim', limit: 1, leaseSeconds: 120 });
          lastClaimAt = new Date().toISOString(); lastError = null;
          for (const job of (result.runs ?? []).slice(0, 1)) void run(job);
        }
      } catch { if (!controller.signal.aborted) lastError = 'CLAIM_FAILED'; }
      await delay(5000, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
  void loop().catch(() => { lastError = 'RUNTIME_FAILED'; });
  return { status: () => ({ workerId: adapter.workerId, enabled, configured, leading, active, lastClaimAt, lastRun, lastError, index: index ? { ...index.stats(), persistence: persistence?.status() ?? null } : { enabled: false } }),
    shutdown: () => { controller.abort(); index?.stop(); persistence?.stop(); void slot?.release(); } };
}
