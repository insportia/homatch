import React,{useEffect,useRef,useState}from'react';import{useNavigate,useSearchParams}from'react-router-dom';import{AppLayout}from'@/components/layouts/AppLayout';import{Button}from'@/components/ui/button';import{Input}from'@/components/ui/input';import{Card,CardContent,CardHeader,CardTitle}from'@/components/ui/card';import{Tabs,TabsList,TabsTrigger}from'@/components/ui/tabs';import{Badge}from'@/components/ui/badge';import{Search,Shield,Loader2,Bot,History,Pencil,Trash2}from'lucide-react';import{Sheet,SheetContent,SheetHeader,SheetTitle}from'@/components/ui/sheet';import{supabase}from'@/db/supabase';import{useLanguage}from'@/contexts/LanguageContext';import{useAuth}from'@/contexts/AuthContext';import{HumanVerificationHandoff,type HandoffOffer}from'@/components/research/HumanVerificationHandoff';import{VerifyReport,type VerifySynthesis}from'@/components/verify/VerifyReport';import{ResearchStream}from'@/components/verify/ResearchStream';import{AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle}from'@/components/ui/alert-dialog';import{createDealRoomFromVerify}from'@/services/dealRooms';import{VerificationCaseList}from'@/components/verify/VerificationCaseList';import{StartFromDocument}from'@/components/verify/StartFromDocument';import{ResearchDepthNotice}from'@/components/research/ResearchDepthNotice';import{listVerifyHistory,renameResearchJob,softDeleteResearchJob}from'@/services/researchJobs';import type{ResearchJobRecord}from'@/types/types';
type Mode='property'|'cadastral';type SourceCategory='OFFICIAL_REGISTRY'|'OFFICIAL_DOCUMENT'|'OFFICIAL_MAP'|'DEVELOPER_PRIMARY'|'PROPERTY_PORTAL'|'MARKET_LISTING'|'MEDIA'|'SOCIAL'|'PUBLIC_GROUP'|'PUBLIC_FORUM'|'PUBLIC_SEARCH'|'OTHER_PUBLIC';type Source={label:string;url?:string;evidenceLevel?:string;genericHomepage?:boolean;linkLabel?:string|null;retrievalMethod?:string|null;sourceCategory?:SourceCategory};type OfficialSourceOutcome={source:string;sourceName?:string;customerStatus:'SUCCESS'|'NO_RESULT'|'CAPTCHA_REQUIRED'|'BLOCKED'|'TECHNICAL_FAILED'|'NOT_CONFIRMED'};type HistoricalDoc={url:string;date?:string|null;title?:string|null};type HistoricalComparisonEntry={olderDocument:HistoricalDoc;newerDocument:HistoricalDoc;changed:boolean;addedInNewer?:string[];removedFromOlder?:string[];proof:string};type HistoricalComparison={available:boolean;reason?:string;documentsConsidered?:number;chronology?:HistoricalDoc[];comparisons?:HistoricalComparisonEntry[]};type OfficialDocument={source:string;sourceName?:string;url:string;title?:string|null;date?:string|null;type?:string|null;sha256?:string|null;parsed:boolean;textExtractionAvailable:boolean;linkLabel?:string|null};type TechnicalFact={category:string;key:string;value:string;confidence?:'HIGH'|'MEDIUM';documentTitle?:string|null;documentDate?:string|null;block?:string|null};type RevisionTimelineEntry={documentTitle?:string|null;documentDate?:string|null;block?:string|null;facts:{category:string;key:string;value:string}[]};type CompanyProfile={name?:string|null;idCode?:string|null;legalForm?:string|null;registrationDate?:string|null;status?:string|null;directors?:string[];representatives?:string[];historicalChanges?:string[];relatedProjects?:string[];summary?:string|null;sourceBasis?:'REGISTRY_CONFIRMED'|'WEB_RESEARCH_ONLY'};type CommissioningStatus={status?:'OFFICIALLY_CONFIRMED'|'NOT_INDEPENDENTLY_VERIFIED';evidenceUrl?:string|null};type ProjectProfile={name?:string|null;aliases?:string[];address?:string|null;developer?:string|null;developerCompany?:string|null;website?:string|null;buildings?:string|null;floors?:string|null;unitCounts?:string|null;constructionStatus?:string|null;declaredCompletionTarget?:string|null;observedConstructionStatus?:string|null;commissioningStatus?:CommissioningStatus|null;architect?:string|null;contractors?:string[];amenities?:string[];facts?:string[]};type Comparable={source?:string;url?:string|null;listingId?:string|null;project?:string|null;address?:string|null;area?:string|null;rooms?:string|null;floor?:string|null;condition?:string|null;price?:string|null;currency?:string|null;pricePerSqm?:string|null;listingDate?:string|null;similarity?:string|null;retrievedAt?:string|null;genericSource?:boolean;linkLabel?:string|null;comparableType?:'SAME_PROJECT'|'MICRO_LOCATION'|'PEER_PROJECT'};type DueDiligenceCoverage={level?:'HIGH'|'MEDIUM'|'LIMITED';officialSourcesChecked?:number;officialSourcesAttempted?:number;officialSourcesRetrieved?:number;documentsRead?:number;documentsDiscovered?:number;technicalFailures?:number;companyRecords?:number;marketComparables?:number;socialSources?:number;marketListingSources?:number;developerPrimarySources?:number;mediaSources?:number;forumSources?:number;otherPublicSources?:number;materialMismatches?:number;outstandingConfirmations?:number};type RightsAndRestrictions={status?:'NOT_CONFIRMED'|'NONE_FOUND_IN_CHECKED_SOURCE'|'RESTRICTION_IDENTIFIED';items?:string[];statement?:string;asOf?:string};
// v25 additions: reconciledIdentity (cross-stage entity reconciliation —
// see research-agent's reconcileIdentity()), utilitiesMatrix, landProfile,
// exactUnit. exactUnit is the mandate's own non-negotiable: for a cadastral
// query it is deterministically forced back to the literal code the user
// typed and must always be shown as the PRIMARY subject, distinct from
// `identifiedParent` (which may legitimately be a parent/base parcel TAS
// found evidence for) — the two must never be visually merged into one line.
// Provenance (2026-09-06 UI-only correction): `source`/`sourceName`/`url`
// are now stripped from the customer-facing payload server-side (the
// research-agent sanitizer's own explicit product requirement — the
// customer report must never expose which worker/provider produced a
// finding), so this type no longer treats those as customer-safe display
// fields. `label`/`description`/`confidence` are optional, forward-looking
// slots for a genuinely customer-safe display value should one ever be
// added server-side; today's reconcileIdentity() does not send any of
// them, which is expected and handled by ProvenanceList below (no chip
// renders rather than falling back to source/sourceName/url).
type Provenance={source?:string;url?:string|null;label?:string|null;description?:string|null;confidence?:string|null};type ReconciledIdentity={project?:string|null;address?:string|null;developer?:string|null;confidence?:'HIGH'|'MEDIUM'|'LOW';independentSourceCount?:number;provenance?:{project?:Provenance[];address?:Provenance[];developer?:Provenance[]}};type UtilityStatus={status?:'CONFIRMED_CONNECTED'|'CONFIRMED_NOT_CONNECTED'|'NOT_MENTIONED';note?:string|null};type UtilitiesMatrix={electricity?:UtilityStatus;water?:UtilityStatus;gas?:UtilityStatus;sewage?:UtilityStatus;internet?:UtilityStatus};type LandProfile={landCategory?:string|null;permittedUse?:string|null;buildabilityNote?:string|null;source?:string|null};type ExactUnit={code?:string|null;verified?:boolean;note?:string|null};
// OverallAssessment (v30, "REPORT UX" mandate): a deterministic, code-
// computed level (see research-agent's computeOverallAssessment()) plus the
// model's own evidence-traceable keyStrengths/itemsToVerify lists — this is
// the new top-of-report summary, replacing "missing commissioning" as the
// accidental headline of an otherwise strongly evidenced report. Never a
// safety verdict — a due-diligence-evidence-quality signal only.
type OverallAssessmentLevel='VERY_POSITIVE'|'POSITIVE'|'GENERALLY_POSITIVE'|'NEUTRAL_MIXED'|'ATTENTION_REQUIRED';type OverallAssessment={level?:OverallAssessmentLevel;keyStrengths?:string[];itemsToVerify?:string[]};
// PublicResearch (2026-09-06, "Fix Homatch Verify by implementing this exact
// pipeline in code" mandate — the new PUBLIC_RESEARCH stage). Mirrors
// research-agent's PUBLIC_RESEARCH_SCALAR_FIELDS/PUBLIC_RESEARCH_ARRAY_FIELDS
// exactly (normalizePublicResearchStructured() guarantees every one of these
// keys is always present, scalar null or array []; never a stray partial
// shape) — this type only needs to describe that already-normalized shape,
// not re-validate it. Purely additive to the existing report/property model:
// no existing field here was touched.
type PublicResearch={project?:string|null;developer?:string|null;legalCompany?:string|null;companyId?:string|null;foundersOwnersParticipants?:string[];directorsRepresentatives?:string[];companyHistory?:string[];previousProjects?:string[];architect?:string|null;architectStudio?:string|null;architectReputation?:string|null;contractors?:string[];constructionCompanies?:string[];engineers?:string[];suppliers?:string[];facade?:string|null;windows?:string|null;elevators?:string|null;structuralSystem?:string|null;constructionMaterials?:string|null;insulation?:string|null;MEP?:string|null;energyEfficiency?:string|null;seismicDesign?:string|null;amenities?:string[];landscaping?:string[];parking?:string[];financingBank?:string|null;partners?:string[];constructionStart?:string|null;chronology?:string[];progressHistory?:string[];currentPhysicalStatus?:string|null;qualitySignals?:string[];developerReputation?:string|null;architectReputationSignals?:string[];complaints?:string[];disputes?:string[];legalPublicFootprint?:string[];mediaCoverage?:string[];socialPublicFootprint?:string[];awardsRecognition?:string[];facts?:string[]};
type DiscoveredEntity={name:string;identificationCode:string|null};
type PriceDrivers={positioning?:'PREMIUM'|'DISCOUNT'|'MARKET_RANGE'|'UNKNOWN';marketMedianPricePerSqm?:string|null;premiumPct?:number|null;reasoning?:string[]};
// LegalStatusMatrix / ManualVerificationAction (report intelligence v2 mandate
// item 16 / item 8): the backend already returns fully-localized label/note
// and title/reason/steps/requestedDocument/officialPortalLabel/aiUploadPrompt
// strings per the current report language — these cards render that content
// directly rather than re-localizing it here.
type LegalStatusValue='CONFIRMED_POSITIVE'|'CONFIRMED_ATTENTION'|'NOT_CONFIRMED'|'HUMAN_VERIFICATION_REQUIRED';
type LegalStatusEntry={status:LegalStatusValue;label:string;note:string};
type LegalStatusMatrix={companyRegistration:LegalStatusEntry;debtorRegistry:LegalStatusEntry;taxpayerStatus:LegalStatusEntry;propertyEncumbrances:LegalStatusEntry;constructionPermissions:LegalStatusEntry;commissioning:LegalStatusEntry};
type ManualVerificationAction={id:string;title:string;reason:string;steps:string[];requestedDocument:string|null;officialPortalUrl:string|null;officialPortalLabel:string|null;aiUploadPrompt:string};
type Report={jobId?:string;workerJobId?:string;officialWorkerJobId?:string;_worker?:{jobId?:string};queryType:string;entityName?:string;entityType?:string;overallConfidence?:string;dueDiligenceCoverage?:DueDiligenceCoverage;coverageNote?:string;overallAssessment?:OverallAssessment|null;summary:string;identifiedParent?:{code?:string;name?:string;address?:string;developer?:string}|null;exactUnit?:ExactUnit|null;reconciledIdentity?:ReconciledIdentity|null;utilitiesMatrix?:UtilitiesMatrix|null;landProfile?:LandProfile|null;projectProfile?:ProjectProfile|null;companyProfile?:CompanyProfile|null;publicResearch?:PublicResearch|null;discoveredEntities?:DiscoveredEntity[];rightsAndRestrictions?:RightsAndRestrictions|null;market?:{priceEvidence?:string[];comparables?:Comparable[];priceDrivers?:PriceDrivers|null;startingPricePerSqm?:string|null;activeMinPricePerSqm?:string|null;activeMedianPricePerSqm?:string|null;activeMaxPricePerSqm?:string|null;activeComparablesUsed?:number;historicalMedianPricePerSqm?:string|null;historicalComparablesUsed?:number}|null;legalStatus?:LegalStatusMatrix|null;manualVerificationActions?:ManualVerificationAction[];officialEvidence?:string[];publicEvidence?:string[];reviews?:{positive?:string[];negative?:string[];neutral?:string[]}|null;conflicts?:any[];materialAdverseFindings?:any[];materialRisks?:{riskFlags?:{severity:string;description:string}[];note?:string};sources?:Source[];officialSourceCoverage?:OfficialSourceOutcome[];stage?:string;verificationUrl?:string;verificationSite?:string;historicalComparison?:HistoricalComparison|null;officialDocumentsRetrieved?:OfficialDocument[];technicalFacts?:TechnicalFact[]|null;revisionTimeline?:RevisionTimelineEntry[]|null};
const clean=(s?:string|null)=>String(s||'').replace(/\*\*/g,'').replace(/#{1,6}\s*/g,'').trim();
// 2026-09-07 Verify mandate ("never expose internal FSM/provider vocabulary
// to the customer"): research-agent/index.ts writes progress.phase as a raw
// internal token (e.g. "official_browser_complete", "enreg_entity") for its
// own state-machine bookkeeping. Every value it can write must have an
// entry here; an unrecognized/future value falls back to the existing
// generic "researching public sources…" copy rather than ever rendering
// the raw snake_case token to the customer. Keep in sync with every
// `progress: { phase: ... }` write in that function.
const PHASE_LABEL_KEYS: Record<string,string>={queued:'verify_phase_queued',identity:'verify_phase_identity',identity_complete:'verify_phase_identity_complete',official_browser:'verify_phase_official_browser',captcha_required:'verify_phase_captcha_required',official_browser_complete:'verify_phase_official_browser_complete',enreg_entity:'verify_phase_enreg_entity',rstax_entity:'verify_phase_rstax_entity',debtor_entity:'verify_phase_debtor_entity',official_collection:'verify_phase_official_collection',official_complete:'verify_phase_official_complete',public_research:'verify_phase_public_research',public_research_complete:'verify_phase_public_research_complete',market:'verify_phase_market',market_complete:'verify_phase_market_complete',synthesis:'verify_phase_synthesis',complete:'verify_phase_complete'};
// asArray() (2026-09-06 production-trace mandate, frontend crash fix): the
// completed report page crashed with "t.map is not a function". Root
// cause: several report-array fields here were only guarded by a
// truthiness/`.length` check (`x?.length?x.map(...):null`, `(x||[]).map(...)`)
// — a real Playwright/AI-generated report field, if it is ever malformed
// (a string, an object, or any other non-array value that still happens
// to be truthy or carry a `.length`), passes that guard and then
// `.map`/`.filter`/a spread throws exactly this crash, never reaching a
// clean fallback. `asArray()` is the single, deterministic guard used
// instead: Array.isArray or empty, never a guess, never a stringified
// dump of malformed data. Applied to every report-derived value used with
// `.map()`/`.filter()`/a spread on this page.
function asArray<T=any>(v:unknown):T[]{return Array.isArray(v)?v:[]}
// readFunctionErrorBody() (v33 refactor, P0 incident 2026-09-07, job
// 533a8c19-f160-4f06-ab27-517c1f661b86): extracted from the original v31
// resolveFunctionErrorMessage() below so classifyFunctionInvokeError() can
// reuse the exact same body-reading logic without duplicating it. When
// research-agent returns a non-2xx response, supabase-js's
// functions.invoke() throws a FunctionsHttpError whose own `.message` is
// ALWAYS a fixed generic string — the actual JSON body research-agent sent
// back (e.g. `{error:"..."}`, already a customer-safe, localized message —
// see its own json()/GENERIC_CONFIG_ERROR_I18N usage) is never read by the
// SDK on the non-ok path and sits, unconsumed, on `error.context` (the raw
// fetch Response object — see FunctionsHttpError's constructor in
// @supabase/functions-js, which stores the Response as `context` without
// awaiting its body). Never throws itself — a broken error path can never
// mask the original error; returns null when there is no body to read
// (network-level FunctionsFetchError, a non-JSON response, or a body
// already consumed).
async function readFunctionErrorBody(e:any):Promise<any>{
  try{
    const ctx=e?.context;
    if(ctx&&typeof ctx.json==='function'){
      return await(typeof ctx.clone==='function'?ctx.clone():ctx).json();
    }
  }catch{/* not JSON / already consumed / no body at all — treated as no body */}
  return null;
}
// resolveFunctionErrorMessage() (v31, Verify mandate: "the customer-facing
// 'Edge Function returned a non-2xx status code' error is unacceptable —
// replace it with real, safe, structured error surfacing"). See
// readFunctionErrorBody() above for why this has to read `e.context` at
// all.
async function resolveFunctionErrorMessage(e:any,fallback:string):Promise<string>{
  const body=await readFunctionErrorBody(e);
  if(body&&typeof body.error==='string'&&body.error.trim())return body.error;
  return(e?.message&&e.message!=='Edge Function returned a non-2xx status code'?e.message:fallback);
}
// MAX_TRANSIENT_POLL_RETRIES / computeTransientPollBackoffMs (v33, P0
// incident 2026-09-07, job 533a8c19-f160-4f06-ab27-517c1f661b86): production
// evidence proved the backend research job was genuinely still RUNNING
// (BROWSER_WAITING, 37%, 1/3 sources, error=null in research_jobs) at the
// exact moment the customer saw "Internal server error" — a single
// transient status-poll failure (research-agent's own uncaught-exception
// 500 path — see the v32 backend fix in research-agent/index.ts's advance()
// — or a plain network hiccup with no HTTP response at all) was being
// treated by check() below as a terminal failure. These two pure helpers
// bound how long the frontend keeps silently retrying before it finally
// gives up and surfaces a real error, and back off between attempts
// instead of hammering the function on every failure. Deliberately no
// jitter/randomness so this stays exactly unit-testable.
const MAX_TRANSIENT_POLL_RETRIES=8;
function computeTransientPollBackoffMs(retryCount:number):number{const n=Math.max(0,Math.floor(Number(retryCount)||0));return Math.min(2200*Math.pow(1.6,n),15000)}
// classifyFunctionInvokeError() (v33, same P0 incident). Distinguishes WHY a
// supabase.functions.invoke() call failed so a still-RUNNING Verify job is
// never shown as failed just because one status poll hit a transient
// error. `e.context.status` is the real HTTP status research-agent
// returned (see FunctionsHttpError in @supabase/functions-js) — a
// FunctionsFetchError (no HTTP response reached at all, e.g. the customer's
// connection dropped mid-poll) has no `.context.status` and is treated the
// same as a 5xx: TRANSIENT. Status-code meanings below are read directly
// off research-agent/index.ts's own `json({...}, <status>)` call sites in
// its top-level Deno.serve handler — kept in sync with that file, not
// guessed:
//   401             → AUTH     ("Authentication required" / "Invalid
//                               session" — session expired; retrying
//                               blindly can never succeed)
//   503             → CONFIG   (GENERIC_CONFIG_ERROR_I18N — a missing
//                               OPENAI_API_KEY / WORKER_URL / WORKER_TOKEN
//                               project secret; not recoverable by retrying)
//   400, 404, 409   → TERMINAL (bad request / job not found / a CAPTCHA
//                               action sent out of order; retrying the
//                               same request only repeats the same error)
//   everything else → TRANSIENT (500/502/504 from research-agent's own
//                               uncaught-exception path, or no response at
//                               all — exactly the incident class this fix
//                               targets)
async function classifyFunctionInvokeError(e:any,fallback:string):Promise<{message:string;category:'AUTH'|'CONFIG'|'TERMINAL'|'TRANSIENT'}>{
  const body=await readFunctionErrorBody(e);
  const message=(body&&typeof body.error==='string'&&body.error.trim())?body.error:(e?.message&&e.message!=='Edge Function returned a non-2xx status code'?e.message:fallback);
  const statusCode=Number(e?.context?.status)||0;
  const category=statusCode===401?'AUTH':statusCode===503?'CONFIG':(statusCode===400||statusCode===404||statusCode===409)?'TERMINAL':'TRANSIENT';
  return{message,category};
}
// coverageLabel() (v21, master due-diligence mandate — "PURCHASE DECISION"
// section): this system must NEVER present a safety verdict (SAFE TO BUY /
// a fake percentage). The primary badge is now DUE-DILIGENCE COVERAGE —
// how complete the research itself was — never how safe the transaction is.
// Takes `t` explicitly (called from the main component, which already has
// it) rather than being a hook itself.
const coverageLabel=(c:string|undefined,t:(k:string)=>string)=>({HIGH:t('verify_coverage_high'),MEDIUM:t('verify_coverage_medium'),LIMITED:t('verify_coverage_limited')}[String(c||'').toUpperCase()]||t('verify_coverage_limited'));
// CoverageCard / OfficialSourceStatusCard: REMOVED from customer view
// (2026-09-06, "FINAL OFFICIAL-SOURCE WORKFLOW FIX + CUSTOMER-VALUE REPORT
// CLEANUP" mandate — explicit instruction to remove "კვლევის სისრულე",
// per-source checked/attempted/retrieved counters, "ტექნიკურად ვერ
// შესრულდა", and any TAS/MSMap/NAPR/ENREG technical-state card from the
// customer-facing report; "do not show a research-completeness badge/score
// to the customer"). These were internal engineering/coverage-accounting
// concepts — genuinely useful for admin/debug, never for the customer, who
// only needs to know what was actually found for THEIR property, not how
// many sources this run attempted. The underlying data
// (report.dueDiligenceCoverage / report.officialSourceCoverage) is still
// computed and persisted server-side unchanged — nothing about the v26
// official-worker accounting fix was reverted — it is simply no longer
// rendered here. If an admin/internal diagnostics view is ever built, it
// reads these same fields directly from result_json; no new backend work
// is needed for that later.
// RightsAndRestrictionsCard (v21, mandate: seizure/attachment is
// transaction-critical — "no restriction found" and "not yet checked" must
// never collapse into one sentence, and neither may ever say "clean"/
// "guaranteed free of restrictions").
function RightsAndRestrictionsCard({rr}:{rr?:RightsAndRestrictions|null}){const{t}=useLanguage();if(!rr)return null;const items=asArray<string>(rr.items);return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_rights_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{items.length?items.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed">• {clean(x)}</div>):<p className="text-sm text-muted-foreground">{clean(rr.statement)}</p>}</CardContent></Card>}
const commissioningLabel=(s:CommissioningStatus|null|undefined,t:(k:string)=>string)=>s?.status==='OFFICIALLY_CONFIRMED'?t('verify_commissioning_confirmed'):t('verify_commissioning_unconfirmed');
// UtilitiesMatrixCard (v24/v25 field, previously computed by research-agent
// but never rendered anywhere — the mandate's own "backend emits it,
// frontend must actually show it" gap). Each utility gets its own 3-state
// badge; a utility whose status is NOT_MENTIONED is still shown (never
// hidden) so the absence of evidence is itself visible, not silently
// dropped — consistent with UNKNOWN never being collapsed into an implied NO.
const utilityStatusLabel=(s:UtilityStatus['status']|undefined,t:(k:string)=>string)=>s==='CONFIRMED_CONNECTED'?t('verify_utility_connected'):s==='CONFIRMED_NOT_CONNECTED'?t('verify_utility_not_connected'):t('verify_utility_not_mentioned');
function UtilitiesMatrixCard({u}:{u?:UtilitiesMatrix|null}){const{t}=useLanguage();if(!u)return null;const rows:[string,UtilityStatus][]=[[t('verify_utility_electricity'),u.electricity],[t('verify_utility_water'),u.water],[t('verify_utility_gas'),u.gas],[t('verify_utility_sewage'),u.sewage],[t('verify_utility_internet'),u.internet]].filter(([,v])=>v)as[string,UtilityStatus][];if(!rows.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_utilities_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map(([label,st])=><div key={label} className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><div className="flex items-center gap-2"><Badge variant={st.status==='CONFIRMED_CONNECTED'?'default':st.status==='CONFIRMED_NOT_CONNECTED'?'destructive':'outline'} className="normal-case font-normal">{utilityStatusLabel(st.status,t)}</Badge></div></div>)}{rows.filter(([,st])=>st.note).map(([label,st])=><p key={`${label}-note`} className="text-xs text-muted-foreground">{label}: {clean(st.note)}</p>)}</CardContent></Card>}
// LandProfileCard (v24/v25 field, land parcels only — same previously-unrendered
// gap as utilitiesMatrix). research-agent only ever populates this from a
// cadastral/registry document actually read this run, so every row here is
// already evidence-gated server-side; this card is a pure display layer.
function LandProfileCard({lp}:{lp?:LandProfile|null}){const{t}=useLanguage();if(!lp||!(lp.landCategory||lp.permittedUse||lp.buildabilityNote))return null;const rows:[string,string|undefined|null][]=[[t('verify_land_row_category'),lp.landCategory],[t('verify_land_row_permitted_use'),lp.permittedUse],[t('verify_land_row_buildability'),lp.buildabilityNote]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_land_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.filter(([,v])=>v).map(([k,v])=><div key={k} className="text-sm"><span className="text-muted-foreground">{k}:</span> {clean(v as string)}</div>)}</CardContent></Card>}
// ReconciledIdentityCard (v25, mandate sections 4/5): shows WHY a project/
// address/developer that IDENTITY itself never stated confidently is being
// shown at all — the confidence tier and the independent sources that
// agreed, never a bare unexplained fact. Deliberately hidden once the value
// is already visible on ProjectProfileCard with a name (i.e. this only adds
// value when it's the reason something appeared, or to show its provenance);
// it always renders when a reconciledIdentity object exists so the evidence
// trail is never hidden even if projectProfile shows the same value.
const reconciledConfidenceLabel=(c:string|undefined,t:(k:string)=>string)=>({HIGH:t('verify_reconciled_confidence_high'),MEDIUM:t('verify_reconciled_confidence_medium'),LOW:t('verify_reconciled_confidence_low')}[String(c||'').toUpperCase()]||t('verify_reconciled_confidence_low'));
// 2026-09-06 UI-only correction: the customer sanitizer now strips
// source/sourceName/url wherever nested (see research-agent's
// CUSTOMER_REPORT_STRIP_KEYS), so a provenance entry arriving here never
// carries a provider/worker name or link — rendering p.source (as this
// used to) would show an empty chip, not a provider name. Customer-facing
// provenance must never display which source/provider produced a finding,
// so this never falls back to source/sourceName/url; it only ever shows a
// genuinely customer-safe display value (label/description/confidence),
// and renders nothing at all for an entry that has none — no empty chip.
function ProvenanceList({items}:{items?:Provenance[]}){const visible=asArray<Provenance>(items).filter(p=>Boolean(p.label||p.description||p.confidence));if(!visible.length)return null;return <div className="flex flex-wrap gap-1.5">{visible.map((p,i)=><span key={i} className="text-[11px] text-muted-foreground">{clean((p.label||p.description||p.confidence)||undefined)}</span>)}</div>}
function ReconciledIdentityCard({ri}:{ri?:ReconciledIdentity|null}){const{t}=useLanguage();if(!ri||!(ri.project||ri.address||ri.developer))return null;const rows:[string,string|undefined|null,Provenance[]|undefined][]=[[t('verify_project_row_address'),ri.address,ri.provenance?.address],[t('verify_reconciled_row_project'),ri.project,ri.provenance?.project],[t('verify_project_row_developer'),ri.developer,ri.provenance?.developer]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_reconciled_title')}</span><Badge variant={ri.confidence==='HIGH'?'default':'outline'} className="normal-case font-normal">{reconciledConfidenceLabel(ri.confidence,t)}</Badge></CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">{t('verify_reconciled_explainer')}</p><div className="space-y-2 text-sm">{rows.filter(([,v])=>v).map(([k,v,prov])=><div key={k} className="space-y-1"><div>{k}: {clean(v as string)}</div><ProvenanceList items={prov}/></div>)}</div></CardContent></Card>}
// IdentifiedPropertyCard (v25 fix — mandate's other named regression: the
// exact cadastral unit the user searched for must ALWAYS stay the visually
// PRIMARY subject and must never be silently displaced by a parent/base
// parcel merely because evidence was easier to find there. Previously this
// page rendered only `identifiedParent` (which TAS/MSMAP may legitimately
// resolve to a base parcel, e.g. 01.18.06.019.055 for a search on
// 01.18.06.019.055.03.01.603) with no separate concept of the exact unit at
// all. `exactUnit.code` is forced server-side back to the literal query for
// cadastral-mode jobs, so it is always safe to treat as the true subject.
function IdentifiedPropertyCard({identifiedParent,exactUnit,projectProfile}:{identifiedParent?:Report['identifiedParent'];exactUnit?:ExactUnit|null;projectProfile?:ProjectProfile|null}){const{t}=useLanguage();if(!identifiedParent&&!exactUnit?.code)return null;const parentDiffers=!!(exactUnit?.code&&identifiedParent?.code&&exactUnit.code!==identifiedParent.code);return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_identified_property_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{exactUnit?.code&&<div className="space-y-1 pb-2 border-b border-border"><div className="flex items-center gap-2 flex-wrap"><span className="text-xs uppercase tracking-wide text-muted-foreground">{t('verify_exact_unit_label')}</span><Badge variant={exactUnit.verified?'default':'outline'} className="normal-case font-normal">{exactUnit.verified?t('verify_exact_unit_verified'):t('verify_exact_unit_unverified')}</Badge></div><div className="text-sm font-medium break-all">{exactUnit.code}</div>{exactUnit.note&&<p className="text-xs text-muted-foreground">{clean(exactUnit.note)}</p>}</div>}<div className="space-y-1">{parentDiffers&&<span className="text-xs uppercase tracking-wide text-muted-foreground">{t('verify_parent_parcel_label')}</span>}<div className="grid sm:grid-cols-2 gap-2 text-sm">{(!exactUnit?.code||parentDiffers)&&<div>{t('verify_label_code')}: {identifiedParent?.code||'—'}</div>}<div>{t('verify_project_title_prefix')}: {identifiedParent?.name||projectProfile?.name||'—'}</div><div>{t('verify_project_row_address')}: {identifiedParent?.address||projectProfile?.address||'—'}</div><div>{t('verify_project_row_developer')}: {identifiedParent?.developer||projectProfile?.developer||'—'}</div></div></div></CardContent></Card>}
// customerSafeReportForAi() (2026-09-05 v2): the AI-chat follow-up must never
// see ANY internal/engineering field, including ones this page itself no
// longer renders (officialSourcesChecked/NotVerified/Skipped/
// PartiallyTraversed, the raw model-asserted entityConfidence, the internal
// numeric `confidence`, browserOfficial, researchProvider/stage) — a field
// merely being absent from this page's own JSX was exactly how the previous
// leak reached the customer (the AI was simply handed the whole object).
// v26 CUSTOMER-VALUE cleanup: officialSourceCoverage/dueDiligenceCoverage
// joined the strip list alongside the pre-existing internal fields — this
// page no longer renders either (see the CoverageCard/OfficialSourceStatusCard
// removal note above), so the AI-chat follow-up must not re-leak them from
// the raw report object either.
// stripUrlFields() (v36, "NO RAW URLS TO CUSTOMER" — the same principle
// that emptied the customer-facing Sources card and every <a href> in this
// file applies equally to the AI-chat follow-up context: the object handed
// to /ai is still shown to the customer indirectly (the assistant answers
// from it, and could otherwise quote a raw link back). Recursively drops
// any url-shaped field wherever it appears — officialDocumentsRetrieved[].
// url, comparables[].url, historicalComparison's document URLs,
// projectProfile.commissioningStatus.evidenceUrl, report.sources[].url —
// rather than re-auditing every nested shape by hand each time a new one
// is added. Non-URL fields (titles, dates, source names) are kept, since
// those carry no raw link and are useful context for the assistant.
function stripUrlFields(v:any):any{if(Array.isArray(v))return v.map(stripUrlFields);if(v&&typeof v==='object'){const out:any={};for(const k of Object.keys(v)){if(/^(url|evidenceUrl|verificationUrl|linkLabel)$/i.test(k))continue;out[k]=stripUrlFields(v[k])}return out}return v}
function customerSafeReportForAi(r:Report){const{...rest}=r as any;for(const k of['browserOfficial','_worker','_cost','costUsage','workerJobId','officialWorkerJobId','researchProvider','narrativeEvidenceGateApplied','narrativeEvidenceGateReasons','officialSourcesChecked','officialSourcesConfirmedFound','officialSourcesConfirmedNoResult','officialSourcesNotVerified','officialSourcesSkipped','officialSourcesPartiallyTraversed','entityConfidence','confidence','officialVerificationComplete','stage','officialSourceCoverage','dueDiligenceCoverage','sources'])delete rest[k];return stripUrlFields(rest)}
function EvidenceCard({title,items}:{title:string;items?:string[]}){const list=asArray<string>(items);if(!list.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{title}</CardTitle></CardHeader><CardContent className="space-y-2">{list.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed break-words">• {clean(x)}</div>)}</CardContent></Card>}
// CoverageNote (2026-09-05 v2 — REPLACES OfficialStatusCard and
// PartiallyTraversedCard entirely). Those two cards were the confirmed
// second wave of the same leak: even phrased in natural Georgian, per-source
// status badges and "not fully explored" disclosures are still our own
// technical/automation state being handed to the customer instead of being
// resolved internally. Per the explicit correction ("only show a small
// neutral coverage indicator if product UX genuinely requires it — do not
// make technical failure a headline"), this renders AT MOST one quiet line
// — report.coverageNote — which research-agent only ever populates for the
// single case where literally nothing official was confirmed, and which
// never names a source, a mechanism, or an attempt. Renders nothing at all
// once any official source was confirmed. (report.coverageNote itself is
// server-generated per the request's own `language`, so it needs no t()
// here — this component only decides whether to render it at all.)
function CoverageNote({note}:{note?:string}){if(!note)return null;return <div className="text-xs text-muted-foreground/80 px-1">{clean(note)}</div>}
// OverallAssessmentCard (v30, "REPORT UX" mandate — the new top-of-report
// card): shows the deterministic level badge first, then 3-5 evidence-
// backed key strengths, then at most 4 items still to verify before a
// transaction. This deliberately leads with positives and never phrases
// anything as "safe to buy" or a percentage/guarantee — level is a
// due-diligence-coverage/evidence signal only, computed server-side by
// computeOverallAssessment() from structured signals, never from the
// model's own self-report.
// v31 (Verify mandate item: customer-facing verdict is exactly one of three
// plain-language levels — Positive / Moderately positive / Negative — never
// the code's own 5-tier internal OverallAssessmentLevel vocabulary. This used
// to be patched onto the built artifact after every `npm install` by
// scripts/apply-verify-ux-patch.mjs (which additionally had to hardcode raw
// ka/ru/en strings inline since it could only string-replace this file, not
// add real translation keys); it is now the real source, using proper
// verify_assessment_moderately_positive/verify_assessment_negative i18n keys
// (added alongside the existing verify_assessment_positive key) so every
// supported language — not just ka/ru/en — gets a correct label.
const overallAssessmentLabel=(lvl:OverallAssessmentLevel|undefined,t:(k:string)=>string)=>({VERY_POSITIVE:t('verify_assessment_positive'),POSITIVE:t('verify_assessment_positive'),GENERALLY_POSITIVE:t('verify_assessment_moderately_positive'),NEUTRAL_MIXED:t('verify_assessment_moderately_positive'),ATTENTION_REQUIRED:t('verify_assessment_negative')}[String(lvl||'')]||t('verify_assessment_moderately_positive'));
const overallAssessmentBadgeClass=(lvl:OverallAssessmentLevel|undefined)=>({VERY_POSITIVE:'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/90',POSITIVE:'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/90',GENERALLY_POSITIVE:'border-emerald-300 bg-emerald-50 text-emerald-800',NEUTRAL_MIXED:'border-slate-300 bg-slate-50 text-slate-700',ATTENTION_REQUIRED:'border-transparent bg-destructive text-destructive-foreground'}[String(lvl||'')]||'border-emerald-300 bg-emerald-50 text-emerald-800');
// findingsFromReport() (v36 report-tone rewrite): "მნიშვნელოვანი დასკვნები"
// — a single short list of at most 6 findings, built from the SAME
// materialAdverseFindings signal that drives the badge above (never a
// separate, potentially-contradictory source) plus the model's own
// itemsToVerify. Real adverse findings render in red; everything else
// (items still worth confirming) renders in a calm neutral tone — never
// red merely because a document has not yet been retrieved.
function findingsFromReport(r:Report):{text:string;adverse:boolean}[]{
  const adverse=asArray<any>(r.materialAdverseFindings).map((f:any)=>({text:clean(String(f?.description||f||'')),adverse:true})).filter(f=>f.text);
  const toVerify=asArray<string>(r.overallAssessment?.itemsToVerify).map(x=>({text:clean(x),adverse:false})).filter(f=>f.text);
  return [...adverse,...toVerify].slice(0,6);
}
function OverallAssessmentCard({oa,r}:{oa?:OverallAssessment|null;r:Report}){const{t}=useLanguage();if(!oa||!oa.level)return null;const strengths=asArray<string>(oa.keyStrengths);const findings=findingsFromReport(r);return <Card className="border-2"><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_assessment_title')}</span><Badge className={overallAssessmentBadgeClass(oa.level)}>{overallAssessmentLabel(oa.level,t)}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">{!!strengths.length&&<div className="space-y-1.5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('verify_assessment_strengths_title')}</p>{strengths.map((x,i)=><div key={i} className="text-sm leading-relaxed flex gap-2"><span className="text-emerald-600 shrink-0">✓</span><span>{clean(x)}</span></div>)}</div>}{!!findings.length&&<div className="space-y-1.5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('verify_assessment_findings_title')}</p>{findings.map((f,i)=><div key={i} className={`text-sm leading-relaxed flex gap-2 ${f.adverse?'text-destructive':''}`}><span className={`shrink-0 ${f.adverse?'text-destructive':'text-muted-foreground'}`}>{f.adverse?'⚠':'•'}</span><span>{f.text}</span></div>)}</div>}</CardContent></Card>}
function HistoricalComparisonCard({hc}:{hc?:HistoricalComparison|null}){const{t}=useLanguage();if(!hc?.available)return null;const comparisons=asArray<HistoricalComparisonEntry>(hc.comparisons);if(!comparisons.length)return null;const docLabel=(d:HistoricalDoc)=>clean(d.title)||t('verify_history_document_fallback');return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_history_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{comparisons.map((c,i)=><div key={i} className="text-xs space-y-1 border-b border-border pb-2 last:border-0 last:pb-0"><div className="text-muted-foreground">{docLabel(c.olderDocument)} ({c.olderDocument.date||'—'}) → {docLabel(c.newerDocument)} ({c.newerDocument.date||'—'})</div>{c.changed?<div className="space-y-0.5">{asArray<string>(c.addedInNewer).slice(0,5).map((l,j)=><div key={`a${j}`} className="text-emerald-600">+ {clean(l)}</div>)}{asArray<string>(c.removedFromOlder).slice(0,5).map((l,j)=><div key={`r${j}`} className="text-red-500">− {clean(l)}</div>)}</div>:<div className="text-muted-foreground">{t('verify_history_no_change')}</div>}</div>)}</CardContent></Card>}
function OfficialDocumentsCard({docs}:{docs?:OfficialDocument[]}){const{t}=useLanguage();const list=asArray<OfficialDocument>(docs);if(!list.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_official_docs_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{list.map((d,i)=><div key={i} className="flex items-center justify-between gap-3 p-2 rounded-lg border text-xs min-w-0"><span className="truncate min-w-0">{clean(d.title||d.sourceName||d.source)}{d.date?` · ${d.date}`:''}</span></div>)}</CardContent></Card>}
// TechnicalFactsCard was removed 2026-09-07 (Verify mandate: no
// technical/audit-trail cards in the customer report — see the removal note
// at this file's report-render call site). report.technicalFacts is still
// computed server-side (aggregateTasTechnicalFacts() in research-agent) and
// still feeds RevisionTimelineCard and SYNTHESIS; only this standalone
// dump card is gone.
// RevisionTimelineCard (2026-09-07 "ProjectRevision/block-structure"
// mandate item): report.revisionTimeline is research-agent/index.ts's
// buildRevisionTimeline() output — one entry per official document that
// carried technical facts, in chronological order, ONLY present when at
// least two documents genuinely had two different known dates (see that
// function's own comment: never a fabricated single-entry chronology).
function RevisionTimelineCard({timeline}:{timeline?:RevisionTimelineEntry[]|null}){const{t}=useLanguage();const list=asArray<RevisionTimelineEntry>(timeline);if(!list.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_revision_timeline_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{list.map((entry,i)=><div key={i} className="p-2 rounded-lg border text-xs space-y-1"><div className="flex items-center justify-between gap-2 flex-wrap"><span className="font-medium">{clean(entry.documentTitle)||t('verify_listing_fallback')}</span><span className="text-muted-foreground">{entry.documentDate?clean(entry.documentDate):null}{entry.block?<span> · {t('verify_block_label_prefix')} {clean(entry.block)}</span>:null}</span></div><div className="text-muted-foreground space-y-0.5">{entry.facts.map((f,j)=><div key={j} className="flex justify-between gap-3"><span>{clean(f.key)}</span><span className="font-medium">{clean(f.value)}</span></div>)}</div></div>)}</CardContent></Card>}
// ProjectProfileCard (2026-09-05 v2, mandate: project intelligence must be
// much richer and never show "პროექტი: —" once a project was identified).
function ProjectProfileCard({p}:{p?:ProjectProfile|null}){const{t}=useLanguage();if(!p||!(p.name||p.address||p.developer))return null;const rows:[string,string|undefined|null][]=[[t('verify_project_row_developer'),p.developer],[t('verify_project_row_developer_company'),p.developerCompany],[t('verify_project_row_address'),p.address],[t('verify_project_row_website'),p.website],[t('verify_project_row_buildings'),p.buildings],[t('verify_project_row_floors'),p.floors],[t('verify_project_row_unit_counts'),p.unitCounts],[t('verify_project_row_declared_completion'),p.declaredCompletionTarget],[t('verify_project_row_observed_status'),p.observedConstructionStatus],[t('verify_project_row_architect'),p.architect]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_project_title_prefix')}: {clean(p.name)||'—'}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid sm:grid-cols-2 gap-2 text-sm">{rows.filter(([,v])=>v).map(([k,v])=><div key={k}>{k}: {clean(v as string)}</div>)}</div>{p.commissioningStatus&&<div className="text-sm">{commissioningLabel(p.commissioningStatus,t)}</div>}<EvidenceCard title={t('verify_contractors')} items={p.contractors}/><EvidenceCard title={t('verify_amenities')} items={p.amenities}/><EvidenceCard title={t('verify_additional_facts')} items={p.facts}/></CardContent></Card>}
// CompanyProfileCard (2026-09-05 v2): richer schema (idCode/legalForm/
// registrationDate/status/directors/representatives/historicalChanges/
// relatedProjects) fed by the ENREG closed-loop lookup, never left showing
// only a bare summary once a company has actually been identified.
// sourceBasisLabel (v23, mandate residual gap: ENREG returning
// NO_RESULT_CONFIRMED must never be visually indistinguishable from a real
// registry confirmation just because companyProfile looks detailed —
// research-agent now computes this deterministically, never from the
// model's own self-report).
// sourceBasisLabel/badge (v36 report-tone rewrite): a WEB_RESEARCH_ONLY
// company profile no longer shows a defensive "found via public research,
// not registry-confirmed" badge — that read as a technical caveat, not
// useful customer information. Only the positive REGISTRY_CONFIRMED case
// still gets a small badge; otherwise none is shown at all.
function CompanyProfileCard({c}:{c?:CompanyProfile|null}){const{t}=useLanguage();if(!c||!(c.name||c.idCode))return null;const rows:[string,string|undefined|null][]=[[t('verify_company_row_id_code'),c.idCode],[t('verify_company_row_legal_form'),c.legalForm],[t('verify_company_row_registration_date'),c.registrationDate],[t('verify_company_row_status'),c.status]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_company_title_prefix')}: {clean(c.name)||'—'}</span>{c.sourceBasis==='REGISTRY_CONFIRMED'&&<Badge className="normal-case font-normal border-transparent bg-emerald-600 text-white">{t('verify_source_basis_registry')}</Badge>}</CardTitle></CardHeader><CardContent className="space-y-3">{c.summary&&<p className="text-sm text-muted-foreground">{clean(c.summary)}</p>}<div className="grid sm:grid-cols-2 gap-2 text-sm">{rows.filter(([,v])=>v).map(([k,v])=><div key={k}>{k}: {clean(v as string)}</div>)}</div><EvidenceCard title={t('verify_directors')} items={c.directors}/><EvidenceCard title={t('verify_representatives')} items={c.representatives}/><EvidenceCard title={t('verify_historical_changes')} items={c.historicalChanges}/><EvidenceCard title={t('verify_related_projects')} items={c.relatedProjects}/></CardContent></Card>}
// PublicResearchCard and DiscoveredEntitiesCard were removed 2026-09-07
// (Verify mandate: no technical/audit-trail cards in the customer report —
// see the removal note at this file's report-render call site).
// report.publicResearch/discoveredEntities are still computed and persisted
// server-side (research-agent's PUBLIC_RESEARCH stage / official-worker's
// EntityQueue) for internal/admin diagnostics and still feed SYNTHESIS;
// only these standalone dump cards are gone. PublicResearch/DiscoveredEntity
// remain declared above as they're still part of the Report type.
// PriceDriversCard (mandate: "Market analysis must explain WHY price is
// cheaper/normal/premium"). Purely additive to the existing
// priceEvidence/comparables rendering — never replaces it. `reasoning` is
// already a list of short evidence-backed sentences from the MARKET prompt
// (completion stage, scarcity, financing, materials, etc.), so this is a
// thin label+list wrapper, same shape as every other EvidenceCard-based
// section on this page.
const priceDriverLabel=(p:PriceDrivers['positioning']|undefined,t:(k:string)=>string)=>({DISCOUNT:t('verify_price_driver_cheaper'),MARKET_RANGE:t('verify_price_driver_normal'),PREMIUM:t('verify_price_driver_premium')}[String(p||'')]||t('verify_price_driver_unknown'));
function PriceDriversCard({pd}:{pd?:PriceDrivers|null}){const{t}=useLanguage();const reasoning=asArray<string>(pd?.reasoning);if(!pd||(!pd.positioning&&!reasoning.length))return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_price_drivers_title')}</span>{pd.positioning&&<Badge variant="outline" className="normal-case font-normal">{priceDriverLabel(pd.positioning,t)}</Badge>}</CardTitle></CardHeader><CardContent className="space-y-2">{pd.marketMedianPricePerSqm&&<p className="text-sm text-muted-foreground">{clean(pd.marketMedianPricePerSqm)}/მ²</p>}{reasoning.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed">• {clean(x)}</div>)}</CardContent></Card>}
// MarketRangeCard (report intelligence v2 addendum Section 8): market price
// must read as a RANGE, never one stale fixed number — a developer's
// marketing "starting from" price, the current active-listings range, and a
// historical (expired/removed/sold) reference are always shown as three
// visually distinct figures, never collapsed into one. Renders null (never
// an empty card) when none of the three is available.
type MarketRangeInput={startingPricePerSqm?:string|null;activeMinPricePerSqm?:string|null;activeMedianPricePerSqm?:string|null;activeMaxPricePerSqm?:string|null;activeComparablesUsed?:number;historicalMedianPricePerSqm?:string|null;historicalComparablesUsed?:number};
function MarketRangeCard({m}:{m?:MarketRangeInput|null}){const{t}=useLanguage();if(!m||(!m.startingPricePerSqm&&!m.activeMedianPricePerSqm&&!m.historicalMedianPricePerSqm))return null;return <Card><CardContent className="pt-5 space-y-3">{m.startingPricePerSqm&&<div className="text-sm"><span className="text-muted-foreground">{t('verify_market_starting_price_label')}: </span><span className="font-medium">{clean(m.startingPricePerSqm)}/მ²</span></div>}{m.activeMedianPricePerSqm&&<div className="text-sm"><span className="text-muted-foreground">{t('verify_market_active_range_label')}{m.activeComparablesUsed?` (${m.activeComparablesUsed})`:''}: </span><span className="font-medium">{m.activeMinPricePerSqm&&m.activeMaxPricePerSqm&&m.activeMinPricePerSqm!==m.activeMaxPricePerSqm?`${clean(m.activeMinPricePerSqm)}–${clean(m.activeMaxPricePerSqm)}`:clean(m.activeMedianPricePerSqm)}/მ²</span></div>}{m.historicalMedianPricePerSqm&&<div className="text-xs text-muted-foreground">{t('verify_market_historical_label')}{m.historicalComparablesUsed?` (${m.historicalComparablesUsed})`:''}: {clean(m.historicalMedianPricePerSqm)}/მ²</div>}</CardContent></Card>}
// LegalStatusMatrixCard (mandate item 16): 6 independently evidenced
// categories, each already resolved server-side to one of 4 states with a
// localized label/note — never one broad "clean" conclusion.
const legalStatusBadgeClass=(s:LegalStatusValue)=>({CONFIRMED_POSITIVE:'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/90',CONFIRMED_ATTENTION:'border-transparent bg-destructive text-destructive-foreground',NOT_CONFIRMED:'border-slate-300 bg-slate-50 text-slate-700',HUMAN_VERIFICATION_REQUIRED:'border-amber-300 bg-amber-50 text-amber-800'}[s]);
function LegalStatusMatrixCard({ls}:{ls?:LegalStatusMatrix|null}){const{t}=useLanguage();if(!ls)return null;const rows=Object.values(ls).filter(Boolean);if(!rows.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_legal_status_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map((r,i)=><div key={i} className="flex items-start justify-between gap-2 text-sm"><span className="min-w-0 break-words">{r.label}</span><Badge className={`${legalStatusBadgeClass(r.status)} normal-case font-normal shrink-0`}>{r.note}</Badge></div>)}</CardContent></Card>}
// ManualVerificationActionsCard was removed 2026-09-07 (Verify mandate: no
// technical/audit-trail cards in the customer report — see the removal note
// at this file's report-render call site). report.manualVerificationActions
// is still computed and persisted server-side for internal/admin
// diagnostics; only this standalone dump card is gone.
// ComparablesCard (2026-09-05 v2, mandate: market research must use CONCRETE
// comparables, never only a broad price range). Renders each structured
// comparable as a small row; a `genericSource` comparable (its only URL was
// a bare homepage) never shows a specific price/listingId — those fields
// were already stripped server-side, and here it is visually marked as a
// general lead rather than a specific citation.
// 2026-09-07 market-comparable model (Verify mandate item 7): comparables
// were always collected with a same-project/peer distinction (see
// research-agent/index.ts's MARKET-stage "comparableType") but this card
// used to render them as one flat, unordered list — the tier the backend
// worked out was gathered and then thrown away. COMPARABLE_TIER_ORDER
// renders the three tiers as their own labeled groups, most-relevant
// first, and only for groups that actually have entries.
const COMPARABLE_TIER_ORDER=['SAME_PROJECT','MICRO_LOCATION','PEER_PROJECT'] as const;
const COMPARABLE_TIER_LABEL_KEYS:Record<string,string>={SAME_PROJECT:'verify_comparable_tier_same_project',MICRO_LOCATION:'verify_comparable_tier_micro_location',PEER_PROJECT:'verify_comparable_tier_peer_project'};
// Mirrors research-agent/index.ts's normalizeComparableTier(): a report
// generated before comparableType existed only carries the old boolean
// `sameProject`. Reopening that report (mandate item 5: "old reports open
// with ZERO rerun cost") must still group it sensibly rather than silently
// dropping every legacy comparable into "Other Comparable Projects".
function comparableTier(c:any):'SAME_PROJECT'|'MICRO_LOCATION'|'PEER_PROJECT'{
  if(c?.comparableType==='SAME_PROJECT'||c?.comparableType==='MICRO_LOCATION'||c?.comparableType==='PEER_PROJECT')return c.comparableType;
  if(c?.sameProject===true)return 'SAME_PROJECT';
  return 'PEER_PROJECT';
}
function ComparableRow({c}:{c:Comparable}){const{t}=useLanguage();return <div className="p-2 rounded-lg border text-xs space-y-1"><div className="flex items-center justify-between gap-2"><span className="font-medium">{clean(c.project||c.address)||clean(c.source)||t('verify_listing_fallback')}</span></div><div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">{c.area&&<span>{clean(c.area)}</span>}{c.rooms&&<span>{clean(c.rooms)} {t('verify_rooms_suffix')}</span>}{c.floor&&<span>{t('verify_floor_prefix')} {clean(c.floor)}</span>}{c.condition&&<span>{clean(c.condition)}</span>}{!c.genericSource&&c.price&&<span>{clean(c.price)}{c.currency?` ${clean(c.currency)}`:''}</span>}{!c.genericSource&&c.pricePerSqm&&<span>{clean(c.pricePerSqm)}/მ²</span>}{c.listingDate&&<span>{clean(c.listingDate)}</span>}</div>{c.similarity&&<div className="text-muted-foreground/80">{clean(c.similarity)}</div>}</div>}
function ComparablesCard({comparables}:{comparables?:Comparable[]}){const{t}=useLanguage();const list=asArray<Comparable>(comparables);if(!list.length)return null;const groups=COMPARABLE_TIER_ORDER.map(tier=>({tier,items:list.filter(c=>comparableTier(c)===tier)})).filter(g=>g.items.length>0);return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_comparables_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{groups.map(g=><div key={g.tier} className="space-y-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{t(COMPARABLE_TIER_LABEL_KEYS[g.tier])}</p>{g.items.map((c,i)=><ComparableRow key={i} c={c}/>)}</div>)}</CardContent></Card>}
// MaterialRisksCard was removed 2026-09-06 ("REBUILD THE CUSTOMER REPORT"
// mandate — a standalone risks box that always rendered, even to say
// "nothing found", read as an audit-trail artifact and duplicated what the
// OverallAssessmentCard's findings list above already states once, from
// the same underlying signal. report.materialRisks/report.conflicts are
// still computed and persisted server-side for internal/admin use.
// CaseLinkCard, the auto-attach-to-Transaction-Case behavior, and the
// customer-facing "Refresh Research" CTA were removed on 2026-09-06 per the
// "REMOVE MY DEALS/CASES FROM VERIFY AND FROM PRODUCT NAVIGATION" mandate —
// the CRM/case-attachment flow is no longer part of the customer product.
// Verify's own native history (VerifyHistorySidebar below) is unaffected:
// opening an old report is still a plain status read, zero new provider
// calls. Backend schema/services (transactionCases.ts, research_jobs'
// case_id/supersedes_job_id columns) are left dormant, not deleted.
// VerifyHistorySidebar (mandate section 29 — MANDATORY native left
// sidebar/drawer inside /verify; the /cases product surface it used to be
// described in contrast to has since been removed entirely, see the
// 2026-09-06 "REMOVE MY DEALS/CASES" mandate). Uses the shadcn `Sheet`
// component (side="left"), which already renders as a full-height slide-over
// on both desktop and mobile — a collapsible sidebar on a wide viewport, a
// drawer on a narrow one, from the same markup. Lists EVERY research run
// this user has ever started. Opening an entry
// is always openJob() -> a plain status read, never a rerun; Rename/Delete
// go through renameResearchJob()/softDeleteResearchJob() (soft delete only —
// see the migration's own header comment for why a real DELETE is never
// issued).
type HistoryTypeFilter='all'|'property'|'cadastral';
function VerifyHistorySidebar({open,onOpenChange,items,loading,activeJobId,onOpenJob,onRename,onDelete}:{open:boolean;onOpenChange:(v:boolean)=>void;items:ResearchJobRecord[];loading:boolean;activeJobId:string|null;onOpenJob:(id:string)=>void;onRename:(id:string,title:string)=>void;onDelete:(id:string)=>void}){
  const{t}=useLanguage();
  const[q,setQ]=useState('');
  const[typeFilter,setTypeFilter]=useState<HistoryTypeFilter>('all');
  const[renamingId,setRenamingId]=useState<string|null>(null);
  const[renameValue,setRenameValue]=useState('');
  const[confirmDeleteId,setConfirmDeleteId]=useState<string|null>(null);
  useEffect(()=>{if(!open){setQ('');setRenamingId(null);setConfirmDeleteId(null)}},[open]);
  const needle=q.trim().toLowerCase();
  // Already newest-first from listVerifyHistory's own ORDER BY — filtering
  // here never re-sorts, so "sort newest-first" always holds.
  const filtered=items.filter(j=>{
    if(typeFilter!=='all'&&j.mode!==typeFilter)return false;
    if(!needle)return true;
    const hay=[j.title,j.query,j.entity_name,j.project_name,j.address,j.developer_name,j.company_name].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="left" className="w-full sm:max-w-md flex flex-col gap-3"><SheetHeader><SheetTitle>{t('verify_history_sidebar_title')}</SheetTitle></SheetHeader>
    <Input value={q} onChange={e=>setQ(e.target.value)} placeholder={t('verify_history_search_ph')}/>
    <Tabs value={typeFilter} onValueChange={v=>setTypeFilter(v as HistoryTypeFilter)}><TabsList className="grid grid-cols-3 w-full"><TabsTrigger value="all">{t('verify_history_filter_all')}</TabsTrigger><TabsTrigger value="property">{t('verify_tab_property')}</TabsTrigger><TabsTrigger value="cadastral">{t('verify_tab_cadastral')}</TabsTrigger></TabsList></Tabs>
    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
      {loading?<p className="text-xs text-muted-foreground px-1">{t('verify_history_loading')}</p>:filtered.length===0?<p className="text-xs text-muted-foreground px-1">{t('verify_report_history_empty')}</p>:filtered.map(j=>{
        const title=j.title||j.entity_name||j.project_name||j.query;
        const isActive=j.id===activeJobId;
        return <div key={j.id} className={`rounded-lg border p-2 space-y-1.5 text-xs ${isActive?'border-primary bg-primary/5':'border-border'}`}>
          {renamingId===j.id?<div className="flex items-center gap-1"><Input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)} className="h-7 text-xs" onKeyDown={e=>{if(e.key==='Enter'){onRename(j.id,renameValue);setRenamingId(null)}if(e.key==='Escape')setRenamingId(null)}}/><Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={()=>{onRename(j.id,renameValue);setRenamingId(null)}}>{t('verify_history_save')}</Button><Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={()=>setRenamingId(null)}>{t('verify_history_cancel')}</Button></div>:<button type="button" onClick={()=>onOpenJob(j.id)} className="text-start w-full font-medium truncate hover:text-primary">{clean(title)||t('verify_untitled_case_title')}{isActive&&<span className="ml-2 text-muted-foreground font-normal">({t('verify_report_history_current_badge')})</span>}</button>}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground">
            <span>{j.mode==='cadastral'?t('verify_tab_cadastral'):t('verify_tab_property')}</span>
            {(j.project_name||j.address)&&<span className="truncate max-w-[10rem]">{clean(j.project_name||j.address||'')}</span>}
            {j.company_name&&<span className="truncate max-w-[8rem]">{clean(j.company_name)}</span>}
            <span>{j.status}</span>
            {j.coverage_level&&<span>{coverageLabel(j.coverage_level||undefined,t)}</span>}
            {j.outstanding_count!=null&&j.outstanding_count>0&&<span>{t('verify_history_outstanding_prefix')} {j.outstanding_count}</span>}
            {j.supersedes_job_id&&<span>{t('verify_history_version_badge')}</span>}
            <span>{new Date(j.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" className="text-muted-foreground hover:text-primary flex items-center gap-1" onClick={()=>{setRenamingId(j.id);setRenameValue(j.title||'')}}><Pencil className="h-3 w-3"/>{t('verify_history_rename')}</button>
            {confirmDeleteId===j.id?<span className="flex items-center gap-1.5"><span className="text-destructive">{t('verify_history_delete_confirm')}</span><button type="button" className="text-destructive font-medium" onClick={()=>{onDelete(j.id);setConfirmDeleteId(null)}}>{t('verify_history_delete_confirm_yes')}</button><button type="button" className="text-muted-foreground" onClick={()=>setConfirmDeleteId(null)}>{t('verify_history_cancel')}</button></span>:<button type="button" className="text-muted-foreground hover:text-destructive flex items-center gap-1" onClick={()=>setConfirmDeleteId(j.id)}><Trash2 className="h-3 w-3"/>{t('verify_history_delete')}</button>}
          </div>
        </div>
      })}
    </div>
  </SheetContent></Sheet>
}
export default function VerifyPage(){const nav=useNavigate();const{lang,t}=useLanguage();const{homatchUser,supaUser}=useAuth();const[searchParams,setSearchParams]=useSearchParams();
// v31 (Verify mandate: remove the Property/ქონება selector from Verify's
// input — cadastral-code entry only). `mode` used to be user-switchable
// state (a Tabs selector with 'property'/'cadastral' triggers) that
// defaulted to 'property'; it is now a fixed constant. Kept as a `Mode`-
// typed value (not inlined as a literal everywhere) because `Mode` and
// mode-keyed logic below (the cadastral-regex `valid` check, the
// `type:mode` sent to research-agent, the entityType fallback badge, the
// query placeholder) and the history sidebar's own type filter are
// unchanged and still expect a `Mode` value — only the ability for the
// customer to pick 'property' via the UI is removed. Existing 'property'-
// mode research_jobs rows from before this change still open and render
// normally (VerifyHistorySidebar's history list is untouched).
const mode:Mode='cadastral';const[query,setQuery]=useState('');const[loading,setLoading]=useState(false);const[report,setReport]=useState<Report|null>(null);const[err,setErr]=useState<string|null>(null);const[captcha,setCaptcha]=useState<Report|null>(null);const[jobId,setJobId]=useState<string|null>(null);const[progress,setProgress]=useState<any>(null);const[synthesis,setSynthesis]=useState<VerifySynthesis|null>(null);const[synthesisLoading,setSynthesisLoading]=useState(false);
/* THE SERVER'S VIEW OF THIS RUN, kept verbatim.
   created_at is the ONLY authoritative start time — the run belongs to the
   server, not to this component's mount, so a customer returning after
   twelve minutes sees 12:00 and not 00:00. stage/status drive the
   estimated percentage, which is reconstructed rather than remembered and
   therefore cannot reset. See src/verify/progress.ts. */
const[jobMeta,setJobMeta]=useState<{status?:string;stage?:string;created_at?:string;completed_at?:string}|null>(null);const[stopping,setStopping]=useState(false);const[confirmStop,setConfirmStop]=useState(false);const recovered=useRef(false);
// HUMAN-VERIFICATION HANDOFF (2026-09-09). When a source refuses our NETWORK
// rather than presenting a solvable puzzle, the server-browser CAPTCHA screen
// is useless — a screenshot does not change the source IP. In that case the
// customer is offered the same public lookup in their OWN browser instead.
// `handoff` being non-null suppresses the CAPTCHA modal entirely so the two
// are never shown at once.
const[handoff,setHandoff]=useState<HandoffOffer|null>(null);
const[handoffBusy,setHandoffBusy]=useState(false);
const[handoffErr,setHandoffErr]=useState<string|null>(null);
const[savingCase,setSavingCase]=useState(false);
const[caseId,setCaseId]=useState<string|null>(null);
// pollNotice (v33, P0 incident 2026-09-07): a calm, non-alarming status-line
// shown ONLY while a transient status-poll error is being silently retried
// in the background — the existing progress card/percentage/report/captcha
// state is left completely untouched while this is set. Deliberately a
// separate piece of state from `err` (which still means "Verify has
// terminally failed, show the red error box") so the two can never be
// confused in the render below. transientRetryCount is a ref, not state —
// it is pure internal retry bookkeeping for computeTransientPollBackoffMs()
// and must never itself trigger a re-render.
const[pollNotice,setPollNotice]=useState<string|null>(null);const transientRetryCount=useRef(0);
const[sidebarOpen,setSidebarOpen]=useState(false);const[allHistory,setAllHistory]=useState<ResearchJobRecord[]>([]);const[allHistoryLoading,setAllHistoryLoading]=useState(false);const timer=useRef<any>(null);const busy=useRef(false);const valid=mode==='cadastral'?/^\d+(\.\d+){3,}$/.test(query.trim()):query.trim().length>=2;const stop=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null}busy.current=false};const schedule=(id:string,ms=2200)=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>check(id),ms)};
// check() (v33 rewrite, P0 incident 2026-09-07, job
// 533a8c19-f160-4f06-ab27-517c1f661b86): the same status poll used to treat
// ANY thrown error — including a transient 500/network failure while the
// backend job was genuinely still RUNNING — as terminal (stop polling,
// blank the loading UI, show the red error box). It now classifies the
// failure via classifyFunctionInvokeError() and only ever terminates the
// job for AUTH/CONFIG/TERMINAL categories or once a TRANSIENT failure has
// exceeded MAX_TRANSIENT_POLL_RETRIES — jobId/progress/report/captcha are
// never touched on a transient failure, so a refresh or the next
// successful poll reconnects to exactly the same job with no duplicate
// Verify ever created.
const check=async(id:string)=>{if(!id||busy.current)return;busy.current=true;let again=true;try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'status',jobId:id,language:lang}});if(error)throw error;if(data?.error){
  // A 2xx response body carrying `error` only happens for a job the backend
  // has already marked terminally FAILED — sanitizeForCustomer() strips
  // `error` from every non-FAILED/non-COMPLETE job (the matching v32
  // backend fix for this same incident) — so this is always a genuine
  // terminal failure, never a transient one, regardless of message content.
  again=false;stop();setLoading(false);setPollNotice(null);transientRetryCount.current=0;setErr(data.error||t('verify_err_research_failed'));return
}
// A poll that reached this point got a real, well-formed response — clear
// any stale "retrying…" notice and reset the transient-retry counter right
// away (regression requirement: a stale error/notice must be cleared the
// moment recovery succeeds, not on the next poll after that).
setPollNotice(null);transientRetryCount.current=0;
if(data?.progress)setProgress(data.progress);setJobMeta({status:data?.status,stage:data?.stage,created_at:data?.created_at,completed_at:data?.completed_at});/* An explicit stop is not a failure and must never be shown as one. */if(data?.status==='CANCELLED'){again=false;stop();setLoading(false);setCaptcha(null);setPollNotice(null);return}if(data?.status==='FAILED'){again=false;stop();setLoading(false);setErr(data.error||t('verify_err_research_failed'));return}if(data?.status==='WAITING_HUMAN'){again=false;stop();setLoading(false);const r=data.result_json||{};const src=String(data?.captcha?.source||data?.verification_site||r.verificationSite||'');const wjid=r.workerJobId||r.officialWorkerJobId||r?._worker?.jobId||data?.progress?.workerJobId||data?.captcha?.workerJobId;const turl=data?.captcha?.url||r.verificationUrl||null;setCaptcha({...r,jobId:id,workerJobId:wjid,verificationSite:src,verificationUrl:turl});/* The customer NEVER solves a challenge in the worker browser. Every human-required stop goes to the handoff decision now; the old `networkBlocked===true` gate is exactly what routed an ordinary CAPTCHA into the streamed Railway Chromium. */void offerHandoff(id,src,data?.captcha?.networkBlocked===true||r?.captchaNetworkBlocked===true,wjid,turl);return}if(data?.status==='COMPLETE'&&data.result_json){again=false;stop();setCaptcha(null);setReport(data.result_json);
  /* RESEARCH COMPLETE IS NOT REPORT READY.
     setLoading(false) used to fire here, so the moment research finished the
     customer saw a finished-looking page whose report had not been written
     yet — a success state with nothing in it. Loading now stays true until
     loadSynthesis() settles, and the stream switches to its synthesis row so
     the wait is described honestly rather than looking stuck. */
  void loadSynthesis(id).finally(()=>setLoading(false));/* The verification persists BY ITSELF. A finished check is not a thing the customer then has to file somewhere else: createDealRoomFromVerify() is idempotent and reuses the existing case for this property, so the run simply becomes — or continues — that property's Verification Case. Failure is silent on purpose: the report on screen is still complete and correct, and the button below offers the save again. */void saveCase(id,data.result_json);return}}catch(e:any){const{message,category}=await classifyFunctionInvokeError(e,t('verify_err_status_fetch_failed'));if(category==='TRANSIENT'&&transientRetryCount.current<MAX_TRANSIENT_POLL_RETRIES){
  // The core P0 fix: keep the existing progress UI exactly as it is, show a
  // calm notice instead of the red error box, and keep polling with
  // backoff — never stop(), never setLoading(false), never touch jobId/
  // progress/report/captcha.
  transientRetryCount.current+=1;setPollNotice(t('verify_status_poll_retrying'));busy.current=false;schedule(id,computeTransientPollBackoffMs(transientRetryCount.current));return
}again=false;stop();setLoading(false);setPollNotice(null);setErr(message)}finally{busy.current=false}if(again)schedule(id)};useEffect(()=>()=>stop(),[]);
// openJob(): the entire "open an old report without rerunning research"
// requirement — this calls check(), which only ever performs a `status`
// read against the existing research_jobs row (research-agent's status
// action never re-runs anything). Used both to reopen ?job=<id> on mount
// (refresh survival) and to open any entry from the report-history list.
// openJob(id, push): `push` defaults to false (replace) for the two
// call sites that are syncing state to a URL that already names this job
// (the mount-time restore effect below, and the mid-poll reconnect at line
// ~462) — those must never grow the history stack. A user DELIBERATELY
// choosing to view a different, already-completed job from the history
// sidebar (handleSidebarOpenJob) passes push:true instead, so the browser
// Back/Forward buttons can actually step between the research jobs the
// user has browsed in this session — before this, every job switch used
// {replace:true} unconditionally and Back/Forward had no history entries
// to move between at all.
/* The one authoritative customer-facing report. verify-synthesis builds a
   tiered evidence package from the WHOLE research result and asks the model to
   reason over it as an analyst would, then validates every citation back
   against that package: a claim citing evidence that does not exist is
   discarded and a deterministic report is returned instead. A provider outage
   degrades the wording, never the report, so this endpoint does not fail --
   but if it ever does, the raw evidence below is still rendered rather than
   leaving the customer with nothing. */
const loadSynthesis=async(id:string)=>{setSynthesisLoading(true);try{const{data,error}=await supabase.functions.invoke('verify-synthesis',{body:{jobId:id}});if(error||data?.error||!data)throw new Error('synthesis unavailable');setSynthesis(data as VerifySynthesis)}catch(e){console.error('[Verify] synthesis unavailable:',e);setSynthesis(null)}finally{setSynthesisLoading(false)}};
/* THE ONLY CANCELLATION.
   Navigating away, refreshing, backgrounding the tab and closing the browser
   are not cancellation and never reach this. A cancelled run is CANCELLED,
   not FAILED, and everything already collected is kept. */
const doStop=async()=>{const id=jobId;if(!id)return;setStopping(true);try{
const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'cancel',jobId:id,language:lang}});
if(error)throw error;if(data?.error)throw new Error(data.error);
stop();setLoading(false);setCaptcha(null);setPollNotice(null);
setJobMeta(m=>({...(m||{}),status:'CANCELLED'}))}
catch(e:any){setErr(await resolveFunctionErrorMessage(e,t('verify_err_stop_failed')))}
finally{setStopping(false);setConfirmStop(false)}};
const openJob=(id:string,push=false)=>{stop();setErr(null);setPollNotice(null);transientRetryCount.current=0;setCaptcha(null);setReport(null);setSynthesis(null);setJobId(id);setJobMeta(null);setLoading(true);/* No fabricated percent here. openJob() knows nothing about this run yet;
   the first status poll supplies created_at and stage, and the estimate is
   computed from those. Guessing 30% would be the old lie in a new place. */setProgress(null);const params=new URLSearchParams(searchParams);params.set('job',id);setSearchParams(params,{replace:!push});check(id)};
useEffect(()=>{const urlJob=searchParams.get('job');if(urlJob)openJob(urlJob);
// eslint-disable-next-line react-hooks/exhaustive-deps
},[]);
/* REATTACH TO A RUN THAT IS STILL GOING.
   `run()` can only put ?job= in the URL AFTER research-agent answers, and
   starting a job is not instant. A remount inside that window — an auth
   refresh, a route re-key — used to leave the customer on an empty landing
   page while their verification carried on without any representation at
   all: server job live, no UI, no report, no error. That state is now
   unreachable, because a page with no job named in its URL asks the server
   whether this user already has one running.
   Deliberately ONLY when nothing was named. Opening a specific case from
   History binds to that exact case and never consults this. */
useEffect(()=>{if(recovered.current)return;if(searchParams.get('job')){recovered.current=true;return}
if(!supaUser)return;recovered.current=true;void(async()=>{try{const{data}=await supabase.from('research_jobs')
.select('id').eq('user_id',supaUser.id).in('status',['CREATED','RUNNING','WAITING_HUMAN'])
.is('deleted_at',null).is('cancelled_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle();
if(data?.id)openJob(data.id)}catch{/* best effort: a failed lookup must not block the landing page */}})();
// eslint-disable-next-line react-hooks/exhaustive-deps
},[supaUser]);
const run=async()=>{if(!valid)return;stop();setLoading(true);setErr(null);setPollNotice(null);transientRetryCount.current=0;setReport(null);setSynthesis(null);setCaptcha(null);setJobId(null);setJobMeta(null);setProgress(null);try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'start',query:query.trim(),type:mode,language:lang}});if(error)throw error;if(data?.error)throw new Error(data.error);const id=String(data?.jobId||data?.id||'');if(!id)throw new Error(t('verify_err_no_job_id'));setJobId(id);
// v26 fix: write ?job=<id> the moment the job exists — not only once it
// completes, so a mid-run refresh reconnects to the RUNNING job (mandate
// test M), not just a COMPLETE one.
{const params=new URLSearchParams(searchParams);if(params.get('job')!==id){params.set('job',id);setSearchParams(params,{replace:true})}}
if(data?.progress)setProgress(data.progress);schedule(id,500)}catch(e:any){setLoading(false);setErr(await resolveFunctionErrorMessage(e,t('verify_err_start_failed')))}};

// Asks the server what should happen for this source. Advisory only: it
// creates no state unless the answer is USER_SIDE_HANDOFF, and any failure
// falls through to today's behaviour (the server-browser CAPTCHA screen).
const offerHandoff=async(id:string,sourceKey:string,networkRefusal:boolean,workerJobId?:string|null,targetUrl?:string|null)=>{if(!id||!sourceKey){void skip();return}try{const{data}=await supabase.functions.invoke('verification-handoff',{body:{action:'mint',jobId:id,sourceKey,status:'CAPTCHA_REQUIRED',networkRefusal,workerJobId:workerJobId??null,targetUrl:targetUrl??null}});if(data?.handoff?.nonce){setHandoff({handoffId:data.handoff.id,nonce:data.handoff.nonce,targetUrl:data.handoff.targetUrl||targetUrl||null,sourceName:sourceKey,expiresAt:data.handoff.expiresAt,serverCanContinue:data?.plan?.serverCanContinue===true});return}/* No handoff is possible for this source (SESSION_BOUND, missing inputs, or already attempted). Skipping is honest and safe -- a skipped source produces no evidence, so it cannot move the verdict. What must never happen is falling back to the worker browser. */void skip()}catch{void skip()}};
// Best-effort lifecycle record: PENDING -> OPENED. A failure here must
// never block the customer from doing the verification.
const openHandoff=async()=>{if(!handoff)return;try{await supabase.functions.invoke('verification-handoff',{body:{action:'open',handoffId:handoff.handoffId}})}catch{/* non-blocking */}};
const completeHandoff=async(reference:string)=>{if(!handoff?.nonce)return;setHandoffBusy(true);setHandoffErr(null);const canContinue=handoff.serverCanContinue===true;try{const{data,error}=await supabase.functions.invoke('verification-handoff',{body:{action:'complete',nonce:handoff.nonce,result:{confirmed:true,reference}}});if(error||data?.error)throw new Error('failed');setHandoff(null);/* The worker's own Chromium still holds an unsolved challenge for this source -- the customer solved it on the real site, in their browser, not in ours. Resuming that session would walk straight back into the same challenge. For every source whose spec says serverCanContinue=false (all of rstax/enreg/debtor today) the correct move is to release that one source and let the run continue; the redeemed handoff row is the record of what the customer verified. Only a source that really can be continued server-side gets resume(). */if(canContinue){await resume()}else{await skip()}}catch{setHandoffErr(t('handoff_expired'))}finally{setHandoffBusy(false)}};
// Declining skips ONLY this source. Verify continues, and a skipped source
// contributes no evidence, so it can never become a negative finding.
const cancelHandoff=async()=>{if(!handoff)return;setHandoffBusy(true);try{await supabase.functions.invoke('verification-handoff',{body:{action:'cancel',handoffId:handoff.handoffId}})}catch{/* cancelling is best-effort */}finally{setHandoff(null);setHandoffBusy(false);await skip()}};
// saveCase(): persists this run as the property's Verification Case and
// remembers its id so the report can offer to continue there. It does NOT
// navigate — the customer is reading their report, and moving them off it
// the moment it finishes is exactly the 'now a different app starts'
// hand-off this product no longer has. Called automatically on completion,
// and again from the button if that automatic attempt failed.
const saveCase=async(jid?:string,rep?:Report)=>{const id=jid||jobId||report?.jobId;const r=rep||report;if(!id||!r)return;setSavingCase(true);try{const{room}=await createDealRoomFromVerify({jobId:id,report:r});setCaseId(room.id)}catch{/* left to the explicit button below; the report itself is unaffected */}finally{setSavingCase(false)}};
// The report closes by inviting the customer to upload their contract. It
// must land in the SAME place a document uploaded from the Verification
// Center lands -- the case's Documents tab -- so there is one document
// architecture, not two. If the case has not been persisted yet (the
// automatic save failed, or is still in flight), save it first and then go.
const openContractUpload=async()=>{let id=caseId;if(!id){await saveCase();id=caseId}
  // saveCase() sets state asynchronously, so re-read the room rather than
  // trusting the closure; if it still is not there, the Center's own upload
  // control is the correct fallback.
  if(id){nav(`/verify/${id}?tab=documents`)}else{nav('/verify')}};
const resume=async()=>{const id=captcha?.jobId||jobId;if(!id)return;setCaptcha(null);setLoading(true);setErr(null);setPollNotice(null);transientRetryCount.current=0;setProgress({phase:'resuming',percent:72});try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'resume',jobId:id,language:lang,humanVerificationCompleted:true}});if(error)throw error;if(data?.error)throw new Error(data.error);schedule(id,500)}catch(e:any){setLoading(false);setErr(await resolveFunctionErrorMessage(e,t('verify_err_resume_failed')))}};
const skip=async()=>{const id=captcha?.jobId||jobId;if(!id)return;setCaptcha(null);setLoading(true);setErr(null);setPollNotice(null);transientRetryCount.current=0;setProgress({phase:'resuming',percent:72});try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'skip',jobId:id,language:lang}});if(error)throw error;if(data?.error)throw new Error(data.error);schedule(id,500)}catch(e:any){setLoading(false);setErr(await resolveFunctionErrorMessage(e,t('verify_err_skip_failed')))}};
// openVerifyHistorySidebar(): the global "browse every research run I've ever
// started" sidebar (mandate section 29). Always a plain SELECT
// (listVerifyHistory), never a research-agent call — opening the sidebar
// itself never costs anything.
// v26 fix: research_jobs.user_id is the raw Supabase AUTH uid (written
// server-side by research-agent via `sb.auth.getUser(...)`), NOT
// public.users.id (homatchUser.id) — a different, unrelated UUID space.
// listVerifyHistory MUST be called with supaUser.id (the auth uid); calling
// it with homatchUser.id, as before, filtered on a column value that could
// never match any row for any user, so the sidebar was silently empty for
// every completed research run, always. See also the case-link trigger fix
// in supabase/migrations/20260906140000_fix_research_case_user_id_space.sql
// for the same id-space bug on the /cases side of this feature.
const openVerifyHistorySidebar=async()=>{setSidebarOpen(true);if(!supaUser)return;setAllHistoryLoading(true);try{setAllHistory(await listVerifyHistory(supaUser.id))}catch{/* best-effort — an empty sidebar list is not worth surfacing as an error */}finally{setAllHistoryLoading(false)}};
const handleSidebarOpenJob=(id:string)=>{setSidebarOpen(false);openJob(id,true)};
const handleSidebarRename=async(id:string,title:string)=>{setAllHistory(prev=>prev.map(j=>j.id===id?{...j,title:title.trim()||null}:j));try{await renameResearchJob(id,title)}catch{if(supaUser)try{setAllHistory(await listVerifyHistory(supaUser.id))}catch{/* keep optimistic state */}}};
const handleSidebarDelete=async(id:string)=>{setAllHistory(prev=>prev.filter(j=>j.id!==id));try{await softDeleteResearchJob(id)}catch{if(supaUser)try{setAllHistory(await listVerifyHistory(supaUser.id))}catch{/* keep optimistic state */}}};
// startNewResearch() (mandate section 5 — "+ ახალი კვლევა", a ChatGPT-style
// New Chat affordance): clears every piece of in-progress/completed-report
// state AND the `?job=` URL param together, so the page returns to exactly
// its fresh-landing state regardless of whether a report, an in-progress
// poll, or a CAPTCHA prompt was showing. Never touches allHistory/the
// sidebar — a fresh search still appears there once it itself completes.
// pushes a new history entry (not replace) when actually leaving a shown
// job — same back/forward reasoning as openJob(id,true) above: a user
// clicking away from a report they were viewing should be able to hit
// Back and land on that report again, not skip past /verify entirely.
const startNewResearch=()=>{stop();setErr(null);setPollNotice(null);transientRetryCount.current=0;setCaptcha(null);setReport(null);setSynthesis(null);setJobId(null);setCaseId(null);setLoading(false);setProgress(null);setQuery('');const params=new URLSearchParams(searchParams);if(params.has('job')){params.delete('job');setSearchParams(params,{replace:false})}};
return <AppLayout>{homatchUser&&<VerifyHistorySidebar open={sidebarOpen} onOpenChange={setSidebarOpen} items={allHistory} loading={allHistoryLoading} activeJobId={jobId} onOpenJob={handleSidebarOpenJob} onRename={handleSidebarRename} onDelete={handleSidebarDelete}/>}<div className="max-w-4xl mx-auto space-y-5 pb-16">{handoff&&<HumanVerificationHandoff offer={handoff} onComplete={completeHandoff} onCancel={cancelHandoff} onOpen={openHandoff} busy={handoffBusy} error={handoffErr}/>}<div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0"/><h1 className="text-xl sm:text-2xl font-bold break-words">{t('verify_title')}</h1></div><p className="text-sm text-muted-foreground mt-1 break-words">{t('verify_page_subtitle')}</p></div><div className="flex flex-wrap items-center gap-2">{(report||jobId||captcha||query)&&<Button variant="outline" size="sm" onClick={startNewResearch} className="shrink-0">{t('verify_new_research_button')}</Button>}{homatchUser&&<Button variant="outline" size="sm" onClick={openVerifyHistorySidebar} className="shrink-0"><History className="h-3.5 w-3.5 mr-1.5"/>{t('verify_history_sidebar_button')}</Button>}</div>
{/* v31: the Property/ქონება Tabs selector that used to sit here was removed
    (Verify mandate — cadastral-code entry only, see the `mode` comment
    above). The input below now always uses the cadastral placeholder/regex
    since `mode` is permanently 'cadastral'. */}
</div><Card><CardContent className="pt-5"><div className="flex flex-col gap-2 sm:flex-row"><Input className="min-w-0 flex-1" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&valid&&!loading&&run()} placeholder={t('verify_cadastral_query_ph')}/><Button className="w-full sm:w-auto shrink-0" onClick={()=>run()} disabled={!valid||loading}>{loading?<Loader2 className="h-4 w-4 animate-spin"/>:<><Search className="h-4 w-4 mr-2"/>{t('verify_search_button')}</>}</Button></div></CardContent></Card>{/* The deep-research NOTE lives HERE — in normal document flow, directly
    under the action it explains, and above every result/progress block — not
    as a fixed bottom-pinned overlay (see ResearchDepthNotice.tsx's header).
    The parent's space-y-5 gives it clear separation above and below in every
    state. */}<ResearchDepthNotice/>{/* THE VERIFICATION CENTER LANDING STATE. Only while
    nothing is in flight: a customer watching their own check run, or reading
    the report it produced, must not have a list of other properties competing
    for the same screen. Signed-out visitors can still run a check — they just
    have nothing saved to come back to, and the case list is owner-only under
    RLS regardless of what renders. */}{homatchUser&&!report&&!loading&&!captcha&&!jobId&&<><StartFromDocument/><VerificationCaseList/></>}{err&&<div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive break-words">{err}</div>}{loading&&<ResearchStream status={jobMeta?.status} stage={jobMeta?.stage} createdAt={jobMeta?.created_at} completedAt={jobMeta?.completed_at} reportReady={!!synthesis} result={report} subject={query||report?.exactUnit?.code||null} synthesizing={!!report&&synthesisLoading} onStop={()=>setConfirmStop(true)} stopping={stopping}/>}{jobMeta?.status==='CANCELLED'&&!loading&&<div className="p-4 rounded-xl border border-border bg-card/60 text-sm space-y-1"><p className="font-medium">{t('verify_stopped_title')}</p><p className="text-muted-foreground break-words">{t('verify_stopped_body')}</p></div>}<AlertDialog open={confirmStop} onOpenChange={setConfirmStop}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('verify_stop_confirm_title')}</AlertDialogTitle><AlertDialogDescription>{t('verify_stop_confirm_body')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('verify_stop_confirm_keep')}</AlertDialogCancel><AlertDialogAction onClick={()=>{void doStop()}}>{t('verify_stop_confirm_stop')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>{loading&&pollNotice&&<p className="text-xs text-muted-foreground">{pollNotice}</p>}{report&&!loading&&<div className="space-y-4"><Card><CardContent className="pt-5 space-y-2"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-semibold break-words">{clean(report.entityName)||query}</h2><Badge variant="outline">{report.entityType||mode}</Badge></div>{report.exactUnit?.code&&<p className="text-sm font-medium break-all">{report.exactUnit.code}</p>}</CardContent></Card>{synthesis?<VerifyReport synthesis={synthesis} onUploadContract={()=>{void openContractUpload()}} evidence={<div className="space-y-4"><Card><CardContent className="pt-5 space-y-3"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-semibold">{clean(report.entityName)||query}</h2><Badge variant="outline">{report.entityType||mode}</Badge></div><p className="text-sm text-muted-foreground leading-relaxed">{clean(report.summary)}</p><CoverageNote note={report.coverageNote}/></CardContent></Card>{(report.identifiedParent||report.exactUnit)&&<IdentifiedPropertyCard identifiedParent={report.identifiedParent} exactUnit={report.exactUnit} projectProfile={report.projectProfile}/>}<ReconciledIdentityCard ri={report.reconciledIdentity}/><ProjectProfileCard p={report.projectProfile}/><UtilitiesMatrixCard u={report.utilitiesMatrix}/><LandProfileCard lp={report.landProfile}/><RightsAndRestrictionsCard rr={report.rightsAndRestrictions}/><LegalStatusMatrixCard ls={report.legalStatus}/>{/* v31: ManualVerificationActionsCard/TechnicalFactsCard/PublicResearchCard/
    DiscoveredEntitiesCard permanently removed from the customer report (Verify
    mandate: no technical/audit-trail clutter in the customer-facing view).
    This used to be done post-build by scripts/apply-verify-ux-patch.mjs
    string-deleting these 4 render lines from the built artifact only, leaving
    them present (just unreached) in checked-in source. The component
    functions themselves are left defined below, unused, since
    report.manualVerificationActions/technicalFacts/publicResearch/
    discoveredEntities are still computed and persisted server-side for
    internal/admin diagnostics per that file's own header comment — only the
    customer-facing render is removed here. */}<OfficialDocumentsCard docs={report.officialDocumentsRetrieved}/><RevisionTimelineCard timeline={report.revisionTimeline}/><HistoricalComparisonCard hc={report.historicalComparison}/><CompanyProfileCard c={report.companyProfile}/><EvidenceCard title={t('verify_official_evidence_title')} items={report.officialEvidence}/><MarketRangeCard m={report.market}/><ComparablesCard comparables={report.market?.comparables}/><PriceDriversCard pd={report.market?.priceDrivers}/><EvidenceCard title={t('verify_market_extra_info_title')} items={report.market?.priceEvidence}/><EvidenceCard title={t('verify_public_evidence_title')} items={report.publicEvidence}/><EvidenceCard title={t('verify_positive_reviews_title')} items={report.reviews?.positive}/><EvidenceCard title={t('verify_negative_reviews_title')} items={report.reviews?.negative}/></div>}/>:<div className="space-y-4"><OverallAssessmentCard oa={report.overallAssessment} r={report}/><Card><CardContent className="pt-5 space-y-3"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-semibold">{clean(report.entityName)||query}</h2><Badge variant="outline">{report.entityType||mode}</Badge></div><p className="text-sm text-muted-foreground leading-relaxed">{clean(report.summary)}</p><CoverageNote note={report.coverageNote}/></CardContent></Card>{(report.identifiedParent||report.exactUnit)&&<IdentifiedPropertyCard identifiedParent={report.identifiedParent} exactUnit={report.exactUnit} projectProfile={report.projectProfile}/>}<ReconciledIdentityCard ri={report.reconciledIdentity}/><ProjectProfileCard p={report.projectProfile}/><UtilitiesMatrixCard u={report.utilitiesMatrix}/><LandProfileCard lp={report.landProfile}/><RightsAndRestrictionsCard rr={report.rightsAndRestrictions}/><LegalStatusMatrixCard ls={report.legalStatus}/>{/* v31: ManualVerificationActionsCard/TechnicalFactsCard/PublicResearchCard/
    DiscoveredEntitiesCard permanently removed from the customer report (Verify
    mandate: no technical/audit-trail clutter in the customer-facing view).
    This used to be done post-build by scripts/apply-verify-ux-patch.mjs
    string-deleting these 4 render lines from the built artifact only, leaving
    them present (just unreached) in checked-in source. The component
    functions themselves are left defined below, unused, since
    report.manualVerificationActions/technicalFacts/publicResearch/
    discoveredEntities are still computed and persisted server-side for
    internal/admin diagnostics per that file's own header comment — only the
    customer-facing render is removed here. */}<OfficialDocumentsCard docs={report.officialDocumentsRetrieved}/><RevisionTimelineCard timeline={report.revisionTimeline}/><HistoricalComparisonCard hc={report.historicalComparison}/><CompanyProfileCard c={report.companyProfile}/><EvidenceCard title={t('verify_official_evidence_title')} items={report.officialEvidence}/><MarketRangeCard m={report.market}/><ComparablesCard comparables={report.market?.comparables}/><PriceDriversCard pd={report.market?.priceDrivers}/><EvidenceCard title={t('verify_market_extra_info_title')} items={report.market?.priceEvidence}/><EvidenceCard title={t('verify_public_evidence_title')} items={report.publicEvidence}/><EvidenceCard title={t('verify_positive_reviews_title')} items={report.reviews?.positive}/><EvidenceCard title={t('verify_negative_reviews_title')} items={report.reviews?.negative}/></div>}{homatchUser&&<Card><CardContent className="pt-5 flex flex-col sm:flex-row sm:items-center gap-3"><p className="text-sm text-muted-foreground min-w-0 flex-1 break-words">{caseId?t('verify_case_saved'):t('verify_case_saving')}</p><Button onClick={caseId?()=>nav(`/verify/${caseId}`):()=>{void saveCase()}} disabled={savingCase} className="shrink-0 w-full sm:w-auto">{caseId?t('verify_continue_case'):t('verify_save_case')}</Button></CardContent></Card>}<Button variant="outline" className="w-full sm:w-auto" onClick={()=>nav('/ai',{state:{prompt:`${t('verify_ai_prompt_prefix')}: ${query}`,context:{type:'verify',data:customerSafeReportForAi(report)}}})}><Bot className="h-4 w-4 mr-2"/>{t('verify_ask_ai_button')}</Button></div>}</div></AppLayout>}
