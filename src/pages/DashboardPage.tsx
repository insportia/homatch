import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  PlusCircle, MapPin, DollarSign, Maximize2, BedDouble, Zap, Trash2,
  ExternalLink, LayoutGrid, Building2, Search, Brain, Globe2, CheckCircle2,
  Loader2, Radio, ShieldCheck, Bot, Shield, MessageSquare, Bell, CalendarDays,
  Sparkles, ArrowRight, TrendingUp, Users,
} from 'lucide-react';
import { getProperties, softDeleteProperty } from '@/services/api';
import {
  getLatestProgressForProperties, getUserMatchSummary,
  type MatchingRunProgress,
} from '@/services/matchingProgress';
import type { Property } from '@/types/types';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';

// ── Sub-components (unchanged from Phase 3) ──────────────────
function StatusBadge({ status, run }: { status: string; run?: MatchingRunProgress }) {
  const { t } = useLanguage();
  if (run?.status === 'RUNNING') return <span className="status-active">{t('dash_status_ai_searching', { percent: run.progress_percent })}</span>;
  if (status === 'ACTIVE') return <span className="status-active">{t('dash_status_matching_active')}</span>;
  if (status === 'PAUSED') return <span className="status-paused">{t('dash_status_paused_caps')}</span>;
  return <span className="status-paused">{t('dash_status_draft')}</span>;
}

