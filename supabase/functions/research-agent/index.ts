import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// v28 (2026-09-06, "HOMATCH VERIFY — FINAL PRE-PUSH CONSOLIDATION / ADAPTIVE
// RESEARCH ENGINE / RECORDED OFFICIAL WORKFLOWS" — the FINANCIAL/COMPANY
// SOURCE EXPANSION + ADAPTIVE ASSET LOGIC sections; official-worker's own
// recorded-selector fixes for TAS/MSMap/MyGov/NAPR popups live entirely in
// that service, not here, and remain a named limitation — see that repo's
// own commit history).
//
// PROVENANCE NOTE (found and fixed this pass, not something this pass
// caused): the git-tracked copy of this file had been reduced to a
// changelog-only comment block ending in a bare `export {}` — the actual
// ~1580-line source only existed in the deployed Supabase Edge Function
// (project ptxajsjhobhvsfhmutjn, slug `research-agent`, version 27). A
// prior pass had documented this as a deliberate convention (see this
// repo's supabase/functions/tests/research_agent_pure_logic.node-test.mjs,
// whose own header claimed "the checked-in index.ts is a changelog-only
// stub") — but that is worse practice than it needed to be (production
// business logic with no real version-controlled source), and is corrected
// starting this pass: this file is restored from the live v27 deployment
// (mcp__Supabase__get_edge_function, byte-identical copy) and is kept as
// the genuine, real, diffable source from here on — every future deploy
// should keep this file byte-for-byte in sync with what actually ships,
// the way the version-history comments below always claimed but the file
// itself had stopped actually being.
//
// FINANCIAL/COMPANY SOURCE EXPANSION (this pass's main change): a company
// discovered via companyProfile.idCode can now also trigger real,
// deterministic RS Taxpayers Registry ('rstax') and MyGov Debtor Registry
// ('debtor') lookups, via the SAME closed-loop CAPTCHA/resume/skip
// lifecycle as the existing ENREG entity trigger — see official-worker's
// new POST /research/rstax-entity and /research/debtor-entity endpoints
// (workflows/financial/FinancialSourceWorkflow.ts). Generalized
// pickEnregCandidate/startEnregEntity/pollEnregEntity into
// pickFinancialCandidate/startFinancialEntity/pollFinancialEntity, driven
// by a small persisted queue (`_financialQueue`) so enreg/rstax/debtor run
// sequentially without duplicating the CAPTCHA-pause plumbing three times.
// Deliberately conservative, per the mandate's own "not blindly always"
// instruction: unlike enreg (which also accepts a bare name), rstax/debtor
// ONLY ever fire when a concrete companyProfile.idCode is already
// evidenced — neither registry exposes a name-search field (confirmed live
// via the user's own browser, see official-worker/src/workflows/
// financial/selectors.ts), and a lookup keyed off nothing but a guessed
// name would either fail outright or, worse, invite typing an unrelated
// value into a national-ID-only field. This also means these two NEVER
// fire for a private individual's personal ID — companyProfile only ever
// carries a company/developer identity, never a person's — satisfying the
// mandate's "personal ID ONLY when the user supplied/authorized it" rule
// structurally (there is no code path that could populate one).
//
// ADAPTIVE ASSET LOGIC: new IDENTITY-stage `assetClass` field (evidence-
// classified, not guessed) — apartment-in-project / private-resale /
// private-house / land / commercial / rental / under-construction /
// company-owned / mixed-or-unknown — carried through to the final result.
// OFFICIAL's own prompt now explicitly tells Gemini not to force company/
// developer research onto a private resale or private house that shows no
// evidenced company involvement — the deterministic rstax/debtor gate above
// already requires a real idCode, so this is prompt-level reinforcement of
// the same "skip irrelevant categories cleanly" principle, not a new gate.
//
// FINANCIAL/DEBT REGISTRY WORDING RULE: a new BASE clause forbids ever
// phrasing a RS Taxpayers/MyGov Debtor NO_RESULT_CONFIRMED as "no tax debt",
// "no debts", "clean", or "debt-free" — it proves only that this one exact
// search on that specific registry found no matching record for that
// identifier, matching the mandate's own required phrasing intent (the
// MyGov Debtor Registry's own "მოვალეთა რეესტრში შესაბამისი ჩანაწერი არ
// მოიძებნა ამ ძიებით" wording).
//
// Deliberately NOT attempted this pass, named as real limitations rather
// than silently skipped: the Free Research Query Engine's full entity-graph/
// alias-expansion/iterative-discovery machinery (a genuinely large, separate
// prompt-and-orchestration subsystem — out of scope for what could be
// safely verified this pass without live Gemini access); full adaptive
// gating of PRIMARY source dispatch (TAS/MSMap/MyGov/ENREG) by asset class —
// those remain always-run for cadastral mode, only the secondary financial/
// company lookups are asset-aware; TAS's own result-row popup/nested-iframe
// document chain and MSMap's mat-tree-node/coordinate selectors (both
// official-worker-side, both explicitly deferred there).
//
// v27 (2026-09-06, "HOMATCH VERIFY — FINAL OFFICIAL-SOURCE WORKFLOW FIX +
// CUSTOMER-VALUE REPORT CLEANUP" — this pass's ONE in-scope code-level change
// to research-agent itself; the mandate's actual official-source workflow
// fixes (TAS timing, MyGov ng-model selector, ENREG idnumber-field selector)
// live entirely in official-worker, not here). SOCIAL/PUBLIC SOURCES section:
// "Never show login pages as customer evidence. A Facebook login URL is not a
// useful source." resolveSourceUrls() could previously carry a bare
// accounts.google.com / facebook.com "login.php" / instagram.com
// "/accounts/login" style URL straight through into the customer-facing
// sources list whenever Gemini's own web search happened to surface one
// (e.g. a social profile whose public page redirected through a login wall)
// — displayed with no way for a customer to tell it apart from a real
// content URL. New isLoginPageUrl() is a deterministic host+path check
// (no LLM judgment, no new prompt text) for the small set of real login/auth
// entry-point shapes across the major platforms named in the mandate
// (Facebook/Google/Instagram/Twitter-X/LinkedIn); resolveSourceUrls() now
// filters these out of the resolved list entirely rather than relabeling or
// downgrading them — a login wall was never something Homatch actually read,
// so it is not shown at all, matching "Only show a concrete public
// post/profile/page/review URL if the content itself was actually
// accessible and relevant."
// Deliberately NOT touched this pass, per the mandate's own explicit "Do NOT
// spend this pass expanding prompts or adding more generic report prose" and
// "do not begin by rewriting prompts": the MUNICIPAL/COMMISSIONING RESEARCH
// term-expansion list and the PROJECT/DEVELOPER EXPANSION query-fan-out
// behavior are both prompt-level asks (broadening what the BASE/MARKET
// prompts instruct Gemini to search for) and are out of scope for this pass;
// they remain a real, named limitation rather than silently skipped.
//
// v26 (2026-09-06, "HOMATCH VERIFY — FIX THE ACTUAL BROKEN RUNTIME
// WORKFLOW, NOT THE PROMPT" — a live regression test on the same
// 01.18.06.019.055.03.01.603 fixture found the coverage ACCOUNTING was
// broken even though the underlying research/persistence were both working
// correctly. Traced end to end (submit -> research-agent -> official
// worker -> evidence persistence -> synthesis -> report) before touching
// anything; root causes were purely in how already-real, already-persisted
// per-adapter results were counted and surfaced, never in whether the
// worker actually ran (it does: startBrowser() makes a real HTTP POST to
// the Railway worker's /research endpoint, and pollBrowser() reads back
// real per-adapter results — confirmed against live production data).
// 1. dueDiligenceCoverage() only ever summed SEARCH_CONFIRMED +
//    NO_RESULT_CONFIRMED into "officialSourcesChecked" — every other real
//    terminal status an adapter can end in (SUBMIT_FAILED, BLOCKED,
//    SEARCH_CONTROL_NOT_FOUND, WRONG_SEARCH_CONTEXT, SUBMITTED_UNCONFIRMED,
//    FAILED) silently vanished from every count. A cadastral job dispatches
//    3 adapters (TAS/MSMAP/My.gov — see official-worker's
//    buildInitialSteps()); if 2 of them fail technically, the report showed
//    "1 official source checked" with zero visibility into what happened
//    to the other 2 — exactly the production symptom ("lists TAS/MSMap/
//    NAPR/ENREG links, but Official sources checked = 1, Documents read =
//    0"). New officialSourcesAttempted/officialSourcesRetrieved/
//    technicalFailures/documentsDiscovered fields, computed directly from
//    browserOfficial.results (the worker's own real per-adapter terminal
//    states, never Gemini's self-report), close this gap deterministically.
// 2. sanitizeForCustomer() unconditionally deleted officialSourcesNotVerified
//    — the ONE existing field that already bucketed those failures — as
//    "internal automation telemetry" (a prior round's fix for a real
//    FSM-state leak over-corrected into hiding the mere fact/count of a
//    failed attempt, which is a legitimate customer fact, not an internal
//    leak). New customerSourceStatus()/officialSourceCoverage() replace it
//    with a small, safe-by-construction per-source list (one of 6 neutral
//    values: SUCCESS/NO_RESULT/CAPTCHA_REQUIRED/BLOCKED/TECHNICAL_FAILED/
//    NOT_CONFIRMED — the mandate's own "MANDATORY OFFICIAL STATE MACHINE"
//    vocabulary) that sanitizeForCustomer() does NOT strip, so a source URL
//    being known/displayed can never again be visually confused with it
//    having actually been verified.
// 3. bev()'s per-source evidence entry also carried the RAW worker status
//    (e.g. 'SEARCH_CONTROL_NOT_FOUND') straight into sources[]/
//    evidence_bundle[] — a field sanitizeForCustomer() never reaches
//    (it only strips top-level result_json keys). Replaced with a
//    synthesized, always-safe retrievalMethod so raw internal enums can
//    never leak through the Sources card either.
// 4. UTILITY TARIFF/BILLING RULE added to BASE: the live test also
//    produced an uncited "may be charged at non-residential tariff before
//    commissioning" line — a causal/financial inference chained off an
//    already-unverified commissioning status. Per NO EVIDENCE = NO FACT,
//    that class of claim now requires the same direct-citation gate the
//    other STRICT FACT GATE categories already have.
// Deliberately NOT touched this pass (traced and found already correct —
// see the mandate's own "DO NOT touch working Villion reconciliation/
// market behavior unless required"): reconcileIdentity(), exactUnit
// force-fix, rightsAndRestrictions's own "current official confirmation
// required" fallback (a technical failure already correctly never becomes
// a property risk/restriction claim), and the worker's own dispatch logic
// (startBrowser()/pollBrowser() already make a real HTTP call and read
// real results — nothing here was faking or skipping that call).
//
// v25 (2026-09-06, "HOMATCH VERIFY — FINAL PRODUCTION COMPLETION PASS" —
// closing the single biggest architectural gap named in that mandate:
// "MARKET/public research can discover high-quality project/developer/
// address/company evidence, but that evidence currently does not reliably
// enrich the structured identity used by the final report." Root cause,
// found by reading this file end to end: hasStructuredIdentity() (the
// deterministic evidence gate that decides whether the narrative summary is
// allowed to name a project/developer at all) only ever looked at
// identity.identifiedParent/identity.project — i.e. only what the IDENTITY
// stage itself produced. MARKET's own comparables/facts/publicEvidence were
// never fed back into anything that gate could see, so a project/developer
// that only became clear from market comparables (the literal Krtsanisi
// St 6 / Villion / Millennio Group case) stayed invisible to the gate and
// the top-card fields rendered blank even though the market evidence in
// `sources`/`market.comparables` plainly named them.
// Five changes, all deterministic (no new browser adapter, no new prompt
// schema Gemini could get "creatively" wrong on a field a human never
// reviews):
// 1. reconcileIdentity(): a real cross-stage entity reconciliation layer.
//    Gathers project/address/developer candidates from IDENTITY's own
//    project object, OFFICIAL's companyProfile, and MARKET's comparables
//    (each comparable's own project/address strings, each tagged with its
//    source hostname), normalizes and groups them, and promotes a merged
//    identity with a HIGH/MEDIUM/LOW confidence exactly per the mandate's
//    rule (HIGH = direct/authoritative OR >=2 independent sources agree on
//    both project+address; MEDIUM = >=2 independent sources agree on one of
//    project/address, or one strong agreement plus the IDENTITY stage's own
//    lead; LOW = a single/ambiguous mention) — every promoted field keeps
//    its provenance (which source(s) and URL(s) backed it), never a bare
//    invented percentage. Runs once, right after MARKET's own finish()
//    completes, so both the SYNTHESIS prompt and the final result can see it.
// 2. hasStructuredIdentity() now also accepts reconciledIdentity (MEDIUM or
//    HIGH only — a LOW/single-source mention still may not license the
//    narrative to state a project/developer as fact) — this is the direct
//    fix for the blank Project/Address/Developer top-card fields.
// 3. Secondary ENREG lookup is no longer limited to a company OFFICIAL's own
//    companyProfile already named: pickEnregCandidate() now also considers
//    reconcileIdentity()'s promoted developer (MEDIUM+ confidence) when
//    OFFICIAL found none, and the ENREG_ENTITY_WAITING resume flow now
//    carries an explicit `_enregReturnStage` so the same lookup mechanism
//    can return to either MARKET_READY (the existing OFFICIAL-stage trigger)
//    or SYNTHESIS_READY (this new MARKET-stage/reconciliation trigger)
//    instead of the previous hardcoded MARKET_READY — the direct fix for
//    "IDENTITY does not confidently know developer, MARKET discovers
//    Millennio Group, the system must then perform the ENREG lookup before
//    final synthesis."
// 4. sourceCategory(): every evidence item now gets a real category
//    (OFFICIAL_REGISTRY/OFFICIAL_DOCUMENT/OFFICIAL_MAP/DEVELOPER_PRIMARY/
//    PROPERTY_PORTAL/MARKET_LISTING/MEDIA/SOCIAL/PUBLIC_GROUP/PUBLIC_FORUM/
//    OTHER_PUBLIC), replacing dueDiligenceCoverage()'s old
//    `!evidenceLevel.startsWith('OFFICIAL')` heuristic that counted every
//    non-official item — MyHome/SS/Korter/developer/bank sites included —
//    as a "social source". socialSources now counts only the SOCIAL
//    category; new marketListingSources/mediaSources/otherPublicSources
//    counters are exposed alongside it.
// 5. semanticDedupe(): riskFlags/unverified/conflicts are now deduplicated
//    by normalized keyword-overlap, not just exact string equality — the
//    fix for "official commissioning not confirmed" appearing two or three
//    times merely because Gemini phrased it slightly differently across
//    stages.
// Also: exactUnit.code is now deterministically forced back to the literal
// user-supplied query for cadastral-mode jobs (never Gemini's own
// transcription of it) — the mandate's other named regression ("never
// replace 01.18.06.019.055.03.01.603 with 01.18.06.019.055 merely because
// evidence is easier to find for the parent parcel") is a frontend/report
// concern too (VerifyPage.tsx, addressed separately), but the backend must
// not let the exact unit silently drift first.
// Not attempted in this pass (separate, large subsystems tracked in the
// mandate's own section numbering, addressed elsewhere in this session:
// Supabase Verify-history persistence/versioning/RLS and the native
// history sidebar are migrations + VerifyPage.tsx, not this function;
// contract upload/review is a distinct, not-yet-started subsystem).
//
// v24 (2026-09-06, continuing the master due-diligence mandate's residual
// scope list from v21/v23 — the items explicitly deferred back then as
// "genuinely separate subsystems", picking off the four that are pure
// prompt/schema additions on top of the EXISTING evidence-gate machinery,
// with no live browser adapter changes and no live LLM run available to
// verify against in this environment — so each is scoped to stay inert
// (never fabricate) rather than guessed-but-untested:
// - utilitiesMatrix (new IDENTITY field): electricity/water/gas/sewage/
//   internet, each {status,note}. status defaults to NOT_MENTIONED and can
//   only become CONFIRMED_CONNECTED/CONFIRMED_NOT_CONNECTED when the
//   listing/document text the model actually read states it explicitly —
//   same fact-gate discipline as every other field here, just newly
//   structured instead of buried in prose.
// - landProfile (new OFFICIAL field, land parcels only): landCategory/
//   permittedUse/buildabilityNote/source, populated ONLY from a cited
//   cadastral/registry document read this run (TAS/NAPR/MSMAP) — omitted
//   entirely (not guessed) for a non-land property or absent evidence.
// - developer financing: no new field — folded into the existing
//   project.facts guidance (IDENTITY) so a publicly evidenced bank/mortgage
//   partnership for this project is captured as an ordinary evidenced fact,
//   under the same STRICT FACT GATE already governing every other claim in
//   BASE (which already named "developer-financing, or bank-relationship
//   claim" as fact-gated — this just gives the model somewhere to put one).
// - developer portfolio expansion: no new field — OFFICIAL's companyProfile
//   guidance now asks for each relatedProjects entry to carry status/
//   evidence detail when the evidence supports it (e.g. "Project X —
//   completed 2024, per <url>") instead of a bare name, same string[]
//   shape so no frontend/type change is required to consume it.
// None of these four is verifiable end-to-end without a live research run
// against a real property (this sandbox cannot solve the CAPTCHA/human-
// verification gate interactively) — verified here only the way v21/v22/v23
// were: tsc --noEmit against the deployed function's exact shape, plus a
// byte-diff of the live function against this file after deploy. The
// remaining mandate items (contract review subsystem, additional live
// browser adapter work) are still out of scope for the reasons already
// on record.

// v23 (2026-09-05, same session, same live-retest analysis that produced
// v22's wire-level sanitization fix): closes the residual "companyProfile
// provenance" gap identified while reading job 1b94fdbc-...'s real result —
// ENREG's own authoritative search returned NO_RESULT_CONFIRMED for the
// discovered idCode, yet companyProfile still presented specific director
// names/registration date/historical changes as if reliably established,
// when they actually came only from Gemini's own general web research.
// New companyProfileSourceBasis() computes REGISTRY_CONFIRMED vs
// WEB_RESEARCH_ONLY DETERMINISTICALLY from browserOfficial (a real
// SEARCH_CONFIRMED enreg result for this exact entity with at least one
// parsed document — never a model self-report), attached to every
// companyProfile as `sourceBasis`. BASE also gained a COMPANY-PROFILE
// PROVENANCE RULE so prose never phrases a web-research-only fact as
// registry-verified.

