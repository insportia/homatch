// AI-first classification calls (aiClassifier.ts holds the schema, prompt and the rules for
// applying a verdict). One structured-output call per AI_BATCH_SIZE unique candidates, at most
// AI_CONCURRENCY calls in flight, one retry per failed batch, every call's tokens recorded in
// find_buyers_cost_ledger. A batch that still fails returns no verdict for its items: the
// caller marks them UNVERIFIED — never a confident rule-based buyer.

import {
  AI_BATCH_SIZE, AI_CLASSIFY_SCHEMA, AI_CONCURRENCY, AI_SYSTEM_PROMPT, parseAiVerdict, propertyBrief, type AiVerdict,
} from '../../../../src/research-core/findBuyers/aiClassifier.ts';
import type { PropertyDna } from '../../../../src/research-core/findBuyers/propertyDna.ts';
import { openAiJson, recordAiCost, type PriceBook } from './openai.ts';

export interface AiCandidate {
  id: string;
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  text: string;
  parentExcerpt?: string | null;
  author?: string | null;
}

export interface AiRunStats { calls: number; failedBatches: number; costMicros: number; inputTokens: number; outputTokens: number }

const clip = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : null);

export async function classifyCandidates(
  db: any,
  opts: { book: PriceBook; dna: PropertyDna; matchingJobId: string | null; keyPrefix: string; operation: string; metadata?: Record<string, unknown> },
  candidates: AiCandidate[],
): Promise<{ verdicts: Map<string, AiVerdict & { model: string }>; stats: AiRunStats }> {
  const verdicts = new Map<string, AiVerdict & { model: string }>();
  const stats: AiRunStats = { calls: 0, failedBatches: 0, costMicros: 0, inputTokens: 0, outputTokens: 0 };
  const batches: AiCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) batches.push(candidates.slice(i, i + AI_BATCH_SIZE));
  const property = propertyBrief(opts.dna);

  const runBatch = async (batch: AiCandidate[], index: number) => {
    const payload = {
      property,
      items: batch.map((c, k) => ({ id: String(k), kind: c.kind, text: clip(c.text, 700), parent_post: clip(c.parentExcerpt, 300), author: clip(c.author, 80) })),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await openAiJson<{ items: unknown[] }>(opts.book, AI_SYSTEM_PROMPT, payload, AI_CLASSIFY_SCHEMA, { maxTokens: 200 + batch.length * 140, timeoutMs: 30_000 });
      stats.calls++;
      stats.costMicros += res.costMicros; stats.inputTokens += res.inputTokens; stats.outputTokens += res.outputTokens;
      await recordAiCost(db, {
        key: `${opts.keyPrefix}:${index}:a${attempt}`, matchingJobId: opts.matchingJobId, kind: 'AI', operation: opts.operation,
        result: res, metadata: { ...(opts.metadata ?? {}), items: batch.length, attempt },
      }).catch(() => undefined);
      if (!res.error && res.data && Array.isArray(res.data.items)) {
        for (const raw of res.data.items as any[]) {
          const k = Number(raw?.id);
          const v = parseAiVerdict(raw);
          if (v && Number.isInteger(k) && batch[k]) verdicts.set(batch[k].id, { ...v, model: res.model });
        }
        return;
      }
    }
    stats.failedBatches++;
  };

  /* Bounded concurrency: AI_CONCURRENCY batches in flight. */
  let next = 0;
  const lanes = Array.from({ length: Math.min(AI_CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      const i = next++;
      await runBatch(batches[i], i).catch(() => { stats.failedBatches++; });
    }
  });
  await Promise.all(lanes);
  return { verdicts, stats };
}
