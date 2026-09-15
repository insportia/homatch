import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, UserPlus, Upload, CalendarClock, FileUp, Download,
  PhoneCall, AlertTriangle, Clock, Banknote, KeyRound, FileCheck2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, StatTile, EmptyState, LoadingRows, ErrorState,
  Money, formatDateTime, relativeTime, Eyebrow, GoldRule,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { getOverview, expireReservations } from '@/services/developer/workspace';
import { listWorkspaceActivity } from '@/services/developer/crm';
import type { WorkspaceOverview, DevActivity } from '@/services/developer/types';

/**
 * WHAT NEEDS MY ATTENTION (§10).
 *
 * Deliberately not a BI dashboard. A developer opening this between two
 * meetings gets three things in this order: the handful of actions they came
 * here to take, the things that are overdue or about to be, and then the
 * numbers.
 *
 * EVERY FIGURE ON THIS PAGE IS A COUNT OF ROWS THAT EXIST. There is no
 * trend arrow against a period nobody measured, no "conversion rate" derived
 * from two numbers that do not divide, and no card that renders a zero as if
 * it were news. A tile with nothing behind it says so and offers the action
 * that would give it something.
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
      const [o, a] = await Promise.all([
        getOverview(workspace.id),
        listWorkspaceActivity(workspace.id, 12),
      ]);
      setOverview(o);
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

  return (
    <DeveloperShell
      title={workspace?.name ?? t('dev_nav_home')}
      description={t('dev_home_subtitle')}
    >
      {/* ── What would you like to do ───────────────────────────────── */}
      <section className="mb-6" aria-labelledby="dev-quick-actions">
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

      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && overview && (
        <div className="space-y-6">
          {/* ── Needs attention ──────────────────────────────────────── */}
          {attention.length > 0 && (
            <Panel>
              <PanelHeader
                title={t('dev_home_attention_title')}
                description={t('dev_home_attention_body')}
              />
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
                          className={row.tone === 'attention' ? 'h-4 w-4 shrink-0 text-amber-600' : 'h-4 w-4 shrink-0 text-muted-foreground'}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          {t(row.labelKey).replace('{n}', String(row.count))}
                        </span>
                        <span className="shrink-0 tabular text-sm font-semibold">{row.count}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {/* ── Inventory ────────────────────────────────────────────── */}
          <section aria-labelledby="dev-home-inventory">
            <div className="mb-3">
              <Eyebrow>{t('dev_home_inventory')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>
            <h2 id="dev-home-inventory" className="sr-only">{t('dev_home_inventory')}</h2>
            {overview.units.total === 0 ? (
              <Panel>
                <EmptyState
                  icon={<Building2 className="h-7 w-7" />}
                  title={t('dev_empty_inventory_title')}
                  description={t('dev_empty_inventory_body')}
                  action={can('inventory') ? (
                    <Button onClick={() => navigate('/developers/projects?new=1')}>
                      {t('dev_action_add_project')}
                    </Button>
                  ) : undefined}
                />
              </Panel>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatTile
                  label={t('dev_stat_available')}
                  value={overview.units.available}
                  hint={<Money amount={overview.units.value_available} currency={workspace?.default_currency} />}
                  tone="good"
                  onClick={() => navigate('/developers/projects')}
                />
                <StatTile label={t('dev_stat_reserved')} value={overview.units.reserved}
                  onClick={() => navigate('/developers/sales/reservations')} />
                <StatTile label={t('dev_stat_negotiation')} value={overview.units.negotiation} />
                <StatTile label={t('dev_stat_contract_pending')} value={overview.units.contract_pending}
                  onClick={() => navigate('/developers/sales/deals')} />
                <StatTile label={t('dev_stat_sold')} value={overview.units.sold}
                  onClick={() => navigate('/developers/sales/ledger')} />
              </div>
            )}
          </section>

          {/* ── Pipeline ─────────────────────────────────────────────── */}
          {can('crm') && (
            <section aria-labelledby="dev-home-pipeline">
              <div className="mb-3">
                <Eyebrow>{t('dev_home_pipeline')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <h2 id="dev-home-pipeline" className="sr-only">{t('dev_home_pipeline')}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label={t('dev_stat_new_leads')} value={overview.leads.new}
                  onClick={() => navigate('/developers/contacts')} />
                <StatTile label={t('dev_stat_active_leads')} value={overview.leads.active}
                  onClick={() => navigate('/developers/contacts')} />
                <StatTile label={t('dev_stat_viewings_upcoming')} value={overview.viewings.upcoming}
                  onClick={() => navigate('/developers/sales/viewings')} />
                <StatTile label={t('dev_stat_reservations_active')} value={overview.reservations.active}
                  onClick={() => navigate('/developers/sales/reservations')} />
              </div>
            </section>
          )}

          {/* ── Money ────────────────────────────────────────────────── */}
          {(can('finance') || can('sale')) && (
            <section aria-labelledby="dev-home-money">
              <div className="mb-3">
                <Eyebrow>{t('dev_home_money')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <h2 id="dev-home-money" className="sr-only">{t('dev_home_money')}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label={t('dev_stat_sold_this_month')}
                  value={overview.sales.this_month}
                  hint={<Money amount={overview.sales.value_this_month} currency={workspace?.default_currency} />}
                />
                <StatTile
                  label={t('dev_stat_contracted')}
                  value={<Money amount={overview.sales.contracted_value} currency={workspace?.default_currency} />}
                />
                <StatTile
                  label={t('dev_stat_collected')}
                  value={<Money amount={overview.money.collected} currency={workspace?.default_currency} />}
                  hint={t('dev_stat_collected_hint')}
                  tone="good"
                />
                <StatTile
                  label={t('dev_stat_overdue')}
                  value={<Money amount={overview.schedule.overdue_amount} currency={workspace?.default_currency} />}
                  hint={t('dev_stat_overdue_hint').replace('{n}', String(overview.schedule.overdue_count))}
                  tone={overview.schedule.overdue_count > 0 ? 'attention' : 'default'}
                  onClick={() => navigate('/developers/sales/payments')}
                />
              </div>
              {/* A currency note, because these totals add across projects that
                  may not share one. Silence here would be the lie. */}
              <p className="mt-2 text-2xs text-muted-foreground">
                {t('dev_currency_note').replace('{currency}', workspace?.default_currency ?? 'USD')}
              </p>
            </section>
          )}

          {/* ── Recent activity ──────────────────────────────────────── */}
          <Panel>
            <PanelHeader title={t('dev_home_recent')} />
            {activity.length === 0 ? (
              <EmptyState title={t('dev_home_recent_empty')} />
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

          {role === 'VIEWER' && (
            <p className="text-2xs text-muted-foreground">{t('dev_viewer_note')}</p>
          )}
        </div>
      )}
    </DeveloperShell>
  );
}
