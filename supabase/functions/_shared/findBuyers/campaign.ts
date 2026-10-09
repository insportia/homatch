// FIND BUYERS / FIND TENANTS — the social part of one campaign run.
//
//   startSocialCampaign   economics row, Property DNA, six-language plan,
//                         registry reuse, first-tranche probe jobs
//   finishSocialCampaign  abort provider runs still open, book their cost,
//                         freeze stats — BEFORE settlement reads cost_events
//
// The matching job stays the lifecycle; the reservation stays the wallet;
// discovery_query_queue stays the queue (provider APIFY_MEMO23).

import { buildPropertyDna, type PropertyDna } from '../../../../src/research-core/findBuyers/propertyDna.ts';
import { buildQueryPlan, mergeModelQueries, QUERY_PLAN_VERSION, type QueryPlan } from '../../../../src/research-core/findBuyers/queryPlanner.ts';
import { initialSocialJobs, type KnownSource, type PlannedSocialJob } from '../../../../src/research-core/findBuyers/campaignPlan.ts';
import { SEARCH_LANGUAGES } from '../../../../src/research-core/findBuyers/languages.ts';
import { abortRun, datasetItems, getRun, runCost, TERMINAL_RUN_STATES } from './memo23Client.ts';
import { openAiJson, parsePriceBook, recordAiCost } from './openai.ts';
import { paidTelegramChannels, parseTelegramPreference, type TelegramCommunity, type TelegramPreference } from '../../../../src/research-core/findBuyers/telegramPreference.ts';
import { providerDisabledByAdmin } from '../providerSwitch.ts';
import { phase1State, phase1TimeoutMinutes, phase2Category, phaseOfStage, planDiscoveryBudget, probeEstimateMicros, type Phase1State } from '../../../../src/research-core/findBuyers/campaignPhases.ts';

export interface FindBuyersSettings {
  /** find_buyers_social_enabled AND the Apify provider enabled on Admin → Providers. */
  socialEnabled: boolean;
  apifyEnabled: boolean;
  /** Owner switch: PAID_FIRST plans the memo23 Telegram Actor first, native as fallback. Default NATIVE_FIRST. */
  telegramPreference: TelegramPreference;
  minUsd: number;
  providerShareBps: number;
  pricingMaxAgeDays: number;
  commentGate: { skipBelow: number; eligibleFrom: number };
  sampling: unknown;
  priceBook: unknown;
}

const SETTING_KEYS = [
  'find_buyers_social_enabled', 'find_buyers_min_usd', 'find_buyers_provider_share_bps',
  'find_buyers_pricing_max_age_days', 'find_buyers_comment_gate', 'find_buyers_sampling', 'find_buyers_openai_price_book',
  'provider_disabled_list', 'find_buyers_telegram_preference',
];

/** Admin → Providers' per-provider switch (admin_settings.provider_disabled_list). APIFY in it stops every memo23 run. */
export function apifyDisabledByAdmin(list: unknown): boolean {
  return providerDisabledByAdmin(list, 'APIFY');
}

const val = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);

export async function loadFindBuyersSettings(db: any): Promise<FindBuyersSettings> {
  const { data } = await db.from('admin_settings').select('key,value').in('key', SETTING_KEYS);
  const m = new Map(((data ?? []) as any[]).map((r) => [r.key, val(r.value)]));
  const gate = (m.get('find_buyers_comment_gate') ?? {}) as any;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    /* Server-authoritative: the Apify provider switched off on Admin → Providers stops every memo23 run. */
    apifyEnabled: !apifyDisabledByAdmin(m.get('provider_disabled_list')),
    telegramPreference: parseTelegramPreference(m.get('find_buyers_telegram_preference')),
    socialEnabled: m.get('find_buyers_social_enabled') === true && !apifyDisabledByAdmin(m.get('provider_disabled_list')),
    minUsd: Math.max(1, num(m.get('find_buyers_min_usd'), 10)),
    providerShareBps: Math.max(0, Math.min(9000, num(m.get('find_buyers_provider_share_bps'), 5000))),
    pricingMaxAgeDays: num(m.get('find_buyers_pricing_max_age_days'), 30),
    commentGate: { skipBelow: num(gate.skipBelow, 55), eligibleFrom: num(gate.eligibleFrom, 75) },
    sampling: m.get('find_buyers_sampling') ?? null,
    priceBook: m.get('find_buyers_openai_price_book') ?? null,
  };
}

