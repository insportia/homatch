// VerifyMarketRuntime.ts — Verify Market Research over the EXISTING MyHome.ge
// and SS.ge acquisition adapters (the same acquireMyHome / acquireSsge Find
// Property uses). No new crawler, no paid service, no user-scoped tables:
// research-agent asks for a bounded comparable sample, polls, and folds the
// normalised listings into Verify's existing market lane.
//
// Bounded on purpose: Verify needs a representative local sample, not the
// whole inventory. Each source stops at `maxPerSource` listings or its own
// deadline, whichever comes first. It never widens to the whole city (F6):
// a thin local sample is reported as thin, not padded with city-wide stock.
//
// Privacy: seller names, phones, e-mails, profiles, descriptions and photos
// never leave this module. A phone survives only as a one-way hash, used for
// cross-platform duplicate detection.

import { createHash, randomUUID } from 'node:crypto';
import type { ExternalListingCandidate, MarketplaceSearchRequest, MarketplacePropertyType, MarketplaceTransaction } from '../marketplace/contract.js';
import { inGeorgia, placeNamesAt, type PlaceNames } from './placeNames.js';

export interface VerifyMarketProfile {
  /** Empty when only the parcel centre is known: the worker names it (placeNames.ts). */
  city: string;
  district: string | null;
  /** More names of the same place, tried after `district` (never the whole city). */
  districtAlternates?: string[];
  /** The parcel centre, when known: names the city and district when the caller could not. */
  latitude?: number | null;
  longitude?: number | null;
  transactionType: MarketplaceTransaction;
  propertyType: MarketplacePropertyType;
  /*
   * A kind the portals file inside commercial adverts (owner 2026-10-24: every
   * property type is searched). PARKING/STORAGE keep only the adverts that name
   * them; OFFICE prefers office adverts when there are enough of them.
   */
  subKind?: SubKind;
  areaSqm: number | null;
  rooms: number | null;
  /** The subject's own asking price, when known (USD). Only widens/centres the window. */
  priceUsd: number | null;
}

export type SubKind = 'PARKING' | 'STORAGE' | 'OFFICE';
const SUBKIND_TEXT: Record<SubKind, RegExp> = {
  PARKING: /ავტოსადგომ|პარკინგ|ავტოფარეხ|გარაჟ|parking|garage|паркинг|машино-?мест|гараж/iu,
  STORAGE: /სათავს|სამარაგ|storage|кладов/iu,
  OFFICE: /ოფის|საოფისე|office|офис/iu,
};
/** Below this many office adverts the search keeps every commercial advert of the district. */
export const MIN_OFFICE_ADVERTS = 3;

/** Whether a portal advert names the kind (title and description). */
export function advertNames(kind: SubKind, l: any): boolean {
  return SUBKIND_TEXT[kind].test(`${l?.title ?? ''} ${l?.description ?? ''} ${l?.retrievalMetadata?.title ?? ''}`);
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
  attempts: Array<{ scope: 'DISTRICT' | 'CITY'; district?: string | null; discovered: number; returned: number; status: string; error: string | null; durationMs: number }>;
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
  /** How the place was named when the caller sent only the parcel centre. */
  place?: PlaceNames | null;
}

export type Acquirer = (request: MarketplaceSearchRequest, options: { deadlineAt: string; signal?: AbortSignal; report: (result: any) => Promise<void>; pageCap: number }) => Promise<unknown>;

/*
 * VERIFY READS AT MOST TWO RESULT PAGES PER PORTAL (audit C2, 2026-10-22).
 *
 * Passed explicitly on every Verify call, never by changing a shared default:
 * Find Property keeps SS.ge's own cap (SSGE_PAGE_CAP = 3) and MyHome's
 * MYHOME_MAX_PAGES. Depth comes from the narrower, register-defined query,
 * not from more pages.
 *
 * COUPLING RISK (audit C1, documented, not changed in this phase): Verify's
 * MyHome search still runs inside Find Property's MyHome runtime — the same
 * MAX_ACTIVE = 1 slot and the same Cloudflare cooldown — and Verify's SS.ge
 * call does not take the SS.ge runtime's active slot. A challenge raised by a
 * Verify search can therefore cool MyHome down for Find Property, and a long
 * Find Property run can make Verify's MyHome attempt fail with MYHOME_BUSY.
 */
export const VERIFY_MARKET_PAGE_CAP = 2;

