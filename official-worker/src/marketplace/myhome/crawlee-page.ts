import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { Configuration, PlaywrightCrawler, RequestQueue, NonRetryableError } from '@crawlee/playwright';
import { chromium, type Page } from 'playwright';
import { AcquisitionError } from './api.js';

export function assertMyHomePage(input: string) {
  const url = new URL(input);
  if (url.origin !== 'https://www.myhome.ge' || !url.pathname.startsWith('/udzravi-qoneba/') || url.username || url.password)
    throw new Error('Unexpected public Crawlee request');
  return url;
}

/** Ordinary self-hosted Chromium. Crawlee schedules pages; the existing adapter
 * owns mapping, parsing, retries, checkpoints and ingestion. No cloud storage,
 * fingerprints, session rotation, proxy, CAPTCHA interaction or blocked retry.
 */
export function createCrawleeBrowserReader(options: { headless?: boolean; beforeNavigation?: (page: Page) => Promise<void> } = {}) {
  type Pending = { resolve: (response: Response) => void; reject: (error: unknown) => void; page?: Page };
  const pending = new Map<string, Pending>();
  let closed = false, restricted = false, elapsed = 0;
  let crawler: PlaywrightCrawler | undefined, queue: RequestQueue | undefined, running: Promise<unknown> | undefined;
  let initialization: Promise<void> | undefined;
  const rejectAll = (error: unknown) => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  async function initialize() {
    const config = new Configuration({ persistStorage: false, purgeOnStart: false });
    queue = await RequestQueue.open(`myhome-${randomUUID()}`, { config });
    crawler = new PlaywrightCrawler({
      requestQueue: queue, keepAlive: true,
      maxConcurrency: 1, minConcurrency: 1, maxRequestsPerMinute: 30,
      maxRequestRetries: 0, maxSessionRotations: 0, retryOnBlocked: false,
      useSessionPool: false, persistCookiesPerSession: false,
      navigationTimeoutSecs: 20, requestHandlerTimeoutSecs: 25,
      launchContext: { launcher: chromium, launchOptions: { headless: options.headless ?? false, timeout: 20000 } },
      browserPoolOptions: { useFingerprints: false, maxOpenPagesPerBrowser: 1 },
      preNavigationHooks: [async ({ page, request }, gotoOptions) => {
        const item = pending.get(request.uniqueKey);
        if (closed || restricted || !item) throw new NonRetryableError('MyHome request stopped before navigation');
        assertMyHomePage(request.url);
        item.page = page;
        gotoOptions.waitUntil = 'domcontentloaded';
        // Do not follow redirects to authentication or another origin/path.
        await page.route('**/*', async route => {
          const req = route.request();
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
            try { assertMyHomePage(req.url()); } catch { await route.abort(); return; }
          }
          await route.continue();
        });
        await options.beforeNavigation?.(page);
      }],
      requestHandler: async ({ page, request, response }) => {
        const item = pending.get(request.uniqueKey);
        if (!item) return;
        if (!response) throw new Error('Missing browser navigation response');
        assertMyHomePage(page.url());
        const headers = await response.allHeaders(), status = response.status(), html = await page.content();
        // Stop queued pages immediately, before adapter error propagation.
        if (status === 401 || status === 403 || headers['cf-mitigated'] === 'challenge'
          || (status === 200 && !html.includes('__NEXT_DATA__') && /cf_chl_|challenge-platform/.test(html))) restricted = true;
        item.resolve(new Response(html, { status, headers: {
          'content-type': headers['content-type'] ?? 'text/html',
          server: headers.server ?? '', 'cf-mitigated': headers['cf-mitigated'] ?? '',
        } }));
        pending.delete(request.uniqueKey);
      },
      failedRequestHandler: async ({ request }, error) => {
        pending.get(request.uniqueKey)?.reject(error);
        pending.delete(request.uniqueKey);
      },
    }, config);
    running = crawler.run().catch(error => { closed = true; rejectAll(error); });
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = assertMyHomePage(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected public Crawlee request method');
    init?.signal?.throwIfAborted();
    if (closed) throw new Error('MyHome Crawlee reader closed');
    if (restricted) throw new AcquisitionError(url.href, 403, 'ACCESS_RESTRICTED; Crawlee circuit open');
    initialization ??= initialize(); await initialization;
    init?.signal?.throwIfAborted();
    if (closed) throw new Error('MyHome Crawlee reader closed');
    if (pending.size >= 2) throw new Error('MyHome Crawlee bounded queue is full');
    const key = randomUUID(), started = Date.now();
    let abort: (() => void) | undefined;
    try {
      return await new Promise<Response>((resolve, reject) => {
        const item: Pending = { resolve, reject }; pending.set(key, item);
        abort = () => { pending.delete(key); reject(init?.signal?.reason ?? new Error('Aborted')); void item.page?.close().catch(() => {}); };
        init?.signal?.addEventListener('abort', abort, { once: true });
        void queue!.addRequest({ url: url.href, uniqueKey: key }).catch(error => { pending.delete(key); reject(error); });
      });
    } finally {
      if (abort) init?.signal?.removeEventListener('abort', abort);
      elapsed += Date.now() - started;
    }
  };
  return { fetcher, browserMs: () => elapsed, close: async () => {
    closed = true;
    for (const item of pending.values()) void item.page?.close().catch(() => {});
    rejectAll(new Error('MyHome Crawlee reader closed'));
    await initialization?.catch(() => {});
    await crawler?.stop(); await running;
    await queue?.drop();
  } };
}
