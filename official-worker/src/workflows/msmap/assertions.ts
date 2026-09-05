// assertions.ts (MSMAP) — mandate Section 5's named assertion functions,
// PURE (no Playwright — MsMapPage.ts does the actual DOM interaction and
// passes the raw signal it observed in; these functions only judge whether
// that signal satisfies the rule). Kept pure specifically so they are
// unit-testable without a browser, unlike the rest of this workflow.
//
// "If an assertion fails: do not silently downgrade it into generic
// SEARCH_CONFIRMED. Return the exact internal failure state." —
// MsMapWorkflow.ts is what honors this: it calls these functions and, on a
// false result, simply stops advancing the FSM rather than forcing any
// particular status.

export function assertRequiredLayersEnabled(layer1Enabled: boolean, layer2Enabled: boolean): boolean {
  return layer1Enabled && layer2Enabled;
}

export function assertSuggestionSelected(suggestionFound: boolean, suggestionClicked: boolean): boolean {
  return suggestionFound && suggestionClicked;
}

/** A parcel is "focused" only once the map actually redrew in response to
 * the click — network-confirmed (geoserver/tileserver requests fired), not
 * merely "we clicked something." This is the exact fix for the reported
 * bug: a click with no redraw must not count as PARCEL_FOCUSED. */
export function assertParcelFocused(clicked: boolean, mapRedrawConfirmed: boolean): boolean {
  return clicked && mapRedrawConfirmed;
}

export function assertIdentifyModeActive(identifyToolActivated: boolean): boolean {
  return identifyToolActivated;
}

export function assertParcelInfoPopupVisible(infoPopupOpened: boolean): boolean {
  return infoPopupOpened;
}

export function assertNaprNavigationOccurred(naprLinkOpened: boolean): boolean {
  return naprLinkOpened;
}

export function assertLatestInformationOpened(latestInformationOpened: boolean): boolean {
  return latestInformationOpened;
}
