// HOMATCH RESEARCH CORE — one page render, performed by the official worker's
// DISCOVERY browser (official-worker/src/discovery/BrowserRender.ts).
//
// PHASE 2. A source whose pages only exist after JavaScript runs is read
// through POST {worker}/discovery/render. Everything above the transport still
// runs here first -- the host allowlist, robots.txt, rate limits, circuit
// breakers -- and the worker re-checks its own allowlist, refuses every
// non-public address and fulfils every subrequest through its pinned hop.
//
// Off unless BOTH switches say on: admin_settings.discovery_browser_enabled on
// this side (the caller decides whether to construct this at all) and
// DISCOVERY_BROWSER_ENABLED on the worker. Nothing here is Verify's browser.
//
// COST: each render is metered (render time, transfer bytes) into `usage`, and
// `estimatedCostUsd()` turns it into COGS with the documented rate below.

import { TimeoutError } from '../core/errors.ts';
import type { RawRequest, RawResponse, Transport } from './transport.ts';

/*
 * ESTIMATE, NOT MEASURED. Railway bills ~$20 per vCPU-month and ~$10 per
 * GB-month of memory, i.e. ~$0.0000077 per vCPU-second and ~$0.0000039 per
 * GB-second, plus ~$0.05 per GB egress. A headless render holds ~1 vCPU and
 * ~0.5 GB while it runs. Replace with measured numbers after the controlled
 * live proof (docs/claude/PHASE2_DISCOVERY.md, COGS).
 */
export const BROWSER_COGS_USD_PER_SECOND = 0.0000077 + 0.5 * 0.0000039;
export const BROWSER_COGS_USD_PER_GB_TRANSFER = 0.05;

/** Text a browser wraps around a plain-text or XML document (robots.txt, a sitemap), unwrapped. */
export function unwrapRenderedText(body: string): string {
  if (/^\s*(<\?xml|<urlset|<sitemapindex|user-agent|sitemap:|#)/i.test(body)) return body;
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(body);
  const raw = pre ? pre[1] : body;
  return raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export interface BrowserUsage {
  renders: number;
  renderMs: number;
  transferBytes: number;
  refusals: number;
}

export function estimatedCostUsd(usage: BrowserUsage): number {
  const seconds = usage.renderMs / 1000;
  const gb = usage.transferBytes / 1_000_000_000;
  return Math.round((seconds * BROWSER_COGS_USD_PER_SECOND + gb * BROWSER_COGS_USD_PER_GB_TRANSFER) * 1e6) / 1e6;
}

export interface BrowserTransportOptions {
  baseUrl: string;
  token: string;
  trace?: string;
  fetchImpl?: typeof fetch;
}

export class BrowserTransportError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) { super(message); this.kind = kind; }
}

export class BrowserTransport implements Transport {
  readonly name = 'discovery-browser';
  /** The worker fulfils every request through its pinned hop (BrowserRender.ts). */
  readonly pinsAddresses = true;
  readonly usage: BrowserUsage = { renders: 0, renderMs: 0, transferBytes: 0, refusals: 0 };

  private readonly options: BrowserTransportOptions;
  constructor(options: BrowserTransportOptions) { this.options = options; }

  get configured(): boolean {
    return Boolean(this.options.baseUrl && this.options.token);
  }

  async send(request: RawRequest): Promise<RawResponse> {
    if (!this.configured) throw new BrowserTransportError('NOT_CONFIGURED', 'WORKER_URL or WORKER_TOKEN is not configured');
    if (request.method !== 'GET') throw new BrowserTransportError('METHOD_NOT_ALLOWED', 'the discovery browser only renders GET');
    const doFetch = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs + 10_000);
    const started = Date.now();
    try {
      const response = await doFetch(`${this.options.baseUrl.replace(/\/$/, '')}/discovery/render`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          ...(this.options.trace ? { 'x-homatch-trace': this.options.trace } : {}),
        },
        body: JSON.stringify({ url: request.url, timeoutMs: request.timeoutMs, maxBytes: request.maxBytes }),
        signal: controller.signal,
      });
      if (response.status === 401) throw new BrowserTransportError('AUTH_FAILED', 'WORKER_TOKEN_REJECTED');
      const payload = await response.json().catch(() => null) as
        | { ok: true; render: { finalUrl: string; status: number; html: string; bytes: number; truncated: boolean; renderMs: number; transferBytes: number } }
        | { ok: false; error: { kind: string } }
        | null;
      if (!payload) throw new BrowserTransportError('BAD_RESPONSE', `worker answered ${response.status}`);
      if (!payload.ok) {
        this.usage.refusals += 1;
        if (payload.error.kind === 'TIMEOUT') throw new TimeoutError('Discovery render exceeded its timeout', { timeoutMs: request.timeoutMs });
        throw new BrowserTransportError(payload.error.kind, payload.error.kind);
      }
      const r = payload.render;
      this.usage.renders += 1;
      this.usage.renderMs += Number(r.renderMs) || 0;
      this.usage.transferBytes += Number(r.transferBytes) || 0;
      return {
        url: r.finalUrl || request.url,
        status: r.status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'x-homatch-rendered': 'browser' },
        body: r.html,
        bytes: r.bytes,
        truncated: r.truncated,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError('Discovery render exceeded its timeout', { timeoutMs: request.timeoutMs });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Routes each hop: hosts that need a browser go to `browser`, everything else
 * (and every robots.txt, which must be read as text) to `http`.
 */
export class RoutingTransport implements Transport {
  readonly name = 'routing';
  readonly pinsAddresses: boolean;
  private readonly http: Transport;
  private readonly browser: Transport;
  private readonly browserHosts: readonly string[];
  constructor(http: Transport, browser: Transport, browserHosts: readonly string[]) {
    this.http = http;
    this.browser = browser;
    this.browserHosts = browserHosts;
    this.pinsAddresses = http.pinsAddresses && browser.pinsAddresses;
  }

  usesBrowser(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.pathname === '/robots.txt') return false;
      const host = u.hostname.toLowerCase();
      return this.browserHosts.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }

  async send(request: RawRequest): Promise<RawResponse> {
    if (!this.usesBrowser(request.url)) {
      const response = await this.http.send(request);
      /* robots.txt of a browser-only host: a WAF refusal is retried once through the browser. */
      const isRobots = /\/robots\.txt(\?|$)/.test(request.url);
      if (isRobots && (response.status === 401 || response.status === 403) && this.browserHosts.some((h) => request.url.includes(h))) {
        const rendered = await this.browser.send(request);
        return { ...rendered, body: unwrapRenderedText(rendered.body), headers: { ...rendered.headers, 'content-type': 'text/plain' } };
      }
      return response;
    }
    return this.browser.send(request);
  }
}
