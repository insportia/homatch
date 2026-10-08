// providerOutcomes.ts — what each research provider ACTUALLY did in one job.
//
// Every provider (TAS, NAPR/MyGov Service176, NAPR entity registry, debtor
// registry, RS.ge, MyHome.ge, SS.ge) runs and fails independently. This turns
// the persisted execution results into one honest state per provider, so the
// report and Admin can say exactly which source finished, which was partial,
// which needed a human verification and which was unreachable — without a
// failure of one ever describing the others.
//
// Pure and deterministic: it reads only what the worker recorded. A state is
// never inferred from silence — a provider with no recorded result is
// NOT_VERIFIED, not "clean".

export type ProviderId = 'tas' | 'mygov' | 'enreg' | 'debtor' | 'rstax' | 'myhome' | 'ssge';

export type ProviderState =
  | 'VERIFIED' // searched and read; evidence found
  | 'COMPLETED' // searched completely; the source holds nothing for this query
  | 'PARTIAL' // evidence collected, but processing incomplete (see reason)
  | 'CAPTCHA_REQUIRED' // the source asked for a human verification that was not completed
  | 'CAPTCHA_FAILED' // a verification was attempted and rejected / failed
  | 'SOURCE_CHANGED' // page/API contract no longer matches (selector, parser, endpoint)
  | 'TEMPORARILY_UNAVAILABLE' // network, 5xx, rate limit, blocked network
  | 'TIMEOUT'
  | 'FAILED'
  | 'NOT_VERIFIED'; // never ran, or ran without a confirmed outcome

export interface ProviderOutcome {
  provider: ProviderId;
  state: ProviderState;
  /** Short machine reason (never a raw error, never a URL). */
  reason: string | null;
  /** Official documents / listings this provider contributed. */
  evidenceCount: number;
}

/** States after which the provider's evidence is complete for this query. */
export const SETTLED_STATES: ReadonlySet<ProviderState> = new Set(['VERIFIED', 'COMPLETED']);

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Classify a failure from its recorded error text — never shown to customers. */
export function classifyFailure(errorText: string): { state: ProviderState; reason: string } {
  const e = errorText.toLowerCase();
  if (!e) return { state: 'FAILED', reason: 'UNKNOWN' };
  if (/captcha|recaptcha|challenge/.test(e)) return { state: 'CAPTCHA_FAILED', reason: 'VERIFICATION_REJECTED' };
  if (/deadline|timeout|timed out|aborterror/.test(e)) return { state: 'TIMEOUT', reason: 'TIMEOUT' };
  if (/\b429\b|rate.?limit|too many requests/.test(e)) return { state: 'TEMPORARILY_UNAVAILABLE', reason: 'RATE_LIMITED' };
  if (/\b5\d\d\b|econn|enotfound|eai_again|socket|network|fetch failed|unavailable|bad gateway/.test(e)) return { state: 'TEMPORARILY_UNAVAILABLE', reason: 'NETWORK_OR_SERVER' };
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|session expired/.test(e)) return { state: 'TEMPORARILY_UNAVAILABLE', reason: 'ACCESS_REFUSED' };
  if (/dwrparse|parse|selector|not found on page|unexpected (token|shape|reply)|contract|schema/.test(e)) return { state: 'SOURCE_CHANGED', reason: 'CONTRACT_MISMATCH' };
  return { state: 'FAILED', reason: 'UNCLASSIFIED' };
}

/** One worker result (LegacySourceResult) → its provider state. */
export function classifySourceResult(r: Record<string, any>, unattendedSkips: ReadonlySet<string> = new Set()): ProviderOutcome {
  const provider = str(r.source).toLowerCase() as ProviderId;
  const status = str(r.status).toUpperCase();
  const docs = arr(r.documents);
  const evidenceCount = docs.filter((d) => obj(d).complete !== false).length;
  const out = (state: ProviderState, reason: string | null): ProviderOutcome => ({ provider, state, reason, evidenceCount });
  const wr = obj(r.workflowResult);
  const ledger = obj(obj(r.tasApi).ledger);

  switch (status) {
    case 'WAITING_HUMAN':
      return out('CAPTCHA_REQUIRED', 'AWAITING_VERIFICATION');
    case 'SKIPPED_HUMAN_VERIFICATION':
      return out('CAPTCHA_REQUIRED', unattendedSkips.has(provider) ? 'VERIFICATION_UNATTENDED' : 'VERIFICATION_SKIPPED');
    case 'BLOCKED':
      return r.captcha || r.captchaRequired ? out('CAPTCHA_REQUIRED', 'VERIFICATION_REQUIRED') : out('TEMPORARILY_UNAVAILABLE', 'BLOCKED');
    case 'TIMEOUT':
      return out(evidenceCount ? 'PARTIAL' : 'TIMEOUT', 'TIMEOUT');
    case 'SEARCH_CONTROL_NOT_FOUND':
    case 'WRONG_SEARCH_CONTEXT':
    case 'SUBMITTED_UNPARSED':
      return out('SOURCE_CHANGED', status);
    case 'NO_RESULT_CONFIRMED':
      return out('COMPLETED', 'NO_RECORDS');
    case 'SUBMITTED_UNCONFIRMED':
      return out('NOT_VERIFIED', 'UNCONFIRMED');
    case 'FAILED': {
      const f = classifyFailure(str(r.error ?? wr.error ?? r.reason));
      // Evidence collected before the failure is kept, and says so.
      return evidenceCount ? out('PARTIAL', f.reason) : out(f.state, f.reason);
    }
    case 'SEARCH_CONFIRMED':
    case 'SOURCE_EXHAUSTED':
    case 'RESULTS_TRAVERSED':
    case 'DOCUMENTS_TRAVERSED':
    case 'COMPLETE': {
      if (ledger.incomplete === true) return out('PARTIAL', arr<string>(ledger.incompleteReasons).map(str).join(',') || 'PROCESSING_INCOMPLETE');
      if (/PARTIAL/.test(str(wr.state))) return out('PARTIAL', str(wr.state));
      if (r.tasApi && !r.tasApi.ledger) return out('PARTIAL', 'PROCESSING_UNVERIFIED');
      return out('VERIFIED', null);
    }
    default:
      return out('NOT_VERIFIED', status || 'NO_STATUS');
  }
}

