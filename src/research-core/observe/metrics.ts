import { percentile, round } from '../normalize/numbers.ts';

export interface HistogramSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramSummary>;
  takenAt: string;
}

/**
 * In-process metrics.
 *
 * Deliberately not Prometheus: this package should not choose a metrics vendor
 * for Homatch. `snapshot()` is the integration point - forward it to whatever
 * the platform already uses. Histograms keep a bounded reservoir so a
 * long-running worker cannot grow unboundedly.
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly maxSamples: number;

  constructor(options: { maxSamplesPerHistogram?: number } = {}) {
    this.maxSamples = options.maxSamplesPerHistogram ?? 10_000;
  }

  increment(name: string, value = 1, labels?: Record<string, string | number>): void {
    const key = withLabels(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(name: string, value: number, labels?: Record<string, string | number>): void {
    this.gauges.set(withLabels(name, labels), value);
  }

  /** Raise a gauge only if the new value is higher (peak tracking). */
  recordPeak(name: string, value: number, labels?: Record<string, string | number>): void {
    const key = withLabels(name, labels);
    this.gauges.set(key, Math.max(this.gauges.get(key) ?? 0, value));
  }

  observe(name: string, value: number, labels?: Record<string, string | number>): void {
    const key = withLabels(name, labels);
    const samples = this.histograms.get(key);
    if (samples) {
      samples.push(value);
      if (samples.length > this.maxSamples) samples.shift();
    } else {
      this.histograms.set(key, [value]);
    }
  }

  /** Start a timer; call the returned function to record the elapsed time. */
  timer(name: string, labels?: Record<string, string | number>): () => number {
    const started = Date.now();
    return () => {
      const elapsed = Date.now() - started;
      this.observe(name, elapsed, labels);
      return elapsed;
    };
  }

  counter(name: string, labels?: Record<string, string | number>): number {
    return this.counters.get(withLabels(name, labels)) ?? 0;
  }

  gauge(name: string, labels?: Record<string, string | number>): number {
    return this.gauges.get(withLabels(name, labels)) ?? 0;
  }

  histogram(name: string, labels?: Record<string, string | number>): HistogramSummary | null {
    const samples = this.histograms.get(withLabels(name, labels));
    return samples ? summarize(samples) : null;
  }

  snapshot(): MetricsSnapshot {
    const histograms: Record<string, HistogramSummary> = {};
    for (const [key, samples] of this.histograms) histograms[key] = summarize(samples);
    return {
      counters: Object.fromEntries([...this.counters.entries()].sort(byKey)),
      gauges: Object.fromEntries([...this.gauges.entries()].sort(byKey)),
      histograms: Object.fromEntries(Object.entries(histograms).sort(byKey)),
      takenAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  /** Human-readable dump for the demos. */
  render(title = 'metrics'): string {
    const snapshot = this.snapshot();
    const lines: string[] = [`--- ${title} ---`];

    if (Object.keys(snapshot.counters).length) {
      lines.push('counters:');
      for (const [key, value] of Object.entries(snapshot.counters)) {
        lines.push(`  ${key.padEnd(46)} ${value}`);
      }
    }
    if (Object.keys(snapshot.gauges).length) {
      lines.push('gauges:');
      for (const [key, value] of Object.entries(snapshot.gauges)) {
        lines.push(`  ${key.padEnd(46)} ${round(value, 3)}`);
      }
    }
    if (Object.keys(snapshot.histograms).length) {
      lines.push('histograms (ms unless noted):');
      lines.push(`  ${'name'.padEnd(46)} ${'n'.padEnd(7)} ${'p50'.padEnd(9)} ${'p95'.padEnd(9)} max`);
      for (const [key, summary] of Object.entries(snapshot.histograms)) {
        lines.push(
          `  ${key.padEnd(46)} ${String(summary.count).padEnd(7)} ${String(summary.p50).padEnd(9)} ` +
            `${String(summary.p95).padEnd(9)} ${summary.max}`,
        );
      }
    }
    return lines.join('\n');
  }
}

/** Metric names used across the engine, centralised to avoid typos. */
export const METRIC = {
  jobsAccepted: 'jobs.accepted',
  jobsCompleted: 'jobs.completed',
  jobsPartial: 'jobs.partial',
  jobsFailed: 'jobs.failed',
  jobAdmissionMs: 'jobs.admission_ms',
  jobDurationMs: 'jobs.duration_ms',
  timeToFirstEvidenceMs: 'jobs.time_to_first_evidence_ms',
  timeToMinimumEvidenceMs: 'jobs.time_to_minimum_evidence_ms',

  tasksPlanned: 'tasks.planned',
  tasksExecuted: 'tasks.executed',
  tasksSkipped: 'tasks.skipped',
  tasksCancelled: 'tasks.cancelled',
  tasksFailed: 'tasks.failed',
  taskDurationMs: 'tasks.duration_ms',
  taskQueueWaitMs: 'tasks.queue_wait_ms',

  cacheHit: 'cache.hit',
  cacheStale: 'cache.stale',
  cacheMiss: 'cache.miss',

  coalescedJoins: 'coalescer.joins',
  coalescedExecutions: 'coalescer.executions',

  externalRequests: 'external.requests',
  externalRequestsAvoided: 'external.requests_avoided',
  externalBytes: 'external.bytes',
  providerErrors: 'external.provider_errors',
  rateLimited: 'external.rate_limited',
  circuitOpen: 'external.circuit_open',

  evidenceFound: 'evidence.found',
  evidenceDuplicates: 'evidence.duplicates',
  conflictsDetected: 'evidence.conflicts',

  workerConcurrency: 'workers.concurrency',
  schedulerQueued: 'scheduler.queued',

  aiCalls: 'ai.calls',
  aiTokens: 'ai.tokens',
} as const;

function withLabels(name: string, labels?: Record<string, string | number>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const rendered = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${name}{${rendered}}`;
}

function summarize(samples: readonly number[]): HistogramSummary {
  if (samples.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0] as number, 2),
    max: round(sorted[sorted.length - 1] as number, 2),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 2),
    p50: round(percentile(sorted, 0.5) ?? 0, 2),
    p95: round(percentile(sorted, 0.95) ?? 0, 2),
    p99: round(percentile(sorted, 0.99) ?? 0, 2),
  };
}

function byKey(a: [string, unknown], b: [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}
