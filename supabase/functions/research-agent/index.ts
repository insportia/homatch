// Production source: Supabase Edge Function `research-agent` v16.
// Gemini-first Property Intelligence pipeline. The deployed source is authoritative.
// Contract:
// start {action:'start',query,type:'property'|'cadastral',language|locale}
// status {action:'status',jobId,language|locale}
// resume {action:'resume',jobId,language|locale}
// skip   {action:'skip',jobId,language|locale} — see v16 note below.
// Pipeline: IDENTITY -> OFFICIAL -> MARKET -> SYNTHESIS -> COMPLETE.
// Provider: Gemini Interactions API with Google Search + URL Context for evidence collection.
// Security: JWT required, server-side GEMINI_API_KEY only, owner-scoped research_jobs.
// Research rule: NO EVIDENCE = NO FACT; missing evidence is neutral; interactive official forms are never represented as directly verified.
//
// v14 (2026-09-04, per the user's 10-point production mandate):
// - officialVerificationSummary() now splits the old undifferentiated
//   "checked" bucket into officialSourcesConfirmedFound (SEARCH_CONFIRMED)
//   and officialSourcesConfirmedNoResult (NO_RESULT_CONFIRMED), each carried
//   through to the final result alongside the original officialSourcesChecked
//   (kept for backward compatibility). The OFFICIAL and SYNTHESIS prompts
//   both explicitly instruct Gemini that NO_RESULT_CONFIRMED proves only
//   that one exact verified search returned nothing on that source — never
//   that the property/record does not exist — and that BLOCKED means the
//   source refused/rate-limited the request, not that no search field exists.
// - Both prompts note that MY.GOV.GE service 176 (naprweb.reestri.gov.ge) and
//   NAPR are the SAME registry (per the worker's SOURCES.mygov dedup), never
//   two independent sources.
// - bev() now builds the evidence bundle from each source's real, validated
//   `documents` array (SHA-256 hash, extracted title/date from the worker's
//   pdfEvidence()) instead of the bare documentLinks list; officialDocuments()
//   exposes that same worker-validated set directly on the final result as
//   officialDocumentsRetrieved, independent of whatever Gemini's OFFICIAL
//   stage separately claims in result.documents.
// - pollBrowser()/finish() carry the worker's job.historicalComparison
//   (chronologically sorted, line-level diff between dated documents) through
//   to result.historicalComparison; both prompts instruct Gemini to restate
//   only its addedInNewer/removedFromOlder arrays verbatim, never to infer a
//   change beyond that structured diff.
//
// v15/v16 (2026-09-05, Verify research-graph pivot — CAPTCHA skip support):
// - New `action:'skip'` (mirrors 'resume'): brings a WAITING_HUMAN job's
//   research_jobs.stage back to RUNNING/BROWSER_WAITING so pollBrowser()
//   resumes, without requiring the human-verification challenge to be
//   completed. The frontend's ResearchCaptchaModal calls the official-worker's
//   own new `POST /research/:id/skip` endpoint directly (worker job id)
//   BEFORE invoking this action, which is what actually marks that source's
//   result SKIPPED_HUMAN_VERIFICATION and continues the worker's run(); this
//   action's own best-effort call to the same worker endpoint (tolerating a
//   404, meaning "already skipped by the modal") is a safety net only.
// - wf() now tolerates a 404 from the worker (in addition to the existing
//   409) on /resume and /skip calls — the worker session may already have
//   been closed by the frontend's direct call before research-agent's own
//   call reaches it; this is a normal race, not an error.
// - officialVerificationSummary() adds a dedicated `officialSourcesSkipped`
//   bucket for SKIPPED_HUMAN_VERIFICATION results — deliberately excluded
//   from officialSourcesNotVerified so a user-chosen skip is never rendered
//   as a generic "could not be verified" technical failure. Carried through
//   to the final result as officialSourcesSkipped.
// - Both the OFFICIAL and SYNTHESIS prompts now explain SKIPPED_HUMAN_VERIFICATION
//   semantics explicitly and require the exact disclosure phrasing: "<source>
//   — verification incomplete. Human verification was required and this
//   source was skipped. The report below is based on the other successfully
//   researched sources." — and instruct Gemini never to conflate a skip with
//   a technical failure or a confirmed negative result.
export {};
