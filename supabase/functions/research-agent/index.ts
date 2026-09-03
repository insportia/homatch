// Production source is deployed as Supabase Edge Function `research-agent` v8.
//
// Contract:
//   start  { action:'start', query, type:'property'|'cadastral', language }
//   status { action:'status', jobId, language }
//   resume { action:'resume', jobId, language }
//
// v8 fixes the frontend/backend job identifier contract and keeps all expensive
// OpenAI research asynchronous through Responses API background jobs. The start
// response always exposes `jobId`; status rejects an empty id with 400 rather
// than producing a misleading polling loop.
//
// Pipeline:
//   QUEUED -> IDENTITY_WAITING -> OFFICIAL_READY
//   -> OFFICIAL_WAITING -> MARKET_READY
//   -> MARKET_WAITING -> SYNTHESIS_READY
//   -> SYNTHESIS_WAITING -> COMPLETE
//
// Research policy:
// - real-estate specialist prompt; public evidence only; NO EVIDENCE = NO FACT
// - cadastral research explicitly prioritizes TAS service-response records,
//   NAPR/SLR, my.gov.ge property services, MS cadastral map and whole-web exact
//   cadastral-code searches, including parent/unit relationships
// - property/company research prioritizes entrepreneur registry, project and
//   developer sources
// - market phase seeks concrete listing/post URLs, comparables and indexed public
//   social/review evidence, both positive and negative
// - official phase requests document-specific URLs, dates and extracted facts
// - exact source URLs are persisted in evidence_bundle
// - interactive/CAPTCHA-only evidence is explicitly marked as requiring an
//   interactive verification layer; the web-search agent never pretends it
//   submitted a protected form or solved CAPTCHA
// - confidence is HIGH/MEDIUM/LOW evidence class, never a fabricated percentage
//
// NOTE: the full deployed implementation lives in Supabase Edge Functions. This
// repository file intentionally documents the production contract and behavior.
export {};
