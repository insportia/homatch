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

/*
 * OVERPASS, BOUNDED AND ACCOUNTED FOR (V1.1, 2026-10-23).
 *
 * Every neighbourhood lookup after the F5 fix stored UNAVAILABLE (jobs
 * 055a9868, a5be9fcd: four tries each, nothing logged). Reproduced from a
 * workstation the same day: overpass-api.de answered "502 … server is at
 * capacity" in 0.5 s, the mirror hung past 60 s, and a later retry of the
 * main server returned the full answer (233 elements, 885 KB) in 37 s —
 * past the old 30 s cap. So: one attempt may take up to 45 s, a fast
 * capacity / rate answer is retried on the same server after a short pause,
 * and the whole lookup never exceeds OVERPASS_BUDGET_MS. Every attempt is
 * logged (host, outcome, ms, bytes). A failure is still stored as
 * UNAVAILABLE: nothing is ever guessed.
 */
export const OVERPASS_BUDGET_MS = 80_000;
export const OVERPASS_ATTEMPT_MS = 45_000;
export const OVERPASS_BACKOFF_MS = 4_000;
export const OVERPASS_HEDGE_MS = 8_000;
const OVERPASS_MAX_ATTEMPTS = 4;
/** Answers that mean "busy, ask again", not "your query is wrong". */
const OVERPASS_RETRYABLE = new Set([429, 502, 503, 504]);

export interface OverpassAttempt {
  host: string;
  /** HTTP status, or TIMEOUT / NETWORK / BAD_JSON / REMARK / BUDGET. */
  outcome: string;
  ms: number;
  bytes: number | null;
}

export interface OverpassOptions {
  budgetMs?: number;
  attemptMs?: number;
  backoffMs?: number;
  /** A request unanswered this long is joined by one to the other server. */
  hedgeMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The Overpass answer, or null — with every attempt recorded in `attempts`. */
export async function fetchOverpass(
  query: string,
  fetchImpl: FetchLike,
  attempts: OverpassAttempt[] = [],
  opts: OverpassOptions = {},
): Promise<unknown | null> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.budgetMs ?? OVERPASS_BUDGET_MS;
  const attemptCap = opts.attemptMs ?? OVERPASS_ATTEMPT_MS;
  const backoff = opts.backoffMs ?? OVERPASS_BACKOFF_MS;
  const hedgeMs = opts.hedgeMs ?? OVERPASS_HEDGE_MS;
  const start = now();
  // The main server first, and again after a pause: it sheds load with a fast
  // 502 and then answers (live, 2026-10-23), while the mirror tends to hang.
  const plan = [OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1], OVERPASS_ENDPOINTS[0]].slice(0, OVERPASS_MAX_ATTEMPTS);
  let sent = 0;

  /** One request, never throwing: its outcome, and an abort for the loser of a hedge. */
  const request = (endpoint: string, cap: number) => {
    const host = new URL(endpoint).host;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cap);
    const t0 = now();
    sent++;
    const done = (async (): Promise<{ attempt: OverpassAttempt; json: unknown | null }> => {
      let outcome = 'NETWORK';
      let bytes: number | null = null;
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'User-Agent': NEIGHBORHOOD_USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: `data=${encodeURIComponent(query)}`,
        });
        let json: unknown | null = null;
        if (!res.ok) outcome = String(res.status);
        else {
          try {
            if (typeof res.text !== 'function') json = await res.json();
            else {
              const text = await res.text();
              bytes = text.length;
              json = JSON.parse(text);
            }
          } catch (e) {
            if ((e as Error)?.name === 'AbortError') throw e;
            outcome = 'BAD_JSON';
          }
        }
        if (json && !overpassFailed(json)) return { attempt: { host, outcome: 'OK', ms: now() - t0, bytes }, json };
        if (json) outcome = 'REMARK';
      } catch (e) {
        outcome = (e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      } finally {
        clearTimeout(timer);
      }
      return { attempt: { host, outcome, ms: now() - t0, bytes }, json: null };
    })();
    return { done, abort: () => ctrl.abort() };
  };

  for (let i = 0; sent < plan.length && i < plan.length; i++) {
    const endpoint = plan[i];
    const left = budget - (now() - start);
    if (left < 5_000) {
      attempts.push({ host: new URL(endpoint).host, outcome: 'BUDGET', ms: 0, bytes: null });
      break;
    }
    const cap = Math.min(attemptCap, left);
    const first = request(endpoint, cap);
    /* A HUNG SERVER IS HEDGED, NOT WAITED OUT (prod 176264ba, 2026-10-23):
       overpass-api.de timed out on every try (20 s, 45 s, 35 s) and the
       mirror never got its turn. A request still unanswered after hedgeMs is
       joined by one to the other server; the first good answer wins and the
       other is aborted. Fast refusals keep the plan above. */
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const hedged = new Promise<'HEDGE'>((r) => { hedgeTimer = setTimeout(() => r('HEDGE'), hedgeMs); });
    const early = await Promise.race([first.done, hedged]);
    clearTimeout(hedgeTimer);
    let results: { attempt: OverpassAttempt; json: unknown | null }[];
    if (early !== 'HEDGE' || sent >= plan.length || budget - (now() - start) < 5_000) {
      results = [early !== 'HEDGE' ? early : await first.done];
    } else {
      const other = endpoint === OVERPASS_ENDPOINTS[0] ? OVERPASS_ENDPOINTS[1] : OVERPASS_ENDPOINTS[0];
      const second = request(other, Math.min(attemptCap, budget - (now() - start)));
      const pair = [first, second];
      results = [];
      const winner = await new Promise<{ attempt: OverpassAttempt; json: unknown | null } | null>((resolve) => {
        let pending = 2;
        for (const r of pair) {
          r.done.then((out) => {
            results.push(out);
            if (out.json) resolve(out);
            else if (--pending === 0) resolve(null);
          });
        }
      });
      if (winner) {
        for (const r of pair) r.abort();
        // The loser settles as TIMEOUT once aborted; it is recorded too.
        await Promise.all(pair.map((r) => r.done));
      }
    }
    attempts.push(...results.map((r) => r.attempt));
    const ok = results.find((r) => r.json);
    if (ok) return ok.json;
    // A busy server answers fast; give it a moment before the next try.
    const last = results.at(-1)?.attempt.outcome;
    if (OVERPASS_RETRYABLE.has(Number(last)) && sent < plan.length) await sleep(backoff);
  }
  return null;
}

