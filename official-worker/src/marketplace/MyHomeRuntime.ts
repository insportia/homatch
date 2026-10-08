import { setTimeout as delay } from 'node:timers/promises';
import { acquireMyHome } from './myhome/adapter.js';
import { endpoints, publicJson } from './myhome/api.js';
import { publicPage, publicSearchUrl } from './myhome/public-page.js';

export function startMyHomeRuntime(env = process.env, fetcher: typeof fetch = fetch) {
  const token = env.MYHOME_WORKER_TOKEN ?? '', baseUrl = env.SUPABASE_URL ?? '';
  const enabled = env.MYHOME_MARKETPLACE_ENABLED === 'true';
  const configured = token.length >= 32 && /^https:\/\/[^/]+$/.test(baseUrl);
  const controller = new AbortController();
  let active = 0, lastClaimAt: string | null = null, lastError: string | null = null;
  let smoke: Record<string, unknown> | null = null;
  const log = (event: string, facts: Record<string, unknown>) => console.log(JSON.stringify({ service: 'myhome-agent', event, ...facts }));
  async function ingest(body: Record<string, unknown>) {
    const response = await fetcher(`${baseUrl}/functions/v1/marketplace-worker-ingest`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-homatch-worker': 'myhome-agent' },
      body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
    if (!response.ok) throw new Error(`Marketplace ingest HTTP ${response.status}`);
    const result = await response.json() as any;
    if (result.error) throw new Error(`Marketplace ingest: ${String(result.error).slice(0, 100)}`);
    return result;
  }
  async function run(job: any) {
    active++;
    const heartbeat = setInterval(() => { void ingest({ action: 'heartbeat', runId: job.runId, leaseSeconds: 120 }).catch(error => { lastError = error.message; }); }, 30000);
    heartbeat.unref();
    try {
      log('claimed', { runId: job.runId, attempt: job.attempt });
      const result = await acquireMyHome(job.request, { fetcher, deadlineAt: job.deadlineAt, signal: controller.signal,
        report: async report => {
          const accepted = await ingest({ action: 'report', runId: job.runId, result: report });
          if ((accepted.rejected?.length ?? 0) > 0 || accepted.accepted !== report.listings.length) throw new Error('Marketplace ingest rejected acquisition records');
          log('ingested', { runId: job.runId, status: report.status, accepted: accepted.accepted, pagesVisited: report.metrics.pagesVisited, searchStatus: accepted.searchStatus });
        } });
      log('finished', { runId: job.runId, ...result });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log('run_error', { runId: job.runId, message: lastError });
      // No empty-success conversion; the existing lease reaper closes partial
      // results or retries an unstarted run when ingress is unavailable.
    } finally { clearInterval(heartbeat); active--; }
  }
  async function loop() {
    if (!enabled || !configured) return;
    // Startup smoke checks execute from the actual production container. They
    // do not insert customer data and expose only status/count facts in logs.
    try {
      const locations = await publicJson(endpoints.locations, 'en', fetcher);
      const filters = await publicJson(endpoints.filters, 'ka', fetcher);
      const query = '?cities=1&currency_id=2&deal_types=1&real_estate_types=1&price_to=200000&area_from=70&area_types=1&page=1';
      const list = await publicPage(publicSearchUrl(endpoints.list + query), fetcher);
      const count = await publicJson(endpoints.count + query, 'ka', fetcher);
      const rows = list.payload?.data?.data;
      if (list.payload?.result !== true || !Array.isArray(rows)) throw new Error('Production MyHome list schema invalid');
      const first = rows.find((row: any) => row.dynamic_slug);
      const detail = first ? await publicPage(`https://www.myhome.ge/udzravi-qoneba/${encodeURIComponent(first.dynamic_slug)}-${first.id}/`, fetcher, String(first.id)) : null;
      smoke = { locationsStatus: locations.status, filtersStatus: filters.status, listStatus: list.status, countStatus: count.status,
        detailStatus: detail?.status ?? null, parsed: rows.length, total: count.payload?.data?.total ?? null, checkedAt: new Date().toISOString() };
      log('production_connectivity', smoke);
    } catch (error) { lastError = (error as Error).message; log('connectivity_error', { message: lastError }); }
    while (!controller.signal.aborted) {
      try {
        if (active < 2) {
          const result = await ingest({ action: 'claim', limit: 2 - active, leaseSeconds: 120 });
          lastClaimAt = new Date().toISOString(); lastError = null;
          for (const job of result.runs ?? []) void run(job);
        }
      } catch (error) { if (!controller.signal.aborted) { lastError = (error as Error).message; log('claim_error', { message: lastError }); } }
      await delay(5000, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
  void loop().catch(error => { lastError = error.message; log('runtime_error', { message: lastError }); });
  return { status: () => ({ enabled, configured, active, lastClaimAt, lastError, connectivity: smoke }), shutdown: () => controller.abort() };
}
