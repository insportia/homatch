// BrowserRender.ts — the DISCOVERY browser: one bounded render of one public page.
//
// PHASE 2 (docs/claude/PHASE2_DISCOVERY.md, "Browser discovery worker"). Some
// listing pages only exist after JavaScript runs. This renders such a page and
// returns its markup, nothing more.
//
// IT IS NOT VERIFY'S BROWSER. It imports nothing from src/browser,
// src/workflows, src/orchestrator or src/index.ts, launches its own short-lived
// Chromium per render, holds no profile, no extension, no session and no
// cookie jar between renders, and is mounted only on the token-only discovery
// routes.
//
// WHAT KEEPS IT BOUNDED
//   kill switch     DISCOVERY_BROWSER_ENABLED must be exactly "true"
//   allowlist       DISCOVERY_BROWSER_HOSTS: the only hosts a page may be
//                   navigated to (exact host or its subdomains); empty = none
//   network         Chromium never opens a connection itself. EVERY request
//                   the page makes is intercepted and either refused or
//                   fulfilled by the pinned SafeFetch hop (public unicast
//                   only, ports 80/443, no redirects followed, body capped).
//                   Images, media, fonts and websockets are refused outright.
//   limits          one top-level URL, at most MAX_NAVIGATIONS main-frame
//                   navigations, MAX_SUBREQUESTS fetches, MAX_TOTAL_BYTES in,
//                   a hard wall-clock timeout, concurrency 1 (max 2)
//   honesty         identifies itself (no UA spoofing); a challenge, CAPTCHA
//                   or login wall is reported as such and never worked around
//   output          markup with executable scripts removed (JSON data blocks
//                   such as ld+json and __NEXT_DATA__ are kept), capped
//
// The edge decides WHAT to render (source allowlist, robots, rate limits) and
// owns the job lease; this only performs the render. No Supabase key exists
// on this side.

import { URL } from 'node:url';
import { resolveSafeTarget, sendPinned, SafeFetchError, type SafeFetchRequest, type SafeFetchResponse } from './SafeFetch.js';

export type RenderErrorKind =
  | 'DISABLED' | 'HOST_NOT_ALLOWED' | 'BAD_URL' | 'BLOCKED_ADDRESS' | 'TOO_BUSY' | 'TIMEOUT'
  | 'NAVIGATION_LIMIT' | 'BROWSER_UNAVAILABLE' | 'CHALLENGE' | 'LOGIN_WALL' | 'NETWORK_ERROR';

export class RenderError extends Error {
  constructor(readonly kind: RenderErrorKind, message: string) { super(message); }
}

export interface RenderRequest {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface RenderResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  bytes: number;
  truncated: boolean;
  renderMs: number;
  subrequests: number;
  refusedRequests: number;
  transferBytes: number;
}

export const MAX_NAVIGATIONS = 3;
export const MAX_SUBREQUESTS = 80;
export const MAX_TOTAL_BYTES = 12_000_000;
export const MAX_HTML_BYTES = 3_000_000;
export const MAX_RENDER_MS = 45_000;
const DEFAULT_RENDER_MS = 30_000;
const REFUSED_TYPES = new Set(['image', 'media', 'font', 'websocket', 'eventsource', 'manifest', 'texttrack', 'other']);

export const DISCOVERY_BROWSER_UA =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits; discovery-browser)';

export interface BrowserRenderConfig {
  enabled: boolean;
  hosts: string[];
  concurrency: number;
}

export function browserRenderConfig(env: Record<string, string | undefined> = process.env): BrowserRenderConfig {
  return {
    enabled: env.DISCOVERY_BROWSER_ENABLED === 'true',
    hosts: String(env.DISCOVERY_BROWSER_HOSTS || '')
      .split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)),
    concurrency: Math.max(1, Math.min(2, Number(env.DISCOVERY_BROWSER_CONCURRENCY) || 1)),
  };
}

