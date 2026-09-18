/**
 * Numeric normalization.
 *
 * Real listings write the same number as "268,000", "268 000", "268.000" and
 * "268'000". Parsing has to be deterministic and its ambiguity has to be
 * explicit rather than accidental.
 */

export interface ParseNumberOptions {
  /**
   * How to read a single separator followed by exactly three digits ("97.200").
   * 'group' reads 97200, 'decimal' reads 97.2. Default 'group' because
   * thousands separators are far more common in price strings.
   */
  ambiguousTripleGroup?: 'group' | 'decimal';
}

const GROUPING_CHARS = /[   '’\s]/g;

export function parseNumber(
  raw: string | number | null | undefined,
  options: ParseNumberOptions = {},
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  let s = raw.replace(GROUPING_CHARS, '').trim();
  if (!s) return null;

  const negative = /^[-−]/.test(s) || /\(.*\)/.test(s);
  s = s.replace(/^[-−+]/, '');

  // Keep only digits and separators; drop currency symbols, units, letters.
  s = s.replace(/[^0-9.,]/g, '');
  if (!s || !/[0-9]/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the rightmost is the decimal separator.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    normalized = s.split(groupSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const occurrences = s.split(sep).length - 1;
    const after = s.length - s.lastIndexOf(sep) - 1;

    if (occurrences > 1) {
      // "1.234.567" can only be grouping.
      normalized = s.split(sep).join('');
    } else if (after === 3) {
      normalized =
        (options.ambiguousTripleGroup ?? 'group') === 'group'
          ? s.split(sep).join('')
          : s.replace(sep, '.');
    } else {
      normalized = s.replace(sep, '.');
    }
  } else {
    normalized = s;
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Extract every number appearing in a blob of text, in order. */
export function extractNumbers(text: string, options?: ParseNumberOptions): number[] {
  const matches = text.match(/[-+]?[0-9][0-9\s.,'  ]*/g) ?? [];
  const out: number[] = [];
  for (const m of matches) {
    const n = parseNumber(m, options);
    if (n !== null) out.push(n);
  }
  return out;
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Tolerant equality. Two sources reporting 97.2 and 97.19 are agreeing;
 * 97.2 and 94.0 are not. `relTol` is the relative tolerance.
 */
export function approxEqual(a: number, b: number, relTol = 0.02, absTol = 0): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return diff <= absTol;
  return diff / scale <= relTol;
}

export function relativeDifference(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 0;
  return Math.abs(a - b) / scale;
}

export function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = clamp(p, 0, 1) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low] as number;
  const weight = rank - low;
  return (sorted[low] as number) * (1 - weight) + (sorted[high] as number) * weight;
}