// v21 (2026-09-05, "HOMATCH — FINAL PRODUCTION BUILD MASTER PROMPT" — a
// much larger due-diligence mandate superseding prior Verify prompts). This
// pass scopes to the parts tractable within the existing research-agent +
// VerifyPage.tsx surface, WITHOUT touching the official-worker's live
// browser adapters (no live TAS/MSMAP/MyGov/ENREG selector changes this
// round — those need real site inspection this sandbox cannot do blind):
// - STRICT FACT GATE (5-question test) is now spelled out in BASE, with the
//   exact required Georgian/localized fallback sentence for any high-impact
//   fact that fails it, instead of a guessed date/status.
// - Commissioning/exploitation: project profile now carries three distinct
//   fields (declaredCompletionTarget / observedConstructionStatus /
//   commissioningStatus) instead of one blurred "constructionStatus" —
//   commissioningStatus can only be OFFICIALLY_CONFIRMED with a cited
//   evidenceUrl, never inferred from proxies (sold units, renovation,
//   portal claims).
// - rightsAndRestrictions: a dedicated field distinguishing NOT_CONFIRMED
//   ("current official confirmation is still required") from
//   NONE_FOUND_IN_CHECKED_SOURCE ("no material registered restriction was
//   identified in the current evidence retrieved at [timestamp]") from
//   RESTRICTION_IDENTIFIED — the exact two-sentence gate the mandate
//   requires, since seizure/attachment is transaction-critical and "no
//   restriction found" must never collapse into "guaranteed clean".
// - dueDiligenceCoverage replaces any purchase-decision framing: HIGH/
//   MEDIUM/LIMITED plus real counts (officialSourcesChecked, documentsRead,
//   companyRecords, marketComparables, socialSources, materialMismatches,
//   outstandingConfirmations) — this measures research completeness, never
//   transaction safety. BASE also now explicitly bans "safe to buy",
//   "100% clean", "guaranteed safe" and any safety probability in any
//   string Gemini returns.
// - linkLabel added to sources/documents/comparables ("View official
//   source" / "View document" / "View listing") for canonical-link display
//   per the mandate's exact-label requirement.
// NOT attempted this pass (out of scope — each is a genuinely separate,
// large subsystem): contract upload/parsing/Georgian-law-grounded review
// and contract↔property/counterparty cross-check; CRM/transaction-case
// persistence with versioning/"what changed" UI; land-specific workflow;
// utilities matrix; developer financing/banking research; developer
// portfolio expansion beyond existing companyProfile.relatedProjects; any
// new live-site browser adapter/selector work for My.gov Service 176,
// ENREG people/history, or TAS chronology beyond what already exists.
//
// research-agent v19 (2026-09-05, per the user's "STOP AND CORRECT" mandate
// on the live 01.18.06.019.055.03.01.603 result). This is a direct rewrite
// of v18 in response to a much harder line: the report was still leaking
// our own automation/telemetry state into customer-facing prose (raw enum
// names AND soft sentences like "search field could not be confirmed" /
// "documents were not directly read" / "additional records may exist" —
// all now BANNED from any customer string, not just badges), confidence
// was self-asserted and logically inconsistent with what was actually
// verified, market/company/project evidence was too shallow and too often
// backed only by a bare homepage URL presented as if it were a specific
// citation, and a company discovered only through Gemini's own web search
// (never through this worker's own browser session) had no way to trigger
// a real ENREG lookup.
//
// What changed vs v18:
// 1. verificationCaveat() is GONE. No sentence anywhere may describe HOW or
//    WHY a source could not be verified. A `coverageNote` field exists ONLY
//    for the single case where literally nothing official was confirmed —
//    one static, neutral line, never naming a mechanism or a source's
//    specific failure.
// 2. `overallConfidence` is a new, fully deterministic field (never a
//    Gemini self-assessment) computed from: was any official source
//    actually confirmed, was it fully traversed (not just search-
//    confirmed), and was at least one real document read. This is what the
//    frontend now shows as "confidence" — the old entity-identification-only
//    `entityConfidence` is kept only as an internal/lesser field.
// 3. companyProfile and a new `project` (project/building profile) object
//    both use much richer schemas (legal form, registration date, status,
//    directors, representatives, historical changes; project website,
//    buildings, floors, architect, contractors, amenities, construction
//    status). SYNTHESIS may enrich companyProfile further once real ENREG
//    documents are available (see point 5).
// 4. market.comparables is now an array of STRUCTURED objects (source, url,
//    listingId, project, address, area, rooms, floor, condition, price,
//    currency, pricePerSqm, listingDate, similarity, retrievedAt) instead
//    of free-text strings, and any comparable whose only source is a bare
//    homepage root URL has its specific claims (listingId/price/pricePerSqm)
//    stripped server-side — a homepage can never stand in for a specific
//    citation, no matter what the prompt says.
// 5. NEW: a real closed-loop ENREG trigger for entities Gemini discovers
//    through its own web research (not just entities this worker's own
//    browser session scanned out of retrieved document text). After the
//    OFFICIAL stage, if companyProfile names a company not already covered
//    by a browser-driven ENREG result, this calls the worker's new
//    POST /research/enreg-entity endpoint (a real, deterministic
//    EnregWorkflow run, same CAPTCHA/resume/skip lifecycle as any other
//    source) and folds its result into browserOfficial before MARKET runs.
// 6. materialRisks always carries a `note`; when no evidenced risk exists it
//    is a single fixed neutral sentence, never our own missing-evidence
//    explanation dressed up as a property risk.
// v29 URGENT PRODUCTION FIX (2026-09-06) — CORS/transport only, no research
// workflow logic touched. Root cause (reproduced live, not guessed): a real
// authenticated POST from https://www.homatch.live got PAST auth (a valid
// session reaches this code, confirmed via a live test call) and then threw
// an uncaught exception somewhere in the QUEUED->advance()->launch() chain
// (this file's own advance() wraps most of its body in try/catch, but every
// branch does `return xxx(...)` — an un-awaited returned promise — so a
// LATER rejection from that promise is not caught by advance()'s own try;
// it instead surfaces when the top-level handler `await`s advance()).
// Because the previous version of this file had NO try/catch around its
// Deno.serve handler at all, that exception reached Deno's default
// unhandled-exception path, and Supabase's edge gateway substitutes its own
// generic `sb-error-code: EDGE_FUNCTION_ERROR` / plain-text "Internal Server
// Error" response for that case — which carries NO Access-Control-Allow-
// Origin header whatsoever (confirmed live: OPTIONS preflight and even a
// bad-JWT 401 from the gateway itself both DO carry CORS headers already;
// only this uncaught-exception path was missing them). The browser then
// correctly reports this as "blocked by CORS policy" even though the true
// defect is a transport-layer gap, not a CORS header design flaw.
// Fix, deliberately scoped to transport only:
//   1. A named allow-list (production origin + localhost dev, explicit
//      reflection — never a bare wildcard) replaces the old '*' constant.
//   2. Access-Control-Allow-Methods / -Max-Age added; -Allow-Headers widened
//      to include x-supabase-api-version.
//   3. CORS headers are now computed ONCE per request from that request's
//      own Origin header and closed over by a request-scoped `json`, so
//      every response in this invocation (2xx/4xx/5xx alike) carries them —
//      including the NEW top-level try/catch below, which is the actual
//      fix for the reported bug: it guarantees a JSON 500 WITH CORS headers
//      instead of a naked, header-less crash, no matter what throws inside.
// verify_jwt was investigated and left at `true`: live testing (a real
// confirmed-email test user, a real session JWT) showed the gateway lets a
// valid Authorization header straight through to this code (the crash above
// only happens strictly AFTER a successful sb.auth.getUser()), and even the
// gateway's own bad-JWT 401 already carries Access-Control-Allow-Origin —
// so verify_jwt is not the blocking layer here and disabling it would be an
// unrelated, unproven auth-surface change.
// v32 P0 FOLLOW-UP (2026-09-07): the "every branch does `return xxx(...)`"
// gap named above was never actually closed by v29 — v29 only stopped the
// resulting exception from crashing the whole request headerlessly; the
// exception itself still escaped advance()'s own try/catch (a `return
// somePromise` inside a try exits the try block immediately, so a LATER
// rejection of that promise is invisible to that try's own catch) and still
// reached the outermost `catch (e)` around line 3362 as a bare "Internal
// server error" 500 — which is exactly what a live customer saw while a
// job (533a8c19-f160-4f06-ab27-517c1f661b86) was still genuinely RUNNING at
// the DB level (a transient worker-side Playwright session error —
// "browserContext.newPage: Target page, context or browser has been
// closed" — one single poll's `pollBrowser()` throwing that as
// `w.status === 'FAILED'`). advance()'s own catch (below) already has the
// right retry-vs-fail classification logic; it just never got a chance to
// run for these calls. Fix: every `return xxx(...)` in advance()'s try
// block below is now `return await xxx(...)`, so a rejection is caught
// HERE, classified via the existing `retry` regex, and turned into a normal
// 200 status-poll response (status:'CREATED' to retry, or 'FAILED' with a
// real reason) instead of an opaque top-level 500. The `retry` regex was
// also extended to recognize this exact class of transient Playwright
// browser/context/page-closed error, bounded to a few attempts (see
// pollBrowser()'s own comment) so a job that is genuinely, permanently dead
// still surfaces as FAILED rather than polling forever.
const PROD_ORIGIN = 'https://www.homatch.live';
const ALLOWED_ORIGINS = new Set([PROD_ORIGIN, 'https://homatch.live']);
const DEV_ORIGIN_RE = /^https?:\/\/localhost(:\d+)?$/;
function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowOrigin = origin && (ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN_RE.test(origin)) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
// Module-level defaults kept only as an inert fallback shape (nothing below
// references these directly — every real call site inside Deno.serve uses
// the request-scoped CORS/json defined at the top of that handler).
const CORS = corsHeadersFor(null);
const json = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Mode = 'property' | 'cadastral';
// Stage (2026-09-06, "Fix Homatch Verify by implementing this exact
// pipeline in code" mandate): PUBLIC_RESEARCH is now a REAL stage, inserted
// between official-evidence collection and MARKET — never folded into
// MARKET's own prompt. 'OFFICIAL' renamed to 'OFFICIAL_COLLECTION' to match
// the mandate's own naming (job.stage labels like 'OFFICIAL_READY' /
// 'ENREG_CHECK_PENDING' are unchanged internal state-machine labels, not
// part of this type). IDENTITY is kept (not in the mandate's literal type
// block) because assetClass/project identity is a real upstream dependency
// PUBLIC_RESEARCH's own identifiers rely on — removing it would be exactly
// the kind of property-model redesign this mandate explicitly forbids.
type Stage = 'IDENTITY' | 'OFFICIAL_COLLECTION' | 'PUBLIC_RESEARCH' | 'MARKET' | 'SYNTHESIS';
// PUBLIC_RESEARCH_TARGETS — the mandate's own ~40-item research-target list,
// verbatim. One PUBLIC_RESEARCH prompt instructs the model to search every
// identifier (cadastral code, parent code, address, project name, company
// name/id, aliases) against every target below, in Georgian/English/Russian
// — matching how IDENTITY/OFFICIAL_COLLECTION/MARKET already work (one
// instructive prompt + web_search tool + a structured schema), not a new
// per-query orchestration primitive this codebase does not otherwise use.
const PUBLIC_RESEARCH_TARGETS = [
  'architect',
  'architecture studio',
  'founders owners participants',
  'directors representatives',
  'company history',
  'previous projects',
  'contractors',
  'construction companies',
  'engineers',
  'suppliers',
  'facade',
  'windows',
  'elevators',
  'structural system',
  'construction materials',
  'insulation',
  'MEP (mechanical/electrical/plumbing)',
  'energy efficiency',
  'seismic design',
  'amenities',
  'landscaping',
  'parking',
  'bank financing',
  'partners',
  'construction start',
  'construction chronology',
  'progress history',
  'current physical status',
  'quality',
  'developer reputation',
  'architect reputation',
  'complaints',
  'disputes',
  'court records',
  'media coverage',
  'Facebook',
  'Instagram',
  'LinkedIn',
  'YouTube',
  'TikTok',
  'Telegram',
  'forums',
  'reviews',
];
// publicResearchScope() (2026-09-07 "IMPORTANT GENERALIZATION RULE" mandate
// addendum): PUBLIC_RESEARCH_TARGETS/FIELDS above stay a fixed, verbatim
// schema (normalizePublicResearchStructured relies on every key always being
// present) — but WHICH of those targets are worth actively searching, and
// whether a missing developer/architect/contractor field is expected or a
// gap, genuinely differs by asset class. This reuses the assetClass value
// IDENTITY already classifies (v28's ADAPTIVE ASSET LOGIC) rather than
// introducing a second, competing classification — it only narrows the
// SEARCH SCOPE and adds an explicit "this is normal, do not force it"
// instruction; the Return{} schema and its field set are never changed by
// asset class. Purely generic: no project, developer, or fixture name
// appears here, only the property TYPE.
function publicResearchScope(assetClass: string | null | undefined): { targets: string[]; scopeNote: string } {
  const buildingTargets = ['facade', 'windows', 'elevators', 'structural system', 'construction materials', 'insulation', 'MEP (mechanical/electrical/plumbing)', 'energy efficiency', 'seismic design', 'amenities', 'landscaping', 'parking'];
  const developerTargets = ['founders owners participants', 'directors representatives', 'company history', 'previous projects', 'developer reputation', 'bank financing', 'partners'];
  const constructionTeamTargets = ['architect', 'architecture studio', 'architect reputation', 'contractors', 'construction companies', 'engineers', 'suppliers', 'construction start', 'construction chronology', 'progress history', 'current physical status', 'quality'];
  const reputationTargets = ['complaints', 'disputes', 'court records', 'media coverage', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'Telegram', 'forums', 'reviews'];
  switch (assetClass) {
    case 'PRIVATE_RESALE':
    case 'RENTAL':
      // A private individual's resale/rental unit has no developer/project
      // history to research by default — only worth pursuing if evidence
      // already on hand (Identity/Official) actually names one.
      return {
        targets: [...reputationTargets, 'quality'],
        scopeNote:
          'ASSET-CLASS SCOPE (private resale/rental — no forced developer research): this is a private individual\'s unit, not a marketed development project. Do NOT go looking for a developer, architect, contractor, or construction-company just to fill those fields — only research and populate them if the evidence already gathered (Identity/Official above) actually names one for this exact unit/building. It is entirely normal and CORRECT for developer/architect/contractor/companyHistory/previousProjects fields to stay null here; never invent a plausible-sounding value to avoid an empty field. Focus your search instead on: the property\'s own public reputation/reviews, its immediate micro-location, and any publicly reported quality signals or complaints about this exact address/unit.',
      };
    case 'PRIVATE_HOUSE':
      return {
        targets: ['quality', 'current physical status', ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (private house — no forced developer/project research): this is a standalone private house, not a unit in a marketed development. Only populate developer/architect/contractor/companyHistory/previousProjects if the evidence already gathered actually names one (e.g. a custom-build architect/builder is sometimes publicly documented) — otherwise leave them null; that is the expected, correct outcome, not a gap. Focus your search on the property\'s own public reputation and its immediate micro-location.',
      };
    case 'LAND':
      // A bare parcel has no building at all — every building-fabric target
      // (facade/windows/elevators/MEP/insulation/energy efficiency/seismic
      // design/amenities-as-building-feature) is inapplicable by definition.
      return {
        targets: ['previous projects', 'developer reputation', 'quality', 'current physical status', ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (land parcel — no building-fabric research applies): this is a bare land parcel, not a building or unit. Facade/windows/elevators/structural system/construction materials/insulation/MEP/energy efficiency/seismic design/amenities/landscaping-as-a-building-feature/parking simply do not apply — leave every one of those fields null rather than describing the parcel\'s physical state under them. If a developer or project already publicly plans to build on this exact parcel, that is worth reporting (developer/previousProjects/companyHistory) — but never invent one. Focus your search on how this parcel and its immediate area are publicly discussed (development plans, land use, reputation of any named developer).',
      };
    case 'COMMERCIAL':
      return {
        targets: [...constructionTeamTargets, ...buildingTargets, ...developerTargets, ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (commercial property): research the same construction/developer/reputation topics as a residential project, but frame amenities/landscaping/parking findings in commercial terms (tenant/business-facing features, accessibility, signage/visibility) rather than residential ones — only when the evidence actually supports it.',
      };
    case 'APARTMENT_IN_PROJECT':
    case 'UNDER_CONSTRUCTION':
    case 'COMPANY_OWNED':
    case 'MIXED_OR_UNKNOWN':
    default:
      // Safe default (also covers an unset/unrecognized value): research the
      // full breadth, exactly as before this mandate — never narrow scope
      // when the asset class is genuinely unclear.
      return { targets: PUBLIC_RESEARCH_TARGETS, scopeNote: '' };
  }
}
// PUBLIC_RESEARCH_FIELDS — the mandate's own ~35-field structured schema,
// verbatim (43 keys as literally listed). Used both to build the prompt's
// Return{...} schema string and to deterministically normalize the model's
// response (normalizePublicResearchStructured, below) so every key is
// always present as null or [] — "no evidence = null/[]", never omitted,
// never left as a stray/partial shape.
const PUBLIC_RESEARCH_ARRAY_FIELDS = [
  'foundersOwnersParticipants',
  'directorsRepresentatives',
  'previousProjects',
  'contractors',
  'constructionCompanies',
  'engineers',
  'suppliers',
  'amenities',
  'partners',
  'qualitySignals',
  'architectReputationSignals',
  'complaints',
  'disputes',
  'legalPublicFootprint',
  'mediaCoverage',
  'socialPublicFootprint',
  'awardsRecognition',
  'facts',
] as const;
const PUBLIC_RESEARCH_SCALAR_FIELDS = [
  'project',
  'developer',
  'legalCompany',
  'companyId',
  'companyHistory',
  'architect',
  'architectStudio',
  'architectReputation',
  'facade',
  'windows',
  'elevators',
  'structuralSystem',
  'constructionMaterials',
  'insulation',
  'MEP',
  'energyEfficiency',
  'seismicDesign',
  'landscaping',
  'parking',
  'financingBank',
  'constructionStart',
  'chronology',
  'progressHistory',
  'currentPhysicalStatus',
  'developerReputation',
] as const;
function normalizePublicResearchStructured(z: any): Record<string, any> {
  const src = z && typeof z === 'object' ? z : {};
  const out: Record<string, any> = {};
  for (const k of PUBLIC_RESEARCH_SCALAR_FIELDS) out[k] = typeof src[k] === 'string' && src[k].trim() ? src[k].trim() : null;
  for (const k of PUBLIC_RESEARCH_ARRAY_FIELDS) out[k] = Array.isArray(src[k]) ? src[k].filter((x: any) => typeof x === 'string' && x.trim()) : [];
  return out;
}

const CAD = /^\d{1,6}(\.\d{1,6}){3,11}$/;
const LANG: Record<string, string> = { ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew' };
// v31 (security hardening): WORKER/WT used to be hardcoded literals in
// this file — a real credential committed to source control. Both now
// come from this project's Edge Function secrets (WORKER_URL/WORKER_TOKEN,
// matching the Railway worker's own WORKER_TOKEN env var name) and the
// request-time guard below fails closed with the same customer-safe
// GENERIC_CONFIG_ERROR_I18N used for a missing OPENAI_API_KEY, rather
// than silently sending an empty Authorization header to the worker.
const WORKER = Deno.env.get('WORKER_URL') || '';
const WT = Deno.env.get('WORKER_TOKEN') || '';
const now = () => new Date().toISOString();
const CONFIRMED_STATUSES = new Set(['SEARCH_CONFIRMED', 'NO_RESULT_CONFIRMED']);
const MAX_AUTO_ENREG_ENTITIES_FROM_TEXT = 3; // mirrors the worker's own bound for its in-job entity queue

// customerSourceStatus() / officialSourceCoverage() (v26 — mandate's
// "MANDATORY OFFICIAL STATE MACHINE"): a confirmed production bug found by
// tracing why a report could list TAS/MSMAP/My.gov/ENREG links while
// dueDiligenceCoverage.officialSourcesChecked read 1 and documentsRead read
// 0 — officialVerificationSummary() already correctly bucketed every
// dispatched adapter's REAL terminal status (SEARCH_CONFIRMED,
// NO_RESULT_CONFIRMED, SKIPPED_HUMAN_VERIFICATION, or one of
// SUBMIT_FAILED/AUTH_REQUIRED/SEARCH_CONTROL_NOT_FOUND/BLOCKED/
// WRONG_SEARCH_CONTEXT/SUBMITTED_UNCONFIRMED/FAILED via
// officialSourcesNotVerified), but (a) dueDiligenceCoverage() never
// surfaced a count of ATTEMPTED sources or TECHNICAL FAILURES separately
// from "checked", so a job that dispatched 3 adapters and had 2 fail
// technically silently reported "1 checked" with no visibility into what
// happened to the other 2, and (b) sanitizeForCustomer() unconditionally
// deleted officialSourcesNotVerified — the ONE field that would have shown
// this — as "internal automation telemetry", which over-corrected: the
// COUNT and CATEGORY of a failed attempt is a legitimate customer fact
// ("this source could not be completed"), not an internal FSM/selector
// leak. This maps every real per-source status to ONE of the mandate's own
// six customer-safe categories — never a raw internal enum, never null due
// to blanket deletion — so the coverage numbers and a new truthful
// per-source status list can both be built from it deterministically.
function customerSourceStatus(rawStatus: string | null | undefined): 'SUCCESS' | 'NO_RESULT' | 'CAPTCHA_REQUIRED' | 'BLOCKED' | 'TECHNICAL_FAILED' | 'NOT_CONFIRMED' {
  switch (rawStatus) {
    case 'SEARCH_CONFIRMED':
      return 'SUCCESS';
    case 'NO_RESULT_CONFIRMED':
      return 'NO_RESULT';
    case 'SKIPPED_HUMAN_VERIFICATION':
    case 'WAITING_HUMAN':
      return 'CAPTCHA_REQUIRED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'SUBMIT_FAILED':
    case 'AUTH_REQUIRED':
    case 'SEARCH_CONTROL_NOT_FOUND':
    case 'WRONG_SEARCH_CONTEXT':
    case 'SUBMITTED_UNCONFIRMED':
    case 'FAILED':
    case 'TIMEOUT':
    case 'PARSE_FAILED':
      return 'TECHNICAL_FAILED';
    default:
      return 'NOT_CONFIRMED';
  }
}
// One row per adapter the worker actually executed (browserOfficial.results
// contains ONLY sources that were actually dispatched — a source never run
// simply never appears here, so results.length IS the true attempted
// count). Exposed directly on the customer-facing result as
// `officialSourceCoverage` — safe by construction (only the 6-value
// customerStatus enum and the source's own display name, never a raw FSM
// state or error string), so it needs no sanitizeForCustomer() stripping.
// SOURCE_NAME_I18N (v30, mandate item 5 — "never show raw source IDs like
// rstax to customers; use 'Revenue Service — გადასახადის გადამხდელთა
// რეესტრი' / 'MyGov — მოვალეთა რეესტრი'"). officialSourceCoverage() is the
// one field of this pipeline explicitly kept customer-safe (see its own
// comment at the call site), so its sourceName must be a real localized,
// human name — never the internal adapter key (r.source, e.g. "rstax",
// "debtor", "enreg", "tas", "TAS_MAP") — in whatever locale the request asked
// for. Keyed by the worker's own stable adapter id (lowercased — this
// lookup always lowercases r.source first), not by sourceName text, so this
// never depends on exactly how the worker phrased its English name.
// 'msmap' is retired (2026-09-06 "final alignment pass" mandate) — 'tas_map'
// is the one real source (the map popup opened FROM tas.ge), not a second
// entry kept alongside it.
const SOURCE_NAME_I18N: Record<string, Record<string, string>> = {
  tas: { ka: 'TAS — საჯარო რეესტრის საინფორმაციო სისტემა', en: 'TAS — Public Registry Information System', ru: 'TAS — информационная система публичного реестра', tr: 'TAS — Kamu Sicili Bilgi Sistemi', ar: 'TAS — نظام معلومات السجل العام', he: 'TAS — מערכת מידע של המרשם הציבורי' },
  tas_map: { ka: 'საჯარო რეესტრის საკადასტრო რუკა (TAS Map)', en: 'Public Registry Cadastral Map (TAS Map)', ru: 'Кадастровая карта публичного реестра (TAS Map)', tr: 'Kamu Sicili Kadastro Haritası (TAS Map)', ar: 'خريطة السجل العقاري العامة (TAS Map)', he: 'מפת הקדסטר של המרשם הציבורי (TAS Map)' },
  napr: { ka: 'საჯარო რეესტრი — უძრავი ქონების რეესტრი (NAPR)', en: 'Public Registry — Real Estate Registry (NAPR)', ru: 'Публичный реестр — реестр недвижимости (NAPR)', tr: 'Kamu Sicili — Taşınmaz Sicili (NAPR)', ar: 'السجل العام — سجل العقارات (NAPR)', he: 'המרשם הציבורי — מרשם המקרקעין (NAPR)' },
  enreg: { ka: 'მეწარმეთა და არასამეწარმეო (არაკომერციული) იურიდიული პირების რეესტრი', en: 'Entrepreneurial and Non-Entrepreneurial Legal Entities Registry', ru: 'Реестр предпринимательских и непредпринимательских юридических лиц', tr: 'Ticari ve Ticari Olmayan Tüzel Kişiler Sicili', ar: 'سجل الكيانات القانونية التجارية وغير التجارية', he: 'מרשם התאגידים העסקיים והלא-עסקיים' },
  rstax: { ka: 'შემოსავლების სამსახური — გადასახადის გადამხდელთა რეესტრი', en: 'Revenue Service — Taxpayers Registry', ru: 'Служба доходов — реестр налогоплательщиков', tr: 'Gelirler Servisi — Vergi Mükellefleri Sicili', ar: 'مصلحة الإيرادات — سجل دافعي الضرائب', he: 'רשות ההכנסות — מרשם משלמי המסים' },
  debtor: { ka: 'MyGov — მოვალეთა რეესტრი', en: 'MyGov — Debtor Registry', ru: 'MyGov — реестр должников', tr: 'MyGov — Borçlular Sicili', ar: 'MyGov — سجل المدينين', he: 'MyGov — מרשם החייבים' },
};
function localizedSourceName(sourceKey: string | undefined, fallbackName: string, locale: string): string {
  const entry = SOURCE_NAME_I18N[String(sourceKey || '').toLowerCase()];
  if (!entry) return fallbackName; // unrecognized adapter key: fall back to the worker's own human name, never the raw key itself (fallbackName is always r.sourceName || r.source, and r.source is only ever used here as a lookup key, not rendered)
  return entry[locale] || entry.en;
}
function officialSourceCoverage(browserOfficial: any, locale = 'en'): { source: string; sourceName: string; customerStatus: string }[] {
  const results = browserOfficial?.results || [];
  return results.map((r: any) => ({ source: r.source, sourceName: localizedSourceName(r.source, r.sourceName || r.source, locale), customerStatus: customerSourceStatus(r.status) }));
}

function safeUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null;
  } catch {
    return null;
  }
}
function official(u: string): boolean {
  try {
    return /(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge)$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
}
// isHomepageRoot() (v19, mandate item 12/13): "myhome.ge/, ss.ge/,
// facebook.com/ ... these are homepages ... we do not have the right to
// present it as if we opened a specific page." A URL with no path (or only
// "/"), no query, and no fragment cannot be a specific listing/post/article
// — it is, at best, evidence that a site exists, never evidence for a
// specific claim tied to it.
function isHomepageRoot(u: string | null | undefined): boolean {
  if (!u) return true;
  try {
    const x = new URL(u);
    return (x.pathname === '' || x.pathname === '/') && !x.search && !x.hash;
  } catch {
    return true;
  }
}
// isLoginPageUrl() (2026-09-06, "CUSTOMER-VALUE REPORT CLEANUP" mandate:
// "Never show login pages as customer evidence. A Facebook login URL is not
// a useful source... suppress generic claims without a concrete source.")
// Deterministic host+path pattern check — never a guess about content, just
// recognizing the small, stable set of login/auth entry-point URL shapes
// these evidence sources actually produce (a Facebook page Gemini cites
// sometimes resolves, via redirects, to facebook.com/login.php?next=... when
// the target requires auth to view). A page requiring login was never
// something Homatch actually read — it carries zero evidence value and is
// filtered out of the customer-facing sources list entirely in
// resolveSourceUrls(), not merely re-labeled like a homepage.
function isLoginPageUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./i, '');
    const path = x.pathname.toLowerCase();
    if (/^(facebook\.com|fb\.com|m\.facebook\.com)$/i.test(host) && /login/i.test(path)) return true;
    if (/^accounts\.google\.com$/i.test(host)) return true;
    if (/^(instagram\.com)$/i.test(host) && /^\/accounts\/login/i.test(path)) return true;
    if (/^(twitter\.com|x\.com)$/i.test(host) && /^\/(i\/flow\/login|login)/i.test(path)) return true;
    if (/^linkedin\.com$/i.test(host) && /^\/(login|checkpoint)/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}
function normalizeLoose(s: string | null | undefined): string {
  return String(s || '').toLowerCase().replace(/["'«»„"]/g, '').replace(/\s+/g, ' ').trim();
}

// sourceCategory() (v25, mandate section 11 — "the current socialSources
// bug: MyHome, SS.ge, Korter and similar portals are NOT social sources").
// A real, host-based categorization used everywhere an evidence item needs
// to be counted or labeled, replacing the old binary
// OFFICIAL-vs-not-OFFICIAL split that silently lumped every property
// portal, developer site, bank page, and forum together as "social".
// Deliberately conservative: an unrecognized host is OTHER_PUBLIC, never
// guessed into SOCIAL just because it isn't a known portal.
// v28: rs.ge (RS Taxpayers Registry — Georgia's Revenue Service) added — a
// distinct domain from gov.ge, previously uncategorized (would have fallen
// through to OTHER_PUBLIC despite being a real official government source).
const OFFICIAL_HOST_RE = /(?:^|\.)(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge|my\.gov\.ge|enreg\.reestri\.gov\.ge|rs\.ge)$/i;
const PROPERTY_PORTAL_HOST_RE = /(?:^|\.)(myhome\.ge|ss\.ge|home\.ss\.ge|korter\.ge|mymarket\.ge|adjaranet\.com|livo\.ge|place\.ge)$/i;
const SOCIAL_HOST_RE = /(?:^|\.)(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|t\.me|telegram\.me|twitter\.com|x\.com|linkedin\.com)$/i;
const MEDIA_HOST_RE = /(?:^|\.)(civil\.ge|netgazeti\.ge|publika\.ge|1tv\.ge|imedinews\.ge|interpressnews\.ge|rustavi2\.ge|bpn\.ge|forbes\.ge|business-media\.ge)$/i;
const FORUM_HOST_RE = /(?:^|\.)(reddit\.com|forum\.ge|forums\.ge)$/i;
// v30 addition (mandate item 4 — "public search as a legitimate but
// distinct source class"): a search-engine RESULTS page is never a
// document/registry/listing/article in itself — it is, at best, evidence
// that a general web search corroborated something, with no single
// citable deep source behind it. Kept strictly separate from OTHER_PUBLIC
// (an unrecognized-but-real page) so the customer-facing label can say
// "საჯარო ძიება" (Public Search) instead of implying a real page was read.
const SEARCH_ENGINE_HOST_RE = /(?:^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z.]+)$/i;
function isSearchResultsUrl(url: string, host: string): boolean {
  if (!SEARCH_ENGINE_HOST_RE.test(host)) return false;
  try {
    return /\/search\b/i.test(new URL(url).pathname) || /(?:^|[?&])q=/i.test(new URL(url).search);
  } catch {
    return true;
  }
}
type SourceCategory =
  | 'OFFICIAL_REGISTRY'
  | 'OFFICIAL_DOCUMENT'
  | 'OFFICIAL_MAP'
  | 'DEVELOPER_PRIMARY'
  | 'PROPERTY_PORTAL'
  | 'MARKET_LISTING'
  | 'MEDIA'
  | 'SOCIAL'
  | 'PUBLIC_GROUP'
  | 'PUBLIC_FORUM'
  | 'PUBLIC_SEARCH'
  | 'OTHER_PUBLIC';
function sourceCategory(url: string | null | undefined, hint?: { isDocument?: boolean; isMap?: boolean; isDeveloperPrimary?: boolean }): SourceCategory {
  if (!url) return 'OTHER_PUBLIC';
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'OTHER_PUBLIC';
  }
  if (OFFICIAL_HOST_RE.test(host)) {
    if (hint?.isMap || /ms\.gov\.ge$/i.test(host)) return 'OFFICIAL_MAP';
    if (hint?.isDocument) return 'OFFICIAL_DOCUMENT';
    return 'OFFICIAL_REGISTRY';
  }
  if (hint?.isDeveloperPrimary) return 'DEVELOPER_PRIMARY';
  if (isSearchResultsUrl(url, host)) return 'PUBLIC_SEARCH';
  if (PROPERTY_PORTAL_HOST_RE.test(host)) return 'MARKET_LISTING';
  if (SOCIAL_HOST_RE.test(host)) return /facebook\.com\/groups|t\.me\/joinchat|t\.me\/\+/i.test(url) ? 'PUBLIC_GROUP' : 'SOCIAL';
  if (MEDIA_HOST_RE.test(host)) return 'MEDIA';
  if (FORUM_HOST_RE.test(host)) return 'PUBLIC_FORUM';
  return 'OTHER_PUBLIC';
}

// semanticDedupe() (v25, mandate section 20 — "the same issue must not
// appear repeatedly merely because wording differs"). Groups items by a
// normalized keyword-overlap key rather than exact string equality: strips
// punctuation, lowercases, drops short stopwords, sorts the remaining
// tokens, and keeps only the significant ones (length > 3) as the grouping
// key. Two sentences sharing enough of their meaningful vocabulary collapse
// to one entry (the first/longest kept, since a fuller sentence is usually
// the more informative phrasing). Deliberately simple (no embeddings/LLM
// call available deterministically here) — good enough to catch the
// mandate's own worked example ("official commissioning not confirmed"
// worded three different ways) without over-merging unrelated findings.
const STOPWORDS = new Set(['this','that','with','from','have','been','were','into','than','their','there','which','about','could','would','should','the','and','for','not','was','are','its']);
function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeLoose(s)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3 && !STOPWORDS.has(t))
  );
}
// overlapCoefficient (not Jaccard): intersection / min(|A|,|B|), which is
// what actually catches a short paraphrase fully contained in a longer,
// more detailed one ("commissioning not confirmed" vs "the official
// commissioning status was not confirmed by any authoritative source") —
// plain Jaccard under-scores that pair because the union is dominated by
// the longer sentence's extra vocabulary.
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}
const SEMANTIC_DEDUPE_THRESHOLD = 0.6;
function semanticDedupe<T>(items: T[], textOf: (x: T) => string): T[] {
  const kept: { tokens: Set<string>; text: string; item: T }[] = [];
  for (const item of items) {
    const text = textOf(item);
    const tokens = tokenSet(text);
    if (!tokens.size) {
      // Nothing meaningful to group by (very short/empty string) — fall
      // back to exact text so two unrelated near-empty entries never merge
      // under an empty token set.
      if (!kept.some((k) => k.tokens.size === 0 && normalizeLoose(k.text) === normalizeLoose(text))) kept.push({ tokens, text, item });
      continue;
    }
    const matchIdx = kept.findIndex((k) => k.tokens.size > 0 && overlapCoefficient(tokens, k.tokens) >= SEMANTIC_DEDUPE_THRESHOLD);
    if (matchIdx === -1) kept.push({ tokens, text, item });
    else if (text.length > kept[matchIdx].text.length) kept[matchIdx] = { tokens, text, item };
  }
  return kept.map((k) => k.item);
}
function dedupe<T>(a: T[], k: (x: T) => string): T[] {
  return [...new Map(a.map((x) => [k(x), x])).values()];
}
function parse(t: string): any {
  const f = t.match(/```json\s*([\s\S]*?)```/i);
  const r = (f?.[1] || t).trim();
  try {
    return JSON.parse(r);
  } catch {
    const a = r.indexOf('{');
    const b = r.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(r.slice(a, b + 1));
      } catch {
        /* fall through to empty object below */
      }
    }
    return {};
  }
}
// extractOpenAIText()/extractOpenAISources() (v30, "REMOVE GEMINI COMPLETELY
// AND MIGRATE RESEARCH AI TO OPENAI" mandate). OpenAI's Responses API shapes
// a completed response as `output: [...]`, where a message item has
// `type: 'message'` and `content: [{type:'output_text', text, annotations}]`
// — replacing the old Gemini "interactions" shape (`steps[].type ===
// 'model_output'` / `content[].type === 'text'`). Web-search citations are
// `content[].annotations[].type === 'url_citation'` with `url`/`title`
// fields — the SAME shape this file's citation handling already used, so
// resolveSourceUrls()/isLoginPageUrl()/sourceCategory() below needed no
// changes at all.
function extractOpenAIText(p: any): string {
  let t = '';
  for (const o of p?.output || []) if (o?.type === 'message') for (const c of o?.content || []) if (c?.type === 'output_text') t += c.text || '';
  return t;
}
function extractOpenAISources(p: any): any[] {
  const o: any[] = [];
  for (const item of p?.output || [])
    if (item?.type === 'message')
      for (const c of item?.content || [])
        for (const a of c?.annotations || [])
          if (a?.type === 'url_citation' && a?.url) {
            const u = safeUrl(a.url);
            if (u) o.push({ label: a.title || u, url: u, evidenceLevel: official(u) ? 'OFFICIAL' : 'WEB_RETRIEVED', retrievalMethod: 'OPENAI_WEB_SEARCH' });
          }
  return dedupe(o, (x) => x.url);
}

// resolveCanonicalUrl()/resolveSourceUrls() (kept from v18, unchanged): every
// vertexaisearch.cloud.google.com/grounding-api-redirect/... URL is followed
// server-side and replaced with wherever it actually resolves. v19 adds a
// `genericHomepage` flag to every resolved source so the frontend can visibly
// distinguish "we opened this exact page" from "this is just a site's front
// door" — mandate item 12/13.
const GROUNDING_REDIRECT_HOST = /vertexaisearch\.cloud\.google\.com/i;
async function resolveCanonicalUrl(u: string): Promise<string> {
  if (!GROUNDING_REDIRECT_HOST.test(u)) return u;
  try {
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(6000) });
    if (!r.url || r.url === u || GROUNDING_REDIRECT_HOST.test(r.url)) {
      const r2 = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000) });
      try {
        await r2.body?.cancel();
      } catch {
        /* best-effort cancel */
      }
      if (r2.url) r = r2;
    }
    const resolved = safeUrl(r.url);
    return resolved && !GROUNDING_REDIRECT_HOST.test(resolved) ? resolved : u;
  } catch {
    return u;
  }
}
async function resolveSourceUrls(list: any[]): Promise<any[]> {
  const resolved = await Promise.all(
    list.map(async (s: any) => {
      if (!s?.url) return s;
      let url = s.url;
      let label = s.label;
      let originalGroundingUrl: string | undefined;
      if (GROUNDING_REDIRECT_HOST.test(url)) {
        const canon = await resolveCanonicalUrl(url);
        if (canon !== url) {
          const genericLabel = !label || /^untitled$/i.test(String(label).trim()) || label === url;
          if (genericLabel) {
            try {
              label = new URL(canon).hostname.replace(/^www\./, '');
            } catch {
              /* keep original label */
            }
          }
          originalGroundingUrl = url;
          url = canon;
        }
      }
      const generic = isHomepageRoot(url);
      const linkLabel = generic ? null : official(url) ? 'View official source' : 'View source';
      const category = sourceCategory(url, { isDocument: s.evidenceLevel === 'OFFICIAL' && /document|pdf/i.test(String(s.documentType || s.label || '')) });
      return { ...s, url, label, ...(originalGroundingUrl ? { originalGroundingUrl } : {}), genericHomepage: generic, linkLabel, sourceCategory: category };
    })
  );
  // A login-page URL was never something Homatch actually read — drop it
  // entirely rather than showing it with any badge/label (see
  // isLoginPageUrl()'s own comment).
  return dedupe(resolved.filter((s: any) => !isLoginPageUrl(s?.url)), (x) => x.url);
}

const VALID_COMPARABLE_TIERS = new Set(['SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT']);
// normalizeComparableTier() (2026-09-07 market-comparable model, Verify
// mandate item 7): the MARKET prompt asks the model for a mandatory
// three-tier "comparableType" per comparable (see prompt() 'MARKET') —
// SAME_PROJECT / MICRO_LOCATION / PEER_PROJECT, replacing the old
// undifferentiated boolean "sameProject" that nothing downstream ever
// actually consumed. This is the deterministic safety net for two cases
// the model output can't be blindly trusted for: (1) the model omits the
// field or returns something outside the three valid values — falls back
// to PEER_PROJECT, the same conservative default the prompt itself asks
// the model to use when genuinely uncertain; (2) a report generated before
// this field existed only carries the old boolean `sameProject`.
// Reopening that report (mandate item 5: "old reports open with ZERO
// rerun cost") must still show a sensible tier rather than silently
// defaulting every historical comparable to PEER_PROJECT, so
// sameProject === true maps to SAME_PROJECT for those legacy records.
function normalizeComparableTier(c: any): 'SAME_PROJECT' | 'MICRO_LOCATION' | 'PEER_PROJECT' {
  if (VALID_COMPARABLE_TIERS.has(c?.comparableType)) return c.comparableType;
  if (c?.sameProject === true) return 'SAME_PROJECT';
  return 'PEER_PROJECT';
}
// sanitizeComparables() (v19, mandate item 12+14): a structured comparable
// whose only URL is a bare homepage root can never carry a specific
// listingId/price/pricePerSqm — those fields are stripped (not the whole
// comparable; it can still usefully say "similar listings appear on
// myhome.ge" without a fabricated specific number attached to it).
function sanitizeComparables(list: any[]): any[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((c: any) => {
      if (!c || typeof c !== 'object') return null;
      const url = typeof c.url === 'string' ? safeUrl(c.url) : null;
      const generic = isHomepageRoot(url);
      const comparableType = normalizeComparableTier(c);
      if (!generic) return { ...c, url, comparableType, genericSource: false, linkLabel: 'View listing' };
      const { listingId, price, pricePerSqm, ...rest } = c;
      return { ...rest, url, comparableType, genericSource: true, linkLabel: null };
    })
    .filter(Boolean);
}

