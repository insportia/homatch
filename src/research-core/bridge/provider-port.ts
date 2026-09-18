// HOMATCH RESEARCH CORE — the only way the core may reach a paid provider.
//
// It cannot reach one directly, and that is enforced by there being no
// implementation in this directory. The core holds an interface; the host
// supplies something that calls `_shared/providers.ts` — and in doing so keeps
// every existing control in force:
//
//   research_providers.enabled / kill_switch   is this provider allowed at all
//   checkSpendCap(provider)                    monthly per-provider + global caps
//   provider_health                            does it actually answer
//   beginExecution / settleExecution           does the customer have the money
//   cost_events / provider_price_book          what did it cost and at what rate
//
// A provider adapter written inside the core would bypass all five. So there
// is one port, one implementation, outside.
//
// THE LOCKED PROVIDERS STAY LOCKED. `dataforseo-search` and
// `source-monitor-public` currently answer 423 with paidLaunchesBlocked, and
// `research_providers` has APIFY at LOCKED and BRIGHTDATA/TGSTAT disabled.
// Nothing here changes that, and `ProviderDenied` below is the shape a caller
// gets back when it asks anyway — a refusal the core handles as an ordinary
// outcome rather than an error, so a locked provider degrades coverage instead
// of failing a run.

import type { ProviderUsage } from '../core/types.ts';

export type ProviderDenialReason =
  | 'PROVIDER_DISABLED'
  | 'KILL_SWITCH'
  | 'SPEND_CAP_REACHED'
  | 'GLOBAL_SPEND_CAP_REACHED'
  | 'NOT_CONFIGURED'
  | 'UNHEALTHY'
  | 'BUDGET_CEILING_REACHED';

export interface ProviderDenied {
  ok: false;
  reason: ProviderDenialReason;
  provider: string;
}

export interface ProviderSearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  domain?: string | null;
}

export interface ProviderSearchOk {
  ok: true;
  provider: string;
  hits: ProviderSearchHit[];
  usage: ProviderUsage;
  /**
   * What the provider said it charged, in cents, when it says so.
   *
   * UNDEFINED means it did not say. It does NOT mean zero, and a port
   * implementation must never substitute one for the other: an unknown
   * provider cost is a named gap in cost_events, which is the rule
   * src/verify/cogs.ts already enforces.
   */
  costCents?: number;
}

export type ProviderSearchResult = ProviderSearchOk | ProviderDenied;

export interface ProviderSearchRequest {
  /** research_providers.provider_code. */
  provider: string;
  queries: string[];
  language?: string;
  country?: string;
  /** Hard ceiling from the grant. The port must refuse rather than exceed it. */
  budgetCeilingCents: number | null;
  signal?: AbortSignal;
}

/**
 * A paid search provider, as the core sees it.
 *
 * Every method may refuse. A refusal is a normal outcome and callers must
 * handle it as reduced coverage — a research run that cannot reach a provider
 * reports what it did find, with the objective marked UNAVAILABLE, rather than
 * failing.
 */
export interface ProviderPort {
  search(request: ProviderSearchRequest): Promise<ProviderSearchResult>;
  /** Cheap pre-check so a plan can skip work it will not be allowed to do. */
  available(provider: string): Promise<ProviderDenied | { ok: true }>;
}

/**
 * The port used when no provider access was granted.
 *
 * Refuses everything, which is exactly right for the default: the HTTP
 * research tier fetches free public pages and needs no provider at all, so a
 * caller that wants a paid one has to pass a real port in.
 */
export const noProviderAccess: ProviderPort = {
  async search(request: ProviderSearchRequest): Promise<ProviderSearchResult> {
    return { ok: false, reason: 'NOT_CONFIGURED', provider: request.provider };
  },
  async available(provider: string): Promise<ProviderDenied> {
    return { ok: false, reason: 'NOT_CONFIGURED', provider };
  },
};

export function isDenied(result: { ok: boolean }): result is ProviderDenied {
  return result.ok === false;
}
