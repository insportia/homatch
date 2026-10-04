// FIND BUYERS — executing one APIFY_MEMO23 queue job.
//
// A claim is short: it either STARTS a provider run (after reserving its
// budget) or POLLS one. Waiting happens between claims (WAIT → the queue's
// wait-finish, which does not consume an attempt), never under a lease.
//
// Correlation on every row and ledger line: matching job (campaign run),
// queue job, actor run, provider run id, attempt, tranche, arm.

import { buildInput, STAGE_OUTPUT, STAGE_NETWORK, type Stage } from '../../../../src/research-core/findBuyers/actorInputs.ts';
import { normalizeDataset } from '../../../../src/research-core/findBuyers/normalize.ts';
import { provesOutputContract } from '../../../../src/research-core/findBuyers/actorCatalog.ts';
import { decideArm, armPriority, parseSampling, type ArmStats } from '../../../../src/research-core/findBuyers/allocator.ts';
import { queryHash } from '../../../../src/research-core/findBuyers/queryPlanner.ts';
import { sinceFloor } from '../../../../src/research-core/findBuyers/freshness.ts';

/* Stages whose Actor accepts a date floor: never ask for content older than 30 days. */
const DATE_STAGES: ReadonlySet<string> = new Set(['FB_GROUP_POSTS', 'IG_PROFILE_POSTS', 'VK_WALL', 'TELEGRAM_CHANNEL', 'BLUESKY_SEARCH', 'X_PROFILE', 'THREADS_PROFILE']);
import { abortRun, datasetItems, getRun, Memo23Error, runCost, startRun, TERMINAL_RUN_STATES, scrub } from './memo23Client.ts';
import { processItems, type CampaignRow, type ParentContext, type FollowUp } from './pipeline.ts';
import { campaignStats, insertQueueRows, loadFindBuyersSettings, socialJobRow, type FindBuyersSettings } from './campaign.ts';
import { parsePriceBook } from './openai.ts';

export interface SocialOutcome {
  outcome: 'DONE' | 'WAIT' | 'RETRY' | 'FAILED' | 'CANCELLED' | 'BUDGET_REACHED';
  resultCount: number;
  error: string | null;
  retrySeconds: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
}

/* A running provider run is looked at again this soon (the queue's minimum). */
const POLL_SECONDS = 10;
const out = (o: Partial<SocialOutcome> & { outcome: SocialOutcome['outcome'] }): SocialOutcome =>
  ({ resultCount: 0, error: null, retrySeconds: null, costUsd: null, metadata: {}, ...o });

export async function executeSocialJob(db: any, job: any): Promise<SocialOutcome> {
  const meta = (job.metadata ?? {}) as Record<string, any>;
  const stage = meta.stage as Stage;
  if (!stage || !STAGE_OUTPUT[stage]) return out({ outcome: 'FAILED', error: 'BAD_JOB: unknown stage' });
  const { data: campaign } = await db.from('find_buyers_campaigns')
    .select('matching_job_id,campaign_id,property_id,user_id,transaction,dna,provider_budget_micros,finalized_at')
    .eq('matching_job_id', job.matching_job_id).maybeSingle();
  if (!campaign || campaign.finalized_at) return out({ outcome: 'CANCELLED', error: 'CAMPAIGN_FINALIZED' });
  const settings = await loadFindBuyersSettings(db);
  if (meta.actorRunId) return poll(db, job, campaign, settings);
  if (!settings.socialEnabled) return out({ outcome: 'CANCELLED', error: 'SOCIAL_DISABLED' });
  return start(db, job, campaign, settings);
}

async function actorRow(db: any, key: string) {
  const { data } = await db.from('find_buyers_actor_registry').select('*').eq('actor_key', key).maybeSingle();
  return data;
}

