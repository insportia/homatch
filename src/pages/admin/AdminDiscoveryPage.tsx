// HOMATCH ADMIN — DISCOVERY CONTROL CENTER.
//
// The one screen that answers "is Find Buyers / Find Tenants discovery
// actually working right now?": whether Telegram is healthy, which switches
// are on, what the source queue is doing, what the classifier is labelling,
// how much CURRENT demand (last 7 / 14 / 30 days) exists, and every recent
// campaign with its truthful state -- with Stop and Retry where they are safe.
//
// Lives inside the existing Admin shell. Shows counts, states and ids only:
// never message text, never a token, never a Telegram credential (those exist
// only in the Railway worker's variables and are not in the database).
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { intlLocaleFor } from '@/components/workspace/primitives';
import {
  DISCOVERY_SWITCHES, getDiscoveryOverview, retryCampaignSources, setDiscoverySwitch, settingOn, stopCampaignJob,
  type DiscoveryOverview, type DiscoverySwitch,
} from '@/services/adminDiscovery';

const RUNNING = new Set(['queued', 'analysing_property', 'generating_queries', 'searching_sources',
  'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking']);

const Panel = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-2xl border border-border bg-card p-4 shadow-card', className)}>
    <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
    {children}
  </section>
);

const Kpi = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
    <p className="text-2xs text-muted-foreground">{label}</p>
    <p className={cn('mt-0.5 text-lg font-semibold tabular-nums',
      tone === 'ok' && 'text-[hsl(152_54%_30%)]', tone === 'warn' && 'text-[hsl(32_78%_36%)]',
      tone === 'bad' && 'text-destructive')}>{value}</p>
  </div>
);

