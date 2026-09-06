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
const WORKER = 'https://homatch-official-worker-production.up.railway.app';
const WT = 'ikc96EYn4PznFsdfo0LWlTy1VhSFaoi-YrCIXbl2qHddYS6VJVmyFysw5GotA3-R';
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
// "debtor", "enreg", "tas", "msmap") — in whatever locale the request asked
// for. Keyed by the worker's own stable adapter id, not by sourceName text,
// so this never depends on exactly how the worker phrased its English name.
const SOURCE_NAME_I18N: Record<string, Record<string, string>> = {
  tas: { ka: 'TAS — საჯარო რეესტრის საინფორმაციო სისტემა', en: 'TAS — Public Registry Information System', ru: 'TAS — информационная система публичного реестра', tr: 'TAS — Kamu Sicili Bilgi Sistemi', ar: 'TAS — نظام معلومات السجل العام', he: 'TAS — מערכת מידע של המרשם הציבורי' },
  msmap: { ka: 'საჯარო რეესტრის საკადასტრო რუკა (MS Map)', en: 'Public Registry Cadastral Map (MS Map)', ru: 'Кадастровая карта публичного реестра (MS Map)', tr: 'Kamu Sicili Kadastro Haritası (MS Map)', ar: 'خريطة السجل العقاري العامة (MS Map)', he: 'מפת הקדסטר של המרשם הציבורי (MS Map)' },
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
      if (!generic) return { ...c, url, genericSource: false, linkLabel: 'View listing' };
      const { listingId, price, pricePerSqm, ...rest } = c;
      return { ...rest, url, genericSource: true, linkLabel: null };
    })
    .filter(Boolean);
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
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}.\n` +
      `INTERNAL GROUND TRUTH (for your reasoning only — never mention this line, its states, or its existence to the customer in any form): ${statusLine}.\n` +
      `A source counts as directly, officially checked ONLY when its state above is SEARCH_CONFIRMED or NO_RESULT_CONFIRMED. NO_RESULT_CONFIRMED is evidence ONLY that this one exact verified search returned no matching record on that specific source — NEVER evidence that the underlying property/record/company does not exist at all. Every other state means that source was NOT verified this run — for such a source you must simply not state a finding from it (positive or negative); do not explain why, do not name the state, do not describe any attempt.${trav}\n` +
      `Note on sources: MY.GOV.GE service 176 (naprweb.reestri.gov.ge) and NAPR are the SAME registry — never present them as two independent sources.${histNote}\n` +
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
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}. Known identifiers for this exact property/project/company so far=${JSON.stringify(identifiers)}. Identity=${JSON.stringify(i).slice(0, 9000)}. Official=${JSON.stringify(o).slice(0, 12000)}.\n` +
      `PUBLIC RESEARCH STAGE — this is a real, mandatory research stage, not optional enrichment. Do not stop after basic project/address/listing discovery. Using every identifier above, search in Georgian, English AND Russian for each of the following topics as they relate to this exact project/property/company: ${PUBLIC_RESEARCH_TARGETS.join(', ')}.\n` +
      `For every field below, populate it ONLY when your search actually surfaced supporting evidence for THIS exact project/company/property — never guess, never fill a field with a generic industry statement, never invent a name. No evidence for a field = null (or [] for list fields) — never omit the key and never pad with a placeholder string. Prefer specific names/dates/facts over vague description. Each list field should contain short, concrete, evidence-backed entries (e.g. a real person/company name with their role, not a generic sentence).\n` +
      `If you discover a legal company (developer/owner) — by exact name or identification code — that was not already present in Official.companyProfile above, populate companyId/legalCompany with it as precisely as the evidence supports; a downstream deterministic step (not you) decides whether this triggers any further registry lookup.\n` +
      `Return {"project":string|null,"developer":string|null,"legalCompany":string|null,"companyId":string|null,"foundersOwnersParticipants":string[],"directorsRepresentatives":string[],"companyHistory":string|null,"previousProjects":string[],"architect":string|null,"architectStudio":string|null,"architectReputation":string|null,"contractors":string[],"constructionCompanies":string[],"engineers":string[],"suppliers":string[],"facade":string|null,"windows":string|null,"elevators":string|null,"structuralSystem":string|null,"constructionMaterials":string|null,"insulation":string|null,"MEP":string|null,"energyEfficiency":string|null,"seismicDesign":string|null,"amenities":string[],"landscaping":string|null,"parking":string|null,"financingBank":string|null,"partners":string[],"constructionStart":string|null,"chronology":string|null,"progressHistory":string|null,"currentPhysicalStatus":string|null,"qualitySignals":string[],"developerReputation":string|null,"architectReputationSignals":string[],"complaints":string[],"disputes":string[],"legalPublicFootprint":string[],"mediaCoverage":string[],"socialPublicFootprint":string[],"awardsRecognition":string[],"facts":string[],"unverified":string[]}.`
    );
  }

  if (s === 'MARKET') {
    return (
      `${BASE}\nAnswer strings in ${L}. Query=${q}. Identity=${JSON.stringify(p.identity || {}).slice(0, 9000)}. Official=${JSON.stringify(p.official || {}).slice(0, 16000)}. PublicResearch=${JSON.stringify(p.publicResearch || {}).slice(0, 9000)}. ` +
      `Research actual public listing/post URLs and comparables: same building/project first, then street/micro-location, similar area/rooms/condition/floor. Include MyHome, SS, developer/project/agency sites, public social pages/posts, news, reviews/forums where accessible. ` +
      `For every comparable you can support with a specific deep URL (an actual listing/post, never a bare homepage), return a structured record with as many of these fields as the evidence supports: source, url (the exact deep link, required), listingId, project, address, area, rooms, floor, condition, price, currency, pricePerSqm, listingDate, similarity (a short phrase on how comparable it is to the subject property), retrievedAt, sameProject (true only when literally the same building/project as the subject). If you only have a homepage-level lead (you believe a site has relevant listings but could not retrieve a specific one), do not fabricate a listingId or price for it — omit that comparable or describe it only in priceEvidence as a general, non-specific lead. ` +
      `PRICE-DRIVER REASONING (mandatory): from the comparables you gathered (weighting same-project ones first, then nearby/similar ones), estimate a market median price-per-sqm and classify the subject property's own evidenced price as "CHEAPER", "NORMAL", "PREMIUM", or "UNKNOWN" (when no subject price is evidenced) relative to that median. Explain WHY, grounded only in evidence already gathered this run (Identity/Official/PublicResearch above, or your own comparables): construction completion stage, remaining inventory/scarcity, availability of internal/developer installment financing, construction materials and structural system, architecture/design and architect reputation, developer reputation, parking availability, floor/view/layout, amenities, location/micro-location, bank financing availability, and current supply of comparable listings. Never state a price driver you cannot support with evidence gathered this run — omit it instead. ` +
      `Return {"market":{"priceEvidence":string[],"comparables":[{"source":string,"url":string,"listingId":string|null,"project":string|null,"address":string|null,"area":string|null,"rooms":string|null,"floor":string|null,"condition":string|null,"price":string|null,"currency":string|null,"pricePerSqm":string|null,"listingDate":string|null,"similarity":string|null,"retrievedAt":string|null,"sameProject":boolean}],"priceDrivers":{"positioning":"CHEAPER"|"NORMAL"|"PREMIUM"|"UNKNOWN","marketMedianPricePerSqm":string|null,"reasoning":string[]}},"reviews":{"positive":string[],"negative":string[],"neutral":string[]},"publicEvidence":string[],"facts":string[],"riskFlags":[{"severity":"LOW"|"MEDIUM"|"HIGH","description":string}],"unverified":string[]}.`
    );
  }

  // SYNTHESIS — never performs its own web_search (see launch()'s
  // `s !== 'SYNTHESIS'` tools gate): it synthesizes only what
  // IDENTITY/OFFICIAL_COLLECTION/PUBLIC_RESEARCH/MARKET already gathered.
  const trav = traversalNote(p.browserOfficial);
  return (
    `${BASE}\nAnswer strings in ${L}. Query=${q}. Synthesize ONLY this collected evidence=${JSON.stringify(p).slice(0, 52000)}. Introduce no new facts. This includes publicResearch above (developer/company background, architect, contractors, construction quality/materials, chronology/current status, reputation, amenities) — weave genuinely evidenced items from it into officialEvidence/publicEvidence/facts/keyStrengths as appropriate; a field left null/[] there means no evidence exists and must not be mentioned at all.\n` +
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
  p._worker = { jobId: r.data.jobId };
  return sb.from('research_jobs').update({ status: 'RUNNING', stage: 'BROWSER_WAITING', result_json: p, progress: { phase: 'official_browser', percent: 34, provider: 'playwright' }, updated_at: now() }).eq('id', j.id);
}

