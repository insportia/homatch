/**
 * Rendering cost without lying about it.
 *
 * Two rules, and they are the whole module:
 *
 *   1. A figure that is not known renders as unknown — never as zero, and
 *      never as a dash that a reader could take for zero without noticing.
 *   2. A real figure renders at a precision that can actually hold it. A
 *      Verify stage costs fractions of a cent; at two decimal places most of
 *      the cost screen would read as $0.00, which says "free" about money
 *      that was genuinely spent.
 *
 * Kept out of the panel component so both can be tested directly, rather
 * than asserted about through a rendered tree.
 */

/** Money, or the honest absence of it. */
export function usd(value: number | null | undefined, frac = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Below a cent, widen rather than round. $0.004 is not $0.00.
  const digits = abs > 0 && abs < 0.01 ? 6 : frac;
  return `$${value.toFixed(digits)}`;
}

/** A count, or the honest absence of one. */
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** A duration, or the honest absence of one. */
export function secs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Whether a total covering these runs is a figure or a floor.
 *
 * PARTIALLY_PRICED means some stage had no rate in the price book that
 * applied. Its measured part is real; the rest is missing, not zero. A total
 * that includes such a run understates spend, so it must be labelled.
 */
export function isFloorTotal(partiallyPricedJobs: number | null | undefined): boolean {
  return (partiallyPricedJobs ?? 0) > 0;
}
