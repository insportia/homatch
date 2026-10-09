// TasApiStep.ts — the orchestrator's entry point for TAS API_FIRST. Never
// throws: any failure becomes a FAILED LegacySourceResult, which the
// orchestrator hands to the configured fallback implementation.
import type { EntityQueue } from '../../../entities/EntityQueue.js';
import { recordTasRun } from '../implementation.js';
import { acquireTasApi, toLegacyTasResult, type TasApiOptions } from './TasApiWorkflow.js';

export function tasApiOptionsFromEnv(env: Record<string, string | undefined> = process.env): TasApiOptions {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    budgetMs: num('TAS_API_BUDGET_MS', 9 * 60 * 1000),
    concurrency: num('TAS_API_CONCURRENCY', 3),
    minGapMs: num('TAS_API_MIN_GAP_MS', 250),
    maxAttachmentDownloads: num('TAS_API_MAX_ATTACHMENT_DOWNLOADS', 500),
  };
}

export async function runTasApiStep(query: string, entities?: EntityQueue, options: TasApiOptions = tasApiOptionsFromEnv()) {
  const t0 = Date.now();
  try {
    const raw = await acquireTasApi(query, options);
    const result = toLegacyTasResult(raw) as any;
    result.tasImplementation = { implementation: 'API_FIRST', fallbackFrom: null };
    if (entities) {
      for (const d of result.documents) {
        if (d.rawText) entities.scanText(d.rawText, { source: 'tas', sourceDocument: d.url, retrievedAt: new Date().toISOString() });
      }
    }
    recordTasRun('API_FIRST', result.status !== 'FAILED', Date.now() - t0, result.error);
    return { result, keep: false as const, durationMs: Date.now() - t0 };
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 300);
    recordTasRun('API_FIRST', false, Date.now() - t0, message);
    return {
      result: { source: 'tas', sourceName: 'TAS', status: 'FAILED', error: message, documents: [], discoveredEntities: [], workflowResult: { state: 'FAILED' } },
      keep: false as const,
      durationMs: Date.now() - t0,
    };
  }
}