export interface VerifyMarketDeps {
  acquireMyHome: Acquirer;
  acquireSsge: Acquirer;
  maxPerSource?: number;
  sourceBudgetMs?: number;
  /** Unused since F6 (no city widening); accepted so older callers still type-check. */
  minLocalSample?: number;
  now?: () => number;
  /** Parcel centre → names (tests inject it). */
  placeNames?: (lat: number, lon: number) => Promise<PlaceNames | null>;
  /** Writes the run where every replica can read it (verify-queue market_put); never fails the run. */
  persist?: (job: VerifyMarketJob) => Promise<void>;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

/*
 * VERIFY-SIDE LOCALITY NAMES (2026-10-11, job 8ba97da9).
 *
 * The research seed names Tbilisi's ADMINISTRATIVE raion ("კრწანისი"), while
 * SS.ge indexes neighbourhoods: the .601 run's district-scoped SS.ge search
 * returned nothing, and its citywide fallback carried listings whose SS.ge
 * neighbourhood was "ორთაჭალა" (Krtsanisi St. itself sits in Ortachala). So
 * a raion is searched as itself first and then as the neighbourhoods the
 * portals use for it, each as its own DISTRICT attempt. Each name is still
 * resolved live by the unchanged MyHome / SS.ge adapters; an unknown name
 * fails that one attempt only.
 */
const LOCALITY_ALIASES: Array<{ match: RegExp; localities: string[] }> = [
  { match: /^(?:კრწანის(?:ი|ის)?|krtsanisi|krwanisi|крцаниси)(?:\s+(?:district|raioni|რაიონი|район))?$/iu, localities: ['ორთაჭალა'] },
];

/** The district names a Verify market search tries, in order, before widening to the city. */
export function districtCandidates(district: string | null): string[] {
  const d = typeof district === 'string' ? district.trim() : '';
  if (!d) return [];
  const out = [d];
  for (const a of LOCALITY_ALIASES) if (a.match.test(d)) for (const l of a.localities) if (!out.includes(l)) out.push(l);
  return out;
}

/**
 * The portal-side area window, as a share of the subject's area, per type.
 * Apartments keep the original ±25 %; plots, houses and commercial units vary
 * more and are narrowed again by research-agent's eligibility gate.
 */
export const AREA_WINDOW: Record<string, number> = { APARTMENT: 0.25, HOUSE: 0.35, COMMERCIAL: 0.4, LAND: 0.5 };

/** The comparable window. Area ±25 % (apartments), rooms ±1 (homes only), price ±60 % around a known ask. */
export function buildMarketplaceRequest(profile: VerifyMarketProfile, district: string | null, nowIso = new Date().toISOString()): MarketplaceSearchRequest {
  const area = profile.areaSqm && profile.areaSqm > 5 ? profile.areaSqm : null;
  const window = AREA_WINDOW[profile.propertyType] ?? 0.25;
  const homes = profile.propertyType === 'APARTMENT' || profile.propertyType === 'HOUSE';
  const rooms = homes && profile.rooms && profile.rooms > 0 ? Math.round(profile.rooms) : null;
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
    areaMinSqm: area ? Math.floor(area * (1 - window)) : null,
    areaMaxSqm: area ? Math.ceil(area * (1 + window)) : null,
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
  const cap = deps.maxPerSource ?? 300;
  const out = new Map<string, VerifyComparable>();
  /*
   * NO CITY-WIDE WIDENING (F6, job 61c1c38c). A thin or unknown district used
   * to fall back to the whole city, and those adverts became a plot's
   * "comparables". Only the subject's own locality names are searched; a
   * profile without a district is not searched at all.
   */
  const names: string[] = [];
  for (const d of [profile.district, ...(profile.districtAlternates ?? [])]) for (const n of districtCandidates(d ?? null)) if (!names.includes(n)) names.push(n);
  const scopes: Array<{ scope: 'DISTRICT' | 'CITY'; district: string | null }> =
    (profile.city ? names : []).map((district) => ({ scope: 'DISTRICT' as const, district }));
  run.status = 'RUNNING';
  if (!scopes.length) run.attempts.push({ scope: 'DISTRICT', district: null, discovered: 0, returned: 0, status: 'SKIPPED', error: 'NO_DISTRICT', durationMs: 0 });
  const runStarted = now();
  const total = deps.sourceBudgetMs ?? 300_000;
  for (const { scope, district } of scopes) {
    // Every local name is searched (Krtsanisi St. listings sit under both
    // კრწანისი and ორთაჭალა).
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
        pageCap: VERIFY_MARKET_PAGE_CAP,
        report: async (result: any) => {
          discovered = Math.max(discovered, Number(result?.discoveredCount) || 0);
          if (result?.errors?.length && !error) error = String(result.errors[0]?.code ?? 'SOURCE_ERROR');
          if (result?.status && result.status !== 'RESULTS_RECEIVED') status = result.status;
          // SS.ge reads the whole city when it cannot resolve a district name
          // (queryApplied.districtFallback). Those adverts are not local, and
          // are labelled CITY so they can never pass as the subject's district.
          const unresolved = !!result?.queryApplied?.districtFallback;
          if (unresolved && !error) error = 'DISTRICT_UNRESOLVED';
          for (const l of result?.listings ?? []) {
            const sub = profile.subKind;
            // A parking space or storage room: only the commercial adverts that name it.
            if ((sub === 'PARKING' || sub === 'STORAGE') && !advertNames(sub, l)) continue;
            const v = toVerifyComparable(source, l, unresolved ? 'CITY' : scope);
            if (v && sub && sub !== 'OFFICE') v.propertyType = sub;
            if (v && sub === 'OFFICE' && advertNames('OFFICE', l)) (v as VerifyComparable & { office?: boolean }).office = true;
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
    run.attempts.push({ scope, district, discovered, returned: out.size, status, error, durationMs: now() - started });
    if (out.size >= cap) break;
  }
  let kept = [...out.values()];
  // An office prefers office adverts, when the district has enough of them.
  if (profile.subKind === 'OFFICE') {
    const offices = kept.filter((v) => (v as VerifyComparable & { office?: boolean }).office);
    if (offices.length >= MIN_OFFICE_ADVERTS) kept = offices;
  }
  const comparables = kept.slice(0, cap);
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
    void this.persist(job);
    void this.execute(job, sources);
    return job;
  }

  async execute(job: VerifyMarketJob, sources: SourceKey[]): Promise<void> {
    /* No district name from the caller: the parcel centre names the city and its localities. */
    const p = job.profile;
    if ((!p.district || !p.city) && inGeorgia(p.latitude, p.longitude)) {
      const place = await (this.deps.placeNames ?? placeNamesAt)(p.latitude as number, p.longitude as number).catch(() => null);
      job.place = place;
      if (place) {
        const localities = [...(p.district ? [p.district] : []), ...place.localities];
        job.profile = { ...p, city: p.city || place.city || '', district: localities[0] ?? null, districtAlternates: [...(p.districtAlternates ?? []), ...localities.slice(1)] };
      }
    }
    const tasks: Promise<VerifyComparable[]>[] = [];
    if (sources.includes('MYHOME')) tasks.push(runSource('MYHOME', this.deps.acquireMyHome, job.profile, job.sources.MYHOME, this.deps).catch(() => []));
    if (sources.includes('SSGE')) tasks.push(runSource('SSGE', this.deps.acquireSsge, job.profile, job.sources.SSGE, this.deps).catch(() => []));
    const results = await Promise.all(tasks);
    job.comparables = results.flat();
    job.status = 'COMPLETE';
    job.completedAt = new Date().toISOString();
    await this.persist(job);
  }

  private async persist(job: VerifyMarketJob): Promise<void> {
    try {
      await this.deps.persist?.(job);
    } catch (e) {
      console.error(JSON.stringify({ level: 'warn', scope: 'verify_market', event: 'persist_failed', id: job.id, error: String((e as Error)?.message ?? e).slice(0, 160) }));
    }
  }

  get(id: string): VerifyMarketJob | null {
    return this.jobs.get(id) ?? null;
  }
}

const TX: MarketplaceTransaction[] = ['BUY', 'MONTHLY_RENT', 'DAILY_RENT'];
const PT: Array<MarketplacePropertyType | SubKind> = ['APARTMENT', 'HOUSE', 'PENTHOUSE', 'LAND', 'COMMERCIAL', 'OFFICE', 'VILLA', 'TOWNHOUSE', 'STUDIO', 'OTHER', 'PARKING', 'STORAGE'];

/** Validate an untrusted HTTP body into a profile, or null. */
export function parseVerifyMarketProfile(body: any): VerifyMarketProfile | null {
  const city = typeof body?.city === 'string' ? body.city.trim().slice(0, 80) : '';
  const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const latitude = num(body?.latitude);
  const longitude = num(body?.longitude);
  // A city, or a parcel centre in Georgia that names one.
  if (!city && !inGeorgia(latitude, longitude)) return null;
  const alternates = Array.isArray(body?.districtAlternates)
    ? body.districtAlternates.filter((d: unknown) => typeof d === 'string' && d.trim()).map((d: string) => d.trim().slice(0, 80)).slice(0, 6)
    : [];
  const tx = TX.includes(body?.transactionType) ? body.transactionType : 'BUY';
  const raw = PT.includes(body?.propertyType) ? body.propertyType : 'APARTMENT';
  // Both adapters support APARTMENT/HOUSE/LAND/COMMERCIAL; map the rest honestly.
  // Parking, storage and offices are read from the commercial segment (subKind).
  const subKind: SubKind | undefined = raw === 'PARKING' || raw === 'STORAGE' || raw === 'OFFICE' ? raw : body?.subKind === 'OFFICE' ? 'OFFICE' : undefined;
  const propertyType: MarketplacePropertyType = raw === 'PENTHOUSE' || raw === 'STUDIO' ? 'APARTMENT' : raw === 'VILLA' || raw === 'TOWNHOUSE' ? 'HOUSE' : subKind ? 'COMMERCIAL' : raw === 'OTHER' ? 'APARTMENT' : raw;
  return {
    city,
    district: typeof body?.district === 'string' && body.district.trim() ? body.district.trim().slice(0, 80) : null,
    transactionType: tx,
    propertyType,
    areaSqm: num(body?.areaSqm),
    rooms: num(body?.rooms),
    priceUsd: num(body?.priceUsd),
    ...(alternates.length ? { districtAlternates: alternates } : {}),
    ...(subKind ? { subKind } : {}),
    ...(inGeorgia(latitude, longitude) ? { latitude, longitude } : {}),
  };
}
