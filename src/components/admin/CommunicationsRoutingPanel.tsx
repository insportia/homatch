// HOMATCH Admin — communications provider routing.
//
// §54. Which provider serves which ROLE, in what order, and what happens when
// one of them stops answering. A normal user never sees any of this (§106):
// they pick a voice and a language, and the route that serves it is resolved
// at call time.
//
// §139 governs every cell in this table: a credential is shown as a BOOLEAN.
// There is no masked value, no first-four-characters, no reveal. The names of
// the environment variables a route expects are shown, because knowing that
// META_WHATSAPP_APP_SECRET is the missing one is the whole point of the
// screen; the value never leaves the server.
//
// WHY THIS DEGRADES INSTEAD OF FAILING
//
// comm_provider_routes ships in a migration the owner has not applied, and
// comm-provider-status ships in a function that has not been deployed. Until
// both land this panel has nothing to read — so it says exactly that, names
// what is missing, and stays mounted. An admin screen that white-screens
// because a table is absent teaches people not to open it.

import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, ShieldOff, Loader2, KeyRound, AlertTriangle, CheckCircle2,
  XCircle, MinusCircle, Clock, Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  readProviderStatus, probeProviders, setProviderRouteFlag,
} from '@/services/communications';
import type { ProviderRouteRow, ProviderReportRow } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/** The roles §21 names, in the order an admin thinks about them. */
const ROLE_ORDER = ['ORCHESTRATOR', 'STT', 'TTS', 'LLM', 'TELEPHONY', 'MESSAGING', 'WHATSAPP_CALL'] as const;

