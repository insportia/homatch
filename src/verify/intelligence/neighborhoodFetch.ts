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
  centersFromSituationalDrawings,
  geocodeQueries,
  haversineM,
  overpassFailed,
  parentParcel,
  parseNominatim,
  queryHouseNumber,
  parseOverpass,
  reusableNeighborhood,
  inGeorgia,
  type CenterCandidate,
  type NeighborhoodCenter,
  type StoredNeighborhood,
} from './neighborhood.ts';
import { centerConfidence, chooseCenter, type CenterDecision } from './locationCenter.ts';

export const NEIGHBORHOOD_USER_AGENT = 'HOMATCH-Verify/1.0 (+https://homatch.live; neighbourhood lookup)';
/* Nominatim's policy asks for an identifying User-Agent or Referer; a runtime
   that rewrites the User-Agent still sends this. */
export const NEIGHBORHOOD_REFERER = 'https://homatch.live/';
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
export async function geocodeAddress(address: unknown, fetchImpl: FetchLike = fetch, diag?: string[]): Promise<NeighborhoodCenter | null> {
  for (const q of geocodeQueries(address)) {
    const hit = await geocodeOnce(q, fetchImpl, diag);
    if (hit) return hit;
  }
  return null;
}

/*
 * Job 61c1c38c (2026-10-22): three geocodes of "წყნეთის გზატკეცილი 31,
 * თბილისი" from the edge came back empty within ~4 s, while the same query
 * from a workstation returns the house at house precision. Every failure was
 * swallowed, so a 403 could not be told from a miss. `diag` records what each
 * request answered (HTTP status, timeout, error, no_match), never the address.
 */