/*
 * THE REPORT BUILD MAY NOT WAIT LONG (V1.1).
 *
 * verify-synthesis is called with a 150 s gateway limit, and the model call
 * alone takes 70–100 s. Job 055a9868 (2026-10-23): two failing Overpass
 * attempts (2 × 30 s) plus the model crossed it, the caller got 504 twice and
 * the report landed on the third build, 8 minutes late. So inside the build
 * the lookup is time-boxed; a centre left UNAVAILABLE is completed afterwards
 * by completeNeighborhood() with the full OVERPASS_BUDGET_MS.
 */
export const SYNTHESIS_OVERPASS: OverpassOptions = { budgetMs: 25_000, attemptMs: 20_000, backoffMs: 3_000 };

/**
 * A stored lookup that has a verified centre but no map answer, completed with
 * a full-budget Overpass call — the centre, candidates and conflict flag are
 * kept exactly as stored. Null when there is nothing to complete or Overpass
 * still fails (the stored UNAVAILABLE then stands; nothing is guessed).
 */
export async function completeNeighborhood(
  stored: unknown,
  fetchImpl: FetchLike = fetch,
  opts: OverpassOptions = {},
  now: () => Date = () => new Date(),
): Promise<StoredNeighborhood | null> {
  const n = stored as StoredNeighborhood | null;
  if (!n || n.status !== 'UNAVAILABLE' || !n.center) return null;
  const attempts: OverpassAttempt[] = [];
  const json = await fetchOverpass(buildOverpassQuery(n.center), fetchImpl, attempts, opts);
  console.log(JSON.stringify({ scope: 'verify_neighborhood', event: 'overpass_completion', ok: !!json, attempts }));
  if (!json) return null;
  return {
    ...buildStoredNeighborhood({ status: 'OK', center: n.center, fetchedAt: now().toISOString(), parsed: parseOverpass(json, n.center) }),
    ...(n.candidates ? { candidates: n.candidates } : {}),
    ...(n.centerIssue !== undefined ? { centerIssue: n.centerIssue } : {}),
  };
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
  /** Overpass timing (tests shorten the waits). */
  overpass?: OverpassOptions;
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

  // Kept outside the try: a failure after the centre is known must not lose it.
  let center: NeighborhoodCenter | null = null;
  let extra: Partial<StoredNeighborhood> = {};
  try {
    const decided = await resolveSubjectCenter({ ...input, fetchImpl, now });
    center = decided.center;
    const { candidates, issue } = decided;
    console.log(JSON.stringify({
      scope: 'verify_neighborhood', event: 'center',
      basis: center?.basis ?? null, issue, candidates: candidates.map((c) => `${c.basis}${c.disagrees ? ':far' : ''}`), geocode: decided.geocode,
    }));
    extra = { candidates, centerIssue: issue };
    if (!center) return { ...buildStoredNeighborhood({ status: 'NO_LOCATION', center: null, fetchedAt: now().toISOString() }), ...extra };

    const attempts: OverpassAttempt[] = [];
    const json = await fetchOverpass(buildOverpassQuery(center), fetchImpl, attempts, input.overpass);
    console.log(JSON.stringify({ scope: 'verify_neighborhood', event: 'overpass', ok: !!json, attempts }));
    if (!json) return { ...buildStoredNeighborhood({ status: 'UNAVAILABLE', center, fetchedAt: now().toISOString() }), ...extra };
    return { ...buildStoredNeighborhood({ status: 'OK', center, fetchedAt: now().toISOString(), parsed: parseOverpass(json, center) }), ...extra };
  } catch (e) {
    console.log(JSON.stringify({ scope: 'verify_neighborhood', event: 'failed', error: e instanceof Error ? e.message.slice(0, 160) : 'unknown' }));
    return { ...buildStoredNeighborhood({ status: 'UNAVAILABLE', center, fetchedAt: now().toISOString() }), ...extra };
  }
}