async function start(db: any, job: any, campaign: any, settings: FindBuyersSettings, actorKeyOverride?: string): Promise<SocialOutcome> {
  const meta = job.metadata as Record<string, any>;
  const stage = meta.stage as Stage;
  const actorKey = actorKeyOverride ?? String(meta.actorKey);
  const actor = await actorRow(db, actorKey);
  if (!actor) return out({ outcome: 'FAILED', error: `UNKNOWN_ACTOR: ${actorKey}` });
  const retryCount = Number(meta.retryCount ?? 0);

  const { data: reservation, error: rErr } = await db.rpc('find_buyers_reserve_actor_run', {
    p_matching_job_id: job.matching_job_id,
    p_actor_key: actorKey,
    p_idempotency_key: `q:${job.id}:${actorKey}:r${retryCount}`,
    p_queue_job_id: job.id,
    p_operation: stage,
    p_language: job.language ?? null,
    p_tranche: Number(meta.tranche ?? 0),
    p_requested_limit: Number(meta.size ?? actor.probe_size),
    p_reason: { arm: meta.arm, reason: meta.reason, step: meta.step ?? 0, query: meta.query ?? null, targetUrl: meta.targetUrl ?? null, sourceId: meta.sourceId ?? null },
    p_retry_of: meta.retryOf ?? null,
  });
  if (rErr) return out({ outcome: 'RETRY', error: `RESERVE_FAILED: ${rErr.message}`, retrySeconds: 60 });
  if (!reservation?.ok) {
    const reason = String(reservation?.reason ?? 'UNKNOWN');
    if (reason === 'ACTOR_BUSY') return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { lastWait: 'ACTOR_BUSY' } });
    /* Every global memo23 slot is taken: look again shortly (a slot frees as
       soon as a running run is booked). */
    if (reason === 'GLOBAL_BUSY') return out({ outcome: 'WAIT', retrySeconds: 10, metadata: { lastWait: 'GLOBAL_BUSY' } });
    if (['CAMPAIGN_BUDGET', 'ACTOR_CAMPAIGN_CAP', 'ACTOR_DAILY_CAP'].includes(reason)) {
      return out({ outcome: 'BUDGET_REACHED', error: reason, metadata: { budget: reservation } });
    }
    if (['ACTOR_DISABLED', 'PRICING_NOT_VERIFIED'].includes(reason) && actor.fallback_actor_key && !actorKeyOverride) {
      return start(db, job, campaign, settings, actor.fallback_actor_key);
    }
    return out({ outcome: 'CANCELLED', error: reason });
  }
  const runId = String(reservation.runId);
  if (reservation.replay) {
    const { data: existing } = await db.from('find_buyers_actor_runs').select('provider_run_id,dataset_id,status').eq('id', runId).maybeSingle();
    if (existing?.provider_run_id) return out({ outcome: 'WAIT', retrySeconds: 5, metadata: { actorRunId: runId, providerRunId: existing.provider_run_id, datasetId: existing.dataset_id } });
    if (existing?.status === 'STARTING') {
      /* A previous attempt died during the provider call: the run may exist at
         Apify but its id is lost. Book the reservation as UNKNOWN cost
         (never zero) and stop this job rather than start a second run. */
      await db.rpc('find_buyers_book_run_cost', {
        p_run_id: runId, p_status: 'ABORTED', p_actual_micros: null, p_cost_basis: 'UNKNOWN', p_results_billed: null,
        p_items_fetched: 0, p_error: 'START_INTERRUPTED: provider run id unknown', p_billing: {},
      });
      return out({ outcome: 'FAILED', error: 'START_INTERRUPTED' });
    }
    if (existing && existing.status !== 'RESERVED') return out({ outcome: 'FAILED', error: `RUN_${existing.status}` });
    /* Still RESERVED: the gates are checked again — the actor may have been
       disabled since the reservation was taken. */
    if (reservation.actorEnabled === false) {
      await db.rpc('find_buyers_book_run_cost', {
        p_run_id: runId, p_status: 'RELEASED', p_actual_micros: 0, p_cost_basis: 'NOT_STARTED', p_results_billed: 0,
        p_items_fetched: 0, p_error: 'ACTOR_DISABLED_BEFORE_START', p_billing: {},
      });
      return out({ outcome: 'CANCELLED', error: 'ACTOR_DISABLED' });
    }
  }

  /* Incremental reading: only content newer than the source's last check (≤30 days). */
  /* 30-day floor always; tighter (since the last check, minus 6 h overlap) for a known source. */
  let since: string | null = DATE_STAGES.has(stage) ? sinceFloor() : null;
  if (since && meta.sourceId) {
    const { data: src } = await db.from('source_registry').select('last_checked_at').eq('id', meta.sourceId).maybeSingle();
    const last = src?.last_checked_at ? Date.parse(src.last_checked_at) - 6 * 3_600_000 : 0;
    since = new Date(Math.max(Date.parse(since), last)).toISOString();
  }
  const limit = Math.max(1, Math.min(Number(reservation.requestedLimit) || Number(actor.probe_size) || 1, Number(actor.max_results) || 100));
  const { input, dropped } = buildInput(stage, { query: meta.query ?? null, targetUrl: meta.targetUrl ?? null, size: limit, since }, actor.input_contract ?? null);
  /* STARTING before the provider call, and only from RESERVED and unbooked:
     a campaign that ended meanwhile has already released this reservation. */
  const { data: starting } = await db.from('find_buyers_actor_runs').update({ status: 'STARTING' })
    .eq('id', runId).eq('status', 'RESERVED').is('cost_booked_at', null).select('id');
  if (!Array.isArray(starting) || starting.length !== 1) return out({ outcome: 'CANCELLED', error: 'RESERVATION_NO_LONGER_OPEN' });
  try {
    const started = await startRun(actor.actor_id, input, {
      maxItems: limit,
      maxTotalChargeUsd: Number(reservation.reservedMicros) / 1_000_000,
      timeoutSeconds: Number(actor.timeout_seconds),
    });
    const { data: marked } = await db.from('find_buyers_actor_runs').update({
      status: 'RUNNING', provider_run_id: started.runId, dataset_id: started.datasetId, started_at: new Date().toISOString(),
      reason: { arm: meta.arm, reason: meta.reason, step: meta.step ?? 0, query: meta.query ?? null, targetUrl: meta.targetUrl ?? null, sourceId: meta.sourceId ?? null, droppedInputKeys: dropped, since },
    }).eq('id', runId).is('cost_booked_at', null).select('id');
    if (!Array.isArray(marked) || marked.length !== 1) {
      /* The campaign finished while the run was being created (its cost was
         booked as UNKNOWN at the reservation): stop the provider run now. */
      await abortRun(started.runId);
      return out({ outcome: 'CANCELLED', error: 'CAMPAIGN_ENDED_DURING_START' });
    }
    console.log(JSON.stringify({ fb: 'run_started', matchingJobId: job.matching_job_id, queueJobId: job.id, actorRunId: runId, providerRunId: started.runId, actor: actorKey, stage, language: job.language, tranche: meta.tranche ?? 0, attempt: retryCount + 1, limit, reservedMicros: reservation.reservedMicros, reason: meta.reason }));
    return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS, metadata: { actorRunId: runId, providerRunId: started.runId, datasetId: started.datasetId, actorKey } });
  } catch (error) {
    const e = error instanceof Memo23Error ? error : new Memo23Error(scrub(String(error)), 0, true);
    /* The provider refused the start (an HTTP answer, so no run exists): back to
       RESERVED, then release. A network error is ambiguous — booked UNKNOWN. */
    /* Network errors and 5xx answers are ambiguous: the run may exist. */
    if (e.status === 0 || e.status >= 500) {
      await db.rpc('find_buyers_book_run_cost', {
        p_run_id: runId, p_status: 'ABORTED', p_actual_micros: null, p_cost_basis: 'UNKNOWN', p_results_billed: null,
        p_items_fetched: 0, p_error: `START_AMBIGUOUS: ${e.message}`, p_billing: {},
      });
      await markActorHealth(db, actorKey, false, e.message, false);
      return out({ outcome: 'FAILED', error: e.message });
    }
    await db.from('find_buyers_actor_runs').update({ status: 'RESERVED' }).eq('id', runId).eq('status', 'STARTING').is('cost_booked_at', null);
    await db.rpc('find_buyers_book_run_cost', {
      p_run_id: runId, p_status: 'RELEASED', p_actual_micros: 0, p_cost_basis: 'NOT_STARTED', p_results_billed: 0,
      p_items_fetched: 0, p_error: `START_FAILED: ${e.message}`, p_billing: {},
    });
    await markActorHealth(db, actorKey, false, e.message, [401, 402, 403].includes(e.status));
    console.log(JSON.stringify({ fb: 'run_start_failed', matchingJobId: job.matching_job_id, queueJobId: job.id, actor: actorKey, status: e.status, error: e.message }));
    if (e.retryable && retryCount < Number(actor.retry_cap)) {
      return out({ outcome: 'RETRY', error: e.message, retrySeconds: 60, metadata: { retryCount: retryCount + 1, retryOf: runId, actorRunId: null } });
    }
    return out({ outcome: 'FAILED', error: e.message });
  }
}

