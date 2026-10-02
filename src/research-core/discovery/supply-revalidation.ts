// PHASE 2 — re-checking external listings HOMATCH already found.
//
// A listing must not be recommended forever: it sells, it is withdrawn, its
// price moves. This is the pure half of supply revalidation (revalidate-supply
// is the I/O half): when a row is due, how it may be checked, and what a
// re-read means -- compared FIELD BY FIELD through the same adapter extraction
// that first read it, never by hashing the whole page (a page's ads, counters
// and timestamps change on every load, which made every check look like a
// change and overwrote the listing's own text fingerprint).
//
// NO AGGRESSIVE SCHEDULE. Nothing here runs by itself; revalidate-supply has
// no cron. SUPPLY_REVALIDATION_POLICY states the intended cadence for when the
// owner switches it on.

export const SUPPLY_REVALIDATION_POLICY = {
  /** Rentals turn over fastest. */
  RENT_INTERVAL_DAYS: 3,
  SALE_INTERVAL_DAYS: 7,
  /** At most this many re-reads per invocation (one portal request each). */
  MAX_PER_RUN: 25,
  /** A price move at or above this share is a MATERIAL change (customer-visible). */
  MATERIAL_PRICE_SHARE: 0.03,
  /** Area within this share is the same flat re-measured, not a change. */
  AREA_TOLERANCE: 0.03,
} as const;

export type RevalidationMethod = 'PORTAL_REFETCH' | 'NOT_REVALIDATABLE';

export interface RevalidationRow {
  adapter_id?: string | null;
  canonical_url?: string | null;
  transaction?: string | null;
  last_verified_at?: string | null;
  first_seen_at?: string | null;
  validation_state?: string | null;
}

/** How a row can be re-checked. Community posts need the worker's Telegram/forum reader, not a portal fetch. */
export function revalidationMethod(row: RevalidationRow): { method: RevalidationMethod; reason: string } {
  const adapter = String(row.adapter_id ?? '');
  if (!row.canonical_url) return { method: 'NOT_REVALIDATABLE', reason: 'no URL' };
  if (adapter.endsWith('-community')) {
    return { method: 'NOT_REVALIDATABLE', reason: 'community post: deletion is visible only to the channel reader (worker), not a portal fetch' };
  }
  if (row.validation_state === 'REMOVED') return { method: 'NOT_REVALIDATABLE', reason: 'already recorded REMOVED' };
  return { method: 'PORTAL_REFETCH', reason: 'portal listing page' };
}

/** Due when the last verification (or first sighting) is older than the transaction's interval. */
export function revalidationDue(row: RevalidationRow, now = Date.now()): boolean {
  if (revalidationMethod(row).method !== 'PORTAL_REFETCH') return false;
  const last = Date.parse(row.last_verified_at ?? row.first_seen_at ?? '');
  if (!Number.isFinite(last)) return true;
  const days = row.transaction === 'RENT' ? SUPPLY_REVALIDATION_POLICY.RENT_INTERVAL_DAYS : SUPPLY_REVALIDATION_POLICY.SALE_INTERVAL_DAYS;
  return now - last >= days * 86_400_000;
}

export interface ListingSnapshot {
  price: number | null;
  currency: string | null;
  areaSqm: number | null;
  rooms: number | null;
}

export function snapshotOfRow(row: {
  transaction?: string | null; sale_amount?: number | string | null; sale_currency?: string | null;
  rent_amount?: number | string | null; rent_currency?: string | null; area_sqm?: number | string | null; rooms?: number | null;
}): ListingSnapshot {
  const rent = row.transaction === 'RENT';
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    price: n(rent ? row.rent_amount : row.sale_amount),
    currency: (rent ? row.rent_currency : row.sale_currency) ?? null,
    areaSqm: n(row.area_sqm),
    rooms: n(row.rooms),
  };
}