export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowlist.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** Remove executable script blocks; keep JSON data blocks (ld+json, __NEXT_DATA__, application/json). */
export function sanitizeMarkup(html: string): string {
  return html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs: string) =>
      /type\s*=\s*["']?application\/(?:ld\+)?json/i.test(attrs) ? whole : '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

const CHALLENGE = /cf-chl|challenge-platform|captcha|Just a moment\.\.\.|Attention Required|Access denied|verify you are human/i;
const LOGIN = /\/(login|signin|sign-in|auth|checkpoint)(\/|\?|$)/i;

/** A pinned GET performed for the page. Injected in tests. */
export type PinnedFetcher = (request: SafeFetchRequest) => Promise<SafeFetchResponse>;

export const pinnedFetcher: PinnedFetcher = async (request) => sendPinned(await resolveSafeTarget(request.url), request);

let inFlight = 0;
export function browserRenderLoad(config = browserRenderConfig()) {
  return { inFlight, max: config.concurrency, enabled: config.enabled, hosts: config.hosts.length };
}

type Launcher = () => Promise<any>;
const defaultLauncher: Launcher = async () => {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-first-run'] });
};

export async function renderPage(
  request: RenderRequest,
  deps: { config?: BrowserRenderConfig; fetcher?: PinnedFetcher; launch?: Launcher } = {},
): Promise<RenderResult> {
  const config = deps.config ?? browserRenderConfig();
  if (!config.enabled) throw new RenderError('DISABLED', 'discovery browser is switched off');
  let target: URL;
  try { target = new URL(String(request.url || '')); } catch { throw new RenderError('BAD_URL', 'unparseable URL'); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new RenderError('BAD_URL', target.protocol);
  if (target.username || target.password) throw new RenderError('BAD_URL', 'credentials in URL');
  if (!hostAllowed(target.hostname, config.hosts)) throw new RenderError('HOST_NOT_ALLOWED', target.hostname);
  if (inFlight >= config.concurrency) throw new RenderError('TOO_BUSY', 'discovery browser concurrency reached');

  const fetcher = deps.fetcher ?? pinnedFetcher;
  const launch = deps.launch ?? defaultLauncher;
  const timeoutMs = Math.max(5_000, Math.min(MAX_RENDER_MS, Number(request.timeoutMs) || DEFAULT_RENDER_MS));
  const maxHtml = Math.max(10_000, Math.min(MAX_HTML_BYTES, Number(request.maxBytes) || MAX_HTML_BYTES));
  const userAgent = DISCOVERY_BROWSER_UA;
  const started = Date.now();
  let subrequests = 0;
  let refused = 0;
  let transferBytes = 0;
  let navigations = 0;
  let mainStatus = 0;
  let browser: any = null;

  inFlight += 1;
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new RenderError('TIMEOUT', `render exceeded ${timeoutMs}ms`)), timeoutMs).unref?.());
  try {
    try { browser = await launch(); } catch (error) {
      throw new RenderError('BROWSER_UNAVAILABLE', error instanceof Error ? error.message.slice(0, 120) : 'launch failed');
    }
    const context = await browser.newContext({
      userAgent, javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: 'block',
      bypassCSP: false, ignoreHTTPSErrors: false, permissions: [], locale: 'ka-GE',
    });
    await context.route('**/*', async (route: any) => {
      const req = route.request();
      const url = String(req.url());
      const type = String(req.resourceType());
      const isNavigation = req.isNavigationRequest() && req.frame() === page.mainFrame();
      let parsed: URL | null = null;
      try { parsed = new URL(url); } catch { parsed = null; }
      const refuse = async () => { refused += 1; await route.abort('blockedbyclient'); };
      if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        return refuse();
      }
      if (REFUSED_TYPES.has(type)) return refuse();
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return refuse();
      if (isNavigation && !hostAllowed(parsed.hostname, config.hosts)) return refuse();
      if (subrequests >= MAX_SUBREQUESTS || transferBytes >= MAX_TOTAL_BYTES) return refuse();
      subrequests += 1;
      try {
        const response = await fetcher({
          url,
          method: req.method() === 'HEAD' ? 'HEAD' : 'GET',
          headers: { 'user-agent': userAgent, accept: String(req.headers().accept || '*/*'), 'accept-language': 'ka,en;q=0.8,ru;q=0.6' },
          timeoutMs: Math.min(15_000, timeoutMs),
          maxBytes: Math.min(4_000_000, MAX_TOTAL_BYTES - transferBytes),
        });
        transferBytes += response.bytes;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers)) {
          if (!/^(content-length|content-encoding|transfer-encoding|connection|set-cookie|strict-transport-security|alt-svc)$/i.test(k)) headers[k] = v;
        }
        await route.fulfill({ status: response.status, headers, body: response.body });
      } catch (error) {
        refused += 1;
        await route.abort(error instanceof SafeFetchError && error.kind === 'BLOCKED_ADDRESS' ? 'addressunreachable' : 'failed');
      }
    });
    const page = await context.newPage();
    page.on('framenavigated', (frame: any) => { if (frame === page.mainFrame()) navigations += 1; });

    const work = (async () => {
      const response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      mainStatus = response ? response.status() : 0;
      await page.waitForLoadState('networkidle', { timeout: Math.min(8_000, timeoutMs) }).catch(() => undefined);
      if (navigations > MAX_NAVIGATIONS) throw new RenderError('NAVIGATION_LIMIT', `${navigations} navigations`);
      const finalUrl = page.url();
      const html = String(await page.content());
      return { finalUrl, html };
    })();
    const { finalUrl, html } = await Promise.race([work, deadline]);

    const final = new URL(finalUrl);
    if (!hostAllowed(final.hostname, config.hosts) || LOGIN.test(final.pathname)) {
      throw new RenderError('LOGIN_WALL', `landed on ${final.hostname}${final.pathname.slice(0, 40)}`);
    }
    const head = html.slice(0, 200_000);
    if (CHALLENGE.test(head) && !/application\/ld\+json/i.test(head)) {
      throw new RenderError('CHALLENGE', 'challenge or block page; not worked around');
    }
    const clean = sanitizeMarkup(html);
    const encoded = new TextEncoder().encode(clean);
    const bytes = encoded.length;
    const truncated = bytes > maxHtml;
    return {
      url: target.toString(), finalUrl, status: mainStatus,
      html: truncated ? new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxHtml)) : clean,
      bytes: Math.min(bytes, maxHtml), truncated,
      renderMs: Date.now() - started, subrequests, refusedRequests: refused, transferBytes,
    };
  } catch (error) {
    if (error instanceof RenderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout/i.test(message)) throw new RenderError('TIMEOUT', message.slice(0, 120));
    throw new RenderError('NETWORK_ERROR', message.slice(0, 120));
  } finally {
    inFlight -= 1;
    if (browser) await browser.close().catch(() => undefined);
  }
}
