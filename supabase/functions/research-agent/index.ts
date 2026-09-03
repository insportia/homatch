// Production source is deployed as Supabase Edge Function `research-agent` v7.
//
// Contract:
//   start  { action:'start', query, type:'property'|'cadastral', language }
//   status { action:'status', jobId, language }
//   resume { action:'resume', jobId, language }
//
// v7 removes the synchronous 70-second OpenAI research wait that caused
// `TimeoutError: Signal timed out`. Each research phase now starts an OpenAI
// Responses API background job (`background:true`, `store:true`) and persists
// its response id in `research_jobs.response_id`. Subsequent short status calls
// retrieve provider state and persist the completed phase before advancing.
// No Supabase request remains open while web research/reasoning is running.
//
// Pipeline:
//   QUEUED -> IDENTITY_WAITING -> OFFICIAL_READY
//   -> OFFICIAL_WAITING -> MARKET_READY
//   -> MARKET_WAITING -> SYNTHESIS_READY
//   -> SYNTHESIS_WAITING -> COMPLETE
//
// Provider start/poll network operations have only a 15s transport guard; that
// guard does NOT limit research duration because research continues server-side.
// Intermediate findings/evidence survive every phase and are used by the next.
//
// Evidence rules: public evidence only; NO EVIDENCE = NO FACT; missing evidence
// is neutral; spelling/transliteration variants are not conflicts; only
// evidence-backed MEDIUM/HIGH risks reach the final report. Confidence is an
// evidence class (HIGH/MEDIUM/LOW), never a fabricated numeric percentage.
//
// Human/CAPTCHA UI is intentionally not triggered unless a real browser/computer
// verification event exists; absence of indexed cadastral evidence is not CAPTCHA.
export {};