// median()/calculateMarketPosition() (2026-09-06 "final alignment pass"
// mandate): MARKET's price positioning used to be entirely LLM-estimated
// ("estimate a market median price-per-sqm and classify... relative to
// that median") — no deterministic arithmetic existed anywhere in this
// codebase. These two pure functions are that deterministic step: the LLM
// (see the MARKET prompt above) now only GATHERS numeric evidence
// (comparables[].pricePerSqm, subject.pricePerSqm) and qualitative
// priceDriverEvidence; the median/percentage/classification themselves are
// always computed here, in code, from real numbers — never asked of or
// trusted from the model.
function parseNumericPricePerSqm(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function median(values: number[]): number | null {
  const nums = values.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

interface MarketPositionResult {
  marketMedianPricePerSqm: number | null;
  premiumPct: number | null;
  position: 'PREMIUM' | 'DISCOUNT' | 'MARKET_RANGE' | 'UNKNOWN';
  comparablesUsed: number;
}

/** Deterministic classification: PREMIUM when the subject's own evidenced
 * price-per-sqm is more than 7% above the comparables' median, DISCOUNT
 * when more than 7% below, MARKET_RANGE otherwise. UNKNOWN (never a
 * guessed classification) whenever either the subject's own price or a
 * usable comparables median is missing — the exact "UNKNOWN when no
 * subject price is evidenced" rule the old prompt asked the LLM to honor
 * itself, now enforced in code regardless of what the LLM returns. */
function calculateMarketPosition({ targetPricePerSqm, comparables }: { targetPricePerSqm: number | null; comparables: Array<{ pricePerSqm?: unknown }> }): MarketPositionResult {
  const values = (comparables || []).map((c) => parseNumericPricePerSqm(c?.pricePerSqm)).filter((n): n is number => n != null);
  const marketMedianPricePerSqm = median(values);
  if (targetPricePerSqm == null || marketMedianPricePerSqm == null || marketMedianPricePerSqm === 0) {
    return { marketMedianPricePerSqm, premiumPct: null, position: 'UNKNOWN', comparablesUsed: values.length };
  }
  const premiumPct = ((targetPricePerSqm - marketMedianPricePerSqm) / marketMedianPricePerSqm) * 100;
  const position: MarketPositionResult['position'] = premiumPct > 7 ? 'PREMIUM' : premiumPct < -7 ? 'DISCOUNT' : 'MARKET_RANGE';
  return { marketMedianPricePerSqm, premiumPct, position, comparablesUsed: values.length };
}

interface MarketRangeResult {
  activeMinPricePerSqm: number | null;
  activeMedianPricePerSqm: number | null;
  activeMaxPricePerSqm: number | null;
  activeComparablesUsed: number;
  historicalMedianPricePerSqm: number | null;
  historicalComparablesUsed: number;
}

// computeMarketRanges() (2026-09 "report intelligence v2" mandate item 10 /
// addendum Section 8): a market price MUST be a range, never one stale
// fixed number, and an EXPIRED/REMOVED/SOLD listing must never dominate a
// CURRENT price figure. Comparables are split by the LISTING STATUS the
// MARKET-stage model evidenced per comparable (see prompt() 'MARKET'):
// only ACTIVE + RESIDENTIAL comparables ever drive the "what's on the
// market right now" min/median/max; EXPIRED/REMOVED/SOLD comparables are
// kept ONLY as a separately labeled historical reference, never blended
// into the active range. UNKNOWN status is excluded from both buckets
// (conservative by design — an unconfirmed listing can never silently
// inflate either figure).
function computeMarketRanges(comparables: any[]): MarketRangeResult {
  const list = Array.isArray(comparables) ? comparables : [];
  const isResidential = (c: any) => !c?.propertyType || c.propertyType === 'RESIDENTIAL';
  const active = list.filter((c) => c?.listingStatus === 'ACTIVE' && isResidential(c));
  const historical = list.filter((c) => ['EXPIRED', 'REMOVED', 'SOLD'].includes(c?.listingStatus) && isResidential(c));
  const activeValues = active.map((c) => parseNumericPricePerSqm(c?.pricePerSqm)).filter((n): n is number => n != null);
  const historicalValues = historical.map((c) => parseNumericPricePerSqm(c?.pricePerSqm)).filter((n): n is number => n != null);
  return {
    activeMinPricePerSqm: activeValues.length ? Math.min(...activeValues) : null,
    activeMedianPricePerSqm: median(activeValues),
    activeMaxPricePerSqm: activeValues.length ? Math.max(...activeValues) : null,
    activeComparablesUsed: activeValues.length,
    historicalMedianPricePerSqm: median(historicalValues),
    historicalComparablesUsed: historicalValues.length,
  };
}

// UNVERIFIED_FALLBACK_I18N (v21, master due-diligence mandate): the exact
// required sentence for any high-impact fact (ownership, restrictions,
// commissioning, seller authority, etc.) that fails the STRICT FACT GATE.
// A shorter accurate report beats a longer guessed one — this phrase (never
// a guessed date/status) is what fills that gap.
const UNVERIFIED_FALLBACK_I18N: Record<string, string> = {
  ka: 'ზუსტი მიმდინარე სტატუსი საჯარო მტკიცებულებით ვერ დადასტურდა.',
  en: 'The exact current status could not be confirmed by public evidence.',
  ru: 'Точный текущий статус не удалось подтвердить публичными данными.',
  tr: 'Kesin güncel durum kamuya açık kanıtlarla doğrulanamadı.',
  ar: 'تعذر تأكيد الحالة الحالية الدقيقة بأدلة عامة.',
  he: 'לא ניתן היה לאשר את הסטטוס הנוכחי המדויק באמצעות ראיות ציבוריות.',
};
// GENERIC_CONFIG_ERROR_I18N (v30): shown to the customer ONLY when a
// required server-side secret (currently OPENAI_API_KEY) is missing — a
// deliberately generic, localized "temporary issue" message. The real
// reason is logged server-side (console.error) for admin diagnostics only;
// it must never appear in the customer-facing response body.
const GENERIC_CONFIG_ERROR_I18N: Record<string, string> = {
  ka: 'ამჟამად დროებითი ტექნიკური შეფერხებაა. გთხოვთ სცადოთ ცოტა ხანში.',
  en: 'A temporary technical issue occurred. Please try again shortly.',
  ru: 'Произошла временная техническая неполадка. Пожалуйста, попробуйте снова через некоторое время.',
  tr: 'Geçici bir teknik sorun oluştu. Lütfen kısa süre sonra tekrar deneyin.',
  ar: 'حدثت مشكلة فنية مؤقتة. يرجى المحاولة مرة أخرى بعد قليل.',
  he: 'אירעה תקלה טכנית זמנית. אנא נסו שוב בקרוב.',
};
// UNRESOLVED_RIGHTS_GAP_I18N (v30): the guaranteed fallback line inserted
// into itemsToVerify when rightsAndRestrictions.status is still
// NOT_CONFIRMED and the model's own itemsToVerify list did not already
// name that gap — see the overallAssessment wiring in finish(). Kept
// neutral (not "no restriction found", not "safe") per the same rule as
// rightsAndRestrictions.statement itself.
const UNRESOLVED_RIGHTS_GAP_I18N: Record<string, string> = {
  ka: 'უძრავი ქონების უახლესი რეესტრის ამონაწერი (საკუთრება, შეზღუდვები, დატვირთვები) ჯერ არ არის ცალსახად დადასტურებული — გირჩევთ გადაამოწმოთ გარიგებამდე.',
  en: 'A current registry extract confirming exact ownership and any restrictions/encumbrances has not yet been independently confirmed — verify this before the transaction.',
  ru: 'Актуальная выписка из реестра, подтверждающая точное право собственности и наличие ограничений/обременений, пока не подтверждена независимо — проверьте это до сделки.',
  tr: 'Tam mülkiyeti ve olası kısıtlama/yükümlülükleri doğrulayan güncel bir sicil kaydı henüz bağımsız olarak teyit edilmedi — işlemden önce bunu doğrulayın.',
  ar: 'لم يتم بعد التأكد بشكل مستقل من مستخرج السجل الحالي الذي يثبت الملكية الدقيقة وأي قيود/التزامات — يرجى التحقق من ذلك قبل إتمام الصفقة.',
  he: 'תמצית מרשם עדכנית המאשרת בעלות מדויקת והגבלות/שעבודים אפשריים עדיין לא אומתה באופן עצמאי — יש לוודא זאת לפני העסקה.',
};
// RR_NOT_CONFIRMED_I18N / RR_NONE_FOUND_I18N (v30 fix — mandate item 5:
// "Never show English fallback text ... inside a Georgian report"). These
// two sentences used to be hardcoded English regardless of the request's
// own locale `l` — a genuine, exactly-named bug in the mandate's own worked
// example ("Current official confirmation is still required."). Now
// localized the same way every other customer-facing fixed sentence in
// this file already is (see GENERIC_CONFIG_ERROR_I18N / MATERIAL_RISK_
// NONE_I18N above).
const RR_NOT_CONFIRMED_I18N: Record<string, string> = {
  ka: 'ამჟამად საჭიროა ოფიციალური დადასტურება.',
  en: 'Current official confirmation is still required.',
  ru: 'В настоящее время требуется официальное подтверждение.',
  tr: 'Şu anda resmi teyit hâlâ gereklidir.',
  ar: 'لا يزال التأكيد الرسمي مطلوبًا حاليًا.',
  he: 'עדיין נדרש אישור רשמי נוכחי.',
};
const RR_NONE_FOUND_I18N: Record<string, (ts: string) => string> = {
  ka: (ts) => `მოძიებულ მიმდინარე მტკიცებულებაში (${ts}) არსებითი რეგისტრირებული შეზღუდვა არ გამოვლენილა.`,
  en: (ts) => `No material registered restriction was identified in the current evidence retrieved at ${ts}.`,
  ru: (ts) => `В текущих полученных на ${ts} доказательствах существенных зарегистрированных ограничений не выявлено.`,
  tr: (ts) => `${ts} tarihinde alınan güncel kanıtlarda önemli bir kayıtlı kısıtlama tespit edilmedi.`,
  ar: (ts) => `لم يتم تحديد أي قيد مسجل جوهري في الأدلة الحالية التي تم الحصول عليها في ${ts}.`,
  he: (ts) => `לא זוהתה הגבלה רשומה מהותית בראיות הנוכחיות שהתקבלו בתאריך ${ts}.`,
};
const BASE =
  'You are Homatch Property Intelligence, an automated real-estate due-diligence engine. NO EVIDENCE = NO FACT. UNKNOWN ≠ NO. TECHNICAL FAILURE ≠ PROPERTY RISK. MARKETING CLAIM ≠ VERIFIED FACT. SEARCH RESULT ≠ DOCUMENT READ. OLD INFORMATION ≠ CURRENT INFORMATION. Missing public evidence is neutral, not a risk. Search snippets are leads, not facts. Never invent ownership, cadastral facts, permits, prices, company relationships, reviews or legal status. Similar names do not prove identity. Prefer primary records, exact deep URLs and dates. ' +
  'STRICT FACT GATE — apply this to every ownership, seller-authority, co-ownership, mortgage, seizure/attachment, public-law restriction, tax lien, registered obligation, company status, director/representative, construction-completion, commissioning/exploitation, utility-subscription, developer-financing, or bank-relationship claim before writing it as fact: (1) is there an authoritative or sufficiently reliable source; (2) was the relevant evidence actually retrieved/read (not just found in a search result); (3) is it specific to this exact property/person/company/project; (4) is it current enough for the claim; (5) does the source actually state it, not merely imply it. If ANY answer is no, do not present it as fact — write it as unverified and use this EXACT sentence for the gap (never a guessed date or status): "' +
  UNVERIFIED_FALLBACK_I18N.en +
  '" (translate this exact meaning into the requested answer language). Never fill a high-impact gap with an estimated date or status merely to make the report look complete — a shorter accurate report is better than a longer uncertain one. ' +
  'COMMISSIONING/EXPLOITATION RULE: never infer that a building is officially commissioned/put into exploitation merely because construction looks complete, units are sold, renovation has started, utilities exist, or people live there, or because a portal says "delivered". That requires direct authoritative evidence naming the commissioning/exploitation act; otherwise say it is not independently verified. Keep a declared marketing completion TARGET separate from an OBSERVED/CURRENT physical status and separate from an OFFICIAL commissioning date — never present one as the other. ' +
  'UTILITY TARIFF/BILLING RULE (v26): never state or imply a specific utility billing/tariff consequence (e.g. that electricity, water, or gas "may be charged at a non-residential/commercial rate" before official commissioning, or any other rate/classification claim) unless a specific source is cited that directly states that rule for this exact project/provider. An unverified commissioning status is NOT itself evidence of any particular tariff outcome — never chain one unverified fact into a new invented one. If no source directly supports a tariff/billing claim, omit it entirely rather than hedging it. ' +
  'DECISION LANGUAGE RULE: never write or imply "safe to buy", "clean property", "100% clean", "guaranteed safe", a numeric safety probability, or any purchase recommendation. This system measures research completeness, not transaction safety. Prefer: "No material registered restriction was identified in the current evidence retrieved at [timestamp]" or "Current official confirmation is still required." ' +
  'ABSOLUTE RULE — NEVER, under any circumstances, in ANY string you return (executiveSummary, facts, officialEvidence, publicEvidence, unverified, riskFlags[].description, or any other field): mention a search field, form, selector, browser, automation attempt, retry, verification attempt, CAPTCHA mechanics, or any internal system/engineering process. Our own inability to complete a technical step is NEVER a fact about the property, the company, or the market — it must simply be omitted, never explained, apologized for, or turned into a hedge like "could not be confirmed due to X" or "was not directly read". Either state a confirmed fact, or say nothing about that angle at all. ' +
  'ABSOLUTE RULE — a bare homepage URL (e.g. https://myhome.ge/, https://ss.ge/, https://facebook.com/somepage with no further path) is NEVER a specific citation. You may say general listings/pages appear to exist on such a site, but you must NEVER attach a specific listing ID, exact price, or specific unit detail to a homepage URL — only to a real deep link you actually retrieved. ' +
  'COMPANY-PROFILE PROVENANCE RULE: company details (directors, registration date, status, historical ownership changes) gathered only from general web research — not from a registry document you actually read — must never be phrased as if independently confirmed by the Entrepreneur Registry. Say they are publicly reported, not registry-verified, unless the specific evidence came from a registry document. ' +
  'FINANCIAL/DEBT REGISTRY RULE (v30): RS Taxpayers Registry, the MyGov Debtor Registry, and the Property Registry/NAPR are THREE SEPARATE SCOPES — never mix their conclusions. RS is taxpayer/tax-status information only. The MyGov Debtor Registry is a debtor-record check for the specific person/company only. Ownership, mortgage, seizure, and other registered-restriction findings belong ONLY to the Property Registry/NAPR evidence elsewhere in this report — never attach ownership/mortgage/cadastral/commissioning caution to a debtor-registry or tax-registry finding. For RS Taxpayers Registry: a NO_RESULT_CONFIRMED result proves ONLY that this one exact verified search returned no matching record — phrase it neutrally as "no matching record was found in this specific registry search for this identifier," never as "no tax debt" or "clean." For the MyGov Debtor Registry specifically: an exact-identifier NO_RESULT_CONFIRMED IS a genuinely positive result, but ONLY within that registry\'s own narrow scope — state plainly that no debtor-registry record was found for this exact identifier and that this is a positive indicator within the scope of checking this specific registry; never extend that positive framing into any claim about property ownership, cadastral rights, mortgages, official commissioning, or the person/company\'s overall financial standing. If the MyGov Debtor Registry instead returns a confirmed matching record, do not phrase it neutrally — flag it for the customer\'s ATTENTION and state plainly that the record/details require review before assessing any transaction impact. ' +
  'ASSET-CLASS SCOPE RULE (v28): do not force developer/company research onto a property whose evidence indicates a private individual resale, a private house, or a rental with no developer/company actually involved — only populate companyProfile when a real company/developer is evidenced for THIS property; a bare absence of company involvement is not itself a fact worth stating. ' +
  'CONFLICT SEVERITY RULE (v36): every entry in `conflicts` must be classified "MATERIAL" or "MINOR" — never left ambiguous. "MATERIAL" means two credible sources (especially official/registry ones) directly contradict each other on entity identity, legal/registration status, ownership, a registered restriction, or another fact that would change a buyer\'s decision. "MINOR" means an ordinary discrepancy between marketing/listing sources (a different unit count, a slightly different completion date, a different floor count between two portals) that does not bear on legality or identity. Default to "MINOR" whenever genuinely unsure — never inflate an everyday marketing discrepancy into "MATERIAL" merely because it is a discrepancy. Most reports should have zero MATERIAL conflicts. ' +
  'REPORT TONE RULE (v36): write as a professional property-intelligence analyst speaking to a buyer/investor, in natural, confident prose — never as an audit log. Do not mention workers, sources by internal name, search coverage, technical failures, automation, or research mechanics anywhere in any string. Do not mention or imply a URL, link, or citation inside prose text — evidence links are handled separately by the product, never inside your sentences. Missing or not-yet-retrieved evidence is never phrased as suspicious or adverse — state it once, plainly and neutrally, as something that can still be confirmed, and do not repeat the same gap in more than one place in your output. Positive evidence should read as positive, not hedged into sounding uncertain. Reserve cautionary language strictly for an actual adverse finding (a registered restriction, a debtor record, a company in liquidation, a genuinely material conflict, or comparable direct evidence of a problem) — never for an absent document. ' +
  'SOURCE-ANONYMITY RULE (2026-09-06 pipeline mandate): never name a specific website/platform/portal by brand (e.g. MyHome, SS.ge, Korter, Facebook, Instagram, or any other named site) in any prose string you return — a specific brand name belongs only in the structured evidence/sources data the product manages separately, never inside officialEvidence/publicEvidence/facts/executiveSummary/riskFlags text. Refer to such findings only generically, e.g. "based on publicly available information" (translate this exact meaning into the requested answer language). ' +
  'Return JSON only.';

function officialStatusLine(browserOfficial: any): string {
  const results = browserOfficial?.results || [];
  if (!results.length) return 'No direct official-browser session ran for this job — every government/registry source below is NOT_SEARCHED.';
  return results
    .map((r: any) => {
      const st = r.status || (r.resultValidated ? 'SEARCH_CONFIRMED' : 'NOT_SEARCHED');
      const forEntity = r.forEntity ? ` (entity lookup: ${r.forEntity.name}${r.forEntity.idCode ? ' / ' + r.forEntity.idCode : ''})` : '';
      return `${r.sourceName || r.source}${forEntity}=${st}`;
    })
    .join('; ');
}

// traversalNote() (v19): this is now PURELY internal reasoning guidance —
// it tells Gemini which sources are not yet exhaustively explored so it
// does not silently OVERCLAIM completeness in officialEvidence/facts, but
// it explicitly forbids narrating that fact to the customer at all (per the
// new BASE rule above). No "say plainly that additional records may exist"
// instruction survives from v18 — that sentence itself was one of the
// confirmed leaks.
function traversalNote(browserOfficial: any): string {
  const results = browserOfficial?.results || [];
  const incomplete = results.filter((r: any) => r.traversal?.status && !['SOURCE_EXHAUSTED', 'NOT_STARTED'].includes(r.traversal.status));
  if (!incomplete.length) return '';
  const names = incomplete.map((r: any) => r.sourceName || r.source).join(', ');
  return ` INTERNAL NOTE (do not surface this note or its wording to the customer in any form): the following sources are not yet exhaustively traversed — ${names}. Simply do not assert facts about them beyond what the evidence above actually shows; do not mention, hedge about, or apologize for their traversal state anywhere in your output.`;
}

// aggregateTasTechnicalFacts() / formatTasTechnicalFactsForPrompt() (2026-09-
// 07 TAS DOCUMENT INTELLIGENCE mandate — "TAS official documents are the
// PRIMARY source for technical/project intelligence whenever those documents
// exist"): official-worker's own generic, non-project-specific label/value
// extractor (documents/TasTechnicalFacts.ts) already attaches a
// `technicalFacts[]` array to EVERY document via toLegacyDocument() —
// ResearchOrchestrator.legacyDocuments() applies it uniformly to every
// document any official source (TAS, ENREG, MyGov, ...) actually reads, so
// this never assumes the source is specifically named "TAS". This function
// walks every one of those facts across the whole browserOfficial payload
// and reduces it to one deterministic, deduped, provenance-tagged summary —
// computed in CODE, never left to the model's own reading of `b` below,
// specifically because `b` is truncated to 24000 characters and a real
// technical fact buried in a later document must never be silently lost to
// that slice. Purely additive/generic: it only reflects whatever facts the
// extractor actually found in THIS job's own evidence — nothing here is
// tied to any specific project, developer, or asset type.
interface AggregatedTasFact {
  category: string;
  key: string;
  value: string;
  confidence: 'HIGH' | 'MEDIUM';
  documentUrl: string | null;
  documentTitle: string | null;
  documentDate: string | null;
  // block (2026-09-07 "ProjectRevision/block-structure" mandate item):
  // which named building/block/corpus within a multi-building complex this
  // fact belongs to, when — and only when — the SAME document this fact was
  // read from also states a block/corpus/liter identifier somewhere in its
  // own text (see TasTechnicalFacts.ts's 'buildingBlock'/'buildingLiter'
  // rules). A document that never names a block leaves this null on every
  // one of its facts — never inferred or guessed across documents, and
  // never invented when the project is genuinely a single building.
  block: string | null;
}
function aggregateTasTechnicalFacts(browserOfficial: any): AggregatedTasFact[] {
  const out: AggregatedTasFact[] = [];
  for (const r of browserOfficial?.results || []) {
    for (const d of r.documents || []) {
      const facts = Array.isArray(d.technicalFacts) ? d.technicalFacts : [];
      // block attribution: if THIS document's own text names a block/corpus/
      // liter anywhere, every fact this document contributed is understood
      // to be about that same block — one TAS technical/permit document
      // describes one building. Never carried over from a DIFFERENT
      // document's block label.
      const blockFact = facts.find((f: any) => f?.key === 'buildingBlock' || f?.key === 'buildingLiter');
      const block = blockFact?.value ? String(blockFact.value).trim() || null : null;
      for (const f of facts) {
        if (!f || !f.category || !f.key || !f.value) continue;
        out.push({
          category: String(f.category),
          key: String(f.key),
          value: String(f.value),
          confidence: f.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
          documentUrl: d.url || null,
          documentTitle: d.title || d.label || null,
          documentDate: d.date || d.documentDate || null,
          block,
        });
      }
    }
  }
  // Dedupe by category+key+value+block — the same (category,key,value) triple
  // read off two different documents is one fact, not two; keep whichever
  // occurrence is HIGH-confidence, and prefer the one with a known document
  // date as provenance when confidence is tied. Genuinely DIFFERENT values
  // for the same category+key (e.g. a revised floor count between an old and
  // a new permit, OR the same field reported for two different named
  // blocks) are intentionally kept as separate entries — this function
  // never picks a single "winner" value for a key, only dedupes exact
  // repeats. Picking the latest/approved revision is buildRevisionTimeline()'s
  // job, below, not this function's.
  const byId = new Map<string, AggregatedTasFact>();
  for (const f of out) {
    const id = `${f.category}::${f.key}::${f.value}::${f.block || ''}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, f);
      continue;
    }
    const upgrade = (existing.confidence === 'MEDIUM' && f.confidence === 'HIGH') || (existing.confidence === f.confidence && !existing.documentDate && !!f.documentDate);
    if (upgrade) byId.set(id, f);
  }
  return Array.from(byId.values());
}
// buildRevisionTimeline() (2026-09-07 "ProjectRevision/block-structure"
// mandate item, generic interpretation — "track multiple official TAS/
// project revisions over time... timeline should show revision/amendment
// chronology"): groups the SAME aggregated facts above by the document they
// came from (documentTitle+documentDate identifies one document/revision
// event) and orders those groups chronologically. This is purely a
// different VIEW of facts already extracted — no new evidence, nothing
// invented. Deliberately returns null (never a fabricated single-entry
// "timeline") unless at least two groups carry two DIFFERENT known dates —
// a job with only one official document, or several documents that never
// stated a date, has no genuine "over time" chronology to show.
interface RevisionTimelineEntry {
  documentTitle: string | null;
  documentDate: string | null;
  block: string | null;
  facts: { category: string; key: string; value: string }[];
}
function buildRevisionTimeline(facts: AggregatedTasFact[]): RevisionTimelineEntry[] | null {
  const byDoc = new Map<string, RevisionTimelineEntry>();
  for (const f of facts) {
    const id = `${f.documentTitle || ''}::${f.documentDate || ''}`;
    if (!byDoc.has(id)) byDoc.set(id, { documentTitle: f.documentTitle, documentDate: f.documentDate, block: f.block, facts: [] });
    byDoc.get(id)!.facts.push({ category: f.category, key: f.key, value: f.value });
  }
  const groups = Array.from(byDoc.values());
  const distinctKnownDates = new Set(groups.map((g) => g.documentDate).filter(Boolean));
  if (distinctKnownDates.size < 2) return null;
  // Stable chronological order: dated groups first (ascending), undated
  // groups kept at the end in their original encounter order rather than
  // sorted arbitrarily.
  const dated = groups.filter((g) => g.documentDate).sort((a, b) => String(a.documentDate).localeCompare(String(b.documentDate)));
  const undated = groups.filter((g) => !g.documentDate);
  return [...dated, ...undated];
}
// Compact, prompt-ready rendering — grouped by category so the model can
// scan it as PRIMARY, already-confirmed ground truth rather than having to
// parse it back out of the raw browser evidence payload itself.
function formatTasTechnicalFactsForPrompt(facts: AggregatedTasFact[]): string {
  if (!facts.length) return '';
  const byCategory = new Map<string, AggregatedTasFact[]>();
  for (const f of facts) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }
  const lines: string[] = [];
  for (const [cat, items] of byCategory) {
    lines.push(`${cat}: ` + items.map((f) => `${f.key}=${f.value}${f.documentDate ? ` (doc dated ${f.documentDate})` : ''}`).join('; '));
  }
  return lines.join('\n');
}

function prompt(s: Stage, j: any, p: any, l: string): string {
  const L = LANG[l] || 'English';
  const q = j.query;
  const b = JSON.stringify(p.browserOfficial || {}).slice(0, 24000);

  if (s === 'IDENTITY') {
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}, mode=${j.mode}. Identify the exact entity and evidence-backed expansion terms. ` +
      `ASSET CLASS (v28): from the actual evidence gathered, classify this property's assetClass as one of APARTMENT_IN_PROJECT / PRIVATE_RESALE / PRIVATE_HOUSE / LAND / COMMERCIAL / RENTAL / UNDER_CONSTRUCTION / COMPANY_OWNED / MIXED_OR_UNKNOWN — never assume every property has the same evidence shape (a private resale apartment has no developer/company research to do; a land parcel has no utilities/commissioning; a company-owned unit may). Use MIXED_OR_UNKNOWN rather than guessing when the evidence does not clearly indicate one category. This classification only shapes how deep/which categories of research make sense — it never itself becomes a customer-facing risk statement. ` +
      `Also research the marketed PROJECT/DEVELOPMENT this property likely belongs to (its public name, developer, physical building/complex) as thoroughly as public web evidence allows — this is a separate concept from the bare cadastral/unit identity. ` +
      `For construction/completion, keep THREE separate concepts and never merge them: declaredCompletionTarget (a developer/marketing target date, labeled as declared, never as actual), observedConstructionStatus (what current public evidence — photos, posts, listings — shows about physical progress right now), and commissioningStatus (ONLY "OFFICIALLY_CONFIRMED" with an evidenceUrl when a specific authoritative document/act says the building was put into exploitation — otherwise always "NOT_INDEPENDENTLY_VERIFIED", regardless of how complete the building looks). ` +
      `If you find publicly evidenced information that a specific bank offers mortgage/financing for this exact project or developer (e.g. a bank's own published partner-project list, a developer page naming a partner bank), add it to project.facts as an ordinary evidenced fact (bank name + program if known) — never invent or assume standard bank financing exists just because a project is common practice; omit it entirely if unevidenced. ` +
      `UTILITIES MATRIX: from the listing text, project page, or any document you actually read, report whether electricity/water/gas/sewage/internet connections are explicitly mentioned for this exact unit/property. Each utility's status may be "CONFIRMED_CONNECTED" or "CONFIRMED_NOT_CONNECTED" ONLY when the source explicitly states that; otherwise it MUST be "NOT_MENTIONED" — never infer a utility is connected merely because the building looks complete or other units mention it. If nothing at all discusses utilities, return utilitiesMatrix as null rather than five NOT_MENTIONED entries. ` +
      `Return {"entity":{"name":string,"type":string,"confidence":"HIGH"|"MEDIUM"|"LOW"},"assetClass":"APARTMENT_IN_PROJECT"|"PRIVATE_RESALE"|"PRIVATE_HOUSE"|"LAND"|"COMMERCIAL"|"RENTAL"|"UNDER_CONSTRUCTION"|"COMPANY_OWNED"|"MIXED_OR_UNKNOWN","identifiedParent":object|null,"exactUnit":{"code":string|null,"verified":boolean,"note":string}|null,"building":object|null,` +
      `"project":{"name":string|null,"aliases":string[],"address":string|null,"developer":string|null,"developerCompany":string|null,"website":string|null,"buildings":string|null,"floors":string|null,"unitCounts":string|null,"declaredCompletionTarget":string|null,"observedConstructionStatus":string|null,"commissioningStatus":{"status":"OFFICIALLY_CONFIRMED"|"NOT_INDEPENDENTLY_VERIFIED","evidenceUrl":string|null},"architect":string|null,"contractors":string[],"amenities":string[],"facts":string[]}|null,` +
      `"utilitiesMatrix":{"electricity":{"status":"CONFIRMED_CONNECTED"|"CONFIRMED_NOT_CONNECTED"|"NOT_MENTIONED","note":string|null},"water":{"status":"CONFIRMED_CONNECTED"|"CONFIRMED_NOT_CONNECTED"|"NOT_MENTIONED","note":string|null},"gas":{"status":"CONFIRMED_CONNECTED"|"CONFIRMED_NOT_CONNECTED"|"NOT_MENTIONED","note":string|null},"sewage":{"status":"CONFIRMED_CONNECTED"|"CONFIRMED_NOT_CONNECTED"|"NOT_MENTIONED","note":string|null},"internet":{"status":"CONFIRMED_CONNECTED"|"CONFIRMED_NOT_CONNECTED"|"NOT_MENTIONED","note":string|null}}|null,` +
      `"facts":string[],"expansionTerms":string[],"unverified":string[]}.`
    );
  }

  if (s === 'OFFICIAL_COLLECTION') {
    const statusLine = officialStatusLine(p.browserOfficial);
    const trav = traversalNote(p.browserOfficial);
    const hist = p.browserOfficial?.historicalComparison;
    const histNote = hist?.available
      ? ` A structured, evidence-based historical document comparison is also available (${hist.documentsConsidered} dated documents compared). If you reference any historical change, state ONLY what its comparisons[].addedInNewer/removedFromOlder arrays literally show, citing the olderDocument/newerDocument URLs — never add or infer a change beyond that structured diff.`
      : '';
    const tasFacts = aggregateTasTechnicalFacts(p.browserOfficial);
    const tasFactsBlock = tasFacts.length
      ? `TAS/OFFICIAL DOCUMENT TECHNICAL FACTS — PRIMARY SOURCE (mandatory priority rule): the following values were extracted deterministically, in code, directly from the official documents' own text this run. Treat every one of these as ALREADY CONFIRMED — they take priority over anything else you find or infer for the same field, including your own general knowledge or any public-web lead. Weave the relevant ones into officialEvidence/documents[].facts in natural prose (never dump the raw "key=value" form verbatim into your output), and never contradict or "correct" one of these values.\n${formatTasTechnicalFactsForPrompt(tasFacts)}\n`
      : '';
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}.\n` +
      `INTERNAL GROUND TRUTH (for your reasoning only — never mention this line, its states, or its existence to the customer in any form): ${statusLine}.\n` +
      `A source counts as directly, officially checked ONLY when its state above is SEARCH_CONFIRMED or NO_RESULT_CONFIRMED. NO_RESULT_CONFIRMED is evidence ONLY that this one exact verified search returned no matching record on that specific source — NEVER evidence that the underlying property/record/company does not exist at all. Every other state means that source was NOT verified this run — for such a source you must simply not state a finding from it (positive or negative); do not explain why, do not name the state, do not describe any attempt.${trav}\n` +
      `Note on sources: MY.GOV.GE service 176 (naprweb.reestri.gov.ge) and NAPR are the SAME registry — never present them as two independent sources.${histNote}\n` +
      tasFactsBlock +
      `Direct browser evidence payload=${b}. Identity=${JSON.stringify(p.identity || {}).slice(0, 12000)}.\n` +
      `You may use Google Search / URL Context to research TAS, the MS cadastral map, MY.GOV.GE/NAPR, the Entrepreneur Registry and other municipal/government records as PUBLIC WEB leads — but any such finding is public-web information, not a direct registry verification, and must go in facts/unverified rather than officialEvidence unless it is itself a primary document you can cite with an exact URL.\n` +
      `If you identify a legal entity (developer/owner company) — from the browser evidence above, from a cited document, or from your own web research — populate companyProfile with everything evidence-backed you can find: legal name, identification code (idCode), legal form, registration date, status (active/liquidated/etc.), directors, representatives, historical changes, related projects. A discovered company with a name or an identification code MUST be reported in companyProfile even if your evidence about it is otherwise thin — leave individual fields null rather than omitting the whole object. For relatedProjects specifically, when your evidence supports it, write each entry with real detail rather than a bare name — e.g. "<project name> — <status/completion evidenced>, per <url>" — but never pad a bare name with an invented status just to look complete; a bare name is correct when that is all the evidence supports.\n` +
      `ADAPTIVE SCOPE (v28): Identity.assetClass=${JSON.stringify(p.identity?.assetClass || 'MIXED_OR_UNKNOWN')}. When it indicates a private individual resale, private house, or rental and nothing in the evidence above actually names a developer/managing company for this exact unit, do not go looking for one just to fill the field — companyProfile stays null in that case. When it indicates an apartment-in-project, under-construction, or company-owned unit, a developer/owner company is usually genuinely relevant and should be researched as normal.\n` +
      `HARD RULE: populate companyProfile/documents[].facts ONLY with values directly traceable to a cited document or the direct browser evidence payload above — never state a specific code, project name, address, or developer/company name as if confirmed unless it appears verbatim in that evidence. If you cannot confirm a value, leave it null/omit it rather than guessing. Never cite a bare homepage root URL (no path beyond "/") as if it were a specific document — only a real deep link.\n` +
      `RIGHTS/RESTRICTIONS: only from directly cited registry evidence above, list any registered ownership share, mortgage, registered obligation, servitude/easement, usufruct, superficies, registered lease, public-law restriction, seizure/attachment, or tax lien actually stated for this exact property. If nothing was directly confirmed either way, status must be "NOT_CONFIRMED" (never invent "none exist" and never claim it is guaranteed free of restrictions) — only use "NONE_FOUND_IN_CHECKED_SOURCE" when a confirmed direct search on an authoritative source returned no restriction for this exact record.\n` +
      `LAND PROFILE (only when the subject is a land parcel, not a building unit): from a cadastral/registry document you actually read this run (TAS/NAPR/MSMAP — the browser evidence payload above, never a general web page), report landCategory (the registered land-use/zoning category exactly as stated, e.g. agricultural/residential/commercial/industrial), permittedUse (any registered buildability or use restriction stated), and buildabilityNote (any registered building-density/coefficient limit stated), each with the source document's URL. Return landProfile as null — not a guess, not an object of nulls — whenever the subject is not land, or no cadastral document was actually read this run.\n` +
      `Return {"officialEvidence":string[],"companyProfile":{"name":string|null,"idCode":string|null,"legalForm":string|null,"registrationDate":string|null,"status":string|null,"directors":string[],"representatives":string[],"historicalChanges":string[],"relatedProjects":string[],"summary":string|null}|null,"landProfile":{"landCategory":string|null,"permittedUse":string|null,"buildabilityNote":string|null,"source":string|null}|null,"rightsAndRestrictions":{"status":"NOT_CONFIRMED"|"NONE_FOUND_IN_CHECKED_SOURCE"|"RESTRICTION_IDENTIFIED","items":string[]}|null,"documents":[{"title":string,"url":string,"date":string|null,"facts":string[]}],"facts":string[],"unverified":string[],"conflicts":[{"description":string,"severity":"MATERIAL"|"MINOR"}]}.`
    );
  }

  // PUBLIC_RESEARCH (2026-09-06 pipeline mandate) — a REAL stage, not folded
  // into MARKET's prompt. Runs AFTER official evidence collection (browser
  // workers + the enreg/rstax/debtor closed-loop chain) has finished — see
  // advance()'s ENREG_CHECK_PENDING -> ... -> PUBLIC_RESEARCH_READY routing.
  if (s === 'PUBLIC_RESEARCH') {
    const i = p.identity || {};
    const o = p.official || {};
    const ri = p.reconciledIdentity || {};
    const identifiers = Array.from(
      new Set(
        [
          j.mode === 'cadastral' ? j.query : null,
          i.identifiedParent?.code || null,
          i.project?.address || i.identifiedParent?.address || ri.address || null,
          i.project?.name || ri.project || null,
          o.companyProfile?.name || i.project?.developer || ri.developer || null,
          o.companyProfile?.idCode || null,
          ...(Array.isArray(i.project?.aliases) ? i.project.aliases : []),
          // discoveredEntities (mandate item 4): companies/persons
          // official-worker's own EntityQueue found across ALL documents
          // this job read — a genuine identifier lead PUBLIC_RESEARCH would
          // otherwise never see (IDENTITY/OFFICIAL_COLLECTION only ever
          // reasoned about the ONE company officialCollection itself named).
          ...(Array.isArray(p.browserOfficial?.discoveredEntities) ? p.browserOfficial.discoveredEntities.map((e: any) => e?.name).filter(Boolean) : []),
        ].filter((x) => typeof x === 'string' && x.trim())
      )
    );
    const tasFacts = Array.isArray(o.tasTechnicalFacts) ? o.tasTechnicalFacts : [];
    const tasFactsNote = tasFacts.length
      ? `TAS/OFFICIAL DOCUMENT TECHNICAL FACTS ALREADY CONFIRMED (PRIMARY — see Official.tasTechnicalFacts above; do not re-research or contradict these, e.g. architect/structural/foundation/area/floor values already established there):\n${formatTasTechnicalFactsForPrompt(tasFacts)}\nFor any of these categories, your job here is reputation/context/qualitative enrichment ONLY (e.g. the architect's track record, the contractor's other projects) — never propose a different name/value for a field already confirmed above.\n`
      : '';
    const scope = publicResearchScope(i.assetClass);
    const scopeNoteLine = scope.scopeNote ? `${scope.scopeNote}\n` : '';
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}. Known identifiers for this exact property/project/company so far=${JSON.stringify(identifiers)}. Identity=${JSON.stringify(i).slice(0, 9000)}. Official=${JSON.stringify(o).slice(0, 12000)}.\n` +
      tasFactsNote +
      scopeNoteLine +
      `PUBLIC RESEARCH STAGE — this is a real, mandatory research stage, not optional enrichment. Do not stop after basic project/address/listing discovery. Using every identifier above, search in Georgian, English AND Russian for each of the following topics as they relate to this exact project/property/company: ${scope.targets.join(', ')}.\n` +
      `For every field below, populate it ONLY when your search actually surfaced supporting evidence for THIS exact project/company/property — never guess, never fill a field with a generic industry statement, never invent a name. No evidence for a field = null (or [] for list fields) — never omit the key and never pad with a placeholder string. Prefer specific names/dates/facts over vague description. Each list field should contain short, concrete, evidence-backed entries (e.g. a real person/company name with their role, not a generic sentence).\n` +
      `If you discover a legal company (developer/owner) — by exact name or identification code — that was not already present in Official.companyProfile above, populate companyId/legalCompany with it as precisely as the evidence supports; a downstream deterministic step (not you) decides whether this triggers any further registry lookup.\n` +
      `Return {"project":string|null,"developer":string|null,"legalCompany":string|null,"companyId":string|null,"foundersOwnersParticipants":string[],"directorsRepresentatives":string[],"companyHistory":string|null,"previousProjects":string[],"architect":string|null,"architectStudio":string|null,"architectReputation":string|null,"contractors":string[],"constructionCompanies":string[],"engineers":string[],"suppliers":string[],"facade":string|null,"windows":string|null,"elevators":string|null,"structuralSystem":string|null,"constructionMaterials":string|null,"insulation":string|null,"MEP":string|null,"energyEfficiency":string|null,"seismicDesign":string|null,"amenities":string[],"landscaping":string|null,"parking":string|null,"financingBank":string|null,"partners":string[],"constructionStart":string|null,"chronology":string|null,"progressHistory":string|null,"currentPhysicalStatus":string|null,"qualitySignals":string[],"developerReputation":string|null,"architectReputationSignals":string[],"complaints":string[],"disputes":string[],"legalPublicFootprint":string[],"mediaCoverage":string[],"socialPublicFootprint":string[],"awardsRecognition":string[],"facts":string[],"unverified":string[]}.`
    );
  }

  if (s === 'MARKET') {
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}. Identity=${JSON.stringify(p.identity || {}).slice(0, 9000)}. Official=${JSON.stringify(p.official || {}).slice(0, 16000)}. PublicResearch=${JSON.stringify(p.publicResearch || {}).slice(0, 9000)}. ` +
      // SEARCH THE WHOLE HIERARCHY, NOT JUST THE BUILDING.
      // A live report compared five units in one project to each other and
      // stopped. That answers "what do flats in this building cost", not
      // "is this property well positioned in its real local market" — and the
      // second question is the one a buyer is actually asking. Each band is
      // requested explicitly, because an unasked-for band is one the model
      // reliably skips once it has found enough same-project listings.
      `Research actual public listing/post URLs and comparables. Work OUTWARD through the hierarchy and gather from EACH band you can, rather than stopping once one band has enough: (1) the same building/project; (2) the same street and immediately adjacent streets; (3) the same micro-district; (4) the wider district; (5) comparable developments of a similar class elsewhere in the city — a boutique/low-density project must be compared against other boutique/low-density projects, never against arbitrary cheap city stock merely because both are apartments. Prefer listings similar in area, rooms, condition, floor and construction stage. Include MyHome, SS, Korter, developer/project/agency sites, public social pages/posts, news, reviews/forums where accessible. ` +
      `RELEVANCE, NOT VOLUME: a handful of genuinely comparable listings from several bands is worth far more than twenty from one. If a band genuinely has nothing findable, return nothing for it — never pad it with listings that are not actually comparable, and never describe a band you did not search. ` +
      `For every comparable you can support with a specific deep URL (an actual listing/post, never a bare homepage), return a structured record with as many of these fields as the evidence supports: source, url (the exact deep link, required), listingId, project, address, area, rooms, floor, condition, price, currency, pricePerSqm, listingDate, similarity (a short phrase on how comparable it is to the subject property), retrievedAt. If you only have a homepage-level lead (you believe a site has relevant listings but could not retrieve a specific one), do not fabricate a listingId or price for it — omit that comparable or describe it only in priceEvidence as a general, non-specific lead. pricePerSqm (both here and in "subject" below) MUST be a plain numeric string in the SAME currency unit per square meter (no thousands separators, currency symbols or ranges) whenever you have a specific number — a deterministic step downstream computes the median/premium from these numbers directly, so a non-numeric or approximate value here simply will not be counted rather than being parsed loosely. ` +
      `COMPARABLE TIER (mandatory per comparable, 2026-09-07 market-comparable model): classify "comparableType" as exactly one of "SAME_PROJECT" (literally the same building/project/complex as the subject — if the project has named blocks/phases/buildings and you can tell the comparable is a DIFFERENT block/phase than the subject's own, prefer "MICRO_LOCATION" instead, since a different block of the same complex is not the same physical structure), "MICRO_LOCATION" (a different project but the same street/immediate neighborhood/walking-distance area), or "PEER_PROJECT" (a comparable development elsewhere in the city included only for broader market context). This is a REQUIRED classification, never omitted or left to infer downstream — when genuinely uncertain between MICRO_LOCATION and PEER_PROJECT, use PEER_PROJECT (the more conservative, less specific claim). ` +
      `LISTING STATUS (mandatory per comparable — market price MUST reflect what is on the market NOW, never a stale figure): set "listingStatus" from what the page/evidence actually shows — "ACTIVE" only when the listing itself currently reads as available/on the market (no "sold"/"removed"/"no longer available"/"archived" marker, and not a stale page you cannot confirm is still live), "EXPIRED" or "REMOVED" or "SOLD" when the evidence itself says so, otherwise "UNKNOWN" (the safe default when you genuinely cannot tell — never guess ACTIVE just because a page loaded). Also set "propertyType" ("RESIDENTIAL","COMMERCIAL","LAND","OTHER") whenever the evidence supports it. Only ACTIVE + RESIDENTIAL comparables may ever be used for a *current* price range — everything else exists only for historical/contextual reference, so do not skip this field to save effort. ` +
      `SUBJECT PROPERTY'S OWN PRICE (separate from comparables): if — and only if — you find the subject property's own price/price-per-sqm specifically evidenced (its own listing, an official document, or public reporting), return it in "subject" below with the exact evidence URL, AND classify it with "priceType": "STARTING" when this is a developer's marketing "starting from" / "from" price for the project (never a specific unit's actual price), "CURRENT_LISTING" when it is a specific unit's own live asking price, "SOLD" when evidence shows it already sold at this price, or "OFFICIAL_DOCUMENT" when it comes from a registry/permit/contract document rather than a marketplace listing. A "STARTING" price must never be presented or treated as the property's current median/typical price — keep it a distinct, separately labeled figure. Never estimate or infer any of this from comparables; leave every field null when no such evidence exists for THIS specific property. ` +
      `PRICE-DRIVER EVIDENCE (mandatory, qualitative only — you do NOT compute a median, a percentage, or a CHEAPER/NORMAL/PREMIUM classification; a deterministic step downstream does that arithmetic from the numeric comparables/subject fields above): list the concrete, evidence-backed factors relevant to how this property's price compares to its market, grounded only in evidence already gathered this run (Identity/Official/PublicResearch above, or your own comparables): construction completion stage, remaining inventory/scarcity, availability of internal/developer installment financing, construction materials and structural system, architecture/design and architect reputation, developer reputation, parking availability, floor/view/layout, amenities, location/micro-location, bank financing availability, and current supply of comparable listings. Never state a price driver you cannot support with evidence gathered this run — omit it instead. ` +
      `Return {"market":{"priceEvidence":string[],"comparables":[{"source":string,"url":string,"listingId":string|null,"project":string|null,"address":string|null,"area":string|null,"rooms":string|null,"floor":string|null,"condition":string|null,"price":string|null,"currency":string|null,"pricePerSqm":string|null,"listingDate":string|null,"similarity":string|null,"retrievedAt":string|null,"comparableType":"SAME_PROJECT"|"MICRO_LOCATION"|"PEER_PROJECT","listingStatus":"ACTIVE"|"EXPIRED"|"REMOVED"|"SOLD"|"UNKNOWN","propertyType":"RESIDENTIAL"|"COMMERCIAL"|"LAND"|"OTHER"|null}],"subject":{"pricePerSqm":string|null,"price":string|null,"currency":string|null,"evidenceUrl":string|null,"priceType":"STARTING"|"CURRENT_LISTING"|"SOLD"|"OFFICIAL_DOCUMENT"|null},"priceDriverEvidence":string[]},"reviews":{"positive":string[],"negative":string[],"neutral":string[]},"publicEvidence":string[],"facts":string[],"riskFlags":[{"severity":"LOW"|"MEDIUM"|"HIGH","description":string}],"unverified":string[]}.`
    );
  }

  // SYNTHESIS — never performs its own web_search (see launch()'s
  // `s !== 'SYNTHESIS'` tools gate): it synthesizes only what
  // IDENTITY/OFFICIAL_COLLECTION/PUBLIC_RESEARCH/MARKET already gathered.
  const trav = traversalNote(p.browserOfficial);
  return (
    `${BASE}\nAnswer strings in ${L}. Query=${q}. Synthesize ONLY this collected evidence=${JSON.stringify(p).slice(0, 52000)}. Introduce no new facts. This includes publicResearch above (developer/company background, architect, contractors, construction quality/materials, chronology/current status, reputation, amenities) — weave genuinely evidenced items from it into officialEvidence/publicEvidence/facts/keyStrengths as appropriate; a field left null/[] there means no evidence exists and must not be mentioned at all.\n` +
    `TAS/OFFICIAL DOCUMENT PRIORITY RULE (mandatory): when official.tasTechnicalFacts is present, those values were extracted deterministically from the official documents' own text and are the PRIMARY source for technical/project facts (architect, structural/geotechnical/foundation specialists, areas, floors, height, building function, revisions, applicant, parcel owner, and similar). Whenever official.tasTechnicalFacts and publicResearch disagree on the same fact, official.tasTechnicalFacts wins — state the confirmed value and simply do not mention the conflicting public-web claim at all (this is not a "conflict" worth listing in conflicts[] unless it is a MATERIAL identity/legal discrepancy per the CONFLICT SEVERITY RULE). Never omit a genuinely present official.tasTechnicalFacts value merely because publicResearch did not also confirm it.\n` +
    `CUSTOMER-FACING SOURCE WORDING (mandatory, applies to every string field you return): never name a specific website/platform/portal by brand (e.g. MyHome, SS.ge, Korter, Facebook, Instagram, or any other named site) anywhere in prose — refer to public-web findings only generically, e.g. "based on publicly available information" (translate this exact meaning into the requested answer language; the Georgian equivalent is "საჯაროდ არსებული ინფორმაციის საფუძველზე"). Never reference a worker/adapter name, a technical/coverage state, or a citation/link inside prose — those are handled entirely outside your output.\n` +
    `When describing official/registry results, distinguish (1) a confirmed positive match, (2) a source whose exact verified search returned no matching record — phrase this as "no matching record was found for this search", NEVER as "the property/record does not exist" — from (3) a source that was skipped because the user chose not to complete a human-verification step, phrased plainly as "<sourceName> — verification incomplete. Human verification was required and this source was skipped. The report below is based on the other successfully researched sources." Any other source state (blocked, technical failure, wrong search context, etc.) must simply be left out of officialEvidence/facts entirely — never explained, never named, never hedged about.${trav}\n` +
    `If browserOfficial.results contains an Entrepreneur Registry (enreg) entry — including one tagged with a forEntity (a company looked up specifically because it was discovered elsewhere in this research) — read its documents' extracted text/facts directly and use it to build or improve companyProfile (legal form, registration date, status, directors, representatives, historical changes) with the same schema OFFICIAL used. If it materially improves on the evidence-bundle's existing companyProfile, return your own improved companyProfile; otherwise omit the field and the existing one is kept.\n` +
    `If no risk worth flagging is evidenced, riskFlags may be empty — in that case you do not need to write anything about it; a fixed neutral sentence is added automatically. Never fill riskFlags with our own inability to verify a source.\n` +
    `For rights/restrictions/seizure specifically, distinguish clearly: "No material registered restriction was identified in the current evidence retrieved at [timestamp]" (evidence checked, nothing found) is NOT the same as "Current official confirmation is still required" (nothing was actually checked) — never write or imply "guaranteed free of restrictions" or "clean property" in either case.\n` +
    `HARD RULE (STRUCTURED EVIDENCE IS AUTHORITATIVE): executiveSummary may state a specific cadastral code, company/entity name, developer, or project name ONLY when that exact value already appears in identity.identifiedParent, identity.project, official.companyProfile, or a cited document/officialEvidence entry in the evidence above. If none of those carry a specific code/project/address/developer, describe the property only by what the evidence actually supports rather than inventing or inferring one from context — this is enforced separately by a deterministic code-level check after this response. executiveSummary is the report's opening narrative (see EXECUTIVE SUMMARY instruction below for length/tone) — do NOT restate specific unresolved items in it; those belong ONLY in itemsToVerify below, stated once.\n` +
    `KEY STRENGTHS (v30): separately from officialEvidence/publicEvidence, list 3-5 short, concrete, evidence-backed positive/useful facts a customer would actually care about — e.g. identity/project corroboration, an official source returning a clean or confirmed result, a bank or developer relationship with public evidence, current market comparables, a registry search returning no matching adverse record. Each entry must already be traceable to a fact/officialEvidence/publicEvidence item above — never invent a new one here. Order strongest/most official first. Return [] if genuinely nothing rises to this level (rare) — never pad it.\n` +
    `ITEMS TO VERIFY (v30): separately, list AT MOST 4 short items describing what remains genuinely unresolved and is material to a transaction decision (e.g. official commissioning not independently confirmed, latest NAPR ownership/restriction extract still needed, a source skipped because human verification was not completed). State each ONCE, plainly, with no repeated hedging language — this is the single place the report names unresolved items, so do not also re-explain them at length elsewhere in this response, and never mention the same gap (e.g. commissioning) anywhere else in executiveSummary, facts, or riskFlags. Never include here anything already resolved as a genuine positive (a debtor-registry no-result belongs in keyStrengths or officialEvidence, not here) and never phrase a missing document as if it were a suspicious finding — a calm, neutral "can still be confirmed with an updated extract" framing, stated once, is enough. Return [] only if there is truly nothing left to verify.\n` +
    `EXECUTIVE SUMMARY (v36): write 4-8 sentences of natural, professional Georgian-analyst-style prose (translated into the requested language) that reads as one flowing narrative, not a bullet dump — identity and project context, the overall shape of the evidence gathered, one sentence on the registry/financial checks performed and their outcome (framed positively when they came back clean), and a closing sentence on market position when evidence supports it. Do not front-load a single unresolved item as if it were the headline; let the proportion of positive-vs-outstanding evidence set the tone. Never write "safe to buy" or a percentage.\n` +
    `Return {"executiveSummary":string,"entity":{"name":string,"type":string,"confidence":"HIGH"|"MEDIUM"|"LOW"},"keyStrengths":string[],"itemsToVerify":string[],"officialEvidence":string[],"publicEvidence":string[],"conflicts":[{"description":string,"severity":"MATERIAL"|"MINOR"}],"riskFlags":[{"severity":"LOW"|"MEDIUM"|"HIGH","description":string}],"unverified":string[],"companyProfile":{"name":string|null,"idCode":string|null,"legalForm":string|null,"registrationDate":string|null,"status":string|null,"directors":string[],"representatives":string[],"historicalChanges":string[],"relatedProjects":string[],"summary":string|null}|null}.`
  );
}

