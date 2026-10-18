// FIND PROPERTY — the paid social OFFER campaign, executed.
//
// One discovery_run (a buyer's or tenant's paid campaign) → a few BATCHED memo23
// Actor runs (owner, 2026-10-18): every Facebook group of the city in one group run
// per keyword, Telegram channels and Instagram profiles in large batches, TikTok
// searching every keyword at once (owner scope 2026-10-16; memo23 only through
// findBuyers/memo23Client.ts) → the
// posts that OFFER a property of the searched kind become supply_observations →
// supply-matching delivers them to the search like any other external listing.
//
// Money never moves without a reservation: every Actor run is reserved in SQL
// against the campaign's 63% provider budget (find_property_reserve_actor_run,
// which also enforces find_property_social_enabled and the APIFY switch) and is
// capped at Apify by maxTotalChargeUsd = that reservation. Its cost is booked
// once (find_property_book_actor_cost); an unknown cost counts at its reservation.
// finishOfferCampaign aborts and books whatever is still open before settlement.
//
// The customer pays only for CONFIRMED provider work (owner, 2026-10-17): no
// campaign is offered without a provider token (loadOfferSettings.configured), and
// a run whose start is ambiguous (5xx / network error, or the campaign ended
// mid-start) is booked START_AMBIGUOUS — HOMATCH cost of goods at its reservation,
// never part of the customer's charge (find_property_customer_micros).

import { buildInput, essentialMissing, fitToSchema, STAGE_OUTPUT, type InputContract, type Stage } from '../../../../src/research-core/findBuyers/actorInputs.ts';
import { communityKey } from '../../../../src/research-core/findBuyers/batching.ts';
import { normalizeDataset } from '../../../../src/research-core/findBuyers/normalize.ts';
import {
  OFFER_STAGE_NETWORK, planOfferJobs, qualifyOffer, telegramPostUrl, followUpDecision, type KnownOfferSource, type OfferActor, type OfferNetwork,
  type OfferPlan, type OfferSearch, type OfferStage, type OfferTarget, OFFER_NETWORKS,
} from '../../../../src/research-core/findProperty/offerCampaign.ts';
import { COMMUNITY_LISTING_PARSER_VERSION } from '../../../../src/research-core/discovery/community-listing.ts';
import { abortRun, datasetItems, getRun, Memo23Error, providerConfigured, runCost, scrub, startRun, TERMINAL_RUN_STATES } from '../findBuyers/memo23Client.ts';
import { offerImages, SOCIAL_ADAPTER_VERSION } from '../../../../src/research-core/marketplace/socialListings.ts';
import { providerDisabledByAdmin } from '../providerSwitch.ts';
import { listingFingerprint } from '../communitySupply.ts';
import { judgeOffer, type CampaignCriteria } from '../../../../src/research-core/findProperty/campaignMatch.ts';
import { resolvePlace } from '../../../../src/research-core/normalize/place.ts';

export interface OfferOutcome {
  outcome: 'DONE' | 'WAIT' | 'RETRY' | 'FAILED' | 'CANCELLED' | 'BUDGET_REACHED';
  resultCount: number;
  error: string | null;
  retrySeconds: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
}
const out = (o: Partial<OfferOutcome> & { outcome: OfferOutcome['outcome'] }): OfferOutcome =>
  ({ resultCount: 0, error: null, retrySeconds: null, costUsd: null, metadata: {}, ...o });

const POLL_SECONDS = 10;
/** Each network's holder row for posts no known community can claim (migrations 20261107095700, 20261114090000). */
const FALLBACK_SOURCE: Record<string, [string, string]> = {
  FACEBOOK: ['FACEBOOK', 'homatch:fp-fb-post-search'], TIKTOK: ['TIKTOK', 'homatch:fp-tiktok-search'],
  TELEGRAM: ['TELEGRAM', 'homatch:fp-telegram-offers'], INSTAGRAM: ['INSTAGRAM', 'homatch:fp-instagram-offers'],
};
/** Stored offers read to rank communities (enough to tell proven ones apart; not a census). */
const OFFER_EVIDENCE_SAMPLE = 20_000;
const OFFER_EVIDENCE_DAYS = 180;
/** A provider run is aborted after its own timeout plus this much slack. */
const POLL_SLACK_MS = 5 * 60_000;
const val = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);

export interface OfferSettings { enabled: boolean; apifyEnabled: boolean; configured: boolean; networks: OfferNetwork[]; pricingMaxAgeDays: number }

