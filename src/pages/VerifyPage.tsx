import React, { useState, useEffect, useCallback } from 'react';
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
import {
  Search, Shield, Building2, FileText, AlertTriangle, CheckCircle2,
  Clock, Info, ExternalLink, ChevronRight, Loader2, MapPin,
  TrendingUp, AlertCircle, CreditCard, Bot, Star, XCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────
type EvidenceStatus = 'VERIFIED' | 'HOMATCH_DATA' | 'FOUND_ONLINE' | 'CONFLICTING' | 'UNVERIFIED';
type DataLabel = 'official' | 'source-reported' | 'ai-inference' | 'unavailable';

interface ResearchSource {
  label: string;
  url?: string;
  status: EvidenceStatus;
  excerpt?: string;
}

interface ResearchReport {
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
function labelConfig(type: DataLabel) {
  switch (type) {
    case 'official':        return { color: 'bg-green-500/10 text-green-400 border-green-500/20', icon: '🏛', text: 'Official/Public' };
    case 'source-reported': return { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   icon: '📋', text: 'Source-Reported' };
    case 'ai-inference':    return { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: '🤖', text: 'AI Inference' };
    case 'unavailable':     return { color: 'bg-muted text-muted-foreground border-border',       icon: '—',  text: 'Unavailable' };
  }
}

const EVIDENCE_CONFIG: Record<EvidenceStatus, { color: string; label: string }> = {
  VERIFIED:     { color: 'bg-green-500/15 text-green-400 border-green-500/25',   label: 'VERIFIED' },
  HOMATCH_DATA: { color: 'bg-primary/10 text-primary border-primary/20',          label: 'HOMATCH DATA' },
  FOUND_ONLINE: { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       label: 'FOUND ONLINE' },
  CONFLICTING:  { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    label: 'CONFLICTING' },
  UNVERIFIED:   { color: 'bg-muted text-muted-foreground border-border',          label: 'UNVERIFIED' },
};

function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const cfg = EVIDENCE_CONFIG[status] ?? EVIDENCE_CONFIG.UNVERIFIED;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${cfg.color}`}>
      {cfg.label}
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
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
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
  const dev = report.homatchData?.developer as Record<string, unknown> | null | undefined;
  const props = report.homatchData?.properties ?? [];
  const trustScore = dev
    ? typeof dev.trust_score === 'number' ? dev.trust_score : null
    : null;

  return (
    <div className="space-y-4">
      {/* Entity header */}
      <Card className="border-border bg-card">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            {trustScore !== null && (
              <TrustRing score={trustScore} label="Homatch Trust" />
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-foreground text-base">{report.entityName ?? ((report.homatchData?.developer && (report.homatchData.developer as Record<string,unknown>).name as string) ?? 'Entity')}</h2>
                  <Badge variant="outline" className="text-[10px]">{report.entityType ?? report.queryType}</Badge>
                  <EvidenceBadge status={props.length > 0 || dev ? 'HOMATCH_DATA' : 'UNVERIFIED'} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{report.summary}</p>
              </div>
              {/* Confidence bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Research confidence</span>
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
              <Star className="h-4 w-4 text-primary" /> Homatch Data
              <EvidenceBadge status="HOMATCH_DATA" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {dev && (
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">{(dev.name as string) ?? 'Developer'}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {dev.trust_score != null && <div><span className="text-muted-foreground">Trust Score: </span><span className="font-medium">{dev.trust_score as number}/100</span></div>}
                  {dev.verified != null && <div><span className="text-muted-foreground">Verified: </span><span className={`font-medium ${dev.verified ? 'text-green-400' : 'text-muted-foreground'}`}>{dev.verified ? 'Yes' : 'No'}</span></div>}
                </div>
                {Array.isArray(dev.developer_projects) && (dev.developer_projects as unknown[]).length > 0 && (
                  <div className="pt-1">
                    <p className="text-muted-foreground mb-1">Projects ({(dev.developer_projects as unknown[]).length}):</p>
                    <div className="space-y-0.5">
                      {(dev.developer_projects as Record<string, unknown>[]).slice(0, 4).map((p, i) => (
                        <p key={i} className="text-muted-foreground/80">• {p.name as string} — {p.status as string}{p.city ? `, ${p.city}` : ''}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {props.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-muted-foreground">Properties ({props.length}):</p>
                {(props as Record<string,unknown>[]).slice(0, 3).map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-border/30 last:border-0">
                    <span className="truncate">{p.title as string ?? p.id as string}</span>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 border border-border shrink-0"
                      onClick={() => onNavigate(`/property/${p.id}`)}>
                      View <ChevronRight className="h-3 w-3 ml-0.5" />
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
              <Search className="h-4 w-4 text-primary" /> Public Findings
              <EvidenceBadge status="FOUND_ONLINE" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {report.publicFindings.companyInfo && (
              <p className="text-muted-foreground leading-relaxed">{report.publicFindings.companyInfo}</p>
            )}
            {report.publicFindings.projectInfo && (
              <p className="text-muted-foreground leading-relaxed">{report.publicFindings.projectInfo}</p>
            )}
            {(report.publicFindings.riskFlags ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-amber-400">Risk Flags</p>
                {(report.publicFindings.riskFlags ?? []).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-amber-400/90">{f}</span>
                  </div>
                ))}
              </div>
            )}
            {(report.publicFindings.newsSnippets ?? []).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="font-medium text-muted-foreground">News / Web</p>
                {(report.publicFindings.newsSnippets ?? []).map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors group">
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary" />
                    <div>
                      <p className="text-foreground font-medium group-hover:text-primary transition-colors">{n.title}</p>
                      <p className="text-muted-foreground/70 mt-0.5 line-clamp-2">{n.snippet}</p>
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
              <FileText className="h-4 w-4 text-primary" /> Cadastral
              <EvidenceBadge status={report.cadastralInfo.lookupStatus === 'found_public' ? 'FOUND_ONLINE' : 'UNVERIFIED'} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            {report.cadastralInfo.number && (
              <p><span className="text-muted-foreground">Number: </span><span className="font-mono font-medium">{report.cadastralInfo.number}</span></p>
            )}
            {report.cadastralInfo.publicFindings && (
              <p className="text-muted-foreground leading-relaxed">{report.cadastralInfo.publicFindings}</p>
            )}
            {report.cadastralInfo.officialVerificationAvailable && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium text-foreground">Official Verification Available</p>
                  {report.cadastralInfo.estimatedCost && (
                    <p className="text-muted-foreground mt-0.5">
                      ~{report.cadastralInfo.estimatedCost.credits} credits — {report.cadastralInfo.estimatedCost.description}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                  onClick={onVerify}>
                  <Shield className="h-3.5 w-3.5 mr-1.5" /> Verify Officially
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
              <p className="text-xs text-amber-400/90">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sources */}
      {report.sources.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {report.sources.map((src, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <EvidenceBadge status={src.status} />
                {src.url ? (
                  <a href={src.url} target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 truncate">
                    {src.label} <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted-foreground truncate">{src.label}</span>
                )}
                {src.excerpt && <span className="text-muted-foreground/60 truncate hidden md:inline">— {src.excerpt}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {report.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {report.actions.map(a => (
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
              {a.label}
            </Button>
          ))}
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

  const navState = location.state as { tab?: string; query?: string } | undefined;

  const [tab, setTab] = useState(navState?.tab ?? 'property');
  const [query, setQuery] = useState(navState?.query ?? '');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [efError, setEfError] = useState<string | null>(null);
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['property', 'cadastral', 'developer', 'project'].includes(tabParam)) {
      setTab(tabParam);
    }
  }, [location.search]);

  useEffect(() => {
    if (navState?.query) handleSearch(navState.query, navState.tab ?? 'property');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabLabels: Record<string, string> = {
    property:  t('verify_tab_property'),
    cadastral: t('verify_tab_cadastral'),
    developer: t('verify_tab_developer'),
    project:   t('verify_tab_project'),
  };

  const placeholders: Record<string, string> = {
    property:  t('verify_search_property_ph'),
    cadastral: t('verify_search_cadastral_ph'),
    developer: t('verify_search_developer_ph'),
    project:   t('verify_search_project_ph'),
  };

  const handleSearch = useCallback(async (q?: string, activeTab?: string) => {
    const searchQuery = (q ?? query).trim();
    const searchTab = activeTab ?? tab;
    if (!searchQuery) return;
    setLoading(true);
    setReport(null);
    setEfError(null);

    try {
      const { data, error } = await supabase.functions.invoke('homatch-research', {
        body: {
          query: searchQuery,
          type: searchTab === 'project' ? 'developer' : searchTab,
          userId: session?.user?.id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReport(data as ResearchReport);
    } catch (e: any) {
      console.error('Research EF error:', e);
      setEfError(e.message ?? 'Research failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [query, tab, session]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
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
          <div className="flex items-center gap-2 mt-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Info className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400/90">
              Research results are informational and do not constitute legal, financial or fraud guarantees.
              Always verify with official authorities.
            </p>
          </div>
        </div>

        {/* Search tabs */}
        <Tabs value={tab} onValueChange={v => { setTab(v); setReport(null); setQuery(''); setEfError(null); }}>
          <TabsList className="grid grid-cols-4 bg-secondary border border-border w-full">
            {(['property', 'cadastral', 'developer', 'project'] as const).map(k => (
              <TabsTrigger key={k} value={k}
                className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
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
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholders[k]}
                    className="pl-9 bg-secondary border-border"
                  />
                </div>
                <Button onClick={() => handleSearch()} disabled={!query.trim() || loading}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : t('verify_btn_search')}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Searching Homatch DB and public sources…</p>
          </div>
        )}

        {/* Error */}
        {efError && !loading && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/25">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Research failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{efError}</p>
              <Button size="sm" variant="outline" className="mt-2 border-border text-xs"
                onClick={() => handleSearch()}>Retry</Button>
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
                  <Shield className="h-5 w-5 text-primary" /> Official Verification
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 rounded-lg bg-secondary space-y-1 text-xs">
                  <p className="font-medium text-foreground">What will be checked:</p>
                  <p className="text-muted-foreground">{report.cadastralInfo.estimatedCost.description}</p>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <div>
                    <p className="text-xs text-muted-foreground">Cost</p>
                    <p className="font-semibold text-foreground">{report.cadastralInfo.estimatedCost.credits} Credits</p>
                  </div>
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Credits will be deducted after confirmation. No charge if the service is unavailable.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-border text-xs"
                    onClick={() => setShowVerifyConfirm(false)}>Cancel</Button>
                  <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                    onClick={() => { setShowVerifyConfirm(false); navigate('/credits'); }}>
                    Confirm &amp; Pay
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty / intro state */}
        {!loading && !report && !efError && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">{t('verify_empty_desc')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              {[
                { icon: MapPin,    title: t('verify_tab_property'),   desc: 'Cadastral match, area discrepancy, ownership, encumbrances',   tab: 'property'  },
                { icon: FileText,  title: t('verify_tab_cadastral'),  desc: 'Retrieve official record by cadastral code',                    tab: 'cadastral' },
                { icon: Building2, title: t('verify_tab_developer'),  desc: 'Company history, project completion, risk indicators',          tab: 'developer' },
                { icon: Search,    title: t('verify_tab_project'),    desc: 'Active permits, construction progress, delivery history',       tab: 'project'   },
              ].map(({ icon: Icon, title, desc, tab: targetTab }) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => setTab(targetTab)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors text-left group"
                >
                  <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
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