/** The $10 minimum, in the wallet's own credits (credits_per_usd is admin-set). */
export function minimumCredits(minUsd: number, creditsPerUsd: number): number {
  return Math.ceil(minUsd * creditsPerUsd);
}

/** customer value and the provider ceiling, integer microdollars. */
export function campaignEconomics(credits: number, creditsPerUsd: number, providerShareBps: number) {
  const customerValueMicros = Math.floor((credits * 1_000_000) / creditsPerUsd);
  const providerBudgetMicros = Math.floor((customerValueMicros * providerShareBps) / 10_000);
  return { customerValueMicros, providerBudgetMicros };
}

export async function creditsPerUsd(db: any): Promise<number> {
  const { data } = await db.from('admin_settings').select('value').eq('key', 'credits_per_usd').maybeSingle();
  const n = Number(val(data?.value));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

const MODEL_QUERY_SCHEMA = {
  name: 'find_buyers_queries',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['queries'],
    properties: {
      queries: {
        type: 'array', maxItems: 12,
        items: {
          type: 'object', additionalProperties: false, required: ['language', 'query'],
          properties: { language: { type: 'string', enum: [...SEARCH_LANGUAGES] }, query: { type: 'string', maxLength: 100 } },
        },
      },
    },
  },
} as const;

/** Cached per DNA key: the same flat is never planned (or paid for) twice. */
async function planQueries(db: any, dna: PropertyDna, matchingJobId: string, priceBookRaw: unknown): Promise<QueryPlan> {
  const base = buildQueryPlan(dna);
  const { data: cached } = await db.from('find_buyers_query_cache')
    .select('queries').eq('dna_key', dna.dnaKey).eq('plan_version', QUERY_PLAN_VERSION).maybeSingle();
  if (cached?.queries) return mergeModelQueries(base, cached.queries as any[]);
  const book = parsePriceBook(priceBookRaw);
  const ask = {
    transaction: dna.transaction, propertyType: dna.propertyType, city: dna.city, district: dna.district,
    bedrooms: dna.bedrooms, areaSqm: dna.areaSqm, price: dna.price, currency: dna.currency,
    existing: base.queries.filter((q) => q.kind === 'demand').map((q) => `${q.language}: ${q.query}`),
  };
  const res = await openAiJson<{ queries: Array<{ language: string; query: string }> }>(book,
    'You write short social-media search phrases that real people in Georgia use when they WANT to buy or rent a property like this one. Two natural phrases per language (ka, ru, en, ar, he, tr), different from the existing ones, native wording, include the city or district name as people write it. No hashtags, no quotes.',
    ask, MODEL_QUERY_SCHEMA, { maxTokens: 700 });
  await recordAiCost(db, { key: `ai:queries:${matchingJobId}`, matchingJobId, kind: 'AI', operation: 'QUERY_PLAN', result: res, metadata: { dnaKey: dna.dnaKey } })
    .catch(() => undefined);
  const proposed = res.data?.queries ?? [];
  /* Best-effort cache: never blocks the plan. A PostgREST builder is only
     thenable (no .catch), so it is awaited inside try. The old
     `.upsert(...).catch(...)` threw a TypeError here on every uncached search
     (2026-10-04, jobs 7517daa6 / 123bd287): planning stopped before any
     memo23 job was queued, so only native Telegram ever ran. */
  try {
    const { error } = await db.from('find_buyers_query_cache').upsert({
      dna_key: dna.dnaKey, plan_version: QUERY_PLAN_VERSION, queries: proposed, model: res.model, cost_micros: res.costMicros,
    }, { onConflict: 'dna_key,plan_version' });
    if (error) console.warn('find_buyers_query_cache upsert failed', error.message ?? error);
  } catch (error) {
    console.warn('find_buyers_query_cache upsert threw', error instanceof Error ? error.message : String(error));
  }
  return mergeModelQueries(base, proposed);
}

