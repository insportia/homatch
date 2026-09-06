// selectors.ts (TAS_MAP) — every DOM/text locator TasMapPage.ts uses.
//
// 2026-09-06 "final alignment pass" mandate: this source is TAS_MAP (the
// map popup opened FROM tas.ge's own homepage), not a direct ms.gov.ge
// navigation. The constants below are taken directly from the live-recorded
// Playwright trace (msmap-recording.spec.ts, checked into the repo root) —
// real, confirmed component/class names (mat-tree-node, app-tree-node-
// wrapper, app-ol-map, app-info-result-window, app-result-tbl) and real
// accessible names/text (the 'ძიება' textbox, the 'info icon' image role,
// the exact Georgian layer/section labels). Fragile per-run artifacts the
// recording ALSO contains — literal AR application numbers, numbered
// mat-mdc-checkbox ids, nth-child tree-node positions, a hardcoded canvas
// pixel coordinate — are deliberately NOT reproduced here; TasMapPage.ts
// walks the tree/sections/rows generically by role/text instead.
export const TAS_HOME_URL = 'https://tas.ge/';

// The map-launch link on tas.ge's homepage is icon-only — the recording's
// own codegen output (`getByRole('link').filter({hasText:/^$/}).nth(1)`)
// proves it carries no accessible name Playwright could capture, so a bare
// positional index is the ONLY thing the recording itself could rely on.
// That is exactly the kind of un-generalizable structural anchor the
// mandate forbids for real DOM traversal (nth-child, coordinates, etc.) —
// so the primary strategy here is semantic (title/aria-label/href
// containing a map-ish keyword); the recording's own positional pattern is
// kept only as a last-resort fallback, mirroring how
// IDENTIFY_BUTTON_SELECTOR_FALLBACKS documents an unverifiable-live
// selector as a fallback rather than a silent guess elsewhere in this
// codebase.
export const MAP_LAUNCH_LINK_SELECTOR = 'a[title*="რუკა" i],a[aria-label*="რუკა" i],a[href*="msmap" i],a[href*="ms.gov.ge" i],a[title*="map" i],a[aria-label*="map" i],a[title*="gis" i],a[aria-label*="gis" i]';
// Recording: getByRole('link').filter({ hasText: /^$/ }).nth(1) — the SECOND
// icon-only (no visible text) link on the homepage. Tried only when no
// semantic candidate above matches anything.
export const MAP_LAUNCH_LINK_FALLBACK_EMPTY_TEXT_INDEX = 1;

export const MAP_SEARCH_TEXTBOX_NAME = 'ძიება';
export const MAP_CANVAS_SELECTOR = 'app-ol-map canvas';
// Kept as a fallback in case the popup's map component ever renders without
// the app-ol-map wrapper (e.g. a bare OpenLayers canvas).
export const MAP_CANVAS_SELECTOR_FALLBACK = 'canvas,.ol-viewport,#map';
export const MAP_REDRAW_NETWORK_PATTERN = /geoserver|tileserver|gis-api/i;

export const INFO_ICON_ROLE_NAME = 'info icon';
// Kept as fallbacks for the identify/info tool activation in case the real
// popup ever fails to expose an accessible img role with this exact name —
// same multi-candidate, trace-recorded pattern the pre-existing MSMAP
// identify-button logic already used.
export const INFO_ICON_SELECTOR_FALLBACKS = [
  '[title*="ინფორმაცია" i],[aria-label*="ინფორმაცია" i],[title*="identify" i],[aria-label*="identify" i]',
  '[class*="identify" i] button,button[class*="identify" i]',
  '.ol-control button[class*="info" i],.ol-control [class*="identify" i]',
];

export const INFO_RESULT_WINDOW_SELECTOR = 'app-info-result-window';

// The 2 layers checked directly at the tree root (recording: getByRole
// ('treeitem', {name}).getByLabel('').check()), plus the one parent
// CATEGORY node that must be EXPANDED (it has no checkbox of its own in the
// recording — only its 4 children are checked) exposing 4 checkable leaves.
// This is the mandate's exact 7-item required-layer list.
export const REQUIRED_LAYER_1 = 'რეგისტრირებული მიწის ნაკვეთები';
export const REQUIRED_LAYER_2 = 'სისტემური რეგისტრაცია-საველე სამუშაოების მონაცემები';
// A markup/whitespace difference (em-dash vs hyphen, extra spacing) between
// runs is matched too via this looser prefix, same defensive pattern the
// pre-existing MSMAP code used for this exact layer's label.
export const REQUIRED_LAYER_2_PREFIX = 'სისტემური რეგისტრაცია';
export const REQUIRED_LAYER_CATEGORY = 'თბილისის ელექტრონული განცხადებები';
export const REQUIRED_CATEGORY_SUBLAYERS = ['არქიტექტურული საკითხები', 'ურბანული საკითხები', 'სატრანსპორტო საკითხები', 'მუნიციპალური ინსპექცია'] as const;
export const REQUIRED_LAYERS = [REQUIRED_LAYER_1, REQUIRED_LAYER_2, ...REQUIRED_CATEGORY_SUBLAYERS] as const;

// The mandate's "traverse ALL available relevant sections" list, verbatim,
// in the exact order given — app-info-result-window's own collapsible
// sections. "საჯარო რეესტრის ინფორმაცია" is handled by openParcelInfoWindow
// as the NAPR/registry-extract lead (mirrors the pre-existing MSMAP
// contract that already opens NAPR from the parcel popup) as well as being
// re-listed here for its own row enumeration, since the recording shows
// both behaviors against the same section.
export const PARCEL_INFO_SECTIONS = [
  'საჯარო რეესტრის ინფორმაცია',
  'მშენებლობის ნებართვები',
  'სამართლებრივი საკითხები',
  'მიწის ნაკვეთის გამოყენების პირობები',
  'საგზაო მოძრაობის ორგანიზების სქემები',
  'სპეციალური /ზონალური/შეთანხმება',
  'შენობა - ნაგებობები (არქივი',
  'გზათა ქსელი (თბილისი)',
  'საქართველოს რეგიონული საზღვარი',
  'რეგისტრირებული მიწის ნაკვეთები',
] as const;

// Every real application/document row inside a section's result table
// carries one of these two label shapes (recording: "განცხადების ნომერი:
// AR11101896", "ინფო:დოკუმენტის ნომერი:01242571792-16") — enumerated
// dynamically by this TEXT PATTERN, never by a fixed list of AR/document
// numbers.
export const APPLICATION_ROW_TEXT_PATTERN = /განცხადების\s*ნომერი|დოკუმენტის\s*ნომერი/;
// A document popup can itself embed an iframe containing an ExtJS grid
// whose row triggers a further nested document popup (recording:
// `.locator('iframe').contentFrame().locator('#gridview-1051').click()`).
// The numeric suffix is per-run/per-document — matched by attribute-prefix,
// never the literal id.
export const NESTED_GRIDVIEW_SELECTOR = '[id^="gridview-"]';
export const PUBLIC_REGISTRY_ROW_TEXT = 'საჯარო რეესტრის ინფორმაცია';

export const MAX_SECTION_ROWS = 25;
export const MAX_NESTED_DOCS_PER_ROW = 4;
