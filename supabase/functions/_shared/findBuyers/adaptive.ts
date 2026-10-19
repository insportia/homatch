// FIND BUYERS — one adaptive round (the I/O around src/research-core/findBuyers/adaptiveLoop.ts).
//
// Called by the discovery driver when a campaign's queue has drained BEFORE its
// deadline. Before 2026-10-12 that moment finalized the campaign, so a first batch
// with zero qualified leads ended the search with most of the budget unspent.
//
//   1. evidence   measured, from this campaign's runs, queue and assessments, plus
//                 each Actor's record across campaigns (learning is shared; the
//                 property-specific strategy is not)
//   2. next pass  the bounded fallback ladder, or an honest stop
//   3. propose    OpenAI, strict schema, numbers only (never raw posts)
//   4. validate   adaptiveLoop.validateActions: allowlist, health, stage, budget,
//                 no repeated query, comments only under promising parents
//   5. queue      the survivors, as ordinary memo23 jobs (same executor, same atomic
//                 reservation, same caps, same idempotency)
//   6. record     the round in find_buyers_campaigns.query_plan.adaptive
//
// Nothing here starts a provider run directly and nothing here can raise a cap.

import {
  ADAPTIVE_ACTION_SCHEMA, ADAPTIVE_SYSTEM_PROMPT, ADAPTIVE_VERSION, evidenceForModel, fallbackActions, nextStep,
  validateActions, type ActorEvidence, type ActorGate, type CampaignEvidence, type Pass, type ProposedAction, type StopReason,
} from '../../../../src/research-core/findBuyers/adaptiveLoop.ts';
import { propertyFamily } from '../../../../src/research-core/findBuyers/propertyFamily.ts';
import { campaignStats, enabledActorMap, insertQueueRows, loadFindBuyersSettings, socialJobRow } from './campaign.ts';
import { openAiJson, parsePriceBook, recordAiCost } from './openai.ts';
import type { ParentContext } from './pipeline.ts';
import { extractTextFacts } from '../../../../src/research-core/findBuyers/textFacts.ts';
import { aiCallCeilingMicros, executionHeadroomMicros } from '../../../../src/research-core/findBuyers/executionBudget.ts';

/** The parent post of each promising comment target, kept beside (not inside) the evidence the model sees. */
const PARENTS = new WeakMap<object, Map<string, ParentContext>>();

export interface AdaptiveRoundRecord {
  version: string;
  round: number;
  pass: Pass | null;
  at: string;
  source: 'MODEL' | 'FALLBACK' | null;
  queued: number;
  rejected: Array<{ type: string; detail: string; reason: string }>;
  stoppedActors: string[];
  stop: StopReason | null;
  assessment: string | null;
  evidence: { qualified: number; spentUsd: number; remainingUsd: number; postsInspected: number };
}

export interface AdaptiveState { rounds: AdaptiveRoundRecord[]; stop: StopReason | null }

function stateOf(queryPlan: any): AdaptiveState {
  const a = queryPlan?.adaptive;
  return { rounds: Array.isArray(a?.rounds) ? a.rounds : [], stop: a?.stop ?? null };
}

/** The usable Actors: enabled, priced and verified (enabledActorMap), and not FAILED. */
async function actorGates(db: any, maxAgeDays: number): Promise<Record<string, ActorGate>> {
  const gates = await enabledActorMap(db, maxAgeDays) as Record<string, ActorGate>;
  const { data } = await db.from('find_buyers_actor_registry').select('actor_key,health');
  for (const r of (data ?? []) as any[]) if (r.health === 'FAILED') delete gates[r.actor_key];
  return gates;
}

