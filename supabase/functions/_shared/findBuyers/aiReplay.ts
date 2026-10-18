// AI REPLAY (owner, 2026-10-18): re-judge a finished campaign's STORED candidates with the
// AI-first classifier, without any Actor run, lead write or customer charge. Requested by the
// admin_settings row find_buyers_ai_replay_request = { matchingJobId, status: 'REQUESTED' }
// (set by a reviewed migration); the worker advances it REPLAY_PAGE candidates per tick and
// writes the before/after table to find_buyers_ai_replay_result. Its model calls are recorded
// in find_buyers_cost_ledger with no matching job (an internal QA cost, never the customer's).

import { classifyCandidates } from './aiClassify.ts';
import { loadFindBuyersSettings } from './campaign.ts';
import { parsePriceBook } from './openai.ts';
import { applyAiVerdict, AI_CLASSIFIER_VERSION, safeText } from '../../../../src/research-core/findBuyers/aiClassifier.ts';
import { buyerViaBroker, classifyComment, classifyDemand, withAuthorEvidence } from '../../../../src/research-core/findBuyers/demandClassifier.ts';
import { qualify } from '../../../../src/research-core/findBuyers/qualify.ts';
import { classifyBuyerIntent } from '../../../../src/research-core/findBuyers/buyerIntent.ts';

export const REPLAY_PAGE = 60;
const REQUEST_KEY = 'find_buyers_ai_replay_request';
const RESULT_KEY = 'find_buyers_ai_replay_result';

/** The lead a reading would become (pipeline.ts gateIntent, without the database). */
export function replayCategory(reading: any, dna: any, ageDays: number | null, text = '', kind: 'POST' | 'COMMENT' | 'MESSAGE' = 'POST') {
  let q = qualify(reading, dna, { ageDays, duplicate: false });
  const intent = classifyBuyerIntent({ text, kind, reading });
  if (intent.resultType === 'EXCLUDED' && q.category !== 'REJECTED') q = { ...q, category: 'REJECTED', reasons: [...q.reasons, 'INTENT_EXCLUDED'] };
  if (intent.resultType === 'INTEREST' && q.category === 'STRONG') q = { ...q, category: 'POTENTIAL' };
  return { category: q.category, reasons: q.reasons, limitations: q.limitations, resultType: intent.resultType };
}

