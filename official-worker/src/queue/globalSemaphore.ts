// globalSemaphore.ts — a limit shared by every replica of the worker (Verify at scale).
//
// A limit kept in one process multiplies by the number of replicas: six
// replicas of "one MyHome run at a time" are six MyHome runs, enough to draw
// MyHome's Cloudflare challenge for every customer. Slots live in the
// database (worker_semaphore_slots, migration 20261205093000) and are reached
// through verify-queue. A slot is renewed while held and expires at its TTL if
// the process dies. Without a configured gateway this degrades to the process
// limit the caller already enforces — one replica behaves exactly as before.

import { randomUUID } from 'node:crypto';
import type { QueueGateway } from './gateway.js';

export interface SemaphoreGateway {
  semAcquire(key: string, holder: string, max: number, ttlSeconds: number): Promise<{ acquired: boolean }>;
  semRelease(key: string, holder: string): Promise<{ released: boolean }>;
}

export class GlobalSemaphore {
  private readonly holderBase: string;
  constructor(private readonly gateway: SemaphoreGateway | null, holderBase: string = randomUUID()) {
    this.holderBase = holderBase.slice(0, 80);
  }

  /** Waits for a slot under `key` (at most `max` live across replicas) until the deadline; null when none came. */
  async acquire(key: string, max: number, opts: { deadlineAt?: number; ttlSeconds?: number; pollMs?: number; signal?: AbortSignal } = {}): Promise<GlobalSlot | null> {
    const holder = `${this.holderBase}:${randomUUID().slice(0, 8)}`;
    const ttl = opts.ttlSeconds ?? 120;
    if (!this.gateway) return new GlobalSlot(null, key, holder, ttl);
    const deadline = opts.deadlineAt ?? Date.now() + 60_000;
    for (;;) {
      if (opts.signal?.aborted) return null;
      try {
        const r = await this.gateway.semAcquire(key, holder, max, ttl);
        if (r?.acquired) return new GlobalSlot(this.gateway, key, holder, ttl);
      } catch {
        // The coordinator is unreachable: proceed under the process limit rather than stall the work.
        return new GlobalSlot(null, key, holder, ttl);
      }
      if (Date.now() + (opts.pollMs ?? 2000) > deadline) return null;
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
    }
  }
}

export class GlobalSlot {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly gateway: SemaphoreGateway | null, readonly key: string, readonly holder: string, ttlSeconds: number) {
    if (gateway) {
      // Renew at a third of the TTL while held.
      this.timer = setInterval(() => { void gateway.semAcquire(key, holder, Number.MAX_SAFE_INTEGER, ttlSeconds).catch(() => {}); }, Math.max(2000, (ttlSeconds * 1000) / 3));
      (this.timer as any).unref?.();
    }
  }
  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { await this.gateway?.semRelease(this.key, this.holder); } catch { /* it expires at its TTL */ }
  }
}

/** A gateway adapter over verify-queue's sem_acquire / sem_release actions. */
export function semaphoreGateway(g: QueueGateway): SemaphoreGateway {
  return {
    semAcquire: (key, holder, max, ttlSeconds) => g.call('sem_acquire', { key, holder, max, ttlSeconds }),
    semRelease: (key, holder) => g.call('sem_release', { key, holder }),
  };
}
