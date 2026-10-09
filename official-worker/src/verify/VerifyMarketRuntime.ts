// VerifyMarketRuntime.ts — Verify Market Research over the EXISTING MyHome.ge
// and SS.ge acquisition adapters (the same acquireMyHome / acquireSsge Find
// Property uses). No new crawler, no paid service, no user-scoped tables:
// research-agent asks for a bounded comparable sample, polls, and folds the
// normalised listings into Verify's existing market lane.
//
// Bounded on purpose: Verify needs a representative local sample, not the
// whole inventory. Each source stops at `maxPerSource` listings or its own
// deadline, whichever comes first, and widens from the district to the city
// only when the local sample is thin.
//
// Privacy: seller names, phones, e-mails, profiles, descriptions and photos
// never leave this module. A phone survives only as a one-way hash, used for
// cross-platform duplicate detection.

import { createHash, randomUUID } from 'node:crypto';
import type { ExternalListingCandidate, MarketplaceSearchRequest, MarketplacePropertyType, MarketplaceTransaction } from '../marketplace/contract.js';

export interface VerifyMarketProfile {
  city: string;
  district: string | null;
  transactionType: MarketplaceTransaction;
  propertyType: MarketplacePropertyType;
  areaSqm: number | null;
  rooms: number | null;
  /** The subject's own asking price, when known (USD). Only widens/centres the window. */
  priceUsd: number | null;
}

export type SourceKey = 'MYHOME' | 'SSGE';

export interface VerifyComparable {
  source: SourceKey;
  sourceListingId: string;
  /** Internal provenance only — never rendered to a customer. */
  exactUrl: string;
  price: number | null;
  currency: string | null;
  pricePerSqm: number | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  transactionType: string | null;
  buildingStatus: string | null;
  renovationStatus: string | null;
  title: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  observedAt: string;
  imageHashes: string[];
  phoneHash: string | null;
  scope: 'DISTRICT' | 'CITY';
}

export interface SourceRun {
  source: SourceKey;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'DISABLED' | 'TIMED_OUT';
  attempts: Array<{ scope: 'DISTRICT' | 'CITY'; discovered: number; returned: number; status: string; error: string | null; durationMs: number }>;
  listings: number;
  error: string | null;
}

export interface VerifyMarketJob {
  id: string;
  status: 'RUNNING' | 'COMPLETE';
  profile: VerifyMarketProfile;
  createdAt: string;
  completedAt: string | null;
  sources: Record<SourceKey, SourceRun>;
  comparables: VerifyComparable[];
}

export type Acquirer = (request: MarketplaceSearchRequest, options: { deadlineAt: string; signal?: AbortSignal; report: (result: any) => Promise<void> }) => Promise<unknown>;

