// The only outbound requests Publishing makes from the edge: a portal's robots.txt,
// a public listing page on the portal's own hosts, and (an admin's re-check) a
// portal's home page. Shared by publishing-engine and publishing-worker.

import { type ProviderAdapter, type ProviderConfig, robotsAllows } from './providers.ts';

const UA = 'Mozilla/5.0 (compatible; HOMATCH-ListingCheck/1.0; +https://homatch.live)';

/** GET with no redirects followed, 10 s, body capped. */
export async function get(url: string, cap: number) {
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } });
  } catch (e) {
    return { status: (e instanceof DOMException && e.name === 'TimeoutError') ? 'TIMEOUT' as const : 'NETWORK' as const };
  }
  if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, location: response.headers.get('location') }; }
  const reader = response.body?.getReader();
  let body = '', size = 0;
  const decoder = new TextDecoder();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    body += decoder.decode(value, { stream: true });
    if (size > cap) { await reader.cancel(); break; }
  }
  return { status: 200, body };
}

/**
 * GET the public listing page: the portal's own https hosts only (the URL was
 * parsed against them, and so is every redirect), at most 3 redirects, 10 s,
 * 2 MB — and only when the host's robots.txt allows it. An unreadable robots.txt
 * (404, timeout) is treated as allowing, as RFC 9309 says.
 */
export async function fetchListingPage(url: string, adapter: ProviderAdapter) {
  if (!adapter.canCheckPage()) return { status: 'ROBOTS_DISALLOWED' as const };
  let current = url;
  const robots = new Map<string, string>();
  for (let hop = 0; hop < 4; hop++) {
    const target = new URL(current);
    if (target.protocol !== 'https:' || target.port || !adapter.hostAllowed(target.hostname)) return { status: 'REDIRECT_OFF_PORTAL' as const };
    if (!robots.has(target.host)) {
      const r = await get(`https://${target.host}/robots.txt`, 200_000);
      robots.set(target.host, r.status === 200 ? (r as { body: string }).body : '');
    }
    if (!robotsAllows(robots.get(target.host)!, target.pathname + target.search, 'HOMATCH-ListingCheck')) return { status: 'ROBOTS_DISALLOWED' as const };
    const page = await get(current, 2_000_000);
    if (typeof page.status === 'number' && page.status >= 300 && page.status < 400) {
      const next = (page as { location?: string | null }).location;
      if (!next) return { status: page.status };
      current = new URL(next, current).toString();
      continue;
    }
    return page;
  }
  return { status: 'REDIRECT_OFF_PORTAL' as const };
}

/** An admin's re-check: is the portal's home page reachable at all. Never for an owner-confirmed portal. */
export async function probeProvider(config: ProviderConfig) {
  if (config.verification !== 'PAGE_CHECK') return { status: 'SKIPPED', detail: config.verificationNote ?? 'NOT_CHECKED' };
  const r = await get(config.siteUrl, 300_000);
  if (r.status === 200) return { status: 'REACHABLE', detail: 'HTTP_200' };
  if (typeof r.status === 'number' && r.status >= 300 && r.status < 400) return { status: 'REACHABLE', detail: `HTTP_${r.status}` };
  return { status: 'UNREACHABLE', detail: typeof r.status === 'number' ? `HTTP_${r.status}` : r.status };
}

