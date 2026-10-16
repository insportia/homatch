// marketRefresh.ts — a finished Verify report's market evidence, refreshed
// once from the free public portals (owner, 2026-10-11).
//
// The .601 report was built while Verify's MyHome search ran without Find
// Property's page reader (0 listings) and SS.ge searched the wrong district
// name, so its market chapter rests on one comparable. The worker now runs
// both portals properly; a COMPLETE job is refreshed ONCE, no charge:
//
//   start (research-agent `refresh_market`, called by verify-synthesis when a
//   logic-version rebuild begins) → worker /verify/market job →
//   the cron driver polls it → listings are folded into
//   result_json.market.comparables (deduplicated against what is there) →
//   synthesis_json._rebuildRequested asks for one more rebuild, which
//   reportVersion.shouldAutoUpgrade honours exactly once.
//
// Only derived market evidence changes. Official evidence, the audit trail
// and the original ledger (kept under `previous`) are untouched.

import { foldMarketplaceIntoLane } from './marketplaceComparables.ts';
import { subjectMarketFacts } from './intelligence/marketHierarchy.ts';

export const MARKET_REFRESH_VERSION = 1;
/** A refresh that never reports back is abandoned after this long. */
export const MARKET_REFRESH_MAX_WAIT_MS = 9 * 60 * 1000;
const MAX_ATTEMPTS = 2;

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

export interface MarketRefreshMarker {
  version: number;
  state: 'RUNNING' | 'FOLDED' | 'FAILED' | 'LOST' | 'TIMED_OUT';
  workerJobId?: string | null;
  startedAt: string;
  attempts: number;
  profile?: unknown;
  foldedAt?: string;
  before?: number;
  after?: number;
  error?: string | null;
}

/** Whether a finished job should (re)start its one market refresh. */
export function needsMarketRefresh(resultJson: unknown): boolean {
  const m = obj(obj(resultJson)._marketRefresh);
  if (!Object.keys(m).length) return true;
  if (Number(m.version) < MARKET_REFRESH_VERSION) return true;
  if (m.state === 'RUNNING' || m.state === 'FOLDED') return false;
  return Number(m.attempts) < MAX_ATTEMPTS;
}

/** The profile the refresh searches with: the original search's, as recorded. */
export function refreshProfile(resultJson: unknown): Record<string, any> | null {
  const p = obj(obj(obj(resultJson)._marketplaceLedger).profile);
  if (!(typeof p.city === 'string' && p.city.trim())) return null;
  // The original search often started before the subject's district was known
  // (job eeefada9 searched citywide). The refresh uses the district the
  // subject's own official address names, so it searches locally.
  if (!p.district) {
    let district: string | undefined;
    try { district = subjectMarketFacts(resultJson as any).district; } catch { district = undefined; }
    if (district) return { ...p, district };
  }
  return p;
}

export function startedMarker(previous: unknown, workerJobId: string, profile: unknown, nowIso: string): MarketRefreshMarker {
  const prev = obj(previous);
  return { version: MARKET_REFRESH_VERSION, state: 'RUNNING', workerJobId, startedAt: nowIso, attempts: (Number(prev.attempts) || 0) + 1, profile };
}

export function failedMarker(previous: unknown, state: 'FAILED' | 'LOST' | 'TIMED_OUT', nowIso: string, error: string | null = null): MarketRefreshMarker {
  const prev = obj(previous);
  return { version: MARKET_REFRESH_VERSION, startedAt: String(prev.startedAt ?? nowIso), attempts: Number(prev.attempts) || 1, workerJobId: prev.workerJobId ?? null, profile: prev.profile, state, error };
}

/**
 * Fold a COMPLETE worker job into a stored result_json (returns a new object).
 * The existing comparables stay first; the worker's are added when new.
 */
export function foldMarketRefresh(
  resultJson: Record<string, any>,
  workerJob: unknown,
  subject: { project: string | null; latitude: number | null; longitude: number | null; district: string | null },
  nowIso: string,
): Record<string, any> {
  const rj = { ...resultJson };
  const market = { ...obj(rj.market) };
  const lane = Array.isArray(market.comparables) ? market.comparables : [];
  const folded = foldMarketplaceIntoLane(lane, workerJob as any, subject, nowIso);
  market.comparables = folded.comparables;
  rj.market = market;
  const prevLedger = obj(rj._marketplaceLedger);
  rj._marketplaceLedger = {
    ...folded.ledger,
    profile: prevLedger.profile ?? null,
    refreshedAt: nowIso,
    previous: Object.keys(prevLedger).length ? { ...prevLedger, previous: undefined } : null,
  };
  const m = obj(rj._marketRefresh);
  rj._marketRefresh = {
    ...m,
    version: MARKET_REFRESH_VERSION,
    startedAt: String(m.startedAt ?? nowIso),
    attempts: Number(m.attempts) || 1,
    state: 'FOLDED',
    foldedAt: nowIso,
    before: lane.length,
    after: folded.comparables.length,
  } satisfies MarketRefreshMarker;
  return rj;
}

/** The synthesis marker that asks verify-synthesis for one rebuild. */
export function rebuildRequest(reason: string, nowIso: string): { reason: string; at: string } {
  return { reason, at: nowIso };
}
