// HOMATCH — source-verified neighbourhood (OpenStreetMap).
//
// The research layer used to hand the report a handful of places it found on
// the web, each with "ფეხით დაახლოებით 3 წუთია" attached. Nobody measured
// those minutes. This module replaces them with something that can be
// checked: the subject's coordinates (from the official cadastral map when we
// have them, otherwise a labelled address geocode), ONE bounded Overpass query
// against OpenStreetMap, and straight-line distances computed here.
//
// What it will and will not say:
//   - distances are straight-line ("პირდაპირი მანძილი"), in metres, rounded;
//     never converted into walking or driving minutes;
//   - route numbers come ONLY from OSM route relations' `ref`; without one we
//     say the open data has no route numbers rather than guessing;
//   - an absence is phrased as "not visible in the open data", because OSM is
//     incomplete and a missing pharmacy on the map is not a missing pharmacy;
//   - the source date is Overpass's own `osm3s.timestamp_osm_base`.
//
// Everything here is pure (no network, no clock unless passed in) so the
// report build and the UI derive the same view from the same stored data.
// The network step lives in neighborhoodFetch.ts.

export const NEIGHBORHOOD_VERSION = 1;
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const NEIGHBORHOOD_RADIUS_M = 1000;
export const STOP_RADIUS_M = 600;
/** Places kept per category in storage, nearest first, after chain dedupe. */
const STORED_PER_CATEGORY = 6;
/** Stops kept in storage. */
const STORED_STOPS = 6;

/*
 * The ms.gov.ge map URL the official worker OPENS before it searches
 * (official-worker/src/workflows/tasmap/selectors.ts). A URL still carrying
 * this centre says nothing about the parcel; only a centre the map moved to
 * after a confirmed cadastral search does.
 */
export const MS_MAP_DEFAULT_CENTER = '44.7433554-41.7850526';

export type CenterBasis = 'MS_MAP_PARCEL' | 'MS_MAP_PARCEL_EARLIER' | 'GEOCODED_ADDRESS';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface NeighborhoodCenter extends GeoPoint {
  basis: CenterBasis;
  /** Parent parcel the official map was centred on, when that is the basis. */
  parcel?: string | null;
  /** Geocoder precision when the basis is an address geocode. */
  precision?: 'HOUSE' | 'STREET' | null;
}

export type NeighborhoodCategory =
  | 'GROCERY' | 'PHARMACY' | 'HEALTH' | 'SCHOOL' | 'KINDERGARTEN'
  | 'PARK' | 'SPORT' | 'FOOD' | 'SERVICES' | 'METRO';

/** The order a buyer reads them in: daily needs, children, health, leisure. */
export const NEIGHBORHOOD_CATEGORY_ORDER: NeighborhoodCategory[] = [
  'GROCERY', 'PHARMACY', 'SCHOOL', 'KINDERGARTEN', 'HEALTH', 'PARK', 'SPORT', 'FOOD', 'SERVICES',
];

export interface NeighborhoodPlace {
  category: NeighborhoodCategory;
  /** name:ka when present, else name, else brand. Null for an unnamed feature. */
  name: string | null;
  /** The OSM tag value that classified it (supermarket, school, park, ...). */
  kind: string;
  /** Straight-line distance from the subject, metres, rounded to 10. */
  distanceM: number;
  /** Chain / identity key used for dedupe ("carrefour"). */
  key: string;
  /** OSM element reference, e.g. "n123", "w45". */
  osm: string;
}

export interface NeighborhoodStop {
  name: string | null;
  distanceM: number;
  /** Route keys "mode:ref" serving this stop, per OSM route relations. */
  routes: string[];
  osm: string;
}

export type TransitMode = 'bus' | 'minibus' | 'trolleybus' | 'tram' | 'subway';

export interface NeighborhoodRoute {
  mode: TransitMode;
  ref: string;
  /** Distance to the nearest stop in the result that this route serves. */
  nearestStopM: number;
}

