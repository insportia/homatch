// startVerifyQueue.ts — wires the durable Verify queue into the worker process.
//
// Enabled only by VERIFY_QUEUE_ENABLED=1 (Railway variable), so deploying this
// code changes nothing until the owner turns it on. Per-replica capacity is
// configured, never guessed:
//   VERIFY_QUEUE_HTTP_SLOTS     concurrent API/document/CAPTCHA tasks (default 12)
//   VERIFY_QUEUE_BROWSER_SLOTS  concurrent Chromium tasks (default 3; ~400 MB each)
//   VERIFY_QUEUE_URL            defaults to $SUPABASE_URL/functions/v1/verify-queue
// Horizontal scale: run more replicas of this same service; claims are atomic
// in Postgres, so replicas never share or lose a task.

import { hostname } from 'node:os';
import type { JobBrowser } from '../browser/LocalBrowserRuntime.js';
import { createVerifyExecutor, type SourceRunner } from './executor.js';
import { QueueGateway } from './gateway.js';
import { QueueRunner } from './QueueRunner.js';

export function startVerifyQueue(deps: {
  orchestrator: SourceRunner;
  launchJobBrowser: (id: string) => Promise<JobBrowser>;
  closeJobBrowser: (b: JobBrowser, reason: string) => Promise<void>;
  beforeShutdown: (hook: () => Promise<void>) => void;
  env?: Record<string, string | undefined>;
}): QueueRunner | null {
  const env = deps.env ?? process.env;
  if (String(env.VERIFY_QUEUE_ENABLED ?? '') !== '1') return null;
  const url = env.VERIFY_QUEUE_URL || (env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/verify-queue` : '');
  const token = env.WORKER_TOKEN || '';
  if (!url || !token) {
    console.error('[verify-queue] enabled but VERIFY_QUEUE_URL/SUPABASE_URL or WORKER_TOKEN is missing; not starting');
    return null;
  }
  const num = (k: string, d: number, max: number) => {
    const n = Math.trunc(Number(env[k]));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : d;
  };
  const workerId = `${env.RAILWAY_REPLICA_ID || hostname()}-${process.pid}`.slice(0, 120);
  const gateway = new QueueGateway({ url, token });
  const runner = new QueueRunner({
    gateway,
    workerId,
    lanes: { HTTP: num('VERIFY_QUEUE_HTTP_SLOTS', 12, 64), BROWSER: num('VERIFY_QUEUE_BROWSER_SLOTS', 3, 16) },
    executor: createVerifyExecutor({ orchestrator: deps.orchestrator, launchBrowser: deps.launchJobBrowser, closeBrowser: deps.closeJobBrowser }),
    log: (event, data) => console.log(JSON.stringify({ level: 'info', scope: 'verify_queue', event, ...data })),
  });
  deps.beforeShutdown(() => runner.stop(25_000));
  runner.start();
  return runner;
}
