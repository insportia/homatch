/*
 * THE RENDERING CONTRACT FOR `{{placeholder}}`.
 *
 * WHY THIS IS ITS OWN MODULE, AND WHY IT IS NOT JUST `String.replace`
 *
 * On 2026-09-19 the Georgian Mortgage page told people:
 *
 *   "ამ პირობებით თვეში დაახლოებით {{monthly}} გადაიხდი 8 წლის განმავლობაში."
 *
 * The call site in ResultHeadline passes `amount` and `years`. An
 * administrator had replaced that string through App Content and spelled
 * the hole `{{monthly}}`. Nothing filled it, `replace` returned the match
 * unchanged, and six literal braces went to a customer in the one sentence
 * that was supposed to state the price of their house.
 *
 * FOUR LAYERS FAILED IN ORDER, AND ONLY THE LAST ONE CAN BE FIXED HERE
 *
 *   1. src/i18n/__tests__/placeholders.test.mjs already fails any BUNDLED
 *      string that names a hole English does not have. It reads
 *      translations.ts. An override lives in a database row it never sees.
 *   2. validateOverride() already returns UNKNOWN_HOLES for exactly this
 *      value, and AppContentPage already disables Save on it. The row was
 *      not written through that editor.
 *   3. app_content_set() stores whatever it is given. It cannot do better:
 *      the shipped string is in the JavaScript bundle, not in Postgres, so
 *      the database has nothing to hold the replacement against.
 *   4. Rendering substituted what it could and printed the rest.
 *
 * Layer 4 is the only one that sees both the replacement AND the variables
 * the call site actually passes, so it is the only one that can be certain.
 * That makes it the right place for the guarantee, not the last resort:
 *
 *   A STRING WITH A HOLE NOBODY CAN FILL IS NOT USED.
 *
 * Better copy nobody asked for is not the alternative — the alternative is
 * the copy this product shipped and translated, which is correct copy. So
 * an override that cannot be completed is skipped in favour of the bundled
 * string, and the customer reads a finished sentence in their own language
 * instead of a broken one an administrator did not mean to write.
 */

/** `{{name}}`, tolerant of inner spaces, which is the only form t() fills. */
const HOLE_GLOBAL = /\{\{\s*(\w+)\s*\}\}/g;

export type Vars = Record<string, string | number>;

/**
 * Substitute what the call site supplied. An unknown hole is left exactly
 * as written, so the caller can still tell the difference — `hasUnfilledHole`
 * is how they ask.
 *
 * Plain string substitution, no HTML parsing and no eval, so the result is
 * as safe in a JSX attribute as it is in text.
 */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(HOLE_GLOBAL, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** True when a `{{...}}` survived interpolation and would reach a customer. */
export function hasUnfilledHole(text: string): boolean {
  /* A fresh regex rather than HOLE_GLOBAL: `test` on a /g/ regex advances
     lastIndex and the next call on a different string starts mid-way. */
  return /\{\{\s*\w+\s*\}\}/.test(text);
}

/**
 * Last resort, when no candidate can be completed.
 *
 * Removing the token leaves a sentence with a gap in it, which is poor —
 * but it is a sentence, and a customer reading one is not shown the
 * internals of a templating system. The surrounding whitespace collapses
 * so the gap does not read as a typing error on top of everything else.
 */
export function stripUnfilledHoles(text: string): string {
  return text.replace(HOLE_GLOBAL, '').replace(/[ \t ]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

/**
 * The first candidate that comes out whole.
 *
 * Candidates are given in falling order of preference — what an admin
 * wrote, then this locale's shipped string, then English — and the first
 * one whose holes the call site can all fill wins. If none can, the last
 * non-empty candidate is rendered with its holes removed rather than
 * printed; see the note above stripUnfilledHoles.
 *
 * Returns undefined only when there was nothing to render at all.
 */
export function resolveCopy(candidates: (string | undefined)[], vars?: Vars): string | undefined {
  let fallback: string | undefined;
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const filled = interpolate(candidate, vars);
    if (!hasUnfilledHole(filled)) return filled;
    fallback ??= filled;
  }
  return fallback === undefined ? undefined : stripUnfilledHoles(fallback);
}