export async function advanceAiReplay(db: any): Promise<Record<string, unknown> | null> {
  const { data: reqRow } = await db.from('admin_settings').select('value').eq('key', REQUEST_KEY).maybeSingle();
  const req = reqRow?.value as { matchingJobId?: string; status?: string } | null;
  if (!req?.matchingJobId || req.status !== 'REQUESTED') return null;
  const { data: resRow } = await db.from('admin_settings').select('value').eq('key', RESULT_KEY).maybeSingle();
  const prev = resRow?.value?.matchingJobId === req.matchingJobId && resRow?.value?.version === AI_CLASSIFIER_VERSION ? resRow.value : null;
  const prog: any = prev ?? { matchingJobId: req.matchingJobId, version: AI_CLASSIFIER_VERSION, startedAt: new Date().toISOString(), offset: 0, rows: [], ai: { calls: 0, failedBatches: 0, missingRetried: 0, costMicros: 0, inputTokens: 0, outputTokens: 0 } };

  const { data: camp } = await db.from('find_buyers_campaigns').select('dna,finalized_at').eq('matching_job_id', req.matchingJobId).maybeSingle();
  if (!camp?.dna) return { error: 'CAMPAIGN_NOT_FOUND' };
  const { data: page } = await db.from('find_buyers_assessments')
    .select('id,signal_id,parent_signal_id,content_kind,role,match_category,similarity')
    .eq('matching_job_id', req.matchingJobId).order('id', { ascending: true }).range(prog.offset, prog.offset + REPLAY_PAGE - 1);
  const rows = (page ?? []) as any[];
  if (rows.length) {
    const ids = [...new Set(rows.flatMap((r) => [r.signal_id, r.parent_signal_id]).filter(Boolean))];
    const { data: sigs } = await db.from('raw_signals').select('id,original_text,author_public_name,published_at').in('id', ids);
    const sig = new Map(((sigs ?? []) as any[]).map((s) => [s.id, s]));
    const settings = await loadFindBuyersSettings(db);
    const cands = rows.filter((r) => sig.get(r.signal_id)?.original_text).map((r) => ({
      id: String(r.id), kind: r.content_kind, text: String(sig.get(r.signal_id).original_text),
      parentExcerpt: r.parent_signal_id ? String(sig.get(r.parent_signal_id)?.original_text ?? '').slice(0, 300) || null : null,
      author: sig.get(r.signal_id).author_public_name ?? null,
    }));
    const { verdicts, stats } = await classifyCandidates(db, {
      book: parsePriceBook(settings.priceBook), dna: camp.dna, matchingJobId: null,
      /* A unique key per invocation: a page that is ever re-run is still recorded as the paid call it is. */
      keyPrefix: `ai:replay:${req.matchingJobId}:${prog.offset}:${Date.now()}`, operation: 'AI_REPLAY',
      metadata: { replayOf: req.matchingJobId, version: AI_CLASSIFIER_VERSION },
    }, cands);
    for (const k of Object.keys(stats)) prog.ai[k] = (prog.ai[k] ?? 0) + ((stats as any)[k] ?? 0);
    const endAt = Date.parse(camp.finalized_at ?? '') || Date.now();
    for (const c of cands) {
      const r = rows.find((x) => String(x.id) === c.id)!;
      const s = sig.get(r.signal_id);
      const ageDays = s?.published_at ? Math.max(0, (endAt - Date.parse(s.published_at)) / 86_400_000) : null;
      const parentRule = c.parentExcerpt ? classifyDemand(c.parentExcerpt) : null;
      let rule = c.kind === 'COMMENT' ? classifyComment(c.text, parentRule ? { role: parentRule.role, similarity: Number(r.similarity) || 0 } : null) : classifyDemand(c.text, { kind: c.kind as any });
      rule = withAuthorEvidence(rule, { name: c.author });
      const v = verdicts.get(c.id) ?? null;
      const after = withAuthorEvidence(applyAiVerdict(rule, v, c.text), { name: c.author });
      const res = replayCategory(after, camp.dna, ageDays, c.text, c.kind as any);
      prog.rows.push({
        assessmentId: r.id, kind: c.kind, text: safeText(c.text, 160),
        before: { role: r.role, category: r.match_category },
        ai: v ? { role: v.role, subject: v.subject, offersProperty: v.offersProperty, confidence: v.confidence, transaction: v.transaction, compatibility: v.compatibility, reason: v.reason, evidence: v.evidence } : null,
        after: { role: after.role, gate: after.evidence.find((e: string) => e.startsWith('ai_conflict_') || e === 'ai_not_real_estate') ?? null, category: res.category, resultType: res.resultType, viaBroker: buyerViaBroker(after), limitations: res.limitations },
      });
    }
    prog.offset += rows.length;
  }
  const done = rows.length < REPLAY_PAGE;
  if (done) {
    const count = (f: (x: any) => boolean) => prog.rows.filter(f).length;
    prog.summary = {
      candidates: prog.rows.length,
      beforeShown: count((x: any) => x.before.category && x.before.category !== 'REJECTED'),
      afterShown: count((x: any) => x.after.category !== 'REJECTED'),
      directBuyers: count((x: any) => x.ai?.role === 'DIRECT_BUYER' || x.ai?.role === 'DIRECT_TENANT'),
      brokersWithClient: count((x: any) => x.ai?.role === 'BROKER_WITH_CLIENT'),
      brokersCollecting: count((x: any) => x.ai?.role === 'BROKER_COLLECTING_LISTINGS'),
      sellersServicesIrrelevant: count((x: any) => ['SELLER_OR_LANDLORD', 'SERVICE_PROVIDER', 'IRRELEVANT'].includes(x.ai?.role)),
      uncertain: count((x: any) => x.ai?.role === 'UNCERTAIN' || (x.ai && x.ai.confidence < 0.6)),
      unverified: count((x: any) => !x.ai),
      /* fb-ai-2: buyer/tenant verdicts the deterministic consistency gate kept out of the leads. */
      gateBlocked: count((x: any) => !!x.after.gate),
    };
    prog.finishedAt = new Date().toISOString();
    prog.done = true;
  }
  const { error: writeError } = await db.from('admin_settings').upsert({ key: RESULT_KEY, value: prog, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (writeError) {
    /* Never loop on a page that cannot be stored (each retry would pay the model again). */
    await db.from('admin_settings').update({ value: { ...req, status: 'FAILED', error: String(writeError.message ?? writeError).slice(0, 300), at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('key', REQUEST_KEY);
    return { replay: req.matchingJobId, error: 'RESULT_WRITE_FAILED', offset: prog.offset };
  }
  if (done) await db.from('admin_settings').update({ value: { ...req, status: 'DONE', finishedAt: prog.finishedAt }, updated_at: new Date().toISOString() }).eq('key', REQUEST_KEY);
  return { replay: req.matchingJobId, processed: rows.length, offset: prog.offset, done };
}
