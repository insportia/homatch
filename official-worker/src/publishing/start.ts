// Wiring for index.ts: inert unless PUBLISHING_AUTOMATION_ENABLED=1.
import { chromium } from 'playwright';
import { QueueGateway } from '../queue/gateway.js';
import { PublishingRunner } from './runner.js';

export function startPublishingWorker(env: NodeJS.ProcessEnv = process.env): PublishingRunner | null {
  if (env.PUBLISHING_AUTOMATION_ENABLED !== '1') return null;
  // Publishing's own secret — never the WORKER_TOKEN the verify / research queues share.
  if (!env.SUPABASE_URL || !env.PUBLISHING_WORKER_TOKEN) { console.error('publishing-worker: SUPABASE_URL and PUBLISHING_WORKER_TOKEN required; not started'); return null; }
  const gateway = new QueueGateway({ url: `${env.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/publishing-worker`, token: env.PUBLISHING_WORKER_TOKEN, timeoutMs: 30_000 });
  const runner = new PublishingRunner({
    gateway,
    workerId: `railway-${process.pid}`,
    concurrency: Math.min(4, Math.max(1, Number(env.PUBLISHING_CONCURRENCY) || 2)),
    launch: () => chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] }),
  });
  runner.start();
  return runner;
}
