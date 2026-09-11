import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Activity, AlertTriangle, Banknote, CircleDollarSign, Flame, Loader2, RefreshCw, Server, ShieldCheck, Target, Wallet } from 'lucide-react';
import {
  getFinanceSummary, getBudgetStatus, getAlerts, evaluateAlerts, acknowledgeAlert,
  getMonthlySummary, getMarginMonitor, usd, num,
} from '@/services/finance';
import type {
  FinanceSummary, BudgetRow, AlertRow, MonthRow, MarginMonitor,
} from '@/types/finance';
import {
  StatCard, Money, Pct, Pill, SectionTitle, TableWrap, Empty, ShareBar,
} from '@/components/admin/finance/FinanceKit';
import { FinanceProvidersTab } from '@/components/admin/finance/FinanceProvidersTab';
import { FinanceConnectionsTab } from '@/components/admin/finance/FinanceConnectionsTab';
import { FinanceProductsTab } from '@/components/admin/finance/FinanceProductsTab';
import {
  FinanceSubscriptionsTab, FinanceCreditsTab, FinanceUsersTab,
} from '@/components/admin/finance/FinanceMoneyTabs';
import {
  FinanceLiveSpendTab, FinanceFixedCostsTab, FinancePriceBookTab,
} from '@/components/admin/finance/FinanceMoreTabs';
import { FinanceEventsTab } from '@/components/admin/finance/FinanceEventsTab';

/**
 * HOMATCH FINANCIAL COMMAND CENTER — /admin/finance
 *
 * Admin only, and that is enforced in the DATABASE: every finance_* RPC calls
 * finance_require_admin() before returning a row. This page being behind
 * AdminLayout is convenience; the route guard is not the control.
 *
 * Nothing on this screen may ever appear on a customer surface. It carries
 * landed COGS, provider unit economics, margin and provider capability.
 *
 * Three display rules run through the whole thing:
 *   · A number we do not know is never drawn as zero.
 *   · Revenue with no configured payment provider reads NOT CONFIGURED.
 *   · Unpriced usage is shown as unpriced, with its measured quantity.
 */