export async function loadOfferSettings(db: any): Promise<OfferSettings> {
  const { data } = await db.from('admin_settings').select('key,value')
    .in('key', ['find_property_social_enabled', 'find_property_social_networks', 'provider_disabled_list', 'find_buyers_pricing_max_age_days']);
  const m = new Map(((data ?? []) as any[]).map((r) => [r.key, val(r.value)]));
  const apifyEnabled = !providerDisabledByAdmin(m.get('provider_disabled_list'), 'APIFY');
  const networks = Array.isArray(m.get('find_property_social_networks'))
    ? (m.get('find_property_social_networks') as string[]).filter((n): n is OfferNetwork => (OFFER_NETWORKS as readonly string[]).includes(n))
    : [...OFFER_NETWORKS];
  /* No token, no campaign: nothing is offered, reserved or charged (a missing token must never look like a run). */
  const configured = providerConfigured();
  return {
    enabled: m.get('find_property_social_enabled') === true && apifyEnabled && configured,
    apifyEnabled, configured, networks,
    pricingMaxAgeDays: Number.isFinite(Number(m.get('find_buyers_pricing_max_age_days'))) ? Number(m.get('find_buyers_pricing_max_age_days')) : 30,
  };
}

/** Actors as the planner sees them: ready = enabled, not quarantined, pricing verified and fresh. */
export async function loadOfferActors(db: any, maxAgeDays: number): Promise<Record<string, OfferActor>> {
  const { data, error } = await db.from('find_buyers_actor_registry')
    .select('actor_key,enabled,emergency_disabled,health,pricing_model,pricing_verified_at,price_per_1k_micros,start_fee_micros,probe_size,max_results,input_contract,output_contract_verified_at')
    .in('actor_key', ['FB_POST_SEARCH', 'FB_GROUP_POSTS', 'FB_PAGE_POSTS', 'IG_PROFILE_POSTS', 'TELEGRAM_CHANNEL', 'TIKTOK', 'VK_POSTS_COMMENTS']);
  if (error) throw error;
  const fresh = (at: string | null) => Boolean(at) && Date.now() - Date.parse(String(at)) <= maxAgeDays * 86_400_000;
  const outMap: Record<string, OfferActor> = {};
  for (const a of (data ?? []) as any[]) {
    outMap[a.actor_key] = {
      actorKey: a.actor_key,
      ready: a.enabled === true && a.emergency_disabled !== true && a.health !== 'DISABLED' && a.pricing_model !== 'UNKNOWN'
        && a.price_per_1k_micros != null && fresh(a.pricing_verified_at),
      startFeeMicros: Number(a.start_fee_micros ?? 0), pricePer1kMicros: Number(a.price_per_1k_micros ?? 0),
      probeSize: Math.max(1, Number(a.probe_size ?? 20)),
      maxResults: a.max_results != null ? Math.max(1, Number(a.max_results)) : undefined,
      verifiedFields: verifiedFields(a.input_contract),
      outputVerified: a.output_contract_verified_at != null,
    };
  }
  return outMap;
}

const SOURCE_NETWORK: Record<string, OfferNetwork> = {
  FACEBOOK_GROUP: 'FACEBOOK', TELEGRAM_GROUP: 'TELEGRAM', INSTAGRAM_PROFILE: 'INSTAGRAM', VK_COMMUNITY: 'VK', SOCIAL_PROFILE: 'FACEBOOK',
};
const PLATFORM_NETWORK: Record<string, OfferNetwork> = { FACEBOOK: 'FACEBOOK', INSTAGRAM: 'INSTAGRAM', TELEGRAM: 'TELEGRAM', VK: 'VK' };

/** A registry row as an offer source. A SOCIAL_PROFILE is a public profile on its own
 *  platform: on Facebook it is a Page (planned as Page posts), elsewhere that network's profile. */
export function offerSourceFromRegistry(r: any): KnownOfferSource | null {
  const type = String(r.source_type ?? '');
  if (!SOURCE_NETWORK[type]) return null;
  const network = type === 'SOCIAL_PROFILE' ? PLATFORM_NETWORK[String(r.platform ?? '')] : SOURCE_NETWORK[type];
  if (!network) return null;
  const kind = type === 'SOCIAL_PROFILE' && network === 'FACEBOOK' ? 'FACEBOOK_PAGE' : type;
  return { id: String(r.id), network, kind, url: String(r.url), city: r.city ?? null, priority: Number(r.priority ?? 5),
    name: typeof r.name === 'string' ? r.name : null, offerEvidence: Number(r.offer_evidence ?? 0) || 0,
    districtEvidence: Number(r.district_evidence ?? 0) || 0 };
}

