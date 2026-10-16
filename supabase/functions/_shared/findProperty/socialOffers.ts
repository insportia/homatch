// FIND PROPERTY — the paid social OFFER campaign, executed.
//
// One discovery_run (a buyer's or tenant's paid campaign) → memo23 Actor runs on
// Facebook groups/pages/posts, Instagram profiles, Telegram channels and VK walls
// (owner scope 2026-10-16; memo23 only through findBuyers/memo23Client.ts) → the
// posts that OFFER a property of the searched kind become supply_observations →
// supply-matching delivers them to the search like any other external listing.
//
// Money never moves without a reservation: every Actor run is reserved in SQL
// against the campaign's 63% provider budget (find_property_reserve_actor_run,
// which also enforces find_property_social_enabled and the APIFY switch) and is
// capped at Apify by maxTotalChargeUsd = that reservation. Its cost is booked
// once (find_property_book_actor_cost); an unknown cost counts at its reservation.
// finishOfferCampaign aborts and books whatever is still open before settlement.

import { buildInput, essentialMissing, STAGE_OUTPUT, type Stage } from '../../../../src/research-core/findBuyers/actorInputs.ts';
import { normalizeDataset } from '../../../../src/research-core/findBuyers/normalize.ts';
import {
  OFFER_STAGE_NETWORK, planOfferJobs, qualifyOffer, type KnownOfferSource, type OfferActor, type OfferNetwork,
  type OfferPlan, type OfferSearch, type OfferStage,
} from '../../../../src/research-core/findProperty/offerCampaign.ts';
import { COMMUNITY_LISTING_PARSER_VERSION } from '../../../../src/research-core/discovery/community-listing.ts';
import { abortRun, datasetItems, getRun, Memo23Error, runCost, scrub, startRun, TERMINAL_RUN_STATES } from '../findBuyers/memo23Client.ts';
import { providerDisabledByAdmin } from '../providerSwitch.ts';
import { listingFingerprint } from '../communitySupply.ts';

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
const FALLBACK_SEARCH_SOURCE = 'homatch:fp-fb-post-search';
const val = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);

export interface OfferSettings { enabled: boolean; apifyEnabled: boolean; networks: OfferNetwork[]; pricingMaxAgeDays: number }

