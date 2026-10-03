// HOMATCH MARKETPLACE SEARCH — the generic Marketplace Worker contract.
//
// The core never knows how a marketplace is searched. A worker (browser, HTTP or
// API, it does not matter here) receives a `MarketplaceSearchRequest`, does its
// site-specific work, and reports `MarketplaceWorkerResult`s carrying
// `ExternalListingCandidate`s. Everything after that (validation, normalisation,
// entity resolution, ranking) is the same for every worker, and adding the
// twentieth marketplace means implementing this contract, not redesigning Find
// Property.
//
// Worker payloads are UNTRUSTED. `validateWorkerReport()` is the only way a
// worker's bytes reach the database: unknown fields are discarded, URLs must
// be safe http(s), sizes are bounded, and partial data stays partial (a field
// a listing did not state is null, never a guess).

import { safeWebUrl } from '../discovery/source-link.ts';
import {
  type BuildingStatus, type MarketplacePropertyType, type MarketplaceTransaction, type RenovationStatus,
  asBuildingStatus, asPropertyType, asRenovationStatus, asTransaction,
} from './taxonomy.ts';
import { type SearchIntelligenceBrief, confirmedValue } from './brief.ts';

export const WORKER_CONTRACT_VERSION = 'marketplace-worker-1';

/* ------------------------------------------------------------------ *
 * Definition and registry state                                      *
 * ------------------------------------------------------------------ */

export type WorkerExecutionMode = 'BROWSER' | 'HTTP' | 'API';
export type WorkerSourceType = 'MARKETPLACE' | 'AGENCY' | 'DEVELOPER' | 'AGGREGATOR';
/** Registry lifecycle. Only ACTIVE + enabled ever receives a customer search. */
export type WorkerRegistryState = 'REGISTERED' | 'TESTING' | 'PROVEN' | 'ACTIVE' | 'DISABLED' | 'BLOCKED';
export const WORKER_REGISTRY_STATES: readonly WorkerRegistryState[] = ['REGISTERED', 'TESTING', 'PROVEN', 'ACTIVE', 'DISABLED', 'BLOCKED'];

export type SupportedFilter =
  | 'PRICE' | 'AREA' | 'ROOMS' | 'BEDROOMS' | 'BATHROOMS' | 'DISTRICT' | 'BUILDING_STATUS'
  | 'RENOVATION' | 'FURNISHED' | 'PARKING' | 'FLOOR';

