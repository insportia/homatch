// HOMATCH RESEARCH CORE — content identity.
//
// Content hashing is what stops a mirrored page being counted as a second
// independent source, so the NORMALIZATION in front of the hash matters as
// much as the hash itself: two pages with different ads, different whitespace
// and different casing but identical prose must hash the same, and two pages
// that merely look similar must not.

import { sha256Hex } from '../core/sha256.ts';

export function sha256(input: string): string {
  return sha256Hex(input);
}

export function normalizeForHash(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // Non-breaking and narrow no-break spaces, which portals emit freely.
    .replace(/[  ]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash of the meaningful content of a page. */
export function contentHash(text: string): string {
  return sha256(normalizeForHash(text));
}

/** Stable hash of an object: key order never changes the result. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * SimHash-style near-duplicate fingerprint over word shingles.
 *
 * ADVISORY ONLY. Exact `contentHash` equality stays the primary dedupe signal
 * because it is provable; this one is probabilistic and is used to flag a pair
 * for review, never to silently collapse two observations into one.
 */
export function shingleFingerprint(text: string, shingleSize = 4): string {
  const words = normalizeForHash(text).split(' ').filter(Boolean);
  if (words.length === 0) return sha256('');
  const bits = new Array<number>(64).fill(0);
  for (let i = 0; i + shingleSize <= words.length; i += 1) {
    const shingle = words.slice(i, i + shingleSize).join(' ');
    const digest = sha256Hex(shingle);
    for (let b = 0; b < 64; b += 1) {
      const nibble = Number.parseInt(digest[b >> 2] as string, 16);
      const bit = (nibble >> (3 - (b % 4))) & 1;
      bits[b] = (bits[b] as number) + (bit ? 1 : -1);
    }
  }
  let out = '';
  for (let b = 0; b < 64; b += 8) {
    let byte = 0;
    for (let i = 0; i < 8; i += 1) byte = (byte << 1) | ((bits[b + i] as number) > 0 ? 1 : 0);
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function hammingDistanceHex(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < length; i += 1) {
    let xor = Number.parseInt(a[i] as string, 16) ^ Number.parseInt(b[i] as string, 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}