async function poll(db: any, job: any, campaign: any, settings: FindBuyersSettings): Promise<SocialOutcome> {
  const meta = job.metadata as Record<string, any>;
  const stage = meta.stage as Stage;
  const { data: run } = await db.from('find_buyers_actor_runs').select('*').eq('id', meta.actorRunId).maybeSingle();
  if (!run) return out({ outcome: 'FAILED', error: 'RUN_MISSING' });
  const actor = await actorRow(db, run.actor_key);

  let r: any = null;
  if (!run.cost_booked_at) {
    const providerRunId = run.provider_run_id ?? meta.providerRunId ?? null;
    if (!providerRunId) return out({ outcome: 'WAIT', retrySeconds: 45, metadata: { lastPollError: 'NO_PROVIDER_RUN_ID' } });
    try { r = await getRun(providerRunId); } catch (error) {
      return out({ outcome: 'WAIT', retrySeconds: 45, metadata: { lastPollError: scrub(String(error)) } });
    }
    if (!r) return out({ outcome: 'WAIT', retrySeconds: 45 });
    if (!TERMINAL_RUN_STATES.has(String(r.status))) {
      const startedAt = Date.parse(run.started_at ?? run.created_at);
      if (Date.now() - startedAt > (Number(actor?.timeout_seconds ?? 300) + 120) * 1000) {
        await abortRun(providerRunId);
        r = await getRun(providerRunId).catch(() => r);
        if (!TERMINAL_RUN_STATES.has(String(r?.status))) return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { aborting: true } });
      } else {
        return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS });
      }
    }
  }

  /* Results: whatever the run produced, even when it failed part way. */
  let items: unknown[] = [];
  let total: number | null = null;
  const datasetId = run.dataset_id ?? meta.datasetId ?? r?.defaultDatasetId ?? null;
  if (datasetId) {
    try { ({ items, total } = await datasetItems(datasetId, Number(run.requested_limit) + 10)); }
    catch (error) { if (!run.cost_booked_at) return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { lastPollError: scrub(String(error)) } }); }
  }
  const billed = total ?? items.length;
  const status = String(r?.status ?? run.status);
  const bookStatus = status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'TIMED-OUT' || status === 'TIMED_OUT' ? 'TIMED_OUT' : status === 'ABORTED' ? 'ABORTED' : 'FAILED';
  let costMicros: number | null = run.actual_micros ?? null;
  if (!run.cost_booked_at) {
    const cost = runCost(r, billed);
    let micros = cost.micros; let basis: string = cost.basis;
    if (micros == null && actor?.price_per_1k_micros != null) {
      micros = Number(actor.start_fee_micros || 0) + Math.ceil(billed * Number(actor.price_per_1k_micros) / 1000);
      basis = 'REGISTRY_PRICE_X_BILLED_UNITS';
    }
    await db.rpc('find_buyers_book_run_cost', {
      p_run_id: run.id, p_status: bookStatus, p_actual_micros: micros, p_cost_basis: basis, p_results_billed: billed,
      p_items_fetched: items.length, p_error: bookStatus === 'SUCCEEDED' ? null : `RUN_${status}: ${scrub(String(r?.statusMessage ?? ''))}`,
      p_billing: cost.billing,
    });
    costMicros = micros;
    await markActorHealth(db, run.actor_key, bookStatus === 'SUCCEEDED', bookStatus === 'SUCCEEDED' ? null : `RUN_${status}`, false);
  }

  /* Process. */
  const network = STAGE_NETWORK[stage];
  const parent = (meta.parent ?? null) as ParentContext | null;
  const normalized = normalizeDataset(STAGE_OUTPUT[stage], network, items, parent ? { externalId: parent.externalId, url: parent.url } : null);
  /* The output contract is proven only by a real run whose items parsed into
     real content with a real public URL (never by metadata, never by 0 items). */
  if (bookStatus === 'SUCCEEDED' && provesOutputContract(normalized)) {
    const at = new Date().toISOString();
    await db.from('find_buyers_actor_registry').update({ output_contract_verified_at: at, last_verified_at: at }).eq('actor_key', run.actor_key);
  }
  const sourceYield = await sourceYieldOf(db, meta.sourceId ?? null);
  const result = await processItems({
    db, campaign: campaign as CampaignRow, stage, runId: run.id, runLanguage: job.language ?? null,
    datasetId, providerRunId: run.provider_run_id, book: parsePriceBook(settings.priceBook), gate: settings.commentGate,
    parent, sourceId: meta.sourceId ?? null, sourceYield,
  }, normalized);

  await db.from('find_buyers_actor_runs').update({
    items_fetched: items.length, useful_results: result.useful, qualified_leads: result.qualified, strong_leads: result.strong,
    stale_dropped: result.staleDropped,
  }).eq('id', run.id);
  /* Stats once per run: a replayed poll (lease lost after booking) adds nothing twice. */
  const { data: firstApply } = await db.from('find_buyers_actor_runs').update({ stats_applied_at: new Date().toISOString() })
    .eq('id', run.id).is('stats_applied_at', null).select('id');
  const applyStats = Array.isArray(firstApply) && firstApply.length === 1;
  if (applyStats && meta.sourceId) {
    const { data: src } = await db.from('source_registry').select('posts_observed,fb_spend_micros,fb_qualified_leads,fb_strong_leads').eq('id', meta.sourceId).maybeSingle();
    if (src) await db.from('source_registry').update({
      posts_observed: Number(src.posts_observed || 0) + normalized.length,
      fb_spend_micros: Number(src.fb_spend_micros || 0) + Number(costMicros || 0),
      fb_qualified_leads: Number(src.fb_qualified_leads || 0) + result.qualified,
      fb_strong_leads: Number(src.fb_strong_leads || 0) + result.strong,
      /* The read window advances only after a successful read. */
      ...(bookStatus === 'SUCCEEDED' ? { last_checked_at: new Date().toISOString(), last_successful_at: new Date().toISOString() } : {}),
      ...(result.qualified > 0 ? { last_useful_at: new Date().toISOString() } : {}),
    }).eq('id', meta.sourceId);
  }
  if (applyStats && meta.query && ['FB_GROUP_SEARCH', 'TIKTOK_SEARCH', 'LINKEDIN_POSTS', 'LINKEDIN_GROUPS', 'VK_WALL', 'REDDIT_SEARCH', 'QUORA_SEARCH', 'BLUESKY_SEARCH'].includes(stage)) {
    await bumpQueryStats(db, network, job.language ?? 'multi', String(meta.query), Number(costMicros || 0), normalized.length, result);
  }

  /* Follow-ups (group posts, gated comments) and the arm's next tranche. */
  const followRows = await followUpRows(db, job, campaign, result.followUps, settings);
  const deepen = await deepenRow(db, job, campaign, settings, result.groupsFound);
  const queued = await insertQueueRows(db, [...followRows, ...(deepen?.row ? [deepen.row] : [])]);
  const stats = await campaignStats(db, job.matching_job_id);
  await db.from('find_buyers_campaigns').update({ stats, last_activity_at: new Date().toISOString() }).eq('matching_job_id', job.matching_job_id);

  console.log(JSON.stringify({
    fb: 'run_processed', matchingJobId: job.matching_job_id, queueJobId: job.id, actorRunId: run.id, providerRunId: run.provider_run_id,
    actor: run.actor_key, stage, status, billed, costMicros, items: normalized.length, useful: result.useful, qualified: result.qualified,
    strong: result.strong, duplicates: result.duplicates, reused: result.reused, staleDropped: result.staleDropped, followUps: followRows.length,
    armDecision: deepen?.decision ?? null, queued,
  }));

  const retryCount = Number(meta.retryCount ?? 0);
  if (bookStatus !== 'SUCCEEDED' && normalized.length === 0) {
    if (retryCount < Number(actor?.retry_cap ?? 0) && bookStatus !== 'ABORTED') {
      return out({ outcome: 'RETRY', error: `RUN_${status}`, retrySeconds: 90, costUsd: Number(costMicros || 0) / 1e6, metadata: { retryCount: retryCount + 1, retryOf: run.id, actorRunId: null } });
    }
    return out({ outcome: 'FAILED', error: `RUN_${status}`, costUsd: Number(costMicros || 0) / 1e6 });
  }
  return out({
    outcome: 'DONE', resultCount: result.qualified, costUsd: Number(costMicros || 0) / 1e6,
    metadata: { processed: true, items: normalized.length, candidates: result.candidates, dispositions: result.dispositions, useful: result.useful, qualified: result.qualified, strong: result.strong, duplicates: result.duplicates, reused: result.reused, armDecision: deepen?.decision ?? null },
  });
}