async function geocodeOnce(q: string, fetchImpl: FetchLike, diag?: string[]): Promise<NeighborhoodCenter | null> {
  // Nominatim usage policy: no more than one request per second.
  const wait = lastNominatimAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=1&countrycodes=ge&accept-language=ka&q=${encodeURIComponent(q)}`;
    const json = await timed(6000, async (signal) => {
      const res = await fetchImpl(url, { signal, headers: { 'User-Agent': NEIGHBORHOOD_USER_AGENT, Referer: NEIGHBORHOOD_REFERER, Accept: 'application/json' } });
      if (!res.ok) diag?.push(String(res.status));
      return res.ok ? await res.json() : null;
    });
    const hit = parseNominatim(json, queryHouseNumber(q));
    if (json && !hit) diag?.push('no_match');
    // `evidence` is the query that matched: the cache key on rebuild.
    return hit ? { lat: hit.lat, lng: hit.lng, basis: 'GEOCODED_ADDRESS', precision: hit.precision, evidence: q } : null;
  } catch (e) {
    diag?.push((e as Error)?.name === 'AbortError' ? 'timeout' : 'error');
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

/** Official centres one browserOfficial block carries for `parcel`, each with provenance. */
export function officialCenterCandidates(browserOfficial: unknown, parcel: string | null, earlier = false): NeighborhoodCenter[] {
  if (!parcel) return [];
  const out: NeighborhoodCenter[] = [];
  const at = retrievedAtOf(browserOfficial, parcel);
  const own = centerFromBrowserOfficial(browserOfficial, parcel);
  if (own) out.push({ ...own, basis: earlier ? 'MS_MAP_PARCEL_EARLIER' : 'MS_MAP_PARCEL', parcel, evidence: 'ms.gov.ge map view after the cadastral search', retrievedAt: at });
  const plan = centerFromCadastralPlan(browserOfficial, parcel);
  if (plan) out.push({ ...plan, basis: 'CADASTRAL_PLAN', parcel, evidence: 'NAPR cadastral plan (WGS 84 / UTM 38N grid)', retrievedAt: at });
  for (const d of centersFromSituationalDrawings(browserOfficial, parcel)) {
    // A legacy sheet that prints this parcel's code is its cadastral plan (HIGH); one that does not is a drawing (MEDIUM).
    out.push({
      lat: d.lat, lng: d.lng, basis: d.namesParcel ? 'CADASTRAL_PLAN' : 'SITUATIONAL_DRAWING', parcel,
      evidence: d.namesParcel ? `${d.evidence ?? 'NAPR'} (legacy cadastral plan, UTM 38N grid)` : d.evidence, retrievedAt: d.retrievedAt ?? at,
    });
  }
  return out;
}

function retrievedAtOf(browserOfficial: unknown, parcel: string): string | null {
  const results = (browserOfficial as { results?: unknown } | null)?.results;
  for (const r of Array.isArray(results) ? results : []) {
    const e = (r ?? {}) as Record<string, unknown>;
    if (parentParcel(e.queryEntered) === parcel && typeof e.retrievedAt === 'string') return e.retrievedAt;
  }
  return null;
}

export interface ResolvedSubjectCenter extends CenterDecision {
  /** Nominatim answers this run, for the log: HTTP status, 'timeout', 'error' or 'no_match'. */
  geocode: string[];
}

/**
 * The subject's centre with every candidate and its provenance (locationCenter.ts
 * decides). Official candidates first; the address is geocoded only when no
 * HIGH official centre exists and no earlier geocode is stored for it.
 * Never throws.
 */
export async function resolveSubjectCenter(input: ResolveNeighborhoodInput): Promise<ResolvedSubjectCenter> {
  const now = input.now ?? (() => new Date());
  const fetchImpl = input.fetchImpl ?? fetch;
  const geocode: string[] = [];
  try {
    const rj = (input.resultJson ?? {}) as Record<string, unknown>;
    const exact = (rj.exactUnit ?? {}) as Record<string, unknown>;
    const parcel = parentParcel(exact.code ?? exact.cadastralCode ?? input.query);
    const cands: NeighborhoodCenter[] = officialCenterCandidates(rj.browserOfficial, parcel);
    const hasHigh = () => cands.some((c) => centerConfidence(c) === 'HIGH');

    if (!hasHigh() && parcel && input.earlierBrowserOfficial) {
      try {
        for (const bo of await input.earlierBrowserOfficial(parcel)) {
          for (const c of officialCenterCandidates(bo, parcel, true)) {
            if (!cands.some((o) => o.basis === c.basis && haversineM(o, c) < 10)) cands.push(c);
          }
        }
      } catch { /* an unreadable earlier job is no centre, not an error */ }
    }

    const prev = (input.previous ?? null) as StoredNeighborhood | null;
    // The previous build's geocode is the cache: one Nominatim answer per address.
    // With a HIGH centre it is still compared (and flagged), never re-requested.
    const queries = geocodeQueries(input.address);
    const stored: NeighborhoodCenter[] = [...(Array.isArray(prev?.candidates) ? prev!.candidates : []), ...(prev?.center ? [prev.center] : [])];
    const cached = stored.find((c) => c?.basis === 'GEOCODED_ADDRESS' && inGeorgia(c) && (!c.evidence || queries.includes(c.evidence)));
    if (cached) {
      const { distanceFromCenterM: _d, disagrees: _x, chosen: _c, ...c } = cached as CenterCandidate;
      cands.push(c);
    } else if (!hasHigh()) {
      if (prev?.center && inGeorgia(prev.center) && !cands.length && !prev.candidates) {
        // A lookup stored before candidates existed: its centre, not a second request.
        cands.push(prev.center);
      } else {
        const g = await geocodeAddress(input.address, fetchImpl, geocode);
        if (g) cands.push({ ...g, retrievedAt: now().toISOString() });
      }
    }
    return { ...chooseCenter(cands), geocode };
  } catch {
    return { center: null, candidates: [], issue: null, geocode };
  }
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
    const decided = await resolveSubjectCenter({ ...input, fetchImpl, now });
    const { center, candidates, issue } = decided;
    console.log(JSON.stringify({
      scope: 'verify_neighborhood', event: 'center',
      basis: center?.basis ?? null, issue, candidates: candidates.map((c) => `${c.basis}${c.disagrees ? ':far' : ''}`), geocode: decided.geocode,
    }));
    const extra = { candidates, centerIssue: issue };
    if (!center) return { ...buildStoredNeighborhood({ status: 'NO_LOCATION', center: null, fetchedAt: now().toISOString() }), ...extra };

    const json = await overpass(buildOverpassQuery(center), fetchImpl);
    if (!json) return { ...buildStoredNeighborhood({ status: 'UNAVAILABLE', center, fetchedAt: now().toISOString() }), ...extra };
    return { ...buildStoredNeighborhood({ status: 'OK', center, fetchedAt: now().toISOString(), parsed: parseOverpass(json, center) }), ...extra };
  } catch {
    return buildStoredNeighborhood({ status: 'UNAVAILABLE', center: null, fetchedAt: now().toISOString() });
  }
}