function PropertyCard({ prop, run, onDelete }: { prop: Property; run?: MatchingRunProgress; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  const { t, isRTL } = useLanguage();
  const facts = prop.facts;
  const isPrivate = prop.source_type === 'PRIVATE_LISTING';
  const locationParts = [facts?.district, facts?.city, facts?.country].filter(Boolean).join(', ');
  const running = run?.status === 'RUNNING';
  const score = running ? run.progress_percent : (prop.matchability_score ?? 0);
  const scoreColor = running ? 'text-primary' : score >= 80 ? 'text-green-400' : score >= 50 ? 'text-primary' : 'text-muted-foreground';
  const label = running ? t('dash_label_ai_progress') : t('dash_label_best_match');

  return (
    <div className="group relative rounded-xl border border-border bg-card card-hover cursor-pointer overflow-hidden"
      onClick={() => navigate(`/property/${prop.id}`)} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/property/${prop.id}`)}>
      <div className="aspect-[16/9] bg-secondary relative overflow-hidden">
        {prop.cover_photo_url
          ? <img src={prop.cover_photo_url} alt={prop.title ?? t('as_default_property_name')} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Building2 className="h-8 w-8 text-muted-foreground/30" /></div>}
        <div className={`absolute top-2 ${isRTL ? 'right-2' : 'left-2'} flex flex-col gap-1`}>
          {isPrivate && <span className="status-private">{t('prop_private_badge')}</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(prop.id); }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 bg-background/80 rounded-md flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
          aria-label={t('dash_delete_property_aria')}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-foreground truncate">
              {prop.title ?? (isPrivate ? t('dash_private_listing') : t('dash_imported_property'))}
            </h3>
            {locationParts && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{locationParts}</span>
              </p>
            )}
          </div>
          <StatusBadge status={prop.matching_status} run={run} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {facts?.total_price && (
            <span className="text-sm font-semibold text-foreground flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5 text-primary" />
              {Number(facts.total_price).toLocaleString()} {facts?.currency ?? ''}
            </span>
          )}
          {facts?.area && <span className="text-xs text-muted-foreground flex items-center gap-1"><Maximize2 className="h-3 w-3" />{facts.area} {t('prop_area')}</span>}
          {facts?.bedrooms && <span className="text-xs text-muted-foreground flex items-center gap-1"><BedDouble className="h-3 w-3" />{facts.bedrooms} {t('prop_bedrooms')}</span>}
        </div>
        <div className="pt-2 border-t border-border/50 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className={`h-3.5 w-3.5 ${running ? 'text-primary animate-pulse' : 'text-primary'}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <span className={`text-xs font-semibold ${scoreColor}`}>{score}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${score}%` }} />
          </div>
          {running && run?.message && <p className="text-[11px] text-muted-foreground truncate">{run.message}</p>}
          {!running && run?.status === 'COMPLETED' && Number(run.counters?.matches ?? 0) === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('dash_last_scan_no_matches')}</p>
          )}
        </div>
        {/* Quick AI action */}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            navigate('/ai', {
              state: {
                context: { type: 'property', data: { id: prop.id, title: prop.title, city: facts?.city } },
                prompt: t('dash_ai_tell_prompt', { name: prop.title ?? facts?.city ?? prop.id }),
              },
            });
          }}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-colors text-xs text-muted-foreground hover:text-foreground"
        >
          <Bot className="h-3 w-3 text-primary shrink-0" />
          {t('dash_ask_ai_property')}
          <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground/40" />
        </button>
      </div>
    </div>
  );
}

function StatsCard({ label, value, icon: Icon, accent = false }: { label: string; value: string | number; icon: React.ElementType; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${accent ? 'text-primary' : 'text-muted-foreground/50'}`} />
      </div>
      <p className={`text-2xl font-semibold ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

// Platform names (Facebook, Telegram, Instagram, VK, Reddit) are third-party
// brand names — never translated, same as everywhere else in the app.
const SOURCE_LABEL_KEYS: Record<string, string> = {
  google: 'dash_source_public_web', forums: 'dash_source_forums',
};
const SOURCE_BRAND_LABELS: Record<string, string> = {
  facebook: 'Facebook', telegram: 'Telegram', threads: 'Threads',
  instagram: 'Instagram', vk: 'VK', reddit: 'Reddit',
};

function LiveMatchingPanel({ run }: { run: MatchingRunProgress }) {
  const { t } = useLanguage();
  const sources = run.sources || {};
  const counters = run.counters || {};
  const running = run.status === 'RUNNING';
  const stages = [
    ['ANALYZING_PROPERTY', t('dash_stage_property_analysis'), Brain],
    ['SEARCH_PROFILE_READY', t('dash_stage_search_profile'), Search],
    ['WEB_DISCOVERY', t('dash_stage_web_discovery'), Globe2],
    ['SOCIAL_DISCOVERY', t('dash_stage_social_discovery'), Radio],
    ['AI_CLASSIFICATION', t('dash_stage_demand_classification'), ShieldCheck],
    ['MATCH_SCORING', t('dash_stage_match_scoring'), Zap],
  ] as const;
  const order = stages.map(s => s[0]);
  const currentIndex = order.indexOf(run.stage as typeof order[number]);
  const statusLabel = running ? t('dash_status_live') : run.status === 'COMPLETED' ? t('dash_status_completed') : run.status === 'FAILED' ? t('dash_status_failed') : run.status === 'PAUSED' ? t('as_status_paused') : run.status;

  return (
    <div className="rounded-xl border border-primary/30 bg-card overflow-hidden">
      <div className="p-4 md:p-5 border-b border-border/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            {running ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <CheckCircle2 className="w-5 h-5 text-green-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{t('dash_ai_matching_title')} {statusLabel}</h3>
              {running && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">{t('dash_status_live')}</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{run.message || run.stage}</p>
          </div>
        </div>
        <span className="text-xl font-semibold text-primary">{run.progress_percent}%</span>
      </div>
      <div className="h-1 bg-secondary"><div className="h-full bg-primary transition-all duration-500" style={{ width: `${run.progress_percent}%` }} /></div>
      <div className="p-4 md:p-5 grid md:grid-cols-2 gap-5">
        <div className="space-y-2.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t('dash_ai_process_label')}</p>
          {stages.map(([key, label, Icon], idx) => {
            const done = run.status === 'COMPLETED' || (currentIndex >= 0 && idx < currentIndex);
            const active = run.stage === key;
            return (
              <div key={key} className="flex items-center gap-2 text-xs">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${done ? 'bg-green-500/10 text-green-400' : active ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                  {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3 h-3" />}
                </div>
                <span className={active ? 'text-foreground font-medium' : 'text-muted-foreground'}>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{t('dash_sources_label')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(sources).map(([key, value]) => (
                <span key={key} className={`text-[10px] px-2 py-1 rounded-md border ${String(value).includes('done') ? 'border-green-500/20 bg-green-500/5 text-green-400' : String(value).includes('error') ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-border bg-secondary/40 text-muted-foreground'}`}>
                  {(SOURCE_LABEL_KEYS[key] ? t(SOURCE_LABEL_KEYS[key]) : SOURCE_BRAND_LABELS[key]) || key}: {String(value).split('-').join(' ')}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniMetric label={t('dash_metric_web_candidates')} value={counters.webCandidates ?? 0} />
            <MiniMetric label={t('dash_metric_social_candidates')} value={counters.socialCandidates ?? 0} />
            <MiniMetric label={t('dash_metric_qualified_demand')} value={counters.classified ?? 0} />
            <MiniMetric label={t('dash_metric_matches_20')} value={counters.matches ?? 0} />
          </div>
          {counters.buckets && (
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              <span>20–49%: {counters.buckets['20-49'] ?? 0}</span>
              <span>50–79%: {counters.buckets['50-79'] ?? 0}</span>
              <span>80%+: {counters.buckets['80-100'] ?? 0}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-secondary/40 border border-border/60 p-2">
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className="text-base font-semibold mt-0.5">{value}</p>
    </div>
  );
}

// ── Quick-action cards shown when user has no properties ──────
function EmptyDashboard() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const SECONDARY_ACTIONS = [
    { icon: Shield,       titleKey: 'dash_secondary_verify_title',   descKey: 'dash_secondary_verify_desc',   path: '/verify' },
    { icon: Bell,         titleKey: 'dash_secondary_active_search_title', descKey: 'dash_secondary_active_search_desc', path: '/active-search' },
    { icon: MessageSquare,titleKey: 'nav_chat',                      descKey: 'dash_secondary_messages_desc', path: '/chat' },
  ];
  return (
    <div className="space-y-6">
      {/* AI entry point */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-base font-semibold text-foreground">{t('dash_empty_ai_title')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t('dash_empty_ai_desc')}
        </p>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          onClick={() => navigate('/ai')}>
          <Bot className="h-4 w-4" /> {t('dash_empty_open_ai')}
        </Button>
      </div>

      {/* Two-path cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border border-border bg-card space-y-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Search className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">{t('dash_empty_find_property_title')}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('dash_empty_find_property_desc')}
          </p>
          <Button size="sm" variant="outline" className="border-border gap-2 w-full"
            onClick={() => navigate('/ai')}>
            {t('nav_ask_ai_short')} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="p-5 rounded-xl border border-border bg-card space-y-3">
          <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center">
            <Users className="h-5 w-5 text-accent-foreground" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">{t('dash_empty_find_buyers_title')}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('dash_empty_find_buyers_desc')}
          </p>
          <Button size="sm" variant="outline" className="border-border gap-2 w-full"
            onClick={() => navigate('/property/add')}>
            {t('dash_empty_add_property')} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Secondary actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {SECONDARY_ACTIONS.map(({ icon: Icon, titleKey, descKey, path }) => (
          <button key={path} type="button" onClick={() => navigate(path)}
            className="p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors text-left space-y-1.5">
            <Icon className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t(titleKey)}</p>
            <p className="text-xs text-muted-foreground">{t(descKey)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Context-aware top widget ──────────────────────────────────
function DashboardHero({ name, matchCount, newCount, topPropertyId }: { name?: string; matchCount: number; newCount: number; topPropertyId: string | null }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col md:flex-row gap-4 items-start md:items-center">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">
          {name ? t('dash_welcome_back_name', { name: name.split(' ')[0] }) : t('dash_welcome_back')}
        </p>
        {matchCount > 0 ? (
          <h2 className="text-base font-semibold text-foreground">
            <span className="text-primary font-bold">{t('dash_matches_summary', { count: matchCount })}</span>
            {newCount > 0 && <span className="text-green-400"> ({t('dash_new_count', { count: newCount })})</span>}
          </h2>
        ) : (
          <h2 className="text-base font-semibold text-foreground">{t('dash_continue_ai')}</h2>
        )}
        <p className="text-xs text-muted-foreground">
          {t('dash_hero_subtitle')}
        </p>
      </div>
      <div className="flex gap-2 shrink-0 flex-wrap">
        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          onClick={() => navigate('/ai')}>
          <Bot className="h-3.5 w-3.5" /> {t('nav_ask_ai_short')}
        </Button>
        {matchCount > 0 && topPropertyId && (
          // Matches are only ever shown per-property (/property/:id/matches) — there is
          // no single "all matches" page — so this routes to whichever property has the
          // most unseen matches (topPropertyId, computed in getUserMatchSummary). This
          // used to navigate('/dashboard'), a no-op self-navigation since the button
          // already lives on the dashboard.
          <Button size="sm" variant="outline" className="border-border gap-2"
            onClick={() => navigate(`/property/${topPropertyId}/matches`)}>
            <TrendingUp className="h-3.5 w-3.5" /> {t('dash_view_matches')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────
function DashboardContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [properties, setProperties] = useState<Property[]>([]);
  const [progress, setProgress] = useState<Record<string, MatchingRunProgress>>({});
  const [matchSummary, setMatchSummary] = useState<{ total: number; newCount: number; bestScore: number; topPropertyId: string | null }>({ total: 0, newCount: 0, bestScore: 0, topPropertyId: null });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!homatchUser) return;
    const props = await getProperties(homatchUser.id);
    setProperties(props);
    const ids = props.map(p => p.id);
    const [runs, summary] = await Promise.all([
      getLatestProgressForProperties(ids),
      getUserMatchSummary(ids),
    ]);
    setProgress(runs);
    setMatchSummary(summary);
    setLoading(false);
  }, [homatchUser]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!homatchUser) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [homatchUser, refresh]);

  const liveRuns = useMemo(() =>
    Object.values(progress).filter(r => r.status === 'RUNNING').sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [progress]);
  const activeCount = properties.filter(p => p.matching_status === 'ACTIVE').length;

  const handleDelete = async () => {
    if (!deleteId) return;
    await softDeleteProperty(deleteId);
    setDeleteId(null);
    toast.success(t('dash_toast_property_deleted'));
    await refresh();
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-foreground">{t('dash_title')}</h1>
          </div>
          <Button onClick={() => navigate('/property/add')}
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm h-9 px-4">
            <PlusCircle className="h-4 w-4 mr-2" />{t('dash_add_property')}
          </Button>
        </div>

        {/* Context-aware hero widget */}
        <DashboardHero
          name={homatchUser?.full_name}
          matchCount={matchSummary.total}
          newCount={matchSummary.newCount}
          topPropertyId={matchSummary.topPropertyId}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsCard label={t('dash_total_properties')} value={properties.length} icon={LayoutGrid} />
          <StatsCard label={t('dash_active_matching')} value={activeCount} icon={Zap} accent />
          <StatsCard label={t('dash_total_matches')} value={matchSummary.total} icon={ExternalLink} />
          <StatsCard label={t('dash_new_matches')} value={matchSummary.newCount} icon={Radio} accent={matchSummary.newCount > 0} />
        </div>

        {/* Live Chat — prominent, always visible, separate from AI chat */}
        <button
          type="button"
          onClick={() => navigate('/live-chat')}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{t('nav_live_chat')}</span>
              <Badge className="bg-primary text-primary-foreground text-[9px] px-1.5">{t('home_livechat_badge')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{t('live_chat_dashboard_desc')}</p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>

        {/* Live matching panels */}
        {liveRuns.map(run => <LiveMatchingPanel key={run.id} run={run} />)}
        {!liveRuns.length && Object.values(progress).filter(r => r.status === 'COMPLETED').slice(0, 1).map(run => (
          <LiveMatchingPanel key={run.id} run={run} />
        ))}

        {/* Properties */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            {t('dash_your_properties')}
          </h2>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="aspect-[16/9] bg-muted animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : properties.length === 0 ? (
            <EmptyDashboard />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {properties.map(prop => (
                <PropertyCard key={prop.id} prop={prop} run={progress[prop.id]} onDelete={setDeleteId} />
              ))}
            </div>
          )}
        </div>

        {/* Quick nav when user has properties */}
        {!loading && properties.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            {[
              { icon: Bot,          labelKey: 'nav_ai'           as const, path: '/ai' },
              { icon: Radio,        labelKey: 'nav_live_chat'    as const, path: '/live-chat' },
              { icon: Shield,       labelKey: 'nav_verify'       as const, path: '/verify' },
              { icon: Bell,         labelKey: 'nav_active_search' as const, path: '/active-search' },
              { icon: CalendarDays, labelKey: 'nav_viewings'     as const, path: '/viewings' },
            ].map(({ icon: Icon, labelKey, path }) => (
              <button key={path} type="button" onClick={() => navigate(path)}
                className="flex items-center gap-2 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm text-muted-foreground hover:text-foreground">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('prop_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{t('prop_delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">{t('prop_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('prop_confirm_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function DashboardPage() { return <RouteGuard><DashboardContent /></RouteGuard>; }