async function sourceYieldOf(db: any, sourceId: string | null): Promise<number | null> {
  if (!sourceId) return null;
  const { data } = await db.from('source_registry').select('posts_observed,fb_qualified_leads').eq('id', sourceId).maybeSingle();
  const posts = Number(data?.posts_observed || 0);
  return posts > 0 ? Number(data?.fb_qualified_leads || 0) / posts : null;
}

async function markActorHealth(db: any, actorKey: string, ok: boolean, error: string | null, accountProblem: boolean) {
  if (ok) {
    await db.from('find_buyers_actor_registry').update({ health: 'HEALTHY' }).eq('actor_key', actorKey).neq('health', 'DISABLED');
    return;
  }
  const { data: recent } = await db.from('find_buyers_actor_runs').select('status').eq('actor_key', actorKey).order('created_at', { ascending: false }).limit(3);
  const fails = ((recent ?? []) as any[]).filter((r) => ['FAILED', 'TIMED_OUT', 'RELEASED'].includes(r.status)).length;
  await db.from('find_buyers_actor_registry').update({
    health: accountProblem || fails >= 3 ? 'FAILED' : 'DEGRADED',
    last_error: error ? error.slice(0, 500) : null,
  }).eq('actor_key', actorKey).neq('health', 'DISABLED');
}

