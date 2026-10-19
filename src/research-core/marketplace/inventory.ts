/**
 * HOMATCH PROPERTY INVENTORY (owner, 2026-10-19) — one row per listing, every portal.
 *
 * WHERE THINGS LIVE
 *
 *   supply_observations   the unified, indexed inventory: one row per (source, listing id),
 *                         with the freshness contract it was built with (first_seen_at,
 *                         last_seen_at, last_verified_at, content_changed_at, expires_at,
 *                         validation_state). Marketplace rows carry ingest_channel =
 *                         'MARKETPLACE'.
 *   discovery_marketplace_listings
 *                         what each SEARCH received (raw candidate per search); the shared
 *                         pool customer searches are answered from (marketplaceSearch.ts).
 *   R2 property-inventory/  heavy material only: a compressed snapshot of a listing each
 *                         time its content changes, and the Home.ge / Allhome worker
 *                         index snapshots. Registered in storage_objects; never queried
 *                         by a search.
 *
 * WHAT IS NEVER DONE HERE
 *
 *   A sighting is not a verification: last_verified_at stays null and validation_state
 *   UNVERIFIED until revalidate-supply actually re-reads the page. A missing fact stays
 *   null. Third-party photos are referenced by URL (image_urls), never copied to R2.
 *   A seller's phone or e-mail never goes into a snapshot, a key or a column here.
 */
import type { ExternalListingCandidate } from './worker-contract.ts';

export const INVENTORY_POLICY = {
  /** How long one sighting may be delivered on before it is due for a re-check (supply-revalidation.ts intervals). */
  SALE_WINDOW_DAYS: 7,
  RENT_WINDOW_DAYS: 3,
  /** Observed this recently by a worker: RECENTLY_OBSERVED (the shared pool's own window). */
  RECENT_HOURS: 72,
  MAX_DESCRIPTION: 8000,
  MAX_IMAGES: 20,
  MAX_AMENITIES: 40,
} as const;

/** Marketplace source keys are the registry adapter ids (source_registry.adapter_id). */
export const INVENTORY_SOURCES = ['myhome-ge', 'ss-ge', 'home-ge', 'place-ge', 'allhome-ge', 'brokeri-ge'] as const;

/** Sources whose listings no portal reader in research-core can re-read; re-observed by their worker only. */
export const WORKER_ONLY_SOURCES = new Set(['myhome-ge', 'allhome-ge', 'brokeri-ge']);

