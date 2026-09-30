// META MARKETING API CAPACITY — what Meta reports about our usage, and how
// hard HOMATCH may call it right now. Pure.
//
// Source of truth: the response headers Meta attaches to every Marketing API
// call. X-Business-Use-Case-Usage is keyed by the business-use-case bucket
// (the ad account for ads_management / ads_insights) and carries, per type:
// call_count / total_cputime / total_time (percent of the hourly allowance),
// estimated_time_to_regain_access (minutes; > 0 = throttled now) and
// ads_api_access_tier. X-Ad-Account-Usage carries acc_id_util_pct. Nothing
// here ever sees a token.

export interface BucEntry {
  bucket: string;            // business-use-case id (ad account / business)
  type: string;              // ads_management, ads_insights, custom_audience…
  callCount: number;         // % of allowance
  totalCputime: number;      // %
  totalTime: number;         // %
  regainMinutes: number;     // estimated_time_to_regain_access
  tier: string | null;       // ads_api_access_tier
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** X-Business-Use-Case-Usage: {"<bucket>": [{type, call_count, …}], …}. Tolerant of junk. */
export function parseBucHeader(raw: string | null | undefined): BucEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const out: BucEntry[] = [];
  for (const [bucket, list] of Object.entries(parsed as Record<string, unknown>)) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      out.push({
        bucket: String(bucket), type: String(r.type ?? 'unknown'),
        callCount: num(r.call_count), totalCputime: num(r.total_cputime), totalTime: num(r.total_time),
        regainMinutes: num(r.estimated_time_to_regain_access),
        tier: r.ads_api_access_tier != null ? String(r.ads_api_access_tier) : null,
      });
    }
  }
  return out;
}

/** X-Ad-Account-Usage: {acc_id_util_pct, reset_time_duration, ads_api_access_tier}. */
export function parseAdAccountUsage(raw: string | null | undefined): { utilPct: number; resetSeconds: number; tier: string | null } | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    return { utilPct: num(r.acc_id_util_pct), resetSeconds: num(r.reset_time_duration), tier: r.ads_api_access_tier != null ? String(r.ads_api_access_tier) : null };
  } catch { return null; }
}

/**
 * How constrained an ad account is, from the highest of Meta's three
 * percentages across its buckets (and any regain time):
 *   NORMAL    < 50%   everything at its cadence
 *   ELEVATED  50–75%  primary insights at half cadence
 *   HIGH      75–90%  no insights or breakdowns; status only
 *   CRITICAL  ≥ 90%   status every fifth minute only
 *   THROTTLED Meta says wait (regain > 0): no calls until then
 * Meta throttles at 100%; the steps leave room for the calls that matter
 * (campaign state) before optional analytics.
 */
export type Pressure = 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL' | 'THROTTLED';
export function pressureOf(entries: Array<Pick<BucEntry, 'callCount' | 'totalCputime' | 'totalTime' | 'regainMinutes'>>): Pressure {
  if (entries.some((e) => e.regainMinutes > 0)) return 'THROTTLED';
  const peak = entries.reduce((m, e) => Math.max(m, e.callCount, e.totalCputime, e.totalTime), 0);
  return peak >= 90 ? 'CRITICAL' : peak >= 75 ? 'HIGH' : peak >= 50 ? 'ELEVATED' : 'NORMAL';
}

/** What each pressure level allows. */
export function allowance(p: Pressure, minuteOfHour: number) {
  return {
    status: p === 'THROTTLED' ? false : p === 'CRITICAL' ? minuteOfHour % 5 === 0 : true,
    insights: p === 'NORMAL' || p === 'ELEVATED',
    insightsSlowdown: p === 'ELEVATED' ? 2 : 1,
    breakdowns: p === 'NORMAL',
  };
}

/** Meta's throttle family (in-call retries cannot help; regain takes minutes). */
export function isThrottleError(code: string, subcode: string): boolean {
  if (['4', '17', '32', '613'].includes(code)) return true;
  const s = Number(subcode);
  return s >= 80000 && s <= 80014;
}