async function knownSources(db: any, city: string | null): Promise<KnownSource[]> {
  let q = db.from('source_registry')
    .select('id,platform,url,languages,language,city,fb_spend_micros,fb_qualified_leads,last_checked_at,last_successful_at,access_state,lifecycle')
    .in('platform', ['FACEBOOK', 'INSTAGRAM', 'VK', 'TELEGRAM', 'LINKEDIN', 'X', 'THREADS', 'YOUTUBE'])
    .not('url', 'is', null)
    .neq('access_state', 'INACCESSIBLE')
    .not('lifecycle', 'in', '(BLOCKED,RETIRED)')
    .limit(200);
  if (city) q = q.or(`city.is.null,city.ilike.${city}`);
  const { data } = await q;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, platform: r.platform, url: r.url,
    languages: Array.isArray(r.languages) && r.languages.length ? r.languages : r.language ? [r.language] : [],
    city: r.city ?? null,
    historicalYield: Number(r.fb_spend_micros) > 0 ? Number(r.fb_qualified_leads) / (Number(r.fb_spend_micros) / 1e6) : null,
    lastCheckedAt: r.last_checked_at ?? null,
    lastSuccessfulAt: r.last_successful_at ?? null,
  }));
}

export function socialJobRow(job: PlannedSocialJob, ctx: { matchingJobId: string; propertyId: string; planId: string | null; tranche: number; step: number; parent?: Record<string, unknown> }) {
  const raw = [ctx.matchingJobId, 'M23', job.stage, job.language, job.targetUrl ?? job.query ?? '', ctx.step].join(':');
  const key = raw.length > 400 ? `${raw.slice(0, 360)}:${hashKey(raw)}` : raw;
  return {
    property_id: ctx.propertyId,
    matching_job_id: ctx.matchingJobId,
    search_plan_id: ctx.planId,
    search_direction: 'DEMAND',
    tranche: Math.min(2, ctx.tranche),
    executor: 'EDGE',
    dedupe_key: key,
    status: 'PENDING',
    platform: job.stage.startsWith('FB') ? 'FACEBOOK' : job.stage.startsWith('IG') ? 'INSTAGRAM'
      : job.stage.startsWith('VK') ? 'VK' : job.stage.startsWith('TELEGRAM') ? 'TELEGRAM' : 'OTHER',
    language: job.language === 'multi' ? 'multi' : job.language,
    provider: 'APIFY_MEMO23',
    /* The run-scoped key, as the native jobs do: the legacy unique index on
       (property_id, platform, language, query) must not merge two runs. The
       readable query lives in metadata. */
    query: key,
    query_kind: job.stage,
    priority: job.priority,
    metadata: {
      stage: job.stage, actorKey: job.actorKey, arm: job.arm, size: job.size, query: job.query, targetUrl: job.targetUrl,
      sourceId: job.sourceId, reason: job.reason, step: ctx.step, tranche: ctx.tranche, ...(ctx.parent ?? {}),
    },
    /* The provider estimate is decided at reservation time against the live
       registry price; the queue row carries no guess. */
    estimated_cost_usd: 0,
  };
}

/** dedupe_key is a partial unique index: insert, and a duplicate (23505) is a replay. */
export async function insertQueueRows(db: any, rows: Array<Record<string, unknown>>): Promise<number> {
  let n = 0;
  for (const row of rows) {
    const { error } = await db.from('discovery_query_queue').insert(row);
    if (!error) n++;
    else if (String(error.code) !== '23505') throw error;
  }
  return n;
}

