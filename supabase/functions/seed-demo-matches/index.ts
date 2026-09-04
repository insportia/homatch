// LEGACY / DISABLED — this file's source used to be a full matching-pipeline
// orchestrator (generate-search-profile → dataforseo-search → apify-discover
// → classify-signals-v2 → run-matching-v2), reporting fine-grained progress
// into a `matching_run_progress` table. It has been intentionally disabled
// in production (see the deployed version below) because invoking it could
// trigger real, paid discovery calls (DataForSEO, Apify) outside of the
// controlled, budget-aware matching flow. The real, live matching pipeline
// runs through `run-matching-v2` and reports progress into `matching_jobs` /
// `matching_job_events` (see src/components/matching/MatchingJobProgress.tsx
// and src/services/matchingProgress.ts) — that is now the one and only
// progress-tracking system; `matching_run_progress` has been dropped.
//
// This file is kept in the repo (rather than deleting the function) only so
// the frontend's `seedDemoMatches()` wrapper (src/services/api.ts), which has
// no callers anywhere in the UI, keeps resolving to an honest, explicit
// "disabled" response instead of a 404. Do not restore the old pipeline logic
// here without re-adding the necessary cost/rate controls first.
Deno.serve(async (req: Request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  return new Response(
    JSON.stringify({
      success: false,
      legacyPaidPipelineBlocked: true,
      error: 'Legacy seed/matching launcher is disabled because it could trigger paid discovery. Use internal matching and the controlled external fallback workflow.',
    }),
    { status: 423, headers },
  );
});
