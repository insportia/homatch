// selectors.ts (TAS_MAP) — live-verified selectors for the official MS cadastral map.
// The production entry is the direct MS Map URL. TAS document search remains a
// separate workflow on tas.ge and is intentionally not touched here.

export const MS_MAP_URL = 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19';

// Live DOM: the actual cadastral query field is name=searchText. The page also
// contains filterText inputs with the same visible placeholder, so the name is
// the stable discriminator.
export const MAP_SEARCH_INPUT_SELECTOR = 'input[name="searchText"]';
export const MAP_SEARCH_TEXTBOX_NAME = 'ძიება';

export const MAP_CANVAS_SELECTOR = 'app-ol-map canvas';
export const MAP_CANVAS_SELECTOR_FALLBACK = 'canvas,.ol-viewport,#map';
export const MAP_REDRAW_NETWORK_PATTERN = /geoserver|tileserver|gis-api/i;

export const CADASTRAL_LAYER_CATEGORY = 'საკადასტრო მონაცემები';
export const REQUIRED_LAYER_1 = 'რეგისტრირებული მიწის ნაკვეთები';
export const REQUIRED_LAYER_2 = 'სისტემური რეგისტრაცია-საველე სამუშაოების მონაცემები';
export const REQUIRED_LAYER_2_PREFIX = 'სისტემური რეგისტრაცია';
export const REQUIRED_LAYERS = [REQUIRED_LAYER_1, REQUIRED_LAYER_2] as const;

export const INFO_ICON_ROLE_NAME = 'info icon';
export const INFO_ICON_SELECTOR_FALLBACKS = [
  '[title*="ინფორმაცია" i],[aria-label*="ინფორმაცია" i],[title*="identify" i],[aria-label*="identify" i]',
  '[class*="identify" i] button,button[class*="identify" i]',
  '.ol-control button[class*="info" i],.ol-control [class*="identify" i]',
];

export const INFO_RESULT_WINDOW_SELECTOR = 'app-info-result-window';
export const PUBLIC_REGISTRY_ROW_TEXT = 'საჯარო რეესტრის ინფორმაცია';

// NAPR abstract list: registration number is the traversal identity. Date is
// metadata only and must never cause a second open of the same document.
export const NAPR_REGISTRATION_PATTERN = /რეგისტრაციის\s*ნომერი:\s*(\d{9,12})/i;
