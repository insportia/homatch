import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import {
  Search, Shield, Building2, FileText, AlertTriangle, CheckCircle2,
  Info, ExternalLink, ChevronRight, Loader2, MapPin,
  AlertCircle, Bot, XCircle, Scale, TrendingUp, Landmark,
  CheckCheck, HelpCircle, Globe, Eye, BookOpen, BarChart3,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────
type PIMode = 'PROPERTY' | 'CADASTRAL';

type ClaimStatus =
  | 'CONFIRMED' | 'PARTIAL' | 'UNVERIFIED' | 'NOT_FOUND'
  | 'CONFLICTED' | 'INSUFFICIENT_EVIDENCE';

type AccessMethod =
  | 'SEARCH_SNIPPET_ONLY' | 'URL_CONTEXT_RETRIEVED'
  | 'DIRECT_PAGE_RETRIEVED' | 'OFFICIAL_FORM_RESULT' | 'DOCUMENT_RETRIEVED';

type SourceType =
  | 'OFFICIAL_GOVERNMENT' | 'OFFICIAL_REGISTRY' | 'OFFICIAL_COMPANY'
  | 'DEVELOPER' | 'PROPERTY_PORTAL' | 'AGENCY' | 'NEWS_MEDIA'
  | 'MAP' | 'SOCIAL_PUBLIC' | 'REVIEW' | 'FORUM' | 'OTHER';

type JobStatus =
  | 'PENDING' | 'IDENTIFYING' | 'PLANNING' | 'DISCOVERING' | 'EXPANDING'
  | 'READING' | 'NORMALIZING' | 'CROSS_CHECKING' | 'SYNTHESIZING'
  | 'COMPLETED' | 'FAILED' | 'PARTIAL';

interface OfficialFact {
  label: string;
  value: string;
  status: ClaimStatus;
  source_type?: string;
}

interface PISource {
  url: string;
  title: string;
  sourceType: SourceType;
  accessMethod: AccessMethod;
}

interface PIConflict {
  claim_type: string;
  conflict_type: 'MATERIAL_CONFLICT' | 'MINOR_VARIATION';
  values: { value: string; confidence: number; authority: number }[];
}

interface PICrossCheckedClaim {
  claim_type: string;
  resolved_value: string;
  status: ClaimStatus;
  confidence: number;
}

interface PIReport {
  job_id: string;
  input_raw: string;
  input_mode: PIMode;
  overall_confidence: number;
  identity?: {
    display_name?: string;
    entity_types?: string[];
    cadastral_code?: string | null;
    address?: string | null;
    project_name?: string | null;
    developer_name?: string | null;
  };
  official_facts?: OfficialFact[];
  developer_company?: {
    name?: string | null;
    company_id?: string | null;
    registration_status?: ClaimStatus;
    projects?: string[];
    risk_notes?: string[];
  };
  market_listings?: {
    url?: string; price?: string; area?: string; rooms?: string;
    floor?: string; condition?: string; location?: string; date?: string;
  }[];
  discrepancies?: {
    field: string; conflict_type: string; values: string[]; assessment: string;
  }[];
  risks?: { risk: string; evidence: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  not_found?: string[];
  ai_assessment?: string;
  official_sources_note?: string;
  captcha_barriers?: string[];
  research_depth?: {
    sources_found: number; sources_read: number; claims_extracted: number;
  };
  sources_summary?: PISource[];
  cross_checked_claims?: PICrossCheckedClaim[];
  entities?: { type: string; name: string }[];
  material_conflicts?: PIConflict[];
  note_on_official_access?: string;
  searched_at?: string;
  gemini_calls?: number;
  official_sources_accessed?: number;
  pipeline_version?: string;
}

interface PIJobStatus {
  job_id: string;
  status: JobStatus;
  phase_detail?: string;
  progress: {
    sources_found: number; sources_read: number;
    entities_found: number; claims_extracted: number; gemini_calls: number;
  };
  input_raw: string;
  input_type: PIMode;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  report?: PIReport | null;
  error_message?: string | null;
}

// ── Status/confidence helpers ─────────────────────────────────
const STATUS_CONFIG: Record<ClaimStatus, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  CONFIRMED:             { color: 'bg-green-500/15 text-green-400 border-green-500/25',   icon: CheckCircle2,  label: 'CONFIRMED' },
  PARTIAL:               { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       icon: CheckCheck,    label: 'PARTIAL' },
  UNVERIFIED:            { color: 'bg-muted text-muted-foreground border-border',          icon: HelpCircle,    label: 'UNVERIFIED' },
  NOT_FOUND:             { color: 'bg-muted text-muted-foreground border-border',          icon: XCircle,       label: 'NOT FOUND' },
  CONFLICTED:            { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    icon: Scale,         label: 'CONFLICTED' },
  INSUFFICIENT_EVIDENCE: { color: 'bg-muted text-muted-foreground border-border',          icon: Info,          label: 'INSUFFICIENT' },
};

function StatusBadge({ status }: { status: ClaimStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNVERIFIED;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${cfg.color}`}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  );
}

const SOURCE_TYPE_COLOR: Record<string, string> = {
  OFFICIAL_REGISTRY:   'bg-green-500/15 text-green-400 border-green-500/25',
  OFFICIAL_GOVERNMENT: 'bg-green-500/10 text-green-400 border-green-500/20',
  OFFICIAL_COMPANY:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  DEVELOPER:           'bg-purple-500/10 text-purple-400 border-purple-500/20',
  PROPERTY_PORTAL:     'bg-primary/10 text-primary border-primary/20',
  NEWS_MEDIA:          'bg-muted text-muted-foreground border-border',
  OTHER:               'bg-muted text-muted-foreground border-border',
};

const PHASE_LABELS: Record<string, string> = {
  PENDING:       'pi_phase_identifying',
  IDENTIFYING:   'pi_phase_identifying',
  PLANNING:      'pi_phase_planning',
  DISCOVERING:   'pi_phase_discovering',
  EXPANDING:     'pi_phase_expanding',
  READING:       'pi_phase_reading',
  NORMALIZING:   'pi_phase_normalizing',
  CROSS_CHECKING:'pi_phase_cross_checking',
  SYNTHESIZING:  'pi_phase_synthesizing',
  COMPLETED:     'pi_phase_completed',
  PARTIAL:       'pi_phase_partial',
  FAILED:        'pi_phase_failed',
};

const PIPELINE_STEPS: JobStatus[] = [
  'IDENTIFYING', 'PLANNING', 'DISCOVERING', 'EXPANDING',
  'READING', 'NORMALIZING', 'CROSS_CHECKING', 'SYNTHESIZING', 'COMPLETED',
];

function TrustRing({ score, label }: { score: number; label: string }) {
  const r = 36, circ = 2 * Math.PI * r;
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#f5a623' : '#ef4444';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 88 88" className="w-24 h-24 -rotate-90">
          <circle cx="44" cy="44" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-foreground">{score}</span>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Progress display ──────────────────────────────────────────
function PIProgressPanel({ jobStatus, t }: { jobStatus: PIJobStatus; t: (k: string) => string }) {
  const currentIdx = PIPELINE_STEPS.indexOf(jobStatus.status as JobStatus);
  const isActive = !['COMPLETED', 'PARTIAL', 'FAILED'].includes(jobStatus.status);

  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-5 pb-4 space-y-4">
        {/* Current phase */}
        <div className="flex items-center gap-3">
          {isActive
            ? <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            : jobStatus.status === 'FAILED'
              ? <XCircle className="h-5 w-5 text-destructive shrink-0" />
              : <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t(PHASE_LABELS[jobStatus.status] ?? 'pi_phase_identifying')}
            </p>
            {jobStatus.phase_detail && (
              <p className="text-xs text-muted-foreground truncate">{jobStatus.phase_detail}</p>
            )}
          </div>
        </div>

        {/* Step progress bar */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {PIPELINE_STEPS.slice(0, -1).map((step, i) => {
            const done = currentIdx > i || ['COMPLETED','PARTIAL'].includes(jobStatus.status);
            const active = currentIdx === i && isActive;
            return (
              <React.Fragment key={step}>
                <div className={`h-1.5 flex-1 min-w-4 rounded-full transition-all ${
                  done ? 'bg-primary' : active ? 'bg-primary/50 animate-pulse' : 'bg-secondary'
                }`} />
              </React.Fragment>
            );
          })}
        </div>

        {/* Counters */}
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { key: 'pi_sources_label', val: jobStatus.progress.sources_found, icon: Globe },
            { key: 'pi_claims_label', val: jobStatus.progress.claims_extracted, icon: FileText },
            { key: 'pi_entities_label', val: jobStatus.progress.entities_found, icon: Building2 },
            { key: 'pi_gemini_calls_label', val: jobStatus.progress.gemini_calls, icon: Bot },
          ].map(({ key, val, icon: Icon }) => (
            <div key={key} className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-secondary/50">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-lg font-bold text-foreground">{val}</span>
              <span className="text-[10px] text-muted-foreground leading-tight">{t(key)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── PI Report view ────────────────────────────────────────────
function PIReportView({ report, t, navigate }: { report: PIReport; t: (k: string) => string; navigate: (p: string) => void }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const hasOfficialOnly = (report.official_sources_accessed ?? 0) === 0;
  const risks = report.risks ?? [];
  const discrepancies = report.discrepancies ?? [];
  const notFound = report.not_found ?? [];
  const captchaBarriers = report.captcha_barriers ?? [];
  const officialFacts = report.official_facts ?? [];
  const marketListings = report.market_listings ?? [];
  const dev = report.developer_company;
  const sources = report.sources_summary ?? [];

  return (
    <div className="space-y-4">
      {/* Identity + confidence */}
      <Card className="border-border bg-card">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <TrustRing score={report.overall_confidence} label={t('pi_confidence_label')} />
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-foreground text-base">
                    {report.identity?.display_name ?? report.input_raw}
                  </h2>
                  {(report.identity?.entity_types ?? []).map(et => (
                    <Badge key={et} variant="outline" className="text-[10px]">{et}</Badge>
                  ))}
                </div>
                {report.identity?.cadastral_code && (
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    Cadastral: {report.identity.cadastral_code}
                  </p>
                )}
                {report.identity?.address && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {report.identity.address}
                  </div>
                )}
              </div>
              {/* Depth stats */}
              {report.research_depth && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{report.research_depth.sources_found} {t('pi_sources_label')}</span>
                  <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{report.research_depth.sources_read} read</span>
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{report.research_depth.claims_extracted} {t('pi_claims_label')}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Official access warning */}
      {hasOfficialOnly && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/90">{t('pi_official_warning')}</p>
        </div>
      )}

      {/* CAPTCHA barriers */}
      {captchaBarriers.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-muted border border-border">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">{t('pi_captcha_note')}</p>
        </div>
      )}

      {/* Official & Cadastral Facts */}
      {officialFacts.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" />
              {t('pi_section_official')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {officialFacts.map((f, i) => (
              <div key={i} className="flex items-start gap-2 justify-between py-1.5 border-b border-border/30 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="text-sm font-medium text-foreground break-words">{f.value || '—'}</p>
                </div>
                <StatusBadge status={f.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Developer / Company */}
      {dev && (dev.name || dev.company_id) && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {t('pi_section_developer')}
              {dev.registration_status && <StatusBadge status={dev.registration_status} />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {dev.name && (
              <div className="flex items-start gap-2 justify-between">
                <div>
                  <p className="text-muted-foreground">Company name</p>
                  <p className="font-medium text-foreground">{dev.name}</p>
                </div>
              </div>
            )}
            {dev.company_id && (
              <div>
                <p className="text-muted-foreground">Company ID / Registration</p>
                <p className="font-mono font-medium text-foreground">{dev.company_id}</p>
              </div>
            )}
            {(dev.projects ?? []).length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1">Known projects</p>
                <div className="space-y-0.5">
                  {dev.projects!.map((p, i) => <p key={i} className="text-foreground/80">• {p}</p>)}
                </div>
              </div>
            )}
            {(dev.risk_notes ?? []).length > 0 && (
              <div className="space-y-1 pt-1">
                {dev.risk_notes!.map((n, i) => (
                  <div key={i} className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-amber-400/90">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Market Listings */}
      {marketListings.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t('pi_section_market')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {marketListings.map((l, i) => (
              <div key={i} className="p-2 rounded-lg border border-border/50 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                    {l.price && <span className="font-medium text-foreground">{l.price}</span>}
                    {l.area && <span>{l.area}</span>}
                    {l.rooms && <span>{l.rooms} rooms</span>}
                    {l.floor && <span>Floor {l.floor}</span>}
                    {l.location && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{l.location}</span>}
                  </div>
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-primary hover:underline flex items-center gap-0.5">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {l.date && <p className="text-muted-foreground/60">{l.date}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Discrepancies / Conflicts */}
      {discrepancies.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale className="h-4 w-4 text-amber-400" />
              {t('pi_section_discrepancies')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {discrepancies.map((d, i) => (
              <div key={i} className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{d.field}</span>
                  <Badge variant="outline" className={`text-[10px] ${d.conflict_type === 'MATERIAL_CONFLICT' ? 'border-destructive/40 text-destructive' : 'border-amber-500/40 text-amber-400'}`}>
                    {d.conflict_type === 'MATERIAL_CONFLICT' ? t('pi_conflict_material') : t('pi_conflict_minor')}
                  </Badge>
                </div>
                <div className="space-y-0.5 text-muted-foreground">
                  {(d.values ?? []).map((v, vi) => <p key={vi}>• {v}</p>)}
                </div>
                {d.assessment && <p className="text-foreground/70 italic">{d.assessment}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Risks */}
      {risks.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {t('pi_section_risks')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {risks.map((r, i) => {
              const cls = r.severity === 'HIGH' ? 'bg-destructive/5 border-destructive/20 text-destructive' :
                          r.severity === 'MEDIUM' ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' :
                          'bg-muted border-border text-muted-foreground';
              return (
                <div key={i} className={`p-2.5 rounded-lg border ${cls} space-y-1`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{r.risk}</span>
                    <Badge variant="outline" className={`text-[10px] ml-auto ${cls}`}>{r.severity}</Badge>
                  </div>
                  <p className="text-muted-foreground pl-5">{r.evidence}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Not Found */}
      {notFound.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
              {t('pi_section_not_found')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {notFound.map((f, i) => (
                <Badge key={i} variant="outline" className="text-muted-foreground border-border text-xs">{f}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">{t('pi_no_evidence_note')}</p>
          </CardContent>
        </Card>
      )}

      {/* AI Assessment */}
      {report.ai_assessment && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              {t('pi_section_assessment')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">{report.ai_assessment}</p>
            {report.official_sources_note && (
              <>
                <Separator className="my-2" />
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground/80 italic">{report.official_sources_note}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 cursor-pointer" onClick={() => setSourcesExpanded(p => !p)}>
              <BookOpen className="h-4 w-4 text-primary" />
              {t('pi_section_sources')} ({sources.length})
              <ChevronRight className={`h-4 w-4 ml-auto transition-transform ${sourcesExpanded ? 'rotate-90' : ''}`} />
            </CardTitle>
          </CardHeader>
          {sourcesExpanded && (
            <CardContent className="space-y-1.5 max-h-64 overflow-y-auto">
              {sources.slice(0, 30).map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/20 last:border-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${SOURCE_TYPE_COLOR[s.sourceType] ?? SOURCE_TYPE_COLOR.OTHER}`}>
                    {s.sourceType.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 min-w-0">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 truncate">
                        {s.title || s.url} <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground truncate">{s.title}</span>
                    )}
                    <span className="text-muted-foreground/50 text-[10px]">
                      {s.accessMethod === 'SEARCH_SNIPPET_ONLY' ? t('pi_access_snippet') :
                       s.accessMethod === 'URL_CONTEXT_RETRIEVED' ? t('pi_access_url_context') :
                       s.accessMethod === 'DOCUMENT_RETRIEVED' ? t('pi_access_document') : s.accessMethod}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Stats footer */}
      {(report.searched_at || report.gemini_calls) && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/50 pt-1">
          <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" />Pipeline: {report.pipeline_version}</span>
          {report.gemini_calls && <span>AI calls: {report.gemini_calls}</span>}
          {report.searched_at && <span>Researched: {new Date(report.searched_at).toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function VerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { session } = useAuth();

  const navState = location.state as { mode?: PIMode; query?: string } | undefined;

  const [mode, setMode] = useState<PIMode>(navState?.mode ?? 'PROPERTY');
  const [query, setQuery] = useState(navState?.query ?? '');
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<PIJobStatus | null>(null);
  const [report, setReport] = useState<PIReport | null>(null);
  const [efError, setEfError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Poll for job status via supabase.functions.invoke (POST with job_id in body)
  const startPolling = useCallback((jid: string) => {
    stopPolling();
    const poll = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('homatch-research/status', {
          body: { job_id: jid },
        });
        if (error) { console.warn('[PI] Poll error', error); return; }
        const status = data as PIJobStatus;
        setJobStatus(status);
        if (status.status === 'COMPLETED' || status.status === 'PARTIAL') {
          stopPolling();
          setLoading(false);
          if (status.report) setReport(status.report);
        } else if (status.status === 'FAILED') {
          stopPolling();
          setLoading(false);
          setEfError(status.error_message ?? 'Research failed');
        }
      } catch (e) {
        console.warn('[PI] Poll error', e);
      }
    };
    pollRef.current = setInterval(poll, 3000);
    poll(); // immediate first check
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Auto-run from nav state
  useEffect(() => {
    if (navState?.query) {
      setQuery(navState.query);
      if (navState.mode) setMode(navState.mode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = useCallback(async (q?: string, m?: PIMode) => {
    const searchQuery = (q ?? query).trim();
    const searchMode = m ?? mode;
    if (!searchQuery) return;
    stopPolling();
    setLoading(true);
    setReport(null);
    setJobStatus(null);
    setJobId(null);
    setEfError(null);

    try {
      const { data, error } = await supabase.functions.invoke('homatch-research', {
        body: { input: searchQuery, mode: searchMode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.job_id) throw new Error('No job_id returned');
      setJobId(data.job_id);
      setJobStatus({ job_id: data.job_id, status: 'PENDING', progress: { sources_found: 0, sources_read: 0, entities_found: 0, claims_extracted: 0, gemini_calls: 0 }, input_raw: searchQuery, input_type: searchMode });
      startPolling(data.job_id);
    } catch (e: unknown) {
      console.error('PI EF error:', e);
      setEfError((e as Error).message ?? 'Research failed. Please try again.');
      setLoading(false);
    }
  }, [query, mode, stopPolling, startPolling]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); };

  const switchMode = (m: PIMode) => {
    stopPolling();
    setMode(m);
    setReport(null);
    setJobStatus(null);
    setJobId(null);
    setEfError(null);
    setQuery('');
    setLoading(false);
  };

  const isTerminal = !loading && (report || efError);
  const showProgress = loading || (jobStatus && !['COMPLETED', 'PARTIAL', 'FAILED'].includes(jobStatus.status));

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">{t('verify_title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('verify_subtitle')}</p>
          <div className="flex items-start gap-2 mt-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-400/90">
              Research results are informational. Absent evidence does not imply risk or absence of title. Always verify with official Georgian authorities (NAPR, ENREG, my.gov.ge).
            </p>
          </div>
        </div>

        {/* Mode selector — exactly 2 top-level modes */}
        <div className="grid grid-cols-2 gap-2">
          {(['PROPERTY', 'CADASTRAL'] as PIMode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                mode === m
                  ? 'bg-primary text-primary-foreground border-primary shadow'
                  : 'bg-secondary text-foreground border-border hover:border-primary/40'
              }`}
            >
              {m === 'PROPERTY' ? t('verify_tab_property') : t('verify_tab_cadastral')}
            </button>
          ))}
        </div>

        {/* Input + mode hint */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'CADASTRAL' ? t('verify_search_cadastral_ph') : t('verify_search_property_ph')}
                className="pl-9 bg-secondary border-border font-mono"
                disabled={loading}
              />
            </div>
            <Button
              onClick={() => handleSearch()}
              disabled={!query.trim() || loading}
              className="shrink-0 gap-1.5"
            >
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t('verify_btn_searching')}</>
                : <><Search className="h-4 w-4" />{t('verify_btn_search')}</>
              }
            </Button>
          </div>
          {mode === 'CADASTRAL' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
              <Info className="h-3.5 w-3.5 shrink-0" />{t('verify_cadastral_hint')}
            </p>
          )}
          {mode === 'PROPERTY' && (
            <p className="text-xs text-muted-foreground px-1">
              Accepts: URL · address · project/developer name · free text or combinations
            </p>
          )}
        </div>

        {/* Progress panel */}
        {showProgress && jobStatus && (
          <PIProgressPanel jobStatus={jobStatus} t={t} />
        )}

        {/* Error */}
        {efError && !loading && (
          <div className="flex items-start gap-2 p-4 rounded-xl bg-destructive/5 border border-destructive/20">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Research failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{efError}</p>
            </div>
          </div>
        )}

        {/* Report */}
        {report && !loading && (
          <PIReportView report={report} t={t} navigate={navigate} />
        )}

        {/* Empty state */}
        {!loading && !jobStatus && !report && !efError && (
          <Card className="border-border bg-card">
            <CardContent className="py-12 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <p className="font-semibold text-foreground">{t('verify_empty_title')}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('verify_empty_desc')}</p>
              </div>
              {/* Official source quick-links */}
              <Separator className="w-full" />
              <div className="w-full space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Official Georgian sources (open externally)</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'NAPR Cadastral Map', url: 'https://ms.gov.ge/msmap/' },
                    { label: 'my.gov.ge Registry', url: 'https://my.gov.ge/ka-ge/services/5/service/176' },
                    { label: 'ENREG Company Registry', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index' },
                    { label: 'TAS Document Search', url: 'https://tas.ge/?p=searchdocument&menuItemId=7104' },
                  ].map(({ label, url }) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                      <Landmark className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 ml-auto" />
                    </a>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
