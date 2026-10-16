// HOMATCH — Admin: Integrations → Property portals.
//
// The control centre for the eight Georgian portals Publishing works with. It
// answers four questions at a glance: which portals exist, which are switched
// on, which accounts are connected (none — no portal offers an authorised
// account connection, and this page says so instead of drawing a Connect
// button), and how listings are moving through them.
//
// ACCESS CONTROL IS NOT THIS FILE'S JOB. Every read and write goes through the
// publishing-engine function, which re-checks is_admin() with the caller's own
// token on every request; the registry tables are service-role only.

import { ArrowRight, Cable, CheckCircle2, CircleSlash, Clock, Hand, Layers, RefreshCw, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Kpi, KpiRow, LoadingBlock, PageHeader } from '@/components/communications/primitives';
import { PortalLogo, dateTime } from '@/components/publishing/parts';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type AdminOverview, type AdminProvider, PublishingError, adminProviders } from '@/services/publishing';

const sum = (p: AdminProvider, statuses: string[]) => statuses.reduce((n, s) => n + (p.stats[s as keyof AdminProvider['stats']] ?? 0), 0);
export const AWAITING = ['HANDOFF_READY', 'VERIFYING'];
export const LIVE = ['PUBLISHED', 'OWNER_CONFIRMED'];
export const FAILED = ['VERIFICATION_FAILED', 'REMOVED_EXTERNALLY'];

export function useAdminPortals() {
  const [state, setState] = useState<{ data: AdminOverview | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ data: await adminProviders(), error: null, loading: false }); } catch (e) {
      setState({ data: null, error: e instanceof PublishingError ? e.code : 'NETWORK_ERROR', loading: false });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

export function HealthMark({ status }: { status: string | null }) {
  const { t } = useLanguage();
  const tone = status === 'REACHABLE' ? 'text-emerald-700' : status === 'UNREACHABLE' ? 'text-red-700' : 'text-muted-foreground';
  const Icon = status === 'REACHABLE' ? CheckCircle2 : status === 'UNREACHABLE' ? XCircle : status === 'SKIPPED' ? CircleSlash : Clock;
  return <span className={cn('inline-flex items-center gap-1 text-2xs font-semibold', tone)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{t(`pubw_admin_health_${(status ?? 'unknown').toLowerCase()}`)}</span>;
}

export default function AdminPropertyPortalsPage() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const { data, error, loading, reload } = useAdminPortals();
  const providers = data?.providers ?? [];
  const totals = useMemo(() => ({
    enabled: providers.filter((p) => p.enabled).length,
    awaiting: providers.reduce((n, p) => n + sum(p, AWAITING), 0),
    live: providers.reduce((n, p) => n + sum(p, LIVE), 0),
    failed: providers.reduce((n, p) => n + sum(p, FAILED), 0),
    lastCheck: providers.map((p) => p.health.checkedAt).filter(Boolean).sort().pop() ?? null,
  }), [providers]);
  const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-5" data-testid="admin-portals">
      <PageHeader eyebrow={t('pubw_admin_eyebrow')} title={t('pubw_admin_title')} subtitle={t('pubw_admin_subtitle')} secondary={{ label: t('pubw_admin_refresh'), onClick: () => void reload() }} />

      {error ? <ErrorState messageKey={error === 'ADMIN_REQUIRED' ? 'pubw_err_admin_required' : 'pubw_admin_load_failed'} detail={error} onRetry={() => void reload()} /> : null}

      <KpiRow cols={4}>
        <Kpi labelKey="pubw_admin_kpi_registered" value={loading ? null : providers.length} loading={loading} icon={Layers} />
        <Kpi labelKey="pubw_admin_kpi_enabled" value={loading ? null : totals.enabled} loading={loading} icon={CheckCircle2} accent />
        <Kpi labelKey="pubw_admin_kpi_accounts" value={loading ? null : 0} sub={t('pubw_admin_kpi_accounts_sub')} loading={loading} icon={Cable} />
        <Kpi labelKey="pubw_admin_kpi_manual" value={loading ? null : providers.filter((p) => p.capabilities.manualHandoff && !p.capabilities.apiPublishing).length} loading={loading} icon={Hand} />
        <Kpi labelKey="pubw_admin_kpi_awaiting" value={loading ? null : totals.awaiting} loading={loading} icon={Clock} />
        <Kpi labelKey="pubw_admin_kpi_live" value={loading ? null : totals.live} loading={loading} icon={CheckCircle2} />
        <Kpi labelKey="pubw_admin_kpi_failed" value={loading ? null : totals.failed} loading={loading} icon={XCircle} />
        <Kpi labelKey="pubw_admin_kpi_last_check" value={loading ? null : totals.lastCheck ? dateTime(totals.lastCheck, locale) : t('pubw_admin_never')} loading={loading} icon={RefreshCw} />
      </KpiRow>

      <p className="rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/50 px-4 py-3 text-sm text-foreground">{t('pubw_admin_honesty')}</p>

      {loading ? <LoadingBlock rows={4} /> : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {providers.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link to={`/admin/integrations/portals/${p.id}`} data-testid={`admin-portal-${p.id}`}
                className="group flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-all hover:border-[hsl(var(--gold-border))] motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex min-w-0 items-center gap-3">
                  <PortalLogo portal={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-semibold text-foreground">{p.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground" dir="ltr">{p.domains[0]}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold', p.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-secondary text-muted-foreground')}>
                    {t(p.enabled ? 'pubw_admin_on' : 'pubw_admin_off')}
                  </span>
                </span>
                <span className="text-2xs text-muted-foreground">{t(p.verification === 'OWNER_CONFIRMED' ? 'pubw_admin_mode_owner' : 'pubw_admin_mode_check')}</span>
                <span className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                  {([['pubw_admin_awaiting', AWAITING], ['pubw_admin_live', LIVE], ['pubw_admin_failed', FAILED]] as const).map(([k, st]) => (
                    <span key={k} className="min-w-0"><span className="block font-display text-lg font-bold tabular-nums text-foreground">{sum(p, [...st])}</span><span className="block text-2xs text-muted-foreground">{t(k)}</span></span>
                  ))}
                </span>
                <span className="mt-auto flex items-center justify-between gap-2">
                  <HealthMark status={p.health.status} />
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{t('pubw_admin_configure')}<ArrowRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" /></span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5" aria-labelledby="admin-portals-activity">
        <h2 id="admin-portals-activity" className="mb-3 font-display text-base font-semibold text-foreground">{t('pubw_admin_activity')}</h2>
        {data?.audit.length ? (
          <ol className="space-y-2">
            {data.audit.slice(0, 12).map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 text-2xs">
                <span className="font-semibold text-foreground">{name(a.provider_id)} · {t(a.action === 'RECHECK' ? 'pubw_admin_audit_recheck' : 'pubw_admin_audit_update')}</span>
                <span className="text-muted-foreground">{dateTime(a.created_at, locale)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="text-2xs text-muted-foreground">{t('pubw_admin_activity_empty')}</p>}
      </section>
    </div>
  );
}