function bev(w: any): any[] {
  const e: any[] = [];
  for (const x of w?.results || []) {
    const isMap = x.source === 'msmap';
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
  if (w.status === 'FAILED') throw new Error(w.error || 'browser failed');
  if (w.status !== 'COMPLETE') return;
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
  return results.some((r: any) => {
    if (r.source !== source) return false;
    if (idCode && r.forEntity?.idCode) return r.forEntity.idCode === idCode;
    if (!idCode && name && r.forEntity?.name) return normalizeLoose(r.forEntity.name) === normalizeLoose(name);
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
    prior.official = z;
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
  const rawCompanyProfile = z.companyProfile || o.companyProfile || null;
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
    // v26: the ONE customer-safe field this pipeline was missing — a
    // truthful per-source status list built from officialSourceCoverage(),
    // safe by construction (only the 6-value customerStatus enum + display
    // name, see its own comment above), so unlike the raw fields just
    // above it, sanitizeForCustomer() intentionally does NOT strip this
    // one. This is what lets the frontend show "MS Map: Retrieved / TAS:
    // Technical issue — not completed / My.gov: Checked — no result"
    // instead of a single opaque "1 official source checked".
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
    historicalComparison: prior.browserOfficial?.historicalComparison || null,
    // priceDrivers (2026-09-06 mandate): MARKET's own price-positioning
    // reasoning (CHEAPER/NORMAL/PREMIUM/UNKNOWN + evidenced reasoning list)
    // — additive alongside the existing priceEvidence/comparables shape so
    // no existing frontend rendering of `market` needs to change.
    market: { priceEvidence: mr.market?.priceEvidence || [], comparables: sanitizeComparables(mr.market?.comparables || []), priceDrivers: mr.market?.priceDrivers || null },
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
    requiresManualVerification: false,
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
    if (j.status === 'CREATED' && j.stage === 'QUEUED') return launch(sb, k, m, j, 'IDENTITY', l);
    if (j.status === 'CREATED' && j.stage === 'BROWSER_READY') return startBrowser(sb, j);
    if (j.stage === 'BROWSER_WAITING') return pollBrowser(sb, j);
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
    if (j.status === 'CREATED' && j.stage === 'OFFICIAL_READY') return launch(sb, k, m, j, 'OFFICIAL_COLLECTION', l);
    // ENREG_CHECK_PENDING seeds the generalized financial queue (enreg ->
    // rstax -> debtor, see processFinancialQueue) for OFFICIAL_COLLECTION's
    // own discovered company. Destination is now PUBLIC_RESEARCH_READY, not
    // MARKET_READY — PUBLIC_RESEARCH is a real stage in between.
    if (j.status === 'CREATED' && j.stage === 'ENREG_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'rstax', 'debtor'];
      prior._financialReturnStage = 'PUBLIC_RESEARCH_READY';
      return processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.stage === 'FINANCIAL_ENTITY_WAITING') return pollFinancialEntity(sb, j);
    if (j.status === 'CREATED' && j.stage === 'PUBLIC_RESEARCH_READY') return launch(sb, k, m, j, 'PUBLIC_RESEARCH', l);
    // PUBLIC_RESEARCH_CHECK_PENDING (2026-09-06 mandate): "If PublicResearch
    // finds ONE new strongly-supported company ID not already checked:
    // ENREG -> RS -> DEBTOR once only, then continue to MARKET." Same
    // processFinancialQueue()/pickFinancialCandidate() machinery as the
    // OFFICIAL_COLLECTION trigger above — alreadyHasResultFor() is what
    // actually enforces "not already checked" / "once only", so a company
    // already covered by the first chain is never looked up again here.
    if (j.status === 'CREATED' && j.stage === 'PUBLIC_RESEARCH_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'rstax', 'debtor'];
      prior._financialReturnStage = 'MARKET_READY';
      return processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.status === 'CREATED' && j.stage === 'MARKET_READY') return launch(sb, k, m, j, 'MARKET', l);
    // v25 (enreg-only) / v28 (generalized): the reconciliation-driven
    // secondary financial-queue trigger (mandate section 6's "MARKET
    // discovers Millennio Group" example) — runs after MARKET's own
    // finish() has already computed prior.reconciledIdentity. Never
    // re-triggers a lookup either earlier chain already ran (see
    // alreadyHasResultFor inside pickFinancialCandidate).
    if (j.status === 'CREATED' && j.stage === 'RECONCILIATION_CHECK_PENDING') {
      const prior = j.result_json || {};
      prior._financialQueue = ['enreg', 'rstax', 'debtor'];
      prior._financialReturnStage = 'SYNTHESIS_READY';
      return processFinancialQueue(sb, { ...j, result_json: prior });
    }
    if (j.status === 'CREATED' && j.stage === 'SYNTHESIS_READY') return launch(sb, k, m, j, 'SYNTHESIS', l);
    const a = String(j.stage || '').match(/^(IDENTITY|OFFICIAL_COLLECTION|PUBLIC_RESEARCH|MARKET|SYNTHESIS)_WAITING$/);
    if (!a || !j.response_id) return;
    // OpenAI Responses API statuses: queued/in_progress (poll again — falls
    // through both branches below, matching this function's existing
    // "no-op, caller re-polls later" behavior), completed, failed,
    // cancelled, incomplete.
    const p = await getOpenAIResponse(k, j.response_id);
    if (p.status === 'completed') return finish(sb, j, a[1] as Stage, p, l);
    if (['failed', 'cancelled', 'incomplete'].includes(p.status)) throw new Error(`OpenAI ${p.status}: ${JSON.stringify(p?.error || p?.incomplete_details || '').slice(0, 300)}`);
  } catch (e) {
    const s = String(e);
    const retry = /429|500|502|503|504|timeout|temporar/i.test(s);
    await sb.from('research_jobs').update({ status: retry ? 'CREATED' : 'FAILED', stage: retry ? j.stage || 'QUEUED' : 'FAILED', error: s, progress: { ...(j.progress || {}), retriable: retry }, updated_at: now() }).eq('id', j.id);
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
function sanitizeForCustomer(job: any): any {
  if (!job || job.status !== 'COMPLETE' || !job.result_json || typeof job.result_json !== 'object') return job;
  const r: any = { ...job.result_json };
  delete r.browserOfficial;
  delete r.entityConfidence;
  delete r.confidence;
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
  return { ...job, result_json: r };
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
        await sb.from('research_jobs').update({ status: 'RUNNING', stage: returnStage, captcha: {}, updated_at: now() }).eq('id', id);
        j = { ...j, status: 'RUNNING', stage: returnStage };
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
        await sb.from('research_jobs').update({ status: 'RUNNING', stage: returnStage, captcha: {}, updated_at: now() }).eq('id', id);
        j = { ...j, status: 'RUNNING', stage: returnStage };
      }
      if (!['COMPLETE', 'FAILED', 'WAITING_HUMAN'].includes(j.status)) {
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
    const { data: j, error } = await sb.from('research_jobs').insert({ user_id: user.id, mode, query: q, status: 'CREATED', stage: 'QUEUED', progress: { phase: 'queued', percent: 5 }, updated_at: now() }).select('*').single();
    if (error || !j) return json({ error: 'Could not create research job', detail: error?.message }, 500);
    await advance(sb, key, model, j, lang);
    return json({ accepted: true, jobId: j.id }, 202);
  } catch (e) {
    console.error('research-agent: unhandled exception reached the top-level handler', e);
    return json({ error: 'Internal server error', detail: String((e as any)?.message || e) }, 500);
  }
});
