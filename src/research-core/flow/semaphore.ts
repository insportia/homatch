import { AbortError } from '../core/errors.ts';

export type Release = () => void;

/**
 * FIFO counting semaphore.
 *
 * FIFO matters: LIFO waiters under sustained load produce unbounded latency for
 * the unlucky, which is exactly the "user feels the queue" failure we are
 * designing against.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<{
    resolve: (release: Release) => void;
    reject: (error: unknown) => void;
    onAbort?: () => void;
    signal?: AbortSignal;
  }> = [];

  private peakInUse = 0;
  private totalAcquired = 0;
  private totalWaited = 0;

  public readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;

    if (capacity < 1) throw new Error('Semaphore capacity must be >= 1');
    this.available = capacity;
  }

  get inUse(): number {
    return this.capacity - this.available;
  }

  get queueLength(): number {
    return this.waiters.length;
  }

  get peak(): number {
    return this.peakInUse;
  }

  get acquiredCount(): number {
    return this.totalAcquired;
  }

  get waitedCount(): number {
    return this.totalWaited;
  }

  tryAcquire(): Release | null {
    if (this.available <= 0) return null;
    this.available -= 1;
    this.track();
    return this.makeRelease();
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    const immediate = this.tryAcquire();
    if (immediate) return Promise.resolve(immediate);

    this.totalWaited += 1;
    return new Promise<Release>((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new AbortError('Semaphore acquisition aborted'));
        };
        if (signal.aborted) {
          reject(new AbortError('Semaphore acquisition aborted'));
          return;
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  async withPermit<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private makeRelease(): Release {
    let released = false;
    return () => {
      if (released) return; // double-release must not inflate capacity
      released = true;

      const next = this.waiters.shift();
      if (next) {
        if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
        this.track();
        next.resolve(this.makeRelease());
        return;
      }
      this.available += 1;
    };
  }

  private track(): void {
    this.totalAcquired += 1;
    this.peakInUse = Math.max(this.peakInUse, this.inUse);
  }
}
