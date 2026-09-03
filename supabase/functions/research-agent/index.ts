// Production source lives in Supabase Edge Function `research-agent`.
// Deployed contract: v6 staged async research pipeline.
//
// Authenticated POST actions:
//   start  { query, type: 'property'|'cadastral', language }
//   status { action:'status', jobId, language }
//   resume { action:'resume', jobId, language }
//
// Pipeline is deliberately split into bounded independent calls so a single
// long OpenAI web-research request cannot pin the whole job at one percentage:
//   QUEUED (5)
//   IDENTITY_RESEARCH (15) -> OFFICIAL_READY (28)
//   OFFICIAL_RESEARCH (38) -> MARKET_READY (52)
//   MARKET_RESEARCH (62) -> SYNTHESIS_READY (76)
//   SYNTHESIZING (86) -> COMPLETE (100)
//
// VerifyPage polling of `status` advances READY stages. Each provider call has
// a 70s abort bound, uses low reasoning, and web-search stages use low search
// context. Intermediate JSON and evidence are persisted to research_jobs after
// every completed stage, so later stages resume from saved work.
//
// Generic absence of indexed cadastral evidence no longer pretends that a
// CAPTCHA was encountered. Human/CAPTCHA UI must only be triggered by a real
// future browser/computer verification event.
//
// Evidence rules: public evidence only; NO EVIDENCE = NO FACT; missing evidence
// is neutral; transliteration/spelling variants are not material conflicts;
// only evidence-backed MEDIUM/HIGH risks reach the final report.
//
// NOTE: production implementation is managed/deployed in Supabase and this
// repository file documents the live frontend/backend contract.
export {};