async function gatherEvidence(db: any, campaign: any, state: AdaptiveState, settings: any): Promise<CampaignEvidence> {
  const jobId = campaign.matching_job_id;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [runsRes, globalRes, queueRes, assessRes, stats, aiRes] = await Promise.all([
    db.from('find_buyers_actor_runs').select('actor_key,status,items_fetched,useful_results,qualified_leads,actual_micros,reserved_micros,cost_booked_at,language,created_at')
      .eq('matching_job_id', jobId).limit(500),
    db.from('find_buyers_actor_runs').select('actor_key,status,items_fetched,qualified_leads,actual_micros,cost_booked_at')
      .gte('created_at', since).limit(5000),
    db.from('discovery_query_queue').select('status,language,result_count,metadata').eq('matching_job_id', jobId).limit(1000),
    db.from('find_buyers_assessments').select('role,match_category,content_kind,similarity,comments_decision,signal_id,parent_signal_id,rejection_reasons,reported:qualification->reportedComments,source_kind:qualification->sourceKind')
      .eq('matching_job_id', jobId).limit(5000),
    campaignStats(db, jobId),
    /* OpenAI is paid from the same provider budget (same rule as the reserve RPC). */
    db.from('find_buyers_cost_ledger').select('estimated_micros,actual_micros')
      .eq('matching_job_id', jobId).eq('provider', 'OPENAI').eq('after_settlement', false).limit(5000),
  ]);
  const runs = ((runsRes.data ?? []) as any[]).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const cost = (r: any) => Number(r.actual_micros ?? (r.cost_booked_at ? 0 : r.reserved_micros) ?? 0);

  const actors = new Map<string, ActorEvidence>();
  const ensure = (key: string) => {
    let a = actors.get(key);
    if (!a) {
      a = { actorKey: key, runs: 0, items: 0, useful: 0, qualified: 0, spentMicros: 0, emptyStreak: 0, failedStreak: 0,
        globalRuns: 0, globalItems: 0, globalQualified: 0, globalSpentMicros: 0 };
      actors.set(key, a);
    }
    return a;
  };
  for (const r of runs) {
    if (r.status === 'RELEASED') continue;
    const a = ensure(r.actor_key);
    a.runs++; a.items += Number(r.items_fetched || 0); a.useful += Number(r.useful_results || 0);
    a.qualified += Number(r.qualified_leads || 0); a.spentMicros += cost(r);
    const failed = ['FAILED', 'TIMED_OUT', 'ABORTED'].includes(String(r.status));
    a.failedStreak = failed ? a.failedStreak + 1 : 0;
    a.emptyStreak = !failed && Number(r.items_fetched || 0) === 0 && r.cost_booked_at ? a.emptyStreak + 1 : failed ? a.emptyStreak : 0;
  }
  for (const r of (globalRes.data ?? []) as any[]) {
    if (!r.cost_booked_at || r.status === 'RELEASED') continue;
    const a = ensure(r.actor_key);
    a.globalRuns++; a.globalItems += Number(r.items_fetched || 0); a.globalQualified += Number(r.qualified_leads || 0);
    a.globalSpentMicros += Number(r.actual_micros || 0);
  }

  const languages = new Map<string, { language: string; queries: number; items: number; qualified: number }>();
  const usedQueries: Array<{ language: string; query: string }> = [];
  const usedTargets: string[] = [];
  for (const q of (queueRes.data ?? []) as any[]) {
    const m = q.metadata ?? {};
    if (m.query) usedQueries.push({ language: String(q.language ?? ''), query: String(m.query) });
    if (m.targetUrl) usedTargets.push(String(m.targetUrl));
    const lang = String(q.language ?? 'multi');
    if (lang === 'multi') continue;
    const l = languages.get(lang) ?? { language: lang, queries: 0, items: 0, qualified: 0 };
    l.queries++; l.items += Number(q.result_count || 0);
    languages.set(lang, l);
  }
  for (const r of runs) {
    const l = r.language && languages.get(r.language);
    if (l) l.qualified += Number(r.qualified_leads || 0);
  }

  const assess = (assessRes.data ?? []) as any[];
  /* Parent posts that earned their comments (the pipeline's own comment gate) and were not read
     yet: comparable LISTINGS of the campaign's market (buyers comment under listings, not under
     requests), not reported comment-less, and with no comment of theirs assessed already. */
  const listingRole = campaign.transaction === 'RENT' ? 'RENT_OFFER' : 'SALE_OFFER';
  const commented = new Set(assess.filter((x) => x.content_kind === 'COMMENT' && x.parent_signal_id).map((x) => x.parent_signal_id));
  const parentRows = assess.filter((x) => x.content_kind !== 'COMMENT' && x.role === listingRole && Number(x.similarity) >= Number(settings.commentGate?.eligibleFrom ?? 75)
    && x.signal_id && !commented.has(x.signal_id) && Number(x.reported) !== 0).slice(0, 20);
  let promisingParents: CampaignEvidence['promisingParents'] = [];
  /* The parent each adaptive comment job reads under: without it every comment is judged
     context-free (UNCLEAR) and nothing links back to the post. */
  const parentContexts = new Map<string, ParentContext>();
  if (parentRows.length) {
    const { data: sig } = await db.from('raw_signals').select('id,source_url,platform,external_id,original_text,published_at').in('id', parentRows.map((x) => x.signal_id));
    const byId = new Map(parentRows.map((x) => [x.signal_id, x]));
    for (const s of ((sig ?? []) as any[])) {
      if (!s.source_url || !['FACEBOOK', 'INSTAGRAM'].includes(String(s.platform).toUpperCase())) continue;
      const a = byId.get(s.id);
      const published = s.published_at ? Date.parse(String(s.published_at)) : NaN;
      parentContexts.set(String(s.source_url).toLowerCase(), {
        externalId: String(s.external_id ?? s.id), url: String(s.source_url), signalId: String(s.id), similarity: Number(a?.similarity ?? 0),
        stance: 'OFFER', role: listingRole, excerpt: s.original_text ? String(s.original_text).slice(0, 300) : null,
        facts: s.original_text ? extractTextFacts(String(s.original_text)) : null,
        ageDays: Number.isFinite(published) ? (Date.now() - published) / 86_400_000 : null, publishedAt: s.published_at ?? null,
        commentCount: a?.reported == null ? null : Number(a.reported), sampleDepth: 0, sourceKind: a?.source_kind ?? null,
      });
      promisingParents.push({ url: String(s.source_url), stage: String(s.platform).toUpperCase() === 'INSTAGRAM' ? 'IG_COMMENTS' : 'FB_COMMENTS', similarity: Number(a?.similarity ?? 0) });
    }
    promisingParents = promisingParents.filter((p) => !usedTargets.some((t) => t.toLowerCase() === p.url.toLowerCase()));
  }

  const dna = campaign.dna ?? {};
  const aiSpentMicros = ((aiRes.data ?? []) as any[]).reduce((n, r) => n + Number(r.actual_micros ?? r.estimated_micros ?? 0), 0);
  const spentMicros = runs.filter((r) => r.status !== 'RELEASED').reduce((n, r) => n + cost(r), 0) + aiSpentMicros;
  const last = state.rounds[state.rounds.length - 1];
  const evidence: CampaignEvidence = {
    transaction: dna.transaction === 'RENT' ? 'RENT' : 'SALE',
    family: dna.family ?? propertyFamily(dna.propertyType),
    city: dna.city ?? null, district: dna.district ?? null, price: dna.price ?? null, currency: dna.currency ?? null, areaSqm: dna.areaSqm ?? null,
    round: state.rounds.length,
    passesTried: state.rounds.map((r) => r.pass).filter(Boolean) as Pass[],
    budgetMicros: Number(campaign.provider_budget_micros || 0),
    spentMicros,
    aiSpentMicros,
    sourcesDiscovered: (stats.sourcesExplored ?? []).length + runs.filter((r) => r.actor_key === 'FB_GROUP_SEARCH').reduce((n, r) => n + Number(r.useful_results || 0), 0),
    postsInspected: assess.length,
    signals: assess.filter((x) => x.role === 'BUY_SEEKER' || x.role === 'RENT_SEEKER').length,
    qualified: Number(stats.qualified || 0),
    strong: Number(stats.strong || 0),
    duplicates: assess.filter((x) => (x.rejection_reasons ?? []).includes?.('DUPLICATE')).length,
    irrelevant: assess.filter((x) => ['IRRELEVANT', 'JOB', 'SERVICE'].includes(x.role)).length,
    lastRoundQualified: last ? Math.max(0, Number(stats.qualified || 0) - Number(last.evidence?.qualified ?? 0)) : null,
    actors: [...actors.values()],
    languages: [...languages.values()],
    usedQueries, usedTargets, promisingParents,
  };
  PARENTS.set(evidence, parentContexts);
  return evidence;
}

