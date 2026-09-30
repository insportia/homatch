// Current official exchange rates for budget comparison.
//
// The National Bank of Georgia's published rates -- the same source Verify
// uses (src/verify/intelligence/fx.ts). Fetched by the ORCHESTRATORS
// (match-campaign, the discovery driver) and handed to run-matching-v2 in the
// request, because the match writer itself must never fetch: a third party's
// latency does not belong inside matching.
//
// Strictly best-effort: a 4s budget, and any failure -- network, malformed or
// stale payload -- returns null, which leaves cross-currency budgets UNKNOWN.
// Same-currency matching never depends on it.
import { NBG_RATES_URL } from '../../../src/verify/intelligence/fx.ts';
import { ratesFromNbg } from '../../../src/research-core/match/structured-gates.ts';

export async function fetchCurrentFx(): Promise<Record<string, { rate: number; asOf?: string }> | null> {
  try {
    const res = await fetch(NBG_RATES_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return ratesFromNbg(await res.json());
  } catch {
    return null;
  }
}
