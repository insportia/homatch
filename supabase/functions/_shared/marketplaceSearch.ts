// MARKETPLACE SEARCH — server helpers shared by marketplace-search (customer)
// and marketplace-worker-ingest (workers).
//
// processAndStore() is the one place a search's results are (re)computed: it
// loads every raw candidate the workers reported, runs the deterministic
// pipeline (src/research-core/marketplace/pipeline.ts), upserts the canonical
// properties in batches, derives the search status from real worker state and,
// once every worker has finished, applies the deterministic Results
// Intelligence (reason order and tradeoffs). Idempotent: running it twice gives
// the same rows.
//
// ZERO MODEL CALLS (owner, 2026-10-29). Nothing in this module or anything it
// imports calls OpenAI or any other model, on any path including failures;
// tests/matrix/findPropertyZeroAi.test.mjs walks the whole import graph.

import { processSearch, publicView, type ResultProperty } from '../../../src/research-core/marketplace/pipeline.ts';
import { applyIntelligence, deterministicIntelligence } from '../../../src/research-core/marketplace/results-intelligence.ts';
import {
  deriveSearchStatus, isTerminalSearch, type SearchStatus, type WorkerRunState,
} from '../../../src/research-core/marketplace/lifecycle.ts';
import type { ExternalListingCandidate, MarketplaceSearchRequest, WorkerRunStatus } from '../../../src/research-core/marketplace/worker-contract.ts';
import { converterFrom, FX_NBG_MAX_AGE_DAYS, ratesFromTable } from '../../../src/research-core/match/structured-gates.ts';
import type { SearchTelemetry } from '../../../src/research-core/marketplace/telemetry.ts';
import { type RunLease, reapDecision } from '../../../src/research-core/marketplace/dispatch.ts';
import { wellFormedDeep } from '../../../src/research-core/marketplace/text-safety.ts';
import { loadSocialCandidates } from './findProperty/socialListings.ts';
import { serviceBackendEnabled } from './serviceControl.ts';
import { type ListingRow, mergeListingRows, resolveSharedRuns, sharedLeaders, sharedListingRows } from './marketplaceCapacity.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const MARKETPLACE_SWITCH = 'marketplace_search_enabled';
/** PostgREST returns at most 1000 rows per request; every full read pages at this size. */
export const PAGE_ROWS = 1000;

/**
 * Read EVERY row of a query, page by page. A single select silently stops at
 * the server's row cap, which would drop listings and so hide valid results.
 */
// deno-lint-ignore no-explicit-any
const RESULT_WRITE_BATCH = 100;

/** Upsert result rows in checked batches; a rejected batch is retried row by row. */
export async function writeResultRows(db: any, rows: Array<{ property_key: string } & Record<string, unknown>>): Promise<{ written: number; failedKeys: string[]; error: string | null }> {
  let written = 0;
  const failedKeys: string[] = [];
  let lastError: string | null = null;
  for (const batch of chunk(rows, RESULT_WRITE_BATCH)) {
    const { error } = await db.from('discovery_marketplace_properties').upsert(batch, { onConflict: 'search_id,property_key' });
    if (!error) { written += batch.length; continue; }
    lastError = String(error.message ?? error).slice(0, 300);
    for (const row of batch) {
      const { error: rowError } = await db.from('discovery_marketplace_properties').upsert([row], { onConflict: 'search_id,property_key' });
      if (rowError) { failedKeys.push(row.property_key); lastError = String(rowError.message ?? rowError).slice(0, 300); } else written += 1;
    }
  }
  return { written, failedKeys, error: lastError };
}

export async function readAll<T>(query: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await query(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_ROWS) return out;
  }
}

/**
 * Apply lease/deadline decisions (dispatch.ts) to non-terminal runs: an expired
 * lease is re-queued while its retry budget lasts, a run that already delivered
 * keeps its results as PARTIAL, a run past its deadline closes. Each run is
 * decided alone; no run's failure touches another.
 */