export interface MarketplaceWorkerDefinition {
  workerId: string;
  /** source_registry.adapter_id / source key this worker reads. */
  sourceId: string;
  sourceName: string;
  sourceType: WorkerSourceType;
  supportedMarkets: string[];
  supportedLanguages: string[];
  supportedPropertyTypes: MarketplacePropertyType[];
  supportedTransactionTypes: MarketplaceTransaction[];
  supportedFilters: SupportedFilter[];
  executionMode: WorkerExecutionMode;
  timeoutMs: number;
  maxResults: number;
  state: WorkerRegistryState;
  enabled: boolean;
  health: { status: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN'; checkedAt: string | null };
}

/** A registry row exists ≠ a worker runs. Both conditions, always. */
export function isDispatchable(w: Pick<MarketplaceWorkerDefinition, 'state' | 'enabled'>): boolean {
  return w.state === 'ACTIVE' && w.enabled === true;
}

/** Workers that can serve this request at all (market, transaction, type). */
export function eligibleWorkers(
  workers: readonly MarketplaceWorkerDefinition[],
  request: Pick<MarketplaceSearchRequest, 'market' | 'transactionType' | 'propertyType'>,
): MarketplaceWorkerDefinition[] {
  return workers.filter((w) => isDispatchable(w)
    && w.supportedMarkets.includes(request.market)
    && w.supportedTransactionTypes.includes(request.transactionType)
    && w.supportedPropertyTypes.includes(request.propertyType));
}

/* ------------------------------------------------------------------ *
 * Request                                                            *
 * ------------------------------------------------------------------ */

export interface MarketplaceSearchRequest {
  contract: typeof WORKER_CONTRACT_VERSION;
  searchId: string;
  searchPlanId: string;
  market: string;
  country: string;
  city: string;
  districts: string[];
  transactionType: MarketplaceTransaction;
  propertyType: MarketplacePropertyType;
  priceMinUsd: number;
  priceMaxUsd: number;
  areaMinSqm: number | null;
  areaMaxSqm: number | null;
  rooms: { min: number | null; max: number | null } | null;
  bedrooms: { min: number | null; max: number | null } | null;
  bathrooms: { min: number | null; max: number | null } | null;
  buildingStatuses: BuildingStatus[];
  renovationPreferences: RenovationStatus[];
  furnished: boolean | null;
  parking: boolean | null;
  mustHave: string[];
  niceToHave: string[];
  exclusions: string[];
  searchLanguages: string[];
  /**
   * The hard ceiling a worker may collect up to. Workers collect slightly above
   * the customer's maximum (the Budget Upgrade window, ≤ +10%) so that layer has
   * candidates; the in-budget results are filtered by the core, never by a worker.
   */
  collectPriceMaxUsd: number;
  requestedAt: string;
}

/** Upper bound workers collect to: the customer's max + the 10% upgrade ceiling. */
export const UPGRADE_CEILING = 0.10;

/**
 * A READY brief → the canonical worker request. Only confirmed values pass;
 * nothing is broadened. Throws when a required value is absent, because a
 * request built from an incomplete brief is a bug upstream of here.
 */
export function buildSearchRequest(
  brief: SearchIntelligenceBrief,
  ids: { searchId: string; searchPlanId: string },
  now = new Date(),
): MarketplaceSearchRequest {
  const t = confirmedValue(brief.transactionType);
  const p = confirmedValue(brief.propertyType);
  const city = confirmedValue(brief.city);
  const price = confirmedValue(brief.price);
  if (!t || !p || !city || !price || price.min === null || price.max === null) {
    throw new Error('buildSearchRequest: brief is not READY');
  }
  const area = confirmedValue(brief.area);
  const buildings = (confirmedValue(brief.buildingStatuses) ?? []).filter((b): b is BuildingStatus => b !== 'ANY');
  const renovations = (confirmedValue(brief.renovationPreferences) ?? []).filter((r): r is RenovationStatus => r !== 'ANY');
  return {
    contract: WORKER_CONTRACT_VERSION,
    searchId: ids.searchId,
    searchPlanId: ids.searchPlanId,
    market: brief.country,
    country: brief.country,
    city,
    districts: confirmedValue(brief.districts) ?? [],
    transactionType: t,
    propertyType: p,
    priceMinUsd: price.min,
    priceMaxUsd: price.max,
    areaMinSqm: area?.min ?? null,
    areaMaxSqm: area?.max ?? null,
    rooms: confirmedValue(brief.rooms),
    bedrooms: confirmedValue(brief.bedrooms),
    bathrooms: confirmedValue(brief.bathrooms),
    buildingStatuses: buildings,
    renovationPreferences: renovations,
    furnished: confirmedValue(brief.furnished),
    parking: confirmedValue(brief.parking),
    mustHave: [...brief.mustHave],
    niceToHave: [...brief.niceToHave],
    exclusions: [...brief.exclusions],
    searchLanguages: brief.relevantSearchLanguages.length ? [...brief.relevantSearchLanguages] : ['ka', 'en'],
    collectPriceMaxUsd: Math.floor(price.max * (1 + UPGRADE_CEILING)),
    requestedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Result and candidate                                               *
 * ------------------------------------------------------------------ */

export type WorkerRunStatus =
  | 'QUEUED' | 'SEARCHING' | 'RESULTS_RECEIVED' | 'PROCESSING' | 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED';
export const WORKER_RUN_STATUSES: readonly WorkerRunStatus[] = [
  'QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED',
];
export const TERMINAL_WORKER_STATUSES: readonly WorkerRunStatus[] = ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'];
export const isTerminalWorkerStatus = (s: WorkerRunStatus) => TERMINAL_WORKER_STATUSES.includes(s);

export type DeclaredSellerType = 'OWNER' | 'AGENCY' | 'BROKER' | 'DEVELOPER' | 'UNKNOWN';

export interface ExternalListingCandidate {
  source: string;
  sourceListingId: string;
  exactUrl: string;
  canonicalUrl: string | null;
  sourceName: string | null;
  sourceType: WorkerSourceType | null;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  pricePerSqm: number | null;
  country: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: MarketplacePropertyType | null;
  transactionType: MarketplaceTransaction | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  buildingStatus: BuildingStatus | null;
  renovationStatus: RenovationStatus | null;
  constructionYear: number | null;
  furnished: boolean | null;
  parking: boolean | null;
  amenities: string[];
  images: string[];
  imageHashes: string[];
  publishedAt: string | null;
  updatedAt: string | null;
  observedAt: string;
  seller: {
    name: string | null;
    publicPhone: string | null;
    publicEmail: string | null;
    publicProfile: string | null;
    declaredType: DeclaredSellerType | null;
    /** Other listings by this seller the worker saw on the same source, when it can say. */
    sourceListingCount: number | null;
  };
  provenance: { exactUrl: string; authorUrl: string | null; sourceUrl: string | null };
  evidence: Array<{ field: string; text: string }>;
  retrievalMetadata: Record<string, string | number | boolean | null>;
}

export interface MarketplaceWorkerResult {
  contract: typeof WORKER_CONTRACT_VERSION;
  searchId: string;
  searchPlanId: string;
  workerId: string;
  sourceId: string;
  status: WorkerRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  queryApplied: Record<string, string | number | boolean | null | string[]>;
  discoveredCount: number;
  returnedCount: number;
  listings: ExternalListingCandidate[];
  errors: Array<{ code: string; message: string }>;
  metrics: WorkerMetrics;
}

export interface WorkerMetrics {
  durationMs: number | null;
  pagesVisited: number | null;
  actions: number | null;
  bytesTransferred: number | null;
  browserMs: number | null;
  estimatedCostUsd: number | null;
}

/* ------------------------------------------------------------------ *
 * Validation of untrusted worker payloads                            *
 * ------------------------------------------------------------------ */

export const MAX_LISTINGS_PER_REPORT = 500;
const MAX_TEXT = 8000;
const MAX_IMAGES = 24;

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown, cap = 400): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\u0000/g, '').trim();
  return s ? s.slice(0, cap) : null;
};
const finite = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return null;
  return v;
};
const intIn = (v: unknown, lo: number, hi: number) => {
  const n = finite(v, lo, hi);
  return n === null ? null : Math.trunc(n);
};
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const currency = (v: unknown) => {
  const s = str(v, 3)?.toUpperCase() ?? null;
  return s && /^[A-Z]{3}$/.test(s) ? s : null;
};
const declared = (v: unknown): DeclaredSellerType | null => {
  const s = str(v, 20)?.toUpperCase();
  return s === 'OWNER' || s === 'AGENCY' || s === 'BROKER' || s === 'DEVELOPER' || s === 'UNKNOWN' ? s : null;
};
const sourceType = (v: unknown): WorkerSourceType | null => {
  const s = str(v, 20)?.toUpperCase();
  return s === 'MARKETPLACE' || s === 'AGENCY' || s === 'DEVELOPER' || s === 'AGGREGATOR' ? s : null;
};
const email = (v: unknown) => {
  const s = str(v, 200);
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};
const phone = (v: unknown) => {
  const s = str(v, 40);
  return s && /^[+\d][\d\s().-]{5,}$/.test(s) ? s : null;
};

