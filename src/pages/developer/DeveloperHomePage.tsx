import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, UserPlus, Upload, CalendarClock, FileUp, Download,
  PhoneCall, AlertTriangle, Clock, Banknote, KeyRound, FileCheck2,
  ArrowRight, Boxes,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, EmptyState, LoadingRows, ErrorState,
  formatDateTime, relativeTime, formatMoney, formatNumber, formatArea,
} from '@/components/developer/primitives';
import {
  SalesBar, Metric, SectionHead, ProjectCover, MoneyBar,
} from '@/components/developer/visuals';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { getOverview, expireReservations } from '@/services/developer/workspace';
import { loadPortfolio, type Portfolio } from '@/services/developer/portfolio';
import { listWorkspaceActivity } from '@/services/developer/crm';
import type { WorkspaceOverview, DevActivity } from '@/services/developer/types';

/**
 * THE COMMAND CENTRE.
 *
 * What this screen used to be: thirteen identical white tiles with a number in
 * each, in three rows, every one drawn at the same weight. A developer could
 * not tell from it which of those numbers was the business and which was a
 * footnote — and the development itself, the building, the thing being sold,
 * appeared nowhere on it at all.
 *
 * What it is now, in the order a person actually wants it:
 *
 *   THE HEADLINE     what is left to sell, how far the building has gone, and
 *                    the money in against the money owed. Drawn at three
 *                    different weights, because they are not equal.
 *   NEEDS ATTENTION  only rows with a count, each a link to the screen that
 *                    resolves it. Absent entirely when nothing is wrong.
 *   THE PORTFOLIO    the developments, with their covers and their progress.
 *   TODAY            the pipeline, but only the parts with a clock on them.
 *   WHAT TO DO       the shortcuts, below the facts rather than above them.
 *   ACTIVITY         what has happened.
 *
 * EVERY FIGURE IS A COUNT OF ROWS THAT EXIST. No trend against a period nobody
 * measured, no conversion rate from two numbers that do not divide, no
 * illustrative figure standing in for a real one. Where there is nothing, the
 * screen says so and offers the action that would give it something.
 */

interface QuickAction {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  capability?: 'inventory' | 'crm' | 'documents' | 'marketing' | 'finance';
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'project', labelKey: 'dev_action_add_project', icon: Building2, to: '/developers/projects?new=1', capability: 'inventory' },
  { key: 'inventory', labelKey: 'dev_action_import_inventory', icon: Upload, to: '/developers/projects', capability: 'inventory' },
  { key: 'lead', labelKey: 'dev_action_add_lead', icon: UserPlus, to: '/developers/contacts?new=1', capability: 'crm' },
  { key: 'viewing', labelKey: 'dev_action_schedule_viewing', icon: CalendarClock, to: '/developers/sales/viewings', capability: 'crm' },
  { key: 'document', labelKey: 'dev_action_upload_document', icon: FileUp, to: '/developers/documents', capability: 'documents' },
  { key: 'export', labelKey: 'dev_action_export_sales', icon: Download, to: '/developers/sales/ledger' },
];

/** One row of the attention list: a real count, and where to go about it. */
interface AttentionRow {
  key: string;
  count: number;
  labelKey: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'attention' | 'default';
}

function buildAttention(o: WorkspaceOverview): AttentionRow[] {
  return [
    { key: 'followups', count: o.leads.overdue_follow_ups, labelKey: 'dev_attention_followups', to: '/developers/contacts?overdue=1', icon: Clock, tone: 'attention' },
    { key: 'expiring', count: o.reservations.expiring_soon, labelKey: 'dev_attention_expiring', to: '/developers/sales/reservations', icon: KeyRound, tone: 'attention' },
    { key: 'expired', count: o.reservations.expired_unresolved, labelKey: 'dev_attention_expired', to: '/developers/sales/reservations', icon: AlertTriangle, tone: 'attention' },
    { key: 'overdue_money', count: o.schedule.overdue_count, labelKey: 'dev_attention_overdue_payments', to: '/developers/sales/payments', icon: Banknote, tone: 'attention' },
    { key: 'unconfirmed', count: o.money.awaiting_confirmation, labelKey: 'dev_attention_unconfirmed', to: '/developers/sales/payments', icon: FileCheck2, tone: 'attention' },
    { key: 'docs', count: o.documents.needs_review, labelKey: 'dev_attention_documents', to: '/developers/documents?review=1', icon: FileCheck2, tone: 'attention' },
    { key: 'viewings', count: o.viewings.today, labelKey: 'dev_attention_viewings_today', to: '/developers/sales/viewings', icon: CalendarClock, tone: 'default' },
    { key: 'tasks', count: o.tasks.overdue, labelKey: 'dev_attention_tasks', to: '/developers/contacts?tasks=1', icon: Clock, tone: 'attention' },
  ].filter((row) => row.count > 0) as AttentionRow[];
}

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: PhoneCall, VIEWING: CalendarClock, RESERVATION: KeyRound,
  PAYMENT: Banknote, DOCUMENT: FileCheck2, OFFER: FileCheck2,
};

