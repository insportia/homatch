import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Eye, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import { SalesBar, BarRows, Funnel, SectionHead } from '@/components/developer/visuals';
import {
  Panel, PanelHeader, StatTile, EmptyState, LoadingRows, ErrorState,
  TableScroll, Th, Td, Money, formatArea, Eyebrow, GoldRule, UnitStatusPill,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { getOverview } from '@/services/developer/workspace';
import { listUnits, listProjects } from '@/services/developer/inventory';
import { listLedger } from '@/services/developer/sales';
import { listLeads, type LeadWithContact } from '@/services/developer/crm';
import { supabase } from '@/services/developer/client';
import { loadDashboard, loadTwinAnalytics } from '@/services/developer/dashboard';
import { listTeam } from '@/services/developer/workspace';
import type {
  WorkspaceOverview, DevUnit, SalesLedgerRow, DevProject,
  DevDashboard, TwinAnalytics, DevMember,
} from '@/services/developer/types';

/**
 * INSIGHTS (§48, §75, §159, §160).
 *
 * WHAT THIS PAGE WILL NOT DO
 *
 * It will not print a "health score". It will not divide two numbers that
 * measure different populations and call the result a conversion rate. It
 * will not say an apartment is "in demand" because somebody scrolled past it.
 *
 * WHAT IT DOES
 *
 * Counts, sums and averages of rows that exist, each next to the thing it was
 * counted from. Where it makes an observation in words, the observation names
 * the evidence — "eleven people opened the link for A-704 and nobody has
 * booked a viewing" is a fact with two counts behind it that a sales director
 * can act on or dismiss. A recommendation with no visible arithmetic is a
 * recommendation nobody can argue with, which makes it worthless.
 *
 * Anything with too little behind it says so rather than drawing an empty
 * chart.
 */

interface UnitInterest {
  unitId: string;
  views: number;
  tourOpens: number;
}

export default function DeveloperInsightsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [units, setUnits] = useState<DevUnit[]>([]);
  const [ledger, setLedger] = useState<SalesLedgerRow[]>([]);
  const [leads, setLeads] = useState<LeadWithContact[]>([]);
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [interest, setInterest] = useState<Map<string, UnitInterest>>(new Map());
  const [dashboard, setDashboard] = useState<DevDashboard | null>(null);
  const [twin, setTwin] = useState<TwinAnalytics | null>(null);
  const [team, setTeam] = useState<DevMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [o, unitPage, ledgerRows, leadRows, projectRows, board, twinStats, members] =
        await Promise.all([
          getOverview(workspace.id),
          listUnits(workspace.id, { limit: 3000 }),
          listLedger(workspace.id),
          can('crm') ? listLeads(workspace.id, { limit: 1000 }) : Promise.resolve([]),
          listProjects(workspace.id),
          /* The executive rollup. SECURITY INVOKER, so a sales agent running
             this sees their own rows and an owner sees everything — same SQL,
             a different answer, decided by RLS rather than by a filter
             somebody has to remember to add. */
          loadDashboard(workspace.id),
          loadTwinAnalytics(workspace.id, null, 30),
          listTeam(workspace.id),
        ]);
      setOverview(o);
      setUnits(unitPage.rows);
      setLedger(ledgerRows);
      setLeads(leadRows);
      setProjects(projectRows);
      setDashboard(board);
      setTwin(twinStats);
      setTeam(members);

      // Share activity, joined to units through the links that produced it.
      // Counted here rather than in SQL because it is only ever a few hundred
      // rows and the join is one query either way.
      const { data: links } = await supabase
        .from('dev_share_links')
        .select('id, target_id, target_type, view_count')
        .eq('workspace_id', workspace.id)
        .eq('target_type', 'UNIT');
      const { data: events } = await supabase
        .from('dev_share_events')
        .select('share_link_id, event')
        .eq('workspace_id', workspace.id)
        .eq('event', 'WALKTHROUGH_OPENED');

      const byLink = new Map((links ?? []).map((l) => [l.id as string, l.target_id as string]));
      const map = new Map<string, UnitInterest>();
      for (const link of links ?? []) {
        const unitId = link.target_id as string;
        const entry = map.get(unitId) ?? { unitId, views: 0, tourOpens: 0 };
        entry.views += Number(link.view_count ?? 0);
        map.set(unitId, entry);
      }
      for (const event of events ?? []) {
        const unitId = byLink.get(event.share_link_id as string);
        if (!unitId) continue;
        const entry = map.get(unitId) ?? { unitId, views: 0, tourOpens: 0 };
        entry.tourOpens += 1;
        map.set(unitId, entry);
      }
      setInterest(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, can]);

  useEffect(() => { void load(); }, [load]);

  const inventory = useMemo(() => {
    const available = units.filter((u) => u.status === 'AVAILABLE');
    const sold = units.filter((u) => u.status === 'SOLD');
    const avgAvailablePsm = average(available.map((u) => u.price_per_sqm).filter(isNumber));
    const avgSoldPsm = average(ledger.map((r) => r.sale_price_per_sqm).filter(isNumber));
    const areaAvailable = available.reduce((s, u) => s + Number(u.area_total ?? 0), 0);
    return { available, sold, avgAvailablePsm, avgSoldPsm, areaAvailable };
  }, [units, ledger]);

  /**
   * Days between reserving and contracting, from deals that have both dates.
   * If fewer than three have both, the figure is not shown — an "average"
   * over two rows is a number pretending to be a trend.
   */
  const daysToContract = useMemo(() => {
    const spans = ledger
      .filter((r) => r.reserved_at && r.contract_date)
      .map((r) => (new Date(r.contract_date!).getTime() - new Date(r.reserved_at!).getTime()) / 86400000)
      .filter((d) => Number.isFinite(d) && d >= 0);
    if (spans.length < 3) return null;
    const mean = average(spans);
    return mean === null ? null : Math.round(mean);
  }, [ledger]);

  /** Units people are looking at and nobody has reserved. Both counts shown. */
  const watchList = useMemo(() => {
    return units
      .filter((u) => u.status === 'AVAILABLE')
      .map((u) => ({ unit: u, ...(interest.get(u.id) ?? { unitId: u.id, views: 0, tourOpens: 0 }) }))
      .filter((row) => row.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 8);
  }, [units, interest]);

  const bySource = useMemo(() => {
    const map = new Map<string, { total: number; sold: number }>();
    for (const lead of leads) {
      const key = lead.source || t('dev_source_unknown');
      const entry = map.get(key) ?? { total: 0, sold: 0 };
      entry.total += 1;
      if (lead.stage === 'SOLD') entry.sold += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  }, [leads, t]);

  /**
   * THE SHAPE OF THE BUSINESS, DRAWN.
   *
   * Four numbers in four boxes hide the only interesting thing about a
   * funnel: where it narrows. Each step is measured against the first, so
   * the taper IS the conversion rate. Steps with nothing behind them are not
   * drawn at all — a funnel of zeroes is a decoration.
   */
  const funnel = useMemo(() => {
    const steps = [
      { label: t('dev_funnel_leads'), value: leads.length },
      { label: t('dev_funnel_viewings'), value: leads.filter(
        (l) => ['VIEWING_SCHEDULED', 'VIEWING_COMPLETED', 'NEGOTIATION', 'RESERVATION',
          'CONTRACT', 'PAYMENT_PENDING', 'SOLD'].includes(l.stage)).length },
      { label: t('dev_funnel_reserved'), value: leads.filter(
        (l) => ['RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD'].includes(l.stage)).length },
      { label: t('dev_funnel_sold'), value: leads.filter((l) => l.stage === 'SOLD').length },
    ];
    return steps[0].value > 0 ? steps : [];
  }, [leads, t]);

  /** What is left in each development, longest bar first. */
  const byProject = useMemo(() => {
    const rows = projects.map((project) => {
      const own = units.filter((u) => u.project_id === project.id);
      return {
        label: project.name,
        value: own.filter((u) => u.status === 'AVAILABLE').length,
        hint: `/ ${own.length}`,
      };
    }).filter((row) => row.value > 0 || row.hint !== '/ 0');
    return rows.sort((a, b) => b.value - a.value);
  }, [projects, units]);

  return (
    <DeveloperShell title={t('dev_nav_insights')} description={t('dev_insights_subtitle')}>
      {loading && <LoadingRows rows={8} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && units.length === 0 && (
        <Panel>
          <EmptyState
            icon={<BarChart3 className="h-7 w-7" />}
            title={t('dev_insights_empty_title')}
            description={t('dev_insights_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && units.length > 0 && overview && (
        <div className="space-y-8">
          {/* ── Where the building stands, drawn ──────────────────────
              A stacked bar rather than five counts: the only interesting
              property of these numbers is their proportion to each other. */}
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <SalesBar
              size="lg"
              showLegend
              counts={{
                available: overview.units.available,
                negotiation: overview.units.negotiation,
                reserved: overview.units.reserved,
                contract_pending: overview.units.contract_pending,
                sold: overview.units.sold,
              }}
            />
          </section>

          {/* ── The funnel, and what is left where ────────────────────
              Both draw only from rows that exist; either is absent entirely
              when its source is empty, rather than rendering an axis with
              nothing under it. */}
          {(funnel.length > 0 || byProject.length > 0) && (
            <div className="grid gap-5 lg:grid-cols-2">
              {funnel.length > 0 && (
                <section>
                  <SectionHead title={t('dev_insights_funnel')} sub={t('dev_insights_funnel_sub')} />
                  <Panel className="p-5">
                    <Funnel steps={funnel} />
                  </Panel>
                </section>
              )}
              {byProject.length > 0 && (
                <section>
                  <SectionHead title={t('dev_insights_by_project')} />
                  <Panel className="p-5">
                    <BarRows rows={byProject} />
                  </Panel>
                </section>
              )}
            </div>
          )}

          {/* ── Inventory ────────────────────────────────────────────── */}
          <section>
            <div className="mb-3">
              <Eyebrow>{t('dev_insights_inventory')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={t('dev_stat_available')} value={inventory.available.length}
                hint={formatArea(inventory.areaAvailable, language)} />
              <StatTile label={t('dev_stat_sold')} value={inventory.sold.length} />
              <StatTile
                label={t('dev_insights_avg_ask_psm')}
                value={inventory.avgAvailablePsm != null
                  ? <Money amount={inventory.avgAvailablePsm} currency={workspace?.default_currency} />
                  : '—'}
              />
              <StatTile
                label={t('dev_insights_avg_sold_psm')}
                value={inventory.avgSoldPsm != null
                  ? <Money amount={inventory.avgSoldPsm} currency={workspace?.default_currency} />
                  : '—'}
                hint={ledger.length > 0
                  ? t('dev_insights_from_n_sales').replace('{n}', String(ledger.length))
                  : t('dev_insights_no_sales_yet')}
              />
            </div>
          </section>

          {/* ── Money owed, money owing ──────────────────────────────── */}
          {dashboard && (
            <Panel>
              <PanelHeader
                title={t('dev_insights_receivables')}
                description={t('dev_insights_receivables_body')}
              />
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
                <StatTile
                  label={t('dev_insights_collected')}
                  value={<Money amount={dashboard.money.collected} currency={workspace?.default_currency} />}
                  tone="good"
                  hint={t('dev_insights_collected_hint')}
                />
                <StatTile
                  label={t('dev_insights_outstanding')}
                  value={<Money amount={dashboard.receivables.outstanding_total} currency={workspace?.default_currency} />}
                />
                <StatTile
                  label={t('dev_insights_due_30d')}
                  value={<Money amount={dashboard.receivables.due_30d} currency={workspace?.default_currency} />}
                />
                <StatTile
                  label={t('dev_insights_overdue')}
                  value={<Money amount={dashboard.receivables.overdue_amount} currency={workspace?.default_currency} />}
                  tone={dashboard.receivables.overdue_count > 0 ? 'attention' : 'default'}
                  hint={dashboard.receivables.overdue_count > 0
                    ? t('dev_insights_overdue_hint')
                      .replace('{n}', String(dashboard.receivables.overdue_count))
                    : undefined}
                />
              </div>

              {(dashboard.commissions.pending > 0
                || dashboard.commissions.approved > 0
                || dashboard.commissions.paid > 0) && (
                <div className="border-t border-border p-4 sm:p-5">
                  <Eyebrow>{t('dev_sales_tab_commissions')}</Eyebrow>
                  <GoldRule className="mt-1.5" />
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatTile
                      label={t('dev_commission_status_pending')}
                      value={<Money amount={dashboard.commissions.pending} currency={workspace?.default_currency} />}
                    />
                    <StatTile
                      label={t('dev_commission_status_approved')}
                      value={<Money amount={dashboard.commissions.approved} currency={workspace?.default_currency} />}
                    />
                    <StatTile
                      label={t('dev_commission_status_paid')}
                      value={<Money amount={dashboard.commissions.paid} currency={workspace?.default_currency} />}
                    />
                  </div>
                  {/* Never netted against revenue anywhere in this product. A
                      commission is an expense owed to somebody, and putting it
                      in a column that sums to "collected" is how a sales
                      report starts double-counting a sale. */}
                  <p className="mt-2 text-2xs text-muted-foreground">
                    {t('dev_insights_commissions_note')}
                  </p>
                </div>
              )}
            </Panel>
          )}

          {/* ── Who is selling, and where the buyers came from ────────── */}
          {dashboard && (dashboard.by_salesperson.length > 0 || dashboard.by_source.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {dashboard.by_salesperson.length > 0 && (
                <Panel>
                  <PanelHeader title={t('dev_insights_by_salesperson')} />
                  <TableScroll>
                    <table className="w-full text-sm" data-tabular>
                      <thead className="border-b border-border bg-muted/40">
                        <tr>
                          <Th>{t('dev_sales_manager')}</Th>
                          <Th className="text-right">{t('dev_insights_sales')}</Th>
                          <Th className="text-right">{t('dev_insights_value')}</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[...dashboard.by_salesperson]
                          .sort((a, b) => b.value - a.value)
                          .map((row) => {
                            const person = team.find((m) => m.user_id === row.user_id);
                            return (
                              <tr key={row.user_id}>
                                <Td>{person?.full_name || person?.email || t('dev_unassigned')}</Td>
                                <Td className="text-right">{row.sales}</Td>
                                <Td className="text-right">
                                  <Money amount={row.value} currency={workspace?.default_currency} />
                                </Td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </TableScroll>
                </Panel>
              )}

              {dashboard.by_source.length > 0 && (
                <Panel>
                  <PanelHeader
                    title={t('dev_insights_by_source')}
                    description={t('dev_insights_by_source_body')}
                  />
                  <TableScroll>
                    <table className="w-full text-sm" data-tabular>
                      <thead className="border-b border-border bg-muted/40">
                        <tr>
                          <Th>{t('dev_lead_source')}</Th>
                          <Th className="text-right">{t('dev_insights_sales')}</Th>
                          <Th className="text-right">{t('dev_insights_value')}</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[...dashboard.by_source]
                          .sort((a, b) => b.value - a.value)
                          .map((row) => (
                            <tr key={row.source}>
                              <Td>
                                {row.source === 'UNRECORDED'
                                  ? t('dev_insights_source_unrecorded')
                                  : row.source}
                              </Td>
                              <Td className="text-right">{row.sales}</Td>
                              <Td className="text-right">
                                <Money amount={row.value} currency={workspace?.default_currency} />
                              </Td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </TableScroll>
                </Panel>
              )}
            </div>
          )}

          {/* ── The 3D, and whether anybody opened it ─────────────────── */}
          {twin && twin.totals.opens > 0 && (
            <Panel>
              <PanelHeader
                title={t('dev_insights_twin')}
                description={t('dev_insights_twin_body')}
              />
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
                <StatTile label={t('dev_insights_twin_opens')} value={twin.totals.opens} />
                <StatTile label={t('dev_insights_twin_visitors')} value={twin.totals.visitors} />
                <StatTile label={t('dev_insights_twin_unit_views')} value={twin.totals.unit_views} />
                <StatTile
                  label={t('dev_insights_twin_enquiries')}
                  value={twin.totals.contact_requests}
                  tone={twin.totals.contact_requests > 0 ? 'good' : 'default'}
                />
              </div>

              {twin.top_units.length > 0 && (
                <TableScroll className="border-t border-border">
                  <table className="w-full text-sm" data-tabular>
                    <thead className="bg-muted/40">
                      <tr>
                        <Th>{t('dev_unit')}</Th>
                        <Th>{t('dev_status')}</Th>
                        <Th className="text-right">{t('dev_insights_twin_views')}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {twin.top_units.map((u) => (
                        <tr key={u.unit_id}>
                          <Td className="font-medium">{u.unit_number}</Td>
                          <Td><UnitStatusPill status={u.status} /></Td>
                          <Td className="text-right">{u.views}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>
          )}

          {/* ── Speed ────────────────────────────────────────────────── */}
          <Panel>
            <PanelHeader title={t('dev_insights_speed')} />
            <div className="flex flex-wrap gap-6 p-4 sm:p-5">
              <div>
                <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_insights_days_to_contract')}
                </p>
                {daysToContract != null ? (
                  <p className="mt-1 text-2xl font-semibold tabular">{daysToContract}</p>
                ) : (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('dev_insights_not_enough_data')}
                  </p>
                )}
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_stat_reservations_active')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular">{overview.reservations.active}</p>
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t('dev_stat_viewings_upcoming')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular">{overview.viewings.upcoming}</p>
              </div>
            </div>
          </Panel>

          {/* ── Interest ─────────────────────────────────────────────── */}
          <Panel>
            <PanelHeader
              title={t('dev_insights_interest')}
              description={t('dev_insights_interest_body')}
            />
            {watchList.length === 0 ? (
              <EmptyState title={t('dev_insights_no_share_activity')}
                description={t('dev_insights_no_share_activity_body')} />
            ) : (
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_unit')}</Th>
                      <Th className="text-right">{t('dev_unit_price')}</Th>
                      <Th className="text-right">{t('dev_insights_link_opens')}</Th>
                      <Th className="text-right">{t('dev_insights_tour_opens')}</Th>
                      <Th>{t('dev_unit_status')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {watchList.map((row) => (
                      <tr key={row.unitId}>
                        <Td className="font-medium">{row.unit.unit_number}</Td>
                        <Td className="text-right">
                          <Money amount={row.unit.price} currency={row.unit.currency} />
                        </Td>
                        <Td className="text-right tabular">{row.views}</Td>
                        <Td className="text-right tabular">{row.tourOpens}</Td>
                        <Td><UnitStatusPill status={row.unit.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            {/* Passive viewing is a supporting signal, not intent (§94). */}
            <p className="border-t border-border px-4 py-2 text-2xs text-muted-foreground sm:px-5">
              {t('dev_insights_interest_caveat')}
            </p>
          </Panel>

          {/* ── Sources ──────────────────────────────────────────────── */}
          {can('crm') && bySource.length > 0 && (
            <Panel>
              <PanelHeader
                title={t('dev_insights_sources')}
                description={t('dev_insights_sources_body')}
              />
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_lead_source')}</Th>
                      <Th className="text-right">{t('dev_insights_leads')}</Th>
                      <Th className="text-right">{t('dev_insights_sold')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bySource.map(([source, counts]) => (
                      <tr key={source}>
                        <Td>{source}</Td>
                        <Td className="text-right tabular">{counts.total}</Td>
                        <Td className="text-right tabular">{counts.sold}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="border-t border-border px-4 py-2 text-2xs text-muted-foreground sm:px-5">
                {t('dev_insights_sources_caveat')}
              </p>
            </Panel>
          )}

          {/* ── Per project ──────────────────────────────────────────── */}
          {projects.length > 1 && (
            <Panel>
              <PanelHeader title={t('dev_insights_by_project')} />
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_project')}</Th>
                      <Th className="text-right">{t('dev_stat_available')}</Th>
                      <Th className="text-right">{t('dev_stat_reserved')}</Th>
                      <Th className="text-right">{t('dev_stat_sold')}</Th>
                      <Th className="text-right">{t('dev_insights_value_sold')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {projects.map((project) => {
                      const scoped = units.filter((u) => u.project_id === project.id);
                      const sales = ledger.filter((r) => r.project_id === project.id);
                      return (
                        <tr key={project.id}>
                          <Td className="font-medium">{project.name}</Td>
                          <Td className="text-right tabular">
                            {scoped.filter((u) => u.status === 'AVAILABLE').length}
                          </Td>
                          <Td className="text-right tabular">
                            {scoped.filter((u) => u.status === 'RESERVED').length}
                          </Td>
                          <Td className="text-right tabular">
                            {scoped.filter((u) => u.status === 'SOLD').length}
                          </Td>
                          <Td className="text-right">
                            <Money
                              amount={sales.reduce((s, r) => s + Number(r.sale_price), 0)}
                              currency={project.currency}
                            />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )}
        </div>
      )}
    </DeveloperShell>
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
