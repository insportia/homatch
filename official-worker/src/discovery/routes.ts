// routes.ts — the discovery HTTP surface of the official worker (PHASE 2).
//
// POST /discovery/fetch performs ONE SSRF-guarded, address-pinned HTTP hop for
// HOMATCH discovery (SafeFetch.ts). Callers are HOMATCH edge functions holding
// WORKER_TOKEN; a signed-in Supabase user is NOT accepted, so no browser can
// turn the worker into a fetcher. The edge runtime decides what may be fetched
// (allowlist, robots, rate limits) and follows redirects itself; this hop
// re-checks the target and never follows a redirect.
//
// Domain failures answer 200 with { ok: false, error: { kind } } so the edge
// gets a typed reason. Logs carry host, status, bytes and timing only -- never
// a body, never a header value, never the token.

import { URL } from 'node:url';
import { discoveryFetchLoad, safeFetch, SafeFetchError } from './SafeFetch.js';

export function mountDiscoveryRoutes(app: any, options: { token: string }) {
  const tokenOnly = (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization || '');
    if (options.token && header === `Bearer ${options.token}`) return next();
    return res.status(401).json({ ok: false, error: { kind: 'UNAUTHORIZED', message: 'worker token required' } });
  };
  const log = (fields: Record<string, unknown>) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), service: 'discovery', ...fields }));
  };

  app.get('/health/discovery', tokenOnly, (_req: any, res: any) => {
    res.json({ ok: true, fetch: discoveryFetchLoad() });
  });

  app.post('/discovery/fetch', tokenOnly, async (req: any, res: any) => {
    const body = req.body ?? {};
    const trace = String(req.headers['x-homatch-trace'] || '').slice(0, 64) || null;
    let host: string | null = null;
    try { host = new URL(String(body.url || '')).hostname; } catch { host = null; }
    try {
      const response = await safeFetch({
        url: String(body.url || ''),
        method: body.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: body.headers && typeof body.headers === 'object' ? body.headers : {},
        timeoutMs: Number(body.timeoutMs) || undefined,
        maxBytes: Number(body.maxBytes) || undefined,
      });
      log({ event: 'fetch', ok: true, host, status: response.status, bytes: response.bytes, truncated: response.truncated, ms: response.durationMs, trace });
      return res.json({ ok: true, response });
    } catch (error) {
      const kind = error instanceof SafeFetchError ? error.kind : 'NETWORK_ERROR';
      log({ event: 'fetch', ok: false, host, kind, trace });
      return res.json({ ok: false, error: { kind, message: kind } });
    }
  });

  log({ event: 'mounted' });
}