export interface VerifyMarketDeps {
  acquireMyHome: Acquirer;
  acquireSsge: Acquirer;
  maxPerSource?: number;
  sourceBudgetMs?: number;
  minLocalSample?: number;
  now?: () => number;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

/** The comparable window. Area ±25 %, rooms ±1, price ±60 % around a known ask. */
export function buildMarketplaceRequest(profile: VerifyMarketProfile, district: string | null, nowIso = new Date().toISOString()): MarketplaceSearchRequest {
  const area = profile.areaSqm && profile.areaSqm > 5 ? profile.areaSqm : null;
  const rooms = profile.rooms && profile.rooms > 0 ? Math.round(profile.rooms) : null;
  const price = profile.priceUsd && profile.priceUsd > 0 ? profile.priceUsd : null;
  const priceMin = price ? Math.floor(price * 0.4) : 0;
  const priceMax = price ? Math.ceil(price * 1.6) : profile.transactionType === 'BUY' ? 5_000_000 : 50_000;
  return {
    contract: 'marketplace-worker-1',
    searchId: `verify-${randomUUID()}`,
    searchPlanId: 'verify-market',
    market: 'GE',
    country: 'GE',
    city: profile.city,
    districts: district ? [district] : [],
    transactionType: profile.transactionType,
    propertyType: profile.propertyType,
    priceMinUsd: priceMin,
    priceMaxUsd: priceMax,
    collectPriceMaxUsd: priceMax,
    areaMinSqm: area ? Math.floor(area * 0.75) : null,
    areaMaxSqm: area ? Math.ceil(area * 1.25) : null,
    rooms: rooms ? { min: Math.max(1, rooms - 1), max: rooms + 1 } : null,
    bedrooms: null,
    bathrooms: null,
    buildingStatuses: [],
    renovationPreferences: [],
    furnished: null,
    parking: null,
    mustHave: [],
    niceToHave: [],
    exclusions: [],
    floorPreferences: [],
    searchLanguages: ['ka'],
    requestedAt: nowIso,
  };
}

export function toVerifyComparable(source: SourceKey, c: ExternalListingCandidate, scope: 'DISTRICT' | 'CITY'): VerifyComparable | null {
  if (!c?.sourceListingId || !c.exactUrl) return null;
  const phoneDigits = c.seller?.publicPhone ? String(c.seller.publicPhone).replace(/\D/g, '').slice(-9) : '';
  const ppsm = c.pricePerSqm ?? (c.price && c.areaSqm && c.areaSqm > 0 ? Math.round((c.price / c.areaSqm) * 100) / 100 : null);
  return {
    source,
    sourceListingId: String(c.sourceListingId),
    exactUrl: c.exactUrl,
    price: c.price ?? null,
    currency: c.currency ?? null,
    pricePerSqm: ppsm,
    areaSqm: c.areaSqm ?? null,
    rooms: c.rooms ?? null,
    bedrooms: c.bedrooms ?? null,
    floor: c.floor ?? null,
    totalFloors: c.totalFloors ?? null,
    city: c.city ?? null,
    district: c.district ?? null,
    address: c.address ?? null,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    propertyType: c.propertyType ?? null,
    transactionType: c.transactionType ?? null,
    buildingStatus: c.buildingStatus ?? null,
    renovationStatus: c.renovationStatus ?? (typeof c.retrievalMetadata?.renovation === 'string' ? (c.retrievalMetadata.renovation as string) : null),
    title: c.title ? String(c.title).slice(0, 160) : null,
    publishedAt: c.publishedAt ?? null,
    updatedAt: c.updatedAt ?? null,
    observedAt: c.observedAt ?? new Date().toISOString(),
    imageHashes: Array.isArray(c.imageHashes) ? c.imageHashes.slice(0, 6) : [],
    phoneHash: phoneDigits.length >= 9 ? hash(phoneDigits) : null,
    scope,
  };
}

async function runSource(source: SourceKey, acquire: Acquirer, profile: VerifyMarketProfile, run: SourceRun, deps: VerifyMarketDeps): Promise<VerifyComparable[]> {
  const now = deps.now ?? Date.now;
  const cap = deps.maxPerSource ?? 80;
  const minLocal = deps.minLocalSample ?? 8;
  const out = new Map<string, VerifyComparable>();
  const scopes: Array<{ scope: 'DISTRICT' | 'CITY'; district: string | null }> = profile.district
    ? [{ scope: 'DISTRICT', district: profile.district }, { scope: 'CITY', district: null }]
    : [{ scope: 'CITY', district: null }];
  run.status = 'RUNNING';
  const runStarted = now();
  const total = deps.sourceBudgetMs ?? 150_000;
  for (const { scope, district } of scopes) {
    if (scope === 'CITY' && out.size >= minLocal) break;
    const remaining = total - (now() - runStarted);
    if (remaining < 25_000) break;
    const started = now();
    const controller = new AbortController();
    let discovered = 0;
    let status = 'COMPLETE';
    let error: string | null = null;
    const request = buildMarketplaceRequest(profile, district);
    try {
      await acquire(request, {
        deadlineAt: new Date(started + remaining).toISOString(),
        signal: controller.signal,
        report: async (result: any) => {
          discovered = Math.max(discovered, Number(result?.discoveredCount) || 0);
          if (result?.errors?.length && !error) error = String(result.errors[0]?.code ?? 'SOURCE_ERROR');
          if (result?.status && result.status !== 'RESULTS_RECEIVED') status = result.status;
          for (const l of result?.listings ?? []) {
            const v = toVerifyComparable(source, l, scope);
            if (v && !out.has(v.sourceListingId)) out.set(v.sourceListingId, v);
          }
          // Enough for a representative sample: stop politely.
          if (out.size >= cap) controller.abort();
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        status = 'FAILED';
        error = String((e as Error)?.message ?? e).slice(0, 160);
      } else status = 'PARTIAL';
    }
    if (controller.signal.aborted && status !== 'FAILED') status = 'PARTIAL';
    run.attempts.push({ scope, discovered, returned: out.size, status, error, durationMs: now() - started });
    if (out.size >= cap) break;
  }
  const comparables = [...out.values()].slice(0, cap);
  run.listings = comparables.length;
  const last = run.attempts[run.attempts.length - 1];
  run.status = comparables.length ? (run.attempts.every((a) => a.status === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL') : last?.status === 'TIMED_OUT' ? 'TIMED_OUT' : last?.status === 'FAILED' || last?.status === 'BLOCKED' ? 'FAILED' : 'COMPLETE';
  run.error = comparables.length ? null : last?.error ?? null;
  return comparables;
}

export class VerifyMarketRuntime {
  private jobs = new Map<string, VerifyMarketJob>();
  constructor(private deps: VerifyMarketDeps) {
    setInterval(() => {
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (const [id, j] of this.jobs) if (Date.parse(j.createdAt) < cutoff) this.jobs.delete(id);
    }, 60_000).unref?.();
  }

  start(profile: VerifyMarketProfile, sources: SourceKey[] = ['MYHOME', 'SSGE']): VerifyMarketJob {
    const id = randomUUID();
    const mk = (s: SourceKey): SourceRun => ({ source: s, status: sources.includes(s) ? 'QUEUED' : 'DISABLED', attempts: [], listings: 0, error: null });
    const job: VerifyMarketJob = { id, status: 'RUNNING', profile, createdAt: new Date().toISOString(), completedAt: null, sources: { MYHOME: mk('MYHOME'), SSGE: mk('SSGE') }, comparables: [] };
    this.jobs.set(id, job);
    void this.execute(job, sources);
    return job;
  }

  async execute(job: VerifyMarketJob, sources: SourceKey[]): Promise<void> {
    const tasks: Promise<VerifyComparable[]>[] = [];
    if (sources.includes('MYHOME')) tasks.push(runSource('MYHOME', this.deps.acquireMyHome, job.profile, job.sources.MYHOME, this.deps).catch(() => []));
    if (sources.includes('SSGE')) tasks.push(runSource('SSGE', this.deps.acquireSsge, job.profile, job.sources.SSGE, this.deps).catch(() => []));
    const results = await Promise.all(tasks);
    job.comparables = results.flat();
    job.status = 'COMPLETE';
    job.completedAt = new Date().toISOString();
  }

  get(id: string): VerifyMarketJob | null {
    return this.jobs.get(id) ?? null;
  }
}

const TX: MarketplaceTransaction[] = ['BUY', 'MONTHLY_RENT', 'DAILY_RENT'];
const PT: MarketplacePropertyType[] = ['APARTMENT', 'HOUSE', 'PENTHOUSE', 'LAND', 'COMMERCIAL', 'OFFICE', 'VILLA', 'TOWNHOUSE', 'STUDIO', 'OTHER'];

/** Validate an untrusted HTTP body into a profile, or null. */
export function parseVerifyMarketProfile(body: any): VerifyMarketProfile | null {
  const city = typeof body?.city === 'string' ? body.city.trim().slice(0, 80) : '';
  if (!city) return null;
  const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const tx = TX.includes(body?.transactionType) ? body.transactionType : 'BUY';
  const raw = PT.includes(body?.propertyType) ? body.propertyType : 'APARTMENT';
  // Both adapters support APARTMENT/HOUSE/LAND/COMMERCIAL; map the rest honestly.
  const propertyType: MarketplacePropertyType = raw === 'PENTHOUSE' || raw === 'STUDIO' ? 'APARTMENT' : raw === 'VILLA' || raw === 'TOWNHOUSE' ? 'HOUSE' : raw === 'OFFICE' ? 'COMMERCIAL' : raw === 'OTHER' ? 'APARTMENT' : raw;
  return {
    city,
    district: typeof body?.district === 'string' && body.district.trim() ? body.district.trim().slice(0, 80) : null,
    transactionType: tx,
    propertyType,
    areaSqm: num(body?.areaSqm),
    rooms: num(body?.rooms),
    priceUsd: num(body?.priceUsd),
  };
}