export function snapshotOfListing(listing: {
  sale?: { amount: number; currency: string } | null; rent?: { amount: number; currency: string } | null;
  area?: { value: number; unit: string } | null; rooms?: number | null;
}, transaction: string | null): ListingSnapshot {
  const money = transaction === 'RENT' ? listing.rent ?? null : listing.sale ?? null;
  return {
    price: money?.amount ?? null,
    currency: money?.currency ?? null,
    areaSqm: listing.area && listing.area.unit === 'sqm' ? listing.area.value : null,
    rooms: listing.rooms ?? null,
  };
}

export interface SnapshotComparison {
  material: boolean;
  changedFields: string[];
  priceChange: { from: number; to: number; share: number; currency: string } | null;
  /** 0..1: how much of the snapshot could be compared at all. */
  confidence: number;
}

/** Field-by-field: unknown on either side is neither a change nor a confirmation. */
export function compareSnapshots(before: ListingSnapshot, after: ListingSnapshot): SnapshotComparison {
  const changed: string[] = [];
  let compared = 0;
  let priceChange: SnapshotComparison['priceChange'] = null;
  if (before.price !== null && after.price !== null && before.currency && before.currency === after.currency) {
    compared++;
    const share = Math.abs(after.price - before.price) / Math.max(before.price, 1);
    if (share > 0) priceChange = { from: before.price, to: after.price, share: Math.round(share * 1000) / 1000, currency: before.currency };
    if (share >= SUPPLY_REVALIDATION_POLICY.MATERIAL_PRICE_SHARE) changed.push('price');
  }
  if (before.areaSqm !== null && after.areaSqm !== null) {
    compared++;
    if (Math.abs(after.areaSqm - before.areaSqm) / Math.max(before.areaSqm, 1) > SUPPLY_REVALIDATION_POLICY.AREA_TOLERANCE) changed.push('area');
  }
  if (before.rooms !== null && after.rooms !== null) {
    compared++;
    if (before.rooms !== after.rooms) changed.push('rooms');
  }
  return { material: changed.length > 0, changedFields: changed, priceChange, confidence: Math.round((compared / 3) * 100) / 100 };
}

export type RevalidationOutcome = 'UNCHANGED_VALID' | 'CHANGED_VALID' | 'REMOVED' | 'INACCESSIBLE' | 'UNKNOWN';

/**
 * Decide what one re-read means.
 *   404/410            REMOVED (sold/withdrawn) -- conclusive
 *   other 4xx/5xx      INACCESSIBLE -- not a verification
 *   2xx, re-extracted  UNCHANGED_VALID / CHANGED_VALID by field comparison
 *   2xx, unreadable    UNKNOWN -- the page answered but its own adapter could not
 *                      read it (a "this ad was removed" page, a redesign): not a
 *                      verification, never a guessed change
 */
export function judgeRevalidation(input: {
  status: number;
  before: ListingSnapshot;
  after: ListingSnapshot | null;
}): { outcome: RevalidationOutcome; conclusive: boolean; comparison: SnapshotComparison | null; confidence: number } {
  if (input.status === 404 || input.status === 410) return { outcome: 'REMOVED', conclusive: true, comparison: null, confidence: 0.95 };
  if (input.status >= 400 || input.status === 0) return { outcome: 'INACCESSIBLE', conclusive: false, comparison: null, confidence: 0 };
  if (!input.after) return { outcome: 'UNKNOWN', conclusive: false, comparison: null, confidence: 0.3 };
  const comparison = compareSnapshots(input.before, input.after);
  if (comparison.confidence === 0) return { outcome: 'UNKNOWN', conclusive: false, comparison, confidence: 0.3 };
  return {
    outcome: comparison.material ? 'CHANGED_VALID' : 'UNCHANGED_VALID',
    conclusive: true,
    comparison,
    confidence: Math.round((0.6 + 0.35 * comparison.confidence) * 100) / 100,
  };
}