export interface CategoryCounts {
  r400: number;
  r500: number;
  r1000: number;
}

export type NeighborhoodStatus = 'OK' | 'UNAVAILABLE' | 'NO_LOCATION';

export interface StoredNeighborhood {
  source: 'OSM';
  version: number;
  status: NeighborhoodStatus;
  fetchedAt: string;
  /** Overpass osm3s.timestamp_osm_base: the date of the map data itself. */
  osmBase: string | null;
  radiusM: number;
  stopRadiusM: number;
  center: NeighborhoodCenter | null;
  places: NeighborhoodPlace[];
  counts: Partial<Record<NeighborhoodCategory, CategoryCounts>>;
  stops: NeighborhoodStop[];
  routes: NeighborhoodRoute[];
  /** Route relations near the stops that carry no `ref`. */
  routesWithoutRef: number;
  attribution: string;
  licenseUrl: string;
}

/* ── geometry ───────────────────────────────────────────────────────── */

/** Great-circle distance in metres. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres, rounded to 10 (to 50 beyond a kilometre): honest precision for a map centroid. */
export function roundDistance(m: number): number {
  if (!Number.isFinite(m) || m < 0) return 0;
  return m >= 1000 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
}

/** Roughly Georgia, so a mis-parsed or swapped coordinate is refused. */
export function inGeorgia(p: GeoPoint | null | undefined): p is GeoPoint {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat > 41.0 && p.lat < 43.7 && p.lng > 39.9 && p.lng < 46.8;
}

/* ── where the subject is ───────────────────────────────────────────── */

const MS_MAP_CENTRE = /ms\.gov\.ge\/msmap\/#C=(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)/;

/** The parent parcel of a unit code ("01.18.06.019.055.03.01.601" → "01.18.06.019.055"). */
export function parentParcel(code: unknown): string | null {
  const m = String(code ?? '').trim().match(/^(\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3})(?:\.|$)/);
  return m ? m[1] : null;
}

/** A centre from one ms.gov.ge map URL, unless it is the worker's start view. */
export function centerFromMsMapUrl(url: unknown): GeoPoint | null {
  const m = String(url ?? '').match(MS_MAP_CENTRE);
  if (!m) return null;
  if (`${m[1]}-${m[2]}` === MS_MAP_DEFAULT_CENTER) return null;
  const p = { lng: Number(m[1]), lat: Number(m[2]) };
  return inGeorgia(p) ? p : null;
}

/**
 * The parcel centre from the official worker's cadastral map traversal.
 *
 * Only a SEARCH_CONFIRMED result for the same parent parcel counts, and only a
 * URL the map moved to after that search (never the start view it opened on).
 */
export function centerFromBrowserOfficial(browserOfficial: unknown, parcel: string | null): GeoPoint | null {
  if (!parcel) return null;
  const results = (browserOfficial as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (e.status !== 'SEARCH_CONFIRMED') continue;
    if (parentParcel(e.queryEntered) !== parcel) continue;
    const urls = [e.finalUrl, e.frameUrl, ...(Array.isArray(e.frameUrls) ? e.frameUrls : [])];
    for (const u of urls) {
      const p = centerFromMsMapUrl(u);
      if (p) return p;
    }
  }
  return null;
}

/** Address text a geocoder can read: Georgian "ქ." spelled out as "ქუჩა". */
export function geocodeQuery(address: unknown): string | null {
  const a = String(address ?? '').replace(/\s+/g, ' ').trim();
  if (!a || !/\d/.test(a)) return null; // a street without a number is too coarse to measure from
  return a.replace(/(^|[\s,])ქ\.(?=\s|,|$)/g, '$1ქუჩა').replace(/\bSt\.?(?=\s|,|$)/g, 'Street');
}