// v30: OpenAI Responses API only — Gemini is no longer called anywhere in
// this file. `openaiFetch` is the same retry-with-backoff wrapper the old
// `gf` was (unchanged behavior, renamed for provenance); createOpenAIResponse
// POSTs a background response (mandate: "background=true so the existing
// persisted async research_jobs/status-poll architecture remains non-
// blocking") and getOpenAIResponse polls it by id. Auth is a Bearer header
// (OpenAI), not Gemini's x-goog-api-key header.
async function openaiFetch(url: string, init: any): Promise<any> {
  let last = '';
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    last = `${r.status}: ${t.slice(0, 400)}`;
    if (![429, 500, 502, 503, 504].includes(r.status)) throw new Error(last);
    await new Promise((x) => setTimeout(x, 700 * 2 ** i));
  }
  throw new Error(`OpenAI retry exhausted ${last}`);
}
async function createOpenAIResponse(k: string, m: string, i: string, tools = true): Promise<any> {
  const b: any = { model: m, input: i, background: true };
  // Mandate: use ONLY the web_search tool (not Gemini's two-tool
  // google_search+url_context shape) — reasoning effort left at the API's
  // default for the main synthesis model rather than forced to max/xhigh.
  if (tools) b.tools = [{ type: 'web_search' }];
  return openaiFetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
}
async function getOpenAIResponse(k: string, id: string): Promise<any> {
  return openaiFetch(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${k}` } });
}
async function wf(path: string, method = 'GET', body?: any): Promise<{ code: number; data: any }> {
  const r = await fetch(`${WORKER}${path}`, { method, headers: { Authorization: `Bearer ${WT}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  let z: any = {};
  try {
    z = JSON.parse(t);
  } catch {
    /* non-JSON worker response — z stays {} */
  }
  if (!r.ok && r.status !== 409 && r.status !== 404) throw new Error(`worker ${r.status}: ${t.slice(0, 400)}`);
  return { code: r.status, data: z };
}

async function launch(sb: any, k: string, m: string, j: any, s: Stage, l: string): Promise<any> {
  const p = await createOpenAIResponse(k, m, prompt(s, j, j.result_json || {}, l), s !== 'SYNTHESIS');
  return sb
    .from('research_jobs')
    .update({ status: 'RUNNING', stage: `${s}_WAITING`, response_id: p.id, progress: { phase: s.toLowerCase(), percent: s === 'IDENTITY' ? 15 : s === 'OFFICIAL_COLLECTION' ? 40 : s === 'PUBLIC_RESEARCH' ? 62 : s === 'MARKET' ? 80 : 92, provider: 'openai' }, error: null, updated_at: now() })
    .eq('id', j.id);
}
async function startBrowser(sb: any, j: any): Promise<any> {
  const r = await wf('/research', 'POST', { query: j.query, mode: j.mode });
  const p = j.result_json || {};
  p._worker = {
    jobId: r.data.jobId,
    startedAt: new Date().toISOString(),
  };
  return sb.from('research_jobs').update({ status: 'RUNNING', stage: 'BROWSER_WAITING', result_json: p, progress: { phase: 'official_browser', percent: 34, provider: 'playwright' }, updated_at: now() }).eq('id', j.id);
}

function bev(w: any): any[] {
  const e: any[] = [];
  for (const x of w?.results || []) {
    const isMap = x.source === 'TAS_MAP';
    if (x.finalUrl || x.sourceUrl) {
      const u = x.finalUrl || x.sourceUrl;
      // v26: this used to also carry the raw `status` value straight from
      // the worker (e.g. 'SEARCH_CONTROL_NOT_FOUND', 'WRONG_SEARCH_CONTEXT')
      // onto a customer-facing evidence/sources entry — an internal FSM-
      // adjacent enum leak that bypassed sanitizeForCustomer() entirely
      // (that function only strips top-level result_json keys, never
      // fields nested inside sources[]/evidence_bundle[] items). Replaced
      // with a synthesized, always customer-safe retrievalMethod so the
      // frontend can tell "Homatch's own worker actually retrieved/
      // checked this" apart from a mere AI web-search-grounding citation
      // (extractOpenAISources(), tagged OPENAI_WEB_SEARCH since the v30
      // Gemini->OpenAI migration) without ever exposing which raw internal
      // state produced it.
      e.push({ label: x.sourceName || x.source, url: u, evidenceLevel: x.sourceClass || 'OFFICIAL', retrievalMethod: x.retrievalMethod || (x.status === 'SEARCH_CONFIRMED' ? 'OFFICIAL_WORKER_VERIFIED' : x.status === 'NO_RESULT_CONFIRMED' ? 'OFFICIAL_WORKER_CHECKED' : 'OFFICIAL_WORKER_ATTEMPTED'), retrievedAt: x.retrievedAt, sourceCategory: sourceCategory(u, { isMap }) });
    }
    const docs = (x.documents || []).length ? x.documents : x.documentLinks || [];
    for (const d of docs)
      if (d.url)
        e.push({
          label: d.title || d.label || d.url,
          url: d.url,
          evidenceLevel: 'OFFICIAL',
          retrievalMethod: d.parsed ? 'DOCUMENT_RETRIEVED_AND_PARSED' : 'DOCUMENT_LINK_DISCOVERED',
          documentType: d.type || null,
          documentDate: d.date || null,
          sha256: d.sha256 || null,
          textExtracted: !!d.parsed,
          sourceCategory: sourceCategory(d.url, { isDocument: true, isMap }),
        });
  }
  return dedupe(e, (x) => x.url);
}
function officialDocuments(browserOfficial: any): any[] {
  const out: any[] = [];
  for (const r of browserOfficial?.results || [])
    for (const d of r.documents || [])
      if (d.url) out.push({ source: r.source, sourceName: r.sourceName, url: d.url, title: d.title || d.label || null, date: d.date || null, type: d.type || null, sha256: d.sha256 || null, parsed: !!d.parsed, textExtractionAvailable: !!d.textExtractionAvailable, linkLabel: 'View document' });
  return dedupe(out, (x) => x.url);
}

async function pollBrowser(sb: any, j: any): Promise<any> {
  const id = j.result_json?._worker?.jobId;
  if (!id) throw new Error('missing worker job');
  const w = (await wf(`/research/${id}`)).data;
  if (w.status === 'WAITING_HUMAN') {
    const p = j.result_json || {};
    p._captchaReturnStage = 'BROWSER_WAITING';
    return sb.from('research_jobs').update({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED', result_json: p, captcha: w.humanVerification || {}, progress: { phase: 'captcha_required', percent: 38, provider: 'playwright' }, updated_at: now() }).eq('id', j.id);
  }
  if (w.status === 'FAILED') {
    const p = j.result_json || {};
    const partialResults = Array.isArray(w.results) ? w.results : [];

    p.browserOfficial = {
      ...(p.browserOfficial || {}),
      results: partialResults,
      unavailable: true,
    };

    delete p._worker;

    const ev = dedupe(
      [...(j.evidence_bundle || []), ...bev(w)],
      (x: any) => x.url
    );

    return sb
      .from('research_jobs')
      .update({
        status: 'CREATED',
        stage: 'OFFICIAL_READY',
        result_json: p,
        evidence_bundle: ev,
        captcha: {},
        error: null,
        progress: {
          phase: 'official_browser_unavailable',
          percent: 40,
          retriable: false,
        },
        updated_at: now(),
      })
      .eq('id', j.id);
  }
  if (w.status !== 'COMPLETE') {
    const startedAt = Date.parse(j.result_json?._worker?.startedAt || '');
    const workerAgeMs = Number.isFinite(startedAt)
      ? Date.now() - startedAt
      : 0;
    const MAX_BROWSER_WAIT_MS = 12 * 60 * 1000;

    if (startedAt && workerAgeMs > MAX_BROWSER_WAIT_MS) {
      const p = j.result_json || {};
      const partialResults = Array.isArray(w.results) ? w.results : [];

      p.browserOfficial = {
        ...(p.browserOfficial || {}),
        results: partialResults,
        unavailable: true,
      };

      delete p._worker;

      const ev = dedupe(
        [...(j.evidence_bundle || []), ...bev(w)],
        (x: any) => x.url
      );

      return sb
        .from('research_jobs')
        .update({
          status: 'CREATED',
          stage: 'OFFICIAL_READY',
          result_json: p,
          evidence_bundle: ev,
          captcha: {},
          error: null,
          progress: {
            phase: 'official_browser_unavailable',
            percent: 40,
            retriable: false,
          },
          updated_at: now(),
        })
        .eq('id', j.id);
    }

    // v31 (state-consistency fix): this used to `return` here with NO write
    // at all for every in-progress worker status (anything but WAITING_HUMAN/
    // FAILED/COMPLETE) — the confirmed production symptom being a
    // research_jobs row visually frozen at stage:'BROWSER_WAITING',
    // progress.percent:34 for the entire duration the worker is actually
    // working through TAS_MAP/TAS/MyGov/ENREG, because nothing ever
    // refreshed the row in between. status/stage are deliberately left
    // exactly as they already were (still 'RUNNING'/'BROWSER_WAITING') — no
    // FSM transition happens here, only progress/updated_at, computed from
    // the worker's own step bookkeeping (sourceIndex/steps/results) so the
    // frontend's poll sees real, moving progress instead of a frozen value.
    const total = Array.isArray(w.steps) && w.steps.length ? w.steps.length : null;
    const done = Array.isArray(w.results) ? w.results.length : 0;
    const percent = total ? Math.min(43, 34 + Math.round((done / total) * 9)) : 34;
    return sb.from('research_jobs').update({ progress: { phase: 'official_browser', percent, provider: 'playwright', sourcesCompleted: done, sourcesTotal: total }, updated_at: now() }).eq('id', j.id);
  }
  const p = j.result_json || {};
  // discoveredEntities (2026-09-06 pipeline mandate item 4 — "merge
  // discovered ... entities ... into the SAME existing ResearchContext/
  // property model"): official-worker's own EntityQueue (see
  // official-worker/src/entities/EntityQueue.ts) already accumulates every
  // company/person name+idCode found across ALL browser-worker documents
  // this job read — job.discoveredEntities is computed once at job
  // COMPLETE. This was being computed on the worker side and then silently
  // discarded here; now carried through so PUBLIC_RESEARCH's own identifier
  // list (see prompt()) and the final customer-facing report (see finish())
  // can both use it — never a new, parallel entity list.
  p.browserOfficial = { results: w.results || [], completedAt: w.completedAt || now(), historicalComparison: w.historicalComparison || null, discoveredEntities: w.discoveredEntities || [] };
  return sb
    .from('research_jobs')
    .update({ status: 'CREATED', stage: 'OFFICIAL_READY', result_json: p, evidence_bundle: dedupe([...(j.evidence_bundle || []), ...bev(w)], (x) => x.url), captcha: {}, progress: { phase: 'official_browser_complete', percent: 44, provider: 'playwright' }, updated_at: now() })
    .eq('id', j.id);
}

// pickFinancialCandidate() / startFinancialEntity() / pollFinancialEntity() /
// processFinancialQueue() (v19 as pickEnregCandidate/startEnregEntity/
// pollEnregEntity, generalized in v28 to also drive RS Taxpayers Registry
// ('rstax') and MyGov Debtor Registry ('debtor') — mandate item 8/9's
// closed-loop fix): OFFICIAL's companyProfile can name a company Gemini
// found purely through its own web research, which never passed through
// this worker's own EntityQueue text-scanning (that only sees text this
// worker's OWN browser session actually retrieved). Without this, such a
// company — very often exactly the one the customer most wants researched,
// e.g. the developer — would never get a real, deterministic lookup at all.
function alreadyHasResultFor(browserOfficial: any, source: 'enreg' | 'rstax' | 'debtor', idCode: string | null, name: string | null): boolean {
  const results = browserOfficial?.results || [];

  /*
   * REAL PRODUCTION DEFECT — job 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92.
   *
   * That job recorded enreg twice for the same developer (idCodes 404670272
   * and 405068386, both named "შპს მილენიო გრუპი") and then started a THIRD
   * enreg execution for candidate name "Millennio Group" with no idCode.
   * The name compare below could not match Latin "Millennio Group" against
   * the Georgian "შპს მილენიო გრუპი" already on record, so this guard
   * returned false and a redundant browser job was launched. It never
   * finished — it is still status START — and each such job can raise its own
   * CAPTCHA for the customer.
   *
   * Transliterating between scripts to force a match would risk merging two
   * genuinely different companies, which is a worse error. The structural
   * rule below is deterministic and script-independent instead:
   *
   *   a NAME-ONLY candidate is already covered once this source has ANY
   *   completed execution for an IDENTIFIED (idCode-bearing) entity.
   *
   * Rationale: a name search can never be more authoritative than a registry
   * id this job has already resolved for the same source, so repeating it
   * yields no new evidence — only another CAPTCHA. The worker enforces the
   * same rule independently (ResearchContext.shouldSkipDuplicateExecution),
   * so a duplicate is refused even if this guard is ever bypassed.
   *
   * Two DIFFERENT idCodes remain two different identities and are both still
   * researched: distinct registry ids are never merged on name similarity.
   */
  const sameSource = results.filter((r: any) => r.source === source);

  if (!idCode) {
    if (sameSource.some((r: any) => r.forEntity?.idCode)) return true;
    if (name) return sameSource.some((r: any) => r.forEntity?.name && normalizeLoose(r.forEntity.name) === normalizeLoose(name));
    return false;
  }

  return sameSource.some((r: any) => {
    if (r.forEntity?.idCode) return String(r.forEntity.idCode).trim() === String(idCode).trim();
    // A primary (non-entity-triggered) result with no forEntity only covers
    // property-mode jobs searching by the query itself — never treat that
    // as already covering an unrelated discovered company.
    return false;
  });
}
// companyProfileSourceBasis() (v23, mandate residual gap identified while
// reading the user's own live retest job: ENREG's own authoritative search
// returned NO_RESULT_CONFIRMED for the discovered idCode, yet companyProfile
// still presented specific director names/registration date/historical
// ownership changes as if reliably established — those actually came from
// Gemini's own general web research, not the registry itself. The STRICT
// FACT GATE prompt language alone does not force a visible distinction
// between "registry-confirmed" and "web-research-derived" company facts, so
// this computes it DETERMINISTICALLY in code (same pattern as
// overallConfidence/dueDiligenceCoverage) rather than trusting a
// self-report: REGISTRY_CONFIRMED only when browserOfficial actually
// contains a SEARCH_CONFIRMED enreg result matching this exact
// idCode/name AND at least one of its documents was actually parsed —
// otherwise WEB_RESEARCH_ONLY, however detailed the profile looks.
function companyProfileSourceBasis(companyProfile: any, browserOfficial: any): 'REGISTRY_CONFIRMED' | 'WEB_RESEARCH_ONLY' {
  if (!companyProfile || (!companyProfile.name && !companyProfile.idCode)) return 'WEB_RESEARCH_ONLY';
  const results = browserOfficial?.results || [];
  const match = results.find((r: any) => {
    if (r.source !== 'enreg' || r.status !== 'SEARCH_CONFIRMED') return false;
    const forId = r.forEntity?.idCode || null;
    const forName = r.forEntity?.name || null;
    if (companyProfile.idCode && forId) return forId === companyProfile.idCode;
    if (!forId && forName) return normalizeLoose(forName) === normalizeLoose(companyProfile.name || '');
    // A primary (non-entity-triggered) enreg result with no forEntity only
    // confirms whatever a property-mode job's own query searched for —
    // never treat it as confirming an unrelated discovered company.
    if (!r.forEntity && companyProfile.idCode) return true;
    return false;
  });
  if (!match) return 'WEB_RESEARCH_ONLY';
  return (match.documents || []).some((d: any) => d.parsed) ? 'REGISTRY_CONFIRMED' : 'WEB_RESEARCH_ONLY';
}
// companyLiquidationSuspected() (v36): a deterministic, keyword-based check
// over a REGISTRY_CONFIRMED companyProfile.status only (never a
// web-research-only status, which is not authoritative enough to drive an
// ATTENTION_REQUIRED assessment) — the one other genuinely adverse signal
// this pipeline can detect without relying on the model's own judgment.
const LIQUIDATION_STATUS_RE = /ლიკვიდაცი|გაკოტრებ|გაუქმებულ|liquidat|bankrupt|insolven|dissolved|cancelled|revoked/i;
function companyLiquidationSuspected(companyProfile: any): { suspected: boolean; note?: string } {
  if (!companyProfile || companyProfile.sourceBasis !== 'REGISTRY_CONFIRMED' || !companyProfile.status) return { suspected: false };
  if (LIQUIDATION_STATUS_RE.test(String(companyProfile.status))) return { suspected: true, note: String(companyProfile.status) };
  return { suspected: false };
}
const FINANCIAL_ENDPOINT: Record<'enreg' | 'rstax' | 'debtor', string> = {
  enreg: '/research/enreg-entity',
  rstax: '/research/rstax-entity',
  debtor: '/research/debtor-entity',
};
// pickFinancialCandidate() (v25 as pickEnregCandidate, generalized v28,
// extended again 2026-09-06 for PUBLIC_RESEARCH):
// - 'enreg' also considers reconcileIdentity()'s promoted developer
//   (MEDIUM+ confidence only — a LOW/unconfirmed mention must not spend a
//   real browser-automation lookup) when OFFICIAL_COLLECTION's own
//   companyProfile named none — the direct fix for a developer that only
//   becomes clear from MARKET comparables never getting a real ENREG lookup
//   at all. ENREG also accepts a bare name (its own search field supports
//   name search).
// - THIRD tier (2026-09-06 pipeline mandate: "If PublicResearch finds ONE
//   new strongly-supported company ID not already checked: ENREG -> RS ->
//   DEBTOR once only, then continue to MARKET"): a company PUBLIC_RESEARCH
//   discovered (companyId/legalCompany/developer) that neither
//   companyProfile nor reconciledIdentity ever named. Deliberately computed
//   the SAME deterministic way as the other two tiers — never trusting a
//   model-self-reported "newLegalEntity" flag directly (same reasoning as
//   companyProfileSourceBasis() elsewhere in this file) — alreadyHasResultFor
//   is what actually enforces "not already checked" and "once only".
// - 'rstax'/'debtor' (v28): unlike enreg, NEITHER exposes a name-search
//   field (confirmed live — see official-worker's workflows/financial/
//   selectors.ts) — a lookup is only ever material when a concrete idCode is
//   already evidenced (from companyProfile OR, now, publicResearch),  never
//   guessed from a bare name. This is also what keeps these two from ever
//   firing for a private individual: neither companyProfile nor
//   publicResearch ever carries a person's personal ID, only a company's.
function pickFinancialCandidate(prior: any, source: 'enreg' | 'rstax' | 'debtor'): { name: string; idCode: string | null } | null {
  const cp = prior.official?.companyProfile;
  const pr = prior.publicResearch;
  const prIdCode: string | null = pr?.companyId || null;
  const prName: string | null = pr?.legalCompany || pr?.developer || null;
  if (source === 'enreg') {
    if (cp && (cp.name || cp.idCode)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', cp.idCode || null, cp.name || null)) return { name: cp.name || cp.idCode, idCode: cp.idCode || null };
    }
    const ri = prior.reconciledIdentity;
    if (ri?.developer && ['MEDIUM', 'HIGH'].includes(ri.confidence)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', null, ri.developer)) return { name: ri.developer, idCode: null };
    }
    if (prIdCode || prName) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', prIdCode, prName)) return { name: prName || (prIdCode as string), idCode: prIdCode };
    }
    return null;
  }
  const idCode = cp?.idCode || prIdCode || null;
  if (!idCode) return null;
  if (alreadyHasResultFor(prior.browserOfficial, source, idCode, null)) return null;
  return { name: cp?.name || prName || idCode, idCode };
}
// _financialReturnStage (v25 as _enregReturnStage, generalized v28, extended
// 2026-09-06): the ULTIMATE destination once the whole enreg->rstax->debtor
// chain finishes — 'PUBLIC_RESEARCH_READY' for the OFFICIAL_COLLECTION-stage
// trigger (official evidence's own discovered company, checked BEFORE
// public research runs — "official evidence MUST finish first"),
// 'MARKET_READY' for the PUBLIC_RESEARCH-stage trigger (a company public
// research alone discovered), 'SYNTHESIS_READY' for the MARKET/
// reconciliation-stage trigger. Persisted once per chain run so each
// individual source's CAPTCHA pause/resume doesn't need to re-derive it.
async function startFinancialEntity(sb: any, j: any, source: 'enreg' | 'rstax' | 'debtor', name: string, idCode: string | null, returnStage: 'PUBLIC_RESEARCH_READY' | 'MARKET_READY' | 'SYNTHESIS_READY'): Promise<any> {
  const r = await wf(FINANCIAL_ENDPOINT[source], 'POST', { name, idCode });
  const p = j.result_json || {};
  p._worker = { jobId: r.data.jobId };
  p._financialEntityRequestedFor = { source, name, idCode };
  p._financialReturnStage = returnStage;
  return sb.from('research_jobs').update({ status: 'RUNNING', stage: 'FINANCIAL_ENTITY_WAITING', result_json: p, progress: { phase: `${source}_entity`, percent: returnStage === 'PUBLIC_RESEARCH_READY' ? 50 : returnStage === 'MARKET_READY' ? 70 : 86, provider: 'playwright' }, updated_at: now() }).eq('id', j.id);
}
// processFinancialQueue() (v28, NEW): drives `_financialQueue` (initialized
// to ['enreg','rstax','debtor'] by whichever CHECK_PENDING stage entered the
// chain) one source at a time — skipping a source cleanly when
// pickFinancialCandidate finds nothing material for it (mandate: "skip
// irrelevant categories cleanly", "not blindly always"), pausing on a real
// candidate via startFinancialEntity, and falling through to the chain's
// ultimate `_financialReturnStage` once the queue is empty. This is what
// lets enreg/rstax/debtor share ONE CAPTCHA-pause/resume/skip lifecycle
// instead of three near-duplicate copies of it.
async function processFinancialQueue(sb: any, j: any): Promise<any> {
  const prior = j.result_json || {};
  const queue: ('enreg' | 'rstax' | 'debtor')[] = Array.isArray(prior._financialQueue) ? [...prior._financialQueue] : [];
  const returnStage: 'PUBLIC_RESEARCH_READY' | 'MARKET_READY' | 'SYNTHESIS_READY' =
    prior._financialReturnStage === 'SYNTHESIS_READY' ? 'SYNTHESIS_READY' : prior._financialReturnStage === 'PUBLIC_RESEARCH_READY' ? 'PUBLIC_RESEARCH_READY' : 'MARKET_READY';
  while (queue.length) {
    const source = queue.shift()!;
    const cand = pickFinancialCandidate(prior, source);
    if (cand) {
      prior._financialQueue = queue;
      return startFinancialEntity(sb, { ...j, result_json: prior }, source, cand.name, cand.idCode, returnStage);
    }
  }
  prior._financialQueue = [];
  return sb.from('research_jobs').update({ status: 'CREATED', stage: returnStage, result_json: prior, updated_at: now() }).eq('id', j.id);
}
async function pollFinancialEntity(sb: any, j: any): Promise<any> {
  const prior = j.result_json || {};
  const id = prior?._worker?.jobId;
  if (!id) return processFinancialQueue(sb, j);
  const w = (await wf(`/research/${id}`)).data;
  if (w.status === 'WAITING_HUMAN') {
    prior._captchaReturnStage = 'FINANCIAL_ENTITY_WAITING';
    return sb.from('research_jobs').update({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED', result_json: prior, captcha: w.humanVerification || {}, progress: { phase: 'captcha_required', percent: 60, provider: 'playwright' }, updated_at: now() }).eq('id', j.id);
  }
  if (w.status !== 'COMPLETE' && w.status !== 'FAILED') return; // still running
  // A single financial-entity lookup (enreg/rstax/debtor) is a best-effort
  // enrichment step, never a reason to fail the whole job — on FAILED, just
  // move on to whatever else remains in the queue.
  if (w.status === 'COMPLETE') {
    const entityResult = (w.results || [])[0] || null;
    if (entityResult) {
      prior.browserOfficial = prior.browserOfficial || { results: [] };
      prior.browserOfficial.results = [...(prior.browserOfficial.results || []), entityResult];
    }
    const ev = dedupe([...(j.evidence_bundle || []), ...bev(w)], (x: any) => x.url);
    await sb.from('research_jobs').update({ result_json: prior, evidence_bundle: ev, captcha: {}, updated_at: now() }).eq('id', j.id);
    return processFinancialQueue(sb, { ...j, result_json: prior, evidence_bundle: ev });
  }
  return processFinancialQueue(sb, { ...j, result_json: prior });
}

// officialVerificationSummary — unchanged shape from v18 (still useful
// internal/admin data on the wire), but no longer used to generate any
// customer-facing explanatory sentence (see coverageNote below).
function officialVerificationSummary(browserOfficial: any) {
  const results = browserOfficial?.results || [];
  const confirmedFound = results.filter((r: any) => r.status === 'SEARCH_CONFIRMED').map((r: any) => ({ source: r.source, sourceName: r.sourceName, status: r.status }));
  const confirmedNoResult = results.filter((r: any) => r.status === 'NO_RESULT_CONFIRMED').map((r: any) => ({ source: r.source, sourceName: r.sourceName, status: r.status, note: 'Confirms only that this exact verified search returned no matching record on this source — NOT evidence that the property/record does not exist.' }));
  const skipped = results.filter((r: any) => r.status === 'SKIPPED_HUMAN_VERIFICATION').map((r: any) => ({ source: r.source, sourceName: r.sourceName, status: r.status, note: 'Human verification was required on this source and the user chose to skip it.' }));
  const checked = [...confirmedFound, ...confirmedNoResult];
  const notVerified = results.filter((r: any) => !CONFIRMED_STATUSES.has(r.status) && r.status !== 'SKIPPED_HUMAN_VERIFICATION').map((r: any) => ({ source: r.source, sourceName: r.sourceName, status: r.status || 'NOT_SEARCHED', error: r.error || null }));
  const partiallyTraversed = checked
    .filter((c: any) => {
      const r = results.find((x: any) => x.source === c.source && x.status === c.status);
      return r?.traversal?.status && !['SOURCE_EXHAUSTED', 'NOT_STARTED'].includes(r.traversal.status);
    })
    .map((c: any) => {
      const r = results.find((x: any) => x.source === c.source && x.status === c.status);
      return { source: c.source, sourceName: c.sourceName, status: c.status, traversalStatus: r?.traversal?.status || null, unvisitedRelevantItems: r?.traversal?.unvisitedRelevantItems ?? null };
    });
  return {
    officialSourcesChecked: checked,
    officialSourcesConfirmedFound: confirmedFound,
    officialSourcesConfirmedNoResult: confirmedNoResult,
    officialSourcesNotVerified: notVerified,
    officialSourcesSkipped: skipped,
    officialSourcesPartiallyTraversed: partiallyTraversed,
    officialVerificationComplete: results.length > 0 && checked.length > 0 && partiallyTraversed.length === 0,
  };
}

// coverageNote() (v19 — REPLACES v18's verificationCaveat() entirely). Per
// the explicit correction: "Only show a small neutral 'coverage' indicator
// if product UX genuinely requires it. Do not make technical failure a
// headline." This fires ONLY when literally nothing official was
// confirmed — never for the "confirmed but not fully traversed" case,
// which is now handled purely by internal retry/coverage bookkeeping and
// never narrated to the customer at all.
const COVERAGE_NOTE_I18N: Record<string, string> = {
  ka: 'ამ მოთხოვნისთვის ოფიციალური სამთავრობო/სარეესტრო წყაროდან პირდაპირი დადასტურება ვერ მოხერხდა — ქვემოთ მოცემული ინფორმაცია ეყრდნობა საჯარო წყაროებს.',
  en: 'A direct government/registry confirmation could not be completed for this request — the information below is based on public sources.',
  ru: 'Прямое подтверждение от официального государственного/реестрового источника для этого запроса получить не удалось — информация ниже основана на публичных источниках.',
  tr: 'Bu talep için resmi bir devlet/kayıt kaynağından doğrudan doğrulama tamamlanamadı — aşağıdaki bilgiler kamuya açık kaynaklara dayanmaktadır.',
  ar: 'تعذر إتمام تأكيد مباشر من مصدر حكومي/رسمي لهذا الطلب — تستند المعلومات أدناه إلى مصادر عامة.',
  he: 'לא ניתן היה להשלים אישור ישיר ממקור ממשלתי/רשמי עבור בקשה זו — המידע להלן מבוסס על מקורות ציבוריים.',
};
function coverageNote(officialStatus: any, lang: string): string {
  if (officialStatus.officialSourcesChecked.length > 0) return '';
  return COVERAGE_NOTE_I18N[lang] || COVERAGE_NOTE_I18N.en;
}

// MATERIAL_RISK_NONE_I18N (mandate item 17): the fixed neutral sentence used
// whenever no evidenced risk exists — never our own missing-evidence
// explanation dressed up as a property risk.
const MATERIAL_RISK_NONE_I18N: Record<string, string> = {
  ka: 'ამ ეტაპზე შეგროვებულ საჯარო მტკიცებულებებში მატერიალური წინააღმდეგობა ან რისკი არ გამოვლენილა.',
  en: 'No material contradiction or risk was identified in the public evidence collected so far.',
  ru: 'В собранных на данный момент публичных данных существенных противоречий или рисков не выявлено.',
  tr: 'Şimdiye kadar toplanan kamuya açık kanıtlarda önemli bir çelişki veya risk tespit edilmedi.',
  ar: 'لم يتم تحديد أي تناقض جوهري أو خطر في الأدلة العامة التي تم جمعها حتى الآن.',
  he: 'לא זוהתה סתירה מהותית או סיכון בראיות הציבוריות שנאספו עד כה.',
};

// overallConfidence() (v19 — REPLACES the old direct exposure of Gemini's
// self-asserted entity.confidence as "the" confidence). This is the direct
// fix for "დადასტურების დონე: მაღალი" while TAS documents were unread,
// MSMAP details were unopened, and NAPR was never checked — HIGH is now
// structurally impossible unless an official source was both CONFIRMED and
// FULLY traversed and at least one real document was actually read.
function overallConfidence(identityConfidence: string | undefined, officialStatus: any, officialDocs: any[]): 'HIGH' | 'MEDIUM' | 'LOW' {
  const confirmedCount = officialStatus.officialSourcesConfirmedFound.length;
  const fullyExhausted = officialStatus.officialVerificationComplete;
  const docsRead = officialDocs.filter((d: any) => d.parsed).length;
  const idHigh = String(identityConfidence || '').toUpperCase() === 'HIGH';
  if (confirmedCount === 0) return 'LOW';
  if (!fullyExhausted || docsRead === 0) return idHigh ? 'MEDIUM' : 'LOW';
  return idHigh ? 'HIGH' : 'MEDIUM';
}

// dueDiligenceCoverage() (v21, master due-diligence mandate — "PURCHASE
// DECISION" section): this system must never output a safety verdict
// (SAFE TO BUY / a fake percentage). It outputs DUE-DILIGENCE COVERAGE —
// HIGH/MEDIUM/LIMITED — which measures how much of the research was
// actually completed, plus the real counts behind it, never a claim about
// whether the transaction itself is safe.
function dueDiligenceCoverage(officialStatus: any, officialDocs: any[], companyProfile: any, market: any, ev: any[], conflicts: { description: string; severity: string }[], unverified: string[], browserOfficial?: any): any {
  const officialSourcesChecked = officialStatus.officialSourcesChecked.length;
  const documentsRead = officialDocs.filter((d: any) => d.parsed).length;
  // v26 (mandate's "FIX COVERAGE FROM STRUCTURED STATES, NOT LLM TEXT"):
  // officialSourcesChecked alone (SEARCH_CONFIRMED + NO_RESULT_CONFIRMED)
  // silently dropped every technically-failed adapter from every count —
  // a job that ran 3 adapters with 1 success and 2 technical failures
  // reported "1 checked" with zero visibility into the other 2 anywhere
  // the customer could see. These three are computed straight from
  // browserOfficial.results (the worker's own real per-adapter terminal
  // states — never from officialStatus's already-narrowed subsets, and
  // never from Gemini's own self-report) so "attempted" always accounts
  // for every adapter that actually ran, whatever it ended in.
  const officialResults = browserOfficial?.results || [];
  const officialSourcesAttempted = officialResults.length;
  const officialSourcesRetrieved = officialResults.filter((r: any) => r.status === 'SEARCH_CONFIRMED').length;
  const technicalFailures = officialResults.filter((r: any) => customerSourceStatus(r.status) === 'TECHNICAL_FAILED').length;
  const documentsDiscovered = officialDocs.length;
  const companyRecords = companyProfile && (companyProfile.name || companyProfile.idCode) ? 1 : 0;
  const marketComparables = (market?.comparables || []).filter((c: any) => !c.genericSource).length;
  // v25: replaced the old `!evidenceLevel.startsWith('OFFICIAL')` heuristic
  // (which counted MyHome/SS/Korter/developer/bank pages as "social") with
  // real per-item sourceCategory (see sourceCategory() above) — socialSources
  // now counts only genuine SOCIAL/PUBLIC_GROUP items, with sibling counters
  // for the other public-evidence categories so coverage UI can be truthful
  // about what kind of public evidence actually backs the report.
  const byCategory = (cats: SourceCategory[]) => ev.filter((x: any) => cats.includes(x.sourceCategory)).length;
  const socialSources = byCategory(['SOCIAL', 'PUBLIC_GROUP']);
  const marketListingSources = byCategory(['MARKET_LISTING']);
  const developerPrimarySources = byCategory(['DEVELOPER_PRIMARY']);
  const mediaSources = byCategory(['MEDIA']);
  const forumSources = byCategory(['PUBLIC_FORUM']);
  const publicSearchSources = byCategory(['PUBLIC_SEARCH']);
  const otherPublicSources = byCategory(['OTHER_PUBLIC']);
  let level: 'HIGH' | 'MEDIUM' | 'LIMITED' = 'LIMITED';
  if (officialSourcesChecked > 0 && officialStatus.officialVerificationComplete && documentsRead > 0) level = 'HIGH';
  else if (officialSourcesChecked > 0 || documentsRead > 0) level = 'MEDIUM';
  return {
    level,
    officialSourcesChecked,
    officialSourcesAttempted,
    officialSourcesRetrieved,
    technicalFailures,
    documentsDiscovered,
    documentsRead,
    companyRecords,
    marketComparables,
    socialSources,
    marketListingSources,
    developerPrimarySources,
    mediaSources,
    forumSources,
    publicSearchSources,
    otherPublicSources,
    materialMismatches: conflicts.length,
    outstandingConfirmations: unverified.length,
  };
}

// computeOverallAssessment() (v36 rewrite, mandate: "THE REPORT MUST NOT
// CONTRADICT ITSELF" — the previous 4-level scale could show a CAUTION/
// MIXED badge while the body text simultaneously said no material risk was
// found, because the badge was driven by generic `conflicts` (which mixed
// in ordinary marketing-detail discrepancies) while the risk sentence was
// driven only by riskFlags. Both are now derived from ONE shared
// `materialAdverseFindings` list computed here — the badge and the "no
// material issue" sentence can therefore never disagree again, by
// construction. This stays a deterministic, code-level gate over
// structured signals — never the model's own self-report. Never returns
// anything resembling "safe to buy" — this is a due-diligence-evidence
// signal, not a legal or transactional guarantee. A missing/not-yet-
// retrieved document is NEVER, by itself, a material adverse finding.
type OverallAssessmentLevel = 'VERY_POSITIVE' | 'POSITIVE' | 'GENERALLY_POSITIVE' | 'NEUTRAL_MIXED' | 'ATTENTION_REQUIRED';
interface MaterialAdverseFinding {
  description: string;
}
const RESTRICTION_FOUND_FALLBACK_I18N: Record<string, string> = {
  ka: 'რეესტრში დაფიქსირდა რეგისტრირებული შეზღუდვა ან დატვირთვა — საჭიროებს დეტალურ გადამოწმებას გარიგებამდე.',
  en: 'A registered restriction or encumbrance was identified in the registry — this needs detailed review before the transaction.',
  ru: 'В реестре обнаружено зарегистрированное ограничение или обременение — требуется детальная проверка перед сделкой.',
  tr: 'Sicilde tescilli bir kısıtlama veya takyidat tespit edildi — işlemden önce ayrıntılı incelenmelidir.',
  ar: 'تم رصد قيد أو عبء مسجل في السجل — يتطلب مراجعة تفصيلية قبل الصفقة.',
  he: 'זוהתה הגבלה או שעבוד רשומים במרשם — יש לבדוק זאת לעומק לפני העסקה.',
};
const DEBTOR_RECORD_FOUND_I18N: Record<string, string> = {
  ka: 'მოვალეთა რეესტრში ამ იდენტიფიკატორზე ჩანაწერი დაფიქსირდა — დეტალები საჭიროებს გადამოწმებას გარიგებამდე.',
  en: 'A matching record was found in the Debtor Registry for this identifier — the details need review before the transaction.',
  ru: 'В реестре должников найдена запись по этому идентификатору — детали требуют проверки перед сделкой.',
  tr: 'Bu kimlik için Borçlular Sicilinde eşleşen bir kayıt bulundu — ayrıntılar işlemden önce incelenmelidir.',
  ar: 'تم العثور على سجل مطابق في سجل المدينين لهذا المعرف — يجب مراجعة التفاصيل قبل الصفقة.',
  he: 'נמצאה רשומה תואמת במרשם החייבים עבור מזהה זה — יש לבדוק את הפרטים לפני העסקה.',
};
const COMPANY_STATUS_NOT_ACTIVE_I18N: Record<string, string> = {
  ka: 'რეესტრში დაფიქსირებული კომპანიის სტატუსი არ არის აქტიური — საჭიროებს დამატებით გადამოწმებას.',
  en: "The company's registered status is not active — this needs additional review.",
  ru: 'Зарегистрированный статус компании не является активным — требуется дополнительная проверка.',
  tr: 'Şirketin tescilli durumu aktif değil — ek inceleme gereklidir.',
  ar: 'الحالة المسجلة للشركة ليست نشطة — يتطلب مراجعة إضافية.',
  he: 'הסטטוס הרשום של החברה אינו פעיל — יש צורך בבדיקה נוספת.',
};
function computeMaterialAdverseFindings(
  riskFlags: { severity: 'LOW' | 'MEDIUM' | 'HIGH'; description: string }[],
  materialConflicts: { description: string; severity: string }[],
  rightsAndRestrictions: { status: string; items?: string[] },
  debtorRecordFound: boolean,
  companyLiquidationSuspected: { suspected: boolean; note?: string },
  l: string
): MaterialAdverseFinding[] {
  const out: MaterialAdverseFinding[] = [];
  for (const r of riskFlags) if (r.severity === 'HIGH') out.push({ description: r.description });
  if (rightsAndRestrictions.status === 'RESTRICTION_IDENTIFIED') {
    for (const it of rightsAndRestrictions.items || []) out.push({ description: it });
    if (!rightsAndRestrictions.items?.length) out.push({ description: RESTRICTION_FOUND_FALLBACK_I18N[l] || RESTRICTION_FOUND_FALLBACK_I18N.en });
  }
  if (debtorRecordFound) out.push({ description: DEBTOR_RECORD_FOUND_I18N[l] || DEBTOR_RECORD_FOUND_I18N.en });
  if (companyLiquidationSuspected.suspected) out.push({ description: COMPANY_STATUS_NOT_ACTIVE_I18N[l] || COMPANY_STATUS_NOT_ACTIVE_I18N.en });
  for (const c of materialConflicts) out.push({ description: c.description });
  return out;
}

// ---------------------------------------------------------------------
// 2026-09 "report intelligence v2" mandate item 16: a single broad "clean"
// conclusion is replaced by 6 INDEPENDENTLY evidenced categories, each
// resolved to exactly one of 4 states. Built entirely from signals this
// file already computes deterministically (officialVerificationSummary's
// per-source buckets, rightsAndRestrictions, debtorRecordFound,
// companyLiquidationSuspected) — never from the model's own prose, and
// never upgraded to CONFIRMED_POSITIVE just because a worker page loaded
// (addendum: "SOURCE FAILURE ≠ PROPERTY RISK", "NO EVIDENCE = NO FACT").
type LegalStatusValue = 'CONFIRMED_POSITIVE' | 'CONFIRMED_ATTENTION' | 'NOT_CONFIRMED' | 'HUMAN_VERIFICATION_REQUIRED';
interface LegalStatusEntry {
  status: LegalStatusValue;
  label: string;
  note: string;
}
interface LegalStatusMatrix {
  companyRegistration: LegalStatusEntry;
  debtorRegistry: LegalStatusEntry;
  taxpayerStatus: LegalStatusEntry;
  propertyEncumbrances: LegalStatusEntry;
  constructionPermissions: LegalStatusEntry;
  commissioning: LegalStatusEntry;
}
const LEGAL_STATUS_CATEGORY_I18N: Record<keyof LegalStatusMatrix, Record<string, string>> = {
  companyRegistration: { ka: 'კომპანიის რეგისტრაცია', en: 'Company registration', ru: 'Регистрация компании', tr: 'Şirket tescili', ar: 'تسجيل الشركة', he: 'רישום החברה' },
  debtorRegistry: { ka: 'მოვალეთა რეესტრი', en: 'Debtor registry', ru: 'Реестр должников', tr: 'Borçlular sicili', ar: 'سجل المدينين', he: 'מרשם החייבים' },
  taxpayerStatus: { ka: 'გადასახადის გადამხდელის სტატუსი', en: 'Taxpayer status', ru: 'Статус налогоплательщика', tr: 'Vergi mükellefi durumu', ar: 'حالة دافع الضرائب', he: 'סטטוס משלם המסים' },
  propertyEncumbrances: { ka: 'საკუთრების შეზღუდვები/ტვირთები', en: 'Property encumbrances', ru: 'Обременения на имущество', tr: 'Mülkiyet üzerindeki kısıtlamalar', ar: 'أعباء الملكية', he: 'שעבודים על הנכס' },
  constructionPermissions: { ka: 'მშენებლობის ნებართვები', en: 'Construction permissions', ru: 'Разрешения на строительство', tr: 'İnşaat izinleri', ar: 'تصاريح البناء', he: 'היתרי בנייה' },
  commissioning: { ka: 'ექსპლუატაციაში მიღება', en: 'Commissioning', ru: 'Ввод в эксплуатацию', tr: 'İşletmeye alma', ar: 'التشغيل والتسليم', he: 'קבלת טופס אכלוס' },
};
const LEGAL_STATUS_EXPLANATION_I18N: Record<LegalStatusValue, Record<string, string>> = {
  CONFIRMED_POSITIVE: { ka: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.', en: 'Confirmed by a public source — no adverse evidence was found.', ru: 'Подтверждено публичным источником — неблагоприятных данных не обнаружено.', tr: 'Kamuya açık bir kaynakla doğrulandı — olumsuz bir kanıt bulunamadı.', ar: 'تم التأكيد من مصدر عام — لم يتم العثور على أي دليل سلبي.', he: 'אושר על ידי מקור ציבורי — לא נמצאה ראיה שלילית.' },
  CONFIRMED_ATTENTION: { ka: 'დადასტურებულია საჯარო წყაროთი, თუმცა საჭიროებს დამატებით ყურადღებას.', en: 'Confirmed by a public source, but this requires additional attention.', ru: 'Подтверждено публичным источником, однако требует дополнительного внимания.', tr: 'Kamuya açık bir kaynakla doğrulandı, ancak ek dikkat gerektiriyor.', ar: 'تم التأكيد من مصدر عام، لكنه يتطلب اهتمامًا إضافيًا.', he: 'אושר על ידי מקור ציבורי, אך הדבר דורש תשומת לב נוספת.' },
  NOT_CONFIRMED: { ka: 'ამ ეტაპზე საჯარო წყაროებით ვერ დადასტურდა.', en: 'Not yet confirmed by public sources at this stage.', ru: 'На данном этапе публичными источниками не подтверждено.', tr: 'Bu aşamada kamuya açık kaynaklarla doğrulanamadı.', ar: 'لم يتم تأكيده بعد من خلال مصادر عامة في هذه المرحلة.', he: 'טרם אושר על ידי מקורות ציבוריים בשלב זה.' },
  HUMAN_VERIFICATION_REQUIRED: { ka: 'საჭიროებს დამატებით ვერიფიკაციას — ავტომატური შემოწმება ვერ დასრულდა.', en: 'Requires additional human verification — the automated check could not be completed.', ru: 'Требуется дополнительная проверка вручную — автоматическая проверка не может быть завершена.', tr: 'Ek insan doğrulaması gerektirir — otomatik kontrol tamamlanamadı.', ar: 'يتطلب تحققًا بشريًا إضافيًا — تعذر إكمال الفحص الآلي.', he: 'נדרש אימות אנושי נוסף — הבדיקה האוטומטית לא הושלמה.' },
};
function legalStatusEntry(category: keyof LegalStatusMatrix, status: LegalStatusValue, lang: string): LegalStatusEntry {
  return {
    status,
    label: LEGAL_STATUS_CATEGORY_I18N[category][lang] || LEGAL_STATUS_CATEGORY_I18N[category].en,
    note: LEGAL_STATUS_EXPLANATION_I18N[status][lang] || LEGAL_STATUS_EXPLANATION_I18N[status].en,
  };
}
/** Mirrors officialVerificationSummary()'s own bucketing for one `source`
 * key so this matrix can never disagree with the officialStatus already
 * shown elsewhere in the same report. */
function sourceOutcome(officialStatus: any, source: string): 'FOUND' | 'NO_RESULT' | 'SKIPPED' | 'NOT_VERIFIED' {
  if ((officialStatus?.officialSourcesConfirmedFound || []).some((r: any) => r.source === source)) return 'FOUND';
  if ((officialStatus?.officialSourcesConfirmedNoResult || []).some((r: any) => r.source === source)) return 'NO_RESULT';
  if ((officialStatus?.officialSourcesSkipped || []).some((r: any) => r.source === source)) return 'SKIPPED';
  return 'NOT_VERIFIED';
}
// classifyOfficialDocumentKind() — a deliberately narrow, keyword-based
// classifier over a TAS document's own title/type text. This is a stopgap:
// the mandate's fuller ask (item 9 — parse every official document into
// structured date/type/K1-K2-K3/height/floors/permit-number fields) is a
// larger, separate extraction pipeline not built yet. Until that exists,
// this is the most honest signal available for whether a *general
// construction permit* vs a *commissioning/completion act* was actually
// retrieved — never a guess when the title carries neither marker.
function classifyOfficialDocumentKind(doc: { title?: string | null; type?: string | null }): 'PERMIT' | 'COMMISSIONING' | 'OTHER' {
  const text = `${doc?.title || ''} ${doc?.type || ''}`;
  if (/(ექსპლუატაციაში\s*მიღებ|დასრულების\s*აქტ|commissioning|completion\s*act)/i.test(text)) return 'COMMISSIONING';
  if (/(მშენებლობის\s*ნებართვ|ნებართვა|building\s*permit|construction\s*permit)/i.test(text)) return 'PERMIT';
  return 'OTHER';
}
function buildLegalStatusMatrix(
  officialStatus: any,
  opts: { officialDocs: any[]; companyLiquidationSuspected: boolean; debtorRecordFound: boolean; rightsAndRestrictionsStatus: string },
  lang: string
): LegalStatusMatrix {
  const outcome = (source: string) => sourceOutcome(officialStatus, source);
  const tasDocs = (opts.officialDocs || []).filter((d: any) => d.source === 'tas');
  const hasPermitDoc = tasDocs.some((d: any) => classifyOfficialDocumentKind(d) === 'PERMIT');
  const hasCommissioningDoc = tasDocs.some((d: any) => classifyOfficialDocumentKind(d) === 'COMMISSIONING');

  const enregOutcome = outcome('enreg');
  const companyRegistrationStatus: LegalStatusValue =
    enregOutcome === 'SKIPPED' ? 'HUMAN_VERIFICATION_REQUIRED' : enregOutcome === 'FOUND' ? (opts.companyLiquidationSuspected ? 'CONFIRMED_ATTENTION' : 'CONFIRMED_POSITIVE') : 'NOT_CONFIRMED';

  const debtorOutcome = outcome('debtor');
  const debtorRegistryStatus: LegalStatusValue =
    debtorOutcome === 'SKIPPED' ? 'HUMAN_VERIFICATION_REQUIRED' : debtorOutcome === 'FOUND' ? 'CONFIRMED_ATTENTION' : debtorOutcome === 'NO_RESULT' ? 'CONFIRMED_POSITIVE' : 'NOT_CONFIRMED';

  const rstaxOutcome = outcome('rstax');
  const taxpayerStatusValue: LegalStatusValue = rstaxOutcome === 'SKIPPED' ? 'HUMAN_VERIFICATION_REQUIRED' : rstaxOutcome === 'FOUND' ? 'CONFIRMED_POSITIVE' : 'NOT_CONFIRMED';

  // Property encumbrances draws on rightsAndRestrictions (the more precise,
  // already-evidence-gated signal — see prompt() OFFICIAL_COLLECTION) rather
  // than raw source-level success, but still defers to a skipped
  // mygov/napr human-verification step when that is the actual reason
  // nothing was confirmed.
  const registrySkipped = outcome('mygov') === 'SKIPPED' || outcome('napr') === 'SKIPPED';
  const propertyEncumbrancesStatus: LegalStatusValue =
    opts.rightsAndRestrictionsStatus === 'RESTRICTION_IDENTIFIED'
      ? 'CONFIRMED_ATTENTION'
      : opts.rightsAndRestrictionsStatus === 'NONE_FOUND_IN_CHECKED_SOURCE'
        ? 'CONFIRMED_POSITIVE'
        : registrySkipped
          ? 'HUMAN_VERIFICATION_REQUIRED'
          : 'NOT_CONFIRMED';

  const tasOutcome = outcome('tas');
  const constructionPermissionsStatus: LegalStatusValue = tasOutcome === 'SKIPPED' ? 'HUMAN_VERIFICATION_REQUIRED' : hasPermitDoc ? 'CONFIRMED_POSITIVE' : 'NOT_CONFIRMED';
  const commissioningStatus: LegalStatusValue = tasOutcome === 'SKIPPED' ? 'HUMAN_VERIFICATION_REQUIRED' : hasCommissioningDoc ? 'CONFIRMED_POSITIVE' : 'NOT_CONFIRMED';

  return {
    companyRegistration: legalStatusEntry('companyRegistration', companyRegistrationStatus, lang),
    debtorRegistry: legalStatusEntry('debtorRegistry', debtorRegistryStatus, lang),
    taxpayerStatus: legalStatusEntry('taxpayerStatus', taxpayerStatusValue, lang),
    propertyEncumbrances: legalStatusEntry('propertyEncumbrances', propertyEncumbrancesStatus, lang),
    constructionPermissions: legalStatusEntry('constructionPermissions', constructionPermissionsStatus, lang),
    commissioning: legalStatusEntry('commissioning', commissioningStatus, lang),
  };
}

// ---------------------------------------------------------------------
// 2026-09 mandate item 8 / addendum Section 1-3: ManualVerificationAction —
// every unresolved CRITICAL gap (HUMAN_VERIFICATION_REQUIRED or, for the
// two hard-legal categories, NOT_CONFIRMED) gets one concrete, actionable
// card instead of a bare "not confirmed" label. Each action names an
// OFFICIAL government portal only (never an ordinary research provider —
// the one explicit exception the source-name ban allows) and every such
// portal URL is drawn from a small FIXED allowlist below rather than
// anything model-generated, so it can never carry a stray tracking
// parameter or a dead deep link the model hallucinated.
interface ManualVerificationAction {
  id: string;
  title: string;
  reason: string;
  steps: string[];
  requestedDocument: string | null;
  officialPortalUrl: string | null;
  officialPortalLabel: string | null;
  aiUploadPrompt: string;
}
// OFFICIAL_PORTAL_I18N: fixed, hand-verified homepage/section URLs for the
// government portals this product ever references. A homepage-level URL
// (never a deep link that could go stale) — CustomerLinkValidation (see
// validateCustomerLink() below) is applied to these too before they are
// ever shown, so a portal that itself becomes unreachable degrades to
// "no link" rather than a dead link.
const OFFICIAL_PORTAL: Record<string, { url: string; label: Record<string, string> }> = {
  enreg: { url: 'https://enreg.reestri.gov.ge', label: { ka: 'მეწარმეთა და არასამეწარმეო (არაკომერციული) იურიდიული პირების რეესტრი', en: 'Entrepreneurial and Non-Commercial Legal Entities Registry', ru: 'Реестр предпринимателей', tr: 'Ticari Sicil Portalı', ar: 'سجل الشركات', he: 'מרשם החברות' } },
  napr: { url: 'https://napr.gov.ge', label: { ka: 'საჯარო რეესტრის ეროვნული სააგენტო', en: 'National Agency of Public Registry', ru: 'Национальное агентство публичного реестра', tr: 'Kamu Sicil Ulusal Ajansı', ar: 'الوكالة الوطنية للسجل العام', he: 'הסוכנות הלאומית למרשם הציבורי' } },
  rstax: { url: 'https://rs.ge', label: { ka: 'შემოსავლების სამსახური', en: 'Revenue Service', ru: 'Служба доходов', tr: 'Gelir İdaresi', ar: 'خدمة الإيرادات', he: 'רשות ההכנסות' } },
  debtor: { url: 'https://enforce.gov.ge', label: { ka: 'აღსრულების ეროვნული ბიურო — მოვალეთა რეესტრი', en: 'National Bureau of Enforcement — Debtor Registry', ru: 'Национальное бюро принудительного исполнения — реестр должников', tr: 'Ulusal İcra Bürosu — Borçlular Sicili', ar: 'المكتب الوطني للتنفيذ — سجل المدينين', he: 'הלשכה הלאומית לאכיפה — מרשם החייבים' } },
  tas: { url: 'https://tas.ge', label: { ka: 'მშენებლობის ნებართვისა და ტექნიკური საბჭოს პორტალი', en: 'Construction Permits and Technical Council Portal', ru: 'Портал разрешений на строительство', tr: 'İnşaat İzinleri Portalı', ar: 'بوابة تصاريح البناء', he: 'פורטל היתרי בנייה' } },
  mygov: { url: 'https://my.gov.ge', label: { ka: 'საჯარო სერვისების ერთიანი პორტალი (my.gov.ge)', en: 'my.gov.ge — Unified Public Services Portal', ru: 'my.gov.ge — единый портал госуслуг', tr: 'my.gov.ge — Kamu Hizmetleri Portalı', ar: 'my.gov.ge — بوابة الخدمات العامة', he: 'my.gov.ge — פורטל השירותים הממשלתיים' } },
};
const MANUAL_ACTION_COPY_I18N: Record<string, Record<string, { title: string; reason: string; steps: string[]; requestedDocument: string; aiUploadPrompt: string }>> = {
  companyRegistration: {
    ka: {
      title: 'კომპანიის რეგისტრაციის დამატებითი გადამოწმება',
      reason: 'კომპანიის რეგისტრაციის მონაცემები საჯარო წყაროებით ავტომატურად ვერ დადასტურდა.',
      steps: ['გახსენით მეწარმეთა რეესტრის ოფიციალური გვერდი.', 'მოძებნეთ კომპანია სახელით ან საიდენტიფიკაციო კოდით.', 'გადაამოწმეთ სტატუსი და დირექტორთა შემადგენლობა.'],
      requestedDocument: 'ამონაწერი მეწარმეთა რეესტრიდან',
      aiUploadPrompt: 'თუ უკვე გაქვთ ამონაწერი, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Additional company-registration verification',
      reason: 'Company registration data could not be automatically confirmed from public sources.',
      steps: ['Open the official Entrepreneurial Registry page.', 'Search for the company by name or identification code.', 'Verify its status and current directors.'],
      requestedDocument: 'Extract from the Entrepreneurial Registry',
      aiUploadPrompt: 'If you already have the registry extract, upload it here and Homatch AI will analyze it.',
    },
  },
  debtorRegistry: {
    ka: {
      title: 'მოვალეთა რეესტრის დამატებითი გადამოწმება',
      reason: 'მოვალეთა რეესტრში შემოწმება ავტომატურად ვერ დასრულდა.',
      steps: ['გახსენით აღსრულების ეროვნული ბიუროს ოფიციალური გვერდი.', 'მოძებნეთ პირი/კომპანია სახელით ან საიდენტიფიკაციო კოდით.'],
      requestedDocument: 'მოვალეთა რეესტრის ცნობა',
      aiUploadPrompt: 'თუ უკვე გაქვთ ცნობა, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Additional debtor-registry verification',
      reason: 'The Debtor Registry check could not be completed automatically.',
      steps: ['Open the National Bureau of Enforcement official page.', 'Search for the person/company by name or identification code.'],
      requestedDocument: 'Debtor Registry certificate',
      aiUploadPrompt: 'If you already have the certificate, upload it here and Homatch AI will analyze it.',
    },
  },
  taxpayerStatus: {
    ka: {
      title: 'გადასახადის გადამხდელის სტატუსის გადამოწმება',
      reason: 'გადასახადის გადამხდელის სტატუსი საჯარო წყაროთი ავტომატურად ვერ დადასტურდა.',
      steps: ['გახსენით შემოსავლების სამსახურის ოფიციალური გვერდი.', 'მოძებნეთ საიდენტიფიკაციო კოდით.'],
      requestedDocument: 'ცნობა გადასახადის გადამხდელის სტატუსის შესახებ',
      aiUploadPrompt: 'თუ უკვე გაქვთ ცნობა, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Taxpayer-status verification',
      reason: 'Taxpayer status could not be automatically confirmed from a public source.',
      steps: ['Open the Revenue Service official page.', 'Search by identification code.'],
      requestedDocument: 'Taxpayer status certificate',
      aiUploadPrompt: 'If you already have the certificate, upload it here and Homatch AI will analyze it.',
    },
  },
  propertyEncumbrances: {
    ka: {
      title: 'საკუთრების უფლების უახლესი ამონაწერის გადამოწმება',
      reason: 'საკუთრების უფლებისა და შესაძლო შეზღუდვების უახლესი სტატუსი საჯარო წყაროთი სრულად ვერ დადასტურდა.',
      steps: ['გახსენით საჯარო რეესტრის ეროვნული სააგენტოს ოფიციალური გვერდი.', 'მოითხოვეთ უძრავი ქონების უახლესი ამონაწერი საკადასტრო კოდით.'],
      requestedDocument: 'უძრავი ქონების ამონაწერი (საკუთრება/შეზღუდვები)',
      aiUploadPrompt: 'თუ უკვე გაქვთ ამონაწერი, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Latest ownership-extract verification',
      reason: 'The latest ownership and encumbrance status could not be fully confirmed from public sources.',
      steps: ['Open the National Agency of Public Registry official page.', 'Request the current property extract using the cadastral code.'],
      requestedDocument: 'Property extract (ownership/encumbrances)',
      aiUploadPrompt: 'If you already have the extract, upload it here and Homatch AI will analyze it.',
    },
  },
  constructionPermissions: {
    ka: {
      title: 'მშენებლობის ნებართვის დამატებითი გადამოწმება',
      reason: 'მშენებლობის ნებართვის დოკუმენტი საჯარო წყაროთი ავტომატურად ვერ მოიძებნა.',
      steps: ['გახსენით მშენებლობის ნებართვების პორტალის ოფიციალური გვერდი.', 'მოძებნეთ საკადასტრო კოდით ან მისამართით.'],
      requestedDocument: 'მშენებლობის ნებართვა',
      aiUploadPrompt: 'თუ უკვე გაქვთ ნებართვის დოკუმენტი, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Additional construction-permit verification',
      reason: 'A construction permit document could not be automatically located from a public source.',
      steps: ['Open the Construction Permits Portal official page.', 'Search using the cadastral code or address.'],
      requestedDocument: 'Construction permit',
      aiUploadPrompt: 'If you already have the permit document, upload it here and Homatch AI will analyze it.',
    },
  },
  commissioning: {
    ka: {
      title: 'ექსპლუატაციაში მიღების დამატებითი გადამოწმება',
      reason: 'ობიექტის ექსპლუატაციაში მიღების ოფიციალური აქტი საჯარო წყაროთი ავტომატურად ვერ მოიძებნა — ფიზიკური დასრულება არ ნიშნავს ავტომატურად ოფიციალურ ექსპლუატაციაში მიღებას.',
      steps: ['გახსენით მშენებლობის ნებართვების პორტალის ოფიციალური გვერდი.', 'მოძებნეთ ობიექტის ექსპლუატაციაში მიღების აქტი საკადასტრო კოდით.'],
      requestedDocument: 'ექსპლუატაციაში მიღების აქტი',
      aiUploadPrompt: 'თუ უკვე გაქვთ აქტი, ატვირთეთ ის აქ და Homatch AI გაანალიზებს.',
    },
    en: {
      title: 'Additional commissioning verification',
      reason: 'An official commissioning/completion act could not be automatically located from a public source — physical completion does not by itself mean official commissioning.',
      steps: ['Open the Construction Permits Portal official page.', 'Search for the commissioning act using the cadastral code.'],
      requestedDocument: 'Commissioning/completion act',
      aiUploadPrompt: 'If you already have the act, upload it here and Homatch AI will analyze it.',
    },
  },
};
const CATEGORY_TO_PORTAL: Record<keyof LegalStatusMatrix, string> = {
  companyRegistration: 'enreg',
  debtorRegistry: 'debtor',
  taxpayerStatus: 'rstax',
  propertyEncumbrances: 'napr',
  constructionPermissions: 'tas',
  commissioning: 'tas',
};
// buildManualVerificationActions() (mandate item 8, addendum Sections 1-3):
// one card per unresolved category from the legal status matrix — never a
// bare "not confirmed" label with no path forward. A category that already
// reached CONFIRMED_POSITIVE or CONFIRMED_ATTENTION never gets a card here
// (ATTENTION items are already surfaced via materialAdverseFindings/
// riskFlags — a manual-verification card is for closing an evidence GAP,
// not for re-flagging an already-confirmed adverse finding).
function buildManualVerificationActions(matrix: LegalStatusMatrix, lang: string): ManualVerificationAction[] {
  const l = MANUAL_ACTION_COPY_I18N.companyRegistration[lang] ? lang : 'en';
  const out: ManualVerificationAction[] = [];
  for (const category of Object.keys(matrix) as (keyof LegalStatusMatrix)[]) {
    const entry = matrix[category];
    if (entry.status !== 'NOT_CONFIRMED' && entry.status !== 'HUMAN_VERIFICATION_REQUIRED') continue;
    const copy = MANUAL_ACTION_COPY_I18N[category][l] || MANUAL_ACTION_COPY_I18N[category].en;
    const portalKey = CATEGORY_TO_PORTAL[category];
    const portal = OFFICIAL_PORTAL[portalKey];
    out.push({
      id: category,
      title: copy.title,
      reason: copy.reason,
      steps: copy.steps,
      requestedDocument: copy.requestedDocument,
      officialPortalUrl: portal?.url || null,
      officialPortalLabel: portal ? portal.label[l] || portal.label.en : null,
      aiUploadPrompt: copy.aiUploadPrompt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// CustomerLinkValidation (addendum Sections 1-2): every customer-facing
// clickable link — including an OFFICIAL GOVERNMENT portal link inside a
// manual-verification card — must be live-verified before it is ever
// rendered; a dead/unreachable link must be hidden, never shown broken.
// This is deliberately scoped to the small, FIXED set of OFFICIAL_PORTAL
// URLs above (see buildManualVerificationActions()) — no other
// customer-facing clickable link currently exists anywhere else in this
// report (comparables/sources never render `url` to the customer; see
// CUSTOMER_REPORT_STRIP_KEYS), so there is nothing else to validate yet.
// A short in-memory TTL cache avoids re-checking the same handful of
// government homepages on every single job completion in a warm isolate.
const PORTAL_LINK_CACHE = new Map<string, { ok: boolean; checkedAt: number }>();
const PORTAL_LINK_CACHE_TTL_MS = 10 * 60 * 1000;
async function validateCustomerLink(url: string): Promise<boolean> {
  const cached = PORTAL_LINK_CACHE.get(url);
  if (cached && Date.now() - cached.checkedAt < PORTAL_LINK_CACHE_TTL_MS) return cached.ok;
  let ok = false;
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000) });
    // This only catches the unambiguous, addendum-named cases (network
    // failure, 404/410, 5xx) — it cannot see through a government page
    // that still responds 200 with a generic error shell.
    ok = r.status < 400;
  } catch {
    ok = false;
  }
  PORTAL_LINK_CACHE.set(url, { ok, checkedAt: Date.now() });
  return ok;
}
/** Applies validateCustomerLink() to every action's officialPortalUrl in
 * parallel; a card whose link fails validation keeps its
 * title/reason/steps/requestedDocument/aiUploadPrompt but loses the link —
 * it is never simply dropped, since the manual-verification guidance
 * itself is still valid even when this run could not confirm the portal is
 * currently reachable. */
async function applyLinkValidation(actions: ManualVerificationAction[]): Promise<ManualVerificationAction[]> {
  return Promise.all(
    actions.map(async (a) => {
      if (!a.officialPortalUrl) return a;
      const ok = await validateCustomerLink(a.officialPortalUrl);
      return ok ? a : { ...a, officialPortalUrl: null, officialPortalLabel: null };
    })
  );
}

function computeOverallAssessment(
  gatedConfidence: 'HIGH' | 'MEDIUM' | 'LOW',
  coverage: any,
  riskFlags: { severity: 'LOW' | 'MEDIUM' | 'HIGH'; description: string }[],
  minorConflictsCount: number,
  materialAdverseFindingsCount: number,
  itemsToVerifyCount: number,
  keyStrengthsCount: number
): OverallAssessmentLevel {
  const mediumRisks = riskFlags.filter((r) => r.severity === 'MEDIUM').length;
  // ATTENTION_REQUIRED: the ONLY level driven by materialAdverseFindings —
  // an actual evidenced adverse fact (a real restriction, a debtor record,
  // a company not in active status, a genuinely material conflict, or a
  // HIGH-severity risk). Never triggered by a merely-missing document.
  if (materialAdverseFindingsCount >= 1) {
    return 'ATTENTION_REQUIRED';
  }
  // NEUTRAL_MIXED: no material adverse finding, but real friction/noise in
  // the evidence itself (several medium risks, several ordinary marketing
  // discrepancies, or thin coverage combined with low confidence).
  if (mediumRisks >= 2 || minorConflictsCount >= 2 || (coverage.level === 'LIMITED' && gatedConfidence === 'LOW')) {
    return 'NEUTRAL_MIXED';
  }
  const clean = riskFlags.length === 0 && minorConflictsCount === 0;
  // VERY_POSITIVE: strong confirmed identity, comprehensive coverage,
  // multiple official sources actually retrieved, several key strengths,
  // and nothing at all left for the customer to verify.
  if (gatedConfidence === 'HIGH' && coverage.level === 'HIGH' && coverage.officialSourcesRetrieved >= 2 && clean && itemsToVerifyCount === 0 && keyStrengthsCount >= 3) {
    return 'VERY_POSITIVE';
  }
  // POSITIVE: strong confirmed identity, at least one official source
  // actually retrieved, coverage not LIMITED, clean evidence, and nothing
  // left for the customer to verify before a transaction.
  if (gatedConfidence === 'HIGH' && coverage.officialSourcesRetrieved > 0 && coverage.level !== 'LIMITED' && clean && itemsToVerifyCount === 0) {
    return 'POSITIVE';
  }
  // GENERALLY_POSITIVE: the common case — no adverse finding, no real
  // friction, but a handful of items still worth confirming before a
  // transaction (e.g. a document not yet retrieved). This is the default,
  // not a downgrade — most healthy reports land here.
  return 'GENERALLY_POSITIVE';
}

// ── Hard synthesis gate (unchanged from v18): a deterministic, code-level
// redaction of any narrative claim that looks like a specific structural
// identifier when NO structured field actually backs it up.
const STRUCTURED_CLAIM_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'CADASTRAL_CODE', re: /\b\d{1,6}(\.\d{1,6}){3,11}\b/g },
  { name: 'COMPANY_ENTITY_GEORGIAN', re: /შპს\s+[Ⴀ-ჿ"'0-9A-Za-z._-]+/gi },
  { name: 'COMPANY_ENTITY_LATIN', re: /\b(?:LLC|LTD|INC|JSC)\.?\s+[A-Za-z0-9._-]+/gi },
  { name: 'DEVELOPER_CLAIM', re: /(?:developer|დეველოპერი)\s*[:：]\s*\S+/gi },
  { name: 'PROJECT_CLAIM', re: /(?:project|პროექტი)\s*[:：]\s*\S+/gi },
];
function hasStructuredIdentity(i: any, reconciled?: any): boolean {
  const p = i?.identifiedParent || {};
  const proj = i?.project || {};
  if (p && (p.code || p.project || p.address || p.developer)) return true;
  if (proj && (proj.name || proj.address || proj.developer)) return true;
  // v25: a reconciled identity promoted to MEDIUM or HIGH confidence (see
  // reconcileIdentity() below) also licenses the narrative to name a
  // project/developer — a LOW/single-source mention does not, matching the
  // mandate's own confidence ladder.
  if (reconciled && ['MEDIUM', 'HIGH'].includes(reconciled.confidence) && (reconciled.project || reconciled.address || reconciled.developer)) return true;
  return false;
}
function hasStructuredCompany(o: any): boolean {
  const cp = o?.companyProfile;
  return !!(cp && (cp.name || cp.idCode));
}

// reconcileIdentity() (v25, mandate sections 4/5 — the cross-stage entity
// reconciliation layer). Candidate project/address/developer values arrive
// from three places that never previously talked to each other:
//   - IDENTITY's own `project` object (identity.project.name/address/developer)
//   - OFFICIAL's `companyProfile` (a developer/legal-company name, if found)
//   - MARKET's comparables, each of which may independently name a
//     project/address (e.g. several distinct listing sites each saying
//     "Villion, Krtsanisi St 6")
// Each candidate is tagged with its source hostname (or 'identity'/
// 'official' for the non-web stages) so independence can actually be
// counted — three listings on the SAME portal are one source, not three.
// Promotion follows the mandate's own ladder exactly:
//   HIGH   — IDENTITY/OFFICIAL already states it directly (authoritative-ish,
//            since those stages are gated by their own evidence rules), OR
//            >=2 INDEPENDENT sources agree on the same normalized
//            project+address pair.
//   MEDIUM — >=2 independent sources agree on just the project OR just the
//            address, or exactly one independent market source agrees with
//            an IDENTITY-stage lead that was itself only LOW/ungated.
//   LOW    — a single, unconfirmed mention with nothing else agreeing.
// Every promoted field keeps `provenance`: the list of {source,url} that
// backed it — never a bare invented number.
function reconcileIdentity(i: any, o: any, mr: any): any {
  type Candidate = { project: string | null; address: string | null; developer: string | null; source: string; url: string | null };
  const candidates: Candidate[] = [];
  const proj = i?.project;
  if (proj && (proj.name || proj.address || proj.developer)) {
    candidates.push({ project: proj.name || null, address: proj.address || null, developer: proj.developer || proj.developerCompany || null, source: 'identity', url: null });
  }
  const cp = o?.companyProfile;
  if (cp && cp.name) {
    candidates.push({ project: null, address: null, developer: cp.name, source: 'official', url: null });
  }
  for (const c of mr?.market?.comparables || []) {
    if (!c || (!c.project && !c.address)) continue;
    let host = 'market';
    try {
      host = c.url ? new URL(c.url).hostname.replace(/^www\./i, '') : 'market';
    } catch {
      /* keep default host label */
    }
    candidates.push({ project: c.project || null, address: c.address || null, developer: null, source: host, url: c.url || null });
  }
  if (!candidates.length) return null;

  const byIndependentSource = (pick: (c: Candidate) => string | null) => {
    const groups = new Map<string, { value: string; sources: Set<string>; items: Candidate[] }>();
    for (const c of candidates) {
      const v = pick(c);
      if (!v) continue;
      const key = normalizeLoose(v);
      if (!key) continue;
      const g = groups.get(key) || { value: v, sources: new Set<string>(), items: [] };
      g.sources.add(c.source);
      g.items.push(c);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.sources.size - a.sources.size)[0] || null;
  };
  const projectGroup = byIndependentSource((c) => c.project);
  const addressGroup = byIndependentSource((c) => c.address);
  const developerGroup = byIndependentSource((c) => c.developer);

  const directFromGatedStage = !!(proj?.name || proj?.address || proj?.developer || (cp && cp.name));
  // HIGH requires project AND address to EACH independently have >=2
  // agreeing sources — not merely that the (single-source) top project
  // candidate happens to belong to the same candidate pool as a
  // well-agreed address. Two sources naming the same address but disagreeing
  // on the project's exact name/wording is a MEDIUM signal, not HIGH.
  const bothAgree = (projectGroup?.sources.size || 0) >= 2 && (addressGroup?.sources.size || 0) >= 2;
  const independentAgreementCount = Math.max(projectGroup?.sources.size || 0, addressGroup?.sources.size || 0, developerGroup?.sources.size || 0);

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (directFromGatedStage || (bothAgree && independentAgreementCount >= 2) || independentAgreementCount >= 3) confidence = 'HIGH';
  else if (independentAgreementCount >= 2) confidence = 'MEDIUM';

  const provenanceOf = (g: { items: Candidate[] } | null) => (g ? dedupe(g.items.map((it) => ({ source: it.source, url: it.url })).filter((p) => p.source), (p) => `${p.source}:${p.url || ''}`) : []);
  return {
    project: projectGroup?.value || proj?.name || null,
    address: addressGroup?.value || proj?.address || null,
    developer: developerGroup?.value || cp?.name || proj?.developer || null,
    confidence,
    independentSourceCount: independentAgreementCount,
    provenance: {
      project: provenanceOf(projectGroup),
      address: provenanceOf(addressGroup),
      developer: provenanceOf(developerGroup),
    },
  };
}

function applyEvidenceGate(result: any, identity: any, official: any, reconciled?: any): any {
  const structuredOk = hasStructuredIdentity(identity, reconciled) || hasStructuredCompany(official);
  if (structuredOk || typeof result.summary !== 'string') return result;
  const reasons: string[] = [];
  let summary = result.summary;
  for (const { name, re } of STRUCTURED_CLAIM_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(summary)) {
      reasons.push(name);
      re.lastIndex = 0;
      summary = summary.replace(re, '[REDACTED — not backed by structured evidence]');
    }
  }
  if (reasons.length) {
    result.summary = summary;
    result.narrativeEvidenceGateApplied = true;
    result.narrativeEvidenceGateReasons = reasons;
    result.unverified = [...(result.unverified || []), 'The narrative summary referenced specific property/company identifiers that are NOT present in any structured, evidence-backed field — those specific claims were redacted pending direct evidence.'];
  }
  return result;
}

async function finish(sb: any, j: any, s: Stage, p: any, l: string): Promise<any> {
  const z = parse(extractOpenAIText(p));
  const sources = extractOpenAISources(p);
  const prior = j.result_json || {};
  const ev = await resolveSourceUrls(dedupe([...(j.evidence_bundle || []), ...sources], (x) => x.url));
  prior._cost = { ...(prior._cost || {}), [s.toLowerCase()]: p?.usage || null };

  if (s === 'IDENTITY') {
    prior.identity = z;
    return sb.from('research_jobs').update({ status: 'CREATED', stage: 'BROWSER_READY', response_id: null, result_json: prior, evidence_bundle: ev, progress: { phase: 'identity_complete', percent: 28 }, updated_at: now() }).eq('id', j.id);
  }
  if (s === 'OFFICIAL_COLLECTION') {
    // tasTechnicalFacts (2026-09-07 mandate): attach the deterministic,
    // code-computed aggregation (never the model's own self-report) so it
    // survives independently of whatever the model chose to weave into
    // prose, and so PUBLIC_RESEARCH/SYNTHESIS and the final customer report
    // can all reference the SAME ground-truth list rather than each stage
    // re-deriving its own partial view of it.
    prior.official = { ...z, tasTechnicalFacts: aggregateTasTechnicalFacts(prior.browserOfficial) };
    // v19: route through ENREG_CHECK_PENDING instead of straight to
    // PUBLIC_RESEARCH_READY so advance() gets a chance to trigger the
    // closed-loop entity ENREG/RS/Debtor chain for OFFICIAL_COLLECTION's own
    // discovered company BEFORE public research begins — "official evidence
    // MUST finish first" (2026-09-06 pipeline mandate).
    return sb.from('research_jobs').update({ status: 'CREATED', stage: 'ENREG_CHECK_PENDING', response_id: null, result_json: prior, evidence_bundle: ev, documents: z.documents || [], progress: { phase: 'official_complete', percent: 55 }, updated_at: now() }).eq('id', j.id);
  }
  if (s === 'PUBLIC_RESEARCH') {
    // normalizePublicResearchStructured() (see its own comment) guarantees
    // every one of the mandate's ~35 fields is present as null/[] — "no
    // evidence = null/[]", never a stray partial shape the rest of the
    // pipeline (pickFinancialCandidate, MARKET's prompt, SYNTHESIS) has to
    // guess about.
    prior.publicResearch = normalizePublicResearchStructured(z);
    // Route through PUBLIC_RESEARCH_CHECK_PENDING so advance() gets a chance
    // to run the mandate's second entity-discovery trigger — "If
    // PublicResearch finds ONE new strongly-supported company ID not already
    // checked: ENREG -> RS -> DEBTOR once only, then continue to MARKET" —
    // before MARKET research begins.
    return sb.from('research_jobs').update({ status: 'CREATED', stage: 'PUBLIC_RESEARCH_CHECK_PENDING', response_id: null, result_json: prior, evidence_bundle: ev, progress: { phase: 'public_research_complete', percent: 66 }, updated_at: now() }).eq('id', j.id);
  }
  if (s === 'MARKET') {
    prior.marketResearch = z;
    // v25: run cross-stage reconciliation as soon as MARKET's own evidence
    // is in (see reconcileIdentity() above) — this is what lets a
    // project/developer that only became clear from market comparables
    // reach both the SYNTHESIS prompt and the final result's evidence gate,
    // instead of staying invisible to hasStructuredIdentity() the way it did
    // before this version.
    prior.reconciledIdentity = reconcileIdentity(prior.identity, prior.official, prior.marketResearch);
    // Route through RECONCILIATION_CHECK_PENDING instead of straight to
    // SYNTHESIS_READY so advance() gets a chance to trigger a secondary
    // ENREG lookup for a developer/company that reconciliation just promoted
    // but OFFICIAL's own companyProfile never named (mandate section 6's
    // "MARKET discovers Millennio Group" example).
    return sb.from('research_jobs').update({ status: 'CREATED', stage: 'RECONCILIATION_CHECK_PENDING', response_id: null, result_json: prior, evidence_bundle: ev, progress: { phase: 'market_complete', percent: 84 }, updated_at: now() }).eq('id', j.id);
  }

  // SYNTHESIS
  const i = prior.identity || {};
  const o = prior.official || {};
  const mr = prior.marketResearch || {};
  const oc = ev.filter((x: any) => String(x.evidenceLevel).startsWith('OFFICIAL')).length;
  const wc = ev.length - oc;
  // normalizeConflicts() (v36): SYNTHESIS/OFFICIAL now emit
  // {description,severity} objects (see CONFLICT SEVERITY RULE above), but
  // this defensively accepts a legacy bare string too (treated as MINOR —
  // never inflate an unclassified entry into something that could drive
  // ATTENTION_REQUIRED).
  const normalizeConflicts = (raw: any[]): { description: string; severity: 'MATERIAL' | 'MINOR' }[] =>
    (raw || [])
      .map((c: any) => (typeof c === 'string' ? { description: c, severity: 'MINOR' as const } : { description: String(c?.description || ''), severity: c?.severity === 'MATERIAL' ? ('MATERIAL' as const) : ('MINOR' as const) }))
      .filter((c) => c.description.trim());
  const zConflictsNorm = normalizeConflicts(z.conflicts);
  const numericConfidence = Math.min(95, Math.max(20, 35 + oc * 10 + Math.min(wc, 5) * 5 - zConflictsNorm.filter((c) => c.severity === 'MATERIAL').length * 15 - zConflictsNorm.filter((c) => c.severity === 'MINOR').length * 5));
  const officialStatus = officialVerificationSummary(prior.browserOfficial);
  const officialDocs = officialDocuments(prior.browserOfficial);
  // technicalFacts (2026-09-07 gap fix — "TAS technical facts as PRIMARY
  // evidence... must survive all the way to synthesis AND UI"):
  // aggregateTasTechnicalFacts() output was already fed to the SYNTHESIS
  // prompt as PRIMARY guidance text (see prompt()'s "TAS/OFFICIAL DOCUMENT
  // TECHNICAL FACTS ALREADY CONFIRMED" block), but that is the ONLY path it
  // had to the customer — whether a specific fact actually appeared in the
  // final officialEvidence/facts prose depended entirely on the SYNTHESIS
  // model choosing to mention it. officialDocuments() (customer-facing
  // document list) never carried the per-document technicalFacts through
  // either. This exposes the same deterministic, code-computed facts as
  // their own guaranteed report field — never re-derived or re-worded by
  // the model — so a confirmed technical fact cannot be silently dropped by
  // an LLM summarization choice. No document URL is included: per the
  // established "comparables/sources never render `url` to the customer"
  // policy (see CUSTOMER_REPORT_STRIP_KEYS and its own comment below), this
  // stays consistent with every other structured evidence field in this
  // report — only documentTitle/documentDate (plain text, not a link)
  // travels with each fact.
  const technicalFacts = (Array.isArray(o.tasTechnicalFacts) ? o.tasTechnicalFacts : []).map((f: any) => ({ category: f.category, key: f.key, value: f.value, confidence: f.confidence, documentTitle: f.documentTitle || null, documentDate: f.documentDate || null, block: f.block || null }));
  // revisionTimeline (2026-09-07 "ProjectRevision/block-structure" mandate
  // item): see buildRevisionTimeline()'s own comment — null unless at least
  // two of this job's own official documents carry two different known
  // dates; never a fabricated single-entry chronology. No document URL,
  // same policy as technicalFacts above.
  const revisionTimeline = buildRevisionTimeline(Array.isArray(o.tasTechnicalFacts) ? o.tasTechnicalFacts : []);
  const identityConfidence = z.entity?.confidence || i.entity?.confidence || 'LOW';
  const gatedConfidence = overallConfidence(identityConfidence, officialStatus, officialDocs);
  const note = coverageNote(officialStatus, l);
  // v25: semantic dedupe (mandate section 20) — group near-duplicate risk
  // descriptions by keyword overlap before the exact-string dedupe that
  // already existed, so "official commissioning not confirmed" phrased
  // slightly differently by MARKET vs SYNTHESIS collapses to one entry.
  const riskFlags = semanticDedupe(
    dedupe([...(mr.riskFlags || []), ...(z.riskFlags || [])].filter((x: any) => ['MEDIUM', 'HIGH'].includes(x?.severity)), (x: any) => `${x.severity}:${x.description}`),
    (x: any) => String(x?.description || '')
  );
  const reconciledIdentity = prior.reconciledIdentity || reconcileIdentity(i, o, mr);
  let rawCompanyProfile = z.companyProfile || o.companyProfile || null;
  // 2026-09-07 Verify mandate ("market/public evidence can know
  // [a developer] while top-level projectProfile remains blank" —
  // companyProfile has the equivalent gap): pickFinancialCandidate()
  // already triggers a real ENREG lookup for a developer reconciliation
  // promotes to MEDIUM/HIGH confidence (see that function's own comment),
  // so the common case is already fixed by the time SYNTHESIS runs here.
  // This covers the remaining terminal case — that ENREG lookup genuinely
  // ran and came back with no matching registry record (a foreign company,
  // an informal/trade name, or a real name mismatch), or was never
  // triggered for some other reason — so companyProfile would otherwise
  // stay entirely null while projectProfile.developer (below) already
  // shows the name. Never fabricates registry data: only the name itself,
  // explicitly marked WEB_RESEARCH_ONLY with its own reconciliation
  // provenance, so the frontend can show the same developer consistently
  // in both places instead of a populated project card next to an empty
  // company-profile card.
  if ((!rawCompanyProfile || !(rawCompanyProfile.name || rawCompanyProfile.idCode)) && reconciledIdentity?.developer && ['MEDIUM', 'HIGH'].includes(reconciledIdentity.confidence)) {
    rawCompanyProfile = { name: reconciledIdentity.developer, idCode: null, legalForm: null, registrationDate: null, status: null, directors: [], representatives: [], historicalChanges: [], relatedProjects: [], summary: null, reconciledFromMarketEvidence: true };
  }
  // v23: attach a deterministic sourceBasis so the frontend can visibly
  // distinguish registry-confirmed company facts from web-research-derived
  // ones (see companyProfileSourceBasis above) — never inferred from the
  // model's own self-report.
  const companyProfile = rawCompanyProfile ? { ...rawCompanyProfile, sourceBasis: companyProfileSourceBasis(rawCompanyProfile, prior.browserOfficial) } : null;
  const unverifiedAll = semanticDedupe(dedupe([...(i.unverified || []), ...(o.unverified || []), ...(mr.unverified || []), ...(z.unverified || [])], (x: any) => x), (x: any) => String(x || ''));
  const conflictsAll = semanticDedupe(
    dedupe([...normalizeConflicts(o.conflicts), ...zConflictsNorm], (x) => `${x.severity}:${x.description}`),
    (x) => x.description
  );
  const materialConflicts = conflictsAll.filter((c) => c.severity === 'MATERIAL');
  const minorConflicts = conflictsAll.filter((c) => c.severity === 'MINOR');
  // debtorRecordFound (v36): the one genuinely adverse signal this pipeline
  // can detect deterministically from the MyGov Debtor Registry adapter's
  // own terminal state — SEARCH_CONFIRMED means the exact-identifier search
  // found a matching debtor record (NO_RESULT_CONFIRMED is the positive,
  // non-adverse case and never reaches here). Never inferred from prose.
  const debtorRecordFound = (prior.browserOfficial?.results || []).some((r: any) => r.source === 'debtor' && r.status === 'SEARCH_CONFIRMED');
  // rightsAndRestrictions (v21, mandate: seizure/attachment is transaction-
  // critical — "no restriction found" and "not yet checked" must never be
  // collapsed into the same sentence, and neither may ever become "clean" /
  // "guaranteed free of restrictions").
  const rr = o.rightsAndRestrictions || null;
  const rrStatus = rr?.status || 'NOT_CONFIRMED';
  const rightsAndRestrictions = {
    status: rrStatus,
    items: rr?.items || [],
    statement:
      rrStatus === 'RESTRICTION_IDENTIFIED'
        ? ''
        : rrStatus === 'NONE_FOUND_IN_CHECKED_SOURCE'
        ? (RR_NONE_FOUND_I18N[l] || RR_NONE_FOUND_I18N.en)(now())
        : RR_NOT_CONFIRMED_I18N[l] || RR_NOT_CONFIRMED_I18N.en,
    asOf: now(),
  };
  const coverage = dueDiligenceCoverage(officialStatus, officialDocs, companyProfile, { comparables: sanitizeComparables(mr.market?.comparables || []) }, ev, conflictsAll, unverifiedAll, prior.browserOfficial);
  const companyLiquidation = companyLiquidationSuspected(companyProfile);
  const materialAdverseFindings = computeMaterialAdverseFindings(riskFlags, materialConflicts, rightsAndRestrictions, debtorRecordFound, companyLiquidation, l);
  // legalStatus / manualVerificationActions (mandate item 16 + item 8,
  // addendum Sections 1-3): replaces the single hardcoded
  // `requiresManualVerification: false` below with a real, per-category
  // evidence matrix plus one concrete action card for every category that
  // did not reach a confirmed state.
  const legalStatus = buildLegalStatusMatrix(officialStatus, { officialDocs, companyLiquidationSuspected: companyLiquidation.suspected, debtorRecordFound, rightsAndRestrictionsStatus: rrStatus }, l);
  const manualVerificationActions = await applyLinkValidation(buildManualVerificationActions(legalStatus, l));

  // overallAssessment (v30): keyStrengths/itemsToVerify are the model's own
  // authored lists (bound by the SYNTHESIS prompt's KEY STRENGTHS/ITEMS TO
  // VERIFY instructions above — each entry must already be traceable to a
  // fact/officialEvidence/publicEvidence item), deduped and capped here in
  // code. A genuinely unresolved rights/restrictions or official-status gap
  // must never silently vanish from the report just because the model's own
  // list happened to omit it — so we guarantee at least one mention of it
  // here if the model didn't already include an equivalent item, without
  // ever inflating the list with padding.
  const keyStrengths = dedupe((z.keyStrengths || []).filter((x: any) => typeof x === 'string' && x.trim()), (x: string) => x.trim().toLowerCase()).slice(0, 5);
  let itemsToVerify = dedupe((z.itemsToVerify || []).filter((x: any) => typeof x === 'string' && x.trim()), (x: string) => x.trim().toLowerCase()).slice(0, 4);
  const rightsGapAlreadyMentioned = itemsToVerify.some((x: string) => /restrict|mortgage|encumbr|rights|commission|ownership|შეზღუდვ|რეგისტრაც|დამძიმებ|საკუთრებ|ექსპლუატაცი/i.test(x));
  if (rightsAndRestrictions.status === 'NOT_CONFIRMED' && !rightsGapAlreadyMentioned) {
    itemsToVerify = [...itemsToVerify, UNRESOLVED_RIGHTS_GAP_I18N[l] || UNRESOLVED_RIGHTS_GAP_I18N.en].slice(0, 4);
  }
  const overallAssessment = {
    level: computeOverallAssessment(gatedConfidence, coverage, riskFlags, minorConflicts.length, materialAdverseFindings.length, itemsToVerify.length, keyStrengths.length),
    keyStrengths,
    itemsToVerify,
  };

  let result: any = {
    status: 'OK',
    jobId: j.id,
    queryType: j.mode,
    entityName: z.entity?.name || i.entity?.name || j.query,
    entityType: z.entity?.type || i.entity?.type || 'UNKNOWN',
    // v28: evidence-classified, not guessed (see IDENTITY prompt's ASSET
    // CLASS instruction) — lets the frontend/AI-chat follow-up know why a
    // report has no companyProfile/utilitiesMatrix/landProfile section
    // without that ever being phrased as a finding in itself.
    assetClass: i.assetClass || null,
    entityConfidence: identityConfidence,
    overallConfidence: gatedConfidence,
    dueDiligenceCoverage: coverage,
    confidence: numericConfidence,
    summary: z.executiveSummary || '',
    coverageNote: note,
    overallAssessment,
    rightsAndRestrictions,
    officialVerificationComplete: officialStatus.officialVerificationComplete,
    officialSourcesChecked: officialStatus.officialSourcesChecked,
    officialSourcesConfirmedFound: officialStatus.officialSourcesConfirmedFound,
    officialSourcesConfirmedNoResult: officialStatus.officialSourcesConfirmedNoResult,
    officialSourcesNotVerified: officialStatus.officialSourcesNotVerified,
    officialSourcesSkipped: officialStatus.officialSourcesSkipped,
    officialSourcesPartiallyTraversed: officialStatus.officialSourcesPartiallyTraversed,
    // v26 (superseded 2026-09-06 by explicit product requirement — see
    // sanitizeForCustomer() below): originally a customer-safe per-source
    // status list built from officialSourceCoverage() (only the 6-value
    // customerStatus enum + display name), meant to let the frontend show
    // "MS Map: Retrieved / TAS: Technical issue — not completed / My.gov:
    // Checked — no result" instead of a single opaque "1 official source
    // checked". Still computed and persisted here for internal/admin use
    // (result_json is unchanged), but the product requirement is that the
    // customer response must not expose which worker/provider produced a
    // finding at all — sanitizeForCustomer() now deletes this field
    // wholesale from the copy actually returned to the customer.
    officialSourceCoverage: officialSourceCoverage(prior.browserOfficial, l),
    identifiedParent: i.identifiedParent || null,
    // v25: for a cadastral-mode job, the exact unit code is deterministically
    // forced back to the literal user-supplied query — never Gemini's own
    // transcription of it — so the primary subject can never silently drift
    // toward an easier-to-find parent/base parcel (the mandate's other named
    // regression: 01.18.06.019.055.03.01.603 must never become
    // 01.18.06.019.055 in the report merely because evidence was easier to
    // find for the parent).
    exactUnit: j.mode === 'cadastral' ? { code: j.query, verified: !!i.exactUnit?.verified, note: i.exactUnit?.note || null } : i.exactUnit || null,
    building: i.building || null,
    // v25: reconciledIdentity (see reconcileIdentity() above) enriches the
    // IDENTITY-stage project profile with whatever MARKET corroborated,
    // WITHOUT overwriting a field IDENTITY itself already stated — this is
    // the direct fix for the blank Project/Address/Developer top-card case.
    // reconciledIdentity itself is also exposed separately (with
    // confidence+provenance) so the frontend can show why/how it was
    // resolved rather than presenting it as an unexplained fact.
    projectProfile: i.project || reconciledIdentity
      ? {
          ...(i.project || {}),
          name: i.project?.name || reconciledIdentity?.project || null,
          address: i.project?.address || reconciledIdentity?.address || null,
          developer: i.project?.developer || reconciledIdentity?.developer || null,
        }
      : null,
    reconciledIdentity,
    // discoveredEntities (mandate item 4 — "merge discovered ... entities
    // ... into the SAME existing ResearchContext/property model"): a
    // reduced, customer-safe shape (name + registry id only — never the
    // worker's own internal id/enregStatus/discoveredFrom bookkeeping).
    discoveredEntities: (prior.browserOfficial?.discoveredEntities || []).map((e: any) => ({ name: e?.name || null, identificationCode: e?.identificationCode || null })).filter((e: any) => e.name),
    utilitiesMatrix: i.utilitiesMatrix || null,
    landProfile: o.landProfile || null,
    companyProfile,
    // publicResearch (2026-09-06 pipeline mandate): the PUBLIC_RESEARCH
    // stage's own ~35-field structured object (architect, contractors,
    // construction quality/materials, chronology/current status,
    // reputation, amenities, etc.), normalized so every field is always
    // present as null/[] — safe to expose directly (no URLs live in this
    // schema; source URLs stay only in `sources`/evidence_bundle, per "keep
    // all source URLs internally only"). null when PUBLIC_RESEARCH never
    // ran (e.g. a job that failed before reaching that stage).
    publicResearch: prior.publicResearch || null,
    documents: o.documents || [],
    officialDocumentsRetrieved: officialDocs,
    // technicalFacts (see computation above): deterministic, PRIMARY,
    // never LLM-paraphrased — null (not []) when TAS/official documents
    // never yielded any structured technical fact, matching this schema's
    // established "null means no evidence, not an empty placeholder"
    // convention (see publicResearch below).
    technicalFacts: technicalFacts.length ? technicalFacts : null,
    revisionTimeline,
    historicalComparison: prior.browserOfficial?.historicalComparison || null,
    // priceDrivers (2026-09-06 "final alignment pass" mandate, extended by
    // the "report intelligence v2" addendum Section 8): positioning/
    // marketMedianPricePerSqm/premiumPct are now ALWAYS computed by
    // calculateMarketPosition()/median() (pure JS, above) from the real
    // numeric comparables the MARKET stage gathered — never LLM-estimated —
    // and, per the addendum, ONLY from comparables the model itself
    // evidenced as ACTIVE + RESIDENTIAL (see computeMarketRanges()'s own
    // comment): an expired/removed/sold listing can no longer silently
    // pull the "current" figure in either direction. startingPricePerSqm
    // (a developer's marketing "from" price) and historicalMedianPricePerSqm
    // (stale listings) are kept as their own separately labeled fields —
    // never collapsed into marketMedianPricePerSqm. `reasoning` stays
    // qualitative color the model supplies (priceDriverEvidence), never the
    // classification itself.
    market: (() => {
      const sanitizedComparables = sanitizeComparables(mr.market?.comparables || []);
      const ranges = computeMarketRanges(sanitizedComparables);
      const activeResidentialOnly = sanitizedComparables.filter((c: any) => c?.listingStatus === 'ACTIVE' && (!c?.propertyType || c.propertyType === 'RESIDENTIAL'));
      const subjectPriceType: string | null = mr.market?.subject?.priceType || null;
      const subjectPricePerSqm = parseNumericPricePerSqm(mr.market?.subject?.pricePerSqm);
      // A developer's marketing "starting from" price is never a current
      // market-position signal — only an actual current listing/sale price
      // (or an undeclared subject price, kept backward-compatible) is
      // compared against the active range.
      const positionTargetPrice = subjectPriceType === 'STARTING' ? null : subjectPricePerSqm;
      const marketPosition = calculateMarketPosition({ targetPricePerSqm: positionTargetPrice, comparables: activeResidentialOnly });
      return {
        priceEvidence: mr.market?.priceEvidence || [],
        comparables: sanitizedComparables,
        startingPricePerSqm: subjectPriceType === 'STARTING' && subjectPricePerSqm != null ? String(subjectPricePerSqm) : null,
        activeMinPricePerSqm: ranges.activeMinPricePerSqm != null ? String(ranges.activeMinPricePerSqm) : null,
        activeMedianPricePerSqm: ranges.activeMedianPricePerSqm != null ? String(ranges.activeMedianPricePerSqm) : null,
        activeMaxPricePerSqm: ranges.activeMaxPricePerSqm != null ? String(ranges.activeMaxPricePerSqm) : null,
        activeComparablesUsed: ranges.activeComparablesUsed,
        historicalMedianPricePerSqm: ranges.historicalMedianPricePerSqm != null ? String(ranges.historicalMedianPricePerSqm) : null,
        historicalComparablesUsed: ranges.historicalComparablesUsed,
        priceDrivers: {
          positioning: marketPosition.position,
          marketMedianPricePerSqm: marketPosition.marketMedianPricePerSqm != null ? String(marketPosition.marketMedianPricePerSqm) : null,
          premiumPct: marketPosition.premiumPct,
          comparablesUsed: marketPosition.comparablesUsed,
          reasoning: Array.isArray(mr.market?.priceDriverEvidence) ? mr.market.priceDriverEvidence : Array.isArray(mr.market?.priceDrivers?.reasoning) ? mr.market.priceDrivers.reasoning : [],
        },
      };
    })(),
    reviews: mr.reviews || null,
    officialEvidence: z.officialEvidence?.length ? z.officialEvidence : o.officialEvidence || [],
    publicEvidence: z.publicEvidence?.length ? z.publicEvidence : mr.publicEvidence || [],
    // conflicts/materialAdverseFindings (v36): kept in result_json for
    // internal/admin visibility only — the customer-facing report never
    // renders a raw "conflicts" list (see VerifyPage.tsx); the note text
    // here is now derived from the SAME materialAdverseFindings signal that
    // drives overallAssessment.level, so the two can never contradict each
    // other again.
    conflicts: conflictsAll,
    materialAdverseFindings,
    materialRisks: { riskFlags, note: materialAdverseFindings.length ? '' : MATERIAL_RISK_NONE_I18N[l] || MATERIAL_RISK_NONE_I18N.en },
    publicFindings: { riskFlags }, // kept for backward compatibility with older clients
    unverified: unverifiedAll,
    sources: ev,
    browserOfficial: prior.browserOfficial || null,
    // legalStatus / manualVerificationActions (mandate item 16 + item 8):
    // requiresManualVerification is now a REAL derived flag (true whenever
    // at least one category needs a human step or is genuinely unconfirmed)
    // instead of a permanently hardcoded false.
    legalStatus,
    manualVerificationActions,
    requiresManualVerification: manualVerificationActions.length > 0,
    researchProvider: 'openai+playwright',
    costUsage: prior._cost,
    stage: 'COMPLETE',
    searchedAt: now(),
  };
  result = applyEvidenceGate(result, i, o, reconciledIdentity);
  return sb.from('research_jobs').update({ status: 'COMPLETE', stage: 'COMPLETE', response_id: null, result_json: result, evidence_bundle: ev, progress: { phase: 'complete', percent: 100 }, completed_at: now(), updated_at: now(), error: null }).eq('id', j.id);
}

async function advance(sb: any, k: string, m: string, j: any, l: string): Promise<any> {
  try {
    if (j.status === 'CREATED' && j.stage === 'QUEUED') return await launch(sb, k, m, j, 'IDENTITY', l);
    if (j.status === 'CREATED' && j.stage === 'BROWSER_READY') return await startBrowser(sb, j);
    if (j.stage === 'BROWSER_WAITING') return await pollBrowser(sb, j);
    // Production execution path (2026-09-06 "Fix Homatch Verify by
    // implementing this exact pipeline in code" mandate): the browser-worker
    // steps (TasMapWorker -> TasDocumentWorker -> NaprPropertyWorker ->
    // EnregWorker -> RsTaxpayerWorker -> DebtorWorker, official-worker's own
    // cadastral-mode step order + EntityQueue-triggered financial chain —
    // see official-worker/src/orchestrator/ResearchContext.ts) all complete
    // inside ONE BROWSER_WAITING/pollBrowser() job before this reaches
    // OFFICIAL_READY at all — "official evidence MUST finish first" is
    // structural, not a scheduling hint. From here: OFFICIAL_COLLECTION (this
    // worker's OWN AI read of that evidence) -> its own enreg/rstax/debtor
    // closed-loop chain for whatever company IT found -> PUBLIC_RESEARCH (a
    // REAL stage) -> PUBLIC_RESEARCH's OWN enreg/rstax/debtor chain for a
    // NEW company IT found -> MARKET -> MARKET's reconciliation chain -> ONE
    // final SYNTHESIS (no web_search — see launch()'s `s !== 'SYNTHESIS'`).
    if (j.status === 'CREATED' && j.stage === 'OFFICIAL_READY') return await launch(sb, k, m, j, 'OFFICIAL_COLLECTION', l);
    // ENREG_CHECK_PENDING seeds the generalized financial queue (enreg ->
    // rstax -> debtor, see processFinancialQueue) for OFFICIAL_COLLECTION's
    // own discovered company. Destination is now PUBLIC_RESEARCH_READY, not
    // MARKET_READY — PUBLIC_RESEARCH is a real stage in between.
    if (j.status === 'CREATED' && j.stage === 'ENREG_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'debtor'];
      prior._financialReturnStage = 'PUBLIC_RESEARCH_READY';
      return await processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.stage === 'FINANCIAL_ENTITY_WAITING') return await pollFinancialEntity(sb, j);
    if (j.status === 'CREATED' && j.stage === 'PUBLIC_RESEARCH_READY') return await launch(sb, k, m, j, 'PUBLIC_RESEARCH', l);
    // PUBLIC_RESEARCH_CHECK_PENDING (2026-09-06 mandate): "If PublicResearch
    // finds ONE new strongly-supported company ID not already checked:
    // ENREG -> RS -> DEBTOR once only, then continue to MARKET." Same
    // processFinancialQueue()/pickFinancialCandidate() machinery as the
    // OFFICIAL_COLLECTION trigger above — alreadyHasResultFor() is what
    // actually enforces "not already checked" / "once only", so a company
    // already covered by the first chain is never looked up again here.
    if (j.status === 'CREATED' && j.stage === 'PUBLIC_RESEARCH_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'debtor'];
      prior._financialReturnStage = 'MARKET_READY';
      return await processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.status === 'CREATED' && j.stage === 'MARKET_READY') return await launch(sb, k, m, j, 'MARKET', l);
    // v25 (enreg-only) / v28 (generalized): the reconciliation-driven
    // secondary financial-queue trigger (mandate section 6's "MARKET
    // discovers Millennio Group" example) — runs after MARKET's own
    // finish() has already computed prior.reconciledIdentity. Never
    // re-triggers a lookup either earlier chain already ran (see
    // alreadyHasResultFor inside pickFinancialCandidate).
    if (j.status === 'CREATED' && j.stage === 'RECONCILIATION_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'debtor'];
      prior._financialReturnStage = 'SYNTHESIS_READY';
      return await processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.status === 'CREATED' && j.stage === 'SYNTHESIS_READY') return await launch(sb, k, m, j, 'SYNTHESIS', l);
    const a = String(j.stage || '').match(/^(IDENTITY|OFFICIAL_COLLECTION|PUBLIC_RESEARCH|MARKET|SYNTHESIS)_WAITING$/);
    if (!a || !j.response_id) return;
    // OpenAI Responses API statuses: queued/in_progress (poll again — falls
    // through both branches below, matching this function's existing
    // "no-op, caller re-polls later" behavior), completed, failed,
    // cancelled, incomplete.
    const p = await getOpenAIResponse(k, j.response_id);
    if (p.status === 'completed') return await finish(sb, j, a[1] as Stage, p, l);
    if (['failed', 'cancelled', 'incomplete'].includes(p.status)) throw new Error(`OpenAI ${p.status}: ${JSON.stringify(p?.error || p?.incomplete_details || '').slice(0, 300)}`);
  } catch (e) {
    const s = String(e);
    const legacyRetryable =
      /429|500|502|503|504|timeout|temporar/i.test(s);
    // Transient transport/session errors that happen while the worker state
    // is still unknown remain bounded-retryable here. A worker that explicitly
    // reports FAILED is handled inside pollBrowser() as unavailable official
    // research and continues through OFFICIAL_READY instead of reaching this
    // catch block.
    const transientBrowserSession = /target (page|frame|context|browser)|target closed|browsercontext\.|has been closed|session (closed|expired)|econnreset|socket hang up|browser has disconnected/i.test(s);
    const priorTransientRetries = Number(j.progress?.transientRetryCount) || 0;
    const MAX_TRANSIENT_RETRIES = 5;
    const retryTransient =
      transientBrowserSession &&
      priorTransientRetries < MAX_TRANSIENT_RETRIES;
    // Browser polling transport failures can happen before pollBrowser()
    // gets a worker response, so its normal watchdog cannot run.
    // Bound that failure mode using the same browser-job clock.
    const browserStartedAt = Date.parse(
      j.result_json?._worker?.startedAt || ''
    );
    const browserAgeMs = Number.isFinite(browserStartedAt)
      ? Date.now() - browserStartedAt
      : 0;
    const browserTransportExpired =
      j.stage === 'BROWSER_WAITING' &&
      browserStartedAt &&
      browserAgeMs > 12 * 60 * 1000 &&
      (legacyRetryable || transientBrowserSession);

    if (browserTransportExpired) {
      const p = j.result_json || {};
      p.browserOfficial = {
        ...(p.browserOfficial || {}),
        results: p.browserOfficial?.results || [],
        unavailable: true,
      };
      delete p._worker;

      return await sb
        .from('research_jobs')
        .update({
          status: 'CREATED',
          stage: 'OFFICIAL_READY',
          result_json: p,
          error: null,
          progress: {
            phase: 'official_browser_unavailable',
            percent: 40,
            retriable: false,
          },
          updated_at: now(),
        })
        .eq('id', j.id);
    }

    const retry = legacyRetryable || retryTransient;
    await sb
      .from('research_jobs')
      .update({
        status: retry ? 'CREATED' : 'FAILED',
        stage: retry ? j.stage || 'QUEUED' : 'FAILED',
        error: s,
        progress: { ...(j.progress || {}), retriable: retry, transientRetryCount: transientBrowserSession ? priorTransientRetries + 1 : 0 },
        updated_at: now(),
      })
      .eq('id', j.id);
  }
}

// sanitizeForCustomer() (v22, master due-diligence mandate — "CUSTOMER VS
// ADMIN: never expose internal enums/FSM states/selector failures/raw stack
// traces to the customer, only to admin diagnostics"). Prior rounds only
// removed these fields from what VerifyPage.tsx's own JSX *renders* (and from
// customerSafeReportForAi()'s AI-chat handoff) — but the raw HTTP response
// body for the 'status'/'resume'/'skip' action still carried the FULL
// `browserOfficial` object (raw TAS/MSMAP FSM state names like "TAS FSM
// reached ALL_RESULTS_EXHAUSTED", raw selector-failure diagnostics like
// "NO_SELECTOR_MATCHED_OR_CLICK_FAILED candidateCounts={...}", and internal
// confidence-heuristic strings), plus researchProvider/costUsage/internal
// worker bookkeeping — all visible to anyone opening the browser's Network
// tab, regardless of what the page chose to render. This strips those from
// `result_json` ONLY once the job has reached COMPLETE. It must NOT run for
// WAITING_HUMAN (or any other in-progress status): the frontend's CAPTCHA
// resume/skip flow reads result_json._worker.jobId, and advance()/pollBrowser
// read the very same internal fields back out of result_json on the NEXT
// invocation to keep driving the job — stripping them early would break the
// job, not just hide diagnostics from a finished one.
// sanitizeCustomerReport() (2026-09-06 "final alignment pass" mandate): the
// confirmed remaining gap after sanitizeForCustomer() above — that function
// only deletes whole TOP-LEVEL admin-only keys (browserOfficial, stage,
// etc.); it never reaches into customer-facing nested structures like
// market.comparables[], officialDocumentsRetrieved[], sources[], or
// documents[], each of which can carry raw source URLs and internal
// worker-attribution strings even though VerifyPage.tsx's own JSX chooses
// not to render them — visible to anyone opening the browser's Network tab
// regardless of what the page draws. This recursively walks the ENTIRE
// customer-facing object (arrays and plain objects only — it never
// descends into or mutates anything else) and deletes exactly the
// technical/URL-shaped keys named below, wherever they appear, however
// deeply nested.
//
// 2026-09-06 correction (explicit product requirement, same day as the
// pass above): the earlier version of this Set deliberately left `source`/
// `sourceName` out, reasoning that officialSourceCoverage()'s own
// customer-facing `source`/`sourceName` fields (a real, neutral, localized
// display name) would be broken by a blanket recursive strip. That
// exception was wrong — the customer report must communicate the actual
// findings, not which worker/provider produced them, and
// officialSourceCoverage is now deleted WHOLESALE at the top level in
// sanitizeForCustomer() below (it was already hidden from every rendered
// card per the v26 "CUSTOMER-VALUE CLEANUP" mandate, so removing the raw
// field from the HTTP payload too changes nothing the customer could see).
// With that field gone entirely, there is no remaining legitimate
// customer-facing use of `source`/`sourceName` left for this recursive
// strip to break, so both are now included below alongside every other
// raw-URL/worker-attribution field shape used anywhere in this schema
// (matching, on the server side, the exact same key set VerifyPage.tsx's
// own pre-existing stripUrlFields() already uses client-side for the
// AI-chat handoff — url/evidenceUrl/verificationUrl/linkLabel — so both
// paths agree on what "customer-safe" means), plus the purely internal/
// diagnostic fields (retrievalMethod, trace) that mean nothing to a
// customer and were never meant to cross the HTTP boundary at all.
// This only ever runs against a COPY of result_json built for the HTTP
// response (see sanitizeForCustomer() below) — it never touches what is
// persisted to the research_jobs row, so internal DB/admin evidence keeps
// every one of these fields unchanged.
const CUSTOMER_REPORT_STRIP_KEYS = new Set(['url', 'sourceUrl', 'finalUrl', 'startUrl', 'originalGroundingUrl', 'evidenceUrl', 'verificationUrl', 'linkLabel', 'retrievalMethod', 'trace', 'browserOfficial', 'source', 'sourceName']);

// ---------------------------------------------------------------------
// 2026-09 "report intelligence v2" mandate addendum, Sections 5/6/7/10/12:
// CUSTOMER_REPORT_STRIP_KEYS above only ever removed named KEYS from
// structured JSON — it never looked at the CONTENT of a string value, so a
// brand/domain name, a raw URL, or a technical-failure phrase the LLM wrote
// straight into a prose sentence (officialEvidence[], facts[], an
// executiveSummary, etc.) passed through completely unaffected. The prompt
// itself asks the model not to do this (BASE's "SOURCE-ANONYMITY RULE"),
// but the addendum is explicit: "Do not rely on sanitizer alone" for the
// generation side, AND "do not rely on the prompt alone" for the sanitizer
// side either — this is the second, code-level layer that does not depend
// on model compliance.
//
// Ordinary public-research provider/platform names that must never reach
// the customer, whatever field or sentence they appear in (the one
// exception — an official GOVERNMENT portal named inside a manual
// verification action — is handled separately by buildManualVerificationActions()
// and is never routed through this generic prose stripper).
// Trailing `(?:-[ა-ჰ]+)?` consumes a Georgian grammatical case suffix
// glued directly onto a foreign brand name with a hyphen — a very common
// pattern in Georgian prose ("Facebook-ზე" = "on Facebook", "Korter-ზე" =
// "on Korter") — so the whole glued token is removed as one leak, never
// leaving an orphaned "-ზე" fragment behind. The trailing boundary is a
// negative lookahead for a following ASCII letter/digit (never `\b`,
// which — per this file's own established Georgian-`\b` bug pattern
// elsewhere — does not reliably bound against adjacent Georgian text).
const FORBIDDEN_SOURCE_NAME_RE =
  /\b(myhome(?:\.ge)?|ss\.ge|home\.ge|korter(?:\.ge)?|estatehub(?:\.ge)?|villion\.ge|place\.ge|livo\.ge|myestate\.ge|address\.ge|lalafo(?:\.ge)?|OLX|LinkedIn|Facebook|Instagram|YouTube|Google(?:\s+Search)?|OpenAI)(?:-[ა-ჰ]+)?(?![a-zA-Z0-9])/gi;

// Internal worker/FSM/technical vocabulary that must never reach a customer
// payload (addendum Section 5) — matched as whole phrases/tokens so it
// cannot accidentally eat an unrelated Georgian sentence.
const TECHNICAL_LEAK_RE =
  /\b(iframe not found|SUBMIT_FAILED|SEARCH_CONTROL_NOT_FOUND|FRAME_NOT_FOUND|WAITING_HUMAN|SKIPPED_HUMAN_VERIFICATION|worker failed|technical failure|illegal transition|IllegalTransitionError|selector not found|browser error|Playwright|FSM state|FSM|source coverage|worker status|NO_RESULT_CONFIRMED|SEARCH_CONFIRMED|resultConfirmed|noResultConfirmed)\b/g;

/** Strips brand/domain names, markdown links, raw URLs, parenthetical
 * source attributions, and internal technical vocabulary out of a single
 * customer-facing string — the content-level companion to
 * CUSTOMER_REPORT_STRIP_KEYS's key-level stripping. Collapses the leftover
 * whitespace/punctuation debris a removal leaves behind so the sentence
 * still reads naturally. */
function sanitizeCustomerString(input: string): string {
  if (!input) return input;
  let s = input;
  // Markdown links -> label only: "[ბრენდის სახელი](https://...)" -> "ბრენდის სახელი"
  s = s.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1');
  // Raw URLs of any kind.
  s = s.replace(/https?:\/\/\S+/gi, '');
  // "(source.domain)" / "(via SomeProvider)" style parenthetical attribution.
  s = s.replace(/\((?:via\s+)?[^()]*(?:myhome|ss\.ge|home\.ge|korter|estatehub|villion\.ge|linkedin|facebook|instagram)[^()]*\)/gi, '');
  s = s.replace(FORBIDDEN_SOURCE_NAME_RE, '');
  s = s.replace(TECHNICAL_LEAK_RE, '');
  // Collapse whitespace/punctuation left behind by the removals above
  // (double spaces, orphaned "()" or " — " fragments, stray commas/hyphens
  // at either end). A trailing "." is deliberately EXCLUDED from this
  // cleanup — unlike a stray comma/semicolon/hyphen, a lone trailing
  // period is normal, correct sentence punctuation on a string that had
  // nothing removed from it at all, and must never be eaten (this was a
  // real bug caught by this file's own regression test: "A clean summary
  // with no leaks." must survive with its period intact).
  s = s
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[\s,;.-]+|[\s,;-]+$/g, '')
    .trim();
  return s;
}

// CUSTOMER_FACING_URL_KEYS: the one exception to sanitizeCustomerString's
// blanket raw-URL stripping. `officialPortalUrl` (see OFFICIAL_PORTAL /
// buildManualVerificationActions() above) is a hand-verified GOVERNMENT
// portal URL — the addendum's explicit exception to "never show a raw
// URL"/"never name a source" (Sections 1-3: "even official government
// portal links... must still be validated and shown, with a neutral
// label"). Every other string field, whatever its key, still gets the
// full sanitizeCustomerString treatment.
const CUSTOMER_FACING_URL_KEYS = new Set(['officialPortalUrl']);
function sanitizeCustomerReport<T>(value: T, key?: string): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeCustomerReport(v, key)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CUSTOMER_REPORT_STRIP_KEYS.has(k)) continue;
      out[k] = sanitizeCustomerReport(v, k);
    }
    return out as T;
  }
  if (typeof value === 'string') return (key && CUSTOMER_FACING_URL_KEYS.has(key) ? value : sanitizeCustomerString(value)) as unknown as T;
  return value;
}