export interface CandidateRejection { index: number; reason: string }

/** One untrusted listing → a candidate, or a reason it was refused. */
export function validateCandidate(raw: unknown, workerSource: string, now = new Date()):
  { ok: true; candidate: ExternalListingCandidate } | { ok: false; reason: string } {
  const r = rec(raw);
  if (!r) return { ok: false, reason: 'NOT_OBJECT' };
  const exactUrl = safeWebUrl(r.exactUrl);
  if (!exactUrl) return { ok: false, reason: 'UNSAFE_OR_MISSING_URL' };
  const sourceListingId = str(r.sourceListingId, 120);
  if (!sourceListingId) return { ok: false, reason: 'MISSING_SOURCE_LISTING_ID' };
  const source = str(r.source, 80);
  if (source && source !== workerSource) return { ok: false, reason: 'SOURCE_MISMATCH' };
  const s = rec(r.seller) ?? {};
  const prov = rec(r.provenance) ?? {};
  const images = (Array.isArray(r.images) ? r.images : []).map(safeWebUrl).filter((u): u is string => !!u).slice(0, MAX_IMAGES);
  const lat = finite(r.latitude, -90, 90);
  const lng = finite(r.longitude, -180, 180);
  const evidence = (Array.isArray(r.evidence) ? r.evidence : []).slice(0, 20).flatMap((e) => {
    const x = rec(e);
    const field = str(x?.field, 40);
    const text = str(x?.text, 500);
    return field && text ? [{ field, text }] : [];
  });
  const meta: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(rec(r.retrievalMetadata) ?? {}).slice(0, 20)) {
    if (!/^[a-zA-Z][\w.-]{0,40}$/.test(k)) continue;
    if (typeof v === 'string') meta[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) meta[k] = v;
    else if (typeof v === 'boolean' || v === null) meta[k] = v;
  }
  return {
    ok: true,
    candidate: {
      source: workerSource,
      sourceListingId,
      exactUrl,
      canonicalUrl: safeWebUrl(r.canonicalUrl),
      sourceName: str(r.sourceName, 120),
      sourceType: sourceType(r.sourceType),
      title: str(r.title, 300),
      description: str(r.description, MAX_TEXT),
      price: finite(r.price, 0, 1e10),
      currency: currency(r.currency),
      pricePerSqm: finite(r.pricePerSqm, 0, 1e8),
      country: str(r.country, 2)?.toUpperCase() ?? null,
      city: str(r.city, 80),
      district: str(r.district, 80),
      address: str(r.address, 300),
      latitude: lat !== null && lng !== null ? lat : null,
      longitude: lat !== null && lng !== null ? lng : null,
      propertyType: asPropertyType(r.propertyType),
      transactionType: asTransaction(r.transactionType),
      areaSqm: finite(r.areaSqm, 1, 100000),
      rooms: intIn(r.rooms, 0, 60),
      bedrooms: intIn(r.bedrooms, 0, 40),
      bathrooms: intIn(r.bathrooms, 0, 30),
      floor: intIn(r.floor, -5, 200),
      totalFloors: intIn(r.totalFloors, 1, 200),
      buildingStatus: asBuildingStatus(r.buildingStatus),
      renovationStatus: asRenovationStatus(r.renovationStatus),
      constructionYear: intIn(r.constructionYear, 1800, 2100),
      furnished: bool(r.furnished),
      parking: bool(r.parking),
      amenities: (Array.isArray(r.amenities) ? r.amenities : []).map((a) => str(a, 40)).filter((a): a is string => !!a).slice(0, 30),
      images,
      imageHashes: (Array.isArray(r.imageHashes) ? r.imageHashes : []).map((h) => str(h, 128)).filter((h): h is string => !!h).slice(0, MAX_IMAGES),
      publishedAt: iso(r.publishedAt),
      updatedAt: iso(r.updatedAt),
      observedAt: iso(r.observedAt) ?? now.toISOString(),
      seller: {
        name: str(s.name, 160),
        publicPhone: phone(s.publicPhone),
        publicEmail: email(s.publicEmail),
        publicProfile: safeWebUrl(s.publicProfile),
        declaredType: declared(s.declaredType),
        sourceListingCount: intIn(s.sourceListingCount, 0, 1_000_000),
      },
      provenance: {
        exactUrl,
        authorUrl: safeWebUrl(prov.authorUrl),
        sourceUrl: safeWebUrl(prov.sourceUrl),
      },
      evidence,
      retrievalMetadata: meta,
    },
  };
}

