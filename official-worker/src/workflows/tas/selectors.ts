// selectors.ts (TAS) — confirmed live (input[name*="cad" i] inside the
// docs.tbilisi.gov.ge ExtJS iframe, submitted via Enter, real search proven
// by a network XHR to a /dwr/ endpoint — DWR = Direct Web Remoting).
export const CADASTRAL_INPUT_SELECTORS = ['input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]'];
export const DWR_NETWORK_PATTERN = /\/dwr\//i;
export const TAS_URL = 'https://tas.ge/?p=searchdocument&menuItemId=7104';

// ExtJS grid rows render with NO <a href> anywhere (confirmed live — this
// is exactly why the pre-refactor anchor-only selector matched 0 rows on a
// grid whose own counter said "სულ მოიძებნა: 18"). Anchor-based result
// lists are tried FIRST (still correct for a plain HTML result list); this
// selector is the fallback for a genuine ExtJS grid.
export const GRID_ROW_SELECTOR = '[role="row"], .x-grid-row, tr[class*="x-grid" i], [class*="grid-row" i], [class*="grid" i] tbody tr';
export const MAX_RESULT_ROWS = 25;
