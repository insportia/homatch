/*
 * Authorization for the worker's privileged HTTP routes (/research*, /verify/*,
 * /tas/test, /debug/*, /health/<detail>).
 *
 * Server-to-server only: the caller must present `Authorization: Bearer
 * <WORKER_TOKEN>`. Every legitimate caller is an Edge Function holding that
 * secret (research-agent `wf()`, storage-retention, source-audit,
 * supply-discovery, community-sync).
 *
 * Until 2026-10-18 any valid Supabase user session was accepted as well (the
 * worker asked /auth/v1/user). Nothing in the product used that path, and it let
 * a signed-in customer start a Verify run on the public Railway domain without
 * research-agent's wallet reservation, the `verify` service switch, the
 * anonymous/IP limits or job admission (capacity audit 2026-10-18, P1 #1).
 *
 * Fails closed: with no token configured every privileged request is refused
 * (503) instead of falling open. The presented value is never logged or echoed.
 */
import { timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of an Authorization header against `Bearer <token>`. */
export function bearerMatches(header: unknown, token: string): boolean {
  if (typeof header !== 'string' || typeof token !== 'string' || !token) return false;
  const expected = new Uint8Array(Buffer.from(`Bearer ${token}`, 'utf8'));
  const presented = new Uint8Array(Buffer.from(header, 'utf8'));
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export type WorkerAuthMiddleware = (req: any, res: any, next: () => void) => void;

/** Express middleware: WORKER_TOKEN bearer only. */
export function createWorkerAuth(token: string): WorkerAuthMiddleware {
  const configured = typeof token === 'string' && token.length > 0;
  return (req, res, next) => {
    if (!configured) return res.status(503).json({ error: 'worker_not_configured' });
    if (bearerMatches(req?.headers?.authorization, token)) return next();
    return res.status(401).json({ error: 'unauthorized' });
  };
}