// assertNoLeaks() (mandate addendum Section 12/13) — a last-resort net,
// never the primary defense (sanitizeCustomerString/CUSTOMER_REPORT_STRIP_KEYS
// above are). Exported so a Deno test can call it directly against a fixed
// forbidden-token list; the runtime path below (sanitizeForCustomer) uses
// the non-throwing findLeaks() so a residual leak degrades gracefully
// (logged + stripped) instead of turning into a 500 for the customer.
const FORBIDDEN_LEAK_TOKENS = [
  'myhome',
  'korter',
  'estatehub',
  'home.ge',
  'ss.ge',
  'villion.ge',
  'linkedin',
  'facebook',
  'utm_source',
  'sourceurl',
  'sourcename',
  'retrievalmethod',
  'playwright',
  'iframe not found',
  'submit_failed',
  'frame_not_found',
  'technical failure',
];
function findLeaks(customerJson: unknown): string[] {
  const raw = JSON.stringify(customerJson).toLowerCase();
  return FORBIDDEN_LEAK_TOKENS.filter((token) => raw.includes(token));
}
export function assertNoLeaks(customerJson: unknown): void {
  const leaks = findLeaks(customerJson);
  if (leaks.length) throw new Error(`CUSTOMER_LEAK:${leaks.join(',')}`);
}

