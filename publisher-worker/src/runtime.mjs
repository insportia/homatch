import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PublishingEngine } from './engine.mjs';
import { SupabasePublishingStore } from './supabase-store.mjs';
import { BrowserPool } from './browser-pool.mjs';

const integer = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error('INVALID_PUBLISHER_CONFIGURATION');
  return n;
};
export function runtimeConfig(env) {
  return {
    port: integer(env.PORT, 8080, 1, 65535),
    concurrency: integer(env.PUBLISHER_CONCURRENCY, 2, 1, 8),
    maxRssMb: integer(env.PUBLISHER_MAX_RSS_MB, 1536, 256, 8192),
    pollMs: integer(env.PUBLISHER_POLL_MS, 3000, 1000, 60000),
  };
}
function wait(ms, signal) {
  return new Promise((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(stop, ms);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

/** Adapters must be supplied explicitly. There is no dynamically fetched/evaluated browser code. */
export async function startPublisher({
  env = process.env,
  adapters = new Map(),
  store: suppliedStore,
  launch,
} = {}) {
  const config = runtimeConfig(env);
  const store =
    suppliedStore ??
    new SupabasePublishingStore({
      url: env.SUPABASE_URL,
      serviceKey: env.PUBLISHER_DATABASE_KEY,
    });
  const controller = new AbortController();
  const workerId = `publisher-${randomUUID()}`;
  const pool = new BrowserPool({
    maxContexts: config.concurrency,
    launch:
      launch ??
      (async () => {
        const { chromium } = await import('playwright');
        return chromium.launch({ headless: true });
      }),
  });
  const engine = new PublishingEngine({ store, adapters, workerId });
  let lastDatabaseSuccess = 0;
  let stopping = false;
  let healthBusy = false;
  const health = async () => {
    if (healthBusy) return;
    healthBusy = true;
    try {
      await store.health({
        workerId,
        adapterVersions: Object.fromEntries(
          [...adapters].map(([id, a]) => [id, a.version]),
        ),
        activeContexts: pool.active,
        rssBytes: process.memoryUsage().rss,
      });
      lastDatabaseSuccess = Date.now();
    } catch {
      /* Health response reports unavailable; no arbitrary database errors or secrets are logged. */
    } finally {
      healthBusy = false;
    }
  };
  const server = createServer((request, response) => {
    if (!['/health', '/ready'].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    const ready =
      !stopping &&
      Date.now() - lastDatabaseSuccess < 45000 &&
      process.memoryUsage().rss < config.maxRssMb * 1048576;
    response.writeHead(request.url === '/ready' && !ready ? 503 : 200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        status: stopping ? 'draining' : ready ? 'ready' : 'unavailable',
        activeContexts: pool.active,
        adapterCount: adapters.size,
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '0.0.0.0', resolve);
  });
  await health();
  const heartbeat = setInterval(() => void health(), 15000);
  const lanes = Array.from({ length: config.concurrency }, async () => {
    while (!controller.signal.aborted) {
      if (process.memoryUsage().rss > config.maxRssMb * 1048576) {
        await wait(config.pollMs, controller.signal);
        continue;
      }
      try {
        const claimed = await engine.tick(controller.signal);
        lastDatabaseSuccess = Date.now();
        if (!claimed) await wait(config.pollMs, controller.signal);
      } catch {
        await wait(config.pollMs, controller.signal);
      }
    }
  });
  const close = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    controller.abort();
    await pool.close();
    await Promise.allSettled(lanes);
    await new Promise((resolve) => server.close(resolve));
  };
  return { close, server, pool, workerId };
}
