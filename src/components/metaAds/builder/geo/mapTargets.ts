// What the targeting map draws, and where it looks. Pure: no React, no DOM.
//
// Targets only — exactly the chosen places, in list order. A country that has
// places chosen inside it runs only as those places (targeting.effectiveLocations),
// so it is not drawn as a whole country. Nothing is ever drawn at a guessed
// point: a place without known coordinates is listed with drawn = false.

export interface MapBox { x: number; y: number; w: number; h: number }

export interface MapItem {
  id: string;
  n: number;
  kind: 'country' | 'region' | 'city' | 'neighborhood' | 'pin';
  name: string;
  code?: string;
  drawn: boolean;
  lat?: number;
  lng?: number;
  /** Cities and pins: the radius Meta will use, km. */
  km?: number;
  ring?: Array<[number, number]>;
}

interface Loc { type: string; key: string; name: string; countryCode?: string | null; radiusKm?: number | null; lat?: number | null; lng?: number | null }

export interface MapDeps {
  centroids: Record<string, [number, number]>;
  georgiaBbox: [number, number, number, number];
  point: (l: Loc) => { lat: number; lng: number } | null;
  ring: (lat: number, lng: number, km: number) => Array<[number, number]>;
  project: (lng: number, lat: number) => [number, number];
}

export const MAP_ASPECT = 1.6;
const DEFAULT_RADIUS_KM = 17;
const COUNTRY_HALF_SPAN = 4; // degrees around a country's centroid when fitting the view

function fit(points: Array<[number, number]>, pad: number, minSpan: number): MapBox {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  let w = Math.max(minSpan, (x1 - x0) * (1 + pad)); let h = Math.max(minSpan / MAP_ASPECT, (y1 - y0) * (1 + pad));
  if (w / h < MAP_ASPECT) w = h * MAP_ASPECT; else h = w / MAP_ASPECT;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function mapTargets(locations: readonly Loc[], minRadiusKm: number | null, d: MapDeps): {
  items: MapItem[]; view: MapBox; scope: 'empty' | 'georgia' | 'world'; georgiaWhole: boolean;
} {
  const refined = new Set(locations.filter((l) => l.type !== 'country').map((l) => String(l.countryCode ?? '').toUpperCase()));
  const shown = locations.filter((l) => l.type !== 'country' || !refined.has(String(l.key).toUpperCase()));
  const pts: Array<[number, number]> = [];
  let georgiaWhole = false;
  const [gx0, gy0, gx1, gy1] = d.georgiaBbox;
  const inGeorgia = (lng: number, lat: number) => lng >= gx0 && lng <= gx1 && lat >= gy0 && lat <= gy1;
  let abroad = false;

  const items: MapItem[] = shown.map((l, i) => {
    const base = { id: `${l.type}:${l.key}`, n: i + 1, kind: l.type as MapItem['kind'], name: l.name };
    if (l.type === 'country') {
      const code = String(l.key).toUpperCase();
      if (code === 'GE') {
        georgiaWhole = true;
        pts.push(d.project(gx0, gy0), d.project(gx1, gy1));
        const c = d.centroids.GE;
        return { ...base, code, drawn: !!c, ...(c ? { lng: c[0], lat: c[1] } : {}) };
      }
      const c = d.centroids[code];
      if (!c) return { ...base, code, drawn: false };
      abroad = true;
      pts.push(d.project(c[0] - COUNTRY_HALF_SPAN, c[1] - COUNTRY_HALF_SPAN), d.project(c[0] + COUNTRY_HALF_SPAN, c[1] + COUNTRY_HALF_SPAN));
      return { ...base, code, drawn: true, lng: c[0], lat: c[1] };
    }
    const p = d.point(l);
    if (!p) return { ...base, drawn: false };
    if (!inGeorgia(p.lng, p.lat)) abroad = true;
    if (l.type === 'city' || l.type === 'pin') {
      const km = Math.max(minRadiusKm ?? 0, Number(l.radiusKm ?? DEFAULT_RADIUS_KM));
      const ring = d.ring(p.lat, p.lng, km);
      for (const [lng, lat] of ring) pts.push(d.project(lng, lat));
      return { ...base, drawn: true, lat: p.lat, lng: p.lng, km, ring };
    }
    pts.push(d.project(p.lng - 0.05, p.lat - 0.05), d.project(p.lng + 0.05, p.lat + 0.05));
    return { ...base, drawn: true, lat: p.lat, lng: p.lng };
  });

  const view = pts.length
    ? fit(pts, 0.25, 0.3)
    // Nothing chosen (or nothing placeable): a neutral view of HOMATCH's home market — a view, not a target.
    : fit([d.project(gx0 + 0.5, gy0 + 0.4), d.project(gx1 - 0.5, gy1 - 0.3)], 0.04, 1);
  return { items, view, scope: items.length === 0 ? 'empty' : abroad ? 'world' : 'georgia', georgiaWhole };
}
