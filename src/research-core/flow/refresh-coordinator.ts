// HOMATCH RESEARCH CORE — refresh a stale thing exactly once.
//
// Homatch's research_cache already records staleness (freshness_status:
// LIVE / FRESH / AGING / STALE) and nothing currently acts on it. This is the
// piece that can: serve the stale copy immediately, refresh behind it, and
// make sure the refresh happens once however many requests noticed.
//
// Two layers, because one is not enough:
//
//   1. In-process single-flight. A hundred concurrent stale hits inside one
//      worker collapse to one refresh. Cheap, synchronous, no I/O.
//   2. A lock. Several workers each noticing staleness in the same second
//      would otherwise run several refreshes, which the first layer cannot
//      see. With the in-process lock this is a no-op; with a Postgres advisory
//      lock behind the same interface it becomes global.
//
// Callers never wait on this. The return value is for metrics and tests, not
// for the request path.

import { createLogger, type Logger } from '../core/logger.ts';
import { errorMessage } from '../core/errors.ts';
import { InProcessLock, type SingleFlightLock } from './single-flight-lock.ts';
import { RequestCoalescer } from './coalescer.ts';

export type RefreshOutcome =
  | 'EXECUTED'
  | 'JOINED_IN_PROCESS'
  | 'SKIPPED_LOCKED_ELSEWHERE'
  | 'SKIPPED_RECENTLY_REFRESHED'
  | 'FAILED';

export interface RefreshCoordinatorOptions {
  lock?: SingleFlightLock;
  coalescer?: RequestCoalescer;
  /** Lease length. Must exceed a realistic refresh, or two can overlap. */
  lockTtlMs?: number;
  /**
   * Suppress a second refresh of the same key inside this window even after the
   * lock is released. Stops a slow-moving stampede where each refresh finishes
   * just before the next request arrives.
   */
  minIntervalMs?: number;
  logger?: Logger;
  now?: () => number;
}

export interface RefreshStats {
  executed: number;
  joinedInProcess: number;
  skippedLocked: number;
  skippedRecent: number;
  failed: number;
}

/**
 * Makes "refresh this stale thing" happen exactly once, no matter how many
 * requests notice it is stale.
 *
 * Two layers, because one is not enough:
 *
 *   1. In-process single-flight. A hundred concurrent stale hits inside one
 *      worker collapse to one refresh. Cheap, synchronous, no I/O.
 *   2. A distributed lock. Eleven workers each noticing staleness in the same
 *      second would otherwise run eleven refreshes - one per worker, which the
 *      first layer cannot see. The lock makes it one globally.
 *
 * Callers never wait on this. Staleness is served immediately from cache; the
 * refresh runs behind it on the BACKGROUND work class. The return value is for
 * metrics and tests, not for the request path.
 */
export class RefreshCoordinator {
  private readonly lock: SingleFlightLock;
  private readonly coalescer: RequestCoalescer;
  private readonly lockTtlMs: number;
  private readonly minIntervalMs: number;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly lastRefreshAt = new Map<string, number>();
  private readonly counters: RefreshStats = {
    executed: 0,
    joinedInProcess: 0,
    skippedLocked: 0,
    skippedRecent: 0,
    failed: 0,
  };

  constructor(options: RefreshCoordinatorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.lock = options.lock ?? new InProcessLock(this.now);
    this.coalescer = options.coalescer ?? new RequestCoalescer(this.now);
    this.lockTtlMs = options.lockTtlMs ?? 60_000;
    this.minIntervalMs = options.minIntervalMs ?? 5_000;
    this.logger = options.logger ?? createLogger('research:refresh');
  }

  async refreshOnce(key: string, work: () => Promise<unknown>): Promise<RefreshOutcome> {
    // Layer 1, checked before anything async so a synchronous burst collapses.
    const alreadyRunning = this.coalescer.isInFlight(key);

    const outcome = await this.coalescer.run<RefreshOutcome>(key, async () => {
      const last = this.lastRefreshAt.get(key);
      if (last !== undefined && this.now() - last < this.minIntervalMs) {
        return 'SKIPPED_RECENTLY_REFRESHED';
      }

      // Layer 2.
      const handle = await this.lock.acquire(key, this.lockTtlMs);
      if (!handle) return 'SKIPPED_LOCKED_ELSEWHERE';

      try {
        await work();
        this.lastRefreshAt.set(key, this.now());
        return 'EXECUTED';
      } catch (error) {
        this.logger.debug('background refresh failed', { key, error: errorMessage(error) });
        return 'FAILED';
      } finally {
        await handle.release();
      }
    });

    const result: RefreshOutcome = alreadyRunning ? 'JOINED_IN_PROCESS' : outcome;
    this.record(result);
    return result;
  }

  private record(outcome: RefreshOutcome): void {
    switch (outcome) {
      case 'EXECUTED':
        this.counters.executed += 1;
        break;
      case 'JOINED_IN_PROCESS':
        this.counters.joinedInProcess += 1;
        break;
      case 'SKIPPED_LOCKED_ELSEWHERE':
        this.counters.skippedLocked += 1;
        break;
      case 'SKIPPED_RECENTLY_REFRESHED':
        this.counters.skippedRecent += 1;
        break;
      case 'FAILED':
        this.counters.failed += 1;
        break;
    }
  }

  stats(): RefreshStats {
    return { ...this.counters };
  }

  resetStats(): void {
    this.counters.executed = 0;
    this.counters.joinedInProcess = 0;
    this.counters.skippedLocked = 0;
    this.counters.skippedRecent = 0;
    this.counters.failed = 0;
  }
}