export async function reapRuns(db: Db, rows: Array<Record<string, unknown>>, maxAttemptsOf: (workerId: string) => number, now = new Date()) {
  const changed: Array<{ id: string; status: string }> = [];
  for (const r of rows) {
    const lease: RunLease = {
      id: String(r.id), workerId: String(r.worker_id), status: r.status as WorkerRunStatus, attempts: Number(r.attempts) || 0,
      returnedCount: Number(r.returned_count) || 0, leaseExpiresAt: (r.lease_expires_at as string) ?? null, deadlineAt: String(r.deadline_at),
    };
    const d = reapDecision(lease, now, maxAttemptsOf(lease.workerId));
    if (!d) continue;
    const update = d.action === 'REQUEUE'
      ? { status: 'QUEUED', lease_expires_at: null, updated_at: now.toISOString() }
      : { status: d.status, lease_expires_at: null, completed_at: now.toISOString(), updated_at: now.toISOString(),
          errors: [...((r.errors as unknown[]) ?? []), { code: d.reason, message: '' }] };
    /* Guarded on the status we decided from, so a concurrent report always wins. */
    const { data } = await db.from('discovery_marketplace_worker_runs').update(update)
      .eq('id', lease.id).eq('status', lease.status).select('id,status');
    if (data?.length) { changed.push({ id: lease.id, status: update.status }); r.status = update.status; }
  }
  return changed;
}

