import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users, Building2, Zap, Activity, Puzzle, Unlock,
  TrendingUp, DollarSign, BarChart2, Percent, BadgeDollarSign, ArrowRight,
} from 'lucide-react';
import { getAdminOverviewStats, getSpendCapStatus } from '@/services/api';
import type { AdminOverviewStats, SpendCapStatus } from '@/types/types';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { creditsToUsd, formatCredits, formatUsd, marginState } from '@/admin/money';

function StatCard({ title, value, sub, icon: Icon, accent = false, warn = false }: {
  title: string; value: string | number; sub?: string; icon: React.ElementType; accent?: boolean;
  /** An unknown or incomplete figure: drawn as a warning so it never reads as a real zero. */
  warn?: boolean;
}) {
  return (
    <Card className={cn('shadow-sm', accent && 'border-primary/30 bg-primary/5', warn && 'border-amber-500/60 bg-amber-500/5')}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className="text-2xl font-bold mt-0.5 truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </div>
          <div className={cn('p-2 rounded-lg shrink-0', accent ? 'bg-primary/15' : 'bg-muted')}>
            <Icon className={cn('h-5 w-5', accent ? 'text-primary' : 'text-muted-foreground')} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CapBar({ cap }: { cap: SpendCapStatus }) {
  const color = cap.blocked ? 'bg-destructive' : cap.warning ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{cap.provider}</span>
        <span className="text-muted-foreground">${cap.spent_usd.toFixed(2)} / ${cap.cap_usd}</span>
        {(cap.warning || cap.blocked) && (
          <Badge variant={cap.blocked ? 'destructive' : 'outline'} className="text-[13px] px-1.5 py-0 ml-1">
            {cap.blocked ? 'BLOCKED' : 'WARNING'}
          </Badge>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(cap.pct, 100)}%` }} />
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [caps, setCaps] = useState<SpendCapStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    // Each query is independent — a failure in one MUST NOT crash the other.
    // One request each (this used to fire both twice to know when they settled).
    const statsP = getAdminOverviewStats()
      .then(s => setStats(s))
      .catch(() => setStatsError(true));
    const capsP = getSpendCapStatus()
      .then(c => setCaps(c))
      .catch(() => {});
    Promise.allSettled([statsP, capsP]).finally(() => setLoading(false));
  }, []);

  // Unknown reads as "—", never as 0 / $0.00 / 0.0%.
  const fmt    = (n: number | undefined | null) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const fmtUsd = (n: number | undefined | null) => formatUsd(n);
  const fmtPct = (n: number | undefined | null) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);
  const credits = (n: number | undefined | null, complete = true) =>
    formatCredits(n, (v) => t(complete ? 'admin_overview_credits_n' : 'admin_overview_credits_n_partial', { n: v }));
  const margin = marginState(stats?.gross_margin_pct);
  const cogsKnown = !!stats && stats.cogs_complete;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_overview_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_overview_subtitle')}</p>
      </div>

      {statsError && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {t('admin_overview_stats_error')}
        </div>
      )}

      {/* Activity */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('nav_activity')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : <>
            <StatCard title={t('admin_overview_users')}       value={fmt(stats?.total_users)}       icon={Users} />
            <StatCard title={t('admin_overview_properties')}  value={fmt(stats?.total_properties)}  icon={Building2} />
            <StatCard title={t('admin_overview_campaigns')}   value={fmt(stats?.total_campaigns)}   icon={Zap} />
            <StatCard title={t('admin_overview_raw_signals')} value={fmt(stats?.raw_signals)}       icon={Activity} />
            <StatCard title={t('admin_overview_qualified')}   value={fmt(stats?.qualified_signals)} icon={Activity} />
            <StatCard title={t('admin_overview_matches')}     value={fmt(stats?.total_matches)}     icon={Puzzle} />
          </>}
        </div>
      </section>

      {/* Finance */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('admin_overview_section_finance')}</h2>

        {/* The way in to the full cost and unit-economics system. The numbers
            below are a summary; everything behind this link is the detail --
            per-provider spend, per-execution COGS, the provider audit and the
            unpriced backlog. Reachable from here, not only by typing a URL. */}
        <Link
          to="/admin/finance"
          className="mb-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
        >
          <div className="rounded-lg bg-primary/15 p-2 shrink-0">
            <BadgeDollarSign className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('fin_title')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin_overview_finance_cta')}</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : <>
            <StatCard title={t('admin_overview_unlocks')}      value={fmt(stats?.total_unlocks)}     sub={t('admin_overview_of_matches', { pct: fmtPct(stats?.unlock_conversion_rate) })} icon={Unlock}    accent />
            {/* Unlock credits at 10 credits = $1; the credit figure carries its unit. */}
            <StatCard title={t('admin_overview_revenue')}      value={stats ? (stats.revenue_complete ? fmtUsd(stats.revenue_usd) : t('admin_overview_incomplete')) : '—'}
              sub={stats ? credits(stats.revenue_credits, stats.revenue_complete) : undefined} icon={DollarSign} accent />
            <StatCard title={t('admin_overview_cogs')}         value={stats ? (cogsKnown ? fmtUsd(stats.cogs_usd) : t('admin_overview_unknown')) : '—'}
              sub={stats && !cogsKnown
                ? (stats.cogs_unpriced_events > 0 ? t('admin_overview_cogs_unpriced', { n: stats.cogs_unpriced_events }) : t('admin_overview_cogs_incomplete'))
                : t('admin_overview_cogs_sub')}
              icon={BarChart2} warn={!!stats && !cogsKnown} />
            <StatCard title={t('admin_overview_gross_margin')} value={!stats ? '—' : margin.kind === 'known' ? margin.text : t('admin_overview_unknown')}
              sub={!stats ? undefined : margin.kind === 'known' ? t('admin_overview_profit', { usd: fmtUsd(stats.gross_profit_usd) }) : t('admin_overview_margin_unknown')}
              icon={Percent} accent warn={!!stats && margin.kind === 'unknown'} />
          </>}
        </div>
      </section>

      {/* Spend Caps */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('admin_overview_section_spend_caps')}</h2>
        <Card>
          <CardContent className="pt-5 space-y-4">
            {loading
              ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-7" />)
              : caps.length > 0
                ? caps.map(cap => <CapBar key={cap.provider} cap={cap} />)
                : <p className="text-sm text-muted-foreground">{t('admin_overview_no_spend_caps')}</p>}
          </CardContent>
        </Card>
      </section>

      {/* Credits */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('admin_nav_credits')}</h2>
        <div className="grid grid-cols-2 gap-3">
          {loading
            ? <><Skeleton className="h-24 rounded-xl col-span-1" /><Skeleton className="h-24 rounded-xl col-span-1" /></>
            : <>
              {/* Credits, not dollars: shown with their unit and the dollar value at 10 credits = $1. */}
              <StatCard title={t('admin_overview_credits_purchased')} value={stats ? credits(stats.credits_purchased, stats.credits_complete) : '—'}
                sub={stats ? fmtUsd(creditsToUsd(stats.credits_purchased)) : undefined} icon={TrendingUp} />
              <StatCard title={t('admin_overview_credits_consumed')}  value={stats ? credits(stats.credits_consumed, stats.credits_complete) : '—'}
                sub={stats ? fmtUsd(creditsToUsd(stats.credits_consumed)) : undefined} icon={DollarSign} />
            </>}
        </div>
      </section>
    </div>
  );
}