const HEALTH_STYLE: Record<string, { cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  HEALTHY:        { cls: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400', icon: CheckCircle2 },
  DEGRADED:       { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400', icon: AlertTriangle },
  DOWN:           { cls: 'bg-destructive/10 text-destructive', icon: XCircle },
  DISABLED:       { cls: 'bg-muted text-muted-foreground', icon: ShieldOff },
  NOT_CONFIGURED: { cls: 'bg-muted text-muted-foreground', icon: MinusCircle },
};

export function CommunicationsRoutingPanel() {
  const { t, lang: language } = useLanguage();

  const [routes, setRoutes] = useState<ProviderRouteRow[]>([]);
  const [providers, setProviders] = useState<ProviderReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setUnavailable(null);
    const result = await readProviderStatus();
    if (!result.ok) {
      // Named, so an admin knows whether to apply a migration or deploy a
      // function rather than guessing.
      setUnavailable(result.reason);
      setRoutes([]);
      setProviders([]);
    } else {
      setRoutes(result.routes);
      setProviders(result.providers);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * §57's safe test. Read-only and free on every provider: Cartesia lists one
   * voice, Vapi lists one assistant, Meta reads its own number. Nothing here
   * synthesises audio, places a call or sends a message.
   */
  const onProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeProviders();
      if (!result.ok) { toast.error(t('admin_routing_probe_failed')); return; }
      toast.success(t('admin_routing_probe_done'));
      await load();
    } finally {
      setProbing(false);
    }
  }, [load, t]);

  const onToggle = useCallback(async (route: ProviderRouteRow, field: 'enabled' | 'kill_switch', value: boolean) => {
    setSaving(`${route.role}:${route.provider}`);
    try {
      const ok = await setProviderRouteFlag(route.role, route.provider, field, value);
      if (!ok) { toast.error(t('comm_save_failed')); return; }
      toast.success(t(field === 'kill_switch' && value ? 'admin_routing_killed' : 'admin_routing_saved'));
      await load();
    } finally {
      setSaving(null);
    }
  }, [load, t]);

  const byRole = ROLE_ORDER
    .map((role) => ({ role, rows: routes.filter((r) => r.role === role).sort((a, b) => a.priority - b.priority) }))
    .filter((g) => g.rows.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{t('admin_routing_title')}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admin_routing_subtitle')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void onProbe()} disabled={probing || Boolean(unavailable)}>
          {probing ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Activity className="me-1.5 h-3.5 w-3.5" />}
          {t('admin_routing_test')}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : unavailable ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t('admin_routing_unavailable')}
              <span className="mt-1 block font-mono text-[13px] text-muted-foreground">{unavailable}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Provider-level facts first: what answered, how fast, and which
                secrets exist. */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map((p) => {
                const style = HEALTH_STYLE[p.health] ?? HEALTH_STYLE.NOT_CONFIGURED;
                const Icon = style.icon;
                return (
                  <div key={p.provider} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.provider}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{p.roles.join(', ') || '·'}</p>
                      </div>
                      <Badge className={cn('shrink-0 gap-1 text-[13px]', style.cls)}>
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {t(`admin_routing_health_${p.health.toLowerCase()}` as TKey)}
                      </Badge>
                    </div>

                    <dl className="mt-2 space-y-0.5 text-[13px]">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t('admin_routing_latency')}</dt>
                        <dd className="tabular-nums">{p.latencyMs != null ? `${p.latencyMs} ms` : '·'}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t('admin_routing_last_test')}</dt>
                        <dd>{p.lastTestedAt ? new Date(p.lastTestedAt).toLocaleString(language) : '·'}</dd>
                      </div>
                      {p.errorCode ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{t('admin_routing_last_error')}</dt>
                          <dd className="font-mono text-destructive">{p.errorCode}</dd>
                        </div>
                      ) : null}
                    </dl>

                    {p.detail ? (
                      <p className="mt-1.5 text-[13px] text-amber-600 dark:text-amber-400">{p.detail}</p>
                    ) : null}

                    {/* §139: presence only. Never a value, never a prefix. */}
                    <ul className="mt-2 space-y-0.5 border-t pt-2">
                      {p.credentials.map((c) => (
                        <li key={c.name} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="flex min-w-0 items-center gap-1">
                            <KeyRound className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate font-mono">{c.name}</span>
                          </span>
                          <span className={cn('shrink-0', c.present ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
                            {t(c.present ? 'admin_routing_secret_set' : 'admin_routing_secret_missing')}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {/* Only what the provider actually reported (§33). */}
                    {p.facts && Object.keys(p.facts).length ? (
                      <dl className="mt-2 space-y-0.5 border-t pt-2 text-[13px]">
                        {Object.entries(p.facts)
                          .filter(([, v]) => v !== null && v !== undefined)
                          .map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2">
                              <dt className="truncate text-muted-foreground">{k}</dt>
                              <dd className="truncate font-mono">{String(v)}</dd>
                            </div>
                          ))}
                      </dl>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Then the routing itself: who runs first for each role. */}
            {byRole.map(({ role, rows }) => (
              <div key={role}>
                <h4 className="mb-1.5 text-xs font-semibold">
                  {t(`admin_routing_role_${role.toLowerCase()}` as TKey)}
                </h4>
                <div className="w-full overflow-x-auto rounded-lg border">
                  <div style={{ minWidth: 720 }}>
                    <table className="w-full text-xs">
                      <thead className="border-b bg-muted/40">
                        <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                          <th>{t('admin_routing_provider')}</th>
                          <th>{t('admin_routing_priority')}</th>
                          <th>{t('admin_routing_credentials')}</th>
                          <th>{t('admin_routing_countries')}</th>
                          <th>{t('admin_routing_last_success')}</th>
                          <th className="w-20">{t('admin_routing_enabled')}</th>
                          <th className="w-24">{t('admin_routing_kill')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const busy = saving === `${r.role}:${r.provider}`;
                          return (
                            <tr key={`${r.role}-${r.provider}`} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-1.5">
                              <td className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  {r.provider}
                                  {/* The fallback order, said in words rather
                                      than implied by row position. */}
                                  {i === 0 ? (
                                    <Badge variant="outline" className="text-[13px]">{t('admin_routing_primary')}</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[13px] text-muted-foreground">
                                      {t('admin_routing_fallback')}
                                    </Badge>
                                  )}
                                </span>
                              </td>
                              <td className="tabular-nums">{r.priority}</td>
                              <td>
                                <span className={cn(r.credentialsPresent ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
                                  {t(r.credentialsPresent ? 'admin_routing_secret_set' : 'admin_routing_secret_missing')}
                                </span>
                              </td>
                              <td className="text-muted-foreground">
                                {r.countryScope?.length ? r.countryScope.join(', ') : t('admin_routing_all_countries')}
                              </td>
                              <td className="text-muted-foreground">
                                {r.lastSuccessAt
                                  ? new Date(r.lastSuccessAt).toLocaleDateString(language)
                                  : <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" aria-hidden="true" />·</span>}
                              </td>
                              <td>
                                <Switch
                                  checked={r.enabled}
                                  disabled={busy}
                                  onCheckedChange={(v) => void onToggle(r, 'enabled', v)}
                                  aria-label={`${r.provider} ${t('admin_routing_enabled')}`}
                                />
                              </td>
                              <td>
                                {/* Separate from `enabled` on purpose: turning a
                                    provider off in an incident must not erase
                                    the fact that it is normally on. */}
                                <Switch
                                  checked={r.killSwitch}
                                  disabled={busy}
                                  onCheckedChange={(v) => void onToggle(r, 'kill_switch', v)}
                                  aria-label={`${r.provider} ${t('admin_routing_kill')}`}
                                  className="data-[state=checked]:bg-destructive"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}

            <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {t('admin_routing_note')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