function hashKey(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

export async function enabledActorMap(db: any, maxAgeDays: number) {
  const { data } = await db.from('find_buyers_actor_registry')
    .select('actor_key,probe_size,priority,enabled,emergency_disabled,health,pricing_verified_at,pricing_model,price_per_1k_micros,start_fee_micros');
  const out: Record<string, { probeSize: number; priority: number; startFeeMicros: number; pricePer1kMicros: number }> = {};
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  for (const a of (data ?? []) as any[]) {
    if (!a.enabled || a.emergency_disabled || a.health === 'DISABLED') continue;
    if (!a.pricing_verified_at || Date.parse(a.pricing_verified_at) < cutoff || a.pricing_model === 'UNKNOWN' || a.price_per_1k_micros == null) continue;
    out[a.actor_key] = { probeSize: Number(a.probe_size) || 20, priority: Number(a.priority) || 50,
      startFeeMicros: Number(a.start_fee_micros ?? 0), pricePer1kMicros: Number(a.price_per_1k_micros) };
  }
  return out;
}

export interface StartSocialInput {
  matchingJobId: string;
  campaignId: string | null;
  propertyId: string;
  userId: string;
  credits: number;
  property: Record<string, any>;
  facts: Record<string, any> | null;
  planId: string | null;
  nativeTelegramActive: boolean;
  /** The owner's explicit language choice at launch; null = all six. */
  targetLanguages?: string[] | null;
  /** The campaign window (minutes): Phase 1 gets a bounded share of it. */
  campaignWindowMinutes?: number;
  /** The native Telegram community search is part of this campaign's Phase 1. */
  telegramDiscoveryPlanned?: boolean;
}

export async function startSocialCampaign(db: any, input: StartSocialInput, settings: FindBuyersSettings) {
  const rate = await creditsPerUsd(db);
  const econ = campaignEconomics(input.credits, rate, settings.providerShareBps);
  const f = input.facts ?? {};
  const dna = buildPropertyDna({
    transactionType: input.property.transaction_type, propertyType: input.property.property_type,
    countryCode: f.country_code, city: f.city, district: f.district, neighborhood: f.neighborhood,
    latitude: f.latitude, longitude: f.longitude, totalPrice: f.total_price, currency: f.currency, area: f.area,
    rooms: f.rooms, bedrooms: f.bedrooms, floor: f.floor, totalFloors: f.total_floors, condition: f.condition,
    buildingType: f.building_type, newBuild: f.new_build, parking: f.parking, balcony: f.balcony, terrace: f.terrace,
    elevator: f.elevator, furnished: f.furnished, view: f.view,
  });

  const { error } = await db.from('find_buyers_campaigns').upsert({
    matching_job_id: input.matchingJobId, campaign_id: input.campaignId, property_id: input.propertyId,
    user_id: input.userId, transaction: dna.transaction, credits_committed: input.credits, credits_per_usd: rate,
    customer_value_micros: econ.customerValueMicros, provider_budget_micros: econ.providerBudgetMicros,
    languages: input.targetLanguages?.length ? SEARCH_LANGUAGES.filter((l) => input.targetLanguages!.includes(l)) : [...SEARCH_LANGUAGES], dna,
  }, { onConflict: 'matching_job_id', ignoreDuplicates: true });
  if (error) throw error;

  if (!settings.socialEnabled) return { queued: 0, dna, reason: 'SOCIAL_DISABLED', economics: econ };
  const actors = await enabledActorMap(db, settings.pricingMaxAgeDays);
  if (!Object.keys(actors).length) return { queued: 0, dna, reason: 'NO_ACTOR_READY', economics: econ };

  const plan = await planQueries(db, dna, input.matchingJobId, settings.priceBook);
  await db.from('find_buyers_campaigns').update({ query_plan: plan }).eq('matching_job_id', input.matchingJobId);
  const sources = await knownSources(db, dna.city);
  const jobs = initialSocialJobs({ dna, plan, knownSources: sources, enabledActors: actors, nativeTelegramActive: input.nativeTelegramActive, telegramPreference: settings.telegramPreference, targetLanguages: input.targetLanguages ?? null });
  if (!jobs.length) return { queued: 0, dna, reason: 'NO_JOBS', economics: econ };
  /* TWO PHASES (campaignPhases.ts): Phase 1's time box and its spend ceiling,
     planned from this campaign's own probes and the registry's prices. */
  const estimate = (j: { actorKey: string; size: number }) => probeEstimateMicros(actors[j.actorKey] ?? {}, j.size);
  const budget = planDiscoveryBudget({
    providerBudgetMicros: econ.providerBudgetMicros,
    discoveryEstimatesMicros: jobs.filter((j) => phaseOfStage(j.stage) === 'PHASE1_DISCOVERY').map(estimate),
    extractionEstimatesMicros: jobs.filter((j) => phaseOfStage(j.stage) === 'PHASE2_EXTRACTION').map(estimate),
  });
  const timeoutMinutes = phase1TimeoutMinutes(input.campaignWindowMinutes ?? 30);
  const phases = {
    phase1TimeoutMinutes: timeoutMinutes,
    phase1DeadlineAt: new Date(Date.now() + timeoutMinutes * 60_000).toISOString(),
    expectedProviders: input.telegramDiscoveryPlanned ? ['TELEGRAM_SOURCES'] : [],
    budget,
    planned: {
      phase1: jobs.filter((j) => phaseOfStage(j.stage) === 'PHASE1_DISCOVERY').length,
      phase2SourceDependent: jobs.filter((j) => phaseOfStage(j.stage) === 'PHASE2_EXTRACTION' && phase2Category(j.stage) === 'SOURCE_DEPENDENT').length,
      phase2IndependentSearch: jobs.filter((j) => phaseOfStage(j.stage) === 'PHASE2_EXTRACTION' && phase2Category(j.stage) === 'INDEPENDENT_SEARCH').length,
    },
  };
  await db.from('find_buyers_campaigns').update({ query_plan: { ...plan, phases } }).eq('matching_job_id', input.matchingJobId);
  const rows = jobs.map((j) => socialJobRow(j, { matchingJobId: input.matchingJobId, propertyId: input.propertyId, planId: input.planId, tranche: 0, step: 0 }));
  const queued = await insertQueueRows(db, rows);
  return {
    queued, dna, reason: null, economics: econ,
    reusedSources: jobs.filter((j) => j.reason === 'known_source_reuse').length,
    /* Paid Telegram jobs queued: when > 0 under PAID_FIRST, the free reader is skipped (fallback). */
    paidTelegramQueued: jobs.filter((j) => j.stage === 'TELEGRAM_CHANNEL').length,
    languages: [...new Set(jobs.map((j) => j.language))],
    phases,
  };
}

/**
 * Before settlement: abort provider runs still open for this job and book
 * what they cost; release reservations of runs that never started. Safe to
 * call repeatedly (booking is idempotent in SQL).
 */
export async function finishSocialCampaign(db: any, matchingJobId: string, reason: string) {
  const { data: camp } = await db.from('find_buyers_campaigns').select('matching_job_id,finalized_at').eq('matching_job_id', matchingJobId).maybeSingle();
  if (!camp) return { social: false };
  const closed = await closeOpenRuns(db, matchingJobId, reason);
  const stats = await campaignStats(db, matchingJobId);
  await db.from('find_buyers_campaigns').update({
    stats, stop_reason: reason, finalized_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
  }).eq('matching_job_id', matchingJobId).is('finalized_at', null);
  return { social: true, ...closed, leads: stats.qualified };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Close every unbooked run of one campaign: release, abort + book, never $0 for a run that may exist. */
export async function closeOpenRuns(db: any, matchingJobId: string, reason: string) {
  const { data: open } = await db.from('find_buyers_actor_runs')
    .select('id,provider_run_id,dataset_id,status,actor_key,requested_limit')
    .eq('matching_job_id', matchingJobId).in('status', ['RESERVED', 'STARTING', 'RUNNING']).is('cost_booked_at', null);
  let aborted = 0; let released = 0;
  for (const run of (open ?? []) as any[]) {
    const res = await closeRun(db, run, reason);
    if (res === 'RELEASED') released++; else aborted++;
  }
  return { aborted, released };
}

export async function closeRun(db: any, run: any, reason: string): Promise<'RELEASED' | 'BOOKED'> {
  if (!run.provider_run_id && run.status === 'RESERVED') {
    const { data } = await db.rpc('find_buyers_book_run_cost', {
      p_run_id: run.id, p_status: 'RELEASED', p_actual_micros: 0, p_cost_basis: 'NOT_STARTED',
      p_results_billed: 0, p_items_fetched: 0, p_error: `NOT_STARTED: ${reason}`, p_billing: {},
    });
    if (data?.booked) return 'RELEASED';
    /* Refused: it moved to STARTING meanwhile — fall through to UNKNOWN. */
  }
  if (!run.provider_run_id) {
    /* Being created (or creation was interrupted): the id is not known. Book
       UNKNOWN cost at the reservation (never zero); the executor aborts the
       run it gets back. */
    await db.rpc('find_buyers_book_run_cost', {
      p_run_id: run.id, p_status: 'ABORTED', p_actual_micros: null, p_cost_basis: 'UNKNOWN',
      p_results_billed: null, p_items_fetched: 0, p_error: `ENDED_DURING_START: ${reason}`, p_billing: {},
    });
    return 'BOOKED';
  }
  let r: any = null;
  try {
    r = await getRun(run.provider_run_id);
    if (r && !TERMINAL_RUN_STATES.has(String(r.status))) {
      await abortRun(run.provider_run_id);
      /* Events charged during the abort count: wait briefly for a terminal state. */
      for (let i = 0; i < 4 && r && !TERMINAL_RUN_STATES.has(String(r.status)); i++) {
        await sleep(1500);
        r = await getRun(run.provider_run_id).catch(() => r);
      }
    }
  } catch { /* cost stays unknown: booked as UNKNOWN below, never as 0 */ }
  let billed: number | null = null;
  const datasetId = run.dataset_id ?? r?.defaultDatasetId ?? null;
  if (datasetId) {
    try { const d = await datasetItems(datasetId, 1); billed = d.total; } catch { billed = null; }
  }
  const cost = r ? runCost(r, billed) : { micros: null, basis: 'UNKNOWN' as const, billing: {} };
  const st = String(r?.status ?? '');
  const status = st === 'SUCCEEDED' ? 'SUCCEEDED' : st === 'TIMED-OUT' ? 'TIMED_OUT' : st === 'FAILED' ? 'FAILED' : 'ABORTED';
  await db.rpc('find_buyers_book_run_cost', {
    p_run_id: run.id, p_status: status, p_actual_micros: cost.micros, p_cost_basis: cost.basis, p_results_billed: billed,
    p_items_fetched: 0, p_error: `CAMPAIGN_ENDING: ${reason}`, p_billing: cost.billing,
  });
  return 'BOOKED';
}

/**
 * Safety net for runs no one is watching any more (an executor that died, a
 * campaign finished elsewhere): unbooked runs older than 2 hours, or of a
 * finalized campaign, are closed and booked. Bounded per tick.
 */
export async function sweepStaleActorRuns(db: any) {
  const cutoff = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const { data } = await db.from('find_buyers_actor_runs')
    .select('id,provider_run_id,dataset_id,status,actor_key,requested_limit,matching_job_id,created_at,campaign:find_buyers_campaigns(finalized_at)')
    .in('status', ['RESERVED', 'STARTING', 'RUNNING']).is('cost_booked_at', null).limit(20);
  let closed = 0;
  for (const run of (data ?? []) as any[]) {
    const camp = Array.isArray(run.campaign) ? run.campaign[0] : run.campaign;
    if (!(camp?.finalized_at || run.created_at < cutoff)) continue;
    await closeRun(db, run, 'STALE_SWEEP').catch(() => undefined);
    closed++;
    if (closed >= 5) break;
  }
  return { closed };
}

/** Customer-safe counters (no actor ids, no costs). */
export async function campaignStats(db: any, matchingJobId: string) {
  const [runs, leads, assess, queue] = await Promise.all([
    db.from('find_buyers_actor_runs').select('source,language,status,qualified_leads,items_fetched,useful_results,stale_dropped').eq('matching_job_id', matchingJobId),
    db.from('find_buyers_leads').select('strength,source,signal_count').eq('matching_job_id', matchingJobId),
    db.from('find_buyers_assessments').select('content_kind').eq('matching_job_id', matchingJobId).limit(5000),
    db.from('discovery_query_queue').select('provider,status,metadata').eq('matching_job_id', matchingJobId),
  ]);
  const r = (runs.data ?? []) as any[];
  const l = (leads.data ?? []) as any[];
  const q = (queue.data ?? []) as any[];
  const sources = new Set<string>(r.map((x) => x.source));
  if (q.some((x) => x.provider === 'TELEGRAM' && x.status === 'DONE')) sources.add('TELEGRAM');
  if (q.some((x) => x.provider === 'FORUM' && x.status === 'DONE')) sources.add('FORUM');
  const productive = new Set<string>(l.map((x) => x.source));
  return {
    languagesSearched: [...new Set(r.map((x) => x.language).filter((x: string | null) => x && x !== 'multi'))],
    sourcesExplored: [...sources],
    sourcesProductive: [...productive],
    signalsAnalyzed: ((assess.data ?? []) as any[]).length,
    commentsReviewed: ((assess.data ?? []) as any[]).filter((x) => x.content_kind === 'COMMENT').length,
    qualified: l.length,
    strong: l.filter((x) => x.strength === 'STRONG').length,
    duplicatesRemoved: l.reduce((n, x) => n + Math.max(0, Number(x.signal_count || 1) - 1), 0),
    /* 30-day rule, made visible: older or undated items skipped, never stored. */
    staleSkipped: r.reduce((n, x) => n + Number(x.stale_dropped || 0), 0),
    degradedSources: [...new Set(r.filter((x) => ['FAILED', 'TIMED_OUT'].includes(x.status)).map((x) => x.source))],
  };
}

/**
 * Native Telegram could not collect for this campaign: let the memo23
 * Telegram Actor read the known public channels instead — only when that
 * Actor is enabled and priced, and only once per campaign (dedupe keys).
 */
export async function queueTelegramFallback(db: any, matchingJobId: string) {
  const settings = await loadFindBuyersSettings(db);
  if (!settings.socialEnabled) return 0;
  const actors = await enabledActorMap(db, settings.pricingMaxAgeDays);
  if (!actors.TELEGRAM_CHANNEL) return 0;
  const { data: camp } = await db.from('find_buyers_campaigns').select('property_id,dna,finalized_at').eq('matching_job_id', matchingJobId).maybeSingle();
  if (!camp || camp.finalized_at) return 0;
  const already = await queuedTelegramTargets(db, matchingJobId);
  const sources = (await knownSources(db, (camp.dna as PropertyDna)?.city ?? null))
    .filter((s) => s.platform === 'TELEGRAM' && !already.has(String(s.url).toLowerCase()));
  const jobs: PlannedSocialJob[] = sources.slice(0, 3).map((s) => ({
    stage: 'TELEGRAM_CHANNEL', actorKey: 'TELEGRAM_CHANNEL', language: (s.languages[0] as any) ?? 'multi', query: null,
    targetUrl: s.url, sourceId: s.id, size: actors.TELEGRAM_CHANNEL.probeSize, arm: `TELEGRAM_CHANNEL:${s.id}`,
    priority: actors.TELEGRAM_CHANNEL.priority, reason: 'native_telegram_unavailable',
  }));
  return insertQueueRows(db, jobs.map((j) => socialJobRow(j, { matchingJobId, propertyId: camp.property_id, planId: null, tranche: 1, step: 0 })));
}

/** Channels a campaign already has a paid Telegram job for (any reason): never queued twice. */
async function queuedTelegramTargets(db: any, matchingJobId: string): Promise<Set<string>> {
  const { data } = await db.from('discovery_query_queue').select('metadata')
    .eq('matching_job_id', matchingJobId).eq('provider', 'APIFY_MEMO23');
  return new Set(((data ?? []) as any[]).filter((r) => r.metadata?.stage === 'TELEGRAM_CHANNEL')
    .map((r) => String(r.metadata?.targetUrl ?? '').toLowerCase()).filter(Boolean));
}

/* Paid channel reads one COMBINED search may add (each still reserved against the caps). */
const COMBINED_PAID_CHANNELS = 8;

/**
 * COMBINED Telegram (telegramPreference.ts), run when the campaign's Phase 1
 * Telegram search has finished: the memo23 Telegram Actor is queued for the
 * channels the free reader does not cover — including the ones Phase 1 just
 * found — for this campaign's city. Phase 2 jobs; the shared community
 * registry is the one both paths read from. Returns the number queued.
 */
export async function queueCombinedTelegram(db: any, matchingJobId: string): Promise<number> {
  const settings = await loadFindBuyersSettings(db);
  if (settings.telegramPreference !== 'COMBINED' || !settings.socialEnabled || !settings.apifyEnabled) return 0;
  const actors = await enabledActorMap(db, settings.pricingMaxAgeDays);
  if (!actors.TELEGRAM_CHANNEL) return 0;
  const { data: camp } = await db.from('find_buyers_campaigns').select('property_id,dna,finalized_at,languages').eq('matching_job_id', matchingJobId).maybeSingle();
  if (!camp || camp.finalized_at) return 0;
  const { data: rows } = await db.from('community_targets')
    .select('id,external_id,name,lifecycle,readability,discovery_enabled,last_error_code,relevance_score,source_registry_id,languages,metadata')
    .eq('platform', 'TELEGRAM').limit(500);
  const chosen = paidTelegramChannels((rows ?? []) as TelegramCommunity[], (camp.dna as PropertyDna)?.city ?? null, COMBINED_PAID_CHANNELS);
  const already = await queuedTelegramTargets(db, matchingJobId);
  /* The owner's language choice: a channel in another language is not read (unknown language stays). */
  const langs = new Set(((camp.languages ?? []) as string[]).map((l) => l.toLowerCase()));
  const jobs: PlannedSocialJob[] = chosen
    .filter((c) => !already.has(`https://t.me/${c.external_id}`.toLowerCase()))
    .filter((c) => !c.languages?.length || !langs.size || c.languages.some((l) => langs.has(l.toLowerCase())))
    .map((c) => ({
      stage: 'TELEGRAM_CHANNEL', actorKey: 'TELEGRAM_CHANNEL', language: 'multi', query: null,
      targetUrl: `https://t.me/${c.external_id}`, sourceId: c.source_registry_id ?? null, size: actors.TELEGRAM_CHANNEL.probeSize,
      arm: `TELEGRAM_CHANNEL:${c.external_id}`, priority: actors.TELEGRAM_CHANNEL.priority, reason: 'combined_not_covered_by_free_reader',
    }));
  if (!jobs.length) return 0;
  return insertQueueRows(db, jobs.map((j) => socialJobRow(j, { matchingJobId, propertyId: camp.property_id, planId: null, tranche: 1, step: 0 })));
}

/* ── TWO PHASES: the gate and the discovery spend, read from the database (decisions: campaignPhases.ts).
   Used by the memo23 executor (paid runs) and the queue driver (the native Telegram read). ── */

/** Phase 1 jobs of one campaign run, with the deadline stored at planning time. */
export async function loadPhase1(db: any, matchingJobId: string, phases?: { phase1DeadlineAt?: string | null; expectedProviders?: string[] } | null): Promise<{ state: Phase1State; open: number; finished: number; deadlineAt: string | null }> {
  let deadlineAt = phases?.phase1DeadlineAt ?? null;
  let expected: string[] = Array.isArray(phases?.expectedProviders) ? phases!.expectedProviders! : [];
  if (phases === undefined) {
    const { data: camp } = await db.from('find_buyers_campaigns').select('query_plan').eq('matching_job_id', matchingJobId).maybeSingle();
    deadlineAt = camp?.query_plan?.phases?.phase1DeadlineAt ?? null;
    expected = Array.isArray(camp?.query_plan?.phases?.expectedProviders) ? camp.query_plan.phases.expectedProviders : [];
  }
  const { data: rows, error } = await db.from('discovery_query_queue')
    .select('provider,status,metadata')
    .eq('matching_job_id', matchingJobId)
    .in('provider', ['TELEGRAM_SOURCES', 'APIFY_MEMO23']);
  /* A failed read never holds Phase 2 back: the gate opens rather than stalls. */
  if (error) return { state: 'NONE', open: 0, finished: 0, deadlineAt };
  const jobs = ((rows ?? []) as any[]).map((r) => ({ provider: r.provider, stage: r.metadata?.stage ?? null, status: r.status }));
  /* No stored deadline (a campaign planned before phases existed): no gate. */
  const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : 0;
  return { ...phase1State(jobs, Date.now(), Number.isFinite(deadlineMs) ? deadlineMs : 0, deadlineAt ? expected : []), deadlineAt };
}

/** What this campaign's discovery-stage runs have committed (held + booked), like the reservation counts it. */
export async function discoveryCommittedMicros(db: any, matchingJobId: string, stages: readonly string[]): Promise<number> {
  const { data } = await db.from('find_buyers_actor_runs')
    .select('status,reserved_micros,actual_micros')
    .eq('matching_job_id', matchingJobId)
    .in('operation', [...stages]);
  return ((data ?? []) as any[]).reduce((sum, r) => {
    if (['RESERVED', 'STARTING', 'RUNNING'].includes(r.status)) return sum + Number(r.reserved_micros ?? 0);
    if (r.status === 'RELEASED') return sum;
    return sum + Number(r.actual_micros ?? r.reserved_micros ?? 0);
  }, 0);
}
