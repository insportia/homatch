// ============================================================
// HOMATCH — social-collect: RETIRED.
//
// WHAT THIS USED TO BE
//
// Collected new posts from a registered social source (Facebook / Telegram /
// Instagram / VK) by running an Apify actor, inserted them as raw_signals and
// wrote an APIFY cost_event per run.
//
// THE DEFECT THIS CLOSES
//
// Apify is retired, and every other Apify path already said so: apify-discover
// answers 423, and discovery-queue-worker is gated by provider_kill_switch and
// provider_disabled_list. This function consulted none of that. It constructed
// ApifyProvider on any POST that named an active source and, with a token in
// the environment, launched a paid actor run. It was deployed and reachable,
// one request away from spending money on a provider the architecture had
// already left behind.
//
// WHAT IT DOES NOW
//
// Answers every request with the retired contract (423, paidLaunchesBlocked,
// retired: true) before reading the body, touching the database or building a
// request. There is no provider left to construct: ApifyProvider has been
// removed from _shared/providers.ts, so this file cannot be "switched back on"
// by a setting. Bringing social collection back is new work on an official API,
// not a revert.
//
// WHAT IS PRESERVED
//
// The raw_signals this function inserted, the source_registry cursors it
// advanced and the historical APIFY cost_events all stay exactly as recorded.
// The implementation is in git history, which is where a retired
// implementation belongs.
// ============================================================

import { retiredBody } from '../_shared/retiredProviders.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(JSON.stringify(retiredBody('APIFY')), {
    status: 423,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
