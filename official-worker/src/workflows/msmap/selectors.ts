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
// Confirmed live in production (2026-09-05 run against
// 01.18.06.019.055.03.01.603): IDENTIFY_BUTTON_SELECTOR matched nothing —
// `assertIdentifyModeActive` failed and the workflow stopped at
// PARCEL_FOCUSED, never reaching NAPR/latest-information/child-document
// traversal. The real button's markup could not be re-verified from this
// sandbox (no network path to ms.gov.ge here — see MsMapPage.ts's header),
// so these are best-effort fallback candidates for common OpenLayers/Esri
// toolbar patterns (an icon-only button with no title/aria-label at all, or
// one exposing the tool name only via a class/data attribute) — tried only
// when the primary selector matches zero elements. This does NOT replace
// live selector verification; MsMapWorkflow.ts now records exactly which
// candidate (if any) matched and how many elements each found, so the next
// live run's BrowserTrace tells us definitively rather than us guessing
// again.
export const IDENTIFY_BUTTON_SELECTOR_FALLBACKS = [
  '[class*="identify" i] button,button[class*="identify" i]',
  '.ol-control button[class*="info" i],.ol-control [class*="identify" i]',
  '[data-tool*="identify" i],[data-action*="identify" i]',
];
export const MAP_CANVAS_SELECTOR = 'canvas,.ol-viewport,#map';
export const INFO_POPUP_SELECTOR = '.ol-popup,.popup,[class*="popup" i]';
export const NAPR_LINK_TEXT = /napr|საჯარო რეესტრი|reestri/i;
export const LATEST_INFORMATION_LABEL = 'უახლესი ინფორმაცია';

/** Map-redraw network proof: a genuine parcel-boundary redraw fires
 * geoserver/tileserver/gis-api requests — confirmed live (~260 new requests
 * on a real suggestion click). */
export const MAP_REDRAW_NETWORK_PATTERN = /geoserver|tileserver|gis-api/i;
