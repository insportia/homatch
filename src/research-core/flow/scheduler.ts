import { systemClock, type Clock } from '../core/clock.ts';
import { AbortError } from '../core/errors.ts';
import { createDeferred } from '../core/deferred.ts';
import { nextSequence } from '../core/ids.ts';
import { INTERACTIVE_CLASSES, isInteractive, WORK_CLASSES, type WorkClass } from '../core/types.ts';

export interface ClassPolicy {
  /**
   * Dispatch weight for deficit round-robin. A class with weight 8 gets roughly
   * 8x the dispatch opportunities of a class with weight 1 when both are busy.
   */
  weight: number;
  /**
   * Slots held open for this class. For interactive classes the reservation is
   * unconditional - that is what makes a newly arrived interactive job start
   * immediately even with 10,000 background jobs queued.
   */
  minReserved: number;
  /** Hard ceiling, so one class can never monopolise the pool. */
  maxConcurrency: number;
}

export interface SchedulerOptions {
  totalConcurrency: number;
  classes: Record<WorkClass, ClassPolicy>;
  /**
   * While interactive work is queued, non-interactive classes step aside.
   * Bounded by `backgroundStarvationGuardMs` so background still progresses
   * under sustained interactive load.
   */
  yieldBackgroundToInteractive?: boolean;
  backgroundStarvationGuardMs?: number;
  clock?: Clock;
}

export interface SubmitOptions {
  workClass: WorkClass;
  /** Higher runs first within the class. Ties break FIFO. */
  priority?: number;
  id?: string;
  label?: string;
  signal?: AbortSignal;
}

export type TaskState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ScheduledTask<T> {
  readonly id: string;
  readonly workClass: WorkClass;
  readonly promise: Promise<T>;
  state(): TaskState;
  cancel(reason?: string): void;
}

interface QueueItem<T = unknown> {
  id: string;
  label: string;
  workClass: WorkClass;
  priority: number;
  sequence: number;
  enqueuedAt: number;
  run: (signal: AbortSignal) => Promise<T>;
  deferred: ReturnType<typeof createDeferred<T>>;
  controller: AbortController;
  callerSignal?: AbortSignal;
  onCallerAbort?: () => void;
  state: TaskState;
}

export interface ClassStats {
  workClass: WorkClass;
  queued: number;
  running: number;
  dispatched: number;
  completed: number;
  failed: number;
  cancelled: number;
  maxWaitMs: number;
  avgWaitMs: number;
  p95WaitMs: number;
}

export interface SchedulerStats {
  totalConcurrency: number;
  running: number;
  queued: number;
  byClass: Record<WorkClass, ClassStats>;
}

/**
 * Weighted, reservation-aware scheduler.
 *
 * The requirement this exists to satisfy: "a new interactive job does not wait
 * behind thousands of background jobs". Three mechanisms combine to guarantee
 * it, and all three are needed:
 *
 *   1. Separate backlogs per work class. One FIFO queue cannot express
 *      priority no matter how it is ordered, because the job that matters
 *      arrives after the backlog already exists.
 *   2. Unconditional reserved capacity for interactive classes. Background work
 *      is only admitted while enough free slots remain to satisfy interactive
 *      reservations, so an interactive arrival finds a slot waiting.
 *   3. Deficit round-robin between eligible classes, so priority is a ratio
 *      rather than absolute precedence and background still drains.
 */
export class WeightedScheduler {
  private readonly queues: Record<WorkClass, QueueItem[]>;
  private readonly running: Record<WorkClass, number>;
  private readonly deficit: Record<WorkClass, number>;
  private readonly lastDispatchAt: Record<WorkClass, number>;
  private readonly counters: Record<WorkClass, { dispatched: number; completed: number; failed: number; cancelled: number; waits: number[] }>;
  private readonly clock: Clock;
  private runningTotal = 0;
  private paused = false;
  private idleWaiters: Array<() => void> = [];

  private readonly options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    this.options = options;

