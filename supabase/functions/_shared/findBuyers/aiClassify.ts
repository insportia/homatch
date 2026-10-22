// AI-first classification calls (aiClassifier.ts holds the schema, prompt and the rules for
// applying a verdict). One structured-output call per AI_BATCH_SIZE unique candidates, at most
// AI_CONCURRENCY calls in flight, one retry per failed batch, one more call for the items a
// batch answer left out, every call's tokens recorded in
// find_buyers_cost_ledger. A batch that still fails returns no verdict for its items: the
// caller marks them UNVERIFIED — never a confident rule-based buyer.
//
// Every call is paid from the campaign's execution budget: with a spend gate (executionBudget.ts)
// a call starts only when the budget left covers its worst case (input + its max_tokens); a
// batch it cannot afford is not sent and its items stay UNVERIFIED (budgetRefusedItems).

import {
  AI_BATCH_SIZE, AI_CLASSIFY_SCHEMA, AI_CONCURRENCY, AI_SYSTEM_PROMPT, parseAiVerdict, propertyBrief, type AiVerdict,
} from '../../../../src/research-core/findBuyers/aiClassifier.ts';
import type { PropertyDna } from '../../../../src/research-core/findBuyers/propertyDna.ts';
import { openAiJson, recordAiCost, type PriceBook } from './openai.ts';
import { classifyCallCeilingMicros, type AiSpendGate } from '../../../../src/research-core/findBuyers/executionBudget.ts';

export interface AiCandidate {
  id: string;
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  text: string;
  parentExcerpt?: string | null;
  author?: string | null;
}

export interface AiRunStats { calls: number; failedBatches: number; missingRetried: number; costMicros: number; inputTokens: number; outputTokens: number; budgetRefusedItems: number }

const clip = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : null);

export async function classifyCandidates(
  db: any,
  opts: { book: PriceBook; dna: PropertyDna; matchingJobId: string | null; keyPrefix: string; operation: string; metadata?: Record<string, unknown>; gate?: AiSpendGate },
  candidates: AiCandidate[],
): Promise<{ verdicts: Map<string, AiVerdict & { model: string }>; stats: AiRunStats }> {
  const verdicts = new Map<string, AiVerdict & { model: string }>();
  const stats: AiRunStats = { calls: 0, failedBatches: 0, missingRetried: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, budgetRefusedItems: 0 };
  const batches: AiCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) batches.push(candidates.slice(i, i + AI_BATCH_SIZE));
  const property = propertyBrief(opts.dna);

  /** One structured call for `batch`; true when the model answered (items it skipped stay missing),
   *  'NO_BUDGET' when the execution budget left cannot cover its worst case (nothing is sent). */
  const call = async (batch: AiCandidate[], key: string, attempt: number): Promise<boolean | 'NO_BUDGET'> => {
    if (opts.gate && !opts.gate.admit(classifyCallCeilingMicros(opts.book, batch.length))) {
      stats.budgetRefusedItems += batch.length;
      return 'NO_BUDGET';
    }
    const payload = {
      property,
      items: batch.map((c, k) => ({ id: String(k), kind: c.kind, text: clip(c.text, 700), parent_post: clip(c.parentExcerpt, 300), author: clip(c.author, 80) })),
    };
    const res = await openAiJson<{ items: unknown[] }>(opts.book, AI_SYSTEM_PROMPT, payload, AI_CLASSIFY_SCHEMA, { maxTokens: 300 + batch.length * 180, timeoutMs: 30_000 });
    stats.calls++;
    stats.costMicros += res.costMicros; stats.inputTokens += res.inputTokens; stats.outputTokens += res.outputTokens;
    opts.gate?.spend(res.costMicros);
    await recordAiCost(db, {
      key, matchingJobId: opts.matchingJobId, kind: 'AI', operation: opts.operation,
      result: res, metadata: { ...(opts.metadata ?? {}), items: batch.length, attempt },
    }).catch(() => undefined);
    if (res.error || !res.data || !Array.isArray(res.data.items)) return false;
    for (const raw of res.data.items as any[]) {
      const k = Number(raw?.id);
      const v = parseAiVerdict(raw);
      if (v && Number.isInteger(k) && batch[k]) verdicts.set(batch[k].id, { ...v, model: res.model });
    }
    return true;
  };

  const runBatch = async (batch: AiCandidate[], index: number) => {
    let answered: boolean | 'NO_BUDGET' = false;
    for (let attempt = 0; attempt < 2 && answered === false; attempt++) answered = await call(batch, `${opts.keyPrefix}:${index}:a${attempt}`, attempt);
    if (answered === 'NO_BUDGET') return;
    if (!answered) { stats.failedBatches++; return; }
    /* Items the model left out of its answer (replay of 343cfc41: 44 of 445) get one more call. */
    const missing = batch.filter((c) => !verdicts.has(c.id));
    if (missing.length) {
      stats.missingRetried += missing.length;
      await call(missing, `${opts.keyPrefix}:${index}:m`, 2);
    }
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
