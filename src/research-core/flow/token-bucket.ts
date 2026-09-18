import { systemClock, type Clock } from '../core/clock.ts';

export interface TokenBucketOptions {
  /** Sustained rate. */
  tokensPerSecond: number;
  /** Maximum burst. Defaults to one second of tokens. */
  burst?: number;
  clock?: Clock;
}

/**
 * Token bucket rate limiter.
 *
 * Concurrency limits (semaphores) and rate limits are different constraints and
 * we need both: a provider may allow 4 concurrent connections but only 10
 * requests/second, and honouring only one of those still gets us throttled.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly ratePerMs: number;
  private readonly clock: Clock;

  constructor(options: TokenBucketOptions) {
    this.clock = options.clock ?? systemClock;
    this.ratePerMs = options.tokensPerSecond / 1000;
    this.capacity = options.burst ?? Math.max(1, options.tokensPerSecond);
    this.tokens = this.capacity;
    this.lastRefill = this.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs);
    this.lastRefill = now;
  }

  /** Consume a token if one is available, without waiting. */
  tryTake(count = 1): boolean {
    this.refill();
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }

  /** Milliseconds until `count` tokens will be available. */
  delayFor(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    return Math.ceil((count - this.tokens) / this.ratePerMs);
  }

  async take(count = 1, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (this.tryTake(count)) return;
      const delay = Math.max(1, this.delayFor(count));
      await this.clock.sleep(delay, signal);
    }
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}
