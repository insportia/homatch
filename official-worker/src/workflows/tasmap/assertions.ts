// assertions.ts (TAS_MAP) — PURE (no Playwright — TasMapPage.ts does the
// actual DOM interaction and passes the raw signal it observed in; these
// functions only judge whether that signal satisfies the rule). Kept pure
// specifically so they are unit-testable without a browser.
//
// "If an assertion fails: do not silently downgrade it into generic
// SEARCH_CONFIRMED. Return the exact internal failure state." —
// TasMapWorker.ts is what honors this: it calls these functions and, on a
// false result, simply stops advancing the FSM rather than forcing any
// particular status.

/** The 2 layers checked directly at the tree root. Kept as a 2-arg function
 * (rather than folded into assertAllRequiredLayersEnabled) so the existing,
 * already-passing unit tests for this exact 2-layer signal keep working
 * unchanged. */
export function assertRequiredLayersEnabled(layer1Enabled: boolean, layer2Enabled: boolean): boolean {
  return layer1Enabled && layer2Enabled;
}

/** The FULL 7-item required-layer gate (2026-09-06 "final alignment pass"
 * mandate): the 2 root layers PLUS the 4 checkable sub-layers under the
 * "თბილისის ელექტრონული განცხადებები" category — every one of them must
 * have been successfully enabled, not merely attempted. Takes the raw
 * per-layer results so a caller can also report exactly which named layer
 * failed (never a single opaque boolean). */
export function assertAllRequiredLayersEnabled(results: Record<string, boolean>): boolean {
  const keys = Object.keys(results);
  return keys.length > 0 && keys.every((k) => results[k] === true);
}

export function assertSuggestionSelected(suggestionFound: boolean, suggestionClicked: boolean): boolean {
  return suggestionFound && suggestionClicked;
}

/** A parcel is "focused" only once the map actually redrew in response to
 * the click — network-confirmed (geoserver/tileserver/gis-api requests
 * fired) OR a DOM-level confirmation that the suggestion was consumed (the
 * search box now shows the resolved code and the suggestion list closed) —
 * never merely "we clicked something." */
export function assertParcelFocused(clicked: boolean, redrawConfirmed: boolean): boolean {
  return clicked && redrawConfirmed;
}

export function assertIdentifyModeActive(identifyToolActivated: boolean): boolean {
  return identifyToolActivated;
}

export function assertParcelInfoWindowVisible(infoWindowOpened: boolean): boolean {
  return infoWindowOpened;
}

export function assertNaprNavigationOccurred(naprLinkOpened: boolean): boolean {
  return naprLinkOpened;
}

export function assertSectionsTraversed(sectionsOpened: number, sectionsAvailable: number): boolean {
  return sectionsAvailable === 0 || sectionsOpened >= sectionsAvailable;
}

/** "Validate that the opened parcel is the intended parcel" — checks
 * whether the parcel-info window's own text contains a recognizable prefix
 * of the searched cadastral code, tried from the full code down to a
 * 5-segment base/parent parcel (TAS_MAP's popup can legitimately show only
 * the base parcel's code even when the user searched a full unit
 * cadastral). Deliberately NOT hardcoded to any specific code or segment
 * count — works for any cadastral shape. Non-blocking by design: a false
 * negative from an unexpected text format must not stop an otherwise-
 * successful traversal outright — it downgrades confidence/verification
 * state instead of gating the FSM. */
export function assertParcelMatchesQuery(windowText: string | null | undefined, query: string): boolean {
  if (!windowText) return false;
  const segs = query.split('.').filter(Boolean);
  if (segs.length < 3) return false;
  const minSegs = Math.min(5, segs.length);
  for (let n = segs.length; n >= minSegs; n--) {
    const prefix = segs.slice(0, n).join('.');
    if (windowText.includes(prefix)) return true;
  }
  return false;
}
