import { createDeferred } from '../core/deferred.ts';
import { AbortError } from '../core/errors.ts';

export interface CoalescerStats {
  /** Calls that actually ran the underlying work. */
  executions: number;
  /** Calls that attached to an in-flight execution instead of running it. */
  joins: number;
  /** Peak number of concurrent subscribers on a single key. */
  maxSubscribers: number;
  inFlight: number;
}

interface InFlight<T> {
  promise: Promise<T>;
  subscribers: number;
  startedAt: number;
  controller: AbortController;
}

export interface CoalesceOptions {
  /**
   * Abort the shared execution when every subscriber has gone away.
   * Off by default: the result is usually still worth caching for the next
   * caller, and a half-finished fetch wastes the request we already paid for.
   */
  abortWhenAbandoned?: boolean;
}

/**
 * Single-flight request coalescing.
 *
 * This is the difference between "100 users open the same listing" costing 100
 * external requests and costing one. It is deliberately independent of the
 * cache: coalescing protects the window *before* the first result exists, which
 * is exactly when a cache cannot help.
 */
export class RequestCoalescer {
  private readonly inflight = new Map<string, InFlight<unknown>>();
  private readonly counters: CoalescerStats = {
    executions: 0,
    joins: 0,
    maxSubscribers: 0,
    inFlight: 0,
  };

  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /**
   * Run `work` for `key`, or join the execution already running for it.
   *
   * `work` receives an AbortSignal representing the *shared* execution, never
   * an individual caller's signal: one caller walking away must not cancel the
   * work the other ninety-nine are waiting on.
   */
  async run<T>(
    key: string,
    work: (signal: AbortSignal) => Promise<T>,
    options: CoalesceOptions = {},
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const existing = this.inflight.get(key) as InFlight<T> | undefined;

    if (existing) {
      existing.subscribers += 1;
      this.counters.joins += 1;
      this.counters.maxSubscribers = Math.max(this.counters.maxSubscribers, existing.subscribers);
      return this.awaitWith(existing, callerSignal, options);
    }

    const controller = new AbortController();
    const deferred = createDeferred<T>();

    const entry: InFlight<T> = {
      promise: deferred.promise,
      subscribers: 1,
      startedAt: this.now(),
      controller,
    };

    this.inflight.set(key, entry as InFlight<unknown>);
    this.counters.executions += 1;
    this.counters.inFlight = this.inflight.size;
    this.counters.maxSubscribers = Math.max(this.counters.maxSubscribers, 1);

    // Start the work, then always clear the slot so a failure cannot wedge the
    // key permanently.
    void (async () => {
      try {
        deferred.resolve(await work(controller.signal));
      } catch (error) {
        deferred.reject(error);
      } finally {
        this.inflight.delete(key);
        this.counters.inFlight = this.inflight.size;
      }
    })();

    return this.awaitWith(entry, callerSignal, options);
  }

  private async awaitWith<T>(
    entry: InFlight<T>,
    callerSignal: AbortSignal | undefined,
    options: CoalesceOptions,
  ): Promise<T> {
    if (!callerSignal) {
      try {
        return await entry.promise;
      } finally {
        entry.subscribers -= 1;
      }
    }

    try {
      return await new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new AbortError('Coalesced caller aborted'));
        if (callerSignal.aborted) {
          onAbort();
          return;
        }
        callerSignal.addEventListener('abort', onAbort, { once: true });
        entry.promise.then(
          (value) => {
            callerSignal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error) => {
            callerSignal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      });
    } finally {
      entry.subscribers -= 1;
      if (options.abortWhenAbandoned && entry.subscribers <= 0) {
        entry.controller.abort();
      }
    }
  }

  /** Number of callers currently attached to a key. */
  subscribers(key: string): number {
    return this.inflight.get(key)?.subscribers ?? 0;
  }

  isInFlight(key: string): boolean {
    return this.inflight.has(key);
  }

  stats(): CoalescerStats {
    return { ...this.counters, inFlight: this.inflight.size };
  }

  resetStats(): void {
    this.counters.executions = 0;
    this.counters.joins = 0;
    this.counters.maxSubscribers = 0;
  }
}
