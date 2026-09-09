// HOMATCH — renovation scenario write contract.
//
// Split out of renovationPricing.ts with no imports at all, so node:test can
// load it directly: the service around it needs the Vite `@/` alias and a
// Supabase client, which put these rules out of reach of the test runner.
//
// These two functions are the client-side half of a contract the DATABASE
// also enforces. Keeping them here, tested, means the two halves cannot drift
// silently — see renovation_scenarios_priced_iff_version_ck in
// 20260910100000_renovation_price_book.sql.

export type EstimateState = 'NOT_PRICED' | 'PRICED' | 'INSUFFICIENT_PRICE_DATA';

/**
 * Builds a guaranteed non-empty scenario name.
 *
 * `renovation_scenarios.name` is NOT NULL by design — a scenario the customer
 * sees in a list has to be identifiable. Rather than passing null and letting
 * the insert fail, the domain rule is: use what the customer typed, and if
 * they typed nothing, generate a deterministic label from the inputs they
 * actually chose.
 */
export function scenarioName(
  typed: string | null | undefined,
  inputs: { area?: unknown; level?: unknown }
): string {
  const trimmed = String(typed ?? '').trim();
  if (trimmed) return trimmed.slice(0, 120);

  const area = Number(inputs?.area);
  const level = String(inputs?.level ?? '').trim();
  const parts: string[] = [];
  if (Number.isFinite(area) && area > 0) parts.push(`${Math.round(area)} m2`);
  if (level) parts.push(level.replace(/_/g, ' ').toLowerCase());
  return parts.length ? parts.join(' - ') : 'Renovation scenario';
}

/**
 * Forces the (state, version) pair into the only two shapes the database
 * accepts.
 *
 * A claim of PRICED with no version is downgraded rather than rejected: the
 * customer's configuration is still worth saving, and recording it as
 * INSUFFICIENT_PRICE_DATA is the honest description of an estimate we cannot
 * attribute to an approved price version.
 */
export function normalizePricing(
  estimateState: EstimateState,
  priceBookVersionId: string | null
): { estimateState: EstimateState; priceBookVersionId: string | null } {
  if (estimateState === 'PRICED') {
    if (!priceBookVersionId) {
      return { estimateState: 'INSUFFICIENT_PRICE_DATA', priceBookVersionId: null };
    }
    return { estimateState: 'PRICED', priceBookVersionId };
  }
  // Anything not PRICED must not carry a version pointer, or it could later be
  // misread as having been a real quote.
  return { estimateState, priceBookVersionId: null };
}