export default function AdminFinancePage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('overview');

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [margin, setMargin] = useState<MarginMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, a, m, mm] = await Promise.all([
        getFinanceSummary(), getBudgetStatus(), getAlerts(),
        getMonthlySummary(12), getMarginMonitor(30),
      ]);
      setSummary(s); setBudgets(b ?? []); setAlerts(a ?? []);
      setMonths(m ?? []); setMargin(mm);
      setDenied(false);
    } catch (err) {
      // The server refusing a non-admin is correct behaviour, not a failure
      // to paper over. Say so plainly instead of rendering an empty dashboard
      // that looks like a company with no costs.
      const msg = err instanceof Error ? err.message : String(err);
      if (/FORBIDDEN/i.test(msg)) setDenied(true);
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshAlerts = async () => {
    setRefreshing(true);
    try {
      const res = await evaluateAlerts();
      setAlerts((await getAlerts()) ?? []);
      toast.success(t('fin_alerts_evaluated').replace('{n}', String(res?.raised ?? 0)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const ack = async (id: string) => {
    try {
      await acknowledgeAlert(id);
      setAlerts((await getAlerts()) ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (denied) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold">{t('fin_forbidden_title')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('fin_forbidden_body')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const openCritical = alerts.filter(a => a.severity === 'CRITICAL' && !a.resolved_at).length;
  const s = summary;

  return (
    <div className="space-y-5 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('fin_title')}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('fin_subtitle')
              .replace('{tz}', s?.timezone ?? 'UTC')
              .replace('{cur}', s?.currency ?? 'USD')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {openCritical > 0 && (
            <Pill tone="bad">
              <AlertTriangle className="h-3 w-3" />
              {t('fin_n_critical').replace('{n}', String(openCritical))}
            </Pill>
          )}
          <Button variant="outline" size="sm" onClick={load} className="h-8">
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {t('fin_refresh')}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview" className="text-xs">{t('fin_tab_overview')}</TabsTrigger>
          <TabsTrigger value="live" className="text-xs">{t('fin_tab_live')}</TabsTrigger>
          <TabsTrigger value="providers" className="text-xs">{t('fin_tab_providers')}</TabsTrigger>
          <TabsTrigger value="connections" className="text-xs">{t('fin_tab_connections')}</TabsTrigger>
          <TabsTrigger value="products" className="text-xs">{t('fin_tab_products')}</TabsTrigger>
          <TabsTrigger value="users" className="text-xs">{t('fin_tab_users')}</TabsTrigger>
          <TabsTrigger value="credits" className="text-xs">{t('fin_tab_credits')}</TabsTrigger>
          <TabsTrigger value="subscriptions" className="text-xs">{t('fin_tab_subscriptions')}</TabsTrigger>
          <TabsTrigger value="fixed" className="text-xs">{t('fin_tab_fixed')}</TabsTrigger>
          <TabsTrigger value="budgets" className="text-xs">{t('fin_tab_budgets')}</TabsTrigger>
          <TabsTrigger value="pricebook" className="text-xs">{t('fin_tab_pricebook')}</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs">
            {t('fin_tab_alerts')}
            {alerts.length > 0 && <span className="ms-1 text-muted-foreground">({alerts.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs">{t('fin_tab_events')}</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ─────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={Flame}
              label={t('fin_spend_today')}
              value={usd(s?.spend_today)}
              sub={t('fin_spend_mtd_sub').replace('{v}', usd(s?.spend_mtd))}
            />
            <StatCard
              icon={Banknote}
              label={t('fin_revenue_mtd')}
              value={usd(s?.revenue_mtd)}
              // §53: a missing payment credential must never be drawn as $0
              // revenue. That is an invented fact about the business.
              unavailable={!s?.revenue_data_available}
              unavailableNote={t('fin_revenue_unavailable')}
            />
            <StatCard
              icon={CircleDollarSign}
              label={t('fin_gross_profit_mtd')}
              value={usd(s?.gross_profit_mtd)}
              tone={Number(s?.gross_profit_mtd ?? 0) < 0 ? 'bad' : 'good'}
              sub={<>{t('fin_margin')}: <Pct value={s?.gross_margin_bps ?? null} /></>}
            />
            <StatCard
              icon={Activity}
              label={t('fin_burn_projected')}
              value={usd(s?.burn_projected_month_end)}
              sub={t('fin_burn_daily').replace('{v}', usd(s?.burn_daily_avg))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('fin_variable_cogs')} value={usd(s?.variable_cogs_mtd)} />
            <StatCard label={t('fin_fixed_monthly')} value={usd(s?.fixed_monthly)} />
            <StatCard label={t('fin_total_spend')} value={usd(s?.total_company_spend_mtd)} />
            <StatCard
              label={t('fin_operating_contribution')}
              value={usd(s?.operating_contribution_mtd)}
              tone={Number(s?.operating_contribution_mtd ?? 0) < 0 ? 'bad' : 'good'}
            />
          </div>

          {/* Unpriced usage gets its own statement, not a footnote. */}
          {Number(s?.unpriced_events ?? 0) > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t('fin_unpriced_banner')
                      .replace('{n}', num(s?.unpriced_events))
                      .replace('{q}', num(s?.unpriced_quantity))}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('fin_unpriced_help')}</p>
                </div>
                <Button variant="outline" size="sm" className="h-8"
                        onClick={() => setTab('events')}>
                  {t('fin_view_unpriced')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Margin floor */}
          {margin && margin.by_product.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Target className="h-4 w-4" />
                  {t('fin_margin_monitor')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SectionTitle
                  title=""
                  hint={t('fin_margin_floor_hint').replace('{v}', (margin.floor_bps / 100).toFixed(0))}
                />
                <TableWrap>
                  <table className="w-full min-w-[34rem] border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                        <th className="py-2 text-end font-medium">{t('fin_col_executions')}</th>
                        <th className="py-2 text-end font-medium">{t('fin_col_revenue')}</th>
                        <th className="py-2 text-end font-medium">{t('fin_col_cogs')}</th>
                        <th className="py-2 text-end font-medium">{t('fin_col_margin')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {margin.by_product.map(p => (
                        <tr key={p.product_code} className="border-b border-border/50">
                          <td className="py-2 font-medium">
                            {p.product_code}
                            {p.below_floor && (
                              <Pill tone="bad" title={t('fin_below_floor')}>
                                {t('fin_below_floor')}
                              </Pill>
                            )}
                          </td>
                          <td className="py-2 text-end tabular-nums">{num(p.charged_executions)}</td>
                          <td className="py-2 text-end"><Money value={p.revenue_usd} /></td>
                          <td className="py-2 text-end"><Money value={p.cogs_usd} /></td>
                          <td className="py-2 text-end"><Pct value={p.margin_bps} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </CardContent>
            </Card>
          )}

          {/* Month by month */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('fin_monthly')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrap>
                <table className="w-full min-w-[42rem] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t('fin_col_month')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_variable')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_fixed')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_total_spend')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_revenue')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_contribution')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_unpriced')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.filter(m => m.cost_events > 0 || m.revenue_usd > 0 || m.is_current).map(m => (
                      <tr key={m.month} className="border-b border-border/50">
                        <td className="py-2 font-medium">
                          {m.month}
                          {m.is_current && (
                            <span className="ms-2 text-[12px] text-muted-foreground">
                              {t('fin_current_partial')}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-end"><Money value={m.variable_cogs_usd} /></td>
                        <td className="py-2 text-end"><Money value={m.fixed_costs_usd} /></td>
                        <td className="py-2 text-end"><Money value={m.total_spend_usd} /></td>
                        <td className="py-2 text-end"><Money value={m.revenue_usd} /></td>
                        <td className={`py-2 text-end ${m.operating_contribution_usd < 0 ? 'text-red-400' : ''}`}>
                          <Money value={m.operating_contribution_usd} />
                        </td>
                        <td className="py-2 text-end tabular-nums text-muted-foreground">
                          {m.unpriced_events > 0 ? num(m.unpriced_events) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <FinanceProvidersTab />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <FinanceConnectionsTab />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <FinanceProductsTab />
        </TabsContent>
        <TabsContent value="live" className="mt-4">
          <FinanceLiveSpendTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <FinanceUsersTab />
        </TabsContent>
        <TabsContent value="credits" className="mt-4">
          <FinanceCreditsTab />
        </TabsContent>
        <TabsContent value="subscriptions" className="mt-4">
          <FinanceSubscriptionsTab />
        </TabsContent>
        <TabsContent value="fixed" className="mt-4">
          <FinanceFixedCostsTab />
        </TabsContent>
        <TabsContent value="pricebook" className="mt-4">
          <FinancePriceBookTab />
        </TabsContent>

        {/* ── BUDGETS ──────────────────────────────────────── */}
        <TabsContent value="budgets" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Wallet className="h-4 w-4" /> {t('fin_budgets')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {budgets.length === 0 && <Empty message={t('fin_no_budgets')} />}
              {budgets.map(b => (
                <div key={b.code} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{b.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.scope}{b.scope_value ? ` · ${b.scope_value}` : ''} · {b.period}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={
                        b.state === 'OVER' ? 'bad' : b.state === 'WARN' ? 'warn'
                        : b.state === 'UNSET' ? 'muted' : 'good'
                      }>
                        {t(`fin_budget_state_${b.state.toLowerCase()}`)}
                      </Pill>
                      {b.hard_stop && <Pill tone="muted">{t('fin_hard_stop')}</Pill>}
                    </div>
                  </div>
                  <div className="mt-2">
                    <ShareBar bpsValue={b.used_bps ?? 0} tone={b.state === 'OVER' ? 'primary' : 'gold'} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      <Money value={b.spent_usd} /> / <Money value={b.budget_usd} />
                    </span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">
                      {b.used_bps === null ? '—' : `${(b.used_bps / 100).toFixed(1)}%`}
                    </span>
                  </div>
                  {/* The finance budget and the gate that actually stops
                      spending are two different records. When they disagree,
                      say which one is real rather than letting the duplication
                      hide. */}
                  {b.drifts_from_enforcement && (
                    <p className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {t('fin_budget_drift')
                        .replace('{key}', b.enforcement_setting_key ?? '')
                        .replace('{v}', usd(b.enforcement_usd))}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ALERTS ───────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-8" onClick={refreshAlerts} disabled={refreshing}>
              {refreshing ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                          : <RefreshCw className="me-1.5 h-3.5 w-3.5" />}
              {t('fin_evaluate_now')}
            </Button>
          </div>
          {alerts.length === 0 && <Empty message={t('fin_no_alerts')} />}
          {alerts.map(a => (
            <Card key={a.id} className={
              a.severity === 'CRITICAL' ? 'border-red-500/30 bg-red-500/5'
              : 'border-amber-500/25 bg-amber-500/5'
            }>
              <CardContent className="flex flex-wrap items-start gap-3 p-4">
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${
                  a.severity === 'CRITICAL' ? 'text-red-400' : 'text-amber-400'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.title}</p>
                  {a.detail && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
                  <p className="mt-1 text-[12px] text-muted-foreground/70">
                    {a.kind} · {t('fin_seen_n').replace('{n}', String(a.occurrences))}
                  </p>
                </div>
                {!a.acknowledged_at && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => ack(a.id)}>
                    {t('fin_acknowledge')}
                  </Button>
                )}
                {a.acknowledged_at && <Pill tone="muted">{t('fin_acknowledged')}</Pill>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <FinanceEventsTab />
        </TabsContent>
      </Tabs>

      {/* A standing reminder of what this screen is. */}
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
        <Server className="h-3 w-3" />
        {t('fin_admin_only_note')}
      </p>
    </div>
  );
}
