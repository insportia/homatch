import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Database, HardDrive, Globe, Cpu, ShieldAlert, Zap,
} from 'lucide-react';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface ProviderSnapshot {
  status: string;
  last_success_at: string | null;
  last_error: string | null;
  success_rate: number | null;
  latency_ms: number | null;
}

interface SpendByProvider {
  spent: number;
  cap: number;
  pct: number;
  blocked: boolean;
}

interface HealthResult {
  checked_at: string;
  production_status: 'HEALTHY' | 'DEGRADED';
  db_reachable: boolean;
  storage_reachable: boolean;
  supabase_reachable: boolean;
  mock_mode_active: boolean;
  provider_statuses: Record<string, ProviderSnapshot>;
  last_match_run_at: string | null;
  last_match_run_ok: boolean;
  last_failed_run_at: string | null;
  spend_summary: {
    global_spent_usd: number;
    global_cap_usd: number;
    global_pct: number;
    global_blocked: boolean;
    by_provider: Record<string, SpendByProvider>;
  };
}

const PROVIDER_COLORS: Record<string, string> = {
  NOT_CONFIGURED: 'bg-muted text-muted-foreground',
  MOCK: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  CONFIGURED_UNVERIFIED: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  REAL_TEST_PASSED: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  ERROR: 'bg-destructive/10 text-destructive',
};

function StatusDot({ ok, degraded }: { ok: boolean; degraded?: boolean }) {
  if (ok) return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (degraded) return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
}

function SpendBar({ label, spent, cap, pct, blocked }: { label: string; spent: number; cap: number; pct: number; blocked: boolean }) {
  const color = blocked ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium capitalize">{label}</span>
        <span className="text-muted-foreground">${spent.toFixed(2)} / ${cap}</span>
        {blocked && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">BLOCKED</Badge>}
        {!blocked && pct >= 80 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1 border-amber-500 text-amber-500">WARNING</Badge>}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export default function AdminHealthPage() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('system-health', {});
      if (fnErr) throw fnErr;
      setHealth(data as HealthResult);
    } catch (e: any) {
      setError(e.message ?? 'Health check failed');
      toast.error('Health check failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []);

  const fmtDate = (d: string | null) => d ? format(new Date(d), 'MMM d, HH:mm') : '—';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('admin_nav_health')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('admin_health_subtitle')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          {loading ? t('admin_health_checking') : t('admin_health_run_check')}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Overall status */}
      {loading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : health && (
        <Card className={cn(
          'border-2',
          health.production_status === 'HEALTHY' ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5',
        )}>
          <CardContent className="pt-4 pb-4 flex items-center gap-4">
            {health.production_status === 'HEALTHY'
              ? <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
              : <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0" />}
            <div>
              <p className="text-base font-bold">
                {health.production_status === 'HEALTHY' ? t('admin_health_all_operational') : t('admin_health_degraded')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('admin_health_checked_at')} {fmtDate(health.checked_at)}
                {health.mock_mode_active && <span className="ml-3 font-semibold text-destructive">{t('admin_health_mock_mode_on')}</span>}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Infrastructure */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" /> {t('admin_health_infrastructure')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <Skeleton className="h-24" /> : health ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span>{t('admin_health_db_label')}</span>
                  </div>
                  <StatusDot ok={health.db_reachable} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span>{t('admin_health_storage_label')}</span>
                  </div>
                  <StatusDot ok={health.storage_reachable} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <span>{t('admin_health_api_label')}</span>
                  </div>
                  <StatusDot ok={health.supabase_reachable} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                    <span>{t('admin_health_mock_mode_label')}</span>
                  </div>
                  <Badge variant={health.mock_mode_active ? 'destructive' : 'outline'} className="text-[10px] px-1.5">
                    {health.mock_mode_active ? t('admin_health_mock_on_danger') : t('admin_health_mock_off_ok')}
                  </Badge>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('admin_health_run_to_see_status')}</p>
            )}
          </CardContent>
        </Card>

        {/* Matching engine */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> {t('admin_health_matching_engine')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <Skeleton className="h-24" /> : health ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('admin_health_last_success_run')}</span>
                  <span className={cn('font-mono text-xs', health.last_match_run_ok ? 'text-green-500' : 'text-muted-foreground')}>
                    {fmtDate(health.last_match_run_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('admin_health_last_failed_run')}</span>
                  <span className={cn('font-mono text-xs', health.last_failed_run_at ? 'text-destructive' : 'text-muted-foreground')}>
                    {fmtDate(health.last_failed_run_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('admin_health_engine_status')}</span>
                  <StatusDot ok={health.last_match_run_ok} degraded={!health.last_match_run_ok && !health.last_failed_run_at} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('admin_health_run_to_see_status')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Provider health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" /> {t('admin_health_provider_status')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : health && Object.keys(health.provider_statuses).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(health.provider_statuses).map(([name, p]) => (
                <div key={name} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium w-28 shrink-0">{name}</span>
                    <Badge className={cn('text-[10px] px-1.5 py-0', PROVIDER_COLORS[p.status] ?? '')}>
                      {p.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    {p.success_rate !== null && (
                      <span>{t('admin_health_success_rate', { rate: p.success_rate })}</span>
                    )}
                    {p.latency_ms !== null && (
                      <span>{p.latency_ms}ms</span>
                    )}
                    <span>{p.last_success_at ? fmtDate(p.last_success_at) : t('as_never')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('admin_health_run_to_see_provider_status')}</p>
          )}
        </CardContent>
      </Card>

      {/* Spend caps */}
      {health?.spend_summary && (
        <Card className={cn(health.spend_summary.global_blocked && 'border-destructive/40')}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" /> {t('admin_health_spend_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SpendBar
              label="Global ceiling"
              spent={health.spend_summary.global_spent_usd}
              cap={health.spend_summary.global_cap_usd}
              pct={health.spend_summary.global_pct}
              blocked={health.spend_summary.global_blocked}
            />
            {Object.entries(health.spend_summary.by_provider).map(([k, v]) => (
              <SpendBar key={k} label={k} spent={v.spent} cap={v.cap} pct={v.pct} blocked={v.blocked} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