async function bumpQueryStats(db: any, source: string, language: string, query: string, spend: number, items: number, r: { qualified: number; strong: number }) {
  const hash = queryHash(query);
  const { data } = await db.from('find_buyers_query_stats').select('runs,spend_micros,items,qualified,strong').eq('source', source).eq('language', language).eq('query_hash', hash).maybeSingle();
  await db.from('find_buyers_query_stats').upsert({
    source, language, query_hash: hash, query: query.slice(0, 300),
    runs: Number(data?.runs || 0) + 1, spend_micros: Number(data?.spend_micros || 0) + spend, items: Number(data?.items || 0) + items,
    qualified: Number(data?.qualified || 0) + r.qualified, strong: Number(data?.strong || 0) + r.strong, last_used_at: new Date().toISOString(),
  }, { onConflict: 'source,language,query_hash' });
}

const FOLLOW_STAGE_ACTOR: Partial<Record<Stage, string>> = {
  FB_GROUP_POSTS: 'FB_GROUP_POSTS', FB_COMMENTS: 'FB_COMMENTS', IG_COMMENTS: 'IG_COMMENTS', TIKTOK_COMMENTS: 'TIKTOK',
  REDDIT_COMMENTS: 'REDDIT', YOUTUBE_COMMENTS: 'YOUTUBE_COMMENTS',
};

