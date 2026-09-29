// routes.ts — the Telegram HTTP surface of the official worker.
//
// Callers are HOMATCH edge functions holding WORKER_TOKEN. Unlike the Verify
// endpoints, a signed-in Supabase user is NOT accepted here: nothing a
// browser does should reach the authorised Telegram session directly.
//
// Domain failures (rate limited, private chat, not configured) answer 200 with
// { ok: false, error } so the caller gets a typed reason, not an HTTP guess.
// Every response and every log line passes through redactTelegramSecrets.

import { redactTelegramSecrets, WorkerTelegramError } from './TelegramModel.js';
import { TelegramGateway, telegramEnvFromProcess, type TelegramEnv } from './TelegramGateway.js';
import type { TelegramDriver } from './TelegramGateway.js';

const HEALTH_PROBE_TTL_MS = 60_000;

export function mountTelegramRoutes(
  app: any,
  options: { token: string; env?: TelegramEnv; driverFactory: (env: TelegramEnv) => TelegramDriver },
): TelegramGateway {
  const env = options.env ?? telegramEnvFromProcess();
  const secrets = [env.session, env.apiHash, options.token];
  const gateway = new TelegramGateway({ env, driverFactory: options.driverFactory });
  let lastProbeAt = 0;

  const tokenOnly = (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization || '');
    if (options.token && header === `Bearer ${options.token}`) return next();
    return res.status(401).json({ ok: false, error: { kind: 'UNAUTHORIZED', message: 'worker token required' } });
  };

  const log = (fields: Record<string, unknown>) => {
    console.log(redactTelegramSecrets(JSON.stringify({ at: new Date().toISOString(), service: 'telegram', ...fields }), secrets));
  };

  const handle = (op: string, work: (body: any) => Promise<unknown>) => async (req: any, res: any) => {
    const started = Date.now();
    const trace = String(req.headers['x-homatch-trace'] || '').slice(0, 64) || null;
    try {
      const result = await work(req.body ?? {});
      log({ event: 'call', op, ok: true, ms: Date.now() - started, trace, count: countOf(result) });
      return res.json({ ok: true, result });
    } catch (error) {
      const typed = error instanceof WorkerTelegramError
        ? error
        : new WorkerTelegramError('NETWORK_ERROR', 'UNCLASSIFIED_FAILURE');
      const message = redactTelegramSecrets(typed.message, secrets);
      log({ event: 'call', op, ok: false, kind: typed.kind, code: message, ms: Date.now() - started, trace });
      return res.json({
        ok: false,
        error: { kind: typed.kind, message, retryAfterSeconds: typed.retryAfterSeconds },
        status: gateway.status(),
      });
    }
  };

  app.get('/health/telegram', tokenOnly, async (req: any, res: any) => {
    const probe = String(req.query?.probe || '') === '1';
    if (probe && Date.now() - lastProbeAt > HEALTH_PROBE_TTL_MS) {
      lastProbeAt = Date.now();
      return res.json({ ok: true, status: await gateway.health(), probed: true });
    }
    return res.json({ ok: true, status: gateway.status(), probed: false });
  });

  app.post('/telegram/resolve', tokenOnly, handle('resolve', (b) => gateway.resolve(b.username)));
  app.post('/telegram/history', tokenOnly, handle('history', (b) =>
    gateway.history(b.username, { cursor: b.cursor, limit: b.limit })));
  app.post('/telegram/replies', tokenOnly, handle('replies', (b) =>
    gateway.replies(b.username, b.messageId, { cursor: b.cursor, limit: b.limit })));
  app.post('/telegram/search', tokenOnly, handle('search', (b) => gateway.search(b.query, b.limit)));

  log({ event: 'mounted', configured: gateway.status().configured, enabled: env.enabled });
  return gateway;
}

function countOf(result: unknown): number | null {
  if (Array.isArray(result)) return result.length;
  const items = (result as { items?: unknown[] } | null)?.items;
  return Array.isArray(items) ? items.length : null;
}