const TRANSACTION: Record<string, 'SALE' | 'RENT' | 'SHORT_STAY'> = { BUY: 'SALE', MONTHLY_RENT: 'RENT', DAILY_RENT: 'SHORT_STAY' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/* A count, floor or year: anything outside a plausible range is a parse error, not a fact (and would overflow int4). */
const int = (v: unknown): number | null => { const n = num(v); return n === null || Math.abs(n) > 3000 ? null : Math.round(n); };
const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const iso = (v: unknown): string | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const coordinate = (v: unknown, limit: number): number | null => { const n = num(v); return n !== null && Math.abs(n) <= limit && n !== 0 ? n : null; };

/** The listing's own facts, in a fixed order: what "the content changed" means for the inventory. */
export function inventoryFingerprintInput(c: ExternalListingCandidate): string {
  return JSON.stringify([
    c.transactionType ?? null, c.propertyType ?? null, num(c.price), text(c.currency, 8), num(c.areaSqm), int(c.rooms), int(c.bedrooms),
    int(c.floor), int(c.totalFloors), text(c.city), text(c.district), c.buildingStatus ?? null, c.renovationStatus ?? null,
    text(c.title), text(c.description, INVENTORY_POLICY.MAX_DESCRIPTION),
  ]);
}

export async function sha256Hex(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface InventoryRow {
  external_id: string; canonical_url: string; transaction: string | null; property_type: string | null;
  country_code: string; city: string | null; district: string | null;
  sale_amount: number | null; sale_currency: string | null; rent_amount: number | null; rent_currency: string | null; rent_period: string | null;
  area_sqm: number | null; rooms: number | null; bedrooms: number | null; floor: number | null; total_floors: number | null; year_built: number | null;
  title: string | null; description: string | null; published_at: string | null; observed_at: string; expires_at: string;
  content_fingerprint: string; image_urls: string[]; amenities: string[]; latitude: number | null; longitude: number | null;
  building_status: string | null; renovation_status: string | null; parser_version: string; adapter_version: string | null;
}

/** One candidate → one inventory row. Never invents: an absent fact is null. */
export async function inventoryRow(c: ExternalListingCandidate): Promise<InventoryRow> {
  const transaction = c.transactionType ? TRANSACTION[c.transactionType] ?? null : null;
  const price = num(c.price), currency = text(c.currency, 8);
  const observed = iso(c.observedAt) ?? new Date().toISOString();
  const windowDays = transaction === 'SALE' ? INVENTORY_POLICY.SALE_WINDOW_DAYS : INVENTORY_POLICY.RENT_WINDOW_DAYS;
  const country = text(c.country, 2)?.toUpperCase();
  return {
    external_id: c.sourceListingId,
    canonical_url: c.canonicalUrl ?? c.exactUrl,
    transaction, property_type: c.propertyType ?? null,
    country_code: country && /^[A-Z]{2}$/.test(country) ? country : 'GE',
    city: text(c.city, 120), district: text(c.district, 160),
    sale_amount: transaction === 'SALE' ? price : null, sale_currency: transaction === 'SALE' && price !== null ? currency : null,
    rent_amount: transaction && transaction !== 'SALE' ? price : null,
    rent_currency: transaction && transaction !== 'SALE' && price !== null ? currency : null,
    rent_period: transaction === 'RENT' ? 'MONTH' : transaction === 'SHORT_STAY' ? 'DAY' : null,
    area_sqm: num(c.areaSqm), rooms: int(c.rooms), bedrooms: int(c.bedrooms), floor: int(c.floor), total_floors: int(c.totalFloors),
    year_built: int(c.constructionYear),
    title: text(c.title, 500), description: text(c.description, INVENTORY_POLICY.MAX_DESCRIPTION),
    published_at: iso(c.publishedAt), observed_at: observed,
    expires_at: new Date(Date.parse(observed) + windowDays * 86_400_000).toISOString(),
    content_fingerprint: await sha256Hex(inventoryFingerprintInput(c)),
    image_urls: (c.images ?? []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, INVENTORY_POLICY.MAX_IMAGES),
    amenities: (c.amenities ?? []).filter((a) => typeof a === 'string').slice(0, INVENTORY_POLICY.MAX_AMENITIES),
    latitude: coordinate(c.latitude, 90), longitude: coordinate(c.longitude, 180),
    building_status: c.buildingStatus ?? null, renovation_status: c.renovationStatus ?? null,
    parser_version: 'marketplace-worker-1',
    adapter_version: text(c.retrievalMetadata?.acquisition, 80),
  };
}

/** What a snapshot keeps: the candidate without a seller's direct contact details. */
export function snapshotOf(c: ExternalListingCandidate): ExternalListingCandidate {
  return { ...c, seller: { ...c.seller, publicPhone: null, publicEmail: null } };
}

/** Lower-case, [a-z0-9-] only: a provider or listing id is never trusted as a path segment. */
export const keySegment = (value: string, max = 64) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'unknown';
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * R2 keys, one convention for every provider:
 *   property-inventory/<provider>/<country>/<yyyy>/<mm>/<listing-id>/snapshot-<yyyymmddThhmmssZ>-<sha8>.json.gz
 *   property-inventory/<provider>/<country>/portal-index/index-<yyyymmddThhmmssZ>-<sha8>.json.gz
 * The month is the listing's first sighting in the inventory, so a listing's history stays in one folder.
 */
export function listingSnapshotKey(provider: string, country: string, listingId: string, firstSeen: Date, at: Date, sha: string): string {
  const y = String(firstSeen.getUTCFullYear()), m = String(firstSeen.getUTCMonth() + 1).padStart(2, '0');
  return `property-inventory/${keySegment(provider)}/${keySegment(country, 2)}/${y}/${m}/${keySegment(listingId, 80)}/snapshot-${stamp(at)}-${sha.slice(0, 8)}.json.gz`;
}
export function portalIndexKey(provider: string, country: string, at: Date, sha: string): string {
  return `property-inventory/${keySegment(provider)}/${keySegment(country, 2)}/portal-index/index-${stamp(at)}-${sha.slice(0, 8)}.json.gz`;
}
export const INDEX_KEY_PATTERN = /^property-inventory\/[a-z0-9-]+\/[a-z]{2}\/portal-index\/index-\d{8}T\d{6}Z-[0-9a-f]{8}\.json\.gz$/;

export type InventoryFreshness = 'VERIFIED_ACTIVE' | 'RECENTLY_OBSERVED' | 'STALE' | 'UNVERIFIED' | 'UNAVAILABLE' | 'REMOVED';

/**
 * The customer- and admin-facing state of one inventory row. A worker sighting is
 * RECENTLY_OBSERVED, never VERIFIED_ACTIVE; a failed re-check is UNAVAILABLE, never
 * REMOVED (only a conclusive check removes); an old sighting is STALE.
 */
export function inventoryFreshness(row: {
  validation_state?: string | null; last_verified_at?: string | null; last_seen_at?: string | null;
  transaction?: string | null; failed_checks?: number | null;
}, now = Date.now()): InventoryFreshness {
  if (row.validation_state === 'REMOVED') return 'REMOVED';
  const seen = Date.parse(row.last_seen_at ?? '');
  const recent = Number.isFinite(seen) && now - seen <= INVENTORY_POLICY.RECENT_HOURS * 3_600_000;
  /* A failed re-check is overtaken by a worker that has seen the listing since. */
  if (row.validation_state === 'INVALID' || row.validation_state === 'UNVERIFIABLE') return recent ? 'RECENTLY_OBSERVED' : 'UNAVAILABLE';
  const verified = Date.parse(row.last_verified_at ?? '');
  const window = (row.transaction === 'SALE' ? INVENTORY_POLICY.SALE_WINDOW_DAYS : INVENTORY_POLICY.RENT_WINDOW_DAYS) * 86_400_000;
  if (row.validation_state === 'VALID' && Number.isFinite(verified) && now - verified <= window) return 'VERIFIED_ACTIVE';
  if (!Number.isFinite(seen)) return 'UNVERIFIED';
  return recent ? 'RECENTLY_OBSERVED' : 'STALE';
}
