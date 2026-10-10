// HOMATCH Verify — MyHome.ge + SS.ge comparables, folded into the market lane.
//
// The official worker's /verify/market route runs the SAME acquisition
// adapters Find Property uses and returns privacy-stripped listings. This
// module turns them into the report's own ReportComparable shape, removes
// duplicates — across the two platforms AND against what the existing
// portal lane already found — and keeps an internal ledger for Admin.
//
// Rules carried through unchanged from the lane:
//   - an asking price is not a sale price (listingStatus ACTIVE means "on
//     the market when read", never "sold at");
//   - nothing is invented: no listing, count, price or date that the source
//     did not state;
//   - URLs are internal provenance; the customer report never renders them.
//
// Pure: no clock (callers pass `nowIso`), no network.

import type { ReportComparable } from './marketLane.ts';

export type MarketplaceSource = 'MYHOME' | 'SSGE';

/** Mirrors official-worker/src/verify/VerifyMarketRuntime.ts VerifyComparable. */
export interface WorkerComparable {
  source: MarketplaceSource;
  sourceListingId: string;
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

export interface MarketProfileRequest {
  city: string;
  district: string | null;
  transactionType: 'BUY' | 'MONTHLY_RENT';
  propertyType: 'APARTMENT' | 'HOUSE' | 'COMMERCIAL' | 'LAND';
  areaSqm: number | null;
  rooms: number | null;
  priceUsd: number | null;
}

interface SeedLike {
  location?: { city?: { value?: unknown } | null; district?: { value?: unknown } | null; subDistrict?: { value?: unknown } | null };
  property?: { propertyType?: { value?: unknown } | null; areaSqm?: { value?: unknown } | null; rooms?: { value?: unknown } | null; transaction?: string };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The comparable-search profile, from what is verified or clearly identified.
 * Returns null when there is no city: a market search without a place is not
 * a comparable search and is not run.
 */
export function marketProfileFromSeed(seed: SeedLike, subjectPriceUsd: number | null = null): MarketProfileRequest | null {
  const city = txt(seed?.location?.city?.value) ?? null;
  if (!city) return null;
  const rawType = String(seed?.property?.propertyType?.value ?? '').toUpperCase();
  const propertyType: MarketProfileRequest['propertyType'] = /HOUSE|VILLA|TOWNHOUSE|სახლ/.test(rawType)
    ? 'HOUSE'
    : /COMMERCIAL|OFFICE|კომერც/.test(rawType)
      ? 'COMMERCIAL'
      : /LAND|მიწ/.test(rawType)
        ? 'LAND'
        : 'APARTMENT';
  return {
    city,
    district: txt(seed?.location?.subDistrict?.value) ?? txt(seed?.location?.district?.value),
    transactionType: seed?.property?.transaction === 'RENT' ? 'MONTHLY_RENT' : 'BUY',
    propertyType,
    areaSqm: num(seed?.property?.areaSqm?.value),
    rooms: num(seed?.property?.rooms?.value),
    priceUsd: subjectPriceUsd && subjectPriceUsd > 0 ? subjectPriceUsd : null,
  };
}

const metres = (a: WorkerComparable, b: WorkerComparable): number | null => {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const close = (a: number | null, b: number | null, tol: number): boolean => a != null && b != null && Math.abs(a - b) <= tol * Math.max(a, b);

/**
 * Whether two adverts describe the same physical apartment.
 *
 * Strong signals (any one, with a size check): the same seller phone, a
 * shared photo hash, or the same coordinates. Similar-looking flats in the
 * same building are NOT merged without one of these — a building with ten
 * identical layouts is ten apartments.
 */
export function sameApartment(a: WorkerComparable, b: WorkerComparable): boolean {
  if (a.source === b.source && a.sourceListingId === b.sourceListingId) return true;
  const sizeOk = close(a.areaSqm, b.areaSqm, 0.03);
  if (!sizeOk) return false;
  const floorOk = a.floor == null || b.floor == null || a.floor === b.floor;
  if (!floorOk) return false;
  const priceOk = a.price == null || b.price == null || a.currency !== b.currency || close(a.price, b.price, 0.3);
  if (!priceOk) return false;
  if (a.phoneHash && a.phoneHash === b.phoneHash) return true;
  if (a.imageHashes.some((h) => h && b.imageHashes.includes(h))) return true;
  const d = metres(a, b);
  if (d != null && d <= 30 && (a.rooms == null || b.rooms == null || a.rooms === b.rooms) && a.floor != null && a.floor === b.floor) return true;
  return false;
}

export interface DedupeResult {
  unique: Array<WorkerComparable & { alsoListedAt: Array<{ source: MarketplaceSource; listingId: string; url: string; price: number | null }> }>;
  crossPlatformDuplicates: number;
  sameSourceDuplicates: number;
}

export function dedupeMarketplace(list: WorkerComparable[]): DedupeResult {
  const groups: WorkerComparable[][] = [];
  let sameSource = 0;
  let cross = 0;
  for (const c of list) {
    const g = groups.find((grp) => grp.some((x) => sameApartment(x, c)));
    if (!g) {
      groups.push([c]);
      continue;
    }
    if (g.some((x) => x.source === c.source && x.sourceListingId === c.sourceListingId)) {
      sameSource++;
      continue;
    }
    if (g.some((x) => x.source !== c.source)) cross++;
    else sameSource++;
    g.push(c);
  }
  const fresher = (x: WorkerComparable) => Date.parse(x.updatedAt ?? x.publishedAt ?? '') || 0;
  const unique = groups.map((g) => {
    const sorted = g.slice().sort((a, b) => fresher(b) - fresher(a) || (b.pricePerSqm ? 1 : 0) - (a.pricePerSqm ? 1 : 0));
    const [primary, ...rest] = sorted;
    return { ...primary, alsoListedAt: rest.map((r) => ({ source: r.source, listingId: r.sourceListingId, url: r.exactUrl, price: r.price })) };
  });
  return { unique, crossPlatformDuplicates: cross, sameSourceDuplicates: sameSource };
}

const fam = (s: MarketplaceSource) => (s === 'MYHOME' ? 'myhome.ge' : 'ss.ge');

/** The subject the tiering compares against. */
export interface MarketSubject {
  project: string | null;
  latitude: number | null;
  longitude: number | null;
  district: string | null;
}

/*
 * WHERE A MARKETPLACE ADVERT SITS RELATIVE TO THE SUBJECT.
 *
 * There is no fallback to PEER_PROJECT any more (2026-10-10, job 220ed087):
 * that "conservative label for broader market context" is exactly how 39
 * citywide adverts became the peer basis of a Krtsanisi valuation. An advert
 * is SAME_PROJECT by name, MICRO_LOCATION only when MEASURED within 600 m
 * (the distance travels with it), SAME_DISTRICT when the worker searched the
 * subject's district, and otherwise WIDER_MARKET. Whether a nearby named
 * development is a genuine peer is decided later, in marketIntelligence,
 * where the segment is known.
 */
function tier(c: WorkerComparable, subject: MarketSubject): { type: ReportComparable['comparableType']; distanceM: number | null } {
  const project = subject.project?.toLowerCase().trim();
  if (project && project.length >= 3 && `${c.title ?? ''} ${c.address ?? ''}`.toLowerCase().includes(project)) return { type: 'SAME_PROJECT', distanceM: null };
  let distanceM: number | null = null;
  if (subject.latitude != null && subject.longitude != null && c.latitude != null && c.longitude != null) {
    const d = metres({ ...c, latitude: subject.latitude, longitude: subject.longitude }, c);
    if (d != null) distanceM = Math.round(d);
    if (d != null && d <= 600) return { type: 'MICRO_LOCATION', distanceM };
  }
  if (c.scope === 'DISTRICT') return { type: 'SAME_DISTRICT', distanceM };
  return { type: 'WIDER_MARKET', distanceM };
}

const residential = (t: string | null): ReportComparable['propertyType'] =>
  t === 'APARTMENT' || t === 'HOUSE' ? 'RESIDENTIAL' : t === 'COMMERCIAL' ? 'COMMERCIAL' : t === 'LAND' ? 'LAND' : null;
const n2 = (v: number | null | undefined): string | null => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : null);

const CONDITION: Record<string, string> = {
  RENOVATED: 'renovated', GREEN_FRAME: 'green frame', WHITE_FRAME: 'white frame', BLACK_FRAME: 'black frame', NEEDS_RENOVATION: 'needs renovation',
};

export function toReportComparable(c: DedupeResult['unique'][number], subject: MarketSubject): ReportComparable & { marketplaceSource: MarketplaceSource } {
  const ppsm = c.pricePerSqm ?? (c.price && c.areaSqm ? c.price / c.areaSqm : null);
  const placed = tier(c, subject);
  return {
    source: fam(c.source),
    url: c.exactUrl,
    listingId: c.sourceListingId,
    project: null,
    // District first so the scorer can recognise a shared district as a place.
    address: [c.address, c.district, c.city].filter(Boolean).join(', ') || null,
    area: n2(c.areaSqm),
    rooms: n2(c.rooms),
    floor: n2(c.floor),
    condition: c.renovationStatus ? (CONDITION[c.renovationStatus] ?? c.renovationStatus.toLowerCase()) : null,
    // A live search of currently-published adverts: on the market when read.
    listingStatus: 'ACTIVE',
    propertyType: residential(c.propertyType),
    price: c.price != null ? String(Math.round(c.price)) : null,
    currency: c.currency,
    pricePerSqm: n2(ppsm),
    listingDate: c.updatedAt ?? c.publishedAt ?? null,
    similarity: c.scope === 'DISTRICT' ? 'same district, similar size and rooms' : 'same city, similar size and rooms',
    retrievedAt: c.observedAt,
    comparableType: placed.type,
    // The neighbourhood the portal stated and, when both sides had
    // coordinates, the measured distance — so tiering downstream can test
    // location instead of trusting a label.
    district: c.district ?? null,
    distanceM: placed.distanceM,
    discoveryMethod: 'MARKETPLACE_WORKER_SEARCH',
    marketplaceSource: c.source,
    ...(c.alsoListedAt.length
      ? { alsoListedAt: c.alsoListedAt.map((a) => ({ url: a.url, source: fam(a.source), price: a.price != null ? String(Math.round(a.price)) : null })) }
      : {}),
  };
}

/** The listing id an ss.ge / myhome.ge URL carries, for matching lane adverts. */
export function listingKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).toLowerCase();
  const ss = /ss\.ge\/.*?(\d{6,})/.exec(u);
  if (ss) return `ss.ge:${ss[1]}`;
  const mh = /myhome\.ge\/.*?(\d{6,})/.exec(u);
  if (mh) return `myhome.ge:${mh[1]}`;
  return null;
}