async function followUpRows(db: any, job: any, campaign: any, followUps: FollowUp[], settings: FindBuyersSettings) {
  if (!followUps.length) return [];
  const { data: actors } = await db.from('find_buyers_actor_registry').select('actor_key,probe_size,priority,enabled,emergency_disabled');
  const byKey = new Map(((actors ?? []) as any[]).map((a) => [a.actor_key, a]));
  const rows: any[] = [];
  for (const f of followUps) {
    const actorKey = FOLLOW_STAGE_ACTOR[f.stage];
    const a = actorKey ? byKey.get(actorKey) : null;
    if (!a || !a.enabled || a.emergency_disabled) continue;
    const sampling = parseSampling(settings.sampling);
    rows.push(socialJobRow({
      stage: f.stage, actorKey: actorKey!, language: (f.language as any) ?? 'multi', query: null, targetUrl: f.targetUrl,
      sourceId: f.sourceId, size: Math.min(Number(a.probe_size) || sampling.probe, sampling.probe),
      arm: f.stage.endsWith('COMMENTS') ? `${f.stage}` : `${f.stage}:${f.sourceId ?? f.targetUrl}`,
      priority: armPriority(null, null, Number(a.priority) + (f.stage.endsWith('COMMENTS') ? 10 : 0)), reason: f.reason,
    }, {
      matchingJobId: job.matching_job_id, propertyId: campaign.property_id, planId: job.search_plan_id ?? null,
      tranche: Math.min(2, Number(job.metadata?.tranche ?? 0) + 1), step: 0, parent: f.parent ? { parent: f.parent } : undefined,
    }));
  }
  return rows;
}

