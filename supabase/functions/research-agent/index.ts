// Production source: Supabase Edge Function `research-agent` v10.
// Gemini-first Property Intelligence pipeline. The deployed source is authoritative.
// Contract:
// start {action:'start',query,type:'property'|'cadastral',language|locale}
// status {action:'status',jobId,language|locale}
// resume {action:'resume',jobId,language|locale}
// Pipeline: IDENTITY -> OFFICIAL -> MARKET -> SYNTHESIS -> COMPLETE.
// Provider: Gemini Interactions API with Google Search + URL Context for evidence collection.
// Security: JWT required, server-side GEMINI_API_KEY only, owner-scoped research_jobs.
// Research rule: NO EVIDENCE = NO FACT; missing evidence is neutral; interactive official forms are never represented as directly verified.
// Exact deployed implementation was synchronized to production on 2026-09-04.
export {};
