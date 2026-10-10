// QueueRunner.ts — replica-safe execution of durable Verify tasks.
//
// One loop per lane. A lane claims only as many tasks as it has free slots,
// so a replica never holds work it cannot start. Idle lanes back off (1 s →
// 15 s, jittered), so an empty queue costs a few small requests per minute.
// Each running task heartbeats at a third of its lease; a LOST answer (lease
// recovered by another replica) aborts the task and suppresses any write, a
// CANCEL answer ends it. On shutdown the runner stops claiming, gives running
// tasks a grace period, and releases the rest back to the queue without
// spending an attempt — a deploy loses nothing.
//
// Lanes are resource-specific: HTTP (APIs, document downloads, CAPTCHA
// tokens — no Chromium) and BROWSER (Playwright). A task waiting on an API
// or a CAPTCHA provider never holds a browser slot.

import type { Lane, QueueGateway, QueueTask, EvidenceRef } from './gateway.js';

export type TaskOutcome =
  | { type: 'complete'; result: unknown; evidenceRefs?: EvidenceRef[]; contentHash?: string | null; cacheScope?: string | null }
  | { type: 'fail'; error: string; retryable: boolean; retryAfterSeconds?: number | null }
  | { type: 'delegated' };

export interface TaskContext {
  signal: AbortSignal;
  gateway: QueueGateway;
  workerId: string;
}

export type Executor = (task: QueueTask, ctx: TaskContext) => Promise<TaskOutcome>;

