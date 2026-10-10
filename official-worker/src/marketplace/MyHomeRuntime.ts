import { setTimeout as delay } from 'node:timers/promises';
import { acquireMyHome } from './myhome/adapter.js';
import { endpoints, publicJson } from './myhome/api.js';
import { publicPage, publicSearchUrl } from './myhome/public-page.js';
import { createPublicBrowserReader } from './myhome/browser-page.js';
import { myHomeEngine } from './myhome/engine.js';
import { createCrawleeBrowserReader } from './myhome/crawlee-page.js';

export function startMyHomeRuntime(env = process.env, fetcher: typeof fetch = fetch) {
  const token = env.MYHOME_WORKER_TOKEN ?? '', baseUrl = env.SUPABASE_URL ?? '';
  const enabled = env.MYHOME_MARKETPLACE_ENABLED === 'true';
  const enrichDetails = env.MYHOME_DETAIL_ENRICHMENT_ENABLED === 'true';
  const crawleePages = env.MYHOME_PUBLIC_PAGE_TRANSPORT === 'crawlee';
  const browserPages = env.MYHOME_PUBLIC_PAGE_TRANSPORT === 'browser' || crawleePages;
  const createReader = () => crawleePages ? createCrawleeBrowserReader() : browserPages ? createPublicBrowserReader() : null;
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
    const reader = createReader();
    const heartbeat = setInterval(() => { void ingest({ action: 'heartbeat', runId: job.runId, leaseSeconds: 120 }).catch(error => { lastError = error.message; }); }, 30000);
    heartbeat.unref();
    try {
      log('claimed', { runId: job.runId, attempt: job.attempt });
      const result = await acquireMyHome(job.request, { fetcher, engine: myHomeEngine, enrichDetails, checkpoint: { queryApplied: job.queryApplied, returnedCount: job.returnedCount }, pageFetcher: reader?.fetcher, pageTransport: crawleePages ? 'PUBLIC_NEXT_DATA_CRAWLEE' : 'PUBLIC_NEXT_DATA_BROWSER', browserMs: reader?.browserMs, deadlineAt: job.deadlineAt, signal: controller.signal,
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
    } finally { clearInterval(heartbeat); await reader?.close(); active--; }
  }
  async function loop() {
    if (!configured) return;
    myHomeEngine.configure({
      restricted: async () => {
        const health = await ingest({ action: 'source-health' });
        if (typeof health.accessRestricted !== 'boolean') throw new Error('Invalid MyHome health contract');
        return health.accessRestricted;
      },
      restrict: async () => { await ingest({ action: 'restrict-access' }); },
    });
    if (!enabled) return;
    // Startup smoke checks execute from the actual production container. They
    // do not insert customer data and expose only status/count facts in logs.
    const reader = createReader();
    const pageFetcher = reader?.fetcher ?? fetcher;
    try {
      await myHomeEngine.ready();
      await myHomeEngine.guard(async () => {
      const locations = await publicJson(endpoints.locations, 'en', fetcher);
      const filters = await publicJson(endpoints.filters, 'ka', fetcher);
      const query = '?cities=1&currency_id=2&deal_types=1&real_estate_types=1&price_to=200000&area_from=70&area_types=1&page=1';
      const list = await publicPage(publicSearchUrl(endpoints.list + query), pageFetcher);
      const count = await publicJson(endpoints.count + query, 'ka', fetcher);
      const rows = list.payload?.data?.data;
      if (list.payload?.result !== true || !Array.isArray(rows)) throw new Error('Production MyHome list schema invalid');
      // Search-result acquisition is the default; a detail page is opened at
      // startup only when optional enrichment is enabled, never on every boot.
      const first = enrichDetails ? rows.find((row: any) => row.dynamic_slug) : null;
      const detail = first ? await publicPage(`https://www.myhome.ge/udzravi-qoneba/${encodeURIComponent(first.dynamic_slug)}-${first.id}/`, pageFetcher, String(first.id)) : null;
      smoke = { pageTransport: crawleePages ? 'CRAWLEE' : browserPages ? 'BROWSER' : 'HTTP', locationsStatus: locations.status, filtersStatus: filters.status, listStatus: list.status, countStatus: count.status,
        detailStatus: detail?.status ?? (enrichDetails ? null : 'NOT_REQUESTED'), parsed: rows.length, total: count.payload?.data?.total ?? null, checkedAt: new Date().toISOString() };
      log('production_connectivity', smoke);
      });
    } catch (error) { lastError = (error as Error).message; log('connectivity_error', { message: lastError }); }
    finally { await reader?.close(); }
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
  return { status: () => ({ enabled, configured, pageTransport: crawleePages ? 'CRAWLEE' : browserPages ? 'BROWSER' : 'HTTP', active, lastClaimAt, lastError, connectivity: smoke, engine: myHomeEngine.status() }), shutdown: () => controller.abort() };
}
