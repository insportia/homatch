import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowDown, ChevronDown, ChevronRight, Loader2, RefreshCw, Calculator } from 'lucide-react';
import {
  getCreditEconomics, getFinanceV2Execution, getFinanceV2PriceDrift, getFinanceV2Quote, getFinanceV2ServiceDetail, getFinanceV2Services,
  getFinanceV2SharedCosts, num,
} from '@/services/finance';
import type {
  CreditEconomics, FinanceV2Execution, FinanceV2ExecutionRow, FinanceV2PriceDrift, FinanceV2Quote, FinanceV2Service, FinanceV2ServiceDetail,
  FinanceV2SharedCosts,
} from '@/types/finance';
import { Empty, LoadError, Money, Pct, Pill, SectionTitle, StatCard, TableWrap, UnpricedBadge } from './FinanceKit';

/**
 * FINANCE V2 — ONE DASHBOARD PER SERVICE.
 *
 * Pick a service, see where its money went: CUSTOMER PAYMENT → VAT → NET →
 * POLICY ALLOCATION → COGS → PROFIT. Pick an execution, see every provider and
 * AI line behind it. Every figure comes from finance_v2_* (Postgres); this file
 * formats and never computes money. Unpriced cost is shown as unpriced, never $0.
 */

const RANGES = [7, 30, 90, 365] as const;

