// Production source lives in Supabase Edge Function `research-agent`.
// This repository copy documents the v3 contract used by VerifyPage.
// Authenticated POST body: { query, type: 'property'|'cadastral', language, jobId? }
// The function creates/resumes research_jobs, performs high-context evidence-first
// OpenAI Responses API web research, persists evidence/progress/result_json, and
// returns HUMAN_VERIFICATION_REQUIRED for cadastral searches whose exact unit is
// not directly proven by official evidence. NO EVIDENCE = NO FACT.
//
// NOTE: keep this file synchronized with the deployed Edge Function when editing.
export {};
