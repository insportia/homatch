import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AppLayout } from '@/components/layouts/AppLayout';
import {
  Search, Shield, Building2, FileText, AlertTriangle, CheckCircle2,
  Clock, Info, ExternalLink, ChevronRight, Loader2, MapPin,
  TrendingUp, AlertCircle, CreditCard,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────
type DataLabel = 'official' | 'source-reported' | 'ai-inference' | 'unavailable';

interface DataPoint {
  label: string;
  value: string | null;
  type: DataLabel;
}

interface VerifyResult {
  kind: 'property' | 'developer';
  query: string;
  trustScore?: number;
  trustLabel?: string;
  lastChecked?: string;
  dataPoints: DataPoint[];
  riskIndicators: string[];
  sources: string[];
  sponsoredNote?: string;
}

// ── Helpers ───────────────────────────────────────────────────
function labelConfig(t: DataLabel) {
  switch (t) {
    case 'official':         return { color: 'bg-green-500/10 text-green-400 border-green-500/20', icon: '🏛', text: 'Official/Public' };
    case 'source-reported':  return { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   icon: '📋', text: 'Source-Reported' };
    case 'ai-inference':     return { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: '🤖', text: 'AI Inference' };
    case 'unavailable':      return { color: 'bg-muted text-muted-foreground border-border',       icon: '—',  text: 'Unavailable' };
  }
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

function DataPointRow({ dp }: { dp: DataPoint }) {
  const cfg = labelConfig(dp.type);
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground flex-1">{dp.label}</span>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-sm ${dp.value ? 'text-foreground' : 'text-muted-foreground/50 italic'}`}>
          {dp.value ?? 'Not available'}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cfg.color}`}>
          {cfg.icon} {cfg.text}
        </span>
      </div>
    </div>
  );
}

// ── Demo result generator ─────────────────────────────────────
function buildDemoResult(tab: string, query: string): VerifyResult {
  if (tab === 'developer' || tab === 'project') {
    return {
      kind: 'developer',
      query,
      trustScore: 72,
      trustLabel: 'Moderate Confidence',
      lastChecked: '2 hours ago',
      dataPoints: [
        { label: 'Company Name', value: query, type: 'source-reported' },
        { label: 'Registration', value: 'Registered in Georgia (2016)', type: 'official' },
        { label: 'Active Projects', value: '3 (Tbilisi, Batumi)', type: 'source-reported' },
        { label: 'Completed Projects', value: '7 delivered', type: 'source-reported' },
        { label: 'Permit Status', value: 'Active building permit — Vake district', type: 'official' },
        { label: 'Cadastral Records', value: null, type: 'unavailable' },
        { label: 'Completion History', value: 'Average delay: ~4 months', type: 'ai-inference' },
        { label: 'Court Records', value: 'No public cases found', type: 'official' },
      ],
      riskIndicators: ['Minor delivery delays in 2 projects (2022)', 'One complaint filed publicly (resolved)'],
      sources: ['napr.gov.ge', 'rs.ge', 'Homatch Discovery', 'myhome.ge'],
      sponsoredNote: undefined,
    };
  }
  return {
    kind: 'property',
    query,
    trustScore: 84,
    trustLabel: 'High Confidence',
    lastChecked: '14 minutes ago',
    dataPoints: [
      { label: 'Cadastral Code', value: '01.19.06.012.047', type: 'official' },
      { label: 'Address', value: 'Vake District, Tbilisi, Georgia', type: 'official' },
      { label: 'Official Area', value: '78 m²', type: 'official' },
      { label: 'Listed Area', value: '80 m²', type: 'source-reported' },
      { label: 'Area Discrepancy', value: '+2 m² vs cadastral record', type: 'ai-inference' },
      { label: 'Ownership Record', value: 'Single owner (2019–present)', type: 'official' },
      { label: 'Mortgage / Lien', value: 'No encumbrance found', type: 'official' },
      { label: 'Floor', value: '4 of 9', type: 'source-reported' },
      { label: 'Year Built', value: null, type: 'unavailable' },
    ],
    riskIndicators: ['Minor area discrepancy (2 m² above cadastral) — verify with seller'],
    sources: ['napr.gov.ge', 'myhome.ge', 'ss.ge', 'Homatch Trust Engine'],
  };
}

// ── Main Component ────────────────────────────────────────────
export default function VerifyPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('property');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [showDocOrder, setShowDocOrder] = useState(false);

  const tabLabels: Record<string, string> = {
    property:  'Property',
    cadastral: 'Cadastral Code',
    developer: 'Developer',
    project:   'Project',
  };

  const placeholders: Record<string, string> = {
    property:  'Enter address, property URL or listing ID…',
    cadastral: 'Enter cadastral code (e.g. 01.19.06.012.047)…',
    developer: 'Enter developer or company name…',
    project:   'Enter project name…',
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    // Simulate async verification
    await new Promise(r => setTimeout(r, 1500));
    setResult(buildDemoResult(tab, query.trim()));
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Verification Center</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Check property records, cadastral data, developer trust and project history before you decide.
          </p>
          <div className="flex items-center gap-2 mt-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Info className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400/90">
              Scores are informational and never constitute legal, financial or fraud guarantees. Always verify with official authorities.
            </p>
          </div>
        </div>

        {/* Search tabs */}
        <Tabs value={tab} onValueChange={v => { setTab(v); setResult(null); setQuery(''); }}>
          <TabsList className="grid grid-cols-4 bg-secondary border border-border w-full">
            {['property', 'cadastral', 'developer', 'project'].map(k => (
              <TabsTrigger key={k} value={k} className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {tabLabels[k]}
              </TabsTrigger>
            ))}
          </TabsList>

          {['property', 'cadastral', 'developer', 'project'].map(k => (
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
                <Button onClick={handleSearch} disabled={!query.trim() || loading}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Results */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Checking official records and sources…</p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4 animate-fade-in">
            {/* Trust score card */}
            <Card className="border-border bg-card">
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  {result.trustScore !== undefined && (
                    <TrustRing score={result.trustScore} label={result.trustLabel ?? ''} />
                  )}
                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <h2 className="font-semibold text-foreground text-base truncate">{result.query}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Last checked {result.lastChecked}</span>
                      </div>
                    </div>

                    {result.riskIndicators.length > 0 && (
                      <div className="space-y-1.5">
                        {result.riskIndicators.map((ri, i) => (
                          <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <span className="text-xs text-amber-400/90">{ri}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {result.sources.map(s => (
                        <Badge key={s} variant="secondary" className="text-[10px] border-border">{s}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data points */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  {result.kind === 'developer' ? 'Developer Data' : 'Property Record'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {result.dataPoints.map((dp, i) => <DataPointRow key={i} dp={dp} />)}
              </CardContent>
            </Card>

            {/* Data legend */}
            <Card className="border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Data Source Legend</p>
                <div className="flex flex-wrap gap-2">
                  {(['official', 'source-reported', 'ai-inference', 'unavailable'] as DataLabel[]).map(t => {
                    const cfg = labelConfig(t);
                    return (
                      <span key={t} className={`text-[10px] px-2 py-1 rounded border font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.text}
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Order official docs (property only) */}
            {result.kind === 'property' && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                      <CreditCard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Order Official Document Extract</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Get a certified extract from NAPR. Requires confirmation — <strong>5 credits</strong>.
                        </p>
                      </div>
                    </div>
                    {!showDocOrder ? (
                      <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                        onClick={() => setShowDocOrder(true)}>
                        Order Extract
                      </Button>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="ghost" onClick={() => setShowDocOrder(false)} className="border border-border text-muted-foreground">
                          Cancel
                        </Button>
                        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() => navigate('/credits')}>
                          Confirm (5 Credits)
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ask AI about this */}
            <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
              <TrendingUp className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Want deeper analysis?</p>
                <p className="text-xs text-muted-foreground">Ask Homatch AI about this {result.kind}.</p>
              </div>
              <Button size="sm" variant="ghost" className="border border-border shrink-0"
                onClick={() => navigate('/ai', {
                  state: {
                    context: { type: result.kind, data: { query: result.query } },
                    prompt: `Tell me more about "${result.query}" — any red flags?`,
                  },
                })}>
                Ask AI <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Empty / intro state */}
        {!loading && !result && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            {[
              { icon: MapPin,    title: 'Property Check',    desc: 'Cadastral match, area discrepancy, ownership, encumbrances' },
              { icon: FileText,  title: 'Cadastral Lookup',  desc: 'Retrieve official record by cadastral code' },
              { icon: Building2, title: 'Developer Profile', desc: 'Company history, project completion, risk indicators' },
              { icon: Search,    title: 'Project Status',    desc: 'Active permits, construction progress, delivery history' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
