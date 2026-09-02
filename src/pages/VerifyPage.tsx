import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { validateVerifyQuery, type VerifyMode, type VerifyReasonCode } from '@/lib/verifyValidation';
import {
  Search, Shield, Building2, FileText, AlertTriangle, CheckCircle2,
  Clock, Info, ExternalLink, ChevronRight, Loader2, MapPin,
  TrendingUp, AlertCircle, CreditCard, Bot, Star, XCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────
type EvidenceStatus = 'VERIFIED' | 'HOMATCH_DATA' | 'FOUND_ONLINE' | 'CONFLICTING' | 'UNVERIFIED';

interface ResearchSource {
  label: string;
  url?: string;
  status: EvidenceStatus;
  excerpt?: string;
}

interface ResearchReport {
  status?: 'OK' | 'NO_EVIDENCE';
  queryType: string;
  entityName?: string;
  entityType?: string;
  confidence: number;
  summary: string;
  homatchData: {
    developer?: Record<string, unknown> | null;
    properties?: Record<string, unknown>[];
    matches?: Record<string, unknown>[];
    intents?: Record<string, unknown>[];
    trustScore?: Record<string, unknown> | null;
  };
  publicFindings: {
    companyInfo?: string;
    projectInfo?: string;
    riskFlags?: string[];
    newsSnippets?: { title: string; url: string; snippet: string }[];
  };
  cadastralInfo?: {
    number?: string;
    lookupStatus: 'not_searched' | 'searched_no_result' | 'found_public' | 'requires_official';
    publicFindings?: string;
    officialVerificationAvailable: boolean;
    estimatedCost?: { credits: number; description: string };
  };
  sources: ResearchSource[];
  actions: {
    id: string;
    label: string;
    path?: string;
    type: 'navigate' | 'ai_query' | 'verify' | 'external';
  }[];
  warnings: string[];
  searchedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────
// Evidence-badge colors are fixed; the label text is localized, so this maps
// status -> translation key rather than a hardcoded English string.
const EVIDENCE_CONFIG: Record<EvidenceStatus, { color: string; labelKey: string }> = {
  VERIFIED:     { color: 'bg-green-500/15 text-green-400 border-green-500/25',   labelKey: 'verify_evidence_verified' },
  HOMATCH_DATA: { color: 'bg-primary/10 text-primary border-primary/20',          labelKey: 'verify_evidence_homatch_data' },
  FOUND_ONLINE: { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       labelKey: 'verify_evidence_found_online' },
  CONFLICTING:  { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    labelKey: 'verify_evidence_conflicting' },
  UNVERIFIED:   { color: 'bg-muted text-muted-foreground border-border',          labelKey: 'verify_evidence_unverified' },
};

function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const { t } = useLanguage();
  const cfg = EVIDENCE_CONFIG[status] ?? EVIDENCE_CONFIG.UNVERIFIED;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${cfg.color}`}>
      {t(cfg.labelKey)}
    </span>
  );
}

function TrustRing({ score, label }: { score: number; label: string }) {
  const r = 36, circ = 2 * Math.PI * r;
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f5a623' : '#ef4444';
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
      <span className="text-xs font-medium text-muted-foreground text-center break-words max-w-[7rem]">{label}</span>
    </div>
  );
}

// ── Research result display ───────────────────────────────────
function ResearchResultView({
  report,
  onAskAI,
  onNavigate,
  onVerify,
}: {
  report: ResearchReport;
  onAskAI: (query: string) => void;
  onNavigate: (path: string) => void;
  onVerify: () => void;
}) {
  const { t } = useLanguage();
  const dev = report.homatchData?.developer as Record<string, unknown> | null | undefined;
  const props = report.homatchData?.properties ?? [];
  const trustScore = dev
    ? typeof dev.trust_score === 'number' ? dev.trust_score : null
    : null;

  return (
    <div className="space-y-4">
      {/* No-evidence state — a valid, non-failure outcome */}
      {report.status === 'NO_EVIDENCE' && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary/60 border border-border">
          <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('verify_no_evidence_title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('verify_no_evidence_desc')}</p>
          </div>
        </div>
      )}

      {/* Entity header */}
      <Card className="border-border bg-card">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            {trustScore !== null && (
              <TrustRing score={trustScore} label={t('verify_trust_score_label')} />
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-foreground text-base break-words">{report.entityName ?? ((report.homatchData?.developer && (report.homatchData.developer as Record<string,unknown>).name as string) ?? t('verify_entity_fallback'))}</h2>
                  <Badge variant="outline" className="text-[10px]">{report.entityType ?? report.queryType}</Badge>
                  <EvidenceBadge status={props.length > 0 || dev ? 'HOMATCH_DATA' : 'UNVERIFIED'} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-line">{report.summary}</p>
              </div>
              {/* Confidence bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('verify_confidence_label')}</span>
                  <span className="font-medium">{report.confidence}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${report.confidence >= 70 ? 'bg-green-500' : report.confidence >= 40 ? 'bg-amber-500' : 'bg-destructive'}`}
                    style={{ width: `${report.confidence}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Homatch DB data */}
      {(dev || props.length > 0) && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="h-4 w-4 text-primary" /> {t('verify_homatch_data_title')}
              <EvidenceBadge status="HOMATCH_DATA" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {dev && (
              <div className="space-y-1.5">
                <p className="font-medium text-foreground break-words">{(dev.name as string) ?? t('verify_tab_developer')}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {dev.trust_score != null && <div><span className="text-muted-foreground">{t('verify_trust_score_label')}: </span><span className="font-medium">{dev.trust_score as number}/100</span></div>}
                  {dev.verified != null && <div><span className="text-muted-foreground">{t('verify_verified_label')}: </span><span className={`font-medium ${dev.verified ? 'text-green-400' : 'text-muted-foreground'}`}>{dev.verified ? t('general_yes') : t('general_no')}</span></div>}
                </div>
                {Array.isArray(dev.developer_projects) && (dev.developer_projects as unknown[]).length > 0 && (
                  <div className="pt-1">
                    <p className="text-muted-foreground mb-1">{t('verify_projects_label')} ({(dev.developer_projects as unknown[]).length}):</p>
                    <div className="space-y-0.5">
                      {(dev.developer_projects as Record<string, unknown>[]).slice(0, 4).map((p, i) => (
                        <p key={i} className="text-muted-foreground/80 break-words">• {p.name as string} — {p.status as string}{p.city ? `, ${p.city}` : ''}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {props.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-muted-foreground">{t('verify_properties_label')} ({props.length}):</p>
                {(props as Record<string,unknown>[]).slice(0, 3).map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-border/30 last:border-0">
                    <span className="truncate">{p.title as string ?? p.id as string}</span>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 border border-border shrink-0"
                      onClick={() => onNavigate(`/property/${p.id}`)}>
                      {t('verify_view_btn')} <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Public findings */}
      {(report.publicFindings?.companyInfo || report.publicFindings?.projectInfo || (report.publicFindings?.riskFlags ?? []).length > 0) && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" /> {t('verify_public_findings_title')}
              <EvidenceBadge status="FOUND_ONLINE" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {report.publicFindings.companyInfo && (
              <p className="text-muted-foreground leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-line">{report.publicFindings.companyInfo}</p>
            )}
            {report.publicFindings.projectInfo && (
              <p className="text-muted-foreground leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-line">{report.publicFindings.projectInfo}</p>
            )}
            {(report.publicFindings.riskFlags ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-amber-400">{t('verify_risk_indicators')}</p>
                {(report.publicFindings.riskFlags ?? []).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-amber-400/90 break-words">{f}</span>
                  </div>
                ))}
              </div>
            )}
            {(report.publicFindings.newsSnippets ?? []).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="font-medium text-muted-foreground">{t('verify_news_web_title')}</p>
                {(report.publicFindings.newsSnippets ?? []).map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors group">
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary" />
                    <div className="min-w-0">
                      <p className="text-foreground font-medium group-hover:text-primary transition-colors break-words [overflow-wrap:anywhere]">{n.title}</p>
                      {n.snippet && <p className="text-muted-foreground/70 mt-0.5 line-clamp-2 break-words [overflow-wrap:anywhere]">{n.snippet}</p>}
                      <p className="text-muted-foreground/50 mt-0.5 truncate text-[10px]" dir="ltr">{n.url}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cadastral info */}
      {report.cadastralInfo && report.cadastralInfo.lookupStatus !== 'not_searched' && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> {t('verify_tab_cadastral')}
              <EvidenceBadge status={report.cadastralInfo.lookupStatus === 'found_public' ? 'FOUND_ONLINE' : 'UNVERIFIED'} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            {report.cadastralInfo.number && (
              <p><span className="text-muted-foreground">{t('verify_number_label')}: </span><span className="font-mono font-medium break-words [overflow-wrap:anywhere]">{report.cadastralInfo.number}</span></p>
            )}
            {report.cadastralInfo.publicFindings && (
              <p className="text-muted-foreground leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-line">{report.cadastralInfo.publicFindings}</p>
            )}
            {report.cadastralInfo.officialVerificationAvailable && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium text-foreground">{t('verify_official_verification_available')}</p>
                  {report.cadastralInfo.estimatedCost && (
                    <p className="text-muted-foreground mt-0.5 break-words">
                      ~{report.cadastralInfo.estimatedCost.credits} {t('verify_credits_word')} — {report.cadastralInfo.estimatedCost.description}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                  onClick={onVerify}>
                  <Shield className="h-3.5 w-3.5 mr-1.5" /> {t('verify_verify_officially_btn')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="space-y-1.5">
          {report.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-400/90 break-words">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sources — real, clickable links to the original page so the user can
          open and read each source directly. */}
      {report.sources.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('verify_data_sources')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {report.sources.map((src, i) => (
              <div key={i} className="flex flex-col gap-1 text-xs pb-2 border-b border-border/30 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <EvidenceBadge status={src.status} />
                  {src.url ? (
                    <a href={src.url} target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      <span className="break-words [overflow-wrap:anywhere]">{src.label}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground break-words [overflow-wrap:anywhere]">{src.label}</span>
                  )}
                </div>
                {src.excerpt && (
                  <p className="text-muted-foreground/70 break-words [overflow-wrap:anywhere] leading-relaxed">{src.excerpt}</p>
                )}
                {src.url && (
                  <p className="text-muted-foreground/50 truncate text-[10px]" dir="ltr">{src.url}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {report.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {report.actions.map(a => {
            // Known action types get a localized label regardless of what the
            // backend sent; only a genuinely unrecognized action falls back
            // to the raw (English) label the API provided.
            const label = a.type === 'ai_query' ? t('verify_ask_ai')
              : a.type === 'verify' ? t('verify_verify_officially_btn')
              : a.label;
            return (
              <Button key={a.id} size="sm" variant="outline" className="border-border text-xs gap-1.5"
                onClick={() => {
                  if (a.type === 'navigate' && a.path) onNavigate(a.path);
                  else if (a.type === 'ai_query') onAskAI(a.label);
                  else if (a.type === 'verify') onVerify();
                  else if (a.type === 'external' && a.path) window.open(a.path, '_blank');
                }}>
                {a.type === 'ai_query' && <Bot className="h-3 w-3" />}
                {a.type === 'verify' && <Shield className="h-3 w-3" />}
                {a.type === 'navigate' && <ChevronRight className="h-3 w-3" />}
                {a.type === 'external' && <ExternalLink className="h-3 w-3" />}
                <span className="break-words">{label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function VerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang } = useLanguage();
  const { session } = useAuth();

  const navState = location.state as { tab?: string; query?: string } | undefined;
  const VALID_TABS: VerifyMode[] = ['property', 'cadastral', 'developer', 'project'];

  const [tab, setTab] = useState<VerifyMode>((navState?.tab as VerifyMode) ?? 'property');
  const [query, setQuery] = useState(navState?.query ?? '');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [efError, setEfError] = useState<string | null>(null);
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  // Guards against a stale response overwriting a newer request's result
  // when the tab or query changes while a search is still in flight.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam && VALID_TABS.includes(tabParam as VerifyMode)) {
      setTab(tabParam as VerifyMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const reasonMessage = useCallback((reasonCode?: string): string => {
    switch (reasonCode) {
      case 'EMPTY': return t('verify_err_empty');
      case 'TOO_SHORT': return t('verify_err_too_short');
      case 'TOO_LONG': return t('verify_err_too_long');
      case 'LOOKS_LIKE_QUESTION': return t('verify_err_question');
      case 'INVALID_FORMAT': return tab === 'cadastral' ? t('verify_err_invalid_cadastral') : t('verify_err_invalid_name');
      default: return t('verify_error_generic');
    }
  }, [t, tab]);

  const handleSearch = useCallback(async (overrideQuery?: string, overrideTab?: VerifyMode) => {
    const searchTab = overrideTab ?? tab;
    const searchQuery = overrideQuery ?? query;
    const validation = validateVerifyQuery(searchTab, searchQuery);
    if (!validation.valid) {
      setEfError(reasonMessage(validation.reasonCode));
      setReport(null);
      return;
    }

    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setReport(null);
    setEfError(null);

    try {
      const { data, error } = await supabase.functions.invoke('homatch-research', {
        body: {
          query: validation.normalized,
          type: searchTab,
          userId: session?.user?.id,
          // The user's currently selected UI language — the backend forces
          // its ENTIRE answer (not just an echo of the query) into this
          // language, so results read correctly regardless of what script
          // the query itself was typed in. `locale` is the canonical field;
          // `language` is kept for backward compatibility with any other
          // consumer of this same payload shape.
          locale: lang,
          language: lang,
        },
      });
      if (myRequestId !== requestIdRef.current) return; // a newer request has since started

      if (error) {
        let reasonCode: VerifyReasonCode | undefined;
        let message: string | undefined;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            reasonCode = body?.reasonCode;
            message = body?.error;
          } catch { /* non-JSON error body */ }
        }
        setEfError(reasonCode ? reasonMessage(reasonCode) : (message || t('verify_error_generic')));
        return;
      }
      if (data?.error) {
        setEfError(data.reasonCode ? reasonMessage(data.reasonCode) : data.error);
        return;
      }
      setReport(data as ResearchReport);
    } catch (e: any) {
      if (myRequestId !== requestIdRef.current) return;
      console.error('Research EF error:', e);
      setEfError(t('verify_error_generic'));
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, [query, tab, session, reasonMessage, t]);

  useEffect(() => {
    if (navState?.query) handleSearch(navState.query, (navState.tab as VerifyMode) ?? 'property');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabLabels: Record<VerifyMode, string> = {
    property:  t('verify_tab_property'),
    cadastral: t('verify_tab_cadastral'),
    developer: t('verify_tab_developer'),
    project:   t('verify_tab_project'),
  };

  const placeholders: Record<VerifyMode, string> = {
    property:  t('verify_search_property_ph'),
    cadastral: t('verify_search_cadastral_ph'),
    developer: t('verify_search_developer_ph'),
    project:   t('verify_search_project_ph'),
  };

  const helperText: Record<VerifyMode, string> = {
    property:  t('verify_helper_property'),
    cadastral: t('verify_helper_cadastral'),
    developer: t('verify_helper_developer'),
    project:   t('verify_helper_project'),
  };

  const liveValidation = validateVerifyQuery(tab, query);
  const inlineError = query.trim().length > 0 && !liveValidation.valid ? reasonMessage(liveValidation.reasonCode) : null;
  const canSearch = liveValidation.valid && !loading;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSearch) handleSearch();
  };

  const handleAskAI = (prompt: string) => {
    navigate('/ai', {
      state: {
        context: { type: 'verify', data: { query, tab } },
        prompt,
      },
    });
  };

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
            <p className="text-xs text-amber-400/90 break-words">
              {t('verify_disclaimer')}
            </p>
          </div>
        </div>

        {/* Search tabs */}
        <Tabs value={tab} onValueChange={v => {
          requestIdRef.current++; // invalidate any in-flight request from the previous tab
          setTab(v as VerifyMode); setReport(null); setQuery(''); setEfError(null); setLoading(false);
        }}>
          {/* h-auto + whitespace-normal let a translated label that's longer
              than the English original (e.g. Georgian/Russian) wrap onto a
              second line instead of overflowing into the next tab on
              narrow/mobile screens. */}
          <TabsList className="grid grid-cols-4 bg-secondary border border-border w-full h-auto items-stretch gap-1 p-1">
            {(['property', 'cadastral', 'developer', 'project'] as const).map(k => (
              <TabsTrigger key={k} value={k}
                className="text-[11px] sm:text-xs leading-tight whitespace-normal text-center h-auto py-1.5 px-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {tabLabels[k]}
              </TabsTrigger>
            ))}
          </TabsList>

          {(['property', 'cadastral', 'developer', 'project'] as const).map(k => (
            <TabsContent key={k} value={k} className="mt-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={query}
                    onChange={e => { setQuery(e.target.value); setEfError(null); }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholders[k]}
                    aria-invalid={!!inlineError}
                    className="pl-9 bg-secondary border-border"
                  />
                </div>
                <Button onClick={() => handleSearch()} disabled={!canSearch}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : t('verify_btn_search')}
                </Button>
              </div>
              {inlineError ? (
                <p className="text-xs text-destructive mt-1.5 break-words">{inlineError}</p>
              ) : (
                <p className="text-xs text-muted-foreground/70 mt-1.5 break-words">{helperText[k]}</p>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground text-center px-4">{t('verify_loading_text')}</p>
          </div>
        )}

        {/* Error */}
        {efError && !loading && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/25">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">{t('verify_error_generic')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{efError}</p>
              {liveValidation.valid && (
                <Button size="sm" variant="outline" className="mt-2 border-border text-xs"
                  onClick={() => handleSearch()}>{t('verify_btn_retry')}</Button>
              )}
            </div>
          </div>
        )}

        {/* Research result */}
        {report && !loading && (
          <ResearchResultView
            report={report}
            onAskAI={handleAskAI}
            onNavigate={p => navigate(p)}
            onVerify={() => setShowVerifyConfirm(true)}
          />
        )}

        {/* Official verification confirm */}
        {showVerifyConfirm && report?.cadastralInfo?.estimatedCost && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" /> {t('verify_confirm_title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 rounded-lg bg-secondary space-y-1 text-xs">
                  <p className="font-medium text-foreground">{t('verify_confirm_what_checked')}</p>
                  <p className="text-muted-foreground break-words">{report.cadastralInfo.estimatedCost.description}</p>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('verify_confirm_cost_label')}</p>
                    <p className="font-semibold text-foreground">{report.cadastralInfo.estimatedCost.credits} {t('verify_credits_word')}</p>
                  </div>
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground break-words">
                  {t('verify_confirm_deduct_notice')}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-border text-xs"
                    onClick={() => setShowVerifyConfirm(false)}>{t('general_cancel')}</Button>
                  <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                    onClick={() => { setShowVerifyConfirm(false); navigate('/credits'); }}>
                    {t('verify_confirm_pay_btn')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty / intro state */}
        {!loading && !report && !efError && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center break-words">{t('verify_empty_desc')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              {[
                { icon: MapPin,    title: t('verify_tab_property'),   desc: t('verify_card_desc_property'),  tab: 'property'  },
                { icon: FileText,  title: t('verify_tab_cadastral'),  desc: t('verify_card_desc_cadastral'), tab: 'cadastral' },
                { icon: Building2, title: t('verify_tab_developer'),  desc: t('verify_card_desc_developer'), tab: 'developer' },
                { icon: Search,    title: t('verify_tab_project'),    desc: t('verify_card_desc_project'),   tab: 'project'   },
              ].map(({ icon: Icon, title, desc, tab: targetTab }) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => setTab(targetTab)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors text-left group"
                >
                  <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors break-words">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