/** Known public communities of the market (registry rows that are not retired, blocked or behind a login). */
export async function loadOfferSources(db: any, countryCode: string, want?: { transaction: 'SALE' | 'RENT'; districts: string[] }): Promise<KnownOfferSource[]> {
  const { data, error } = await db.from('source_registry')
    .select('id,platform,source_type,name,url,city,priority,access_state,lifecycle')
    .eq('country_code', countryCode).in('source_type', Object.keys(SOURCE_NETWORK))
    .not('lifecycle', 'in', '(BLOCKED,RETIRED)').eq('access_state', 'PUBLIC');
  if (error) throw error;
  const rows = (data ?? []) as any[];
  /* Evidence: property offers HOMATCH already stored from each community (planner relevance
     and order). Best effort: without it every community is judged by its name alone. */
  const evidence = new Map<string, number>();
  /* ...and how many of them were THIS transaction in one of the wanted districts. */
  const districtEvidence = new Map<string, number>();
  const wantedDistricts = new Set((want?.districts ?? []).map((d) => resolvePlace(d)?.key ?? d.toLowerCase()));
  if (rows.length) {
    /* Paged (the API returns at most 1000 rows a request), recent offers only, bounded. */
    const since = new Date(Date.now() - OFFER_EVIDENCE_DAYS * 86_400_000).toISOString();
    for (let from = 0; from < OFFER_EVIDENCE_SAMPLE; from += 1000) {
      const { data: seen, error: seenError } = await db.from('supply_observations').select('source_id,district,transaction')
        .in('source_id', rows.map((r) => r.id)).gte('last_seen_at', since).order('id').range(from, from + 999);
      if (seenError) break;
      for (const o of (seen ?? []) as Array<{ source_id: string; district: string | null; transaction: string | null }>) {
        evidence.set(o.source_id, (evidence.get(o.source_id) ?? 0) + 1);
        const key = o.district ? resolvePlace(o.district)?.key ?? o.district.toLowerCase() : null;
        if (key && wantedDistricts.has(key) && (!want || o.transaction === want.transaction)) districtEvidence.set(o.source_id, (districtEvidence.get(o.source_id) ?? 0) + 1);
      }
      if (!seen || seen.length < 1000) break;
    }
  }
  return rows.map((r) => offerSourceFromRegistry({ ...r, offer_evidence: evidence.get(String(r.id)) ?? 0, district_evidence: districtEvidence.get(String(r.id)) ?? 0 }))
    .filter((s): s is KnownOfferSource => s != null);
}

export async function planOfferCampaign(db: any, input: {
  search: OfferSearch; networks: OfferNetwork[]; providerBudgetMicros: number; countryCode: string;
}): Promise<OfferPlan> {
  const settings = await loadOfferSettings(db);
  const [actors, sources] = await Promise.all([loadOfferActors(db, settings.pricingMaxAgeDays),
    loadOfferSources(db, input.countryCode, { transaction: input.search.transaction, districts: input.search.districts })]);
  return planOfferJobs({
    search: input.search, networks: input.networks.filter((n) => settings.networks.includes(n)),
    actors, sources, providerBudgetMicros: input.providerBudgetMicros,
  });
}

/** Queue rows for a planned campaign (provider APIFY_MEMO23, SUPPLY, owned by the run). */
export function offerQueueRows(runId: string, planId: string | null, plan: OfferPlan, search: OfferSearch, criteria: CampaignCriteria | null = null) {
  return plan.jobs.map((j, i) => ({
    property_id: null, matching_job_id: null, discovery_run_id: runId, search_plan_id: planId,
    platform: j.network, language: j.language ?? 'multi', query: j.query ?? j.targetUrl ?? j.stage, status: 'PENDING',
    priority: Math.max(1, 100 - i), provider: 'APIFY_MEMO23', query_kind: 'OFFER_SEARCH', executor: 'EDGE',
    search_direction: 'SUPPLY', tranche: 1,
    dedupe_key: `fpoffer:${runId}:${i}:${j.stage}:${j.sourceId ?? j.query ?? ''}`.slice(0, 300),
    metadata: {
      offerCampaign: true, stage: j.stage, actorKey: j.actorKey, network: j.network, query: j.query, targetUrl: j.targetUrl,
      queries: j.queries, targets: j.targets, targetCount: j.targetCount,
      sourceId: j.sourceId, size: j.size, estimateMicros: j.estimateMicros,
      search: { transaction: search.transaction, city: search.city, districts: search.districts },
      /* Probe-first (followUpDecision) and the strict request each run's posts are counted against. */
      followUp: j.followUp === true, criteria,
    },
  }));
}

/* ── execution ─────────────────────────────────────────────────────────── */

