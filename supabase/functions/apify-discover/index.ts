// HOMATCH — apify-discover: RETIRED.
//
// WHAT THIS USED TO BE
//
// Property-driven discovery across Facebook groups, Telegram, Threads and
// Reddit, all four through Apify actors, writing raw_signals and four
// cost_events per call.
//
// WHY IT IS A STUB
//
// Apify is retired from the active Homatch discovery architecture. It is not
// paused pending a decision and it is not awaiting reactivation: the social
// and web discovery lanes are being built on official APIs and permitted
// public-web access instead, and Telegram has its own planned integration
// rather than an Apify substitute.
//
// THE DEFECT THIS CLOSES
//
// Retirement had been done everywhere except here. Production carries
// provider_kill_switch = true, external_discovery_enabled = false, and
// provider_disabled_list = [APIFY, DATAFORSEO, ZENROWS, SCRAPINGBEE,
// BRIGHTDATA] — which gates discovery-queue-worker and
// external-discovery-orchestrator, and is why no APIFY cost_event has been
// written since 2026-08-29. But this function read APIFY_API_TOKEN straight
// out of the environment and consulted none of those settings. It was
// deployed, HTTP-reachable, and one authenticated POST away from spending
// real money on a provider the architecture had already left behind.
//
// Nothing in src/ calls it, and nothing in the repository does either — so
// retiring it removes no working feature. It is being closed because an
// unguarded door to a retired provider is a configuration defect whether or
// not anybody has walked through it.
//
// WHAT IS PRESERVED
//
// Everything countable. The 185 historical APIFY cost_events, the raw_signals
// this function produced, the sources it registered and the provider price
// records all stay exactly as recorded. Retiring a provider is not a reason to
// rewrite what it cost us. The implementation itself is in git history, which
// is where a retired implementation belongs.
//
// The response shape matches dataforseo-search and source-monitor-public,
// which were retired first: 423 with paidLaunchesBlocked, so any caller that
// still exists gets the same refusal from every retired provider.

Deno.serve(async (req: Request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  return new Response(JSON.stringify({
    success: false,
    paidLaunchesBlocked: true,
    retired: true,
    provider: 'APIFY',
    error: 'Apify discovery is retired from the Homatch discovery architecture. '
      + 'Social and web discovery run on official APIs and permitted public-web access.',
  }), { status: 423, headers });
});
