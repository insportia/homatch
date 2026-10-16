// Unicode safety for text HOMATCH stores in jsonb (2026-10-16).
//
// JavaScript strings are UTF-16: a code-unit slice can split an emoji's surrogate pair,
// and JSON.stringify then writes a lone "\udXXX" escape that Postgres jsonb rejects
// ("invalid input syntax for type json"). In production one such evidence snippet made a
// whole 500-row batch of search results fail (only the batch's tail survived). Every clip
// of free text goes through clipText; everything written to jsonb through wellFormedDeep.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The string with lone surrogates replaced (U+FFFD) and NULs removed (jsonb rejects \u0000). */
export function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE, '�').replace(/\u0000/g, '');
}

/** s.slice(start, end) that never splits a surrogate pair (code-point safe edges). */
export function clipText(s: string, start: number, end?: number): string {
  let a = Math.max(0, start);
  let b = end == null ? s.length : Math.min(s.length, Math.max(a, end));
  const low = (i: number) => { const c = s.charCodeAt(i); return c >= 0xDC00 && c <= 0xDFFF; };
  if (a > 0 && a < s.length && low(a)) a += 1;
  if (b > 0 && b < s.length && low(b)) b -= 1;
  return s.slice(a, Math.max(a, b));
}

/** A deep copy with every string well-formed (objects, arrays, nested). */
export function wellFormedDeep<T>(value: T): T {
  if (typeof value === 'string') return wellFormed(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => wellFormedDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[wellFormed(k)] = wellFormedDeep(v);
    return out as T;
  }
  return value;
}