export interface ValidatedReport {
  status: WorkerRunStatus;
  final: boolean;
  /** A FAILED report the worker marks transient (rate limit, timeout): eligible for a retry. */
  retryable: boolean;
  discoveredCount: number;
  listings: ExternalListingCandidate[];
  rejected: CandidateRejection[];
  errors: Array<{ code: string; message: string }>;
  metrics: WorkerMetrics;
  queryApplied: Record<string, unknown>;
}

/**
 * A whole worker report. `final` is true for a terminal status; a worker may
 * send several non-final batches (RESULTS_RECEIVED) first.
 */
export function validateWorkerReport(raw: unknown, workerSource: string, now = new Date()):
  { ok: true; report: ValidatedReport } | { ok: false; reason: string } {
  const r = rec(raw);
  if (!r) return { ok: false, reason: 'NOT_OBJECT' };
  const statusRaw = str(r.status, 20)?.toUpperCase() as WorkerRunStatus | undefined;
  const allowed: WorkerRunStatus[] = ['SEARCHING', 'RESULTS_RECEIVED', 'COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'];
  if (!statusRaw || !allowed.includes(statusRaw)) return { ok: false, reason: 'BAD_STATUS' };
  const list = Array.isArray(r.listings) ? r.listings : [];
  if (list.length > MAX_LISTINGS_PER_REPORT) return { ok: false, reason: 'TOO_MANY_LISTINGS' };
  const listings: ExternalListingCandidate[] = [];
  const rejected: CandidateRejection[] = [];
  const seen = new Set<string>();
  list.forEach((item, index) => {
    const v = validateCandidate(item, workerSource, now);
    if (!v.ok) { rejected.push({ index, reason: v.reason }); return; }
    if (seen.has(v.candidate.sourceListingId)) { rejected.push({ index, reason: 'DUPLICATE_IN_REPORT' }); return; }
    seen.add(v.candidate.sourceListingId);
    listings.push(v.candidate);
  });
  const m = rec(r.metrics) ?? {};
  const errors = (Array.isArray(r.errors) ? r.errors : []).slice(0, 20).flatMap((e) => {
    const x = rec(e);
    const code = str(x?.code, 60);
    return code ? [{ code, message: str(x?.message, 300) ?? '' }] : [];
  });
  const queryApplied: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec(r.queryApplied) ?? {}).slice(0, 30)) {
    if (/^[a-zA-Z][\w.-]{0,40}$/.test(k) && (typeof v !== 'object' || v === null || Array.isArray(v))) {
      queryApplied[k] = Array.isArray(v) ? v.slice(0, 20).map((x) => String(x).slice(0, 80)) : typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  return {
    ok: true,
    report: {
      status: statusRaw,
      final: isTerminalWorkerStatus(statusRaw),
      retryable: statusRaw === 'FAILED' && r.retryable === true,
      discoveredCount: intIn(r.discoveredCount, 0, 1_000_000) ?? listings.length,
      listings,
      rejected,
      errors,
      metrics: {
        durationMs: intIn(m.durationMs, 0, 86_400_000),
        pagesVisited: intIn(m.pagesVisited, 0, 100_000),
        actions: intIn(m.actions, 0, 1_000_000),
        bytesTransferred: intIn(m.bytesTransferred, 0, 1e12),
        browserMs: intIn(m.browserMs, 0, 86_400_000),
        estimatedCostUsd: finite(m.estimatedCostUsd, 0, 1000),
      },
      queryApplied,
    },
  };
}

/** Allowed worker status transitions; a terminal worker run never moves again. */
export function canTransition(from: WorkerRunStatus, to: WorkerRunStatus): boolean {
  if (isTerminalWorkerStatus(from)) return false;
  if (from === to) return to === 'RESULTS_RECEIVED' || to === 'SEARCHING';
  const order: WorkerRunStatus[] = ['QUEUED', 'SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'];
  if (isTerminalWorkerStatus(to)) return true;
  return order.indexOf(to) >= order.indexOf(from);
}
