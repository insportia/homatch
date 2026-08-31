import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, MinusCircle, Power, ShieldOff, Landmark, Lock } from 'lucide-react';
import { getProviderHealth, getProviderCostBreakdown, getAdminSettings, updateAdminSetting, getResearchProviderTreasury, updateResearchProvider } from '@/services/api';
import type { ProviderHealth, AdminProviderCostRow, ResearchProviderTreasuryRow } from '@/types/types';
import { format } from 'date-fns';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  NOT_CONFIGURED:        { label: 'Not Configured',           color: 'bg-muted text-muted-foreground',              icon: MinusCircle },
  MOCK:                  { label: 'Mock (Dev Only)',           color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400', icon: AlertTriangle },
  CONFIGURED_UNVERIFIED: { label: 'Configured — Not Tested',  color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400', icon: Clock },
  REAL_TEST_PASSED:      { label: 'Real — Test Passed',       color: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400', icon: CheckCircle2 },
  ERROR:                 { label: 'Error',                     color: 'bg-destructive/10 text-destructive',           icon: XCircle },
};

export default function AdminProvidersPage() {
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [costs, setCosts] = useState<AdminProviderCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  // disabled_providers is a JSON array of provider names stored in admin_settings
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [globalKillSwitch, setGlobalKillSwitch] = useState(false);
  const [savingKill, setSavingKill] = useState(false);
  const [treasury, setTreasury] = useState<ResearchProviderTreasuryRow[]>([]);
  const [treasuryLoading, setTreasuryLoading] = useState(true);
  const [togglingTreasury, setTogglingTreasury] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getProviderHealth(), getProviderCostBreakdown(), getAdminSettings()])
      .then(([h, c, settings]) => {
        setHealth(h);
        setCosts(c);
        // Parse kill switch and disabled providers from admin_settings
        const killSetting = settings.find(s => s.key === 'global_kill_switch');
        if (killSetting) {
          const v = killSetting.value;
          setGlobalKillSwitch(v === true || v === 'true' || v === 1);
        }
        const disabledSetting = settings.find(s => s.key === 'disabled_providers');
        if (disabledSetting) {
          try {
            const parsed = typeof disabledSetting.value === 'string'
              ? JSON.parse(disabledSetting.value) : disabledSetting.value;
            setDisabledProviders(Array.isArray(parsed) ? parsed : []);
          } catch { setDisabledProviders([]); }
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    setTreasuryLoading(true);
    getResearchProviderTreasury().then(setTreasury).finally(() => setTreasuryLoading(false));
  }, []);

  const toggleTreasuryEnabled = async (providerCode: string, enabled: boolean) => {
    setTogglingTreasury(providerCode);
    try {
      await updateResearchProvider(providerCode, { enabled, kill_switch: !enabled });
      setTreasury(prev => prev.map(p => (p.provider_code === providerCode ? { ...p, enabled, kill_switch: !enabled } : p)));
    } catch {
      toast.error('Failed to update provider');
    } finally {
      setTogglingTreasury(null);
    }
  };

  const runProviderTest = async (provider: string) => {
    setTesting(provider);
    try {
      const { data, error } = await supabase.functions.invoke('provider-health-check', {
        body: { provider },
      });
      if (error) throw error;
      toast.success(`${provider}: ${data?.status ?? 'tested'}`);
      load();
    } catch (e: any) {
      toast.error(`Test failed: ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const toggleProvider = async (provider: string, currentlyDisabled: boolean) => {
    setToggling(provider);
    try {
      const next = currentlyDisabled
        ? disabledProviders.filter(p => p !== provider)
        : [...disabledProviders, provider];
      await updateAdminSetting('disabled_providers', JSON.stringify(next));
      setDisabledProviders(next);
      toast.success(`${provider} ${currentlyDisabled ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      toast.error(`Failed to toggle provider: ${e.message}`);
    } finally {
      setToggling(null);
    }
  };

  const toggleGlobalKillSwitch = async (value: boolean) => {
    setSavingKill(true);
    try {
      await updateAdminSetting('global_kill_switch', value);
      setGlobalKillSwitch(value);
      toast[value ? 'warning' : 'success'](
        value ? 'GLOBAL KILL SWITCH ACTIVATED — all paid providers blocked' : 'Kill switch deactivated — providers restored'
      );
    } catch (e: any) {
      toast.error(`Failed to update kill switch: ${e.message}`);
    } finally {
      setSavingKill(false);
    }
  };

  const costByProvider: Record<string, AdminProviderCostRow> = {};
  for (const c of costs) costByProvider[c.provider] = c;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Global kill switch banner */}
      <div className={cn(
        'flex items-center justify-between gap-4 p-4 rounded-xl border',
        globalKillSwitch
          ? 'bg-destructive/10 border-destructive/40'
          : 'bg-card border-border',
      )}>
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', globalKillSwitch ? 'bg-destructive/20' : 'bg-secondary')}>
            <ShieldOff className={cn('h-5 w-5', globalKillSwitch ? 'text-destructive' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className={cn('text-sm font-semibold', globalKillSwitch ? 'text-destructive' : 'text-foreground')}>
              {globalKillSwitch ? 'GLOBAL KILL SWITCH ACTIVE — All Paid Providers Blocked' : 'Global Kill Switch'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Blocks ALL paid provider calls across the platform. Use in emergencies to prevent runaway spend.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{globalKillSwitch ? 'ON' : 'OFF'}</span>
          <Switch
            checked={globalKillSwitch}
            onCheckedChange={toggleGlobalKillSwitch}
            disabled={savingKill}
            className={globalKillSwitch ? 'data-[state=checked]:bg-destructive' : ''}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Provider Health</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Status, latency, costs and enable/disable controls per provider.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />) :
          health.map(h => {
            const cfg = STATUS_CONFIG[h.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.NOT_CONFIGURED;
            const Icon = cfg.icon;
            const cost = costByProvider[h.provider];
            const successRate = h.success_count + h.failure_count > 0
              ? Math.round((h.success_count / (h.success_count + h.failure_count)) * 100) : null;
            const isDisabled = disabledProviders.includes(h.provider);

            return (
              <Card key={h.provider} className={cn('shadow-sm', isDisabled && 'opacity-60 border-dashed')}>
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-semibold">{h.provider}</CardTitle>
                      {isDisabled && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 gap-0.5">
                          <Power className="h-2.5 w-2.5" /> Disabled
                        </Badge>
                      )}
                    </div>
                    <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                      <Icon className="h-3 w-3 shrink-0" />
                      <span>{cfg.label}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Latency</p>
                      <p className="font-medium">{h.latency_ms != null ? `${h.latency_ms}ms` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Success</p>
                      <p className="font-medium">{successRate != null ? `${successRate}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Cost (MTD)</p>
                      <p className="font-medium">{cost ? `$${cost.total_cost_usd.toFixed(2)}` : '$0.00'}</p>
                    </div>
                  </div>
                  {h.last_error && (
                    <p className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={h.last_error}>
                      {h.last_error}
                    </p>
                  )}
                  {h.last_tested_at && (
                    <p className="text-[10px] text-muted-foreground">
                      Last tested: {format(new Date(h.last_tested_at), 'MMM d, HH:mm')}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs gap-1.5"
                      disabled={testing === h.provider}
                      onClick={() => runProviderTest(h.provider)}
                    >
                      {testing === h.provider ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'flex-1 text-xs gap-1.5',
                        isDisabled
                          ? 'border-green-500/40 text-green-500 hover:bg-green-500/10'
                          : 'border-destructive/40 text-destructive hover:bg-destructive/10',
                      )}
                      disabled={toggling === h.provider || globalKillSwitch}
                      onClick={() => toggleProvider(h.provider, isDisabled)}
                    >
                      <Power className="h-3 w-3" />
                      {toggling === h.provider ? '…' : isDisabled ? 'Enable' : 'Disable'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* ── Research provider treasury (Master Prompt §21/§24) ── */}
      <div className="flex items-center gap-2 pt-2">
        <Landmark className="h-4 w-4 text-primary" />
        <h2 className="text-base font-bold">Research Provider Treasury</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">Internal COGS/budget tracking for research providers (TGStat, DataForSEO, Bright Data, Apify). Never shown to customers.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {treasuryLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />) :
          treasury.map(p => (
            <Card key={p.provider_code} className={cn('shadow-sm', !p.enabled && 'opacity-70 border-dashed')}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{p.display_name}</p>
                  <Badge variant="outline" className={cn('text-[10px] px-1.5', p.health_status === 'ACTIVE' ? 'border-green-500/40 text-green-500' : p.health_status === 'LOCKED' ? 'border-destructive/40 text-destructive' : '')}>
                    {p.health_status === 'LOCKED' && <Lock className="h-2.5 w-2.5 me-1 inline" />}{p.health_status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><p className="text-muted-foreground">Billing</p><p className="font-medium">{p.billing_model}</p></div>
                  <div><p className="text-muted-foreground">Reference cost</p><p className="font-medium">{p.reference_cost_usd_cents != null ? `$${(p.reference_cost_usd_cents / 100).toFixed(2)}` : '—'}</p></div>
                  <div><p className="text-muted-foreground">Included usage</p><p className="font-medium">{p.included_usage?.toLocaleString() ?? '—'}</p></div>
                  <div><p className="text-muted-foreground">Current usage</p><p className="font-medium">{p.current_usage.toLocaleString()}</p></div>
                </div>
                {p.notes && <p className="text-[11px] text-muted-foreground/80 leading-snug">{p.notes}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={p.enabled} disabled={togglingTreasury === p.provider_code} onCheckedChange={v => toggleTreasuryEnabled(p.provider_code, v)} />
                  <span className="text-xs text-muted-foreground">{p.enabled ? 'Enabled' : 'Disabled / kill switch on'}</span>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}

const STATUS_CONFIG_UNUSED = null; void STATUS_CONFIG_UNUSED;
