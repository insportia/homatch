import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Clock, KeyRound, Loader2, Plug } from 'lucide-react';
import { getProviderConnections, usd, num, relativeTime } from '@/services/finance';
import type { AccessLevel, AccessStatus, ProviderConnection } from '@/types/finance';
import { Pill, Empty, SectionTitle } from './FinanceKit';

/**
 * PROVIDER CONNECTIONS — the access and billing audit, as a screen.
 *
 * For each provider: what Homatch uses it for, whether it is connected,
 * whether usage is measurable, whether billing is readable, whether the cost
 * is provider-reported or calculated here, whether the data is current, and
 * whether more permission is genuinely required.
 *
 * What this screen shows about a credential is its ENVIRONMENT VARIABLE NAME
 * and whether it is set. Never a key, a token, a secret or any fragment of
 * one — none of those values are exposed by the RPC behind this page either.
 */

const STATUS_TONE: Record<AccessStatus, string> = {
  CONNECTED_BILLING_ACCESS: 'good',
  CONNECTED_USAGE_ACCESS: 'good',
  CONNECTED_LOCAL_COST_CALCULATION: 'gold',
  CONNECTED_BILLING_PERMISSION_MISSING: 'warn',
  CONNECTED_SERVICE_ONLY: 'muted',
  NOT_CONFIGURED: 'muted',
};

const LEVEL_TONE: Record<AccessLevel, string> = {
  FULL: 'good',
  PARTIAL: 'warn',
  CALCULATED: 'gold',
  PERMISSION_MISSING: 'warn',
  NONE: 'muted',
  UNKNOWN: 'muted',
};

function AccessChip({ labelKey, level }: { labelKey: string; level: AccessLevel }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1">
      <span className="text-[12px] text-muted-foreground">{t(labelKey)}</span>
      <Pill tone={LEVEL_TONE[level] ?? 'muted'}>{t(`fin_level_${level.toLowerCase()}`)}</Pill>
    </div>
  );
}

export function FinanceConnectionsTab() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    getProviderConnections()
      .then(r => { if (alive) setRows(r ?? []); })
      .catch(() => { /* shell surfaces it */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const connected = rows.filter(r => r.access_status !== 'NOT_CONFIGURED');
  const notConfigured = rows.filter(r => r.access_status === 'NOT_CONFIGURED');
  const actions = rows.filter(r => r.action_required);
  const shown = showAll ? notConfigured : notConfigured.filter(r => r.credential_env_var || r.cost_events_30d > 0);

  return (
    <div className="space-y-4">
      {/* What actually needs a human decision, first. */}
      {actions.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t('fin_action_required')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {actions.map(r => (
              <div key={r.provider_id} className="flex flex-wrap items-start gap-2 text-xs">
                <span className="font-medium">{r.provider_name}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">{r.action_required}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Plug className="h-4 w-4" /> {t('fin_connections')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {connected.length === 0 && <Empty message={t('fin_no_connections')} />}
          {connected.map(r => (
            <div key={r.provider_id} className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{r.provider_name}</p>
                    <Pill tone={STATUS_TONE[r.access_status]}>
                      {t(`fin_status_${r.access_status.toLowerCase()}`)}
                    </Pill>
                    {/* Silence is not the same as zero spend. */}
                    {r.stale && (
                      <Pill tone="bad" title={t('fin_stale_help')}>
                        <Clock className="h-3 w-3" />
                        {t('fin_stale')}
                      </Pill>
                    )}
                  </div>
                  {r.homatch_use && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.homatch_use}</p>
                  )}
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold tabular-nums" dir="ltr">{usd(r.spend_30d_usd)}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {num(r.cost_events_30d)} {t('fin_events')}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <AccessChip labelKey="fin_access_service" level={r.service_access} />
                <AccessChip labelKey="fin_access_usage" level={r.usage_access} />
                <AccessChip labelKey="fin_access_billing" level={r.billing_access} />
                <AccessChip labelKey="fin_access_invoice" level={r.invoice_access} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {r.cost_source && (
                  <Pill tone="muted" title={t('fin_cost_source_help')}>
                    {t(`fin_src_${r.cost_source.toLowerCase()}`)}
                  </Pill>
                )}
                <Pill tone="muted">{t(`fin_sync_${r.sync_mode.toLowerCase()}`)}</Pill>
                <Pill tone={
                  r.data_quality === 'GOOD' ? 'good'
                  : r.data_quality === 'PARTIAL' ? 'warn'
                  : r.data_quality === 'POOR' ? 'bad' : 'muted'
                }>
                  {t(`fin_quality_${r.data_quality.toLowerCase()}`)}
                </Pill>
                {r.health_status && (
                  <Pill tone={r.health_status === 'REAL_TEST_PASSED' ? 'good' : 'muted'}>
                    {r.health_status === 'REAL_TEST_PASSED' ? t('fin_test_passed') : r.health_status}
                  </Pill>
                )}
                {/* The NAME of the variable, never its value. */}
                {r.credential_env_var && (
                  <Pill tone={r.credentials_present ? 'good' : 'warn'}>
                    <KeyRound className="h-3 w-3" />
                    {r.credential_env_var}
                  </Pill>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                <span>{t('fin_last_cost_event')}: {relativeTime(r.last_cost_event_at)}</span>
                <span>{t('fin_last_tested')}: {relativeTime(r.last_tested_at)}</span>
                {r.latency_ms !== null && <span>{r.latency_ms}ms</span>}
                {r.unpriced_30d > 0 && (
                  <span className="text-amber-400">
                    {t('fin_unpriced')}: {num(r.unpriced_30d)}
                  </span>
                )}
              </div>

              {r.reconciliation && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {t('fin_reconciliation')}: {t(`fin_recon_${r.reconciliation.status.toLowerCase()}`)}
                  {r.reconciliation.provider_usd !== null && (
                    <> · {usd(r.reconciliation.local_usd)} / {usd(r.reconciliation.provider_usd)}</>
                  )}
                </p>
              )}

              {r.missing_permission && (
                <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-300">
                  {r.missing_permission}
                </p>
              )}
              {r.notes && <p className="mt-1.5 text-[12px] text-muted-foreground/80">{r.notes}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_not_configured_providers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionTitle title="" hint={t('fin_not_configured_hint')} />
          <div className="space-y-2">
            {shown.map(r => (
              <div key={r.provider_id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-border/50 p-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{r.provider_name}</p>
                  <p className="text-[12px] text-muted-foreground">{r.category_label}</p>
                  {r.notes && <p className="mt-0.5 text-[12px] text-muted-foreground/80">{r.notes}</p>}
                </div>
                {r.credential_env_var && (
                  <Pill tone="muted"><KeyRound className="h-3 w-3" />{r.credential_env_var}</Pill>
                )}
              </div>
            ))}
          </div>
          {notConfigured.length > shown.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-xs text-muted-foreground underline underline-offset-2"
            >
              {t('fin_show_all_registered').replace('{n}', String(notConfigured.length - shown.length))}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
