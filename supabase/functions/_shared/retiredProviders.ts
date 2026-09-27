// HOMATCH — the providers that are retired, named once.
//
// DataForSEO and Apify are retired from the active Homatch discovery
// architecture. Not paused and not awaiting a decision: the web lane is being
// built on permitted public-web access and official APIs, and nothing is
// waiting to switch them back on.
//
// Until this file existed, "retired" was a fact about settings. Production
// holds provider_kill_switch = true and both names in provider_disabled_list,
// and every path that consulted those settings was safe. The paths that did
// NOT consult them were not: social-collect ran ApifyProvider on any POST,
// provider-health-check sent a live DataForSEO query and a live Apify request
// whenever an admin pressed "Test", and discovery-queue-worker still carried
// the full launch code behind a settings check one UPDATE away from true.
//
// So retirement is now a property of the code rather than of a row. Every one
// of those paths asks isRetiredProvider() BEFORE it could build a request, and
// there is no request left to build: the fetches to api.dataforseo.com and
// api.apify.com are gone from supabase/functions, which
// tests/matrix/retiredProviders.test.mjs asserts.
//
// WHAT IS PRESERVED
//
// Everything already recorded: the historical DATAFORSEO and APIFY
// cost_events, the provider price records, the raw_signals and sources they
// produced, and the migrations that created them. Retiring a provider does
// not rewrite what it cost us.

export const RETIRED_PROVIDERS = ['DATAFORSEO', 'APIFY'] as const;
export type RetiredProvider = typeof RETIRED_PROVIDERS[number];

export function isRetiredProvider(provider: unknown): provider is RetiredProvider {
  return RETIRED_PROVIDERS.includes(String(provider ?? '').toUpperCase() as RetiredProvider);
}

/** The one sentence every retired path returns, so callers can match on it. */
export function retiredReason(provider: RetiredProvider): string {
  return provider === 'DATAFORSEO'
    ? 'DataForSEO is retired from the Homatch discovery architecture.'
    : 'Apify is retired from the Homatch discovery architecture.';
}

/**
 * The body a retired HTTP path answers with.
 *
 * 423 Locked with paidLaunchesBlocked, the same contract dataforseo-search and
 * apify-discover have returned since they were retired, so every existing
 * caller sees one shape.
 */
export function retiredBody(provider: RetiredProvider) {
  return {
    success: false,
    paidLaunchesBlocked: true,
    retired: true,
    provider,
    error: retiredReason(provider),
  };
}
