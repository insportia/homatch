// HOMATCH — dataforseo-search: RETIRED.
//
// This function has refused every request since paid external discovery was
// locked. What changes here is only the reason it gives, because the reason it
// gave was no longer true: "temporarily locked while production readiness is
// being verified" describes a provider waiting to come back, and this one is
// not. DataForSEO is retired from the active Homatch discovery architecture.
//
// The contract is unchanged — 423, paidLaunchesBlocked — so every existing
// caller and every test sees exactly what it saw before. There has never been
// a live provider path in this file and there is none now.
//
// The 276 historical DATAFORSEO cost_events, the sources it discovered and the
// provider price records are all preserved. Retiring a provider does not
// rewrite what it cost us.

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
    error: 'DataForSEO is retired from the Homatch discovery architecture.',
  }), { status: 423, headers });
});