function sanitizeForCustomer(job: any): any {
  // v32 (P0 fix): `research_jobs.error` also carries the last TRANSIENT
  // retry's message while a job is still actively being retried (see
  // advance()'s catch — a retriable classification leaves status:'CREATED'
  // and stage unchanged, specifically so the row keeps polling normally,
  // but it also writes `error: s` for admin visibility). VerifyPage.tsx's
  // check()/run()/resume()/skip() all do `if(data?.error)throw new
  // Error(data.error)` BEFORE they ever look at `data.status` — so without
  // this, a job the backend correctly classified as "keep going" would
  // still surface as a hard client-side failure the instant it carried any
  // stale `error` value, exactly reproducing the "Internal server error
  // while the job is still RUNNING" P0 symptom one layer downstream of the
  // advance()-await fix above. Only a genuinely terminal FAILED job's error
  // reaches the client; every other status (CREATED/RUNNING/WAITING_HUMAN)
  // never includes it, even when the DB row's own `error` column is
  // currently non-null. The stored column itself is untouched — admin
  // diagnostics via a direct DB read still see the real value.
  if (job && job.status !== 'FAILED' && job.status !== 'COMPLETE' && job.error) {
    const { error: _droppedTransientError, ...withoutError } = job;
    job = withoutError;
  }
  if (!job || job.status !== 'COMPLETE' || !job.result_json || typeof job.result_json !== 'object') return job;
  const r: any = sanitizeCustomerReport({ ...job.result_json });
  delete r.browserOfficial;
  delete r.entityConfidence;
  delete r.confidence;
  // 2026-09-06 correction: officialSourceCoverage (the per-source
  // SUCCESS/NO_RESULT/CAPTCHA_REQUIRED/... breakdown) is worker/source
  // technical state, not a customer finding — already hidden from every
  // rendered card (v26 "CUSTOMER-VALUE CLEANUP") and from the AI-chat
  // handoff (customerSafeReportForAi() in VerifyPage.tsx); now also
  // removed from the raw HTTP payload so it never reaches the customer at
  // all. Computed and persisted in result_json unchanged for internal/
  // admin use — only this response copy loses it.
  delete r.officialSourceCoverage;
  delete r.officialSourcesChecked;
  delete r.officialSourcesConfirmedFound;
  delete r.officialSourcesConfirmedNoResult;
  delete r.officialSourcesNotVerified;
  delete r.officialSourcesSkipped;
  delete r.officialSourcesPartiallyTraversed;
  delete r.officialVerificationComplete;
  delete r.stage;
  delete r.researchProvider;
  delete r.costUsage;
  delete r._worker;
  delete r._cost;
  delete r._enregEntityRequestedFor;
  // v28: the generalized financial-queue bookkeeping (enreg/rstax/debtor) —
  // same reasoning as _enregEntityRequestedFor above, kept alongside it
  // rather than replacing it in case an in-flight job created before this
  // deploy still carries the old field name.
  delete r._financialEntityRequestedFor;
  delete r._financialQueue;
  delete r._financialReturnStage;
  delete r._captchaReturnStage;
  // Last-resort safety net (mandate addendum Section 12): sanitizeCustomerReport
  // above is the real defense (key removal + sanitizeCustomerString on every
  // string leaf) — this only catches whatever that missed. Never throws in
  // production (a leak must never turn into a 500 for the customer): it
  // logs for admin follow-up and best-effort re-redacts the JSON text
  // itself so the response body genuinely does not carry the token, even
  // though the resulting field may read awkwardly until the real cause is
  // fixed upstream.
  const leaks = findLeaks(r);
  if (leaks.length) {
    console.error(`research-agent: sanitizeForCustomer residual leak (job ${job.id}): ${leaks.join(', ')}`);
    let raw = JSON.stringify(r);
    for (const token of leaks) raw = raw.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    try {
      return { ...job, result_json: JSON.parse(raw) };
    } catch {
      /* fall through and return the pre-redaction object rather than a broken response */
    }
  }
  return { ...job, result_json: r };
}

