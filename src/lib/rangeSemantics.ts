// HOMATCH — an unknown number is not zero.
//
// THE BUG THIS EXISTS TO STOP
//
// A match with a budget floor and no ceiling rendered as
//
//     USD60,000–0
//
// because the absent maximum was coerced with `?? 0` and then formatted like
// a real bound. The customer is shown a range that runs downwards to nothing,
// for a buyer who simply did not state an upper limit. The same shape appears
// wherever an optional number meets a formatter: area, bedrooms, fees,
// confidence, provider cost.
//
// Absent and zero are different facts and they are different answers:
//
//     exact      120,000              both bounds, equal
//     range      60,000 – 90,000      both bounds
//     from       from 60,000          minimum only
//     upTo       up to 90,000         maximum only
//     unknown    (not stated)         neither
//
// `0` is a legitimate value in some of these fields — a fee of zero, a
// balance of zero — so it must survive as EXACT rather than being read as
// missing. That is why this tests for null/undefined/NaN rather than for
// falsiness, which is the mistake that produces the bug in the first place.

export type RangeKind = 'exact' | 'range' | 'from' | 'upTo' | 'unknown';

export interface RangeShape {
  kind: RangeKind;
  min: number | null;
  max: number | null;
}

/** A number that was actually supplied. Zero counts; NaN and null do not. */
export function present(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * What kind of range these two bounds actually describe.
 *
 * Deliberately total: every combination of present and absent has an answer,
 * so a caller cannot reach a formatter without having decided what to show.
 */
export function rangeShape(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): RangeShape {
  const min = present(minimum) ? minimum : null;
  const max = present(maximum) ? maximum : null;

  if (min === null && max === null) return { kind: 'unknown', min: null, max: null };
  if (min !== null && max === null) return { kind: 'from', min, max: null };
  if (min === null && max !== null) return { kind: 'upTo', min: null, max };
  if (min === max) return { kind: 'exact', min, max };
  /* Bounds the wrong way round are data, not a rendering decision: show the
     span they describe rather than a range that runs backwards. */
  return min! <= max! ? { kind: 'range', min, max } : { kind: 'range', min: max, max: min };
}

/** A single optional number: present, or not. */
export function valueShape(value: number | null | undefined): RangeShape {
  return present(value) ? { kind: 'exact', min: value, max: value } : { kind: 'unknown', min: null, max: null };
}

/**
 * Render a shape, given the pieces only the caller knows.
 *
 * The caller supplies the number formatting (currency, units, locale) and the
 * words, because "up to" in six languages is a translation and this file has
 * no business holding one.
 */
export function formatRange(
  shape: RangeShape,
  format: (n: number) => string,
  words: { from: (v: string) => string; upTo: (v: string) => string; unknown: () => string },
): string {
  switch (shape.kind) {
    case 'exact': return format(shape.min as number);
    case 'range': return `${format(shape.min as number)}–${format(shape.max as number)}`;
    case 'from': return words.from(format(shape.min as number));
    case 'upTo': return words.upTo(format(shape.max as number));
    default: return words.unknown();
  }
}