function when(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminDiscoveryPage() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [data, setData] = useState<DiscoveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getDiscoveryOverview()); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_load_failed')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (key: DiscoverySwitch, on: boolean) => {
    setBusy(key);
    try { await setDiscoverySwitch(key, on); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_save_failed')); }
    finally { setBusy(null); }
  };
  const act = async (id: string, kind: 'stop' | 'retry') => {
    setBusy(`${kind}:${id}`);
    try {
      if (kind === 'stop') { await stopCampaignJob(id); toast.success(t('admin_disc_stopped')); }
      else { await retryCampaignSources(id); toast.success(t('admin_disc_requeued')); }
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_action_failed')); }
    finally { setBusy(null); }
  };

  const policy = (data?.settings.discovery_freshness_policy ?? {}) as { activeMaxDays?: number };
  const tg = data?.telegram_health ?? null;
  const tgTone = !tg ? 'warn' : tg.last_error ? 'bad' : 'ok';
  const openQueue = (data?.queue ?? []).filter((q) => ['PENDING', 'PROCESSING', 'RETRY_WAIT'].includes(q.status))
    .reduce((n, q) => n + q.jobs, 0);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t('admin_disc_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin_disc_sub')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('admin_disc_refresh')}
        </Button>
      </header>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
            <Kpi label={t('admin_disc_kpi_d7')} value={data.current_demand.d7} tone={data.current_demand.d7 > 0 ? 'ok' : 'warn'} />
            <Kpi label={t('admin_disc_kpi_d14')} value={data.current_demand.d14} />
            <Kpi label={t('admin_disc_kpi_d30')} value={data.current_demand.d30} />
            <Kpi label={t('admin_disc_kpi_pending')} value={data.pending_classification} tone={data.pending_classification > 200 ? 'warn' : undefined} />
            <Kpi label={t('admin_disc_kpi_queue')} value={openQueue} />
            <Kpi label={t('admin_disc_kpi_telegram')} value={!tg ? t('admin_disc_tg_never') : tg.last_error ? t('admin_disc_tg_error') : t('admin_disc_tg_ok')} tone={tgTone} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('admin_disc_switches')}>
              <ul className="space-y-3">
                {DISCOVERY_SWITCHES.map((key) => (
                  <li key={key} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{t(`admin_disc_sw_${key}` as never)}</p>
                      <p className="text-xs leading-snug text-muted-foreground">{t(`admin_disc_sw_${key}_d` as never)}</p>
                    </div>
                    <Switch checked={settingOn(data.settings[key])} disabled={busy === key}
                      onCheckedChange={(on) => void toggle(key, on)} aria-label={t(`admin_disc_sw_${key}` as never)} />
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                <dt className="text-muted-foreground">{t('admin_disc_window')}</dt>
                <dd className="text-end font-medium tabular-nums">{t('admin_disc_days', { n: String(policy.activeMaxDays ?? 30) })}</dd>
                <dt className="text-muted-foreground">{t('admin_disc_min_budget')}</dt>
                <dd className="text-end font-medium tabular-nums">{String(data.settings.campaign_min_credits ?? 50)}</dd>
                <dt className="text-muted-foreground">{t('admin_disc_tg_mode')}</dt>
                <dd className="text-end font-medium">{String(data.settings.telegram_integration_mode ?? 'MTPROTO_USER')}</dd>
              </dl>
            </Panel>

            <Panel title={t('admin_disc_telegram')}>
              {tg ? (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted-foreground">{t('admin_disc_tg_last_ok')}</dt>
                  <dd className="text-end">{when(tg.last_success_at, locale)}</dd>
                  <dt className="text-muted-foreground">{t('admin_disc_tg_last_test')}</dt>
                  <dd className="text-end">{when(tg.last_tested_at, locale)}</dd>
                  <dt className="text-muted-foreground">{t('admin_disc_tg_counts')}</dt>
                  <dd className="text-end tabular-nums">{tg.success_count} / {tg.failure_count}</dd>
                  {tg.last_error && (<><dt className="text-muted-foreground">{t('admin_disc_tg_error')}</dt>
                    <dd className="break-words text-end text-destructive">{tg.last_error.split(':')[0]}</dd></>)}
                </dl>
              ) : <p className="text-xs text-muted-foreground">{t('admin_disc_tg_never_d')}</p>}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-xs">
                  <thead><tr className="text-start text-muted-foreground">
                    <th className="py-1 text-start font-medium">{t('admin_disc_col_state')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_disc_col_targets')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_disc_col_read')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_disc_col_demand')}</th>
                  </tr></thead>
                  <tbody>
                    {data.targets.length === 0 && <tr><td colSpan={4} className="py-2 text-muted-foreground">{t('admin_disc_none')}</td></tr>}
                    {data.targets.map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1.5">{r.lifecycle} · {r.readability}{r.discovery_enabled ? '' : ` · ${t('admin_disc_off')}`}</td>
                        <td className="py-1.5 text-end tabular-nums">{r.targets}</td>
                        <td className="py-1.5 text-end tabular-nums">{r.items_read}</td>
                        <td className="py-1.5 text-end tabular-nums">{r.demand_found}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title={t('admin_disc_queue')}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem] text-xs">
                  <thead><tr className="text-muted-foreground">
                    <th className="py-1 text-start font-medium">{t('admin_disc_col_provider')}</th>
                    <th className="py-1 text-start font-medium">{t('admin_disc_col_state')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_disc_col_jobs')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_disc_col_last')}</th>
                  </tr></thead>
                  <tbody>
                    {data.queue.map((q, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1.5">{q.provider}</td>
                        <td className="py-1.5">{q.status}</td>
                        <td className="py-1.5 text-end tabular-nums">{q.jobs}</td>
                        <td className="py-1.5 text-end">{when(q.last_activity, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title={t('admin_disc_labels')}>
              {data.labels_7d.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_disc_none')}</p> : (
                <ul className="space-y-1.5 text-xs">
                  {data.labels_7d.map((l) => (
                    <li key={l.label} className="flex items-center justify-between gap-2">
                      <span>{t(`admin_disc_label_${l.label.toLowerCase()}` as never)}</span>
                      <span className="tabular-nums font-medium">{l.signals}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title={t('admin_disc_jobs')}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-xs">
                <thead><tr className="text-muted-foreground">
                  <th className="py-1 text-start font-medium">{t('admin_disc_col_started')}</th>
                  <th className="py-1 text-start font-medium">{t('admin_disc_col_state')}</th>
                  <th className="py-1 text-start font-medium">{t('admin_disc_col_step')}</th>
                  <th className="py-1 text-end font-medium">{t('admin_disc_col_fresh')}</th>
                  <th className="py-1 text-end font-medium">{t('admin_disc_col_budget')}</th>
                  <th className="py-1 text-start font-medium">{t('admin_disc_col_sources')}</th>
                  <th className="py-1" />
                </tr></thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id} className="border-t border-border/60 align-top">
                      <td className="py-1.5 whitespace-nowrap">{when(j.started_at, locale)}</td>
                      <td className="py-1.5">{j.status}{j.failure_reason ? <span className="block text-muted-foreground">{j.failure_reason}</span> : null}</td>
                      <td className="py-1.5 max-w-[16rem] break-words text-muted-foreground">{j.current_step ?? '—'}</td>
                      <td className="py-1.5 text-end tabular-nums">{j.fresh_matches_created}</td>
                      <td className="py-1.5 text-end tabular-nums">{j.budget_credits ?? '—'}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {Object.entries(j.source_jobs ?? {}).map(([s, n]) => `${s} ${n}`).join(' · ') || '—'}
                      </td>
                      <td className="py-1.5 text-end whitespace-nowrap">
                        {j.status === 'searching_sources' && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" disabled={busy === `retry:${j.id}`}
                            onClick={() => void act(j.id, 'retry')}><RotateCcw className="h-3.5 w-3.5" />{t('admin_disc_retry')}</Button>
                        )}
                        {RUNNING.has(j.status) && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-destructive" disabled={busy === `stop:${j.id}`}
                            onClick={() => void act(j.id, 'stop')}><Square className="h-3.5 w-3.5" />{t('admin_disc_stop')}</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