export default function DeveloperHomePage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { workspace, can, role } = useDeveloperWorkspace();

  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [activity, setActivity] = useState<DevActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      // Flag holds that have run out before counting them. Releasing the unit
      // only happens if this workspace asked for that (§135); either way the
      // number below is true at the moment it is read rather than a week old.
      await expireReservations(workspace.id);
      const [o, p, a] = await Promise.all([
        getOverview(workspace.id),
        loadPortfolio(workspace.id),
        listWorkspaceActivity(workspace.id, 12),
      ]);
      setOverview(o);
      setPortfolio(p);
      setActivity(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const actions = QUICK_ACTIONS.filter((a) => !a.capability || can(a.capability));
  const attention = overview ? buildAttention(overview) : [];
  const currency = workspace?.default_currency ?? 'USD';
  const totals = portfolio?.totals;
  const hasInventory = (overview?.units.total ?? 0) > 0;

  return (
    <DeveloperShell
      title={workspace?.name ?? t('dev_nav_home')}
      description={t('dev_home_subtitle')}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && overview && (
        <div className="space-y-9">
          {/* ── THE HEADLINE ─────────────────────────────────────────── */}
          {hasInventory ? (
            <section
              aria-labelledby="dev-home-headline"
              className="rounded-xl border border-border bg-card"
            >
              <h2 id="dev-home-headline" className="sr-only">{t('dev_home_inventory')}</h2>
              <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
                <div className="min-w-0">
                  <Metric
                    weight="hero"
                    label={t('dev_stat_available')}
                    value={(
                      <>
                        {formatNumber(overview.units.available, language)}
                        <span className="ml-2 align-baseline text-base font-normal text-muted-foreground">
                          {`/ ${formatNumber(overview.units.total, language)}`}
                        </span>
                      </>
                    )}
                    hint={`${formatMoney(overview.units.value_available, currency, language)} · ${formatArea(totals?.area_available ?? 0, language)}`}
                  />
                  <SalesBar
                    size="lg"
                    showLegend
                    className="mt-5"
                    counts={{
                      available: overview.units.available,
                      on_hold: totals?.on_hold ?? 0,
                      negotiation: overview.units.negotiation,
                      reserved: overview.units.reserved,
                      contract_pending: overview.units.contract_pending,
                      sold: overview.units.sold,
                    }}
                  />
                </div>

                {(can('finance') || can('sale')) && (
                  <div className="min-w-0 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
                    <div className="grid grid-cols-2 gap-5">
                      <Metric
                        label={t('dev_stat_contracted')}
                        value={formatMoney(overview.sales.contracted_value, currency, language)}
                      />
                      <Metric
                        label={t('dev_stat_overdue')}
                        value={formatMoney(overview.schedule.overdue_amount, currency, language)}
                        tone={overview.schedule.overdue_count > 0 ? 'attention' : undefined}
                        hint={t('dev_stat_overdue_hint').replace('{n}', String(overview.schedule.overdue_count))}
                      />
                    </div>
                    <MoneyBar
                      className="mt-5"
                      collected={overview.money.collected}
                      contracted={overview.sales.contracted_value}
                      overdue={overview.schedule.overdue_amount}
                      currency={currency}
                    />
                    <p className="mt-3 text-2xs text-muted-foreground">
                      {t('dev_currency_note').replace('{currency}', currency)}
                    </p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <Panel>
              <EmptyState
                icon={<Building2 className="h-7 w-7" />}
                title={t('dev_empty_inventory_title')}
                description={t('dev_empty_inventory_body')}
                steps={[t('dev_firstrun_step1'), t('dev_firstrun_step2'),
                  t('dev_firstrun_step3'), t('dev_firstrun_step4')]}
                action={can('inventory') ? (
                  <Button onClick={() => navigate('/developers/projects?new=1')}>
                    {t('dev_action_add_project')}
                  </Button>
                ) : undefined}
              />
            </Panel>
          )}

          {/* ── NEEDS ATTENTION ──────────────────────────────────────────
              Absent entirely when nothing is wrong, which is the point: a
              panel that always renders teaches people to stop reading it. */}
          {attention.length > 0 && (
            <section aria-labelledby="dev-home-attention">
              <SectionHead title={t('dev_home_attention')} />
              <h2 id="dev-home-attention" className="sr-only">{t('dev_home_attention')}</h2>
              <Panel className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {attention.map((row) => {
                    const Icon = row.icon;
                    return (
                      <li key={row.key}>
                        <Link
                          to={row.to}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                        >
                          <Icon
                            aria-hidden="true"
                            className={row.tone === 'attention'
                              ? 'h-4 w-4 shrink-0 text-amber-600'
                              : 'h-4 w-4 shrink-0 text-muted-foreground'}
                          />
                          <span className="min-w-0 flex-1 text-sm">
                            {t(row.labelKey).replace('{n}', String(row.count))}
                          </span>
                          <span className="shrink-0 tabular text-sm font-semibold">{row.count}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </section>
          )}

          {/* ── THE PORTFOLIO ───────────────────────────────────────────
              The developments themselves, which the old Home never showed. */}
          {portfolio && portfolio.projects.length > 0 && (
            <section aria-labelledby="dev-home-portfolio">
              <SectionHead
                title={t('dev_home_portfolio')}
                action={(
                  <Link
                    to="/developers/projects"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-ink hover:underline"
                  >
                    {t('dev_view_all')}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                )}
              />
              <h2 id="dev-home-portfolio" className="sr-only">{t('dev_home_portfolio')}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-4">
                {portfolio.projects.slice(0, 6).map((project) => {
                  const r = portfolio.byProject.get(project.id);
                  return (
                    <Link
                      key={project.id}
                      to={`/developers/projects/${project.id}`}
                      className="group flex overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ProjectCover
                        src={project.cover_image_url}
                        name={project.name}
                        ratio=""
                        className="w-32 shrink-0 sm:w-40"
                      />
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold tracking-tight">{project.name}</p>
                          <p className="truncate text-2xs text-muted-foreground">
                            {[project.district, project.city].filter(Boolean).join(', ')}
                          </p>
                        </div>
                        {r && r.total > 0 ? (
                          <div>
                            <SalesBar size="sm" counts={r} />
                            <p className="mt-2 flex items-baseline gap-1.5 text-2xs text-muted-foreground">
                              <span className="tabular font-semibold text-foreground">{r.available}</span>
                              {t('dev_stat_available').toLowerCase()}
                              <span className="ml-auto tabular">{`${r.soldPct}%`}</span>
                            </p>
                          </div>
                        ) : (
                          <p className="text-2xs text-muted-foreground">{t('dev_no_units_yet')}</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── TODAY ───────────────────────────────────────────────── */}
          {can('crm') && (
            <section aria-labelledby="dev-home-pipeline">
              <SectionHead title={t('dev_home_pipeline')} />
              <h2 id="dev-home-pipeline" className="sr-only">{t('dev_home_pipeline')}</h2>
              <Panel className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4">
                <Metric weight="quiet" label={t('dev_stat_new_leads')}
                  value={formatNumber(overview.leads.new, language)} />
                <Metric weight="quiet" label={t('dev_stat_active_leads')}
                  value={formatNumber(overview.leads.active, language)} />
                <Metric weight="quiet" label={t('dev_stat_viewings_upcoming')}
                  value={formatNumber(overview.viewings.upcoming, language)} />
                <Metric weight="quiet" label={t('dev_stat_reservations_active')}
                  value={formatNumber(overview.reservations.active, language)} />
              </Panel>
            </section>
          )}

          {/* ── WHAT TO DO ──────────────────────────────────────────────
              Below the facts. A row of buttons at the very top competes with
              the thing the page exists to report. */}
          {actions.length > 0 && (
            <section aria-labelledby="dev-quick-actions">
              <SectionHead title={t('dev_quick_actions')} />
              <h2 id="dev-quick-actions" className="sr-only">{t('dev_quick_actions')}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => navigate(action.to)}
                      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon className="h-4 w-4 text-gold-ink" aria-hidden="true" />
                      <span className="text-xs font-medium leading-snug">{t(action.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── ACTIVITY ────────────────────────────────────────────── */}
          <section aria-labelledby="dev-home-recent">
            <SectionHead title={t('dev_home_recent')} />
            <h2 id="dev-home-recent" className="sr-only">{t('dev_home_recent')}</h2>
            <Panel className="overflow-hidden">
              {activity.length === 0 ? (
                <EmptyState
                  icon={<Boxes className="h-7 w-7" />}
                  title={t('dev_home_recent_empty')}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((item) => {
                    const Icon = ACTIVITY_ICON[item.kind] ?? Clock;
                    return (
                      <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{item.title}</p>
                          {item.body && (
                            <p className="truncate text-xs text-muted-foreground">{item.body}</p>
                          )}
                        </div>
                        <time
                          dateTime={item.occurred_at}
                          title={formatDateTime(item.occurred_at, language)}
                          className="shrink-0 text-2xs text-muted-foreground"
                        >
                          {relativeTime(item.occurred_at, language)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </section>

          {role === 'VIEWER' && (
            <p className="text-2xs text-muted-foreground">{t('dev_viewer_note')}</p>
          )}
        </div>
      )}
    </DeveloperShell>
  );
}
