import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users, Building2, Zap, Activity, Puzzle, Unlock,
  TrendingUp, DollarSign, BarChart2, Percent,
} from 'lucide-react';
import { getAdminOverviewStats, getSpendCapStatus } from '@/services/api';
import type { AdminOverviewStats, SpendCapStatus } from '@/types/types';
import { cn } from '@/lib/utils';

function StatCard({ title, value, sub, icon: Icon, accent = false }: {
  title: string; value: string | number; sub?: string; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <Card className={cn('shadow-sm', accent && 'border-primary/30 bg-primary/5')}>
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
          <Badge variant={cap.blocked ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0 ml-1">
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
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [caps, setCaps] = useState<SpendCapStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    // Each query is independent — a failure in one MUST NOT crash the other
    getAdminOverviewStats()
      .then(s => setStats(s))
      .catch(() => setStatsError(true));
    getSpendCapStatus()
      .then(c => setCaps(c))
      .catch(() => {});
    // Mark loading done after both settle
    Promise.allSettled([getAdminOverviewStats(), getSpendCapStatus()])
      .finally(() => setLoading(false));
  }, []);

  const fmt    = (n: number | undefined | null) => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtUsd = (n: number | undefined | null) => `$${(n ?? 0).toFixed(2)}`;
  const fmtPct = (n: number | undefined | null) => `${(n ?? 0).toFixed(1)}%`;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">Admin Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Platform-wide metrics for the current period</p>
      </div>

      {statsError && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Some statistics could not be loaded. Check RLS policies or database connectivity.
        </div>
      )}

      {/* Activity */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : <>
            <StatCard title="Users"       value={fmt(stats?.total_users)}       icon={Users} />
            <StatCard title="Properties"  value={fmt(stats?.total_properties)}  icon={Building2} />
            <StatCard title="Campaigns"   value={fmt(stats?.total_campaigns)}   icon={Zap} />
            <StatCard title="Raw Signals" value={fmt(stats?.raw_signals)}       icon={Activity} />
            <StatCard title="Qualified"   value={fmt(stats?.qualified_signals)} icon={Activity} />
            <StatCard title="Matches"     value={fmt(stats?.total_matches)}     icon={Puzzle} />
          </>}
        </div>
      </section>

      {/* Finance */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Finance</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : <>
            <StatCard title="Unlocks"      value={fmt(stats?.total_unlocks)}     sub={`${fmtPct(stats?.unlock_conversion_rate)} of matches`} icon={Unlock}    accent />
            <StatCard title="Revenue"      value={fmtUsd(stats?.revenue_usd)}    sub={`${fmtUsd(stats?.credits_consumed)} consumed`}          icon={DollarSign} accent />
            <StatCard title="COGS"         value={fmtUsd(stats?.cogs_usd)}       sub="Provider costs"                                          icon={BarChart2} />
            <StatCard title="Gross Margin" value={fmtPct(stats?.gross_margin_pct)} sub={`${fmtUsd(stats?.gross_profit_usd)} profit`}           icon={Percent}   accent />
          </>}
        </div>
      </section>

      {/* Spend Caps */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Monthly Spend Caps</h2>
        <Card>
          <CardContent className="pt-5 space-y-4">
            {loading
              ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-7" />)
              : caps.length > 0
                ? caps.map(cap => <CapBar key={cap.provider} cap={cap} />)
                : <p className="text-sm text-muted-foreground">No spend cap data available.</p>}
          </CardContent>
        </Card>
      </section>

      {/* Credits */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Credits</h2>
        <div className="grid grid-cols-2 gap-3">
          {loading
            ? <><Skeleton className="h-24 rounded-xl col-span-1" /><Skeleton className="h-24 rounded-xl col-span-1" /></>
            : <>
              <StatCard title="Credits Purchased" value={fmtUsd(stats?.credits_purchased)} icon={TrendingUp} />
              <StatCard title="Credits Consumed"  value={fmtUsd(stats?.credits_consumed)}  icon={DollarSign} />
            </>}
        </div>
      </section>
    </div>
  );
}
