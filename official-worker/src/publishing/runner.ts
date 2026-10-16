// THE PUBLISHING BROWSER WORKER — claims operations from publishing-worker,
// runs each one in its own isolated browser context with the portal account's
// restored session, and reports the outcome.
//
//   Isolation      one browser, one fresh context per operation (no cookies, storage
//                  or cache shared across accounts or customers); closed afterwards.
//   Concurrency    at most `concurrency` operations at once; the database also
//                  allows only one running operation per portal account.
//   Leases         a heartbeat every 30 s extends the lease and records the stage;
//                  a lost lease aborts the operation at its next step.
//   Never twice    the adapter must pass the database's submit door before the
//                  final publish click; a crash after it is reconciled, never retried.
//   Sessions       held in memory only; refreshed cookies are sent back to be re-sealed.
//                  Never logged, never written to disk.
//   Evidence       screenshots at the decisive steps go to the private artifacts bucket.

import type { Browser, BrowserContext } from 'playwright';
import { type OpResult, type Photo, type Task, StopError } from './contract.js';
import { adapterFor } from './adapters/index.js';

export interface Gateway { call<T = any>(action: string, body?: Record<string, unknown>): Promise<T> }
export interface RunnerOptions {
  gateway: Gateway;
  launch: () => Promise<Browser>;
  workerId: string;
  portals?: string[];
  concurrency?: number;
  pollMs?: number;
  leaseSeconds?: number;
  fetcher?: typeof fetch;
  pacingMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const MAX_PHOTO_BYTES = 8_000_000;
/** Inputs whose content must never appear in a screenshot. Nothing is typed into them, but a portal may prefill. */
const SECRET_INPUTS = 'input[type=password], input[autocomplete=one-time-code], input[autocomplete=current-password], input[autocomplete=new-password], input[name*=otp i], input[name*=code i][maxlength="6"]';
const HOUSEKEEPING_MS = 60 * 60_000;

/** Every capture the worker stores goes through here: secret inputs are painted over. */
export const captureMasked = (page: import('playwright').Page, fullPage = true) =>
  page.screenshot({ fullPage, type: 'png', mask: [page.locator(SECRET_INPUTS)], maskColor: '#000' });
function sniff(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export class PublishingRunner {
  private browser: Browser | null = null;
  private running = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private lastHousekeeping = 0;
  readonly stats = { claimed: 0, succeeded: 0, prepared: 0, failed: 0, blocked: 0, reconcile: 0, lastError: null as string | null, lastPollAt: null as string | null };

  constructor(private o: RunnerOptions) {}

  status() { return { running: this.running, stopped: this.stopped, portals: this.portals(), ...this.stats }; }
  private portals() { return this.o.portals ?? ['myhome', 'ssge']; }
  private log(event: string, data: Record<string, unknown> = {}) { (this.o.log ?? ((e, d) => console.log(JSON.stringify({ at: 'publishing-worker', event: e, ...d }))))(event, data); }

  start() {
    const tick = async () => {
      if (this.stopped) return;
      try { await this.poll(); } catch (e) { this.stats.lastError = e instanceof Error ? e.message.slice(0, 200) : 'POLL_FAILED'; }
      this.timer = setTimeout(tick, this.o.pollMs ?? 10_000);
    };
    void tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running > 0) await new Promise((r) => setTimeout(r, 200));
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  /** One claim round; resolves when the claimed operations finished. */
  async poll() {
    const free = (this.o.concurrency ?? 2) - this.running;
    this.stats.lastPollAt = new Date().toISOString();
    if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_MS) {
      this.lastHousekeeping = Date.now();
      // Retention of screenshots (30 days; at once for deleted listings) — best effort.
      try { await this.o.gateway.call('housekeeping', {}); } catch { /* next hour */ }
    }
    if (free <= 0) return;
    const { tasks } = await this.o.gateway.call<{ tasks: Task[] }>('claim', { worker: this.o.workerId, portals: this.portals(), leaseSeconds: this.o.leaseSeconds ?? 300 });
    const mine = (tasks ?? []).slice(0, free);
    this.stats.claimed += mine.length;
    await Promise.all(mine.map((t) => this.execute(t)));
  }

  private async getBrowser() {
    if (!this.browser || !this.browser.isConnected()) this.browser = await this.o.launch();
    return this.browser;
  }

  private async photos(task: Task): Promise<Photo[]> {
    const out: Photo[] = [];
    const fetcher = this.o.fetcher ?? fetch;
    for (const [i, p] of (task.photos ?? []).entries()) {
      const r = await fetcher(p.url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new StopError('PHOTO_DOWNLOAD_FAILED', true);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const buffer = Buffer.from(bytes as any) as Buffer;
      if (buffer.length < 12 || buffer.length > MAX_PHOTO_BYTES) throw new StopError('PHOTO_SIZE_INVALID');
      const mimeType = sniff(buffer);
      if (!mimeType) throw new StopError('PHOTO_FORMAT_INVALID');
      out.push({ name: `homatch-${String(i + 1).padStart(2, '0')}.${mimeType.split('/')[1].replace('jpeg', 'jpg')}`, mimeType, buffer });
    }
    return out;
  }

  async execute(task: Task): Promise<OpResult> {
    this.running++;
    const g = this.o.gateway;
    let leaseLost = false;
    let stage = 'CLAIMED';
    const beat = async () => {
      try { const r = await g.call<{ ok: boolean }>('heartbeat', { id: task.id, token: task.leaseToken, stage, leaseSeconds: this.o.leaseSeconds ?? 300 }); if (!r.ok) leaseLost = true; } catch { /* transient; the lease has margin */ }
    };
    const heart = setInterval(beat, 30_000);
    let context: BrowserContext | null = null;
    let result: OpResult;
    try {
      const adapter = adapterFor(task.portalId);
      if (!adapter) throw new StopError('NO_ADAPTER');
      if (adapter.capabilities[task.kind] === 'NOT_EXPLORED') throw new StopError('OPERATION_NOT_EXPLORED');
      if (!task.session) throw new StopError('SESSION_REQUIRED');
      const browser = await this.getBrowser();
      context = await browser.newContext({ storageState: task.session as any, locale: 'ka-GE', timezoneId: 'Asia/Tbilisi', viewport: { width: 1366, height: 900 }, acceptDownloads: false });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      const ctx = {
        page, task,
        photos: ['CREATE', 'PHOTOS', 'UPDATE'].includes(task.kind) ? await this.photos(task) : [],
        stage: async (s: string) => { if (leaseLost) throw new StopError('LEASE_LOST', true); stage = s; await beat(); if (leaseLost) throw new StopError('LEASE_LOST', true); },
        screenshot: async (s: string) => {
          try {
            const png = await captureMasked(page);
            const up = await g.call<{ uploadUrl: string }>('artifact', { id: task.id, token: task.leaseToken, kind: 'SCREENSHOT', stage: s });
            await (this.o.fetcher ?? fetch)(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) });
          } catch { /* evidence is best effort; it never decides an outcome */ }
        },
        markSubmitting: async () => { if (leaseLost) return false; const r = await g.call<{ ok: boolean }>('submitting', { id: task.id, token: task.leaseToken }); return r.ok === true; },
        pause: (ms?: number) => page.waitForTimeout(ms ?? this.o.pacingMs ?? 350 + Math.floor(Math.random() * 300)),
      };
      if (task.kind === 'CHECK_SESSION') {
        await ctx.stage('CHECKING_SESSION');
        const state = await adapter.checkSession(page, task);
        await ctx.screenshot('SESSION');
        result = state === 'VALID' ? { outcome: 'SUCCEEDED' } : { outcome: 'BLOCKED', error: state === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'SESSION_STATE_UNKNOWN' };
      } else {
        result = await adapter.run(task.kind, ctx);
      }
      // The portal may have refreshed its cookies; keep the account signed in.
      if (result.outcome !== 'BLOCKED' || result.error !== 'AUTH_REQUIRED') {
        try { await g.call('session.save', { id: task.id, token: task.leaseToken, storageState: await context.storageState() }); } catch { /* the stored session stays */ }
      }
    } catch (e) {
      const stop = e instanceof StopError ? e : null;
      const message = e instanceof Error ? e.message : 'WORKER_ERROR';
      // Playwright timeouts / navigation errors are transient; everything else is a stop.
      const transient = !stop && /Timeout|net::ERR_|Target closed|Navigation/i.test(message);
      result = stop ? { outcome: stop.outcome, error: stop.code, retryable: stop.retryable } : { outcome: 'FAILED', error: transient ? 'PORTAL_TIMEOUT' : 'WORKER_ERROR', retryable: transient };
      if (stop?.retryable && stop.outcome === 'BLOCKED') result.outcome = 'FAILED';
      try { const page = context?.pages()[0]; if (page) { const png = await captureMasked(page, false); const up = await g.call<{ uploadUrl: string }>('artifact', { id: task.id, token: task.leaseToken, kind: 'SCREENSHOT', stage: 'ERROR' }); await (this.o.fetcher ?? fetch)(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) }); } } catch { /* best effort */ }
    } finally {
      clearInterval(heart);
      await context?.close().catch(() => undefined);
    }
    try {
      await g.call('finish', { id: task.id, token: task.leaseToken, outcome: result.outcome, result: result.result ?? {}, error: result.error ?? null, retryable: result.retryable === true });
    } catch (e) {
      // The lease will expire; the database sweep decides (never a second submit).
      this.stats.lastError = e instanceof Error ? e.message.slice(0, 200) : 'FINISH_FAILED';
    }
    const key = ({ SUCCEEDED: 'succeeded', PREPARED: 'prepared', FAILED: 'failed', BLOCKED: 'blocked', RECONCILIATION_REQUIRED: 'reconcile' } as const)[result.outcome];
    this.stats[key]++;
    this.log('operation.finished', { op: task.id, portal: task.portalId, kind: task.kind, outcome: result.outcome, error: result.error ?? null });
    this.running--;
    return result;
  }
}
