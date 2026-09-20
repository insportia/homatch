/*
 * THE FETCHER THE CODE-ONLY CRAWLER USES.
 *
 * Plain public HTTP, identified as what it is, one request at a time per host
 * with a gap between them. A comparable sweep is a few dozen pages and the
 * sources owe us nothing.
 *
 * ── IDENTIFIED, NOT DISGUISED ────────────────────────────────────────
 *
 * The user agent says who we are and points at a page explaining it. A
 * research fetcher that dresses as Chrome is the first step toward the evasion
 * this system does not do, and it would make our own robots compliance
 * decorative — a site cannot set rules for a client it cannot recognise.
 *
 * A source that refuses this agent is recorded as refusing it. That is our
 * limitation to fix, never a fact about the street.
 */

import type { CrawlFetchResult, CrawlFetcher } from '../../research-core/market/codeDiscovery.ts';

export const CRAWL_USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

export interface HttpCrawlFetcherOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** Minimum gap between two requests to the same host. */
  minHostGapMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Media that cannot contain a listing, so is never worth downloading. */
const UNREADABLE = /image|video|audio|font|octet-stream|pdf|zip/i;

export function httpCrawlFetcher(options: HttpCrawlFetcherOptions = {}): CrawlFetcher {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const gap = options.minHostGapMs ?? 700;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 8_000_000;
  const lastAt = new Map<string, number>();

  return {
    id: 'PLAIN_HTTP',
    canDriveBrowser: false,
    async fetch(url: string): Promise<CrawlFetchResult> {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return { ok: false, status: 0, body: '' };
      }
      const wait = (lastAt.get(host) ?? 0) + gap - now();
      if (wait > 0) await sleep(wait);
      lastAt.set(host, now());

      try {
        const res = await doFetch(url, {
          headers: {
            'user-agent': options.userAgent ?? CRAWL_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { ok: false, status: res.status, body: '' };

        const type = res.headers.get('content-type') ?? '';
        if (UNREADABLE.test(type)) return { ok: false, status: res.status, body: '' };

        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared && declared > maxBytes) {
          return { ok: false, status: res.status, body: '' };
        }
        const body = await res.text();
        if (body.length > maxBytes) {
          return { ok: true, status: res.status, body: body.slice(0, maxBytes), contentType: type };
        }
        return { ok: true, status: res.status, body, contentType: type };
      } catch {
        // A timeout or a transport failure is our state, recorded as a failed
        // fetch and never as a source with nothing on it.
        return { ok: false, status: 0, body: '' };
      }
    },
  };
}
