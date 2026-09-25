// HOMATCH — source-discovery-massive: RETIRED.
//
// WHAT THIS USED TO BE
//
// Bulk source discovery: a DataForSEO SERP sweep over eight hardcoded
// `site:` operators — facebook.com/groups, t.me, telegram.me, vk.com,
// reddit.com/r, threads.net, instagram.com, quora.com — followed by an Apify
// Facebook-group search, registering whatever came back as a source.
//
// WHY IT IS A STUB
//
// Both providers it ran on are retired, and so is the shape of it. A fixed
// list of eight `site:` operators is not a source registry: it cannot learn a
// Russian-language forum, an Israeli investment board or a Turkish classifieds
// site, it holds no per-market or per-language strategy, and it has no notion
// of whether a domain it registered ever produced anything. Discovery is being
// rebuilt around a registry that discovers, evaluates, tests, classifies and
// measures sources per market and language — not around a constant.
//
// THE DEFECT THIS CLOSES
//
// The same one as apify-discover. Production carries provider_kill_switch =
// true, external_discovery_enabled = false and provider_disabled_list =
// [APIFY, DATAFORSEO, ZENROWS, SCRAPINGBEE, BRIGHTDATA], which is why no
// DATAFORSEO cost_event has been written since 2026-08-29 — but this function
// read its credentials from the environment and consulted none of it. Service
// -role only, which narrows who could call it, not what it would do if called.
//
// Nothing in the repository calls it.
//
// WHAT IS PRESERVED
//
// The 276 DATAFORSEO and 185 APIFY cost_events, the sources this function
// registered, and every provider price record stay exactly as they are. The
// implementation is in git history.
//
// 423 with paidLaunchesBlocked, matching dataforseo-search,
// source-monitor-public and apify-discover.

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
    provider: 'DATAFORSEO',
    error: 'Bulk SERP and Apify source discovery is retired. Source discovery is '
      + 'being rebuilt on a per-market, per-language source registry.',
  }), { status: 423, headers });
});
