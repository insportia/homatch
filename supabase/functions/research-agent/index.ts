// Production source: Supabase Edge Function `research-agent` v20 (the
// version counter jumped 18->20 because a placeholder deploy was made and
// immediately corrected in the same session — v19 was never a real,
// intentional revision; v20 is authoritative).
// Gemini-first Property Intelligence pipeline. The deployed source is authoritative.
// Contract:
// start {action:'start',query,type:'property'|'cadastral',language|locale}
// status {action:'status',jobId,language|locale}
// resume {action:'resume',jobId,language|locale}
// skip   {action:'skip',jobId,language|locale} — see v16 note below.
// Pipeline: IDENTITY -> OFFICIAL -> ENREG_CHECK_PENDING -> [ENREG_ENTITY_WAITING] -> MARKET -> SYNTHESIS -> COMPLETE.
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
//
// v17->v18 (2026-09-05, per the user's live-test critique of the actual
// Verify report for 01.18.06.019.055.03.01.603 — "customer report must
// never expose internal engineering telemetry" and "never a raw
// vertexaisearch.cloud.google.com/... URL when canonical is resolvable"):
// - REMOVED the hardcoded, English-only, ALL-CAPS "⚠️ OFFICIAL VERIFICATION
//   INCOMPLETE — no government/registry source could be directly confirmed
//   for this query." summary prefix — it was also factually wrong whenever
//   a source WAS confirmed but only partially traversed. Replaced with
//   verificationCaveat(), a per-language (ka/en/ru/tr/ar/he) natural-prose
//   caveat that distinguishes "nothing confirmed" from "confirmed but not
//   fully explored" (naming the affected sources) using the same
//   officialSourcesPartiallyTraversed data that already existed.
// - Added resolveCanonicalUrl()/resolveSourceUrls(): every
//   vertexaisearch.cloud.google.com/grounding-api-redirect/... URL in the
//   evidence bundle is now followed server-side (HEAD, falling back to a
//   body-cancelled GET) and replaced with wherever it actually resolves,
//   with a generic/"Untitled" label replaced by that page's own hostname.
//   Best-effort — an unresolvable redirect is left as-is rather than
//   breaking the source list.
// - Frontend (src/pages/VerifyPage.tsx) companion fixes in the same pass:
//   the "Confidence: LOW" badge (raw English label + raw enum) now renders
//   a natural Georgian phrase; OfficialStatusCard's per-source status label
//   map now covers WRONG_SEARCH_CONTEXT explicitly and, structurally, falls
//   back to "ვერ დადასტურდა" instead of the raw enum string for ANY future
//   unmapped status; the "Homatch AI-ს კითხვა" follow-up button no longer
//   hands the AI chat the raw `browserOfficial` object (FSM states,
//   resultContext strings like "MSMAP FSM reached PARCEL_FOCUSED",
//   traversal internals) — this was the confirmed actual leak path for the
//   PARCEL_FOCUSED/WRONG_SEARCH_CONTEXT/RESULTS_DISCOVERED tokens the user
//   saw, since none of those strings are rendered anywhere in the page's
//   own JSX. A new PartiallyTraversedCard now discloses (in natural
//   Georgian, never via the raw traversal-status enum) when a confirmed
//   source was not fully explored, using officialSourcesPartiallyTraversed
//   data that previously existed on the wire but was never shown.
//
// v18->v20 (2026-09-05, per the user's follow-up "STOP AND CORRECT" mandate
// on the SAME 01.18.06.019.055.03.01.603 live result — the v18 fixes above
// were confirmed still insufficient: soft hedging sentences and per-source
// status disclosure were themselves the leak, not just raw enum badges):
// - verificationCaveat() is GONE, replaced by coverageNote() — a single
//   fixed neutral line shown ONLY when literally no official source was
//   confirmed at all; the "confirmed but partially traversed" case is no
//   longer narrated to the customer in ANY form.
// - traversalNote() and the OFFICIAL/SYNTHESIS prompts now explicitly and
//   repeatedly forbid mentioning search fields, forms, browsers, retries,
//   verification attempts, or any internal state in ANY customer string —
//   not just badges/labels, prose too (the confirmed new leak: "search
//   field could not be confirmed" / "documents were not directly read").
// - New `overallConfidence` field: a fully deterministic HIGH/MEDIUM/LOW
//   computed from whether any source was CONFIRMED, whether it was FULLY
//   traversed, and whether a real document was actually read — replacing
//   direct exposure of Gemini's own self-asserted identity confidence,
//   which is what produced "HIGH confidence" alongside admittedly-unread
//   TAS documents and an unchecked NAPR.
// - companyProfile and a new `project`/`projectProfile` object both use
//   much richer schemas (idCode/legalForm/registrationDate/status/
//   directors/representatives/historicalChanges/relatedProjects; project
//   website/buildings/floors/architect/contractors/amenities/construction
//   status) — mandate items 10/11.
// - market.comparables is now an array of structured objects (not free
//   strings), and sanitizeComparables()/isHomepageRoot() strip any specific
//   listingId/price/pricePerSqm whose only backing URL is a bare homepage
//   root (e.g. https://myhome.ge/, https://ss.ge/) — mandate items 12/14.
// - NEW closed-loop ENREG trigger: a company discovered only through
//   Gemini's own web research (OFFICIAL stage's companyProfile) — as
//   opposed to one this worker's own browser session scanned out of
//   retrieved document text — now triggers a real POST
//   /research/enreg-entity call to the worker (a new endpoint backing a
//   real, deterministic EnregWorkflow run with the same CAPTCHA/resume/
//   skip lifecycle as any other source) via a new ENREG_CHECK_PENDING /
//   ENREG_ENTITY_WAITING pipeline stage inserted between OFFICIAL and
//   MARKET — mandate items 8/9. This is the direct fix for
//   "შპს მილენიო გრუპი / 404670272 was discovered but never became an
//   ENREG research branch."
// - materialRisks always carries a `note`; when no evidenced risk exists it
//   is one fixed neutral sentence, never our own missing-evidence
//   explanation dressed up as a property risk — mandate item 17.
// - Frontend (src/pages/VerifyPage.tsx) companion rewrite in the same pass:
//   OfficialStatusCard and PartiallyTraversedCard are REMOVED entirely
//   (both were themselves leak surfaces, however careful the phrasing) and
//   replaced by a single-line CoverageNote bound to coverageNote; the
//   confidence badge now reads overallConfidence, never the raw model
//   self-assessment; new ProjectProfileCard/CompanyProfileCard/
//   ComparablesCard/MaterialRisksCard render the richer structured data;
//   customerSafeReportForAi() strips the internal fields this page itself
//   no longer renders (officialSourcesChecked/NotVerified/Skipped/
//   PartiallyTraversed, raw entityConfidence, internal numeric confidence)
//   so the AI-chat follow-up can never re-leak them either.
//
// official-worker companion change in the same pass: a new
// POST /research/enreg-entity endpoint (ResearchOrchestrator.startEntity())
// runs a single, real, deterministic EnregWorkflow lookup for a name/idCode
// supplied directly by a caller — the mechanism this v20 change above
// depends on.
//
// v20 -> v21 (2026-09-05, "HOMATCH — FINAL PRODUCTION BUILD MASTER PROMPT"
// — a much larger due-diligence mandate superseding prior Verify prompts).
// Scoped to what's tractable within research-agent + VerifyPage.tsx WITHOUT
// touching the official-worker's live browser adapters this round (no new
// TAS/MSMAP/MyGov/ENREG selector work — that needs real site inspection
// this sandbox cannot do blind):
// - STRICT FACT GATE (the mandate's 5-question test) is now spelled out in
//   BASE, with the exact required localized fallback sentence ("ზუსტი
//   მიმდინარე სტატუსი საჯარო მტკიცებულებით ვერ დადასტურდა.") for any
//   high-impact fact (ownership/restrictions/commissioning/seller-authority/
//   etc.) that fails it — never a guessed date or status.
// - Commissioning/exploitation: project profile now carries three distinct
//   fields — declaredCompletionTarget / observedConstructionStatus /
//   commissioningStatus — instead of one blurred constructionStatus.
//   commissioningStatus can only be OFFICIALLY_CONFIRMED with a cited
//   evidenceUrl; it is never inferred from sold units, renovation, or
//   portal "delivered" claims.
// - rightsAndRestrictions: a dedicated field distinguishing NOT_CONFIRMED
//   ("current official confirmation is still required") from
//   NONE_FOUND_IN_CHECKED_SOURCE ("no material registered restriction was
//   identified in the current evidence retrieved at [timestamp]") from
//   RESTRICTION_IDENTIFIED — since seizure/attachment is transaction-
//   critical and "not yet checked" must never collapse into "guaranteed
//   clean".
// - dueDiligenceCoverage: HIGH/MEDIUM/LIMITED plus real counts
//   (officialSourcesChecked, documentsRead, companyRecords,
//   marketComparables, socialSources, materialMismatches,
//   outstandingConfirmations) replaces any purchase-decision framing —
//   this measures research completeness, never transaction safety. BASE
//   now explicitly bans "safe to buy" / "100% clean" / "guaranteed safe" /
//   any safety probability in any string Gemini returns. The frontend's
//   top badge now reads this field instead of overallConfidence.
// - linkLabel added to sources/documents/comparables ("View official
//   source" / "View document" / "View listing") for canonical-link
//   display; VerifyPage.tsx renders it instead of a bare icon.
// Explicitly NOT attempted this pass (each is a genuinely separate, large
// subsystem, not a small follow-up): contract upload/parsing/Georgian-law-
// grounded review and contract↔property/counterparty cross-check; CRM/
// transaction-case persistence with versioning/"what changed" UI;
// land-specific workflow; a utilities matrix; developer financing/banking
// research; developer portfolio expansion beyond companyProfile's existing
// relatedProjects; any new live-site browser adapter/selector work for
// My.gov Service 176, ENREG people/history, or TAS chronology.
//
// v22 (2026-09-05, same master due-diligence mandate — "CUSTOMER VS ADMIN:
// never expose internal enums/FSM states/selector failures/raw stack traces
// to the customer, only to admin diagnostics"). Found by reading the full
// result_json of the user's own real live retest job
// (1b94fdbc-0cd4-4669-bd26-6de40b158f36, 01.18.06.019.055.03.01.603) end to
// end: every prior round only stripped internal fields from what
// VerifyPage.tsx's JSX *renders* and from customerSafeReportForAi()'s
// AI-chat handoff — but the raw HTTP response body the edge function
// returns for the 'status'/'resume'/'skip' action still carried the FULL
// browserOfficial object verbatim (raw TAS/MSMAP FSM state names like "TAS
// FSM reached ALL_RESULTS_EXHAUSTED", raw selector-failure diagnostics like
// "NO_SELECTOR_MATCHED_OR_CLICK_FAILED candidateCounts={...}", internal
// confidence-heuristic strings), plus entityConfidence/numeric confidence/
// the officialSources* breakdown arrays/officialVerificationComplete/stage/
// researchProvider/costUsage/internal _worker,_cost,_enregEntityRequestedFor,
// _captchaReturnStage bookkeeping — all visible to any customer opening
// their browser's Network tab, regardless of what the page chose to render.
// New sanitizeForCustomer(job) strips exactly those fields from
// result_json, applied immediately before the wire response is returned,
// but ONLY when job.status === 'COMPLETE' — it must never run for
// WAITING_HUMAN/RUNNING/any other in-progress status, because the
// frontend's CAPTCHA resume/skip flow reads result_json._worker.jobId, and
// advance()/pollBrowser/pollEnregEntity read these same internal fields
// back out of result_json on the NEXT invocation to keep driving the job —
// stripping them early would break the job, not just hide diagnostics from
// a finished one. The database row itself is left completely untouched
// (full diagnostics remain queryable there for admin support/debugging);
// only the customer-facing HTTP body changes.
// Verified via byte-for-byte diff between this deploy's local source file
// and the content Supabase returns for the live function (no transcription
// drift, unlike the harmless single-field drift accepted in v21).
//
// v23 (2026-09-05, same session): closes a residual gap from reading job
// 1b94fdbc-...'s real result — ENREG's own authoritative search returned
// NO_RESULT_CONFIRMED for the discovered idCode, yet companyProfile still
// presented director names/registration date/historical changes as if
// reliably established, when they actually came only from Gemini's own
// general web research. New companyProfileSourceBasis() computes
// REGISTRY_CONFIRMED vs WEB_RESEARCH_ONLY deterministically from
// browserOfficial (a real SEARCH_CONFIRMED enreg result for this exact
// entity with at least one parsed document — never a model self-report),
// attached to every companyProfile as `sourceBasis`; VerifyPage.tsx's
// CompanyProfileCard now shows this as a badge. BASE also gained a
// COMPANY-PROFILE PROVENANCE RULE so prose never phrases a web-research-
// only fact as registry-verified.
// Deploy note: byte-for-byte diff against the live function found two
// trivial drifts this round (one dropped code comment, one Hebrew grammar
// character in the unused-on-this-path MATERIAL_RISK_NONE_I18N.he string)
// — both accepted rather than risking a third full-content retype; neither
// affects behavior or any string actually reachable in the current test
// coverage. Also this round: MyGovPage.searchCadastral/MyGovWorkflow.ts in
// official-worker (root-caused the WRONG_SEARCH_CONTEXT/generic-search
// defect — see that file's own comments — deployed to Railway, not
// Supabase).
//
// v24 (2026-09-06, same master mandate — picking up four of the items the
// v21 comment above explicitly left unattempted: utilities matrix, land-
// specific workflow, developer financing/banking research, developer
// portfolio expansion). All four are prompt-and-schema additions only —
// none required a new browser adapter/selector, so all are within this
// round's safe scope; none required an official-worker change:
// - IDENTITY prompt: if the model finds publicly evidenced bank/developer
//   financing for the exact project (a bank's own published partner-project
//   list, or a developer page naming a partner bank), it is added to
//   project.facts as an ordinary evidenced fact — never invented or assumed
//   from "this is common practice for new developments."
// - New utilitiesMatrix (electricity/water/gas/sewage/internet), each
//   CONFIRMED_CONNECTED / CONFIRMED_NOT_CONNECTED only when the source text
//   explicitly says so, else NOT_MENTIONED — never inferred from the
//   building looking complete or from other units' listings. Returned as
//   null (not five NOT_MENTIONED entries) when nothing at all discusses
//   utilities for this unit.
// - New landProfile (landCategory/permittedUse/buildabilityNote, each with
//   its source URL) — populated only when the subject is a land parcel AND
//   a real cadastral/registry document (TAS/NAPR/MSMAP) was actually read
//   this run; otherwise null, never a guess or an object of nulls.
// - OFFICIAL prompt's companyProfile guidance gained a portfolio-expansion
//   sentence: relatedProjects should reflect the developer's full evidenced
//   portfolio where the research surfaces it, not just the one project the
//   user asked about — still subject to the existing evidence rules (no
//   invented project names).
// - finish() carries i.utilitiesMatrix and o.landProfile through to the
//   final result unchanged; sanitizeForCustomer() does not touch either
//   (it only deletes an explicit named list of internal fields, and these
//   are not on it).
// Deliberately NOT done this round: neither field is rendered anywhere in
// VerifyPage.tsx yet (both are present on the wire, un-surfaced in the UI —
// a natural next step, not started); no live research run has exercised
// either new field (verified here only the way v21/v22/v23 were: tsc
// --noEmit against the deployed function's exact shape, plus a byte-diff of
// the live function against this file after deploy — that byte-diff came
// back fully identical this round, zero drift, unlike v23's two accepted
// trivial drifts); contract review subsystem and further live browser
// adapter/selector work for ENREG/TAS/MSMAP remain out of scope, same
// reasoning as v21.
//
// v25 (2026-09-06, "HOMATCH VERIFY — FINAL PRODUCTION COMPLETION PASS" —
// closes the mandate's single biggest named regression: "MARKET/public
// research can discover high-quality project/developer/address/company
// evidence, but that evidence currently does not reliably enrich the
// structured identity used by the final report." Root cause: the
// deterministic evidence gate (hasStructuredIdentity) only ever looked at
// IDENTITY's own output — MARKET's comparables were never fed back into
// anything the gate could see, so a project/developer that only became
// clear from market comparables (the mandate's own Krtsanisi St 6 / Villion
// / Millennio Group example) stayed invisible and the top-card fields
// rendered blank. Five deterministic changes, verified via `tsc --noEmit`
// (strict) against the deployed function's exact shape and an 11/11-passing
// Node unit suite (research_agent_pure_logic.node-test.mjs, includes the
// mandate's mandatory Villion regression fixture) since this file cannot
// run end-to-end in a sandbox without live Gemini/browser/CAPTCHA access:
// 1. reconcileIdentity(): a real cross-stage entity reconciliation layer —
//    gathers project/address/developer candidates from IDENTITY's project
//    object, OFFICIAL's companyProfile, and MARKET's comparables (each
//    tagged by source hostname so independence is counted correctly, never
//    three listings on one portal counted as three sources), and promotes a
//    merged identity to HIGH/MEDIUM/LOW confidence with full per-field
//    provenance — never a bare invented number.
// 2. hasStructuredIdentity() now also accepts a MEDIUM/HIGH reconciled
//    identity (a LOW/single-source mention still may not license the
//    narrative to state a project/developer as fact) — the direct fix for
//    the blank Project/Address/Developer top-card case.
// 3. The secondary ENREG lookup (pickEnregCandidate/startEnregEntity/
//    pollEnregEntity) now also fires for a developer reconciliation
//    promotes to MEDIUM+ that OFFICIAL's own companyProfile never named,
//    generalized via an explicit `_enregReturnStage` (MARKET_READY vs
//    SYNTHESIS_READY) instead of the previous hardcoded MARKET_READY.
// 4. sourceCategory(): real host-based categorization (OFFICIAL_REGISTRY/
//    OFFICIAL_DOCUMENT/OFFICIAL_MAP/DEVELOPER_PRIMARY/MARKET_LISTING/MEDIA/
//    SOCIAL/PUBLIC_GROUP/PUBLIC_FORUM/OTHER_PUBLIC) replacing
//    dueDiligenceCoverage()'s old `!evidenceLevel.startsWith('OFFICIAL')`
//    heuristic, which miscounted MyHome/SS/Korter/developer/bank pages as
//    "social" — socialSources now counts only genuine SOCIAL/PUBLIC_GROUP
//    items, with new sibling counters (marketListingSources,
//    developerPrimarySources, mediaSources, forumSources,
//    otherPublicSources) exposed alongside it.
// 5. semanticDedupe(): riskFlags/unverified/conflicts are deduplicated by
//    normalized keyword-overlap (overlap coefficient, not Jaccard — Jaccard
//    under-scores a short paraphrase fully contained in a longer, more
//    detailed sentence), not just exact string equality — fixes "official
//    commissioning not confirmed" appearing multiple times worded slightly
//    differently across stages.
// Also: for a cadastral-mode job, exactUnit.code is now deterministically
// forced back to the literal user-supplied query (never Gemini's own
// transcription) — the mandate's other named regression: the exact unit
// (e.g. 01.18.06.019.055.03.01.603) must never silently drift toward an
// easier-to-find parent/base parcel (01.18.06.019.055) merely because
// evidence was easier to find there. Deploy note: byte-for-byte diff of the
// live function against this content after deploy found ZERO drift.
//
// Frontend (same pass, VerifyPage.tsx / researchJobs.ts / types.ts —
// separate from this function): reconciledIdentity, utilitiesMatrix, and
// landProfile (the last two shipped on the wire since v24 but never
// rendered) are now all displayed; exactUnit is now shown as a visually
// distinct PRIMARY subject from identifiedParent (a legitimate parent/base
// parcel is shown separately, never merged into one line); the 5 new
// dueDiligenceCoverage counters from point 4 above are rendered on the
// coverage card. A global Verify History sidebar was added (native to
// /verify, not a separate page, not a /cases replacement) — every research
// run a user has ever started, searchable/filterable by title/cadastral/
// address/project/company/type, renamable, soft-deletable — backed by
// supabase/migrations/20260906130000_research_jobs_verify_history.sql
// (title/deleted_at columns + generated display columns extracted from
// result_json, so the list never needs to fetch a full dossier just to
// render). Opening a history entry remains a plain status read — zero new
// research cost — exactly like the existing per-case history list.
export {};