    this.clock = options.clock ?? systemClock;
    this.queues = emptyRecord(() => [] as QueueItem[]);
    this.running = emptyRecord(() => 0);
    this.deficit = emptyRecord(() => 0);
    this.lastDispatchAt = emptyRecord(() => this.clock.now());
    this.counters = emptyRecord(() => ({
      dispatched: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      waits: [] as number[],
    }));
  }

  submit<T>(run: (signal: AbortSignal) => Promise<T>, options: SubmitOptions): ScheduledTask<T> {
    const deferred = createDeferred<T>();
    const item: QueueItem<T> = {
      id: options.id ?? `task_${nextSequence()}`,
      label: options.label ?? options.workClass,
      workClass: options.workClass,
      priority: options.priority ?? 0,
      sequence: nextSequence(),
      enqueuedAt: this.clock.now(),
      run,
      deferred,
      controller: new AbortController(),
      state: 'QUEUED',
    };

    if (options.signal) {
      item.callerSignal = options.signal;
      item.onCallerAbort = () => this.cancelItem(item as QueueItem, 'caller aborted');
      if (options.signal.aborted) {
        item.state = 'CANCELLED';
        this.counters[item.workClass].cancelled += 1;
        deferred.reject(new AbortError('Task aborted before scheduling'));
        return this.toHandle(item as QueueItem<T>);
      }
      options.signal.addEventListener('abort', item.onCallerAbort, { once: true });
    }

    insertSorted(this.queues[options.workClass] as QueueItem[], item as QueueItem);
    // Dispatch on a microtask so a synchronous burst of submits is scheduled as
    // one batch. Admission stays immediate: the caller already has a handle.
    queueMicrotask(() => this.dispatch());

    return this.toHandle(item as QueueItem<T>);
  }

  private toHandle<T>(item: QueueItem<T>): ScheduledTask<T> {
    return {
      id: item.id,
      workClass: item.workClass,
      promise: item.deferred.promise,
      state: () => item.state,
      cancel: (reason?: string) => this.cancelItem(item as QueueItem, reason ?? 'cancelled'),
    };
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  private dispatch(): void {
    if (this.paused) return;

    let guard = 0;
    while (guard < 100_000) {
      guard += 1;

      const eligible = WORK_CLASSES.filter(
        (workClass) => this.queues[workClass].length > 0 && this.canStart(workClass),
      );
      if (eligible.length === 0) break;

      let pick = eligible[0] as WorkClass;
      for (const workClass of eligible) {
        if (this.deficit[workClass] > this.deficit[pick]) pick = workClass;
      }

      if (this.deficit[pick] < 1) {
        // Replenish every eligible class and re-pick. Capped so an idle class
        // cannot bank credit and then burst.
        for (const workClass of eligible) {
          const policy = this.options.classes[workClass];
          this.deficit[workClass] = Math.min(
            policy.weight * 4,
            this.deficit[workClass] + policy.weight,
          );
        }
        continue;
      }

      this.deficit[pick] -= 1;
      if (!this.startNext(pick)) {
        // Queue held only cancelled items; loop again.
        continue;
      }
    }

    if (this.runningTotal === 0 && this.totalQueued() === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const waiter of waiters) waiter();
    }
  }

  private canStart(workClass: WorkClass): boolean {
    const policy = this.options.classes[workClass];
    if (this.running[workClass] >= policy.maxConcurrency) return false;

    const free = this.options.totalConcurrency - this.runningTotal;
    if (free <= 0) return false;

    // Reservations protect interactive work from being crowded out, so only
    // non-interactive classes are held back by them. Making interactive classes
    // reserve against each other deadlocks any pool smaller than the sum of
    // their reservations, and starves a busy interactive class on behalf of an
    // idle one.
    if (!isInteractive(workClass) && free <= this.reservedForInteractive()) return false;

    if (
      (this.options.yieldBackgroundToInteractive ?? true) &&
      !isInteractive(workClass) &&
      this.interactiveQueued() > 0
    ) {
      // Yield, but not forever: after the guard interval background gets a turn
      // regardless, so sustained interactive load cannot starve it completely.
      const guardMs = this.options.backgroundStarvationGuardMs ?? 2000;
      if (this.clock.now() - this.lastDispatchAt[workClass] < guardMs) return false;
    }

    return true;
  }

  /**
   * Slots held open for interactive work that is not currently running.
   *
   * Unconditional - it does not depend on interactive work being queued right
   * now. That is the entire point: the job we are protecting has not arrived
   * yet, and by the time it does, a background task that took the slot would
   * already be holding it.
   *
   * Clamped to leave at least one slot usable, so a configuration whose
   * reservations exceed the pool degrades to "background is rare" rather than
   * to "background never runs at all".
   */
  private reservedForInteractive(): number {
    let reserved = 0;
    for (const workClass of INTERACTIVE_CLASSES) {
      const policy = this.options.classes[workClass];
      reserved += Math.max(0, policy.minReserved - this.running[workClass]);
    }
    return Math.min(reserved, Math.max(0, this.options.totalConcurrency - 1));
  }

  private startNext(workClass: WorkClass): boolean {
    const queue = this.queues[workClass];

    while (queue.length > 0) {
      const item = queue.shift() as QueueItem;
      if (item.state === 'CANCELLED') continue;

      item.state = 'RUNNING';
      const waitMs = this.clock.now() - item.enqueuedAt;
      const counter = this.counters[workClass];
      counter.dispatched += 1;
      counter.waits.push(waitMs);
      if (counter.waits.length > 5000) counter.waits.shift();

      this.running[workClass] += 1;
      this.runningTotal += 1;
      this.lastDispatchAt[workClass] = this.clock.now();

      void this.execute(item);
      return true;
    }
    return false;
  }

  private async execute(item: QueueItem): Promise<void> {
    try {
      const value = await item.run(item.controller.signal);
      if (item.state === 'RUNNING') {
        item.state = 'COMPLETED';
        this.counters[item.workClass].completed += 1;
        item.deferred.resolve(value);
      } else {
        // Cancelled while running, and the work returned normally anyway
        // (a task that ignores its abort signal, or one that raced the
        // cancellation). The handle must still settle, or every caller awaiting
        // it hangs forever.
        item.deferred.reject(new AbortError(`Task ${item.id} was cancelled`));
      }
    } catch (error) {
      if (item.state === 'CANCELLED') {
        item.deferred.reject(error);
      } else {
        item.state = 'FAILED';
        this.counters[item.workClass].failed += 1;
        item.deferred.reject(error);
      }
    } finally {
      this.detach(item);
      this.running[item.workClass] -= 1;
      this.runningTotal -= 1;
      queueMicrotask(() => this.dispatch());
    }
  }

  private cancelItem(item: QueueItem, reason: string): void {
    if (item.state === 'COMPLETED' || item.state === 'FAILED' || item.state === 'CANCELLED') return;

    if (item.state === 'QUEUED') {
      const queue = this.queues[item.workClass];
      const index = queue.indexOf(item);
      if (index >= 0) queue.splice(index, 1);
      item.state = 'CANCELLED';
      this.counters[item.workClass].cancelled += 1;
      this.detach(item);
      item.deferred.reject(new AbortError(`Task ${item.id} cancelled: ${reason}`));
      return;
    }

    // Running: signal it and let `execute` settle the promise.
    item.state = 'CANCELLED';
    this.counters[item.workClass].cancelled += 1;
    item.controller.abort();
  }

  private detach(item: QueueItem): void {
    if (item.callerSignal && item.onCallerAbort) {
      item.callerSignal.removeEventListener('abort', item.onCallerAbort);
      item.onCallerAbort = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  private interactiveQueued(): number {
    return this.queues.INTERACTIVE_HIGH.length + this.queues.INTERACTIVE_NORMAL.length;
  }

  totalQueued(): number {
    return WORK_CLASSES.reduce((acc, workClass) => acc + this.queues[workClass].length, 0);
  }

  queuedIn(workClass: WorkClass): number {
    return this.queues[workClass].length;
  }

  runningIn(workClass: WorkClass): number {
    return this.running[workClass];
  }

  get activeCount(): number {
    return this.runningTotal;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    queueMicrotask(() => this.dispatch());
  }

  /** Resolves when nothing is running and nothing is queued. */
  onIdle(): Promise<void> {
    if (this.runningTotal === 0 && this.totalQueued() === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  stats(): SchedulerStats {
    const byClass = {} as Record<WorkClass, ClassStats>;
    for (const workClass of WORK_CLASSES) {
      const counter = this.counters[workClass];
      const waits = counter.waits;
      const sorted = [...waits].sort((a, b) => a - b);
      byClass[workClass] = {
        workClass,
        queued: this.queues[workClass].length,
        running: this.running[workClass],
        dispatched: counter.dispatched,
        completed: counter.completed,
        failed: counter.failed,
        cancelled: counter.cancelled,
        maxWaitMs: sorted.length ? (sorted[sorted.length - 1] as number) : 0,
        avgWaitMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        p95WaitMs: sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] ?? (sorted[sorted.length - 1] as number)) : 0,
      };
    }
    return {
      totalConcurrency: this.options.totalConcurrency,
      running: this.runningTotal,
      queued: this.totalQueued(),
      byClass,
    };
  }
}

/** Insert keeping the queue sorted by priority desc, then FIFO by sequence. */
function insertSorted(queue: QueueItem[], item: QueueItem): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const candidate = queue[mid] as QueueItem;
    const isAfter =
      candidate.priority > item.priority ||
      (candidate.priority === item.priority && candidate.sequence < item.sequence);
    if (isAfter) low = mid + 1;
    else high = mid;
  }
  queue.splice(low, 0, item);
}

function emptyRecord<T>(factory: () => T): Record<WorkClass, T> {
  return {
    INTERACTIVE_HIGH: factory(),
    INTERACTIVE_NORMAL: factory(),
    BACKGROUND: factory(),
    ENRICHMENT: factory(),
  };
}

export const DEFAULT_CLASS_POLICIES: Record<WorkClass, ClassPolicy> = {
  INTERACTIVE_HIGH: { weight: 8, minReserved: 6, maxConcurrency: 32 },
  INTERACTIVE_NORMAL: { weight: 4, minReserved: 4, maxConcurrency: 24 },
  BACKGROUND: { weight: 1, minReserved: 1, maxConcurrency: 12 },
  ENRICHMENT: { weight: 1, minReserved: 0, maxConcurrency: 6 },
};