export async function executeOfferJob(db: any, job: any): Promise<OfferOutcome> {
  const meta = (job.metadata ?? {}) as Record<string, any>;
  const { data: run } = await db.from('discovery_runs')
    .select('id,status,pricing_policy,provider_budget_micros,intent_profile_id').eq('id', job.discovery_run_id).maybeSingle();
  if (!run) return out({ outcome: 'CANCELLED', error: 'RUN_MISSING' });
  if (meta.actorRunId) return poll(db, job, run);
  if (run.status !== 'SEARCHING') return out({ outcome: 'CANCELLED', error: `RUN_${run.status}` });
  const settings = await loadOfferSettings(db);
  if (!settings.enabled) return out({ outcome: 'CANCELLED', error: !settings.apifyEnabled ? 'APIFY_DISABLED_BY_ADMIN' : !settings.configured ? 'PROVIDER_NOT_CONFIGURED' : 'SOCIAL_DISABLED' });
  if (meta.followUp === true) {
    /* Probe-first: a network's later runs wait for its first run, and are cancelled — before
       anything is reserved, so at no cost — when that run's posts could not fit the request. */
    const decision = followUpDecision(await probeOf(db, job));
    if (decision === 'WAIT') return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { waiting: 'PROBE_RUN' } });
    if (decision === 'STOP_LOW_YIELD') return out({ outcome: 'CANCELLED', error: 'LOW_YIELD_PROBE' });
  }
  return start(db, job, run);
}

/** The first run of this job's network in the same campaign, once it has ended: posts billed and posts that could fit. */
async function probeOf(db: any, job: any): Promise<{ billed: number; useful: number } | null> {
  const { data: rows } = await db.from('discovery_query_queue').select('id,status,metadata')
    .eq('discovery_run_id', job.discovery_run_id).eq('platform', job.platform).neq('id', job.id);
  const probes = ((rows ?? []) as any[]).filter((r) => r.metadata?.offerCampaign === true && r.metadata?.followUp !== true);
  if (!probes.length) return { billed: 0, useful: 1 };
  if (probes.some((r) => ['PENDING', 'PROCESSING', 'RETRY_WAIT', 'PAUSED'].includes(String(r.status)))) return null;
  const done = probes.filter((r) => r.status === 'DONE');
  /* A probe that failed or was cancelled says nothing about the network's posts: continue. */
  if (!done.length) return { billed: 0, useful: 1 };
  return done.reduce((acc, r) => ({ billed: acc.billed + Number(r.metadata?.billed ?? 0), useful: acc.useful + Number(r.metadata?.useful ?? 0) }), { billed: 0, useful: 0 });
}