export interface MarketplaceLedger {
  searchesPerformed: number;
  myhome: { status: string; listings: number; discovered: number };
  ssge: { status: string; listings: number; discovered: number };
  crossPlatformDuplicatesRemoved: number;
  sameSourceDuplicatesRemoved: number;
  alreadyInLane: number;
  added: number;
  finalComparableCount: number;
  medianListingAgeDays: number | null;
  scopes: { district: number; city: number };
}

interface WorkerJobLike {
  status?: string;
  sources?: Record<string, { status?: string; listings?: number; attempts?: Array<{ discovered?: number }> }>;
  comparables?: WorkerComparable[];
}

/**
 * Fold a finished worker job into the lane's comparables. Lane adverts win a
 * tie (they were found first and already carry their own provenance); a
 * marketplace advert for the same listing is not counted twice.
 */
export function foldMarketplaceIntoLane(
  lane: ReportComparable[],
  job: WorkerJobLike,
  subject: MarketSubject,
  nowIso: string,
): { comparables: ReportComparable[]; ledger: MarketplaceLedger } {
  const list = Array.isArray(job?.comparables) ? job.comparables.filter((c) => c && c.sourceListingId) : [];
  const d = dedupeMarketplace(list);
  const laneKeys = new Set(lane.map((c) => listingKeyFromUrl(c.url)).filter(Boolean) as string[]);
  const laneUrls = new Set(lane.map((c) => String(c.url ?? '').trim()).filter(Boolean));
  let alreadyInLane = 0;
  const added: ReportComparable[] = [];
  for (const u of d.unique) {
    const key = `${fam(u.source)}:${u.sourceListingId}`;
    if (laneUrls.has(u.exactUrl) || laneKeys.has(key) || u.alsoListedAt.some((a) => laneKeys.has(`${fam(a.source)}:${a.listingId}`))) {
      alreadyInLane++;
      continue;
    }
    added.push(toReportComparable(u, subject));
  }
  const now = Date.parse(nowIso);
  const ages = d.unique
    .map((u) => Date.parse(u.updatedAt ?? u.publishedAt ?? ''))
    .filter((t) => Number.isFinite(t) && t <= now)
    .map((t) => (now - t) / 864e5)
    .sort((a, b) => a - b);
  const src = (k: string) => job?.sources?.[k] ?? {};
  const disc = (k: string) => (src(k).attempts ?? []).reduce((m, a) => Math.max(m, Number(a?.discovered) || 0), 0);
  const ledger: MarketplaceLedger = {
    searchesPerformed: ['MYHOME', 'SSGE'].reduce((s, k) => s + (src(k).attempts?.length ?? 0), 0),
    myhome: { status: String(src('MYHOME').status ?? 'NOT_RUN'), listings: Number(src('MYHOME').listings ?? 0), discovered: disc('MYHOME') },
    ssge: { status: String(src('SSGE').status ?? 'NOT_RUN'), listings: Number(src('SSGE').listings ?? 0), discovered: disc('SSGE') },
    crossPlatformDuplicatesRemoved: d.crossPlatformDuplicates,
    sameSourceDuplicatesRemoved: d.sameSourceDuplicates,
    alreadyInLane,
    added: added.length,
    finalComparableCount: lane.length + added.length,
    medianListingAgeDays: ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null,
    scopes: { district: d.unique.filter((u) => u.scope === 'DISTRICT').length, city: d.unique.filter((u) => u.scope === 'CITY').length },
  };
  return { comparables: [...lane, ...added], ledger };
}