/* ══════════════════════════════════════════════════════════════════════
 * THE AUTONOMOUS DRIVER
 *
 * Until now `advance()` was called from exactly one place: the `status`
 * action. That made the CUSTOMER'S BROWSER the execution engine. Close the
 * tab and the state machine stopped mid-flight — not failed, not cancelled,
 * just frozen in a non-terminal stage with no report and no error, forever.
 *
 * research_jobs still holds the proof: 2aa12895-9c2e-49ed-b8ad-c7ebb37c4125
 * and 533a8c19-f160-4f06-ab27-517c1f661b86, both CREATED/BROWSER_WAITING,
 * both untouched since the moment their client went away.
 *
 * pg_cron now calls `drive` on a schedule. It steps the same advance() the
 * client steps — one engine, two callers, so there is no second
 * implementation to drift out of sync.
 *
 * HOW IT AVOIDS FIGHTING A CONNECTED CLIENT
 *
 * A client polls every ~2.2s, and every poll bumps updated_at. The driver
 * only looks at jobs whose heartbeat is older than DRIVE_STALE_MS, so a job
 * somebody is actually watching is never touched and the existing, working
 * foreground path is completely unchanged. When the client goes away the
 * heartbeat goes stale and the driver picks the job up.
 *
 * A claim guards against the driver racing ITSELF (two ticks overlapping on
 * a long job) and is always released in a finally.
 * ══════════════════════════════════════════════════════════════════════ */