async function start(db: any, job: any, run: any): Promise<OfferOutcome> {
  const meta = job.metadata as Record<string, any>;
  const stage = meta.stage as OfferStage;
  const retryCount = Number(meta.retryCount ?? 0);
  const { data: reservation, error } = await db.rpc('find_property_reserve_actor_run', {
    p_run_id: run.id, p_actor_key: meta.actorKey, p_idempotency_key: `fpq:${job.id}:${meta.actorKey}:r${retryCount}`,
    p_queue_job_id: job.id, p_stage: stage, p_network: OFFER_STAGE_NETWORK[stage], p_source_id: meta.sourceId ?? null,
    p_requested_limit: Number(meta.size) || null, p_target_count: Math.max(1, Number(meta.targetCount) || 1),
  });
  if (error) return out({ outcome: 'RETRY', error: error.message, retrySeconds: 30 });
  if (!reservation?.ok) {
    const reason = String(reservation?.reason ?? 'REFUSED');
    if (reason === 'ACTOR_BUSY') return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { waiting: reason } });
    if (reason === 'GLOBAL_BUSY') return out({ outcome: 'WAIT', retrySeconds: 10, metadata: { waiting: reason } });
    if (reason === 'CAMPAIGN_BUDGET') return out({ outcome: 'BUDGET_REACHED', error: reason });
    return out({ outcome: reason === 'RUN_NOT_SEARCHING' ? 'CANCELLED' : 'FAILED', error: reason });
  }
  const runId = String(reservation.runId);
  if (reservation.replay && reservation.status !== 'RESERVED') {
    return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS, metadata: { actorRunId: runId } });
  }
  const maxAgeDays = meta.search?.transaction === 'RENT' ? 45 : 120;
  const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const limit = Math.max(1, Number(reservation.requestedLimit) || 1);
  const { input } = offerInput(stage, meta, limit, since, reservation.inputContract ?? null);
  const problems = essentialMissing(stage as Stage, input, reservation.inputContract ?? null);
  if (problems.length) {
    await db.rpc('find_property_book_actor_cost', { p_actor_run_id: runId, p_status: 'RELEASED', p_actual_micros: 0, p_cost_basis: 'NOT_STARTED',
      p_results_billed: 0, p_items_fetched: 0, p_offers: 0, p_error: `INPUT_CONTRACT: ${problems.join(', ')}` });
    return out({ outcome: 'FAILED', error: `INPUT_CONTRACT: ${problems.join(', ')}` });
  }
  const { data: starting } = await db.from('find_property_actor_runs').update({ status: 'STARTING', updated_at: new Date().toISOString() })
    .eq('id', runId).eq('status', 'RESERVED').is('cost_booked_at', null).select('id');
  if (!Array.isArray(starting) || starting.length !== 1) return out({ outcome: 'CANCELLED', error: 'RESERVATION_NO_LONGER_OPEN' });
  try {
    const started = await startRun(String(reservation.actorId), input, {
      maxItems: limit, maxTotalChargeUsd: Number(reservation.reservedMicros) / 1_000_000, timeoutSeconds: Number(reservation.timeoutSeconds) || 300,
    });
    const { data: marked } = await db.from('find_property_actor_runs')
      .update({ status: 'RUNNING', provider_run_id: started.runId, dataset_id: started.datasetId, updated_at: new Date().toISOString() })
      .eq('id', runId).is('cost_booked_at', null).select('id');
    if (!Array.isArray(marked) || marked.length !== 1) {
      await abortRun(started.runId);
      return out({ outcome: 'CANCELLED', error: 'CAMPAIGN_ENDED_DURING_START' });
    }
    return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS, metadata: { actorRunId: runId, providerRunId: started.runId, datasetId: started.datasetId, timeoutSeconds: Number(reservation.timeoutSeconds) || 300 } });
  } catch (error) {
    const e = error instanceof Memo23Error ? error : new Memo23Error(scrub(String(error)), 0, true);
    if (e.status === 0 || e.status >= 500) {
      /* Ambiguous: the run may exist. Booked START_AMBIGUOUS: counted against the provider
         budget and as HOMATCH cost at its reservation, never charged to the customer. */
      await db.rpc('find_property_book_actor_cost', { p_actor_run_id: runId, p_status: 'ABORTED', p_actual_micros: null, p_cost_basis: 'START_AMBIGUOUS',
        p_results_billed: null, p_items_fetched: 0, p_offers: 0, p_error: `START_AMBIGUOUS: ${e.message}` });
      return out({ outcome: 'FAILED', error: e.message });
    }
    await db.from('find_property_actor_runs').update({ status: 'RESERVED' }).eq('id', runId).eq('status', 'STARTING').is('cost_booked_at', null);
    await db.rpc('find_property_book_actor_cost', { p_actor_run_id: runId, p_status: 'RELEASED', p_actual_micros: 0, p_cost_basis: 'NOT_STARTED',
      p_results_billed: 0, p_items_fetched: 0, p_offers: 0, p_error: `START_FAILED: ${e.message}` });
    if (e.retryable && retryCount < 2) return out({ outcome: 'RETRY', error: e.message, retrySeconds: 60, metadata: { retryCount: retryCount + 1, actorRunId: null } });
    return out({ outcome: 'FAILED', error: e.message });
  }
}

