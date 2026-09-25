// HOMATCH — source-monitor-public: RETIRED.
//
// Public source monitoring ran on Apify, and Apify is retired from the active
// Homatch discovery architecture. As with dataforseo-search, what changes here
// is the reason: "locked until paid-provider controls are enabled" described a
// provider waiting for a switch to be thrown, and no such switch is coming.
//
// Source health monitoring itself is not retired — it moves into the source
// registry, where a source's reachability, yield and failure rate are measured
// per market and language rather than by one provider sweeping a fixed list.
//
// The contract is unchanged: 423, paidLaunchesBlocked. Historical APIFY
// cost_events and the sources this monitored are preserved.

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
    error: 'Apify source monitoring is retired. Source health moves into the source registry.',
  }), { status: 423, headers });
});
