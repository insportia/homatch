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

/** "Validate that the opened parcel is the intended parcel" (mandate: a
 * parcel click + popup opening is NOT proof it's the right parcel). Checks
 * whether the parcel-info popup's own text contains a recognizable prefix
 * of the searched cadastral code — tried from the full code down to a
 * 5-segment base/parent parcel, since MS Map's popup can legitimately show
 * only the base parcel's code even when the user searched a full unit
 * cadastral (e.g. searched 01.18.06.019.055.03.01.603, popup shows the
 * parent parcel 01.18.06.019.055). Deliberately NOT hardcoded to any
 * specific code or segment count — works for any cadastral shape.
 * Non-blocking by design (see MsMapWorkflow.ts): this sandbox has no live
 * network path to ms.gov.ge, so the popup's real text markup has never
 * been confirmed here — a false negative from an unexpected text format
 * must not stop an otherwise-successful MSMAP traversal outright. It
 * downgrades confidence/verification state instead of gating the FSM. */
export function assertParcelMatchesQuery(popupText: string | null | undefined, query: string): boolean {
  if (!popupText) return false;
  const segs = query.split('.').filter(Boolean);
  if (segs.length < 3) return false;
  const minSegs = Math.min(5, segs.length);
  for (let n = segs.length; n >= minSegs; n--) {
    const prefix = segs.slice(0, n).join('.');
    if (popupText.includes(prefix)) return true;
  }
  return false;
}