const truthy = (v: unknown) => v === true || v === 'true' || (typeof v === 'string' && v.replace(/"/g, '') === 'true');

/** Find Property's own HTML portal workers: each has its own admin switch (default off),
 * like MyHome and SS.ge, so the global provider kill switch does not hold them. */
export const PORTAL_WORKER_SWITCHES: Readonly<Record<string, string>> = {
  'placege-agent': 'marketplace_placege_enabled',
  'homege-agent': 'marketplace_homege_enabled',
  'brokeri-agent': 'marketplace_brokeri_enabled',
  'allhome-agent': 'marketplace_allhome_enabled',
};

export type MarketplaceSwitches = { enabled: boolean; providersKilled: boolean; myhomeEnabled: boolean; ssgeEnabled: boolean; portals: Record<string, boolean> };

/** Product and provider switches. MyHome, SS.ge and the portal workers are explicit
 * and scoped to Find Property; other providers keep the global switch. */
export async function loadMarketplaceSwitches(db: Db): Promise<MarketplaceSwitches> {
  const { data } = await db.from('admin_settings').select('key,value').in('key', [MARKETPLACE_SWITCH, 'provider_kill_switch', 'marketplace_myhome_enabled', 'marketplace_ssge_enabled', ...Object.values(PORTAL_WORKER_SWITCHES)]);
  const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return {
    enabled: truthy(map.get(MARKETPLACE_SWITCH)),
    myhomeEnabled: truthy(map.get('marketplace_myhome_enabled')),
    ssgeEnabled: truthy(map.get('marketplace_ssge_enabled')),
    portals: Object.fromEntries(Object.entries(PORTAL_WORKER_SWITCHES).map(([worker, key]) => [worker, truthy(map.get(key))])),
    /* An unreadable kill switch is treated as ON: dispatching is the thing it guards. */
    providersKilled: map.has('provider_kill_switch') ? truthy(map.get('provider_kill_switch')) : true,
  };
}

/** May this worker run? One rule for dispatch and for claim. */
export function workerSwitchOn(switches: MarketplaceSwitches, workerId: string): boolean {
  if (workerId === 'myhome-agent') return switches.myhomeEnabled;
  if (workerId === 'ssge-agent') return switches.ssgeEnabled;
  if (workerId in PORTAL_WORKER_SWITCHES) return switches.portals[workerId] === true;
  return !switches.providersKilled;
}

/** Is any source allowed at all? */
export const anySourceOn = (switches: MarketplaceSwitches) =>
  switches.myhomeEnabled || switches.ssgeEnabled || Object.values(switches.portals).some(Boolean) || !switches.providersKilled;

/** Operator-entered current rates only (fx_rates). A pair with no rate stays unconvertible. */
export async function loadConverter(db: Db) {
  const { data } = await db.from('fx_rates').select('base_currency,quote_currency,rate,effective_from').is('effective_to', null);
  return converterFrom(ratesFromTable((data ?? []) as never));
}

/**
 * Rates for reading a customer's budget (understand): operator rates first, then the
 * National Bank of Georgia's official rates the mortgage-fx-rates function keeps
 * (read-only; GEL per one unit, dated). A pair neither table holds stays
 * unconvertible: the budget is dropped with a reason, never converted at 0 or a guess.
 */
export async function loadSearchConverter(db: Db, now = Date.now()) {
  const [{ data: operator }, { data: nbg }] = await Promise.all([
    db.from('fx_rates').select('base_currency,quote_currency,rate,effective_from').is('effective_to', null),
    db.from('mortgage_fx_rates').select('currency,gel_per_unit,rate_date').in('currency', ['USD', 'EUR']),
  ]);
  const official: Record<string, { rate: number; asOf?: string }> = {};
  for (const r of (nbg ?? []) as Array<{ currency: string; gel_per_unit: number | string; rate_date: string }>) {
    const rate = Number(r.gel_per_unit);
    const at = Date.parse(String(r.rate_date));
    if (!(rate > 0) || !Number.isFinite(at) || now - at > (FX_NBG_MAX_AGE_DAYS + 1) * 86_400_000) continue;
    official[`${String(r.currency).toUpperCase()}_GEL`] = { rate, asOf: String(r.rate_date) };
  }
  /* Later tables win in converterFrom: operator-entered rates override the NBG fallback. */
  return converterFrom(official, ratesFromTable((operator ?? []) as never, now));
}

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export interface ProcessOutcome {
  status: SearchStatus;
  properties: number;
  strongMatches: number;
}

/**
 * Recompute one search from everything its workers reported. Safe to call
 * from any number of concurrent reports: properties are upserted by
 * (search_id, property_key) and stale keys are removed afterwards.
 */
export async function processAndStore(db: Db, searchId: string, now = new Date()): Promise<ProcessOutcome | null> {
  const started = Date.now();
  const { data: search } = await db.from('discovery_marketplace_searches')
    .select('id,user_id,status,request,telemetry,ai_status,results_available_at,completed_at').eq('id', searchId).maybeSingle();
  if (!search) return null;
  if (search.status === 'CANCELLED') return { status: 'CANCELLED', properties: 0, strongMatches: 0 };

  const { data: runRows } = await db.from('discovery_marketplace_worker_runs')
    .select('id,worker_id,status,deadline_at,returned_count,attempts,lease_expires_at,errors,metrics,shared_run_id,query_applied,pool_pending').eq('search_id', searchId);
  const workerIds = [...new Set((runRows ?? []).map((r: Record<string, unknown>) => String(r.worker_id)))];
  const { data: workerRows } = workerIds.length
    ? await db.from('discovery_marketplace_workers').select('worker_id,max_attempts').in('worker_id', workerIds)
    : { data: [] };
  const attemptsOf = new Map<string, number>((workerRows ?? []).map((w: { worker_id: string; max_attempts: number }) => [w.worker_id, Number(w.max_attempts) || 3] as [string, number]));
  /* A run sharing an identical search's portal read takes that run's outcome once it ends. */
  await resolveSharedRuns(db, (runRows ?? []) as Array<Record<string, unknown>>, now);
  await reapRuns(db, (runRows ?? []) as Array<Record<string, unknown>>, (id) => attemptsOf.get(id) ?? 3, now);
  await serveCachedListings(db, searchId, search.request as MarketplaceSearchRequest, (runRows ?? []) as Array<Record<string, unknown>>, now);
  const runs: WorkerRunState[] = (runRows ?? []).map((r: Record<string, unknown>) => ({
    workerId: String(r.worker_id), status: r.status as WorkerRunStatus, deadlineAt: r.deadline_at as string, returnedCount: Number(r.returned_count) || 0,
  }));

  /* EVERY listing every worker reported, paged: nothing is dropped at a row cap. */
  const ownRows = await readAll<ListingRow>((from, to) =>
    db.from('discovery_marketplace_listings').select('raw,worker_run_id,source_key,source_listing_id').eq('search_id', searchId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
  /* Shared runs: the leader's fresh listings, read in place rather than copied per search. */
  const leaders = sharedLeaders((runRows ?? []) as Array<Record<string, unknown>>);
  const listingRows = mergeListingRows(ownRows, await sharedListingRows(db, [...leaders.keys()]));
  const workerOfRun = new Map<string, string>([
    ...(runRows ?? []).map((r: Record<string, unknown>) => [String(r.id), String(r.worker_id)] as [string, string]),
    ...leaders,
  ]);
  const candidates = listingRows.map((l) => ({
    workerId: workerOfRun.get(l.worker_run_id) ?? 'unknown', candidate: l.raw as unknown as ExternalListingCandidate,
  }));
  /* Social offers of this person's ENDED paid campaigns for this search: ranked and
     deduplicated with the portals; a failed read never loses the portal results. */
  /* Only while paid Deep Search is on (service find_property_deep): paused, every search is
     portal-only; past campaigns stay readable on their own results page. */
  try { if (await serviceBackendEnabled(db, 'find_property_deep')) candidates.push(...await loadSocialCandidates(db, searchId, search.user_id ?? null, now)); }
  catch (error) { console.error(JSON.stringify({ event: 'marketplace_social_candidates_failed', searchId, error: String(error).slice(0, 300) })); }

  const request = search.request as MarketplaceSearchRequest;
  const output = processSearch({ request, candidates, converter: await loadConverter(db), now });
  /* Lifecycle, AI and the pool fill count only homes that fit; OTHER (found, outside the
     request) is shown to the customer but never makes a search "have results". */
  const fitting = output.properties.filter((p) => p.group !== 'OTHER');
  const derived = deriveSearchStatus(search.status as SearchStatus, runs, {
    properties: fitting.length, strongMatches: output.stats.strongMatches,
  });

  const telemetry: SearchTelemetry = search.telemetry ?? { ai: [], workers: [], processingMs: [] };
  let properties: Array<ResultProperty & { tradeoffs?: string[] }> = output.properties;
  let aiStatus = search.ai_status as string;
  /* Results Intelligence, in code: every recompute orders each property's reasons by what
     this person stated and attaches its tradeoffs. No model, no veto, nothing to fail. */
  if (fitting.length) properties = applyIntelligence(properties, deterministicIntelligence(properties, request));
  if (isTerminalSearch(derived.status) && aiStatus === 'NOT_STARTED') aiStatus = fitting.length ? 'DONE' : 'SKIPPED';

  const rows = properties.map((p) => ({
    search_id: searchId, property_key: p.key, result_group: p.group, rank: p.rank, score: p.score,
    view: publicView(p), internal: p.internal,
  }));
  /* Results are written so that one bad row can never erase the others (production
     2026-10-16: an emoji split by a clip made every 500-row batch fail with "invalid input
     syntax for type json", unchecked, and the customer saw only the tail of the ranking).
     Every string is made well-formed, batches are small and checked, a failing batch is
     retried row by row, and older rows are removed only after every write succeeded. */
  const write = await writeResultRows(db, rows.map((r) => wellFormedDeep(r)));
  if (write.failedKeys.length) {
    telemetry.writeFailures = [...(telemetry.writeFailures ?? []), { at: new Date(now).toISOString(), failed: write.failedKeys.length, sample: write.failedKeys.slice(0, 5), error: write.error }].slice(-10);
  }
  if (!write.failedKeys.length) {
    const keepSet = new Set(rows.map((r) => r.property_key));
    const existing = await readAll<{ property_key: string }>((from, to) =>
      db.from('discovery_marketplace_properties').select('property_key').eq('search_id', searchId).order('property_key').range(from, to));
    const stale = existing.map((e) => e.property_key).filter((k) => !keepSet.has(k));
    for (const batch of chunk(stale, 200)) {
      const { error } = await db.from('discovery_marketplace_properties').delete().eq('search_id', searchId).in('property_key', batch);
      if (error) throw new Error(`stale result cleanup failed: ${error.message}`);
    }
  }

  telemetry.processingMs = [...(telemetry.processingMs ?? []), Date.now() - started].slice(-50);
  const terminalRuns = runs.filter((r) => ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'].includes(r.status)).length;
  const strongMatches = output.stats.strongMatches;
  await db.from('discovery_marketplace_searches').update({
    status: derived.status,
    failure_reason: derived.failureReason,
    workers_total: runs.length,
    workers_terminal: terminalRuns,
    properties_count: properties.length,
    strong_matches: strongMatches,
    stats: output.stats,
    ai_status: aiStatus,
    telemetry,
    processed_at: now.toISOString(),
    results_available_at: search.results_available_at ?? (derived.status === 'RESULTS_AVAILABLE' || (isTerminalSearch(derived.status) && properties.length) ? now.toISOString() : null),
    /* A later re-rank (social offers joining) keeps the search's real completion time. */
    completed_at: isTerminalSearch(derived.status) ? (search.completed_at ?? now.toISOString()) : null,
    updated_at: now.toISOString(),
  }).eq('id', searchId).neq('status', 'CANCELLED');
  return { status: derived.status, properties: properties.length, strongMatches };
}

/** Sources answered instantly from HOMATCH's shared listing pool (what earlier
 * searches already collected), then refreshed live. */
export const CACHE_FALLBACK: Record<string, string> = {
  'myhome-agent': 'myhome-ge', 'ssge-agent': 'ss-ge',
  'placege-agent': 'place-ge', 'homege-agent': 'home-ge', 'brokeri-agent': 'brokeri-ge',
  'allhome-agent': 'allhome-ge',
};
/** What the customer reads as the source of a worker's listings. */
export const WORKER_SOURCE_NAMES: Record<string, string> = {
  'myhome-agent': 'MyHome', 'ssge-agent': 'SS.ge', 'placege-agent': 'Place.ge', 'homege-agent': 'Home.ge',
  'brokeri-agent': 'Brokeri.ge', 'allhome-agent': 'Allhome.ge',
};
/** Only listings their source confirmed within this window are served from the
 * pool: an older observation may already be sold, expired or deleted. */
export const CACHE_WINDOW_MS = 72 * 3600_000;
/** Wall-time budget per request for answering sources from the pool (Edge CPU limit is 2 s). */
export const POOL_BUDGET_MS = 400;
/** Newest pooled observations ranked per source (production 2026-10-18: at most 766 distinct per
    deal and property type), so one source's pool stays well inside one request's CPU. */
const CACHE_SCAN_ROWS = 1500;

/**
 * The shared listing pool. At search start (atStart) every pooled source
 * answers immediately from listings earlier searches collected; afterwards a
 * run that could not refresh (cooling down, refused, failed, timed out) or only
 * partly did falls back to it. Only the listings this search's own pipeline
 * accepts are added, each with its ORIGINAL observedAt (freshness and "last
 * checked" stay true) and marked observationLevel CACHED; only observations
 * within CACHE_WINDOW_MS are used. A fresh row for the same listing replaces
 * the cached one when the live run reports it; cached rows never overwrite
 * fresh ones (ignoreDuplicates). Run status and returned_count are unchanged,
 * so a pooled answer is never reported as a fresh refresh. Runs once per run.
 */
export async function serveCachedListings(db: Db, searchId: string, request: MarketplaceSearchRequest,
  runRows: Array<Record<string, unknown>>, now = new Date(), atStart = false, budgetMs = POOL_BUDGET_MS): Promise<number> {
  let served = 0;
  const began = Date.now();
  for (const run of runRows) {
    const sourceKey = CACHE_FALLBACK[String(run.worker_id)];
    // At search start every pooled source answers (pool_pending: a few sources per request,
    // the rest on the next status poll); afterwards only a run that could not refresh (or
    // only partly) falls back to the pool.
    const pending = run.pool_pending === true;
    if (!sourceKey || (!atStart && !pending && !['BLOCKED', 'FAILED', 'TIMED_OUT', 'PARTIAL'].includes(String(run.status)))) continue;
    /* CPU BOUND: ranking one source's pool costs up to ~0.5 s of CPU; stop before the Edge limit. */
    if (Date.now() - began >= budgetMs) break;
    if (pending) {
      /* Claimed before the work so two concurrent requests never rank the same pool twice. */
      const { data: claimed } = await db.from('discovery_marketplace_worker_runs').update({ pool_pending: false })
        .eq('id', run.id).eq('pool_pending', true).select('id');
      run.pool_pending = false;
      if (!claimed?.length) continue;
    }
    try {
      const { data: already } = await db.from('discovery_marketplace_listings').select('id')
        .eq('worker_run_id', run.id).eq('raw->retrievalMetadata->>observationLevel', 'CACHED').limit(1);
      if ((already ?? []).length) continue;
      const { data: rows } = await db.from('discovery_marketplace_listings')
        .select('source_listing_id,exact_url,raw,observed_at').eq('source_key', sourceKey).neq('search_id', searchId)
        .gte('observed_at', new Date(now.getTime() - CACHE_WINDOW_MS).toISOString())
        .order('observed_at', { ascending: false }).limit(CACHE_SCAN_ROWS);
      const latest = new Map<string, { source_listing_id: string; exact_url: string; raw: ExternalListingCandidate; observed_at: string }>();
      for (const r of rows ?? []) if (!latest.has(r.source_listing_id)) latest.set(r.source_listing_id, r);
      const pool = [...latest.values()].filter((r) => r.raw?.transactionType === request.transactionType && r.raw?.propertyType === request.propertyType);
      if (!pool.length) continue;
      // The search's own pipeline decides what matches; nothing is re-implemented here.
      const accepted = new Set(processSearch({ request, candidates: pool.map((r) => ({ workerId: String(run.worker_id), candidate: r.raw })), converter: await loadConverter(db), now })
        .properties.filter((p) => p.group !== 'OTHER').flatMap((p) => p.listings.map((l) => l.listingId)));
      const cached = pool.filter((r) => accepted.has(`${r.raw.source}:${r.raw.sourceListingId}`)).map((r) => ({
        search_id: searchId, worker_run_id: run.id, source_key: sourceKey, source_listing_id: r.source_listing_id, exact_url: r.exact_url,
        observed_at: r.observed_at, updated_at: now.toISOString(),
        raw: { ...r.raw, retrievalMetadata: { ...(r.raw.retrievalMetadata ?? {}), observationLevel: 'CACHED', cachedAt: now.toISOString() } },
      }));
      for (const batch of chunk(cached, 500)) {
        const { error } = await db.from('discovery_marketplace_listings').upsert(batch, { onConflict: 'search_id,source_key,source_listing_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      served += cached.length;
    } catch (error) {
      /* Still owed: the next request answers this source. */
      if (pending) await db.from('discovery_marketplace_worker_runs').update({ pool_pending: true }).eq('id', run.id);
      throw error;
    }
  }
  return served;
}

/** Results of an identical search finished this recently are shared, not refetched. */
export const SHARE_WINDOW_MS = 30 * 60_000;

/** What a source is asked: the request without its per-search identity. */
export function requestKey(request: unknown): string {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const { searchId: _s, searchPlanId: _p, requestedAt: _r, maxResults: _m, ...rest } = (request ?? {}) as Record<string, unknown>;
  return JSON.stringify(canon(rest));
}

/**
 * ONE FETCH FOR MANY IDENTICAL SEARCHES. Runs once before every claim: a queued
 * run whose request equals one this worker finished within SHARE_WINDOW_MS is
 * answered from that run's fresh listings (their own observedAt, so "last
 * checked" stays true) instead of asking the source again. Workers take one run
 * at a time, so identical searches queue behind the first and are answered as
 * soon as it finishes. The run is closed with the source run's status and errors
 * (a partly read run stays PARTIAL) and records sharedFromRun.
 */
export async function shareRecentResults(db: Db, workerId: string, now = new Date(),
  process: (db: Db, searchId: string, now: Date) => Promise<unknown> = processAndStore): Promise<number> {
  const { data: queued } = await db.from('discovery_marketplace_worker_runs').select('id,search_id,request')
    .eq('worker_id', workerId).eq('status', 'QUEUED').is('shared_run_id', null).order('created_at', { ascending: true }).limit(50);
  if (!(queued ?? []).length) return 0;
  const { data: recent } = await db.from('discovery_marketplace_worker_runs')
    .select('id,status,request,discovered_count,query_applied,errors,completed_at').eq('worker_id', workerId)
    .in('status', ['COMPLETE', 'PARTIAL']).gt('returned_count', 0)
    .gte('completed_at', new Date(now.getTime() - SHARE_WINDOW_MS).toISOString())
    .order('completed_at', { ascending: false }).limit(50);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of recent ?? []) { const k = requestKey(r.request); if (!byKey.has(k)) byKey.set(k, r); }
  let shared = 0;
  for (const q of queued ?? []) {
    const source = byKey.get(requestKey(q.request));
    if (!source) continue;
    const { data: rows } = await db.from('discovery_marketplace_listings')
      .select('source_key,source_listing_id,exact_url,raw,observed_at').eq('worker_run_id', source.id).limit(5000);
    const fresh = (rows ?? []).filter((r: { raw: ExternalListingCandidate }) => r.raw?.retrievalMetadata?.observationLevel !== 'CACHED');
    if (!fresh.length) continue;
    // Close first, conditionally: a concurrent claim can never also run it.
    const { data: closed } = await db.from('discovery_marketplace_worker_runs').update({
      status: source.status, returned_count: fresh.length, discovered_count: source.discovered_count,
      query_applied: { ...((source.query_applied ?? {}) as Record<string, unknown>), sharedFromRun: source.id },
      errors: source.errors ?? [], completed_at: now.toISOString(), updated_at: now.toISOString(),
    }).eq('id', q.id).eq('status', 'QUEUED').select('id').maybeSingle();
    if (!closed) continue;
    for (const batch of chunk(fresh, 500)) {
      const { error } = await db.from('discovery_marketplace_listings').upsert(batch.map((r: Record<string, unknown>) => ({
        ...r, search_id: q.search_id, worker_run_id: q.id, updated_at: now.toISOString(),
      })), { onConflict: 'search_id,source_key,source_listing_id' });
      if (error) throw new Error(error.message);
    }
    await process(db, String(q.search_id), now);
    shared++;
  }
  return shared;
}