/** Jobs the driver may step. WAITING_HUMAN is deliberately absent: it is
 *  waiting on a person, and ticking it would achieve nothing. */
const DRIVE_LIVE_STATUSES = ['CREATED', 'RUNNING'];
/** Leave a job alone while a client is demonstrably still polling it. */
const DRIVE_STALE_MS = 30_000;
/** Never resurrect something ancient — that is a support decision, not a tick. */
const DRIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Long enough to cover one whole background invocation. Always released. */
const DRIVE_CLAIM_TTL_MS = 150_000;
const DRIVE_BATCH = 6;
const DRIVE_SYNTHESIS_BATCH = 4;
/** Inside ONE invocation, step a job repeatedly so a browserless run keeps
 *  roughly the pace a polling client would give it. */
const DRIVE_TICKS_PER_JOB = 14;
const DRIVE_TICK_SPACING_MS = 3_000;
const DRIVE_WALL_CLOCK_MS = 55_000;
/** §54: synthesis may retry; research must never be re-run because of it. */
const MAX_SYNTHESIS_ATTEMPTS = 4;
/** Longer than any real synthesis, short enough that a stall is not a dead end. */
const SYNTHESIS_ATTEMPT_TIMEOUT_MS = 4 * 60 * 1000;

async function adminSetting(sb: any, key: string): Promise<string> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

/** The language the customer STARTED in, persisted at creation. A report
 *  finished by the driver must not silently change language. */
function jobLanguage(j: any): string {
  const stored = String(j?.result_json?._lang || '');
  // 'ka' rather than the request-time 'en' default: a job old enough to
  // predate _lang belongs to this product's Georgian-first customer base,
  // and guessing English would be the more damaging wrong guess.
  return LANG[stored] ? stored : 'ka';
}

async function claimJob(sb: any, id: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DRIVE_CLAIM_TTL_MS).toISOString();
  const { data } = await sb
    .from('research_jobs')
    .update({ driver_claimed_at: now() })
    .eq('id', id)
    .or(`driver_claimed_at.is.null,driver_claimed_at.lt.${cutoff}`)
    .select('id')
    .maybeSingle();
  return !!data;
}

async function releaseJob(sb: any, id: string): Promise<void> {
  try {
    await sb.from('research_jobs').update({ driver_claimed_at: null }).eq('id', id);
  } catch {
    /* the claim expires on its own; a failed release is not worth failing the tick */
  }
}

/** Step one job for as long as this invocation can afford to. */
async function driveJob(sb: any, key: string, model: string, id: string): Promise<void> {
  const deadline = Date.now() + DRIVE_WALL_CLOCK_MS;
  try {
    for (let i = 0; i < DRIVE_TICKS_PER_JOB && Date.now() < deadline; i++) {
      const { data: j } = await sb.from('research_jobs').select('*').eq('id', id).maybeSingle();
      // Terminal, cancelled, or now waiting on a human: the driver's job here
      // is done and re-ticking would be wrong, not merely wasteful.
      if (!j || j.cancelled_at || !DRIVE_LIVE_STATUSES.includes(j.status)) return;
      await advance(sb, key, model, j, jobLanguage(j));
      if (i + 1 < DRIVE_TICKS_PER_JOB) await new Promise((r) => setTimeout(r, DRIVE_TICK_SPACING_MS));
    }
  } catch (e) {
    // advance() already persists its own failures. Anything reaching here is
    // the driver's own problem and must not take the whole sweep down.
    console.error(`research-agent drive: job ${id} tick loop failed`, e);
  } finally {
    await releaseJob(sb, id);
  }
}

/* SYNTHESIS IS PART OF THE PIPELINE, NOT PART OF THE PAGE.
 *
 * Nothing server-side ever called verify-synthesis. The Buyer Intelligence
 * report existed only because a browser happened to be open at the moment
 * research finished — and it was rebuilt, at full model cost, every single
 * time anyone reopened the case. Both halves of that are fixed here: the
 * driver requests synthesis when research completes, and verify-synthesis
 * persists the result so it is built exactly once. */
async function driveSynthesis(sb: any): Promise<void> {
  /*
   * PENDING IS A RETRYABLE STATE, NOT A RESTING ONE.
   *
   * The first version swept only NONE and FAILED. A synthesis whose caller
   * was evicted mid-flight — an edge invocation is not guaranteed to outlive
   * a slow model call — would sit at PENDING forever, and nothing would ever
   * look at it again: research COMPLETE, no report, no error, no retry. That
   * is the forbidden state wearing a different column.
   *
   * So PENDING is retried too, but only once it is demonstrably stale, so a
   * synthesis that is legitimately still running is never duplicated.
   * synthesis_at records when the attempt STARTED and is overwritten with the
   * success time by verify-synthesis itself.
   */
  const staleBefore = Date.now() - SYNTHESIS_ATTEMPT_TIMEOUT_MS;
  const { data: candidates, error: sweepError } = await sb
    .from('research_jobs')
    .select('id,synthesis_attempts,synthesis_state,synthesis_at')
    .eq('status', 'COMPLETE')
    .is('deleted_at', null)
    .in('synthesis_state', ['NONE', 'FAILED', 'PENDING'])
    .lt('synthesis_attempts', MAX_SYNTHESIS_ATTEMPTS)
    .order('completed_at', { ascending: true })
    .limit(DRIVE_SYNTHESIS_BATCH * 3);

  // A swallowed query error is how this sweep went silent once already: an
  // unsupported filter returned no rows and no exception, so COMPLETE jobs
  // simply stopped getting reports with nothing anywhere saying why.
  if (sweepError) {
    console.error('research-agent drive: synthesis sweep query failed', sweepError);
    return;
  }

  /*
   * The PENDING staleness test is done HERE rather than in the query.
   *
   * Expressing it as a PostgREST `.or()` meant embedding an ISO timestamp in
   * a comma-separated filter string — which is exactly the kind of quoting
   * that fails quietly. This is a handful of rows; JavaScript can filter it,
   * and the rule stays readable.
   */
  const jobs = (candidates ?? [])
    .filter((j: any) => {
      if (j.synthesis_state !== 'PENDING') return true;
      const started = Date.parse(j.synthesis_at ?? '');
      // An attempt with no start time recorded predates this bookkeeping and
      // is by definition not in flight.
      return !Number.isFinite(started) || started < staleBefore;
    })
    .slice(0, DRIVE_SYNTHESIS_BATCH);

  for (const j of jobs ?? []) {
    // Count the attempt BEFORE making it, so a hard crash still consumes
    // budget and a permanently poisonous job cannot loop forever. synthesis_at
    // stamps the START, which is what makes a stalled attempt detectable.
    await sb
      .from('research_jobs')
      .update({
        synthesis_state: 'PENDING',
        synthesis_attempts: (j.synthesis_attempts ?? 0) + 1,
        synthesis_at: now(),
      })
      .eq('id', j.id);
    try {
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-synthesis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'x-internal-driver': '1',
        },
        body: JSON.stringify({ jobId: j.id, internal: true }),
      });
      if (!res.ok) throw new Error(`verify-synthesis ${res.status}`);
      // verify-synthesis owns the READY write — it is the only thing that
      // knows whether a real report came out the other end.
    } catch (e) {
      console.error(`research-agent drive: synthesis failed for ${j.id}`, e);
      await sb.from('research_jobs').update({ synthesis_state: 'FAILED' }).eq('id', j.id);
    }
  }
}

async function driveLiveJobs(sb: any, key: string, model: string): Promise<void> {
  try {
    const { data: jobs } = await sb
      .from('research_jobs')
      .select('id')
      .in('status', DRIVE_LIVE_STATUSES)
      .is('deleted_at', null)
      .is('cancelled_at', null)
      .lt('updated_at', new Date(Date.now() - DRIVE_STALE_MS).toISOString())
      .gt('created_at', new Date(Date.now() - DRIVE_MAX_AGE_MS).toISOString())
      .order('updated_at', { ascending: true })
      .limit(DRIVE_BATCH);

    for (const j of jobs ?? []) {
      if (await claimJob(sb, j.id)) await driveJob(sb, key, model, j.id);
    }
  } catch (e) {
    console.error('research-agent drive: sweep failed', e);
  }
  // Runs even if the sweep threw: a COMPLETE job still owes its customer a
  // report, and that is independent of whatever went wrong above.
  await driveSynthesis(sb);
  await retireAbandonedJobs(sb);
}

/*
 * Close out what can never finish.
 *
 * The forbidden state the customer reported is a live server job with no UI,
 * no report and NO ERROR — and jobs abandoned before the driver existed are
 * exactly that. They sit in History as "მიმდინარე" forever, promising a
 * result that is not coming, because they stopped when their client did and
 * nothing has stepped them since.
 *
 * Past the driver's own working window there is nothing further to try, so
 * they are marked terminal with a truthful, customer-safe message. Their
 * collected evidence is untouched — this changes the status that describes
 * them, never the research they hold.
 */
async function retireAbandonedJobs(sb: any): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DRIVE_MAX_AGE_MS).toISOString();
    const { data: jobs } = await sb
      .from('research_jobs')
      .select('id')
      .in('status', [...DRIVE_LIVE_STATUSES, 'WAITING_HUMAN'])
      .is('deleted_at', null)
      .is('cancelled_at', null)
      .lt('created_at', cutoff)
      .limit(DRIVE_BATCH);

    for (const j of jobs ?? []) {
      await sb.from('research_jobs').update({
        status: 'FAILED',
        stage: 'FAILED',
        error: 'RESEARCH_ABANDONED_BEFORE_COMPLETION',
        driver_claimed_at: null,
        updated_at: now(),
      }).eq('id', j.id);
    }
  } catch (e) {
    console.error('research-agent drive: retiring abandoned jobs failed', e);
  }
}


Deno.serve(async (req) => {
  // v29: CORS headers computed per-request from THIS request's own Origin,
  // then closed over by a request-scoped `json` that shadows the module-
  // level one for the rest of this invocation only (see the v29 comment
  // above the module-level CORS/json for why this is safe: every json()
  // call site in this file lives lexically inside this handler).
  const CORS = corsHeadersFor(req.headers.get('origin'));
  const json = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  // Mandate: OPTIONS must be handled before ANY auth/body parsing.
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });
  // v29: everything below was already the full, unmodified request-handling
  // logic — it is now wrapped in a top-level try/catch purely so that ANY
  // uncaught exception (e.g. a rejection surfacing from advance()/launch())
  // still returns a normal JSON response WITH these same CORS headers,
  // instead of letting Deno's default unhandled-exception path replace it
  // with Supabase's gateway's own headerless 500 — the actual, reproduced
  // cause of the "blocked by CORS policy" reports. No research-workflow
  // logic below this line was changed.
  try {
    // `drive` is the cron tick and deliberately sits ABOVE the user-session
    // check: it belongs to no customer. It is authenticated instead by a
    // shared secret held in admin_settings, exactly as the existing
    // continuous-matching-worker cron is. Same shape, same blast radius.
    const preAuthBody = req.method === 'POST' ? await req.clone().json().catch(() => ({})) : {};
    if (String(preAuthBody?.action || '') === 'drive') {
      const svc = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
      const expected = await adminSetting(svc, 'verify_driver_token');
      if (!expected || req.headers.get('x-cron-token') !== expected) {
        return json({ error: 'Forbidden' }, 403);
      }
      const dk = Deno.env.get('OPENAI_API_KEY');
      const dm = Deno.env.get('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-terra';
      if (!dk) return json({ error: 'not configured' }, 503);
      // Return immediately and keep working: a tick that held the connection
      // open for a minute would be a tick that pg_cron reports as a timeout.
      EdgeRuntime.waitUntil(driveLiveJobs(svc, dk, dm));
      return json({ ok: true, started: true }, 202);
    }

    const a = req.headers.get('Authorization');
    if (!a) return json({ error: 'Authentication required' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const {
      data: { user },
    } = await sb.auth.getUser(a.replace(/^Bearer\s+/i, ''));
    if (!user) return json({ error: 'Invalid session' }, 401);
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || 'start');
    const lang = LANG[String(b.locale || b.language)] ? String(b.locale || b.language) : 'en';
    // v30: Gemini removed entirely — OpenAI Responses API only, per the
    // "REMOVE GEMINI COMPLETELY AND MIGRATE RESEARCH AI TO OPENAI" mandate.
    // OPENAI_FAST_MODEL is read and available for a future cheap
    // classification/entity-normalization call ("only when genuinely
    // necessary") but no call site uses it yet this pass — the existing
    // four-stage flow (IDENTITY/OFFICIAL/MARKET/SYNTHESIS) is unchanged and
    // all four still use the main research model.
    const key = Deno.env.get('OPENAI_API_KEY');
    const model = Deno.env.get('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-terra';
    const fastModel = Deno.env.get('OPENAI_FAST_MODEL') || 'gpt-5.6-luna';
    void fastModel;
    if (!key) {
      // Mandate: fail clearly, never silently fall back to any other
      // provider — but the CUSTOMER never sees the internal reason
      // ("OpenAI not configured" is an admin/ops fact, not something to
      // leak in a CORS-intact response). Admin logs get the real cause.
      console.error('research-agent: OPENAI_API_KEY is not configured in this project\'s Edge Function secrets — refusing the request rather than calling any other provider.');
      return json({ error: GENERIC_CONFIG_ERROR_I18N[lang] || GENERIC_CONFIG_ERROR_I18N.en }, 503);
    }
    if (!WORKER || !WT) {
      // Same fail-closed pattern as the OPENAI_API_KEY check above: every
      // action below this point that touches a browser job (start/status/
      // resume/skip, via wf()/startBrowser()/pollBrowser()) needs a real
      // worker URL and bearer token. Silently calling wf() with an empty
      // Authorization header would surface as a confusing generic 500/401
      // deep inside advance() — fail clearly here instead, before any DB
      // row or worker call is made.
      console.error('research-agent: WORKER_URL and/or WORKER_TOKEN is not configured in this project\'s Edge Function secrets — refusing the request rather than calling the worker with an incomplete/empty Authorization header.');
      return json({ error: GENERIC_CONFIG_ERROR_I18N[lang] || GENERIC_CONFIG_ERROR_I18N.en }, 503);
    }

    /* EXPLICIT CANCELLATION — and nothing else.
     *
     * Closing a tab, navigating away, losing the network or backgrounding
     * the browser are NOT cancellation and never reach this. Only the
     * customer pressing "კვლევის შეწყვეტა" does.
     *
     * A cancelled job is CANCELLED, never FAILED: nothing went wrong, and
     * showing a person a failure because they chose to stop is a lie about
     * their own action. Everything already collected is preserved — the
     * result_json is not touched. */
    if (action === 'cancel') {
      const id = String(b.jobId || '');
      const { data: j } = await sb.from('research_jobs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!j) return json({ error: 'Job not found' }, 404);
      // Already finished one way or another: cancelling is a no-op, not an
      // error, and must never overwrite a report the customer already has.
      if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(j.status)) return json(sanitizeForCustomer(j));
      const wid = j.result_json?._worker?.jobId;
      if (wid) {
        // Best effort only. The worker has no cancel route and adding one
        // would force a Railway deploy for no gain: the DB row is the
        // authority, the driver skips cancelled jobs, and the orphaned
        // browser session is reaped by the worker's own watchdog.
        try { await wf(`/research/${wid}/skip`, 'POST', {}); } catch { /* already gone */ }
      }
      await sb.from('research_jobs').update({
        status: 'CANCELLED',
        stage: 'CANCELLED',
        cancelled_at: now(),
        driver_claimed_at: null,
        error: null,
        progress: { ...(j.progress || {}), phase: 'cancelled' },
        updated_at: now(),
      }).eq('id', id);
      const { data: after } = await sb.from('research_jobs').select('*').eq('id', id).maybeSingle();
      return json(sanitizeForCustomer(after || { ...j, status: 'CANCELLED', stage: 'CANCELLED' }));
    }

    if (action === 'status' || action === 'resume' || action === 'skip') {
      const id = String(b.jobId || '');
      let { data: j } = await sb.from('research_jobs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!j) return json({ error: 'Job not found' }, 404);

      if (action === 'resume' && j.status === 'WAITING_HUMAN') {
        const wid = j.result_json?._worker?.jobId;
        if (!wid) return json({ error: 'Browser session missing' }, 409);
        const r = await wf(`/research/${wid}/resume`, 'POST', {});
        if (r.code === 409) return json({ error: 'CAPTCHA not completed', captcha: j.captcha }, 409);
        // v19: restore whichever stage was paused (the primary browser job or
        // the entity-triggered ENREG job) instead of hardcoding BROWSER_WAITING
        // — the earlier v18 behavior would have silently routed an ENREG
        // entity CAPTCHA resume back into pollBrowser() against the WRONG
        // (already-closed) worker job id.
        const returnStage = j.result_json?._captchaReturnStage || 'BROWSER_WAITING';

        // A human may legitimately spend longer than the browser watchdog
        // window solving CAPTCHA. Restart the watchdog clock only when
        // returning to the primary Browserless research job.
        let resumedResultJson = j.result_json || {};
        if (
          returnStage === 'BROWSER_WAITING' &&
          resumedResultJson?._worker?.jobId
        ) {
          resumedResultJson = {
            ...resumedResultJson,
            _worker: {
              ...resumedResultJson._worker,
              startedAt: new Date().toISOString(),
            },
          };
        }

        await sb.from('research_jobs').update({
          status: 'RUNNING',
          stage: returnStage,
          captcha: {},
          result_json: resumedResultJson,
          updated_at: now(),
        }).eq('id', id);

        j = {
          ...j,
          status: 'RUNNING',
          stage: returnStage,
          result_json: resumedResultJson,
        };
      }
      if (action === 'skip' && j.status === 'WAITING_HUMAN') {
        const wid = j.result_json?._worker?.jobId;
        if (wid) {
          try {
            await wf(`/research/${wid}/skip`, 'POST', {});
          } catch {
            /* the frontend's modal likely already called this directly — a 404 here is a normal race, not an error */
          }
        }
        const returnStage = j.result_json?._captchaReturnStage || 'BROWSER_WAITING';

        // A human may legitimately spend longer than the browser watchdog
        // window solving CAPTCHA. Restart the watchdog clock only when
        // returning to the primary Browserless research job.
        let resumedResultJson = j.result_json || {};
        if (
          returnStage === 'BROWSER_WAITING' &&
          resumedResultJson?._worker?.jobId
        ) {
          resumedResultJson = {
            ...resumedResultJson,
            _worker: {
              ...resumedResultJson._worker,
              startedAt: new Date().toISOString(),
            },
          };
        }

        await sb.from('research_jobs').update({
          status: 'RUNNING',
          stage: returnStage,
          captcha: {},
          result_json: resumedResultJson,
          updated_at: now(),
        }).eq('id', id);

        j = {
          ...j,
          status: 'RUNNING',
          stage: returnStage,
          result_json: resumedResultJson,
        };
      }
      if (!['COMPLETE', 'FAILED', 'WAITING_HUMAN', 'CANCELLED'].includes(j.status)) {
        await advance(sb, key, model, j, lang);
        const r = await sb.from('research_jobs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
        j = r.data || j;
      }
      // v22: strip internal diagnostics from the wire response for finished jobs
      // (see sanitizeForCustomer above). The DB row itself is left untouched —
      // full browserOfficial/cost/provider diagnostics remain queryable there
      // for admin support/debugging, only the customer-facing HTTP body changes.
      return json(sanitizeForCustomer(j));
    }

    const mode: Mode = b.type === 'cadastral' ? 'cadastral' : 'property';
    const q = mode === 'cadastral' ? String(b.query || '').trim().replace(/\s/g, '') : String(b.query || '').trim().replace(/\s+/g, ' ');
    if (!q) return json({ error: 'Query required' }, 400);
    if (mode === 'cadastral' && !CAD.test(q)) return json({ error: 'Invalid cadastral code' }, 400);
    // `_lang` is what lets a job that finishes with NOBODY WATCHING still be
    // written in the language the customer chose. Without it the driver would
    // have to guess, and the report would silently change language whenever
    // the customer happened to close the tab.
    const { data: j, error } = await sb.from('research_jobs').insert({ user_id: user.id, mode, query: q, status: 'CREATED', stage: 'QUEUED', result_json: { _lang: lang }, progress: { phase: 'queued', percent: 5 }, updated_at: now() }).select('*').single();
    if (error || !j) return json({ error: 'Could not create research job', detail: error?.message }, 500);
    await advance(sb, key, model, j, lang);
    return json({ accepted: true, jobId: j.id }, 202);
  } catch (e) {
    console.error('research-agent: unhandled exception reached the top-level handler', e);
    return json({ error: 'Internal server error', detail: String((e as any)?.message || e) }, 500);
  }
});
