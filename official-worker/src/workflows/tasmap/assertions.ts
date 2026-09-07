// assertions.ts (TAS_MAP) — pure judgments over raw browser signals.

/** Both live-verified cadastral layers must be enabled. */
export function assertRequiredLayersEnabled(layer1Enabled: boolean, layer2Enabled: boolean): boolean {
  return layer1Enabled && layer2Enabled;
}

/** Every layer returned by the live page adapter must actually be checked. */
export function assertAllRequiredLayersEnabled(results: Record<string, boolean>): boolean {
  const keys = Object.keys(results);
  return keys.length > 0 && keys.every((k) => results[k] === true);
}

export function assertSuggestionSelected(suggestionFound: boolean, suggestionClicked: boolean): boolean {
  return suggestionFound && suggestionClicked;
}

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

/**
 * Confirm the opened parcel against the searched cadastral code, allowing the
 * official map to report a parent/base parcel instead of the full unit code.
 */
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
