// HOMATCH — the network step behind neighborhood.ts.
//
// Runs inside verify-synthesis at report (re)build time, never when a report
// is opened: the result is stored in synthesis_json.location.neighborhood and
// a rebuild within 30 days reuses it without touching the network.
//
// Two free, open services, used within their published policies:
//   - OSM Nominatim (geocoding fallback only): one request, identifying
//     User-Agent, at most one request per second per isolate;
//   - Overpass API: ONE bounded query (timeout 25 s server side), with a
//     single mirror as fallback.
// No paid acquisition. Any failure yields status UNAVAILABLE, and the report
// says the open-data lookup was unavailable. There is no LLM fallback.

import {
  buildOverpassQuery,
  buildStoredNeighborhood,
  centerFromBrowserOfficial,
  centerFromCadastralPlan,
  geocodeQueries,
  overpassFailed,
  parentParcel,
  parseNominatim,
  parseOverpass,
  reusableNeighborhood,
  inGeorgia,
  type NeighborhoodCenter,
  type StoredNeighborhood,
} from './neighborhood.ts';

export const NEIGHBORHOOD_USER_AGENT = 'HOMATCH-Verify/1.0 (+https://homatch.live; neighbourhood lookup)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let lastNominatimAt = 0;

async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Address → coordinates via Nominatim, house or street precision only. */
export async function geocodeAddress(address: unknown, fetchImpl: FetchLike = fetch): Promise<NeighborhoodCenter | null> {
  for (const q of geocodeQueries(address)) {
    const hit = await geocodeOnce(q, fetchImpl);
    if (hit) return hit;
  }
  return null;
}

async function geocodeOnce(q: string, fetchImpl: FetchLike): Promise<NeighborhoodCenter | null> {
  // Nominatim usage policy: no more than one request per second.
  const wait = lastNominatimAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=ge&accept-language=ka&q=${encodeURIComponent(q)}`;
    const json = await timed(6000, async (signal) => {
      const res = await fetchImpl(url, { signal, headers: { 'User-Agent': NEIGHBORHOOD_USER_AGENT, Accept: 'application/json' } });
      return res.ok ? await res.json() : null;
    });
    const hit = parseNominatim(json);
    return hit ? { lat: hit.lat, lng: hit.lng, basis: 'GEOCODED_ADDRESS', precision: hit.precision } : null;
  } catch {
    return null;
  }
}

async function overpass(query: string, fetchImpl: FetchLike): Promise<unknown | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await timed(30000, async (signal) => {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          signal,
          headers: { 'User-Agent': NEIGHBORHOOD_USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: `data=${encodeURIComponent(query)}`,
        });
        return res.ok ? await res.json() : null;
      });
      if (json && !overpassFailed(json)) return json;
    } catch {
      /* try the mirror */
    }
  }
  return null;
}

export interface ResolveNeighborhoodInput {
  resultJson: unknown;
  query: string | null;
  address: string | null | undefined;
  /** The previous build's stored lookup (synthesis_json.location.neighborhood). */
  previous: unknown;
  /** browserOfficial blocks of earlier jobs for the same parent parcel. */
  earlierBrowserOfficial?: (parcel: string) => Promise<unknown[]>;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/**
 * The stored neighbourhood for this build: reused when fresh, otherwise
 * centre → Overpass → parsed. Never throws.
 */
export async function resolveNeighborhood(input: ResolveNeighborhoodInput): Promise<StoredNeighborhood> {
  const now = input.now ?? (() => new Date());
  const fetchImpl = input.fetchImpl ?? fetch;
  const reused = reusableNeighborhood(input.previous, now().getTime());
  if (reused) return reused;

  try {
    const rj = (input.resultJson ?? {}) as Record<string, unknown>;
    const exact = (rj.exactUnit ?? {}) as Record<string, unknown>;
    const parcel = parentParcel(exact.code ?? exact.cadastralCode ?? input.query);

    let center: NeighborhoodCenter | null = null;
    const own = centerFromBrowserOfficial(rj.browserOfficial, parcel);
    if (own) center = { ...own, basis: 'MS_MAP_PARCEL', parcel };
    // v6 (job eeefada9): the official cadastral plan's UTM grid, read by the same traversal.
    if (!center) {
      const plan = centerFromCadastralPlan(rj.browserOfficial, parcel);
      if (plan) center = { ...plan, basis: 'CADASTRAL_PLAN', parcel };
    }
    if (!center && parcel && input.earlierBrowserOfficial) {
      try {
        const earlier = await input.earlierBrowserOfficial(parcel);
        for (const bo of earlier) {
          const p = centerFromBrowserOfficial(bo, parcel);
          if (p) { center = { ...p, basis: 'MS_MAP_PARCEL_EARLIER', parcel }; break; }
        }
        for (const bo of center ? [] : earlier) {
          const p = centerFromCadastralPlan(bo, parcel);
          if (p) { center = { ...p, basis: 'CADASTRAL_PLAN', parcel }; break; }
        }
      } catch { /* an unreadable earlier job is no centre, not an error */ }
    }
    if (!center) {
      const prevCenter = (input.previous as StoredNeighborhood | null)?.center;
      if (prevCenter && inGeorgia(prevCenter)) center = prevCenter; // the cached geocode, not a second request
    }
    if (!center) center = await geocodeAddress(input.address, fetchImpl);
    if (!center) return buildStoredNeighborhood({ status: 'NO_LOCATION', center: null, fetchedAt: now().toISOString() });

    const json = await overpass(buildOverpassQuery(center), fetchImpl);
    if (!json) return buildStoredNeighborhood({ status: 'UNAVAILABLE', center, fetchedAt: now().toISOString() });
    return buildStoredNeighborhood({ status: 'OK', center, fetchedAt: now().toISOString(), parsed: parseOverpass(json, center) });
  } catch {
    return buildStoredNeighborhood({ status: 'UNAVAILABLE', center: null, fetchedAt: now().toISOString() });
  }
}
