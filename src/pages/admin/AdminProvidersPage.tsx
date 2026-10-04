import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, MinusCircle, Power, ShieldOff, Landmark, Lock, Archive } from 'lucide-react';
import { getProviderHealth, getProviderCostBreakdown, getAdminSettings, updateAdminSetting, getResearchProviderTreasury, updateResearchProvider } from '@/services/api';
import type { ProviderHealth, AdminProviderCostRow, ResearchProviderTreasuryRow } from '@/types/types';
import { format } from 'date-fns';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { CommunicationsRoutingPanel } from '@/components/admin/CommunicationsRoutingPanel';

const STATUS_CONFIG = {
  NOT_CONFIGURED:        { labelKey: 'admin_providers_not_configured', color: 'bg-muted text-muted-foreground',              icon: MinusCircle },
  MOCK:                  { labelKey: 'admin_providers_mock',           color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400', icon: AlertTriangle },
  CONFIGURED_UNVERIFIED: { labelKey: 'admin_providers_unverified',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400', icon: Clock },
  REAL_TEST_PASSED:      { labelKey: 'admin_providers_passed',         color: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400', icon: CheckCircle2 },
  ERROR:                 { labelKey: 'admin_providers_error',          color: 'bg-destructive/10 text-destructive',           icon: XCircle },
};

/*
 * APIFY IS LIVE AGAIN (owner, 2026-10-04), for Find Buyers / Find Tenants
 * memo23 Actors only: its card has Test (a free account check, never a run)
 * and the Enable/Disable switch, which is server-authoritative — APIFY in
 * provider_disabled_list stops every memo23 reservation and run. Individual
 * Actors stay governed by their own registry lifecycle (Find Buyers → Actors).
 *
 * RETIRED, NOT DISABLED.
 *
 * DataForSEO is retired from the Homatch architecture. A disabled
 * provider is one an admin can enable again; a retired one has no code path
 * left to enable (supabase/functions/_shared/retiredProviders.ts), so this
 * screen must not offer a button that looks like it would. Their cards keep
 * their history -- cost to date, last error, success rate -- and lose the Test
 * and Enable controls. Every write to provider_disabled_list keeps the retired
 * name in it, so no preset and no toggle can take it off the list.
 */
const RETIRED_PROVIDERS = ['DATAFORSEO'];
const isRetired = (provider: string) => RETIRED_PROVIDERS.includes(provider.toUpperCase());
const withRetired = (list: readonly string[]) => Array.from(new Set([...list, ...RETIRED_PROVIDERS]));

export default function AdminProvidersPage() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [costs, setCosts] = useState<AdminProviderCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  // provider_disabled_list is a JSON array of provider names stored in admin_settings
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [globalKillSwitch, setGlobalKillSwitch] = useState(false);
  const [savingKill, setSavingKill] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<ResearchProviderTreasuryRow[]>([]);
  const [treasuryLoading, setTreasuryLoading] = useState(true);
  const [togglingTreasury, setTogglingTreasury] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getProviderHealth(), getProviderCostBreakdown(), getAdminSettings()])
      .then(([h, c, settings]) => {
        setHealth(h);
        setCosts(c);
        // Parse kill switch and disabled providers from admin_settings. These
        // are the real keys the matching pipeline (match-campaign,
        // discovery-queue-worker) actually reads — this page used to read
        // 'global_kill_switch'/'disabled_providers', keys nothing ever wrote
        // or checked, so the switch shown here was always OFF regardless of
        // the real (correctly locked) provider_kill_switch value, and toggling
        // it had zero effect on anything.
        const killSetting = settings.find(s => s.key === 'provider_kill_switch');
        if (killSetting) {
          const v = killSetting.value;
          setGlobalKillSwitch(v === true || v === 'true' || v === 1);
        }
        const disabledSetting = settings.find(s => s.key === 'provider_disabled_list');
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
      await updateAdminSetting('provider_disabled_list', withRetired(next));
      setDisabledProviders(withRetired(next));
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
      await updateAdminSetting('provider_kill_switch', value);
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

  // Named bundles over the real settings match-campaign / discovery-queue-worker
  // actually read (external_discovery_enabled, provider_kill_switch,
  // provider_disabled_list, external_discovery_strong_score,
  // external_discovery_min_strong_matches) — not a separate, decorative
  // concept. There used to be a third, "web only", which meant disabling APIFY
  // and keeping DATAFORSEO. DataForSEO is retired, so it would have been the same
  // as "balanced" under a name that promised something different; it is gone.
  // Apify (live again for memo23) is never changed by a preset.
  const PRESETS = {
    locked: {
      labelKey: 'admin_providers_preset_locked',
      settings: { external_discovery_enabled: false, provider_kill_switch: true, provider_disabled_list: [] as string[], external_discovery_strong_score: 70, external_discovery_min_strong_matches: 3 },
    },
    balanced: {
      labelKey: 'admin_providers_preset_balanced',
      settings: { external_discovery_enabled: true, provider_kill_switch: false, provider_disabled_list: [] as string[], external_discovery_strong_score: 70, external_discovery_min_strong_matches: 3 },
    },
  } as const;

  const applyPreset = async (presetKey: keyof typeof PRESETS) => {
    setApplyingPreset(presetKey);
    try {
      const preset = PRESETS[presetKey];
      /* Apify is switched only by its own card: a preset keeps its current state. */
      const nextDisabled = withRetired([...preset.settings.provider_disabled_list, ...(disabledProviders.includes('APIFY') ? ['APIFY'] : [])]);
      await Promise.all([
        updateAdminSetting('external_discovery_enabled', preset.settings.external_discovery_enabled),
        updateAdminSetting('provider_kill_switch', preset.settings.provider_kill_switch),
        updateAdminSetting('provider_disabled_list', withRetired(nextDisabled)),
        updateAdminSetting('external_discovery_strong_score', preset.settings.external_discovery_strong_score),
        updateAdminSetting('external_discovery_min_strong_matches', preset.settings.external_discovery_min_strong_matches),
      ]);
      setGlobalKillSwitch(preset.settings.provider_kill_switch);
      setDisabledProviders(nextDisabled);
      toast.success(t('admin_providers_preset_applied', { name: t(preset.labelKey) }));
    } catch (e: any) {
      toast.error(`Failed to apply preset: ${e.message}`);
    } finally {
      setApplyingPreset(null);
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
              {globalKillSwitch ? t('admin_providers_kill_switch_active') : t('admin_providers_kill_switch_label')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('admin_providers_kill_switch_desc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{globalKillSwitch ? t('admin_providers_on') : t('admin_providers_off')}</span>
          <Switch
            checked={globalKillSwitch}
            onCheckedChange={toggleGlobalKillSwitch}
            disabled={savingKill}
            className={globalKillSwitch ? 'data-[state=checked]:bg-destructive' : ''}
            /* The heading beside it is a <p>, not a <label>, so nothing tied
               the two together: a screen reader announced "switch, off" with
               no clue what it switches — and this one stops every provider on
               the platform. */
            aria-label={t('admin_providers_kill_switch_label')}
          />
        </div>
      </div>

      {/* External discovery presets — one-click bundles over the same real settings above */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">{t('admin_providers_presets_title')}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{t('admin_providers_presets_desc')}</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(key => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={applyingPreset !== null}
              onClick={() => applyPreset(key)}
            >
              {applyingPreset === key
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : key === 'locked' ? <Lock className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
              {t(PRESETS[key].labelKey)}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('admin_providers_title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('admin_providers_subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('admin_refresh')}
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
            const retired = isRetired(h.provider);

            return (
              <Card key={h.provider} className={cn('shadow-sm', (isDisabled || retired) && 'opacity-60 border-dashed')}>
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-semibold">{h.provider}</CardTitle>
                      {isDisabled && !retired && (
                        <Badge variant="destructive" className="text-[13px] px-1.5 gap-0.5">
                          <Power className="h-2.5 w-2.5" /> {t('admin_markets_disabled')}
                        </Badge>
                      )}
                    </div>
                    {retired ? (
                      <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                        <Archive className="h-3 w-3 shrink-0" />
                        <span>{t('admin_providers_retired')}</span>
                      </div>
                    ) : (
                      <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                        <Icon className="h-3 w-3 shrink-0" />
                        <span>{t(cfg.labelKey)}</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pb-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">{t('admin_providers_latency')}</p>
                      <p className="font-medium">{h.latency_ms != null ? `${h.latency_ms}ms` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('admin_providers_success')}</p>
                      <p className="font-medium">{successRate != null ? `${successRate}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('admin_providers_cost_mtd')}</p>
                      <p className="font-medium">{cost ? `$${cost.total_cost_usd.toFixed(2)}` : '$0.00'}</p>
                    </div>
                  </div>
                  {h.last_error && (
                    <p className="text-[14px] text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={h.last_error}>
                      {h.last_error}
                    </p>
                  )}
                  {h.last_tested_at && (
                    <p className="text-[13px] text-muted-foreground">
                      {t('admin_providers_last_tested')}: {format(new Date(h.last_tested_at), 'MMM d, HH:mm')}
                    </p>
                  )}
                  {h.provider.toUpperCase() === 'APIFY' && (
                    <p className="text-xs text-muted-foreground break-words" data-testid="apify-scope">{t('admin_providers_apify_scope')}</p>
                  )}
                  {retired ? (
                    <p className="text-xs text-muted-foreground pt-1 break-words">{t('admin_providers_retired_desc')}</p>
                  ) : (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs gap-1.5"
                      disabled={testing === h.provider}
                      onClick={() => runProviderTest(h.provider)}
                    >
                      {testing === h.provider ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      {t('admin_providers_test_btn')}
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
                      /* The legacy kill switch governs generic external discovery; Apify
                         (memo23 only) has its own server-authoritative switch. */
                      disabled={toggling === h.provider || (globalKillSwitch && h.provider.toUpperCase() !== 'APIFY')}
                      onClick={() => toggleProvider(h.provider, isDisabled)}
                    >
                      <Power className="h-3 w-3" />
                      {toggling === h.provider ? '…' : isDisabled ? t('admin_markets_toggle_enable') : t('admin_markets_toggle_disable')}
                    </Button>
                  </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* ── Research provider treasury (Master Prompt §21/§24) ── */}
      <div className="flex items-center gap-2 pt-2">
        <Landmark className="h-4 w-4 text-primary" />
        <h2 className="text-base font-bold">{t('admin_providers_treasury_title')}</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">{t('admin_providers_treasury_desc')}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {treasuryLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />) :
          treasury.map(p => {
            /* research_providers still holds a row for retired DATAFORSEO --
               production had it enabled=true / ACTIVE on 2026-09-27, a flag
               nothing executes on. Shown as retired, with no switch. APIFY's
               row shows its usage; its only switch is the provider card. */
            const retired = isRetired(p.provider_code);
            return (
            <Card key={p.provider_code} className={cn('shadow-sm', (!p.enabled || retired) && 'opacity-70 border-dashed')}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{p.display_name}</p>
                  {retired ? (
                    <Badge variant="outline" className="text-[13px] px-1.5 gap-0.5">
                      <Archive className="h-2.5 w-2.5 me-1 inline" />{t('admin_providers_retired')}
                    </Badge>
                  ) : (
                  <Badge variant="outline" className={cn('text-[13px] px-1.5', p.health_status === 'ACTIVE' ? 'border-green-500/40 text-green-500' : p.health_status === 'LOCKED' ? 'border-destructive/40 text-destructive' : '')}>
                    {p.health_status === 'LOCKED' && <Lock className="h-2.5 w-2.5 me-1 inline" />}{p.health_status}
                  </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><p className="text-muted-foreground">{t('admin_providers_billing')}</p><p className="font-medium">{p.billing_model}</p></div>
                  <div><p className="text-muted-foreground">{t('admin_providers_reference_cost')}</p><p className="font-medium">{p.reference_cost_usd_cents != null ? `$${(p.reference_cost_usd_cents / 100).toFixed(2)}` : '—'}</p></div>
                  <div><p className="text-muted-foreground">{t('admin_providers_included_usage')}</p><p className="font-medium">{p.included_usage?.toLocaleString() ?? '—'}</p></div>
                  <div><p className="text-muted-foreground">{t('admin_providers_current_usage')}</p><p className="font-medium">{p.current_usage.toLocaleString()}</p></div>
                </div>
                {p.notes && <p className="text-[14px] text-muted-foreground/80 leading-snug">{p.notes}</p>}
                {retired ? (
                  <p className="text-xs text-muted-foreground pt-1 break-words">{t('admin_providers_retired_desc')}</p>
                ) : p.provider_code.toUpperCase() === 'APIFY' ? (
                  /* One switch for Apify: the provider card above (provider_disabled_list). */
                  <p className="text-xs text-muted-foreground pt-1 break-words">{t('admin_providers_apify_treasury_note')}</p>
                ) : (
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={p.enabled}
                    disabled={togglingTreasury === p.provider_code}
                    onCheckedChange={v => toggleTreasuryEnabled(p.provider_code, v)}
                    aria-label={`${p.provider_code} — ${t('admin_markets_enabled')}`}
                  />
                  <span className="text-xs text-muted-foreground">{p.enabled ? t('admin_markets_enabled') : t('admin_providers_disabled_kill_switch')}</span>
                </div>
                )}
              </CardContent>
            </Card>
            );
          })}
      </div>

      {/* Communications routing (§54). A section here rather than a new Admin
          nav entry: it is provider configuration, and this is the provider
          screen (§105). */}
      <CommunicationsRoutingPanel />
    </div>
  );
}

const STATUS_CONFIG_UNUSED = null; void STATUS_CONFIG_UNUSED;
