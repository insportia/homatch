/*
 * WHERE A PARCEL IS, BY NAME, ANYWHERE IN GEORGIA (owner 2026-10-24: "it must
 * work for every city in Georgia, every district and street").
 *
 * The market search names a city and a district; MyHome and SS.ge resolve
 * those names against their own live dictionaries for every city they list.
 * The names used to come only from the register extract or the identity
 * model, so a parcel whose exact centre the cadastral map gave was never
 * searched when neither named its district (prod a7177a89). This turns the
 * parcel centre into the names the portals know: Nominatim reverse (Georgian
 * names), and Overpass is_in over the administrative boundaries when
 * Nominatim does not answer. Every name is only a candidate: a portal that
 * does not know one searches nothing for it, never the whole city.
 */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PlaceNames {
  city: string | null;
  /** Most specific first: neighbourhood, quarter, suburb, city district, district. */
  localities: string[];
  street: string | null;
  source: 'NOMINATIM' | 'OVERPASS' | null;
}

const UA = 'HOMATCH-Verify/1.0 (+https://homatch.live; market locality lookup)';
const REFERER = 'https://homatch.live/';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/** Georgia's bounding box: a point outside it is never looked up. */
export function inGeorgia(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && typeof lon === 'number' && lat > 41.0 && lat < 43.6 && lon > 39.9 && lon < 46.8;
}

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s && s.length <= 80 ? s : null;
};

function uniq(list: Array<string | null>): string[] {
  const out: string[] = [];
  for (const s of list) if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  return out;
}

/** A Nominatim reverse answer → names, most specific first. */
export function placeFromNominatim(json: any): PlaceNames | null {
  const a = json?.address;
  if (!a || typeof a !== 'object') return null;
  const city = clean(a.city) ?? clean(a.town) ?? clean(a.village) ?? clean(a.municipality) ?? null;
  const localities = uniq([clean(a.neighbourhood), clean(a.quarter), clean(a.suburb), clean(a.city_district), clean(a.district),
    // A village or town inside a municipality is itself the locality the portals file it under.
    city && clean(a.municipality) && city !== clean(a.municipality) ? city : null]);
  if (!city && !localities.length) return null;
  return { city, localities, street: clean(a.road), source: 'NOMINATIM' };
}

/** Overpass is_in areas → names: admin level 8 is the city or village, 9-10 its districts. */
export function placeFromOverpass(json: any): PlaceNames | null {
  const els = Array.isArray(json?.elements) ? json.elements : [];
  const named = els
    .map((e: any) => ({ level: Number(e?.tags?.admin_level), name: clean(e?.tags?.['name:ka']) ?? clean(e?.tags?.name), place: e?.tags?.place }))
    .filter((e: any) => e.name && Number.isFinite(e.level));
  if (!named.length) return null;
  const byLevel = (min: number, max: number) => named.filter((e: any) => e.level >= min && e.level <= max).sort((x: any, y: any) => y.level - x.level).map((e: any) => e.name as string);
  const city = byLevel(7, 8)[0] ?? byLevel(6, 6)[0] ?? null;
  const localities = uniq(byLevel(9, 11));
  return { city, localities, street: null, source: 'OVERPASS' };
}

async function getJson(fetchImpl: FetchLike, url: string, init: RequestInit, ms: number): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The names a parcel centre is filed under, or null when nothing answered. */
export async function placeNamesAt(lat: number, lon: number, fetchImpl: FetchLike = fetch): Promise<PlaceNames | null> {
  if (!inGeorgia(lat, lon)) return null;
  const headers = { 'User-Agent': UA, Referer: REFERER, Accept: 'application/json' };
  const nom = await getJson(fetchImpl, `${NOMINATIM_REVERSE}?format=jsonv2&addressdetails=1&zoom=17&accept-language=ka&lat=${lat}&lon=${lon}`, { headers }, 7000);
  const fromNom = placeFromNominatim(nom);
  if (fromNom && fromNom.city && fromNom.localities.length) return fromNom;
  const q = `[out:json][timeout:15];is_in(${lat},${lon})->.a;area.a[boundary=administrative][admin_level~"^(6|7|8|9|10|11)$"];out tags;`;
  for (const endpoint of OVERPASS) {
    const ov = await getJson(fetchImpl, endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}` }, 15000);
    const fromOv = placeFromOverpass(ov);
    if (fromOv) {
      // Keep whatever Nominatim did give (its city, its suburb) alongside the boundaries.
      return { city: fromNom?.city ?? fromOv.city, localities: uniq([...(fromNom?.localities ?? []), ...fromOv.localities]), street: fromNom?.street ?? null, source: 'OVERPASS' };
    }
  }
  return fromNom;
}
