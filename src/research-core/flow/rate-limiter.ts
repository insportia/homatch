import { systemClock, type Clock } from '../core/clock.ts';
import { Semaphore, type Release } from './semaphore.ts';
import { TokenBucket } from './token-bucket.ts';

export interface LimitPolicy {
  /** Simultaneous in-flight requests. */
  concurrency: number;
  /** Sustained request rate. Omit for concurrency-only limiting. */
  requestsPerSecond?: number;
  burst?: number;
}

export interface RateLimiterOptions {
  /** Applied to any key without a specific policy. */
  defaultPolicy: LimitPolicy;
  /** Exact-match policies, e.g. provider names. */
  policies?: Record<string, LimitPolicy>;
  clock?: Clock;
}

export interface LimitSnapshot {
  key: string;
  concurrency: number;
  inUse: number;
  queued: number;
  peak: number;
  acquired: number;
  waited: number;
  tokensAvailable: number | null;
}

interface Limit {
  policy: LimitPolicy;
  semaphore: Semaphore;
  bucket: TokenBucket | null;
}

/**
 * Two-dimensional rate limiting, keyed by whatever the caller considers a
 * bottleneck: a hostname, a search provider, a document store.
 *
 * Keys are independent. That is the point: one slow hostname consuming its four
 * permits must not reduce the capacity available to any other host, and one
 * host can never receive uncontrolled concurrency just because the engine as a
 * whole has spare worker slots.
 */
export class RateLimiter {
  private readonly limits = new Map<string, Limit>();
  private readonly clock: Clock;

  private readonly options: RateLimiterOptions;

  constructor(options: RateLimiterOptions) {
    this.options = options;

    this.clock = options.clock ?? systemClock;
  }

  policyFor(key: string): LimitPolicy {
    return this.options.policies?.[key] ?? this.options.defaultPolicy;
  }

  /** Register or replace a policy at runtime (e.g. after a 429 teaches us). */
  setPolicy(key: string, policy: LimitPolicy): void {
    this.options.policies = { ...(this.options.policies ?? {}), [key]: policy };
    this.limits.delete(key);
  }

  private limitFor(key: string): Limit {
    const existing = this.limits.get(key);
    if (existing) return existing;

    const policy = this.policyFor(key);
    const limit: Limit = {
      policy,
      semaphore: new Semaphore(policy.concurrency),
      bucket: policy.requestsPerSecond
        ? new TokenBucket({
            tokensPerSecond: policy.requestsPerSecond,
            burst: policy.burst,
            clock: this.clock,
          })
        : null,
    };
    this.limits.set(key, limit);
    return limit;
  }

  /** Acquire both a concurrency permit and (if configured) a rate token. */
  async acquire(key: string, signal?: AbortSignal): Promise<Release> {
    const limit = this.limitFor(key);
    const release = await limit.semaphore.acquire(signal);
    try {
      if (limit.bucket) await limit.bucket.take(1, signal);
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  async run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(key, signal);
    try {
      return await work();
    } finally {
      release();
    }
  }

  inUse(key: string): number {
    return this.limits.get(key)?.semaphore.inUse ?? 0;
  }

  peak(key: string): number {
    return this.limits.get(key)?.semaphore.peak ?? 0;
  }

  snapshot(): LimitSnapshot[] {
    return [...this.limits.entries()].map(([key, limit]) => ({
      key,
      concurrency: limit.policy.concurrency,
      inUse: limit.semaphore.inUse,
      queued: limit.semaphore.queueLength,
      peak: limit.semaphore.peak,
      acquired: limit.semaphore.acquiredCount,
      waited: limit.semaphore.waitedCount,
      tokensAvailable: limit.bucket ? Math.floor(limit.bucket.available) : null,
    }));
  }
}