async function poll(db: any, job: any, run: any): Promise<OfferOutcome> {
  const meta = job.metadata as Record<string, any>;
  const stage = meta.stage as OfferStage;
  const { data: ar } = await db.from('find_property_actor_runs').select('*').eq('id', meta.actorRunId).maybeSingle();
  if (!ar) return out({ outcome: 'FAILED', error: 'RUN_MISSING' });
  if (ar.cost_booked_at) return out({ outcome: 'DONE', resultCount: Number(ar.offers_found ?? 0), costUsd: ar.actual_micros != null ? Number(ar.actual_micros) / 1e6 : null });
  if (!ar.provider_run_id) return out({ outcome: 'WAIT', retrySeconds: 45, metadata: { lastPollError: 'NO_PROVIDER_RUN_ID' } });
  const settings = await loadOfferSettings(db);
  /* Switched off, or the campaign ended: stop the provider run, then still book its real cost. */
  if (!settings.enabled || run.status !== 'SEARCHING') await abortRun(ar.provider_run_id).catch(() => undefined);
  let r: any;
  try { r = await getRun(ar.provider_run_id); } catch (error) { return out({ outcome: 'WAIT', retrySeconds: 45, metadata: { lastPollError: scrub(String(error)) } }); }
  if (!r) return out({ outcome: 'WAIT', retrySeconds: 45 });
  if (!TERMINAL_RUN_STATES.has(String(r.status))) {
    const timeoutMs = Math.max(15 * 60_000, (Number(meta.timeoutSeconds) || 0) * 1000 + POLL_SLACK_MS);
    if (Date.now() - Date.parse(ar.created_at) > timeoutMs) await abortRun(ar.provider_run_id).catch(() => undefined);
    return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS });
  }
  let items: unknown[] = []; let total: number | null = null;
  if (ar.dataset_id ?? r.defaultDatasetId) {
    try { ({ items, total } = await datasetItems(String(ar.dataset_id ?? r.defaultDatasetId), Number(ar.requested_limit) + 10)); }
    catch (error) { return out({ outcome: 'WAIT', retrySeconds: 30, metadata: { lastPollError: scrub(String(error)) } }); }
  }
  const billed = total ?? items.length;
  const status = String(r.status);
  const bookStatus = status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'TIMED-OUT' || status === 'TIMED_OUT' ? 'TIMED_OUT' : status === 'ABORTED' ? 'ABORTED' : 'FAILED';
  const cost = runCost(r, billed);
  let micros = cost.micros; let basis: string = cost.basis;
  if (micros == null) {
    const { data: actor } = await db.from('find_buyers_actor_registry').select('start_fee_micros,price_per_1k_micros').eq('actor_key', ar.actor_key).maybeSingle();
    if (actor?.price_per_1k_micros != null) {
      micros = Number(actor.start_fee_micros || 0) + Math.ceil(billed * Number(actor.price_per_1k_micros) / 1000);
      basis = 'REGISTRY_PRICE_X_BILLED_UNITS';
    }
  }
  /* Offers: only posts that offer the searched kind in the searched city. */
  const stored = run.status === 'SEARCHING' || run.status === 'MATCHING' || run.status === 'PAUSED'
    ? await storeOffers(db, ar, stage, items, meta) : { stored: 0, useful: 0 };
  const offers = stored.stored;
  await db.rpc('find_property_book_actor_cost', {
    p_actor_run_id: ar.id, p_status: bookStatus, p_actual_micros: micros, p_cost_basis: basis, p_results_billed: billed,
    p_items_fetched: items.length, p_offers: offers, p_error: bookStatus === 'SUCCEEDED' ? null : `RUN_${status}: ${scrub(String(r.statusMessage ?? ''))}`,
  });
  /* Paid-for posts that yielded nothing: record the field NAMES the Actor returned (never
     values), so an unverified output shape (Telegram, 2026-10-18: 1000 posts, 0 offers) can
     be fixed from evidence instead of guessed. */
  const shape = offers === 0 && items.length
    ? { rawKeys: [...new Set(items.slice(0, 5).flatMap((i) => (i && typeof i === 'object' ? Object.keys(i as Record<string, unknown>) : [])))].slice(0, 60) }
    : {};
  return out({ outcome: 'DONE', resultCount: offers, costUsd: micros != null ? micros / 1e6 : null, metadata: { offers, billed, useful: stored.useful, ...shape } });
}

/**
 * The Actor input for one offer run, from its verified schema. A batched run reads every
 * community in `targets` at once and returns their recent posts (no keyword: the group
 * Actor's `search` has never been exercised, so it is never relied on); TikTok searches
 * every keyword in one run (its search mode is proven in production). Rows queued before batching (one `targetUrl`) are built exactly as before.
 */
export function offerInput(stage: OfferStage, meta: Record<string, any>, limit: number, since: string, contract: InputContract | null):
  { input: Record<string, unknown>; dropped: string[] } {
  const targets = (Array.isArray(meta.targets) ? meta.targets : []) as OfferTarget[];
  const urls = targets.map((t) => t.url).filter((u) => /^https:\/\//.test(u));
  const queries = (Array.isArray(meta.queries) ? meta.queries : []).filter((q: unknown): q is string => typeof q === 'string' && q.trim() !== '');
  if (!urls.length && !queries.length) {
    return buildInput(stage as Stage, { query: meta.query ?? null, targetUrl: meta.targetUrl ?? null, size: limit, since }, contract);
  }
  const fit = (input: Record<string, unknown>) => fitToSchema({ ...(contract?.defaults ?? {}), ...input }, contract?.schemaProperties);
  switch (stage) {
    case 'FB_GROUP_POSTS': {
      /* The groups' recent posts, read whole. `search` only once its behaviour is VERIFIED
         (input_contract.verifiedFields); a field merely listed in the schema is never relied on. */
      const built = buildInput('FB_GROUP_POSTS', { targetUrls: urls, size: limit, since }, contract);
      return queries[0] && verifiedFields(contract).includes('search') ? fit({ ...built.input, search: queries[0] }) : built;
    }
    case 'TELEGRAM_CHANNEL':
      return buildInput('TELEGRAM_CHANNEL', { targetUrls: urls, size: limit, since }, contract);
    case 'IG_PROFILE_POSTS':
      return fit({ startUrls: urls.map((url) => ({ url })), maxItems: limit });
    case 'TIKTOK_SEARCH':
      return fit({ mode: 'search', input: queries, maxResults: limit });
    default:
      return buildInput(stage as Stage, { query: queries[0] ?? meta.query ?? null, targetUrls: urls, targetUrl: urls[0] ?? null, size: limit, since }, contract);
  }
}

/** Input fields verified against a real run: registry input_contract.verifiedFields (array or {field: true}). */
export function verifiedFields(contract: unknown): string[] {
  const v = (contract as { verifiedFields?: unknown } | null)?.verifiedFields;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, ok]) => ok === true).map(([k]) => k);
  return [];
}