export async function loadOfferSettings(db: any): Promise<OfferSettings> {
  const { data } = await db.from('admin_settings').select('key,value')
    .in('key', ['find_property_social_enabled', 'find_property_social_networks', 'provider_disabled_list', 'find_buyers_pricing_max_age_days']);
  const m = new Map(((data ?? []) as any[]).map((r) => [r.key, val(r.value)]));
  const apifyEnabled = !providerDisabledByAdmin(m.get('provider_disabled_list'), 'APIFY');
  const networks = Array.isArray(m.get('find_property_social_networks'))
    ? (m.get('find_property_social_networks') as string[]).filter((n): n is OfferNetwork => ['FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'VK'].includes(n))
    : ['FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'VK'] as OfferNetwork[];
  return {
    enabled: m.get('find_property_social_enabled') === true && apifyEnabled,
    apifyEnabled, networks,
    pricingMaxAgeDays: Number.isFinite(Number(m.get('find_buyers_pricing_max_age_days'))) ? Number(m.get('find_buyers_pricing_max_age_days')) : 30,
  };
}

/** Actors as the planner sees them: ready = enabled, not quarantined, pricing verified and fresh. */
export async function loadOfferActors(db: any, maxAgeDays: number): Promise<Record<string, OfferActor>> {
  const { data, error } = await db.from('find_buyers_actor_registry')
    .select('actor_key,enabled,emergency_disabled,health,pricing_model,pricing_verified_at,price_per_1k_micros,start_fee_micros,probe_size')
    .in('actor_key', ['FB_POST_SEARCH', 'FB_GROUP_POSTS', 'FB_PAGE_POSTS', 'IG_PROFILE_POSTS', 'TELEGRAM_CHANNEL', 'VK_POSTS_COMMENTS']);
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
    };
  }
  return outMap;
}

const SOURCE_NETWORK: Record<string, OfferNetwork> = {
  FACEBOOK_GROUP: 'FACEBOOK', TELEGRAM_GROUP: 'TELEGRAM', INSTAGRAM_PROFILE: 'INSTAGRAM', VK_COMMUNITY: 'VK', SOCIAL_PROFILE: 'FACEBOOK',
};

/** Known public communities of the market (registry rows that are not retired, blocked or behind a login). */
export async function loadOfferSources(db: any, countryCode: string): Promise<KnownOfferSource[]> {
  const { data, error } = await db.from('source_registry')
    .select('id,platform,source_type,url,city,priority,access_state,lifecycle')
    .eq('country_code', countryCode).in('source_type', Object.keys(SOURCE_NETWORK))
    .not('lifecycle', 'in', '(BLOCKED,RETIRED)').eq('access_state', 'PUBLIC');
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((r) => SOURCE_NETWORK[r.source_type] && (r.platform !== 'FACEBOOK' || r.source_type !== 'SOCIAL_PROFILE'))
    .map((r) => ({ id: String(r.id), network: SOURCE_NETWORK[r.source_type], kind: String(r.source_type), url: String(r.url), city: r.city ?? null, priority: Number(r.priority ?? 5) }));
}

export async function planOfferCampaign(db: any, input: {
  search: OfferSearch; networks: OfferNetwork[]; providerBudgetMicros: number; countryCode: string;
}): Promise<OfferPlan> {
  const settings = await loadOfferSettings(db);
  const [actors, sources] = await Promise.all([loadOfferActors(db, settings.pricingMaxAgeDays), loadOfferSources(db, input.countryCode)]);
  return planOfferJobs({
    search: input.search, networks: input.networks.filter((n) => settings.networks.includes(n)),
    actors, sources, providerBudgetMicros: input.providerBudgetMicros,
  });
}

/** Queue rows for a planned campaign (provider APIFY_MEMO23, SUPPLY, owned by the run). */
export function offerQueueRows(runId: string, planId: string | null, plan: OfferPlan, search: OfferSearch) {
  return plan.jobs.map((j, i) => ({
    property_id: null, matching_job_id: null, discovery_run_id: runId, search_plan_id: planId,
    platform: j.network, language: null, query: j.query ?? j.targetUrl ?? j.stage, status: 'PENDING',
    priority: Math.max(1, 100 - i), provider: 'APIFY_MEMO23', query_kind: 'OFFER_SEARCH', executor: 'EDGE',
    search_direction: 'SUPPLY', tranche: 1,
    dedupe_key: `fpoffer:${runId}:${j.stage}:${j.sourceId ?? j.query}`.slice(0, 300),
    metadata: {
      offerCampaign: true, stage: j.stage, actorKey: j.actorKey, network: j.network, query: j.query, targetUrl: j.targetUrl,
      sourceId: j.sourceId, size: j.size, estimateMicros: j.estimateMicros,
      search: { transaction: search.transaction, city: search.city, districts: search.districts },
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
  if (!settings.enabled) return out({ outcome: 'CANCELLED', error: settings.apifyEnabled ? 'SOCIAL_DISABLED' : 'APIFY_DISABLED_BY_ADMIN' });
  return start(db, job, run);
}

async function start(db: any, job: any, run: any): Promise<OfferOutcome> {
  const meta = job.metadata as Record<string, any>;
  const stage = meta.stage as OfferStage;
  const retryCount = Number(meta.retryCount ?? 0);
  const { data: reservation, error } = await db.rpc('find_property_reserve_actor_run', {
    p_run_id: run.id, p_actor_key: meta.actorKey, p_idempotency_key: `fpq:${job.id}:${meta.actorKey}:r${retryCount}`,
    p_queue_job_id: job.id, p_stage: stage, p_network: OFFER_STAGE_NETWORK[stage], p_source_id: meta.sourceId ?? null,
    p_requested_limit: Number(meta.size) || null,
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
  const { input } = buildInput(stage as Stage, { query: meta.query ?? null, targetUrl: meta.targetUrl ?? null, size: limit, since }, reservation.inputContract ?? null);
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
    return out({ outcome: 'WAIT', retrySeconds: POLL_SECONDS, metadata: { actorRunId: runId, providerRunId: started.runId, datasetId: started.datasetId } });
  } catch (error) {
    const e = error instanceof Memo23Error ? error : new Memo23Error(scrub(String(error)), 0, true);
    if (e.status === 0 || e.status >= 500) {
      /* Ambiguous: the run may exist. Booked UNKNOWN, which counts at its reservation. */
      await db.rpc('find_property_book_actor_cost', { p_actor_run_id: runId, p_status: 'ABORTED', p_actual_micros: null, p_cost_basis: 'UNKNOWN',
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
    if (Date.now() - Date.parse(ar.created_at) > 15 * 60_000) await abortRun(ar.provider_run_id).catch(() => undefined);
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
  const offers = run.status === 'SEARCHING' || run.status === 'MATCHING' || run.status === 'PAUSED'
    ? await storeOffers(db, ar, stage, items, meta.search ?? {}) : 0;
  await db.rpc('find_property_book_actor_cost', {
    p_actor_run_id: ar.id, p_status: bookStatus, p_actual_micros: micros, p_cost_basis: basis, p_results_billed: billed,
    p_items_fetched: items.length, p_offers: offers, p_error: bookStatus === 'SUCCEEDED' ? null : `RUN_${status}: ${scrub(String(r.statusMessage ?? ''))}`,
  });
  return out({ outcome: 'DONE', resultCount: offers, costUsd: micros != null ? micros / 1e6 : null, metadata: { offers, billed } });
}

async function storeOffers(db: any, ar: any, stage: OfferStage, items: unknown[], search: { transaction?: string; city?: string }): Promise<number> {
  if (search.transaction !== 'SALE' && search.transaction !== 'RENT') return 0;
  const normalized = normalizeDataset(STAGE_OUTPUT[stage as Stage], OFFER_STAGE_NETWORK[stage], items, null);
  let sourceId: string | null = ar.source_id ?? null;
  let sourceCity: string | null = null;
  if (sourceId) {
    const { data: src } = await db.from('source_registry').select('city').eq('id', sourceId).maybeSingle();
    sourceCity = src?.city ?? null;
  } else {
    const { data: fallback } = await db.from('source_registry').select('id').eq('platform', 'FACEBOOK').eq('external_id', FALLBACK_SEARCH_SOURCE).maybeSingle();
    sourceId = fallback?.id ?? null;
  }
  if (!sourceId) return 0;
  let stored = 0;
  const now = new Date().toISOString();
  for (const item of normalized) {
    if (item.kind !== 'POST' || !item.url || !/^https:\/\//.test(item.url)) continue;
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
      last_seen_at: now, field_origins: { ...l.origins, rawSignalId: null, memo23ActorRunId: ar.id, network: item.network },
      structured_quality: l.quality, parser_version: COMMUNITY_LISTING_PARSER_VERSION, adapter_version: 'fp-social-offers-1',
      updated_at: now,
    };
    const { error } = await db.from('supply_observations').upsert(row, { onConflict: 'source_id,external_id' });
    if (!error) stored += 1;
  }
  return stored;
}

/**
 * Before settlement (or on failure): nothing may stay open. Reservations that never
 * reached the provider are released; started runs are aborted and booked with their
 * real cost (UNKNOWN → counted at the reservation). Returns the committed micros.
 */
export async function finishOfferCampaign(db: any, runId: string): Promise<number> {
  const { data: open } = await db.from('find_property_actor_runs').select('*').eq('discovery_run_id', runId).is('cost_booked_at', null);
  for (const ar of (open ?? []) as any[]) {
    if (!ar.provider_run_id) {
      await db.from('find_property_actor_runs').update({ status: 'RESERVED' }).eq('id', ar.id).eq('status', 'STARTING');
      const { error } = await db.rpc('find_property_book_actor_cost', { p_actor_run_id: ar.id, p_status: 'RELEASED', p_actual_micros: 0,
        p_cost_basis: 'NOT_STARTED', p_results_billed: 0, p_items_fetched: 0, p_offers: 0, p_error: 'CAMPAIGN_ENDED' });
      /* A STARTING run may have reached the provider: book it UNKNOWN instead. */
      if (error) await db.rpc('find_property_book_actor_cost', { p_actor_run_id: ar.id, p_status: 'ABORTED', p_actual_micros: null,
        p_cost_basis: 'UNKNOWN', p_results_billed: null, p_items_fetched: 0, p_offers: 0, p_error: 'CAMPAIGN_ENDED_DURING_START' });
      continue;
    }
    await abortRun(ar.provider_run_id).catch(() => undefined);
    const r = await getRun(ar.provider_run_id).catch(() => null);
    const cost = r ? runCost(r, Number(r?.stats?.datasetItems ?? 0)) : { micros: null, basis: 'UNKNOWN' };
    await db.rpc('find_property_book_actor_cost', { p_actor_run_id: ar.id, p_status: 'ABORTED', p_actual_micros: cost.micros,
      p_cost_basis: cost.micros == null ? 'UNKNOWN' : cost.basis, p_results_billed: null, p_items_fetched: 0, p_offers: 0, p_error: 'CAMPAIGN_ENDED' });
  }
  const { data: committed } = await db.rpc('find_property_committed_micros', { p_run_id: runId });
  return Number(committed ?? 0);
}