function marketplaceOutcome(provider: 'myhome' | 'ssge', p: Record<string, any>): ProviderOutcome {
  const status = str(p.status).toUpperCase();
  const listings = Number(p.listings) || 0;
  const base = { provider, evidenceCount: listings };
  if (/^(COMPLETE|COMPLETED|OK|SUCCESS|DONE)$/.test(status)) return { ...base, state: listings ? 'VERIFIED' : 'COMPLETED', reason: listings ? null : 'NO_LISTINGS' };
  if (/TIMEOUT/.test(status)) return { ...base, state: listings ? 'PARTIAL' : 'TIMEOUT', reason: 'TIMEOUT' };
  if (/PARTIAL/.test(status)) return { ...base, state: 'PARTIAL', reason: status };
  if (/FAIL|ERROR/.test(status)) return { ...base, state: listings ? 'PARTIAL' : 'FAILED', reason: status };
  return { ...base, state: 'NOT_VERIFIED', reason: status || 'NO_STATUS' };
}

/**
 * Every provider's outcome for one research job's result_json.
 * `expected` lists the official providers the job's mode should have run;
 * one with no recorded result is NOT_VERIFIED (or TEMPORARILY_UNAVAILABLE
 * when the official stage itself was unavailable).
 */
export function providerOutcomes(resultJson: unknown, expected: ProviderId[] = ['tas', 'mygov']): ProviderOutcome[] {
  const r = obj(resultJson);
  const bo = obj(r.browserOfficial);
  const unattended = new Set(arr(r._unattendedVerificationSkips).map((s) => str(obj(s).source).toLowerCase()).map((s) => (s === 'rs.taxpayer' ? 'rstax' : s)));
  const byProvider = new Map<ProviderId, ProviderOutcome>();
  for (const res of arr(bo.results)) {
    const o = classifySourceResult(obj(res), unattended);
    if (!o.provider) continue;
    const prev = byProvider.get(o.provider);
    // Several entity runs of one registry: the strongest outcome describes the source.
    if (!prev || rank(o.state) > rank(prev.state)) byProvider.set(o.provider, { ...o, evidenceCount: o.evidenceCount + (prev?.evidenceCount ?? 0) });
    else prev.evidenceCount += o.evidenceCount;
  }
  for (const p of expected)
    if (!byProvider.has(p)) byProvider.set(p, { provider: p, state: bo.unavailable ? 'TEMPORARILY_UNAVAILABLE' : 'NOT_VERIFIED', reason: bo.unavailable ? 'OFFICIAL_STAGE_UNAVAILABLE' : 'NOT_RUN', evidenceCount: 0 });
  const ledger = obj(r._marketplaceLedger);
  if (str(obj(r._verifyMarket).state) !== 'DISABLED' && (ledger.myhome || ledger.ssge)) {
    if (ledger.myhome) byProvider.set('myhome', marketplaceOutcome('myhome', obj(ledger.myhome)));
    if (ledger.ssge) byProvider.set('ssge', marketplaceOutcome('ssge', obj(ledger.ssge)));
  }
  const order: ProviderId[] = ['tas', 'mygov', 'enreg', 'debtor', 'rstax', 'myhome', 'ssge'];
  return [...byProvider.values()].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

function rank(s: ProviderState): number {
  return ['NOT_VERIFIED', 'FAILED', 'TIMEOUT', 'TEMPORARILY_UNAVAILABLE', 'SOURCE_CHANGED', 'CAPTCHA_FAILED', 'CAPTCHA_REQUIRED', 'PARTIAL', 'COMPLETED', 'VERIFIED'].indexOf(s);
}

/** Overall completeness: every official provider settled → COMPLETE; else how many. */
export function researchCompleteness(outcomes: ProviderOutcome[]): { complete: boolean; settled: number; total: number; limited: ProviderOutcome[] } {
  const official = outcomes.filter((o) => o.provider !== 'myhome' && o.provider !== 'ssge');
  const limited = outcomes.filter((o) => !SETTLED_STATES.has(o.state));
  const settled = official.filter((o) => SETTLED_STATES.has(o.state)).length;
  return { complete: settled === official.length && official.length > 0, settled, total: official.length, limited };
}
