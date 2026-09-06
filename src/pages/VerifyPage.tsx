import React,{useEffect,useRef,useState}from'react';import{useNavigate,useSearchParams}from'react-router-dom';import{AppLayout}from'@/components/layouts/AppLayout';import{Button}from'@/components/ui/button';import{Input}from'@/components/ui/input';import{Card,CardContent,CardHeader,CardTitle}from'@/components/ui/card';import{Tabs,TabsList,TabsTrigger}from'@/components/ui/tabs';import{Badge}from'@/components/ui/badge';import{Search,Shield,Loader2,ExternalLink,Bot,History,Pencil,Trash2}from'lucide-react';import{Sheet,SheetContent,SheetHeader,SheetTitle}from'@/components/ui/sheet';import{supabase}from'@/db/supabase';import{useLanguage}from'@/contexts/LanguageContext';import{useAuth}from'@/contexts/AuthContext';import{ResearchCaptchaModal}from'@/components/research/ResearchCaptchaModal';import{listVerifyHistory,renameResearchJob,softDeleteResearchJob}from'@/services/researchJobs';import type{ResearchJobRecord}from'@/types/types';
type Mode='property'|'cadastral';type SourceCategory='OFFICIAL_REGISTRY'|'OFFICIAL_DOCUMENT'|'OFFICIAL_MAP'|'DEVELOPER_PRIMARY'|'PROPERTY_PORTAL'|'MARKET_LISTING'|'MEDIA'|'SOCIAL'|'PUBLIC_GROUP'|'PUBLIC_FORUM'|'PUBLIC_SEARCH'|'OTHER_PUBLIC';type Source={label:string;url?:string;evidenceLevel?:string;genericHomepage?:boolean;linkLabel?:string|null;retrievalMethod?:string|null;sourceCategory?:SourceCategory};type OfficialSourceOutcome={source:string;sourceName?:string;customerStatus:'SUCCESS'|'NO_RESULT'|'CAPTCHA_REQUIRED'|'BLOCKED'|'TECHNICAL_FAILED'|'NOT_CONFIRMED'};type HistoricalDoc={url:string;date?:string|null;title?:string|null};type HistoricalComparisonEntry={olderDocument:HistoricalDoc;newerDocument:HistoricalDoc;changed:boolean;addedInNewer?:string[];removedFromOlder?:string[];proof:string};type HistoricalComparison={available:boolean;reason?:string;documentsConsidered?:number;chronology?:HistoricalDoc[];comparisons?:HistoricalComparisonEntry[]};type OfficialDocument={source:string;sourceName?:string;url:string;title?:string|null;date?:string|null;type?:string|null;sha256?:string|null;parsed:boolean;textExtractionAvailable:boolean;linkLabel?:string|null};type CompanyProfile={name?:string|null;idCode?:string|null;legalForm?:string|null;registrationDate?:string|null;status?:string|null;directors?:string[];representatives?:string[];historicalChanges?:string[];relatedProjects?:string[];summary?:string|null;sourceBasis?:'REGISTRY_CONFIRMED'|'WEB_RESEARCH_ONLY'};type CommissioningStatus={status?:'OFFICIALLY_CONFIRMED'|'NOT_INDEPENDENTLY_VERIFIED';evidenceUrl?:string|null};type ProjectProfile={name?:string|null;aliases?:string[];address?:string|null;developer?:string|null;developerCompany?:string|null;website?:string|null;buildings?:string|null;floors?:string|null;unitCounts?:string|null;constructionStatus?:string|null;declaredCompletionTarget?:string|null;observedConstructionStatus?:string|null;commissioningStatus?:CommissioningStatus|null;architect?:string|null;contractors?:string[];amenities?:string[];facts?:string[]};type Comparable={source?:string;url?:string|null;listingId?:string|null;project?:string|null;address?:string|null;area?:string|null;rooms?:string|null;floor?:string|null;condition?:string|null;price?:string|null;currency?:string|null;pricePerSqm?:string|null;listingDate?:string|null;similarity?:string|null;retrievedAt?:string|null;genericSource?:boolean;linkLabel?:string|null};type DueDiligenceCoverage={level?:'HIGH'|'MEDIUM'|'LIMITED';officialSourcesChecked?:number;officialSourcesAttempted?:number;officialSourcesRetrieved?:number;documentsRead?:number;documentsDiscovered?:number;technicalFailures?:number;companyRecords?:number;marketComparables?:number;socialSources?:number;marketListingSources?:number;developerPrimarySources?:number;mediaSources?:number;forumSources?:number;otherPublicSources?:number;materialMismatches?:number;outstandingConfirmations?:number};type RightsAndRestrictions={status?:'NOT_CONFIRMED'|'NONE_FOUND_IN_CHECKED_SOURCE'|'RESTRICTION_IDENTIFIED';items?:string[];statement?:string;asOf?:string};
// v25 additions: reconciledIdentity (cross-stage entity reconciliation —
// see research-agent's reconcileIdentity()), utilitiesMatrix, landProfile,
// exactUnit. exactUnit is the mandate's own non-negotiable: for a cadastral
// query it is deterministically forced back to the literal code the user
// typed and must always be shown as the PRIMARY subject, distinct from
// `identifiedParent` (which may legitimately be a parent/base parcel TAS
// found evidence for) — the two must never be visually merged into one line.
type Provenance={source:string;url?:string|null};type ReconciledIdentity={project?:string|null;address?:string|null;developer?:string|null;confidence?:'HIGH'|'MEDIUM'|'LOW';independentSourceCount?:number;provenance?:{project?:Provenance[];address?:Provenance[];developer?:Provenance[]}};type UtilityStatus={status?:'CONFIRMED_CONNECTED'|'CONFIRMED_NOT_CONNECTED'|'NOT_MENTIONED';note?:string|null};type UtilitiesMatrix={electricity?:UtilityStatus;water?:UtilityStatus;gas?:UtilityStatus;sewage?:UtilityStatus;internet?:UtilityStatus};type LandProfile={landCategory?:string|null;permittedUse?:string|null;buildabilityNote?:string|null;source?:string|null};type ExactUnit={code?:string|null;verified?:boolean;note?:string|null};
// OverallAssessment (v30, "REPORT UX" mandate): a deterministic, code-
// computed level (see research-agent's computeOverallAssessment()) plus the
// model's own evidence-traceable keyStrengths/itemsToVerify lists — this is
// the new top-of-report summary, replacing "missing commissioning" as the
// accidental headline of an otherwise strongly evidenced report. Never a
// safety verdict — a due-diligence-evidence-quality signal only.
type OverallAssessmentLevel='POSITIVE'|'GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY'|'MIXED'|'CAUTION';type OverallAssessment={level?:OverallAssessmentLevel;keyStrengths?:string[];itemsToVerify?:string[]};
type Report={jobId?:string;workerJobId?:string;officialWorkerJobId?:string;_worker?:{jobId?:string};queryType:string;entityName?:string;entityType?:string;overallConfidence?:string;dueDiligenceCoverage?:DueDiligenceCoverage;coverageNote?:string;overallAssessment?:OverallAssessment|null;summary:string;identifiedParent?:{code?:string;name?:string;address?:string;developer?:string}|null;exactUnit?:ExactUnit|null;reconciledIdentity?:ReconciledIdentity|null;utilitiesMatrix?:UtilitiesMatrix|null;landProfile?:LandProfile|null;projectProfile?:ProjectProfile|null;companyProfile?:CompanyProfile|null;rightsAndRestrictions?:RightsAndRestrictions|null;market?:{priceEvidence?:string[];comparables?:Comparable[]}|null;officialEvidence?:string[];publicEvidence?:string[];reviews?:{positive?:string[];negative?:string[];neutral?:string[]}|null;conflicts?:string[];materialRisks?:{riskFlags?:{severity:string;description:string}[];note?:string};sources?:Source[];officialSourceCoverage?:OfficialSourceOutcome[];stage?:string;verificationUrl?:string;verificationSite?:string;historicalComparison?:HistoricalComparison|null;officialDocumentsRetrieved?:OfficialDocument[]};
const clean=(s?:string)=>String(s||'').replace(/\*\*/g,'').replace(/#{1,6}\s*/g,'').trim();
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
function RightsAndRestrictionsCard({rr}:{rr?:RightsAndRestrictions|null}){const{t}=useLanguage();if(!rr)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_rights_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rr.items?.length?rr.items.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed">• {clean(x)}</div>):<p className="text-sm text-muted-foreground">{clean(rr.statement)}</p>}</CardContent></Card>}
const commissioningLabel=(s:CommissioningStatus|null|undefined,t:(k:string)=>string)=>s?.status==='OFFICIALLY_CONFIRMED'?t('verify_commissioning_confirmed'):t('verify_commissioning_unconfirmed');
// UtilitiesMatrixCard (v24/v25 field, previously computed by research-agent
// but never rendered anywhere — the mandate's own "backend emits it,
// frontend must actually show it" gap). Each utility gets its own 3-state
// badge; a utility whose status is NOT_MENTIONED is still shown (never
// hidden) so the absence of evidence is itself visible, not silently
// dropped — consistent with UNKNOWN never being collapsed into an implied NO.
const utilityStatusLabel=(s:UtilityStatus['status']|undefined,t:(k:string)=>string)=>s==='CONFIRMED_CONNECTED'?t('verify_utility_connected'):s==='CONFIRMED_NOT_CONNECTED'?t('verify_utility_not_connected'):t('verify_utility_not_mentioned');
function UtilitiesMatrixCard({u}:{u?:UtilitiesMatrix|null}){const{t}=useLanguage();if(!u)return null;const rows:[string,UtilityStatus|undefined][]=[[t('verify_utility_electricity'),u.electricity],[t('verify_utility_water'),u.water],[t('verify_utility_gas'),u.gas],[t('verify_utility_sewage'),u.sewage],[t('verify_utility_internet'),u.internet]].filter(([,v])=>v)as[string,UtilityStatus][];if(!rows.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_utilities_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map(([label,st])=><div key={label} className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><div className="flex items-center gap-2"><Badge variant={st.status==='CONFIRMED_CONNECTED'?'default':st.status==='CONFIRMED_NOT_CONNECTED'?'destructive':'outline'} className="normal-case font-normal">{utilityStatusLabel(st.status,t)}</Badge></div></div>)}{rows.filter(([,st])=>st.note).map(([label,st])=><p key={`${label}-note`} className="text-xs text-muted-foreground">{label}: {clean(st.note)}</p>)}</CardContent></Card>}
// LandProfileCard (v24/v25 field, land parcels only — same previously-unrendered
// gap as utilitiesMatrix). research-agent only ever populates this from a
// cadastral/registry document actually read this run, so every row here is
// already evidence-gated server-side; this card is a pure display layer.
function LandProfileCard({lp}:{lp?:LandProfile|null}){const{t}=useLanguage();if(!lp||!(lp.landCategory||lp.permittedUse||lp.buildabilityNote))return null;const rows:[string,string|undefined|null][]=[[t('verify_land_row_category'),lp.landCategory],[t('verify_land_row_permitted_use'),lp.permittedUse],[t('verify_land_row_buildability'),lp.buildabilityNote]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_land_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.filter(([,v])=>v).map(([k,v])=><div key={k} className="text-sm"><span className="text-muted-foreground">{k}:</span> {clean(v as string)}</div>)}{lp.source&&<a href={lp.source} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">{t('verify_view_source')}</a>}</CardContent></Card>}
// ReconciledIdentityCard (v25, mandate sections 4/5): shows WHY a project/
// address/developer that IDENTITY itself never stated confidently is being
// shown at all — the confidence tier and the independent sources that
// agreed, never a bare unexplained fact. Deliberately hidden once the value
// is already visible on ProjectProfileCard with a name (i.e. this only adds
// value when it's the reason something appeared, or to show its provenance);
// it always renders when a reconciledIdentity object exists so the evidence
// trail is never hidden even if projectProfile shows the same value.
const reconciledConfidenceLabel=(c:string|undefined,t:(k:string)=>string)=>({HIGH:t('verify_reconciled_confidence_high'),MEDIUM:t('verify_reconciled_confidence_medium'),LOW:t('verify_reconciled_confidence_low')}[String(c||'').toUpperCase()]||t('verify_reconciled_confidence_low'));
function ProvenanceList({items}:{items?:Provenance[]}){if(!items?.length)return null;return <div className="flex flex-wrap gap-1.5">{items.map((p,i)=>p.url?<a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline">{p.source}</a>:<span key={i} className="text-[11px] text-muted-foreground">{p.source}</span>)}</div>}
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
function IdentifiedPropertyCard({identifiedParent,exactUnit,projectProfile}:{identifiedParent?:Report['identifiedParent'];exactUnit?:ExactUnit|null;projectProfile?:ProjectProfile|null}){const{t}=useLanguage();if(!identifiedParent&&!exactUnit?.code)return null;const parentDiffers=!!(exactUnit?.code&&identifiedParent?.code&&exactUnit.code!==identifiedParent.code);return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_identified_property_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{exactUnit?.code&&<div className="space-y-1 pb-2 border-b border-border"><div className="flex items-center gap-2 flex-wrap"><span className="text-xs uppercase tracking-wide text-muted-foreground">{t('verify_exact_unit_label')}</span><Badge variant={exactUnit.verified?'default':'outline'} className="normal-case font-normal">{exactUnit.verified?t('verify_exact_unit_verified'):t('verify_exact_unit_unverified')}</Badge></div><div className="text-sm font-medium">{exactUnit.code}</div>{exactUnit.note&&<p className="text-xs text-muted-foreground">{clean(exactUnit.note)}</p>}</div>}<div className="space-y-1">{parentDiffers&&<span className="text-xs uppercase tracking-wide text-muted-foreground">{t('verify_parent_parcel_label')}</span>}<div className="grid sm:grid-cols-2 gap-2 text-sm">{(!exactUnit?.code||parentDiffers)&&<div>{t('verify_label_code')}: {identifiedParent?.code||'—'}</div>}<div>{t('verify_project_title_prefix')}: {identifiedParent?.name||projectProfile?.name||'—'}</div><div>{t('verify_project_row_address')}: {identifiedParent?.address||projectProfile?.address||'—'}</div><div>{t('verify_project_row_developer')}: {identifiedParent?.developer||projectProfile?.developer||'—'}</div></div></div></CardContent></Card>}
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
function customerSafeReportForAi(r:Report){const{...rest}=r as any;for(const k of['browserOfficial','_worker','_cost','costUsage','workerJobId','officialWorkerJobId','researchProvider','narrativeEvidenceGateApplied','narrativeEvidenceGateReasons','officialSourcesChecked','officialSourcesConfirmedFound','officialSourcesConfirmedNoResult','officialSourcesNotVerified','officialSourcesSkipped','officialSourcesPartiallyTraversed','entityConfidence','confidence','officialVerificationComplete','stage','officialSourceCoverage','dueDiligenceCoverage'])delete rest[k];return rest}
function EvidenceCard({title,items}:{title:string;items?:string[]}){if(!items?.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{title}</CardTitle></CardHeader><CardContent className="space-y-2">{items.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed">• {clean(x)}</div>)}</CardContent></Card>}
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
const overallAssessmentLabel=(lvl:OverallAssessmentLevel|undefined,t:(k:string)=>string)=>({POSITIVE:t('verify_assessment_positive'),GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY:t('verify_assessment_generally_positive'),MIXED:t('verify_assessment_mixed'),CAUTION:t('verify_assessment_caution')}[String(lvl||'')]||t('verify_assessment_generally_positive'));
const overallAssessmentBadgeClass=(lvl:OverallAssessmentLevel|undefined)=>({POSITIVE:'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/90',GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY:'border-emerald-300 bg-emerald-50 text-emerald-800',MIXED:'border-amber-300 bg-amber-50 text-amber-800',CAUTION:'border-transparent bg-destructive text-destructive-foreground'}[String(lvl||'')]||'border-emerald-300 bg-emerald-50 text-emerald-800');
function OverallAssessmentCard({oa}:{oa?:OverallAssessment|null}){const{t}=useLanguage();if(!oa||!oa.level)return null;const strengths=oa.keyStrengths||[],toVerify=oa.itemsToVerify||[];return <Card className="border-2"><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_assessment_title')}</span><Badge className={overallAssessmentBadgeClass(oa.level)}>{overallAssessmentLabel(oa.level,t)}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">{!!strengths.length&&<div className="space-y-1.5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('verify_assessment_strengths_title')}</p>{strengths.map((x,i)=><div key={i} className="text-sm leading-relaxed flex gap-2"><span className="text-emerald-600 shrink-0">✓</span><span>{clean(x)}</span></div>)}</div>}{!!toVerify.length&&<div className="space-y-1.5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('verify_assessment_to_verify_title')}</p>{toVerify.map((x,i)=><div key={i} className="text-sm leading-relaxed flex gap-2"><span className="text-amber-600 shrink-0">•</span><span>{clean(x)}</span></div>)}</div>}</CardContent></Card>}
function HistoricalComparisonCard({hc}:{hc?:HistoricalComparison|null}){const{t}=useLanguage();if(!hc?.available||!hc.comparisons?.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_history_title')}</CardTitle></CardHeader><CardContent className="space-y-3">{hc.comparisons.map((c,i)=><div key={i} className="text-xs space-y-1 border-b border-border pb-2 last:border-0 last:pb-0"><div className="text-muted-foreground">{clean(c.olderDocument.title||c.olderDocument.url)} ({c.olderDocument.date||'—'}) → {clean(c.newerDocument.title||c.newerDocument.url)} ({c.newerDocument.date||'—'})</div>{c.changed?<div className="space-y-0.5">{(c.addedInNewer||[]).slice(0,5).map((l,j)=><div key={`a${j}`} className="text-emerald-600">+ {clean(l)}</div>)}{(c.removedFromOlder||[]).slice(0,5).map((l,j)=><div key={`r${j}`} className="text-red-500">− {clean(l)}</div>)}</div>:<div className="text-muted-foreground">{t('verify_history_no_change')}</div>}</div>)}</CardContent></Card>}
function OfficialDocumentsCard({docs}:{docs?:OfficialDocument[]}){const{t}=useLanguage();if(!docs?.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_official_docs_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{docs.map((d,i)=><a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 p-2 rounded-lg border text-xs"><span className="truncate">{clean(d.title||d.url)}{d.date?` · ${d.date}`:''}</span><span className="flex items-center gap-2 shrink-0 ml-2"><span className="text-muted-foreground">{d.parsed?t('verify_doc_parsed'):t('verify_doc_not_parsed')}</span><span className="text-primary underline">{d.linkLabel||t('verify_view_document')}</span></span></a>)}</CardContent></Card>}
// ProjectProfileCard (2026-09-05 v2, mandate: project intelligence must be
// much richer and never show "პროექტი: —" once a project was identified).
function ProjectProfileCard({p}:{p?:ProjectProfile|null}){const{t}=useLanguage();if(!p||!(p.name||p.address||p.developer))return null;const rows:[string,string|undefined|null][]=[[t('verify_project_row_developer'),p.developer],[t('verify_project_row_developer_company'),p.developerCompany],[t('verify_project_row_address'),p.address],[t('verify_project_row_website'),p.website],[t('verify_project_row_buildings'),p.buildings],[t('verify_project_row_floors'),p.floors],[t('verify_project_row_unit_counts'),p.unitCounts],[t('verify_project_row_declared_completion'),p.declaredCompletionTarget],[t('verify_project_row_observed_status'),p.observedConstructionStatus],[t('verify_project_row_architect'),p.architect]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_project_title_prefix')}: {clean(p.name)||'—'}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid sm:grid-cols-2 gap-2 text-sm">{rows.filter(([,v])=>v).map(([k,v])=><div key={k}>{k}: {clean(v as string)}</div>)}</div>{p.commissioningStatus&&<div className="text-sm flex items-center gap-2 flex-wrap"><span>{commissioningLabel(p.commissioningStatus,t)}</span>{p.commissioningStatus.evidenceUrl&&<a href={p.commissioningStatus.evidenceUrl} target="_blank" rel="noreferrer" className="text-primary text-xs underline">{t('verify_view_source')}</a>}</div>}<EvidenceCard title={t('verify_contractors')} items={p.contractors}/><EvidenceCard title={t('verify_amenities')} items={p.amenities}/><EvidenceCard title={t('verify_additional_facts')} items={p.facts}/></CardContent></Card>}
// CompanyProfileCard (2026-09-05 v2): richer schema (idCode/legalForm/
// registrationDate/status/directors/representatives/historicalChanges/
// relatedProjects) fed by the ENREG closed-loop lookup, never left showing
// only a bare summary once a company has actually been identified.
// sourceBasisLabel (v23, mandate residual gap: ENREG returning
// NO_RESULT_CONFIRMED must never be visually indistinguishable from a real
// registry confirmation just because companyProfile looks detailed —
// research-agent now computes this deterministically, never from the
// model's own self-report).
const sourceBasisLabel=(b:string|undefined,t:(k:string)=>string)=>b==='REGISTRY_CONFIRMED'?t('verify_source_basis_registry'):t('verify_source_basis_web');
function CompanyProfileCard({c}:{c?:CompanyProfile|null}){const{t}=useLanguage();if(!c||!(c.name||c.idCode))return null;const rows:[string,string|undefined|null][]=[[t('verify_company_row_id_code'),c.idCode],[t('verify_company_row_legal_form'),c.legalForm],[t('verify_company_row_registration_date'),c.registrationDate],[t('verify_company_row_status'),c.status]];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2 flex-wrap"><span>{t('verify_company_title_prefix')}: {clean(c.name)||'—'}</span><Badge variant={c.sourceBasis==='REGISTRY_CONFIRMED'?'default':'outline'} className="normal-case font-normal">{sourceBasisLabel(c.sourceBasis,t)}</Badge></CardTitle></CardHeader><CardContent className="space-y-3">{c.summary&&<p className="text-sm text-muted-foreground">{clean(c.summary)}</p>}<div className="grid sm:grid-cols-2 gap-2 text-sm">{rows.filter(([,v])=>v).map(([k,v])=><div key={k}>{k}: {clean(v as string)}</div>)}</div><EvidenceCard title={t('verify_directors')} items={c.directors}/><EvidenceCard title={t('verify_representatives')} items={c.representatives}/><EvidenceCard title={t('verify_historical_changes')} items={c.historicalChanges}/><EvidenceCard title={t('verify_related_projects')} items={c.relatedProjects}/></CardContent></Card>}
// ComparablesCard (2026-09-05 v2, mandate: market research must use CONCRETE
// comparables, never only a broad price range). Renders each structured
// comparable as a small row; a `genericSource` comparable (its only URL was
// a bare homepage) never shows a specific price/listingId — those fields
// were already stripped server-side, and here it is visually marked as a
// general lead rather than a specific citation.
function ComparablesCard({comparables}:{comparables?:Comparable[]}){const{t}=useLanguage();if(!comparables?.length)return null;return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_comparables_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{comparables.map((c,i)=><div key={i} className="p-2 rounded-lg border text-xs space-y-1"><div className="flex items-center justify-between gap-2"><span className="font-medium">{clean(c.project||c.address)||clean(c.source)||t('verify_listing_fallback')}</span>{c.url&&!c.genericSource?<a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary flex items-center gap-1 shrink-0"><ExternalLink className="h-3 w-3"/>{c.linkLabel||t('verify_view_listing')}</a>:c.genericSource?<Badge variant="outline">{t('verify_generic_source')}</Badge>:null}</div><div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">{c.area&&<span>{clean(c.area)}</span>}{c.rooms&&<span>{clean(c.rooms)} {t('verify_rooms_suffix')}</span>}{c.floor&&<span>{t('verify_floor_prefix')} {clean(c.floor)}</span>}{c.condition&&<span>{clean(c.condition)}</span>}{!c.genericSource&&c.price&&<span>{clean(c.price)}{c.currency?` ${clean(c.currency)}`:''}</span>}{!c.genericSource&&c.pricePerSqm&&<span>{clean(c.pricePerSqm)}/მ²</span>}{c.listingDate&&<span>{clean(c.listingDate)}</span>}</div>{c.similarity&&<div className="text-muted-foreground/80">{clean(c.similarity)}</div>}</div>)}</CardContent></Card>}
// MaterialRisksCard (2026-09-05 v2, mandate item 17: "if no problem was
// found, write the fixed neutral sentence — never our own failed automation
// steps"). Always renders when the report carries a materialRisks object —
// either the evidenced riskFlags, or the one fixed neutral sentence
// research-agent supplies when there is nothing to flag. Never falls back to
// silently rendering nothing, and never invents risk text of its own.
function MaterialRisksCard({mr}:{mr?:Report['materialRisks']}){const{t}=useLanguage();if(!mr)return null;const flags=mr.riskFlags||[];return <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_material_risks_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{flags.length?flags.map((x,i)=><div key={i} className="text-xs text-muted-foreground leading-relaxed">• {clean(x.description)}</div>):<div className="text-xs text-muted-foreground">{clean(mr.note)}</div>}</CardContent></Card>}
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
export default function VerifyPage(){const nav=useNavigate();const{lang,t}=useLanguage();const{homatchUser,supaUser}=useAuth();const[searchParams,setSearchParams]=useSearchParams();const[mode,setMode]=useState<Mode>('property');const[query,setQuery]=useState('');const[loading,setLoading]=useState(false);const[report,setReport]=useState<Report|null>(null);const[err,setErr]=useState<string|null>(null);const[captcha,setCaptcha]=useState<Report|null>(null);const[jobId,setJobId]=useState<string|null>(null);const[progress,setProgress]=useState<any>(null);const[sidebarOpen,setSidebarOpen]=useState(false);const[allHistory,setAllHistory]=useState<ResearchJobRecord[]>([]);const[allHistoryLoading,setAllHistoryLoading]=useState(false);const timer=useRef<any>(null);const busy=useRef(false);const valid=mode==='cadastral'?/^\d+(\.\d+){3,}$/.test(query.trim()):query.trim().length>=2;const stop=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null}busy.current=false};const schedule=(id:string,ms=2200)=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>check(id),ms)};
const check=async(id:string)=>{if(!id||busy.current)return;busy.current=true;let again=true;try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'status',jobId:id,language:lang}});if(error)throw error;if(data?.error)throw new Error(data.error);if(data?.progress)setProgress(data.progress);if(data?.status==='FAILED'){again=false;stop();setLoading(false);setErr(data.error||t('verify_err_research_failed'));return}if(data?.status==='WAITING_HUMAN'){again=false;stop();setLoading(false);const r=data.result_json||{};setCaptcha({...r,jobId:id,workerJobId:r.workerJobId||r.officialWorkerJobId||r?._worker?.jobId||data?.progress?.workerJobId||data?.captcha?.workerJobId,verificationSite:data?.captcha?.source||data?.verification_site||r.verificationSite});return}if(data?.status==='COMPLETE'&&data.result_json){again=false;stop();setLoading(false);setCaptcha(null);setReport(data.result_json);return}}catch(e:any){again=false;stop();setLoading(false);setErr(e?.message||t('verify_err_status_fetch_failed'))}finally{busy.current=false}if(again)schedule(id)};useEffect(()=>()=>stop(),[]);
// openJob(): the entire "open an old report without rerunning research"
// requirement — this calls check(), which only ever performs a `status`
// read against the existing research_jobs row (research-agent's status
// action never re-runs anything). Used both to reopen ?job=<id> on mount
// (refresh survival) and to open any entry from the report-history list.
const openJob=(id:string)=>{stop();setErr(null);setCaptcha(null);setReport(null);setJobId(id);setLoading(true);setProgress({phase:'loading',percent:30});const params=new URLSearchParams(searchParams);params.set('job',id);setSearchParams(params,{replace:true});check(id)};
useEffect(()=>{const urlJob=searchParams.get('job');if(urlJob)openJob(urlJob);
// eslint-disable-next-line react-hooks/exhaustive-deps
},[]);
const run=async()=>{if(!valid)return;stop();setLoading(true);setErr(null);setReport(null);setCaptcha(null);setJobId(null);setProgress({phase:'queued',percent:5});try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'start',query:query.trim(),type:mode,language:lang}});if(error)throw error;if(data?.error)throw new Error(data.error);const id=String(data?.jobId||data?.id||'');if(!id)throw new Error(t('verify_err_no_job_id'));setJobId(id);
// v26 fix: write ?job=<id> the moment the job exists — not only once it
// completes, so a mid-run refresh reconnects to the RUNNING job (mandate
// test M), not just a COMPLETE one.
{const params=new URLSearchParams(searchParams);if(params.get('job')!==id){params.set('job',id);setSearchParams(params,{replace:true})}}
if(data?.progress)setProgress(data.progress);schedule(id,500)}catch(e:any){setLoading(false);setErr(e?.message||t('verify_err_start_failed'))}};
const resume=async()=>{const id=captcha?.jobId||jobId;if(!id)return;setCaptcha(null);setLoading(true);setProgress({phase:'resuming',percent:72});try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'resume',jobId:id,language:lang,humanVerificationCompleted:true}});if(error)throw error;if(data?.error)throw new Error(data.error);schedule(id,500)}catch(e:any){setLoading(false);setErr(e?.message||t('verify_err_resume_failed'))}};
const skip=async()=>{const id=captcha?.jobId||jobId;if(!id)return;setCaptcha(null);setLoading(true);setProgress({phase:'resuming',percent:72});try{const{data,error}=await supabase.functions.invoke('research-agent',{body:{action:'skip',jobId:id,language:lang}});if(error)throw error;if(data?.error)throw new Error(data.error);schedule(id,500)}catch(e:any){setLoading(false);setErr(e?.message||t('verify_err_skip_failed'))}};
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
const handleSidebarOpenJob=(id:string)=>{setSidebarOpen(false);openJob(id)};
const handleSidebarRename=async(id:string,title:string)=>{setAllHistory(prev=>prev.map(j=>j.id===id?{...j,title:title.trim()||null}:j));try{await renameResearchJob(id,title)}catch{if(supaUser)try{setAllHistory(await listVerifyHistory(supaUser.id))}catch{/* keep optimistic state */}}};
const handleSidebarDelete=async(id:string)=>{setAllHistory(prev=>prev.filter(j=>j.id!==id));try{await softDeleteResearchJob(id)}catch{if(supaUser)try{setAllHistory(await listVerifyHistory(supaUser.id))}catch{/* keep optimistic state */}}};
const pct=Math.max(5,Math.min(100,Number(progress?.percent)||5)),workerCaptchaId=captcha?.workerJobId||captcha?.officialWorkerJobId||captcha?._worker?.jobId;return <AppLayout><ResearchCaptchaModal open={!!captcha} jobId={workerCaptchaId} site={captcha?.verificationSite} onComplete={resume} onSkip={skip}/>{homatchUser&&<VerifyHistorySidebar open={sidebarOpen} onOpenChange={setSidebarOpen} items={allHistory} loading={allHistoryLoading} activeJobId={jobId} onOpenJob={handleSidebarOpenJob} onRename={handleSidebarRename} onDelete={handleSidebarDelete}/>}<div className="max-w-4xl mx-auto space-y-5 pb-16"><div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-2"><Shield className="h-6 w-6 text-primary"/><h1 className="text-2xl font-bold">{t('verify_title')}</h1></div><p className="text-sm text-muted-foreground mt-1">{t('verify_page_subtitle')}</p></div>{homatchUser&&<Button variant="outline" size="sm" onClick={openVerifyHistorySidebar} className="shrink-0"><History className="h-3.5 w-3.5 mr-1.5"/>{t('verify_history_sidebar_button')}</Button>}</div><Tabs value={mode} onValueChange={v=>{stop();setMode(v as Mode);setReport(null);setCaptcha(null);setQuery('');setLoading(false)}}><TabsList className="grid grid-cols-2 w-full"><TabsTrigger value="property">{t('verify_tab_property')}</TabsTrigger><TabsTrigger value="cadastral">{t('verify_tab_cadastral')}</TabsTrigger></TabsList></Tabs><Card><CardContent className="pt-5"><div className="flex gap-2"><Input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&valid&&!loading&&run()} placeholder={mode==='property'?t('verify_property_query_ph'):t('verify_cadastral_query_ph')}/><Button onClick={()=>run()} disabled={!valid||loading}>{loading?<Loader2 className="h-4 w-4 animate-spin"/>:<><Search className="h-4 w-4 mr-2"/>{t('verify_search_button')}</>}</Button></div></CardContent></Card>{err&&<div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">{err}</div>}{loading&&<Card><CardContent className="py-8"><div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary"/><div className="flex-1"><div className="flex justify-between text-sm"><span>{t('verify_loading_label')}</span><span>{pct}%</span></div><div className="h-2 bg-muted rounded-full mt-2 overflow-hidden"><div className="h-full bg-primary transition-all" style={{width:`${pct}%`}}/></div><p className="text-xs text-muted-foreground mt-2">{clean(progress?.phase)||t('verify_loading_phase_fallback')}</p></div></div></CardContent></Card>}{report&&!loading&&<div className="space-y-4"><OverallAssessmentCard oa={report.overallAssessment}/><Card><CardContent className="pt-5 space-y-3"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-semibold">{clean(report.entityName)||query}</h2><Badge variant="outline">{report.entityType||mode}</Badge></div><p className="text-sm text-muted-foreground leading-relaxed">{clean(report.summary)}</p><CoverageNote note={report.coverageNote}/></CardContent></Card>{(report.identifiedParent||report.exactUnit)&&<IdentifiedPropertyCard identifiedParent={report.identifiedParent} exactUnit={report.exactUnit} projectProfile={report.projectProfile}/>}<ReconciledIdentityCard ri={report.reconciledIdentity}/><ProjectProfileCard p={report.projectProfile}/><UtilitiesMatrixCard u={report.utilitiesMatrix}/><LandProfileCard lp={report.landProfile}/><RightsAndRestrictionsCard rr={report.rightsAndRestrictions}/><OfficialDocumentsCard docs={report.officialDocumentsRetrieved}/><HistoricalComparisonCard hc={report.historicalComparison}/><CompanyProfileCard c={report.companyProfile}/><EvidenceCard title={t('verify_official_evidence_title')} items={report.officialEvidence}/><ComparablesCard comparables={report.market?.comparables}/><EvidenceCard title={t('verify_market_extra_info_title')} items={report.market?.priceEvidence}/><EvidenceCard title={t('verify_public_evidence_title')} items={report.publicEvidence}/><EvidenceCard title={t('verify_positive_reviews_title')} items={report.reviews?.positive}/><EvidenceCard title={t('verify_negative_reviews_title')} items={report.reviews?.negative}/>{!!report.conflicts?.length&&<EvidenceCard title={t('verify_conflicts_title')} items={report.conflicts}/>}<MaterialRisksCard mr={report.materialRisks}/>{!!report.sources?.length&&<Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide">{t('verify_sources_title')}</CardTitle></CardHeader><CardContent className="space-y-2">{report.sources.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 p-2 rounded-lg border"><span className="text-xs truncate">{clean(s.label)}</span>{s.sourceCategory==='PUBLIC_SEARCH'?<Badge variant="outline" className="shrink-0 ml-2">{t('verify_public_search_badge')}</Badge>:s.genericHomepage?<Badge variant="outline">{t('verify_generic_page')}</Badge>:s.retrievalMethod==='OPENAI_WEB_SEARCH'?<Badge variant="outline" className="shrink-0 ml-2">{t('verify_source_cited_ai')}</Badge>:<span className="text-primary text-xs underline shrink-0 ml-2 flex items-center gap-1"><ExternalLink className="h-3.5 w-3.5"/>{s.linkLabel||t('verify_view_source')}</span>}</a>)}</CardContent></Card>}<Button variant="outline" onClick={()=>nav('/ai',{state:{prompt:`${t('verify_ai_prompt_prefix')}: ${query}`,context:{type:'verify',data:customerSafeReportForAi(report)}}})}><Bot className="h-4 w-4 mr-2"/>{t('verify_ask_ai_button')}</Button></div>}</div></AppLayout>}
