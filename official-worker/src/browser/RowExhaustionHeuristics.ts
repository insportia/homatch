// RowExhaustionHeuristics.ts — the PURE decision logic pulled out of
// browser/ResultRowExhauster.ts specifically so it is unit-testable without
// a browser. This is the direct regression-test target for the confirmed
// production bug: TAS's anchor-based row selector matched the site's own
// 13-item nav menu (an incidental `<ul><li><a>` structure completely
// unrelated to the ExtJS results grid, which renders with NO <a> anywhere —
// see workflows/tas/selectors.ts) and `exhaustResultRows` trusted that pass
// as "the results, fully visited" — reporting 13 visited / 0 documents read
// against a real 24 discovered, and never even trying the grid-row
// fallback strategy that would have found the actual results.
//
// `anchorPassLooksReal` is the gate that now prevents this: an anchor-based
// pass is only trusted once it produced at least one real document AND (when
// the source itself reported how many results it found) visited a
// plausible fraction of that count. Anything else falls through to the
// ExtJS grid-row strategy instead of being reported as complete.

/**
 * @param visited How many anchor-matched rows were actually visited this pass.
 * @param documentsFound How many of those visits produced a real, non-trivial document.
 * @param expectedCount The source's own reported result count, if known (e.g. TAS's
 *   own "სულ მოიძებნა: N" counter). `null`/`undefined`/`<= 0` means "unknown" —
 *   in that case only the documentsFound>0 check applies.
 */
export function anchorPassLooksReal(visited: number, documentsFound: number, expectedCount?: number | null, maxRows = 25): boolean {
  if (documentsFound <= 0) return false;
  if (expectedCount == null || expectedCount <= 0) return true;
  return visited >= Math.min(expectedCount, maxRows) * 0.5;
}
