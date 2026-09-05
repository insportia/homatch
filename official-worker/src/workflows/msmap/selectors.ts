// selectors.ts (MSMAP) — every DOM/text locator MsMapPage.ts uses, pulled
// out into one place so the exact real-site strings the mandate specifies
// (and the ones confirmed live in earlier sessions' /debug/msmap
// diagnostics) are easy to audit/update without touching workflow logic.
export const CADASTRAL_SECTION_LABEL = 'საკადასტრო მონაცემები';
export const REQUIRED_LAYER_1 = 'რეგისტრირებული მიწის ნაკვეთები';
export const REQUIRED_LAYER_2 = 'სისტემური რეგისტრაცია — საველე სამუშაოების მონაცემები';
// The layers-panel toggle text sometimes renders the second layer's label
// without the em-dash separator — matched with a looser prefix too so a
// minor markup/whitespace difference doesn't falsely fail
// assertRequiredLayersEnabled.
export const REQUIRED_LAYER_2_PREFIX = 'სისტემური რეგისტრაცია';

// Confirmed live (2026-09-04 /debug/msmap diagnostic): the real cadastral
// search box is input[name="searchText"] — NOT the layers-panel filter
// field (input[name="filterText"], which shares the same visible
// placeholder "ძიება" but does not affect the parcel search at all).
export const SEARCH_INPUT_SELECTOR = 'input[name="searchText"]';
export const UNIFIED_SEARCH_NETWORK_PATTERN = /core-api\/v1\/search\/unified-search/i;

export const IDENTIFY_BUTTON_SELECTOR = '[title*="ინფორმაცია" i],[aria-label*="ინფორმაცია" i],[title*="identify" i],[aria-label*="identify" i]';
export const MAP_CANVAS_SELECTOR = 'canvas,.ol-viewport,#map';
export const INFO_POPUP_SELECTOR = '.ol-popup,.popup,[class*="popup" i]';
export const NAPR_LINK_TEXT = /napr|საჯარო რეესტრი|reestri/i;
export const LATEST_INFORMATION_LABEL = 'უახლესი ინფორმაცია';

/** Map-redraw network proof: a genuine parcel-boundary redraw fires
 * geoserver/tileserver/gis-api requests — confirmed live (~260 new requests
 * on a real suggestion click). */
export const MAP_REDRAW_NETWORK_PATTERN = /geoserver|tileserver|gis-api/i;