/** Which of a batched run's communities a post came from (its group / channel / profile URL). */
function targetOf(item: { url: string | null; parentUrl: string | null; group: { url: string | null } | null; author: { url: string | null } },
  targets: OfferTarget[]): OfferTarget | null {
  if (targets.length === 1) return targets[0];
  const keys = [item.group?.url, item.parentUrl, item.url, item.author?.url].map((u) => communityKey(u ?? null)).filter(Boolean);
  return targets.find((t) => { const k = communityKey(t.url); return k != null && keys.includes(k); }) ?? null;
}

async function storeOffers(db: any, ar: any, stage: OfferStage, items: unknown[], meta: Record<string, any>): Promise<{ stored: number; useful: number }> {
  const search = (meta.search ?? {}) as { transaction?: string; city?: string };
  if (search.transaction !== 'SALE' && search.transaction !== 'RENT') return { stored: 0, useful: 0 };
  const criteria = (meta.criteria ?? null) as CampaignCriteria | null;
  let useful = 0;
  const network = OFFER_STAGE_NETWORK[stage];
  /* Normalized one raw item at a time so each post keeps its own photos (normalize.ts carries none). */
  const normalized = items.flatMap((raw) => normalizeDataset(STAGE_OUTPUT[stage as Stage], network, [raw], null)
    .map((n) => Object.assign(n, { images: offerImages(raw) })));
  const seen = new Set<string>();
  const targets = (Array.isArray(meta.targets) ? meta.targets : []) as OfferTarget[];
  /* A single-community run (pre-batching rows) keeps its source and the source's city. */
  let ownCity: string | null = null;
  if (ar.source_id) {
    const { data: src } = await db.from('source_registry').select('city').eq('id', ar.source_id).maybeSingle();
    ownCity = src?.city ?? null;
  }
  let fallbackId: string | null | undefined;
  const fallback = async () => {
    if (fallbackId !== undefined) return fallbackId;
    const [platform, externalId] = FALLBACK_SOURCE[network] ?? [];
    if (!platform) return (fallbackId = null);
    const { data } = await db.from('source_registry').select('id').eq('platform', platform).eq('external_id', externalId).maybeSingle();
    return (fallbackId = data?.id ?? null);
  };
  let stored = 0; let failed = 0; let firstError: string | null = null;
  const now = new Date().toISOString();
  for (const item of normalized) {
    /* Telegram channel posts: the public post link from channel + message id (see telegramPostUrl). */
    if (!item.url && network === 'TELEGRAM') item.url = telegramPostUrl(item.parentUrl, item.externalId);
    if (item.kind !== 'POST' || !item.url || !/^https:\/\//.test(item.url) || seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    /* Attributed to the community it came from; a keyword search (TikTok) was run for the searched city. */
    const t = ar.source_id ? null : targetOf(item, targets);
    const sourceId: string | null = ar.source_id ?? t?.sourceId ?? await fallback();
    if (!sourceId) continue;
    const sourceCity: string | null = ar.source_id ? ownCity : t?.city ?? (stage === 'TIKTOK_SEARCH' ? search.city ?? null : null);
    const verdict = qualifyOffer(item.text, { transaction: search.transaction as 'SALE' | 'RENT', city: String(search.city ?? '') }, { sourceCity, publishedAt: item.publishedAt });
    if (!verdict.offer) continue;
    const l = verdict.listing;
    const row = {
      source_id: sourceId, adapter_id: `${item.network.toLowerCase()}-community`, external_id: `${item.network}:${item.externalId}`.slice(0, 300),
      canonical_url: item.url, transaction: l.transaction, property_type: l.propertyType, country_code: 'GE',
      city: l.city ?? sourceCity, district: l.district,
      sale_amount: l.transaction === 'SALE' ? l.price?.amount ?? null : null, sale_currency: l.transaction === 'SALE' ? l.price?.currency ?? null : null,
      sale_basis: l.transaction === 'SALE' && l.price ? 'ASKING_SALE_PRICE' : null,
      rent_amount: l.transaction === 'RENT' ? l.price?.amount ?? null : null, rent_currency: l.transaction === 'RENT' ? l.price?.currency ?? null : null,
      rent_period: l.transaction === 'RENT' ? l.price?.period ?? null : null,
      area_sqm: l.areaSqm, rooms: l.rooms, bedrooms: l.bedrooms, floor: l.floor, total_floors: l.totalFloors,
      title: item.text.split('\n').find((line) => line.trim())?.trim().slice(0, 160) ?? null,
      description: item.text.slice(0, 4000), published_at: item.publishedAt, content_fingerprint: listingFingerprint(item.text),
      last_seen_at: now, image_urls: item.images,
      field_origins: { ...l.origins, rawSignalId: null, memo23ActorRunId: ar.id, network: item.network, authorUrl: item.author?.url ?? null },
      structured_quality: l.quality, parser_version: COMMUNITY_LISTING_PARSER_VERSION, adapter_version: SOCIAL_ADAPTER_VERSION,
      updated_at: now,
    };
    const { error } = await db.from('supply_observations').upsert(row, { onConflict: 'source_id,external_id' });
    if (!error) {
      stored += 1;
      /* Could this post fit the request at all (exact, potential or a close alternative)? */
      if (criteria && judgeOffer({ id: row.external_id, ...row, district: row.district ?? null } as never, criteria).category !== 'REJECTED') useful += 1;
    }
    else { failed += 1; firstError ??= scrub(String(error.message ?? error)); }
  }
  /* A paid-for offer that could not be stored is a loss, never silent. */
  if (failed) console.error(JSON.stringify({ event: 'find_property_offer_store_failed', actorRunId: ar.id, failed, stored, error: firstError }));
  /* Without the request (rows queued before strict matching) a probe never stops its network. */
  return { stored, useful: criteria ? useful : stored };
}

/**
 * Before settlement (or on failure): nothing may stay open. Reservations that never
 * reached the provider are released; started runs are aborted and booked with their
 * real cost (UNKNOWN → counted at the reservation). Returns the micros the customer
 * pays for: confirmed provider work only (START_AMBIGUOUS starts are HOMATCH's cost).
 */
export async function finishOfferCampaign(db: any, runId: string): Promise<number> {
  const { data: open } = await db.from('find_property_actor_runs').select('*').eq('discovery_run_id', runId).is('cost_booked_at', null);
  for (const ar of (open ?? []) as any[]) {
    if (!ar.provider_run_id) {
      /* RESERVED never reached the provider: released at $0. STARTING may have reached it
         before its run id was stored: booked START_AMBIGUOUS (HOMATCH cost, not the customer's). */
      const reachedProvider = ar.status !== 'RESERVED';
      await db.rpc('find_property_book_actor_cost', { p_actor_run_id: ar.id, p_status: reachedProvider ? 'ABORTED' : 'RELEASED',
        p_actual_micros: reachedProvider ? null : 0, p_cost_basis: reachedProvider ? 'START_AMBIGUOUS' : 'NOT_STARTED',
        p_results_billed: reachedProvider ? null : 0, p_items_fetched: 0, p_offers: 0,
        p_error: reachedProvider ? 'CAMPAIGN_ENDED_DURING_START' : 'CAMPAIGN_ENDED' });
      continue;
    }
    await abortRun(ar.provider_run_id).catch(() => undefined);
    const r = await getRun(ar.provider_run_id).catch(() => null);
    /* What the provider already delivered is paid for: read it and keep its offers. */
    let items: unknown[] = []; let total: number | null = null;
    const datasetId = ar.dataset_id ?? r?.defaultDatasetId ?? null;
    if (datasetId) ({ items, total } = await datasetItems(String(datasetId), Number(ar.requested_limit) + 10).catch(() => ({ items: [] as unknown[], total: null })));
    const offers = items.length
      ? await storeOffers(db, ar, ar.stage as OfferStage, items, await offerMetaFor(db, ar)).then((r) => r.stored).catch(() => 0) : 0;
    const billed = total ?? (items.length || Number(r?.stats?.datasetItems ?? 0));
    const cost = r ? runCost(r, billed) : { micros: null, basis: 'UNKNOWN' };
    await db.rpc('find_property_book_actor_cost', { p_actor_run_id: ar.id, p_status: 'ABORTED', p_actual_micros: cost.micros,
      p_cost_basis: cost.micros == null ? 'UNKNOWN' : cost.basis, p_results_billed: null, p_items_fetched: items.length, p_offers: offers, p_error: 'CAMPAIGN_ENDED' });
  }
  /* What the CUSTOMER pays for: confirmed provider work only (find_property_customer_micros). */
  const { data: customer, error } = await db.rpc('find_property_customer_micros', { p_run_id: runId });
  if (error) throw new Error(`find_property_customer_micros failed: ${error.message}`);
  return Number(customer ?? 0);
}

/** The queue job metadata of an actor run (its search, communities and keywords). */
async function offerMetaFor(db: any, ar: any): Promise<Record<string, any>> {
  if (!ar.queue_job_id) return {};
  const { data } = await db.from('discovery_query_queue').select('metadata').eq('id', ar.queue_job_id).maybeSingle();
  return (data?.metadata ?? {}) as Record<string, any>;
}