function rangeBounds(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function LiveState({ live }: { live: FinanceV2Service['live'] }) {
  const { t } = useLanguage();
  if (!live) return <Pill tone="muted">{t('fin_v2_live_na')}</Pill>;
  return live.frontend && live.backend
    ? <Pill tone="good">{t('fin_v2_live_on')}</Pill>
    : <Pill tone="warn">{t('fin_v2_live_off')}</Pill>;
}

function KindPill({ kind }: { kind: string }) {
  const { t } = useLanguage();
  const label: Record<string, string> = {
    FIXED: t('fin_v2_kind_fixed'), VARIABLE: t('fin_v2_kind_variable'), FREE: t('fin_v2_kind_free'),
    FEE_PERCENT: t('fin_v2_kind_fee'), SHARED: t('fin_v2_kind_shared'),
  };
  return <Pill tone={kind === 'FREE' || kind === 'SHARED' ? 'muted' : 'gold'}>{label[kind] ?? kind}</Pill>;
}

/** The money chain, top to bottom. A step the policy does not have says so instead of showing $0. */
function Chain({
  gross, vat, net, homatch, execution, cogs, unpriced, profit, unused,
}: {
  gross: number; vat: number; net: number; homatch: number | null; execution: number | null;
  cogs: number; unpriced: number; profit: number; unused: number | null;
}) {
  const { t } = useLanguage();
  const Step = ({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) => (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${tone ?? 'border-border/70 bg-card/60'}`}>
      <span className="min-w-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="ms-auto flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap text-sm font-semibold">{children}</span>
    </div>
  );
  const Arrow = () => <ArrowDown className="mx-auto h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />;
  return (
    <div className="space-y-1.5">
      <Step label={t('fin_v2_chain_payment')} tone="border-gold/40 bg-gold-soft/20"><Money value={gross} /></Step>
      <Arrow />
      <Step label={t('fin_v2_chain_vat')}><Money value={vat} /></Step>
      <Arrow />
      <Step label={t('fin_v2_chain_net')}><Money value={net} /></Step>
      <Arrow />
      {homatch === null && execution === null ? (
        <Step label={t('fin_v2_chain_allocation')}><span className="text-xs text-muted-foreground">{t('fin_v2_no_split')}</span></Step>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Step label={t('fin_v2_homatch_alloc')}><Money value={homatch} /></Step>
          <Step label={t('fin_v2_exec_alloc')}><Money value={execution} /></Step>
        </div>
      )}
      <Arrow />
      <Step label={t('fin_v2_chain_cogs')}>
        <Money value={cogs} frac={4} />{unpriced > 0 && <UnpricedBadge count={unpriced} />}
      </Step>
      <Arrow />
      <Step label={t('fin_v2_chain_profit')} tone={profit < 0 ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}>
        <Money value={profit} className={profit < 0 ? 'text-red-400' : 'text-emerald-400'} />
        {unpriced > 0 && <Pill tone="warn">{t('fin_v2_profit_incomplete')}</Pill>}
      </Step>
      {unused !== null && (
        <p className="pt-1 text-xs text-muted-foreground">
          {t('fin_v2_unused_exec')}: <Money value={unused} />
        </p>
      )}
    </div>
  );
}

function ExecutionDetail({ service, executionId }: { service: string; executionId: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<FinanceV2Execution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getFinanceV2Execution(service, executionId).then(setData).catch((e: Error) => setError(e.message));
  }, [service, executionId]);
  useEffect(load, [load]);

  const statusLabel: Record<string, string> = {
    ACTUAL: t('fin_v2_status_actual'), ESTIMATED: t('fin_v2_status_estimated'),
    PARTIALLY_PRICED: t('fin_v2_status_partial'), UNPRICED: t('fin_v2_status_unpriced'),
  };
  if (error) return <LoadError message={error} onRetry={load} />;
  if (!data) return <Loader2 className="mx-auto my-4 h-4 w-4 animate-spin text-muted-foreground" />;
  const c = data.chain;
  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-background/40 p-3">
      <Chain gross={c.grossUsd} vat={c.vatUsd} net={c.netUsd} homatch={c.homatchAllocationUsd} execution={c.executionAllocationUsd}
        cogs={c.cogsUsd} unpriced={c.unpricedLines} profit={c.profitUsd} unused={c.unusedExecutionUsd} />

      <div>
        <SectionTitle title={t('fin_v2_revenue_lines')} />
        {data.revenue.length === 0 ? <Empty message={t('fin_v2_no_charge')} /> : (
          <ul className="space-y-1.5">
            {data.revenue.map((r) => (
              <li key={r.line_id} className="rounded-md border border-border/50 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.product_code ?? r.source}</span>
                  <Money value={r.gross_usd} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span dir="ltr">{new Date(r.occurred_at).toLocaleString()}</span>
                  <span>{t('fin_v2_vat')}: <Money value={r.vat_usd} /></span>
                  <span>{t('fin_v2_policy')}: <code>{r.policy_id}</code></span>
                  {r.credits !== null && <span>{t('fin_v2_credits')}: {num(r.credits, 2)}</span>}
                  {r.profit_floor_shortfall && <Pill tone="bad">{t('fin_v2_floor_shortfall')}</Pill>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SectionTitle title={t('fin_v2_cost_lines')} hint={t('fin_v2_cost_lines_hint')} />
        {data.costs.length === 0 ? <Empty message={t('fin_v2_no_costs')} /> : (
          <TableWrap>
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-start text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t('fin_v2_provider')}</th>
                  <th className="py-1.5 text-start font-medium">{t('fin_v2_operation')}</th>
                  <th className="py-1.5 text-end font-medium">{t('fin_v2_units')}</th>
                  <th className="py-1.5 text-end font-medium">{t('fin_v2_unit_price')}</th>
                  <th className="py-1.5 text-end font-medium">{t('fin_v2_cost')}</th>
                  <th className="py-1.5 text-start font-medium">{t('fin_v2_status')}</th>
                  <th className="py-1.5 text-start font-medium">{t('fin_v2_time')}</th>
                </tr>
              </thead>
              <tbody>
                {data.costs.map((l) => (
                  <tr key={l.line_id} className="border-t border-border/40 align-top">
                    <td className="py-1.5">{l.provider ?? '—'}{l.model && <div className="text-muted-foreground">{l.model}</div>}</td>
                    <td className="py-1.5">{l.operation ?? '—'}<div className="text-muted-foreground"><bdi>{l.cost_source}</bdi></div></td>
                    <td className="py-1.5 text-end tabular-nums">
                      {l.units === null ? '—' : <bdi>{`${num(l.units, 0)} ${l.unit_label ?? ''}`}</bdi>}
                      {(l.input_tokens || l.output_tokens) ? (
                        <div className="text-muted-foreground" dir="auto">
                          {t('fin_v2_tokens', { input: num(l.input_tokens), cached: num(l.cached_tokens), output: num(l.output_tokens) })}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-end"><Money value={l.unit_price_usd} frac={6} /></td>
                    <td className="py-1.5 text-end"><Money value={l.cost_usd} frac={6} /></td>
                    <td className="py-1.5">
                      <Pill tone={l.cost_status === 'ACTUAL' ? 'good' : l.cost_status === 'UNPRICED' ? 'warn' : 'muted'}>{statusLabel[l.cost_status] ?? l.cost_status}</Pill>
                    </td>
                    <td className="py-1.5 text-muted-foreground" dir="ltr">{new Date(l.occurred_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

function Trend({ points }: { points: FinanceV2ServiceDetail['trend'] }) {
  const { t } = useLanguage();
  // Bar heights are presentation only: the scale of the largest day.
  const max = useMemo(() => Math.max(0, ...points.map((p) => Math.max(Number(p.grossUsd), Number(p.cogsUsd)))), [points]);
  if (points.length === 0) return <Empty message={t('fin_v2_no_activity')} />;
  return (
    <div>
      <div className="flex h-28 items-end gap-1 overflow-x-auto" dir="ltr">
        {points.map((p) => (
          <div key={p.day} className="flex h-full min-w-[10px] flex-1 items-end gap-px" title={`${p.day} · ${num(p.executions)}`}>
            <div className="w-1/2 rounded-t bg-gold/80" style={{ height: `${max > 0 ? (Number(p.grossUsd) / max) * 100 : 0}%` }} />
            <div className="w-1/2 rounded-t bg-red-400/70" style={{ height: `${max > 0 ? (Number(p.cogsUsd) / max) * 100 : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-gold/80" />{t('fin_v2_gross')}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400/70" />{t('fin_v2_cogs')}</span>
        <span dir="ltr">{points[0].day} → {points[points.length - 1].day}</span>
      </div>
    </div>
  );
}

function QuoteSimulator({ policy }: { policy: string }) {
  const { t } = useLanguage();
  const [gross, setGross] = useState('10');
  const [cost, setCost] = useState('0');
  const [quote, setQuote] = useState<FinanceV2Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQuote(null); setError(null); }, [policy]);

  const run = async () => {
    setBusy(true); setError(null);
    try { setQuote(await getFinanceV2Quote(policy, Number(gross), Number(cost))); }
    catch (e) { setError((e as Error).message); setQuote(null); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <SectionTitle title={t('fin_v2_sim_title')} hint={t('fin_v2_sim_hint')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs text-muted-foreground">
          {t('fin_v2_sim_gross')}
          <input type="number" min={0} step="0.01" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" dir="ltr" />
        </label>
        <label className="text-xs text-muted-foreground">
          {t('fin_v2_sim_cost')}
          <input type="number" min={0} step="0.0001" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" dir="ltr" />
        </label>
        <Button type="button" size="sm" onClick={run} disabled={busy} className="col-span-2 self-end sm:col-span-1">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          <span className="ms-1.5">{t('fin_v2_sim_run')}</span>
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{t('fin_v2_policy')}: <code>{policy}</code></p>
      {error && <div className="mt-3"><LoadError message={error} /></div>}
      {quote && (
        <div className="mt-3 space-y-2">
          <Chain gross={quote.grossUsd} vat={quote.vatUsd} net={quote.netUsd} homatch={quote.homatchAllocationUsd}
            execution={quote.executionAllocationUsd} cogs={quote.costUsd} unpriced={0} profit={quote.profitUsd} unused={null} />
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone="muted">{t('fin_v2_vat')} <Pct value={quote.vatBps} /></Pill>
            {quote.withinExecution !== null && (
              <Pill tone={quote.withinExecution ? 'good' : 'bad'}>
                {quote.withinExecution ? t('fin_v2_sim_within') : t('fin_v2_sim_over')}
              </Pill>
            )}
            {quote.chargeForCostCredits !== null && (
              <Pill tone="gold">{t('fin_v2_sim_charge')}: {num(quote.chargeForCostCredits, 2)} {t('fin_v2_credits')}</Pill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** V2.1: a profit figure is final only when every cost behind it is priced and covered. */
function CoverageNotice({ s }: { s: FinanceV2Service }) {
  const { t } = useLanguage();
  if (s.costComplete) return null;
  const gapLabel: Record<string, string> = {
    PARTIAL: t('fin_v21_gap_partial'), UNSUPPORTED: t('fin_v21_gap_unsupported'), UNPRICED_SOURCE: t('fin_v21_gap_unpriced_source'),
  };
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" role="status" data-cost-incomplete>
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-400">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{t('fin_v21_cost_incomplete')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t('fin_v21_cost_incomplete_hint')}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {s.unpricedLines > 0 && <li>• {t('fin_v2_unpriced')}: {num(s.unpricedLines)}</li>}
        {s.partialLines > 0 && <li>• {t('fin_v2_partial')}: {num(s.partialLines)}</li>}
        {s.coverageGaps.map((g) => (
          <li key={g.source} className="break-words">
            • <Pill tone="warn">{gapLabel[g.status] ?? g.status}</Pill> <bdi className="font-mono">{g.source}</bdi> — <span className="text-muted-foreground">{g.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServiceDashboard({ service, from, to }: { service: string; from: string; to: string }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<FinanceV2ServiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null); setDetail(null); setOpen(null);
    getFinanceV2ServiceDetail(service, from, to).then(setDetail).catch((e: Error) => setError(e.message));
  }, [service, from, to]);
  useEffect(load, [load]);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!detail) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />;
  const s = detail.summary;
  const unpricedNote = s.unpricedLines > 0 ? t('fin_v2_unpriced_note') : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{s.name}</h2>
        <KindPill kind={s.pricingKind} />
        <LiveState live={s.live} />
        {s.unpricedLines > 0 && <UnpricedBadge count={s.unpricedLines} />}
      </div>
      {s.priceNote && <p className="-mt-3 text-xs text-muted-foreground">{s.priceNote}</p>}
      <CoverageNotice s={s} />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label={t('fin_v2_gross')} value={<Money value={s.grossUsd} />} sub={t('fin_v2_gross_sub')} tone="gold" />
        <StatCard label={t('fin_v2_vat')} value={<Money value={s.vatUsd} />} />
        <StatCard label={t('fin_v2_net')} value={<Money value={s.netUsd} />} />
        <StatCard label={t('fin_v2_profit')} value={<Money value={s.profitUsd} />} tone={s.profitUsd < 0 ? 'bad' : 'good'}
          sub={<>{t('fin_v2_margin')}: <Pct value={s.marginBps} />{!s.costComplete && <> · <span className="text-amber-400">{t('fin_v21_not_final')}</span></>}</>} />
        <StatCard label={t('fin_v2_homatch_alloc')} value={<Money value={s.homatchAllocationUsd} />}
          unavailable={s.homatchAllocationUsd === null} unavailableLabel={t('fin_v2_no_split')} />
        <StatCard label={t('fin_v2_exec_alloc')} value={<Money value={s.executionAllocationUsd} />}
          unavailable={s.executionAllocationUsd === null} unavailableLabel={t('fin_v2_no_split')} />
        <StatCard label={t('fin_v2_cogs')} value={<Money value={s.cogsUsd} frac={4} />}
          sub={<>AI <Money value={s.aiCogsUsd} frac={4} /> · {t('fin_v2_tools')} <Money value={s.providerCogsUsd} frac={4} /></>} />
        <StatCard label={t('fin_v2_cogs_status')} value={<Money value={s.actualCogsUsd} frac={4} />}
          sub={<>{t('fin_v2_estimated')} <Money value={s.estimatedCogsUsd} frac={4} /> · {num(s.costLines)} {t('fin_v2_lines')}</>} />
        <StatCard label={t('fin_v2_executions')} value={num(s.executions)} sub={`${num(s.charges)} ${t('fin_v2_charges')}`} />
        <StatCard label={t('fin_v2_avg_cost')} value={<Money value={s.avgCostPerExecutionUsd} frac={4} />}
          sub={unpricedNote} unavailable={s.avgCostPerExecutionUsd === null} unavailableLabel={t('fin_na')} />
        <StatCard label={t('fin_v2_unused')} value={<Money value={s.unusedBudgetUsd} />} sub={t('fin_v2_unused_sub')}
          unavailable={s.executionAllocationUsd === null} unavailableLabel={t('fin_v2_no_split')} />
        <StatCard label={t('fin_v2_refunds')} value={<Money value={s.refundsUsd} />} />
        <StatCard label={t('fin_v2_unpriced')} value={num(s.unpricedLines)} tone={s.unpricedLines > 0 ? 'bad' : 'neutral'}
          sub={s.partialLines > 0 ? `${num(s.partialLines)} ${t('fin_v2_partial')}` : undefined} />
        <StatCard label={t('fin_v2_floor')} value={num(s.profitFloorShortfalls)} tone={s.profitFloorShortfalls > 0 ? 'bad' : 'neutral'}
          sub={s.taxUnknownLines > 0 ? `${num(s.taxUnknownLines)} ${t('fin_v2_tax_unknown')}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <SectionTitle title={t('fin_v2_chain_title')} hint={t('fin_v2_chain_hint')} />
          <Chain gross={s.grossUsd} vat={s.vatUsd} net={s.netUsd} homatch={s.homatchAllocationUsd} execution={s.executionAllocationUsd}
            cogs={s.cogsUsd} unpriced={s.unpricedLines} profit={s.profitUsd} unused={s.executionAllocationUsd === null ? null : s.unusedBudgetUsd} />
          {detail.policy && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              <code>{detail.policy.policy_id}</code> · {detail.policy.description}
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-card/60 p-4">
            <SectionTitle title={t('fin_v2_trend')} />
            <Trend points={detail.trend} />
          </div>
          <QuoteSimulator policy={s.policy} />
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/60 p-4">
        <SectionTitle title={t('fin_v2_providers')} hint={t('fin_v2_providers_hint')} />
        {detail.providers.length === 0 ? <Empty message={t('fin_v2_no_costs')} /> : (
          <ul className="divide-y divide-border/40">
            {detail.providers.map((p) => (
              <li key={`${p.provider}|${p.model}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.provider ?? '—'}</span>
                  {p.model && <span className="ms-1.5 text-xs text-muted-foreground">{p.model}</span>}
                  <span className="ms-1.5 text-xs text-muted-foreground">· {num(p.lines)} {t('fin_v2_lines')}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  {p.unpriced > 0 && <UnpricedBadge count={p.unpriced} />}
                  <Money value={p.costUsd} frac={4} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/60 p-4">
        <SectionTitle title={t('fin_v2_executions_title')} hint={t('fin_v2_executions_hint')} />
        {detail.executions.length === 0 ? <Empty message={t('fin_v2_no_activity')} /> : (
          <ul className="space-y-1.5">
            {detail.executions.map((e: FinanceV2ExecutionRow) => {
              const isOpen = open === e.executionId;
              return (
                <li key={e.executionId} className="rounded-lg border border-border/50">
                  <button type="button" onClick={() => setOpen(isOpen ? null : e.executionId)} aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 text-start text-xs">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" />}
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block truncate font-mono"><bdi>{e.executionId}</bdi></span>
                      <span className="text-muted-foreground"><bdi>{new Date(e.at).toLocaleString()}</bdi></span>
                    </span>
                    <span className="grid w-full grid-cols-3 gap-2 text-end sm:w-auto sm:shrink-0 sm:gap-3 [&>span]:min-w-0">
                      <span><span className="block text-muted-foreground">{t('fin_v2_gross')}</span><Money value={e.grossUsd} /></span>
                      <span><span className="block text-muted-foreground">{t('fin_v2_cogs')}</span><Money value={e.cogsUsd} frac={4} /></span>
                      <span>
                        <span className="block text-muted-foreground">{t('fin_v2_profit')}</span>
                        <Money value={e.profitUsd} className={e.profitUsd < 0 ? 'text-red-400' : ''} />
                        {e.unpricedLines > 0 && <span className="block text-amber-400">{t('fin_unpriced')} · {num(e.unpricedLines)}</span>}
                      </span>
                    </span>
                  </button>
                  {isOpen && <div className="px-2 pb-2"><ExecutionDetail service={service} executionId={e.executionId} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ServiceCard({ s, active, onSelect }: { s: FinanceV2Service; active: boolean; onSelect: () => void }) {
  const { t } = useLanguage();
  return (
    <button type="button" onClick={onSelect} aria-pressed={active}
      className={`w-full rounded-xl border p-3 text-start transition-colors ${
        active ? 'border-gold/60 bg-gold-soft/20' : 'border-border/70 bg-card/60 hover:border-gold/30'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight">{s.name}</span>
        <LiveState live={s.live} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted-foreground">{t('fin_v2_gross')}</span>
        <Money value={s.grossUsd} className="text-end" />
        <span className="text-muted-foreground">{t('fin_v2_cogs')}</span>
        <Money value={s.cogsUsd} frac={4} className="text-end" />
        <span className="text-muted-foreground">{t('fin_v2_profit')}</span>
        <Money value={s.profitUsd} className={`text-end ${s.profitUsd < 0 ? 'text-red-400' : 'text-emerald-400'}`} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <KindPill kind={s.pricingKind} />
        {s.unpricedLines > 0 && <UnpricedBadge count={s.unpricedLines} />}
        {s.profitFloorShortfalls > 0 && <Pill tone="bad">{t('fin_v2_floor_shortfall')}</Pill>}
        {!s.costComplete && <Pill tone="warn">{t('fin_v21_cost_incomplete_short')}</Pill>}
      </div>
    </button>
  );
}

/** Shared infrastructure: shown beside the services, never allocated to one. */
function SharedCostsPanel({ from, to }: { from: string; to: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<FinanceV2SharedCosts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setData(null); setError(null); getFinanceV2SharedCosts(from, to).then(setData).catch((e: Error) => setError(e.message)); }, [from, to]);
  if (error) return <LoadError message={error} />;
  if (!data) return null;
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4" data-shared-costs>
      <SectionTitle title={t('fin_v21_shared_infra_title')} hint={t('fin_v21_shared_infra_hint')} />
      {data.lines.length === 0 ? <Empty message={t('fin_v2_no_costs')} /> : (
        <ul className="divide-y divide-border/40">
          {data.lines.map((l) => (
            <li key={`${l.source}|${l.vendor}|${l.item}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium">{l.vendor}</span> <span className="text-xs text-muted-foreground"><bdi>{l.item}</bdi></span></span>
              <span className="inline-flex items-center gap-2">
                {l.status === 'NOT_CONFIGURED'
                  ? <Pill tone="warn">{t('fin_not_configured')}</Pill>
                  : <><Money value={l.periodUsd} frac={2} /><span className="text-xs text-muted-foreground">(<Money value={l.monthlyUsd} frac={2} />/{t('fin_v21_month')})</span></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!data.complete && <p className="mt-2 text-xs text-amber-400">{t('fin_v21_shared_incomplete')}</p>}
    </div>
  );
}

/** Copies of a price outside provider_price_book, compared with the book live. */
function PriceDriftPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<FinanceV2PriceDrift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getFinanceV2PriceDrift().then((r) => setRows(r ?? [])).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <LoadError message={error} />;
  if (!rows || rows.length === 0) return null;
  const drift = rows.filter((r) => r.status !== 'MATCH');
  return (
    <div className={`rounded-xl border p-4 ${drift.length ? 'border-red-500/40 bg-red-500/5' : 'border-border/70 bg-card/60'}`} data-price-drift>
      <SectionTitle title={t('fin_v21_price_drift_title')} hint={t('fin_v21_price_drift_hint')} />
      <ul className="space-y-1 text-xs">
        {rows.map((r) => (
          <li key={`${r.registry}|${r.unit}`} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words"><bdi className="font-mono">{r.registry}</bdi> · <bdi>{r.model}</bdi> · {r.unit}</span>
            <Pill tone={r.status === 'MATCH' ? 'good' : 'bad'}>{r.status === 'MATCH' ? t('fin_v21_drift_match') : r.status === 'DRIFT' ? t('fin_v21_drift_drift') : t('fin_v21_drift_not_in_book')}</Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FinanceServicesTab() {
  const { t } = useLanguage();
  const [days, setDays] = useState<number>(30);
  const [bounds, setBounds] = useState(() => rangeBounds(30));
  const [services, setServices] = useState<FinanceV2Service[] | null>(null);
  const [credits, setCredits] = useState<CreditEconomics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback((d: number) => {
    const b = rangeBounds(d);
    setBounds(b); setError(null); setServices(null);
    getFinanceV2Services(b.from, b.to)
      .then((rows) => {
        setServices(rows ?? []);
        setSelected((cur) => cur ?? rows?.[0]?.service ?? null);
      })
      .catch((e: Error) => setError(e.message));
    getCreditEconomics().then(setCredits).catch(() => setCredits(null));
  }, []);
  useEffect(() => { load(days); }, [load, days]);

  const customer = (services ?? []).filter((s) => s.pricingKind !== 'SHARED');
  const shared = (services ?? []).filter((s) => s.pricingKind === 'SHARED');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border/70 p-0.5" role="group" aria-label={t('fin_v2_range')}>
          {RANGES.map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
              className={`rounded-md px-2.5 py-1 text-xs ${days === d ? 'bg-gold-soft/40 text-gold-ink' : 'text-muted-foreground'}`}>
              {t('fin_v2_days', { n: d })}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => load(days)}>
          <RefreshCw className="h-3.5 w-3.5" /><span className="ms-1.5">{t('fin_retry')}</span>
        </Button>
      </div>

      {credits && (
        <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          {t('fin_v2_cash_note')} <Money value={credits.cash_collected_usd} className="font-semibold text-foreground" />
        </p>
      )}

      {error && <LoadError message={error} onRetry={() => load(days)} />}
      {!error && !services && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />}

      {services && (
        <>
          <div>
            <SectionTitle title={t('fin_v2_select_service')} hint={t('fin_v2_select_hint')} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {customer.map((s) => (
                <ServiceCard key={s.service} s={s} active={selected === s.service} onSelect={() => setSelected(s.service)} />
              ))}
            </div>
          </div>
          {shared.length > 0 && (
            <div>
              <SectionTitle title={t('fin_v2_shared_title')} hint={t('fin_v2_shared_hint')} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {shared.map((s) => (
                  <ServiceCard key={s.service} s={s} active={selected === s.service} onSelect={() => setSelected(s.service)} />
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <SharedCostsPanel from={bounds.from} to={bounds.to} />
            <PriceDriftPanel />
          </div>
          {selected && <ServiceDashboard key={`${selected}|${bounds.from}`} service={selected} from={bounds.from} to={bounds.to} />}
        </>
      )}
    </div>
  );
}