/** Nominatim's first hit, accepted only at house or street precision. */
export function parseNominatim(json: unknown): { lat: number; lng: number; precision: 'HOUSE' | 'STREET' } | null {
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit || typeof hit !== 'object') return null;
  const h = hit as Record<string, unknown>;
  const p = { lat: Number(h.lat), lng: Number(h.lon) };
  if (!inGeorgia(p)) return null;
  const t = String(h.addresstype ?? h.type ?? '').toLowerCase();
  const cls = String(h.category ?? h.class ?? '').toLowerCase();
  if (['house', 'building', 'residential', 'apartments'].includes(t) || cls === 'building') {
    return { ...p, precision: 'HOUSE' };
  }
  if (['road', 'street'].includes(t) || cls === 'highway') return { ...p, precision: 'STREET' };
  return null;
}

/* ── the query ──────────────────────────────────────────────────────── */

/** One bounded Overpass QL query: places, stops, and the route relations serving those stops. */
export function buildOverpassQuery(c: GeoPoint, radiusM = NEIGHBORHOOD_RADIUS_M, stopRadiusM = STOP_RADIUS_M): string {
  const at = `${c.lat.toFixed(7)},${c.lng.toFixed(7)}`;
  const R = `around:${Math.round(radiusM)},${at}`;
  const S = `around:${Math.round(stopRadiusM)},${at}`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr(${R})[amenity~"^(school|kindergarten|childcare|clinic|hospital|doctors|dentist|pharmacy|cafe|restaurant|bank|post_office)$"];`,
    `  nwr(${R})[shop~"^(supermarket|convenience|greengrocer|bakery|butcher|deli|department_store|mall|hairdresser|beauty|laundry|dry_cleaning)$"];`,
    `  nwr(${R})[leisure~"^(park|garden|playground|fitness_centre|sports_centre|swimming_pool)$"];`,
    `  nwr(${R})[healthcare~"^(clinic|hospital|doctor|dentist|pharmacy|centre)$"];`,
    `  nwr(${R})[station=subway];`,
    ')->.poi;',
    '(',
    `  node(${S})[highway=bus_stop];`,
    `  nwr(${S})[public_transport~"^(platform|stop_position)$"];`,
    ')->.stops;',
    '(rel(bn.stops); rel(bw.stops);)->.rr;',
    'rel.rr[type=route][route~"^(bus|minibus|trolleybus|share_taxi|tram|subway)$"]->.routes;',
    '.poi out center tags;',
    '.stops out center tags;',
    '.routes out body;',
  ].join('\n');
}

/* ── parsing ────────────────────────────────────────────────────────── */

type Tags = Record<string, string>;
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Tags;
  members?: { type: string; ref: number; role?: string }[];
}

const ref = (type: string, id: number) => `${type[0]}${id}`;

function pointOf(e: OsmElement): GeoPoint | null {
  if (typeof e.lat === 'number' && typeof e.lon === 'number') return { lat: e.lat, lng: e.lon };
  if (e.center && typeof e.center.lat === 'number') return { lat: e.center.lat, lng: e.center.lon };
  return null;
}

const isPrivate = (t: Tags) => t.access === 'private' || t.access === 'no';

/** The category a feature belongs to, or null when it is none of ours. */
export function categorize(t: Tags | undefined): { category: NeighborhoodCategory; kind: string } | null {
  if (!t) return null;
  const a = t.amenity, s = t.shop, l = t.leisure, h = t.healthcare;
  if (t.station === 'subway' || (t.railway === 'station' && t.subway === 'yes')) return { category: 'METRO', kind: 'subway' };
  if (a === 'school') return { category: 'SCHOOL', kind: a };
  if (a === 'kindergarten' || a === 'childcare') return { category: 'KINDERGARTEN', kind: a };
  if (a === 'pharmacy' || h === 'pharmacy') return { category: 'PHARMACY', kind: 'pharmacy' };
  if (a && ['clinic', 'hospital', 'doctors', 'dentist'].includes(a)) return { category: 'HEALTH', kind: a };
  if (h && ['clinic', 'hospital', 'doctor', 'dentist', 'centre'].includes(h)) return { category: 'HEALTH', kind: h };
  if (s && ['supermarket', 'convenience', 'greengrocer', 'bakery', 'butcher', 'deli', 'department_store', 'mall'].includes(s)) {
    return { category: 'GROCERY', kind: s };
  }
  if (l && ['park', 'garden', 'playground'].includes(l)) return isPrivate(t) ? null : { category: 'PARK', kind: l };
  if (l && ['fitness_centre', 'sports_centre', 'swimming_pool'].includes(l)) return isPrivate(t) ? null : { category: 'SPORT', kind: l };
  if (a === 'cafe' || a === 'restaurant') return { category: 'FOOD', kind: a };
  if (s && ['hairdresser', 'beauty', 'laundry', 'dry_cleaning'].includes(s)) return { category: 'SERVICES', kind: s };
  if (a === 'bank' || a === 'post_office') return { category: 'SERVICES', kind: a };
  return null;
}

/** The display name: Georgian first, then the local name, then the brand. */
export function displayName(t: Tags | undefined): string | null {
  if (!t) return null;
  const v = t['name:ka'] || t.name || t['brand:ka'] || t.brand || '';
  const clean = v.replace(/\s+/g, ' ').trim();
  return clean || null;
}

const norm = (s: string) => s.toLowerCase().replace(/[«»„“"'’.,()\-–—№#]/g, ' ').replace(/\s+/g, ' ').trim();

/** Identity for chain dedupe: one Carrefour per category, the nearest. */
export function chainKey(t: Tags | undefined, fallback: string): string {
  if (!t) return fallback;
  const k = t['brand:wikidata'] || t.brand || t['brand:en'] || t['name:en'] || t.name || t['name:ka'];
  return k ? norm(k) : fallback;
}

function isStop(t: Tags | undefined): boolean {
  if (!t) return false;
  return t.highway === 'bus_stop' || t.public_transport === 'platform' || t.public_transport === 'stop_position';
}

const MODE: Record<string, TransitMode> = {
  bus: 'bus', minibus: 'minibus', share_taxi: 'minibus', trolleybus: 'trolleybus', tram: 'tram', subway: 'subway',
};

const refOrder = (a: string, b: string) => {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
};

export interface ParsedOverpass {
  osmBase: string | null;
  places: NeighborhoodPlace[];
  counts: Partial<Record<NeighborhoodCategory, CategoryCounts>>;
  stops: NeighborhoodStop[];
  routes: NeighborhoodRoute[];
  routesWithoutRef: number;
}

/** True when Overpass answered but the query itself failed (timeout, memory). */
export function overpassFailed(json: unknown): boolean {
  if (!json || typeof json !== 'object') return true;
  const j = json as { elements?: unknown; remark?: unknown };
  if (!Array.isArray(j.elements)) return true;
  return typeof j.remark === 'string' && /runtime error|timed out|out of memory/i.test(j.remark) && j.elements.length === 0;
}

/**
 * Overpass JSON → categorised places, grouped stops and numbered routes.
 * Distances are measured from `center`; nothing is estimated beyond that.
 */
export function parseOverpass(json: unknown, center: GeoPoint, radiusM = NEIGHBORHOOD_RADIUS_M, stopRadiusM = STOP_RADIUS_M): ParsedOverpass {
  const j = (json && typeof json === 'object' ? json : {}) as { elements?: OsmElement[]; osm3s?: { timestamp_osm_base?: string } };
  const elements = Array.isArray(j.elements) ? j.elements : [];
  const osmBase = typeof j.osm3s?.timestamp_osm_base === 'string' ? j.osm3s.timestamp_osm_base : null;

  const seen = new Set<string>();
  // Exact distance travels beside each place for ordering; only the rounded one is stored.
  const all: { place: NeighborhoodPlace; d: number }[] = [];
  const stopEls: { el: OsmElement; d: number; name: string | null }[] = [];
  const routeEls: OsmElement[] = [];

  for (const el of elements) {
    if (!el || typeof el !== 'object' || !el.type) continue;
    const id = ref(el.type, el.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (el.type === 'relation' && el.tags?.type === 'route') {
      routeEls.push(el);
      continue;
    }
    const p = pointOf(el);
    if (!p) continue;
    const d = haversineM(center, p);
    if (isStop(el.tags)) {
      if (d <= stopRadiusM) stopEls.push({ el, d, name: displayName(el.tags) });
      continue;
    }
    const c = categorize(el.tags);
    if (!c || d > radiusM) continue;
    all.push({
      d,
      place: {
        category: c.category,
        name: displayName(el.tags),
        kind: c.kind,
        distanceM: roundDistance(d),
        key: chainKey(el.tags, id),
        osm: id,
      },
    });
  }
  all.sort((a, b) => a.d - b.d);

  const counts: Partial<Record<NeighborhoodCategory, CategoryCounts>> = {};
  for (const { place, d } of all) {
    const c = (counts[place.category] ??= { r400: 0, r500: 0, r1000: 0 });
    if (d <= 400) c.r400++;
    if (d <= 500) c.r500++;
    if (d <= 1000) c.r1000++;
  }

  // Nearest of each chain per category, then the nearest few per category.
  const kept: NeighborhoodPlace[] = [];
  const perCat = new Map<NeighborhoodCategory, number>();
  const chains = new Set<string>();
  for (const { place } of all) {
    const k = `${place.category}|${place.key}`;
    if (chains.has(k)) continue;
    chains.add(k);
    const n = perCat.get(place.category) ?? 0;
    if (n >= STORED_PER_CATEGORY) continue;
    perCat.set(place.category, n + 1);
    kept.push(place);
  }

  /* Stops: a platform and its stop_position are one stop to a buyer. Group by
     name; an unnamed element joins the nearest group within 80 m. */
  stopEls.sort((a, b) => a.d - b.d);
  interface Group { name: string | null; d: number; at: GeoPoint; members: Set<string>; osm: string }
  const groups: Group[] = [];
  const byName = new Map<string, Group>();
  for (const s of stopEls) {
    const id = ref(s.el.type, s.el.id);
    const at = pointOf(s.el)!;
    let g = s.name ? byName.get(norm(s.name)) : groups.find((x) => haversineM(x.at, at) <= 80);
    if (!g) {
      g = { name: s.name, d: s.d, at, members: new Set(), osm: id };
      groups.push(g);
      if (s.name) byName.set(norm(s.name), g);
    }
    g.members.add(id);
    if (s.d < g.d) g.d = s.d;
  }

  const routeMap = new Map<string, NeighborhoodRoute>();
  const stopRoutes = new Map<Group, Set<string>>();
  let routesWithoutRef = 0;
  const unnumbered = new Set<string>();
  for (const r of routeEls) {
    const mode = MODE[String(r.tags?.route ?? '')];
    if (!mode) continue;
    const served = groups.filter((g) => (r.members ?? []).some((m) => g.members.has(ref(m.type, m.ref))));
    if (!served.length) continue;
    const rf = String(r.tags?.ref ?? '').trim();
    if (!rf) {
      const k = String(r.tags?.name ?? r.id);
      if (!unnumbered.has(k)) { unnumbered.add(k); routesWithoutRef++; }
      continue;
    }
    const key = `${mode}:${rf}`;
    const near = Math.min(...served.map((g) => g.d));
    const prev = routeMap.get(key);
    if (!prev || near < prev.nearestStopM) routeMap.set(key, { mode, ref: rf, nearestStopM: near });
    for (const g of served) {
      if (!stopRoutes.has(g)) stopRoutes.set(g, new Set());
      stopRoutes.get(g)!.add(key);
    }
  }

  const stops: NeighborhoodStop[] = groups
    .sort((a, b) => a.d - b.d)
    .slice(0, STORED_STOPS)
    .map((g) => ({
      name: g.name,
      distanceM: roundDistance(g.d),
      routes: [...(stopRoutes.get(g) ?? [])].sort((a, b) => refOrder(a.split(':')[1], b.split(':')[1])),
      osm: g.osm,
    }));

  const routes = [...routeMap.values()]
    .map((r) => ({ ...r, nearestStopM: roundDistance(r.nearestStopM) }))
    .sort((a, b) => a.nearestStopM - b.nearestStopM || refOrder(a.ref, b.ref));

  return { osmBase, places: kept, counts, stops, routes, routesWithoutRef };
}

/** The record stored in synthesis_json.location.neighborhood. */
export function buildStoredNeighborhood(input: {
  status: NeighborhoodStatus;
  center: NeighborhoodCenter | null;
  fetchedAt: string;
  parsed?: ParsedOverpass | null;
}): StoredNeighborhood {
  const p = input.parsed;
  return {
    source: 'OSM',
    version: NEIGHBORHOOD_VERSION,
    status: input.status,
    fetchedAt: input.fetchedAt,
    osmBase: p?.osmBase ?? null,
    radiusM: NEIGHBORHOOD_RADIUS_M,
    stopRadiusM: STOP_RADIUS_M,
    center: input.center,
    places: p?.places ?? [],
    counts: p?.counts ?? {},
    stops: p?.stops ?? [],
    routes: p?.routes ?? [],
    routesWithoutRef: p?.routesWithoutRef ?? 0,
    attribution: OSM_ATTRIBUTION,
    licenseUrl: OSM_COPYRIGHT_URL,
  };
}

/** A stored lookup good enough to reuse on rebuild without refetching. */
export function reusableNeighborhood(prev: unknown, nowMs: number, maxAgeDays = 30): StoredNeighborhood | null {
  if (!prev || typeof prev !== 'object') return null;
  const n = prev as StoredNeighborhood;
  if (n.source !== 'OSM' || n.version !== NEIGHBORHOOD_VERSION || n.status !== 'OK') return null;
  if (!inGeorgia(n.center)) return null;
  const at = Date.parse(n.fetchedAt);
  if (!Number.isFinite(at) || nowMs - at > maxAgeDays * 86400000) return null;
  return n;
}

/* ── what it means ──────────────────────────────────────────────────── */

/** An i18n key and its {{vars}}: the sentence is translated, the facts are not. */
export interface NeighborhoodPoint {
  key: string;
  vars?: Record<string, string>;
}

export interface NeighborhoodView {
  status: NeighborhoodStatus;
  categories: { category: NeighborhoodCategory; counts: CategoryCounts; top: NeighborhoodPlace[] }[];
  stops: NeighborhoodStop[];
  /** Route refs grouped by mode, nearest first. */
  routesByMode: { mode: TransitMode; refs: string[] }[];
  metro: NeighborhoodPlace | null;
  pros: NeighborhoodPoint[];
  cons: NeighborhoodPoint[];
  routesAvailable: boolean;
}

const ZERO: CategoryCounts = { r400: 0, r500: 0, r1000: 0 };

/**
 * The buyer-facing reading of a stored lookup, deterministically.
 *
 * Pros and cons are derived from counts and distances only; each one names
 * the radius or the measured distance it rests on, so it can be checked on
 * any map.
 */
export function neighborhoodView(n: StoredNeighborhood | null | undefined, topPerCategory = 3): NeighborhoodView | null {
  if (!n || n.source !== 'OSM') return null;
  const places = Array.isArray(n.places) ? n.places : [];
  const counts = n.counts ?? {};
  const cnt = (c: NeighborhoodCategory) => counts[c] ?? ZERO;
  const nearest = (c: NeighborhoodCategory, named = true) =>
    places.filter((p) => p.category === c && (!named || p.name)).sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;

  const categories = NEIGHBORHOOD_CATEGORY_ORDER
    .map((category) => ({
      category,
      counts: cnt(category),
      top: places.filter((p) => p.category === category && p.name).sort((a, b) => a.distanceM - b.distanceM).slice(0, topPerCategory),
    }))
    .filter((c) => c.counts.r1000 > 0 || c.top.length > 0);

  const stops = (Array.isArray(n.stops) ? n.stops : []).slice().sort((a, b) => a.distanceM - b.distanceM);
  const routes = (Array.isArray(n.routes) ? n.routes : []).slice().sort((a, b) => a.nearestStopM - b.nearestStopM);
  const modes: TransitMode[] = ['subway', 'bus', 'minibus', 'trolleybus', 'tram'];
  const routesByMode = modes
    .map((mode) => ({ mode, refs: [...new Set(routes.filter((r) => r.mode === mode).map((r) => r.ref))] }))
    .filter((g) => g.refs.length);
  const metro = nearest('METRO', false);

  const pros: NeighborhoodPoint[] = [];
  const cons: NeighborhoodPoint[] = [];
  if (n.status !== 'OK') {
    return { status: n.status, categories: [], stops: [], routesByMode: [], metro: null, pros, cons, routesAvailable: false };
  }

  const m = (d: number) => String(d);

  // Getting around.
  const stop = stops[0] ?? null;
  if (stop && stop.distanceM <= 400) {
    const refs = [...new Set(routes.filter((r) => r.nearestStopM <= 400).map((r) => r.ref))].slice(0, 8);
    if (refs.length) pros.push({ key: 'verify_nb_pro_transit', vars: { distance: m(stop.distanceM), routes: refs.join(', ') } });
    else pros.push({ key: 'verify_nb_pro_stop', vars: { distance: m(stop.distanceM) } });
  } else if (!stop) {
    cons.push({ key: 'verify_nb_con_transit', vars: { radius: m(n.stopRadiusM ?? STOP_RADIUS_M) } });
  }
  if (metro?.name && metro.distanceM <= 1000) {
    pros.push({ key: 'verify_nb_pro_metro', vars: { name: metro.name, distance: m(metro.distanceM) } });
  }

  // Daily needs.
  const daily = cnt('GROCERY').r400 + cnt('PHARMACY').r400;
  if (daily >= 3) pros.push({ key: 'verify_nb_pro_daily', vars: { count: String(daily) } });
  else if (cnt('GROCERY').r400 === 0) cons.push({ key: 'verify_nb_con_daily' });
  if (cnt('PHARMACY').r500 === 0) cons.push({ key: 'verify_nb_con_pharmacy' });

  // Children.
  const school = nearest('SCHOOL');
  if (school && school.distanceM <= 800) pros.push({ key: 'verify_nb_pro_school', vars: { name: school.name!, distance: m(school.distanceM) } });
  else if (cnt('SCHOOL').r1000 === 0) cons.push({ key: 'verify_nb_con_school' });
  const kg = nearest('KINDERGARTEN');
  if (kg && kg.distanceM <= 600) pros.push({ key: 'verify_nb_pro_kindergarten', vars: { name: kg.name!, distance: m(kg.distanceM) } });
  else if (cnt('KINDERGARTEN').r1000 === 0) cons.push({ key: 'verify_nb_con_kindergarten' });

  // Health.
  const clinic = nearest('HEALTH');
  if (clinic && clinic.distanceM <= 800) pros.push({ key: 'verify_nb_pro_health', vars: { name: clinic.name!, distance: m(clinic.distanceM) } });

  // Green space and leisure.
  const parks = cnt('PARK').r500;
  if (parks >= 1) pros.push({ key: 'verify_nb_pro_parks', vars: { count: String(parks) } });
  else cons.push({ key: 'verify_nb_con_parks' });
  const sport = nearest('SPORT');
  if (sport && sport.distanceM <= 1000) pros.push({ key: 'verify_nb_pro_sport', vars: { name: sport.name!, distance: m(sport.distanceM) } });
  if (cnt('FOOD').r500 >= 3) pros.push({ key: 'verify_nb_pro_food', vars: { count: String(cnt('FOOD').r500) } });

  return { status: n.status, categories, stops: stops.slice(0, 4), routesByMode, metro, pros, cons, routesAvailable: routes.length > 0 };
}