/**
 * One adaptive round for a drained campaign. Returns how many jobs were queued
 * (> 0: keep the campaign searching) or the reason it should now finish.
 */
export async function adaptiveRound(db: any, matchingJobId: string): Promise<{ queued: number; stop: StopReason | null; pass: Pass | null }> {
  const { data: campaign } = await db.from('find_buyers_campaigns')
    .select('matching_job_id,property_id,transaction,provider_budget_micros,dna,query_plan,finalized_at')
    .eq('matching_job_id', matchingJobId).maybeSingle();
  if (!campaign || campaign.finalized_at) return { queued: 0, stop: null, pass: null };
  const state = stateOf(campaign.query_plan);
  if (state.stop) return { queued: 0, stop: state.stop, pass: null };
  const settings = await loadFindBuyersSettings(db);
  if (!settings.socialEnabled) return { queued: 0, stop: 'NO_USABLE_ACTOR', pass: null };

  const gates = await actorGates(db, settings.pricingMaxAgeDays);
  const evidence = await gatherEvidence(db, campaign, state, settings);
  const parents = PARENTS.get(evidence) ?? new Map<string, ParentContext>();
  const step = nextStep(evidence, gates);
  const now = new Date().toISOString();
  const summary = { qualified: evidence.qualified, spentUsd: evidence.spentMicros / 1e6, remainingUsd: Math.max(0, evidence.budgetMicros - evidence.spentMicros) / 1e6, postsInspected: evidence.postsInspected };
  const record = async (rec: AdaptiveRoundRecord, stop: StopReason | null) => {
    const next = { ...(campaign.query_plan ?? {}), adaptive: { version: ADAPTIVE_VERSION, rounds: [...state.rounds, rec], stop } };
    await db.from('find_buyers_campaigns').update({ query_plan: next, last_activity_at: now }).eq('matching_job_id', matchingJobId).is('finalized_at', null);
    /* Refresh the owner-visible summary (stats.searchPasses) from what was just recorded. */
    const stats = await campaignStats(db, matchingJobId);
    await db.from('find_buyers_campaigns').update({ stats }).eq('matching_job_id', matchingJobId).is('finalized_at', null);
  };

  if (step.kind === 'STOP') {
    await record({ version: ADAPTIVE_VERSION, round: evidence.round + 1, pass: null, at: now, source: null, queued: 0, rejected: [], stoppedActors: [], stop: step.reason, assessment: null, evidence: summary }, step.reason);
    return { queued: 0, stop: step.reason, pass: null };
  }

  /* The model proposes; nothing it says is used before validateActions. */
  let actions: ProposedAction[] = [];
  let assessment: string | null = null;
  let source: 'MODEL' | 'FALLBACK' = 'MODEL';
  /* The proposal is paid from the same execution budget: it is only asked for when the budget
     left covers its worst case (prompt + 1,200 output tokens); otherwise the fallback ladder
     below runs the pass without a model call. */
  const book = parsePriceBook(settings.priceBook);
  const modelInput = { ...evidenceForModel(evidence, step.pass, gates), allowedActors: Object.keys(gates) };
  const ceiling = aiCallCeilingMicros(book, 600 + Math.ceil(JSON.stringify(modelInput).length / 3), 1200);
  if (executionHeadroomMicros(evidence.budgetMicros, evidence.spentMicros) >= ceiling) {
    const res = await openAiJson<{ assessment: string; actions: ProposedAction[] }>(book, ADAPTIVE_SYSTEM_PROMPT,
      modelInput, ADAPTIVE_ACTION_SCHEMA as any, { maxTokens: 1200 });
    await recordAiCost(db, { key: `ai:adaptive:${matchingJobId}:${evidence.round + 1}`, matchingJobId, kind: 'AI', operation: 'ADAPTIVE_PLAN', result: res,
      metadata: { pass: step.pass, round: evidence.round + 1 } }).catch(() => undefined);
    if (res.data?.actions?.length) { actions = res.data.actions; assessment = res.data.assessment ?? null; }
  }
  let v = validateActions(actions, { evidence, gates, pass: step.pass });
  /* Nothing usable from the model (unavailable, or every action refused): the pass still runs. */
  if (!v.jobs.length && !v.stopCampaign) {
    source = 'FALLBACK';
    const fb = validateActions(fallbackActions(evidence, step.pass), { evidence, gates, pass: step.pass });
    v = { ...fb, rejected: [...v.rejected, ...fb.rejected], stoppedActors: [...new Set([...v.stoppedActors, ...fb.stoppedActors])] };
  }

  const stop: StopReason | null = v.stopCampaign ? 'MODEL_DIMINISHING_RETURNS' : null;
  let queued = 0;
  if (!stop && v.jobs.length) {
    const { data: anyRow } = await db.from('discovery_query_queue').select('search_plan_id').eq('matching_job_id', matchingJobId).limit(1).maybeSingle();
    const rows = v.jobs.map((job, i) => socialJobRow(job, {
      matchingJobId, propertyId: campaign.property_id, planId: anyRow?.search_plan_id ?? null, tranche: 2, step: 100 + (evidence.round + 1) * 10 + i,
      parent: { adaptivePass: step.pass, adaptiveRound: evidence.round + 1,
        ...(job.targetUrl && parents.has(job.targetUrl.toLowerCase()) ? { parent: parents.get(job.targetUrl.toLowerCase()) } : {}) },
    }));
    queued = await insertQueueRows(db, rows);
  }
  /* A pass that produced nothing new to search still counts as tried: the ladder moves on next time. */
  await record({ version: ADAPTIVE_VERSION, round: evidence.round + 1, pass: step.pass, at: now, source, queued,
    rejected: v.rejected.slice(0, 30), stoppedActors: v.stoppedActors, stop, assessment, evidence: summary }, stop);
  return { queued, stop, pass: step.pass };
}