export interface RunnerOptions {
  gateway: QueueGateway;
  executor: Executor;
  workerId: string;
  lanes: Partial<Record<Lane, number>>;
  idleMinMs?: number;
  idleMaxMs?: number;
  /** Floor for the heartbeat interval (tests lower it). */
  heartbeatMinMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface Running {
  task: QueueTask;
  controller: AbortController;
  lost: boolean;
  promise: Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class QueueRunner {
  private readonly o: Required<Omit<RunnerOptions, 'log' | 'sleep'>> & Pick<RunnerOptions, 'log'>;
  private readonly sleep: (ms: number) => Promise<void>;
  private running = new Map<string, Running>();
  private stopping = false;
  private loops: Promise<void>[] = [];
  private wake = new Set<() => void>();
  readonly counters = { claimed: 0, completed: 0, failed: 0, delegated: 0, lost: 0, released: 0, errors: 0 };

  constructor(o: RunnerOptions) {
    this.o = { idleMinMs: 1_000, idleMaxMs: 15_000, heartbeatMinMs: 5_000, ...o } as any;
    this.sleep = o.sleep ?? defaultSleep;
  }

  private log(event: string, data?: Record<string, unknown>) {
    this.o.log?.(event, data);
  }

  start(): void {
    for (const [lane, slots] of Object.entries(this.o.lanes) as Array<[Lane, number]>) {
      if (slots > 0) this.loops.push(this.laneLoop(lane, slots));
    }
    this.log('queue_runner_started', { worker: this.o.workerId, lanes: this.o.lanes });
  }

  inFlight(lane?: Lane): number {
    let n = 0;
    for (const r of this.running.values()) if (!lane || r.task.lane === lane) n++;
    return n;
  }

  snapshot() {
    return { worker: this.o.workerId, lanes: this.o.lanes, running: this.inFlight(), stopping: this.stopping, ...this.counters };
  }

  private async idle(ms: number): Promise<void> {
    await Promise.race([this.sleep(ms), new Promise<void>((r) => this.wake.add(r))]);
  }

  private async laneLoop(lane: Lane, slots: number): Promise<void> {
    let backoff = this.o.idleMinMs;
    while (!this.stopping) {
      const free = slots - this.inFlight(lane);
      if (free <= 0) {
        await this.idle(250);
        continue;
      }
      let tasks: QueueTask[] = [];
      try {
        tasks = (await this.o.gateway.claim(this.o.workerId, [lane], free)).tasks ?? [];
      } catch (e) {
        this.counters.errors++;
        this.log('queue_claim_failed', { lane, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
      if (this.stopping) {
        // Claimed after shutdown began: hand straight back.
        for (const t of tasks) await this.o.gateway.release(t).catch(() => {});
        break;
      }
      if (!tasks.length) {
        await this.idle(backoff * (0.75 + Math.random() * 0.5));
        backoff = Math.min(this.o.idleMaxMs, backoff * 2);
        continue;
      }
      backoff = this.o.idleMinMs;
      this.counters.claimed += tasks.length;
      for (const t of tasks) this.launch(t);
    }
  }

  private launch(task: QueueTask): void {
    const controller = new AbortController();
    const entry: Running = { task, controller, lost: false, promise: Promise.resolve() };
    this.running.set(task.id, entry);
    entry.promise = this.execute(entry).finally(() => {
      this.running.delete(task.id);
      for (const w of this.wake) w();
      this.wake.clear();
    });
  }

  private async execute(entry: Running): Promise<void> {
    const { task, controller } = entry;
    const beatMs = Math.max(this.o.heartbeatMinMs, Math.floor((task.leaseSeconds * 1000) / 3));
    const beat = setInterval(async () => {
      try {
        const { state } = await this.o.gateway.heartbeat(task);
        if (state === 'LOST') {
          entry.lost = true;
          this.counters.lost++;
          controller.abort(new Error('LEASE_LOST'));
          this.log('queue_lease_lost', { task: task.id, source: task.source });
        } else if (state === 'CANCEL') {
          controller.abort(new Error('CANCELLED'));
        }
      } catch {
        /* a missed heartbeat is not a lost lease; the next one may land */
      }
    }, beatMs);
    (beat as any).unref?.();

    let outcome: TaskOutcome;
    try {
      outcome = await this.o.executor(task, { signal: controller.signal, gateway: this.o.gateway, workerId: this.o.workerId });
    } catch (e) {
      const reason = String((controller.signal.reason as Error)?.message ?? '');
      outcome = reason === 'CANCELLED'
        ? { type: 'fail', error: 'CANCELLED', retryable: false }
        : { type: 'fail', error: String((e as Error)?.message ?? e).slice(0, 500), retryable: true };
    } finally {
      clearInterval(beat);
    }

    // Fencing: a task whose lease was recovered elsewhere writes nothing.
    if (entry.lost) return;
    try {
      if (outcome.type === 'complete') {
        const r = await this.o.gateway.complete(task, outcome);
        if (r?.ok) this.counters.completed++;
        else this.log('queue_complete_rejected', { task: task.id, reason: r?.reason });
      } else if (outcome.type === 'fail') {
        await this.o.gateway.fail(task, outcome.error, outcome.retryable, outcome.retryAfterSeconds ?? null);
        this.counters.failed++;
      } else {
        this.counters.delegated++;
      }
    } catch (e) {
      // The lease will expire and the task will be retried elsewhere.
      this.counters.errors++;
      this.log('queue_report_failed', { task: task.id, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  /** Graceful shutdown: stop claiming, wait up to graceMs, release the rest. */
  async stop(graceMs = 25_000): Promise<void> {
    this.stopping = true;
    for (const w of this.wake) w();
    this.wake.clear();
    const deadline = Date.now() + graceMs;
    while (this.running.size && Date.now() < deadline) await this.sleep(250);
    const left = [...this.running.values()];
    await Promise.all(left.map(async (r) => {
      r.lost = true; // nothing may be written for it after release
      r.controller.abort(new Error('SHUTDOWN'));
      try {
        const res = await this.o.gateway.release(r.task);
        if (res?.released) this.counters.released++;
      } catch {
        /* lease expiry recovers it */
      }
    }));
    await Promise.allSettled(this.loops);
    this.log('queue_runner_stopped', this.snapshot());
  }
}
