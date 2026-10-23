// CAMPAIGN RISK ENGINE — the network half: follow every link the way a recipient's click would.
//
// Owner brief §8: inspect the final destination and the redirect chain, detect broken links, and
// revalidate at submission and before dispatch, "using controlled server-side checks. Prevent
// SSRF, access to internal networks, and unsafe URL schemes."
//
// HOW IT STAYS SAFE
//   · Only http(s) on ports 80/443; every hop goes through checkUrl() first (scheme, IP literal,
//     internal suffixes, embedded credentials, gambling host) and is refused before any request.
//   · The host is resolved here (A and AAAA) and refused if ANY address is private, loopback,
//     link-local, CGNAT or multicast — so a public name pointing inside is not followed.
//   · Redirects are followed manually (redirect: 'manual'), at most MAX_HOPS, each hop re-checked.
//   · HEAD first, GET only when HEAD is refused; the body is never read beyond the response
//     head (cancelled immediately), no cookies, no credentials, a fixed user agent, a hard timeout.
//   · Nothing fetched is returned to the caller except status, hop URLs and findings.

import { checkUrl, crossDomainRedirect, isPrivateAddress, type Finding } from '../../../../src/emailMarketing/risk/links.ts';
import type { LinkInspection } from '../../../../src/emailMarketing/risk/engine.ts';

const MAX_HOPS = 5;
const TIMEOUT_MS = 4000;
const MAX_LINKS = 25;
const UA = 'HOMATCH-LinkCheck/1.0 (+https://www.homatch.live)';

type Resolver = (host: string) => Promise<string[]>;

async function denoResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const t of ['A', 'AAAA'] as const) {
    try { out.push(...(await Deno.resolveDns(host, t)) as string[]); } catch { /* no record of this type */ }
  }
  return out;
}

async function request(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept: '*/*' } });
    try { await res.body?.cancel(); } catch { /* already closed */ }
    return res;
  } finally { clearTimeout(t); }
}

export async function inspectLink(url: string, opts: { text?: string; kind?: 'a' | 'img'; resolve?: Resolver } = {}): Promise<LinkInspection> {
  const resolve = opts.resolve ?? denoResolve;
  const findings: Finding[] = [...checkUrl(url, { text: opts.text, kind: opts.kind })];
  const chain: string[] = [url];
  if (findings.some((f) => f.severity === 'BLOCK') || !/^https?:\/\//i.test(url)) {
    return { url, ok: !/^https?:\/\//i.test(url) && !findings.some((f) => f.severity === 'BLOCK'), chain, findings };
  }
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let host: string;
    try { host = new URL(current).hostname; } catch { findings.push({ code: 'LINK_MALFORMED', severity: 'HIGH', where: current }); return { url, ok: false, chain, findings }; }
    const addrs = /^[\d.]+$|:/.test(host) ? [host.replace(/^\[|\]$/g, '')] : await resolve(host);
    if (addrs.length === 0) {
      findings.push({ code: 'LINK_DNS_FAILED', severity: 'HIGH', where: current, detail: host });
      return { url, ok: false, chain, findings };
    }
    if (addrs.some(isPrivateAddress)) {
      findings.push({ code: hop ? 'REDIRECT_TO_PRIVATE_NETWORK' : 'LINK_PRIVATE_NETWORK', severity: 'BLOCK', where: current, detail: host });
      return { url, ok: false, chain, findings };
    }
    let res: Response;
    try {
      res = await request(current, 'HEAD');
      if (res.status === 405 || res.status === 501 || res.status === 403) res = await request(current, 'GET');
    } catch (e) {
      findings.push({ code: 'LINK_UNREACHABLE', severity: 'MEDIUM', where: current, detail: e instanceof Error ? e.name : 'error' });
      return { url, ok: false, chain, findings };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) { findings.push({ code: 'REDIRECT_WITHOUT_LOCATION', severity: 'MEDIUM', where: current }); return { url, ok: false, status: res.status, chain, findings }; }
      let next: string;
      try { next = new URL(loc, current).toString(); } catch { findings.push({ code: 'REDIRECT_MALFORMED', severity: 'HIGH', where: current }); return { url, ok: false, chain, findings }; }
      if (hop === MAX_HOPS) { findings.push({ code: 'REDIRECT_TOO_MANY', severity: 'HIGH', where: url, detail: String(MAX_HOPS) }); return { url, ok: false, chain, findings }; }
      if (crossDomainRedirect(current, next)) findings.push({ code: 'REDIRECT_CROSS_DOMAIN', severity: 'LOW', where: current, detail: new URL(next).hostname });
      const hopFindings = checkUrl(next, { hop: hop + 1 });
      for (const f of hopFindings) findings.push({ ...f, code: f.code.startsWith('LINK_') ? f.code.replace(/^LINK_/, 'REDIRECT_TO_') : f.code });
      chain.push(next);
      if (hopFindings.some((f) => f.severity === 'BLOCK')) return { url, ok: false, status: res.status, finalUrl: next, chain, findings };
      current = next;
      continue;
    }
    if (res.status >= 400) findings.push({ code: 'LINK_BROKEN', severity: 'HIGH', where: url, detail: String(res.status) });
    if (chain.length > 2 && crossDomainRedirect(url, current)) findings.push({ code: 'REDIRECT_CHAIN', severity: 'MEDIUM', where: url, detail: `${chain.length - 1} hops` });
    return { url, ok: res.status < 400, status: res.status, finalUrl: current, chain, findings };
  }
  return { url, ok: false, chain, findings };
}

/** Inspect every distinct link of a campaign (bounded), sequentially polite, in small batches. */
export async function inspectLinks(links: Array<{ url: string; text?: string; kind: 'a' | 'img' }>, resolve?: Resolver): Promise<LinkInspection[]> {
  const seen = new Set<string>();
  const unique = links.filter((l) => !seen.has(l.url) && seen.add(l.url) && !/^\{\{/.test(l.url)).slice(0, MAX_LINKS);
  const out: LinkInspection[] = [];
  for (let i = 0; i < unique.length; i += 5) {
    out.push(...await Promise.all(unique.slice(i, i + 5).map((l) => inspectLink(l.url, { text: l.text, kind: l.kind, resolve }))));
  }
  if (links.length > MAX_LINKS) out.push({ url: '(more links)', ok: false, chain: [], findings: [{ code: 'TOO_MANY_LINKS', severity: 'MEDIUM', detail: String(links.length) }] });
  return out;
}
