// HOMATCH MARKETPLACE SEARCH — per-search cost telemetry.
//
// Marketplace Search is free to the customer; it is not free to run. Every
// search records what it consumed so a later pricing decision is made from
// measurements: model tokens and their estimated cost, worker time, pages,
// bytes, processing time. Unknown cost stays unknown (null), never zero.
// Admin only; a customer never sees any of this.

export interface AiUsage {
  call: 'SEARCH_INTELLIGENCE' | 'RESULTS_INTELLIGENCE';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  ok: boolean;
  at: string;
}

export interface WorkerUsage {
  workerId: string;
  durationMs: number | null;
  returnedCount: number;
  pagesVisited: number | null;
  bytesTransferred: number | null;
  browserMs: number | null;
  estimatedCostUsd: number | null;
}

export interface SearchTelemetry {
  ai: AiUsage[];
  workers: WorkerUsage[];
  processingMs: number[];
}

export const emptyTelemetry = (): SearchTelemetry => ({ ai: [], workers: [], processingMs: [] });

export interface TelemetrySummary {
  aiCalls: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  /** null when any AI call's cost could not be priced. */
  aiCostUsd: number | null;
  workerCostUsd: number | null;
  workerMs: number;
  processingMs: number;
  /** null when any component is unpriced: an unknown cost is never silently zero. */
  totalCostUsd: number | null;
}

const sumOrNull = (values: Array<number | null>) =>
  values.some((v) => v === null) ? null : Math.round(values.reduce<number>((s, v) => s + (v as number), 0) * 1e6) / 1e6;

export function summarizeTelemetry(t: SearchTelemetry): TelemetrySummary {
  const aiCostUsd = sumOrNull(t.ai.map((a) => a.costUsd));
  const workerCostUsd = sumOrNull(t.workers.map((w) => w.estimatedCostUsd));
  return {
    aiCalls: t.ai.length,
    aiInputTokens: t.ai.reduce((s, a) => s + a.inputTokens, 0),
    aiOutputTokens: t.ai.reduce((s, a) => s + a.outputTokens, 0),
    aiCostUsd,
    workerCostUsd,
    workerMs: t.workers.reduce((s, w) => s + (w.durationMs ?? 0), 0),
    processingMs: t.processingMs.reduce((s, v) => s + v, 0),
    totalCostUsd: aiCostUsd === null || workerCostUsd === null ? null : Math.round((aiCostUsd + workerCostUsd) * 1e6) / 1e6,
  };
}
