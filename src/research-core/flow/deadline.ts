// HOMATCH RESEARCH CORE — a job deadline.
//
// The contract: an interactive job returns SOMETHING by its deadline. Not an
// error, not a hang — whatever valid evidence has arrived, marked PARTIAL.
// That is the difference between a research engine and a research liability,
// and it is the behaviour research-agent's watchdog currently does not have:
// it abandons or retires a stalled job rather than returning the evidence it
// already gathered.
//
// Expiry aborts in-flight tasks through `signal`, so the fetch that was going
// to take another 40 seconds actually stops instead of leaking a worker slot.

/**
 * What setTimeout returns differs by runtime: a Timeout object in Node, a
 * number in Deno and the browser. Typing it as either would tie this file to
 * one of them, so it is typed as what both actually guarantee — an opaque
 * handle that clearTimeout accepts.
 */
type TimerHandle = ReturnType<typeof setTimeout>;

export class Deadline {
  private readonly controller = new AbortController();
  private timer: TimerHandle | null = null;
  private expired = false;
  private readonly listeners: Array<() => void> = [];

  readonly budgetMs: number;
  private readonly now: () => number;
  readonly startedAt: number;

  constructor(
    budgetMs: number,
    now: () => number = () => Date.now(),
    startedAt: number = Date.now()) {
    this.budgetMs = budgetMs;
    this.now = now;
    this.startedAt = startedAt;

    if (budgetMs > 0 && Number.isFinite(budgetMs)) {
      this.timer = setTimeout(() => this.expire(), budgetMs);
      // Do not hold a Node process open just to fire a deadline. Deno and the
      // browser have no unref, which is why this is an optional call.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get hasExpired(): boolean {
    return this.expired;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    if (!Number.isFinite(this.budgetMs) || this.budgetMs <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.budgetMs - this.elapsedMs());
  }

  /**
   * Absolute expiry as an epoch timestamp, or null when there is no budget.
   *
   * Deadlines must travel with a queued task: a worker in another process has
   * no other way to know the requester already gave up, and starting work
   * nobody is waiting for is pure waste.
   */
  absoluteDeadline(): number | null {
    if (!Number.isFinite(this.budgetMs) || this.budgetMs <= 0) return null;
    return this.startedAt + this.budgetMs;
  }

  /** Clamp a per-task timeout so no task can outlive the job that owns it. */
  clampTimeout(timeoutMs: number): number {
    const remaining = this.remainingMs();
    if (!Number.isFinite(remaining)) return timeoutMs;
    return Math.max(1, Math.min(timeoutMs, remaining));
  }

  onExpire(listener: () => void): void {
    if (this.expired) {
      listener();
      return;
    }
    this.listeners.push(listener);
  }

  private expire(): void {
    if (this.expired) return;
    this.expired = true;
    this.controller.abort();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener failures must not mask the deadline itself.
      }
    }
  }

  /** Call on completion so a finished job does not sit on a pending timer. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Trigger expiry early - used by early stopping to release pending tasks. */
  cancel(): void {
    this.dispose();
    this.expire();
  }
}
