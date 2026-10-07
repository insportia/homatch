import { setTimeout as delay } from 'node:timers/promises';
import { acquireSsge } from './acquire.mjs';

/** Runs on the existing official worker; no second service or Supabase key. */
export function startSsgeRuntime(env = process.env, fetcher = fetch, acquire = acquireSsge) {
  const token = env.SSGE_WORKER_TOKEN ?? '', base = env.SUPABASE_URL ?? '';
  const enabled = env.SSGE_MARKETPLACE_ENABLED === 'true';
  const configured = token.length >= 32 && /^https:\/\/[^/]+$/.test(base);
  const controller = new AbortController();
  let active = 0, lastClaimAt = null, lastError = null;
  async function ingest(body) {
    const response = await fetcher(`${base}/functions/v1/marketplace-worker-ingest`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-homatch-worker': 'ssge-agent' },
      body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
    if (!response.ok) throw Error(`Marketplace ingest HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw Error('Marketplace ingest rejected SS.ge request');
    return result;
  }
  async function run(job) {
    active++;
    const heartbeat = setInterval(() => { void ingest({ action: 'heartbeat', runId: job.runId, leaseSeconds: 120 }).catch(() => { lastError = 'SSGE_HEARTBEAT_FAILED'; }); }, 30000);
    heartbeat.unref();
    try {
      await acquire(job.request, { deadlineAt: job.deadlineAt, signal: controller.signal, report: async result => {
        const reply = await ingest({ action: 'report', runId: job.runId, result });
        if (reply.rejected?.length || reply.accepted !== result.listings.length) throw Error('SS.ge report rejected');
        console.log(JSON.stringify({ service: 'ssge-agent', event: 'ingested', runId: job.runId, status: result.status, accepted: reply.accepted, pagesVisited: result.metrics.pagesVisited }));
      } });
    } catch { lastError = 'SSGE_RUN_FAILED'; }
    finally { clearInterval(heartbeat); active--; }
  }
  async function loop() {
    if (!enabled || !configured) return;
    while (!controller.signal.aborted) {
      try {
        // One source run at a time: conservative public requests and existing DB
        // per-provider/global concurrency limits remain authoritative.
        if (!active) {
          const result = await ingest({ action: 'claim', limit: 1, leaseSeconds: 120 });
          lastClaimAt = new Date().toISOString(); lastError = null;
          for (const job of (result.runs ?? []).slice(0, 1)) void run(job);
        }
      } catch { if (!controller.signal.aborted) lastError = 'SSGE_CLAIM_FAILED'; }
      await delay(5000, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
  void loop().catch(() => { lastError = 'SSGE_RUNTIME_FAILED'; });
  return { status: () => ({ enabled, configured, active, lastClaimAt, lastError }), shutdown: () => controller.abort() };
}
