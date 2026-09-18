import { systemClock, type Clock } from '../core/clock.ts';
import { CircuitOpenError } from '../core/errors.ts';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive-equivalent failures inside the window before opening. */
  failureThreshold: number;
  /** Rolling window for counting failures. */
  windowMs: number;
  /** How long the circuit stays OPEN before allowing a probe. */
  openMs: number;
  /** Probes allowed simultaneously in HALF_OPEN. */
  halfOpenMaxCalls: number;
  /** Consecutive probe successes needed to close again. */
  successThreshold: number;
  /** Minimum calls in the window before the failure ratio is meaningful. */
  minimumCalls: number;
  clock?: Clock;
}

export const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  windowMs: 30_000,
  openMs: 15_000,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
  minimumCalls: 3,
};

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number | null;
  retryAfterMs: number;
  rejectedCalls: number;
}

/**
 * Per-target circuit breaker.
 *
 * The point is not politeness, it is throughput: when a provider is down, every
 * request to it is a task that occupies a worker slot, times out, and delivers
 * nothing. Opening the circuit converts a slow failure into an instant one and
 * hands the capacity back to sources that still work.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private callTimestamps: number[] = [];
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = 0;
  private rejectedCalls = 0;
  private readonly options: CircuitBreakerOptions;
  private readonly clock: Clock;

  public readonly name: string;

  constructor(name: string, options: Partial<CircuitBreakerOptions> = {}) {
    this.name = name;

    this.options = { ...DEFAULT_CIRCUIT_OPTIONS, ...options };
    this.clock = this.options.clock ?? systemClock;
  }

  /** Current state, after applying any due OPEN -> HALF_OPEN transition. */
  currentState(): CircuitState {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      if (this.clock.now() - this.openedAt >= this.options.openMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenInFlight = 0;
        this.consecutiveSuccesses = 0;
      }
    }
    return this.state;
  }

  /** Throws CircuitOpenError when the call must not be attempted. */
  private admit(): void {
    const state = this.currentState();

    if (state === 'OPEN') {
      this.rejectedCalls += 1;
      throw new CircuitOpenError(this.name, this.retryAfterMs());
    }

    if (state === 'HALF_OPEN' && this.halfOpenInFlight >= this.options.halfOpenMaxCalls) {
      this.rejectedCalls += 1;
      throw new CircuitOpenError(this.name, this.retryAfterMs());
    }
  }

  async execute<T>(work: () => Promise<T>): Promise<T> {
    this.admit();
    const wasHalfOpen = this.state === 'HALF_OPEN';
    if (wasHalfOpen) this.halfOpenInFlight += 1;

    try {
      const result = await work();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (wasHalfOpen) this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
    }
  }

  onSuccess(): void {
    const now = this.clock.now();
    this.callTimestamps.push(now);
    this.prune(now);

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.options.successThreshold) {
        this.close();
      }
      return;
    }
    this.consecutiveSuccesses += 1;
  }

  onFailure(): void {
    const now = this.clock.now();
    this.callTimestamps.push(now);
    this.failureTimestamps.push(now);
    this.consecutiveSuccesses = 0;
    this.prune(now);

    // A failed probe re-opens immediately: the provider is still unwell.
    if (this.state === 'HALF_OPEN') {
      this.open(now);
      return;
    }

    if (
      this.callTimestamps.length >= this.options.minimumCalls &&
      this.failureTimestamps.length >= this.options.failureThreshold
    ) {
      this.open(now);
    }
  }

  private open(now: number): void {
    this.state = 'OPEN';
    this.openedAt = now;
    this.halfOpenInFlight = 0;
  }

  private close(): void {
    this.state = 'CLOSED';
    this.openedAt = null;
    this.failureTimestamps = [];
    this.callTimestamps = [];
    this.consecutiveSuccesses = 0;
  }

  private prune(now: number): void {
    const cutoff = now - this.options.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t > cutoff);
    this.callTimestamps = this.callTimestamps.filter((t) => t > cutoff);
  }

  retryAfterMs(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.options.openMs - (this.clock.now() - this.openedAt));
  }

  snapshot(): CircuitSnapshot {
    return {
      name: this.name,
      state: this.currentState(),
      failures: this.failureTimestamps.length,
      successes: this.consecutiveSuccesses,
      openedAt: this.openedAt,
      retryAfterMs: this.retryAfterMs(),
      rejectedCalls: this.rejectedCalls,
    };
  }

  reset(): void {
    this.close();
    this.rejectedCalls = 0;
  }
}

/** One breaker per target (hostname or provider name), created on demand. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  private readonly options: Partial<CircuitBreakerOptions>;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = options;
  }

  get(name: string, overrides: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
    const existing = this.breakers.get(name);
    if (existing) return existing;
    const breaker = new CircuitBreaker(name, { ...this.options, ...overrides });
    this.breakers.set(name, breaker);
    return breaker;
  }

  snapshot(): CircuitSnapshot[] {
    return [...this.breakers.values()].map((breaker) => breaker.snapshot());
  }

  openCircuits(): string[] {
    return this.snapshot().filter((s) => s.state !== 'CLOSED').map((s) => s.name);
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) breaker.reset();
  }
}
