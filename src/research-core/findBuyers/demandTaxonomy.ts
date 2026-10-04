// FIND BUYERS / FIND TENANTS — the shared vocabulary of a discovered signal:
// how fresh it is, where its date came from, which side of the market it is
// on, the hard gates applied BEFORE ranking, and the one primary disposition
// every assessed candidate ends with. Pure; used by the edge pipeline and
// tests. The 30-day ingest rule itself stays in freshness.ts.
//
// A SALE search looks for BUYER demand; a RENT search for TENANT demand. A
// post that states the other transaction ("сниму квартиру" under a SALE
// search) is never a qualified match, whatever the intent classifier said.

import type { IntentClass } from './intent.ts';

const DAY = 86_400_000;

export type FreshnessBucket = 'ULTRA_FRESH' | 'VERY_FRESH' | 'FRESH' | 'RECENT' | 'AGING' | 'EXPIRED' | 'FRESHNESS_UNKNOWN';

/** 0–24h, 1–3d, 4–7d, 8–14d, 15–30d, 31d+. No (or an unreadable / far-future) date is UNKNOWN, never fresh. */
export function freshnessBucket(publishedAt: string | null | undefined, now = Date.now()): FreshnessBucket {
  if (!publishedAt) return 'FRESHNESS_UNKNOWN';
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t) || t - now > DAY) return 'FRESHNESS_UNKNOWN';
  const days = Math.max(0, now - t) / DAY;
  if (days <= 1) return 'ULTRA_FRESH';
  if (days <= 3) return 'VERY_FRESH';
  if (days <= 7) return 'FRESH';
  if (days <= 14) return 'RECENT';
  if (days <= 30) return 'AGING';
  return 'EXPIRED';
}

export const PROMOTABLE_BUCKETS: ReadonlySet<FreshnessBucket> = new Set(['ULTRA_FRESH', 'VERY_FRESH', 'FRESH', 'RECENT', 'AGING']);

export type DateSource = 'PUBLISHED' | 'PARENT_PUBLISHED' | 'NONE';
export type DateConfidence = 'HIGH' | 'INFERRED' | 'NONE';

/** Where a signal's evidence date came from. A comment dated by its parent is an inference, not a fact. */
export function dateProvenance(own: string | null | undefined, parent: string | null | undefined): { dateSource: DateSource; dateConfidence: DateConfidence; evidenceAt: string | null } {
  if (own && Number.isFinite(Date.parse(own))) return { dateSource: 'PUBLISHED', dateConfidence: 'HIGH', evidenceAt: own };
  if (parent && Number.isFinite(Date.parse(parent))) return { dateSource: 'PARENT_PUBLISHED', dateConfidence: 'INFERRED', evidenceAt: parent };
  return { dateSource: 'NONE', dateConfidence: 'NONE', evidenceAt: null };
}

export type PublicIntent = 'BUYER_DEMAND' | 'TENANT_DEMAND' | 'SELLER_SUPPLY' | 'LANDLORD_SUPPLY' | 'AGENT_PROMOTION' | 'GENERAL_DISCUSSION' | 'UNKNOWN';

/**
 * The market side of a classified signal. The classifier's buyer/tenant label
 * follows the campaign; the text's own transaction decides the real side.
 */
export function publicIntent(c: IntentClass | null | undefined, statedTransaction: 'SALE' | 'RENT' | null): PublicIntent {
  switch (c) {
    case 'BUYER_HIGH': case 'BUYER_MEDIUM': case 'TENANT_HIGH': case 'TENANT_MEDIUM':
      if (statedTransaction === 'RENT') return 'TENANT_DEMAND';
      if (statedTransaction === 'SALE') return 'BUYER_DEMAND';
      return c.startsWith('TENANT') ? 'TENANT_DEMAND' : 'BUYER_DEMAND';
    case 'SELLER': case 'OWNER':
      return statedTransaction === 'RENT' ? 'LANDLORD_SUPPLY' : 'SELLER_SUPPLY';
    case 'AGENT': return 'AGENT_PROMOTION';
    case 'QUESTION': case 'SERVICE_PROVIDER': case 'NOISE': return 'GENERAL_DISCUSSION';
    default: return 'UNKNOWN';
  }
}

export const WANTED_DEMAND: Readonly<Record<'SALE' | 'RENT', PublicIntent>> = { SALE: 'BUYER_DEMAND', RENT: 'TENANT_DEMAND' };

export type Disposition =
  | 'QUALIFIED' | 'DUPLICATE' | 'STALE' | 'UNDATED' | 'WRONG_INTENT' | 'WRONG_TRANSACTION'
  | 'BELOW_THRESHOLD' | 'UNDECIDED';

export const DISPOSITIONS: readonly Disposition[] = ['QUALIFIED', 'DUPLICATE', 'STALE', 'UNDATED', 'WRONG_INTENT', 'WRONG_TRANSACTION', 'BELOW_THRESHOLD', 'UNDECIDED'];

/**
 * Hard gates, before any ranking. Returns the rejecting disposition, or null
 * when the candidate may be ranked. The comment's own words count; a comment
 * that states nothing inherits nothing (its parent's offer is not its intent).
 */
export function hardGate(input: {
  campaign: 'SALE' | 'RENT';
  intentClass: IntentClass | null | undefined;
  method?: string | null;
  statedTransaction: 'SALE' | 'RENT' | null;
}): Disposition | null {
  if (!input.intentClass || input.method === 'UNDECIDED' || input.intentClass === 'UNCERTAIN') return 'UNDECIDED';
  const side = publicIntent(input.intentClass, input.statedTransaction);
  if (side !== 'BUYER_DEMAND' && side !== 'TENANT_DEMAND') return 'WRONG_INTENT';
  if (side !== WANTED_DEMAND[input.campaign]) return 'WRONG_TRANSACTION';
  return null;
}

export type DispositionCounts = Record<Disposition, number>;
export const emptyDispositions = (): DispositionCounts =>
  Object.fromEntries(DISPOSITIONS.map((d) => [d, 0])) as DispositionCounts;

/** Every candidate has exactly one disposition: the counts must add up to the candidates. */
export function reconciles(counts: DispositionCounts, candidates: number): boolean {
  return DISPOSITIONS.reduce((s, d) => s + (counts[d] ?? 0), 0) === candidates;
}