/** The arm's measured economics → deepen (next tranche) or stop. */
async function deepenRow(db: any, job: any, campaign: any, settings: FindBuyersSettings, groupsFound: number): Promise<{ row: Record<string, unknown> | null; decision: ReturnType<typeof decideArm> } | null> {
  const meta = job.metadata as Record<string, any>;
  const arm = String(meta.arm ?? '');
  if (!arm || String(meta.stage).endsWith('COMMENTS')) return null;
  const { data: runs } = await db.from('find_buyers_actor_runs')
    .select('status,requested_limit,results_billed,actual_micros,reserved_micros,useful_results,qualified_leads,strong_leads,items_fetched,actor_key,reason')
    .eq('matching_job_id', job.matching_job_id);
  const all = (runs ?? []) as any[];
  const mine = all.filter((r) => r.reason?.arm === arm);
  const stats: ArmStats = {
    arm,
    itemsBought: mine.filter((r) => r.status !== 'RELEASED').reduce((n, r) => n + Number(r.results_billed ?? r.requested_limit ?? 0), 0),
    spendMicros: mine.reduce((n, r) => n + Number(r.actual_micros ?? 0), 0),
    useful: mine.reduce((n, r) => n + Number(r.useful_results || 0), 0),
    qualified: mine.reduce((n, r) => n + Number(r.qualified_leads || 0), 0),
    strong: mine.reduce((n, r) => n + Number(r.strong_leads || 0), 0),
    duplicates: 0,
    failures: mine.filter((r) => ['FAILED', 'TIMED_OUT'].includes(r.status)).length,
    runs: mine.length,
    avgSimilarity: null, avgIntent: null,
  };
  /* Searches deepen on downstream yield too (groups found → their posts' leads). */
  if (String(meta.stage) === 'FB_GROUP_SEARCH') stats.useful = Math.max(stats.useful, groupsFound);
  const committed = all.reduce((n, r) => n + (['RESERVED', 'RUNNING'].includes(r.status) ? Number(r.reserved_micros) : r.status === 'RELEASED' ? 0 : Number(r.actual_micros ?? r.reserved_micros)), 0);
  const remaining = Number(campaign.provider_budget_micros) - committed;
  const actor = await actorRow(db, String(meta.actorKey));
  const decision = decideArm(stats, parseSampling({ ...(settings.sampling as any ?? {}), probe: actor?.probe_size ?? undefined }), remaining, Number(actor?.price_per_1k_micros ?? 1_000_000));
  if (decision.action !== 'DEEPEN' || decision.reason === 'probe') return { row: null, decision };
  const step = Number(meta.step ?? 0) + 1;
  return {
    decision,
    row: socialJobRow({
      stage: meta.stage, actorKey: meta.actorKey, language: job.language ?? 'multi', query: meta.query ?? null, targetUrl: meta.targetUrl ?? null,
      sourceId: meta.sourceId ?? null, size: Math.min(decision.nextSize, Number(actor?.max_results ?? 100)), arm,
      priority: armPriority(stats, null, Number(actor?.priority ?? 50)), reason: `deepen:${decision.reason}`,
    }, { matchingJobId: job.matching_job_id, propertyId: campaign.property_id, planId: job.search_plan_id ?? null, tranche: Number(meta.tranche ?? 0) + 1, step }),
  };
}
