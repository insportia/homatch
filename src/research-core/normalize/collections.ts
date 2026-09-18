import { clamp } from './numbers.ts';

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type Comparator<T> = (a: T, b: T) => number;

export function byNumber<T>(selector: (item: T) => number, direction: 'asc' | 'desc' = 'asc'): Comparator<T> {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => (selector(a) - selector(b)) * sign;
}

export function byString<T>(selector: (item: T) => string, direction: 'asc' | 'desc' = 'asc'): Comparator<T> {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => selector(a).localeCompare(selector(b)) * sign;
}

/** Compose comparators: first non-zero result wins. Used for stable tie-breaks. */
export function thenBy<T>(...comparators: Array<Comparator<T>>): Comparator<T> {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

/** Non-mutating sort. */
export function sortBy<T>(items: readonly T[], comparator: Comparator<T>): T[] {
  return [...items].sort(comparator);
}

export function topN<T>(items: readonly T[], n: number, comparator: Comparator<T>): T[] {
  return sortBy(items, comparator).slice(0, Math.max(0, n));
}

// ---------------------------------------------------------------------------
// Filtering / grouping
// ---------------------------------------------------------------------------

export function groupBy<T, K extends string | number>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (predicate(item) ? yes : no).push(item);
  return [yes, no];
}

// ---------------------------------------------------------------------------
// Threshold scoring
// ---------------------------------------------------------------------------

export interface Threshold {
  /** Inclusive lower bound on the raw value. */
  atLeast: number;
  /** Score awarded at or above the bound, 0..1. */
  score: number;
}

/**
 * Step scoring against an ordered threshold table. Used anywhere a raw count
 * becomes a 0..1 score (source counts, completeness, evidence volume).
 */
export function thresholdScore(value: number, thresholds: readonly Threshold[]): number {
  const ordered = [...thresholds].sort((a, b) => b.atLeast - a.atLeast);
  for (const threshold of ordered) {
    if (value >= threshold.atLeast) return clamp(threshold.score, 0, 1);
  }
  return 0;
}

/** Linear ramp between two bounds, clamped to [0, 1]. */
export function rampScore(value: number, min: number, max: number): number {
  if (max === min) return value >= max ? 1 : 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** Diminishing returns: 1 item scores well, 10 score only somewhat better. */
export function saturatingScore(count: number, halfPoint: number): number {
  if (count <= 0) return 0;
  return count / (count + halfPoint);
}

/** Weighted average with weights normalized to sum to 1. Result stays in [0, 1]. */
export function weightedScore(
  components: Record<string, number>,
  weights: Record<string, number>,
): number {
  let totalWeight = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    const component = components[key];
    if (component === undefined) continue;
    totalWeight += weight;
    total += clamp(component, 0, 1) * weight;
  }
  if (totalWeight === 0) return 0;
  return clamp(total / totalWeight, 0, 1);
}
