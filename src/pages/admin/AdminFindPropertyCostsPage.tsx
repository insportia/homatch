import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, Download, Gauge, Loader2, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getFindPropertyCosts, getFindPropertySearchCost, usd, num,
  type FpCompleteness, type FpCosts, type FpSearchCost, type FpSearchRow,
} from '@/services/finance';
import { Empty, LoadError, Money, Pill, SectionTitle, StatCard, TableWrap } from '@/components/admin/finance/FinanceKit';

/**
 * FIND PROPERTY — WHAT IT COSTS HOMATCH — /admin/finance/find-property
 *
 * Find Property is free for customers; this page is HOMATCH's own operating cost, admin only
 * (finance_require_admin in every RPC). Figures come from the ledger (cost_events through
 * finance_fp_ai_events) and the worker runs; nothing is computed here but formatting.
 *
 *   Estimated  measured usage (tokens) × the price book's published rate
 *   Partial    usage known only as a total (range shown, never a single figure)
 *   Unknown    a cost that should exist and has no record
 *   Verified   a provider-reported amount (none for Find Property today)
 *
 * A total is never drawn as a bare $0 when it is incomplete.
 */
const RANGES = [7, 30, 90] as const;
const STATE_TONE: Record<FpCompleteness, string> = { VERIFIED: 'good', ESTIMATED: 'gold', PARTIAL: 'warn', UNKNOWN: 'bad' };
const WORKER_NAMES: Record<string, string> = {
  'myhome-agent': 'MyHome', 'ssge-agent': 'SS.ge', 'homege-agent': 'Home.ge', 'placege-agent': 'Place.ge', 'allhome-agent': 'Allhome', 'brokeri-agent': 'Brokeri',
};
const workerName = (w: string) => WORKER_NAMES[w] ?? w;

function StateBadge({ state }: { state: FpCompleteness }) {
  const { t } = useLanguage();
  return <Pill tone={STATE_TONE[state]}>{t(`fpcost_state_${state.toLowerCase()}`)}</Pill>;
}

/** One cost cell: a range when the record allows only a range, never a lone $0 for something unknown. */
function CostCell({ usdValue, upper, state }: { usdValue: number; upper?: number | null; state: FpCompleteness }) {
  const { t } = useLanguage();
  if (state === 'UNKNOWN') return <span className="text-red-400">{t('fin_unknown')}</span>;
  if (state === 'PARTIAL' && upper !== null && upper !== undefined && Number(upper) > Number(usdValue)) {
    return <span className="tabular-nums" dir="ltr">{usd(usdValue)} – {usd(upper)}</span>;
  }
  return <Money value={usdValue} />;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminFindPropertyCostsPage() {
  const { t } = useLanguage();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<FpCosts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ provider: '', status: '', id: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FpSearchCost | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
      setData(await getFindPropertyCosts(from.toISOString(), to.toISOString()));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!openId) { setDetail(null); setDetailError(null); return; }
    let alive = true;
    getFindPropertySearchCost(openId).then((d) => { if (alive) setDetail(d); }).catch((e) => { if (alive) setDetailError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [openId]);

  const rows = useMemo(() => (data?.searches ?? []).filter((r) =>
    (!filters.provider || r.workers.includes(filters.provider))
    && (!filters.status || r.status === filters.status)
    && (!filters.id || r.id.startsWith(filters.id.trim().toLowerCase()))), [data, filters]);
  const statuses = useMemo(() => [...new Set((data?.searches ?? []).map((r) => r.status))].sort(), [data]);
  const workers = useMemo(() => [...new Set((data?.searches ?? []).flatMap((r) => r.workers))].sort(), [data]);

  const exportCsv = () => {
    const head = ['created_at', 'search_id', 'status', 'properties', 'providers', 'ai_usd', 'ai_upper_usd', 'provider_usd', 'other_usd', 'total_usd', 'completeness'];
    const body = rows.map((r: FpSearchRow) => [r.created_at, r.id, r.status, r.properties, r.workers.map(workerName).join(' '), r.ai_usd, r.ai_upper_usd, r.provider_usd, r.other_usd ?? 'not_recorded', r.total_usd, r.completeness]);
    const blob = new Blob([[head, ...body].map((line) => line.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `find-property-costs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading && !data) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{t('fpcost_loading')}</div>;
  if (error && !data) return <LoadError message={error} onRetry={() => void load()} />;
  if (!data) return null;
  const s = data.summary, infra = data.infrastructure;
  const partialMonth = Number(s.month_upper_usd) > Number(s.month_usd);
  const chart = data.daily.map((d) => ({ ...d, day: d.day.slice(5), ai_usd: Number(d.ai_usd), ai_upper_usd: Number(d.ai_upper_usd) }));

  return (
    <div className="space-y-6" data-fp-costs>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/finance" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('admin_nav_finance')}</Link>
          <h1 className="font-display text-2xl font-semibold">{t('fpcost_title')}</h1>
          <p className="max-w-[75ch] text-sm text-muted-foreground">{t('fpcost_subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('fpcost_range')} className="inline-flex rounded-xl border border-border p-1">
            {RANGES.map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`min-h-[36px] rounded-lg px-3 text-sm ${days === d ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground'}`}>{t('fpcost_days', { n: d })}</button>)}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />{t('fpcost_refresh')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" aria-hidden="true" />{t('fpcost_csv')}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" data-fp-summary>
        <StatCard label={t('fpcost_today')} value={<Money value={s.today_usd} />} />
        <StatCard label={t('fpcost_yesterday')} value={<Money value={s.yesterday_usd} />} />
        <StatCard label={t('fpcost_last7')} value={<Money value={s.last7_usd} />} />
        <StatCard label={t('fpcost_month')} value={partialMonth ? <span className="tabular-nums" dir="ltr">{usd(s.month_usd)} – {usd(s.month_upper_usd)}</span> : <Money value={s.month_usd} />}
          sub={partialMonth ? t('fpcost_month_partial') : undefined} tone="gold" />
        <StatCard label={t('fpcost_run_rate')} value={<Money value={s.run_rate_month_usd} />} icon={TrendingUp} />
        <StatCard label={t('fpcost_searches')} value={<span className="tabular-nums">{num(s.searches)}</span>} sub={t('fpcost_properties_n', { n: num(s.properties) })} />
        <StatCard label={t('fpcost_avg_search')} value={<Money value={s.avg_per_search_usd} />} />
        <StatCard label={t('fpcost_avg_property')} value={<Money value={s.avg_per_property_usd} />} />
        <StatCard label={t('fpcost_most_expensive')} value={s.most_expensive ? <Money value={s.most_expensive.usd} /> : <span className="text-muted-foreground">{t('fin_na')}</span>}
          sub={s.most_expensive ? <button type="button" className="font-mono text-xs underline-offset-2 hover:underline" onClick={() => setOpenId(s.most_expensive!.id)}>{s.most_expensive.id.slice(0, 8)}</button> : undefined} />
        <StatCard label={t('fpcost_infra')} value={infra.allocated_per_search_usd !== null ? <Money value={infra.allocated_per_search_usd} /> : <span className="text-red-400">{t('fin_unknown')}</span>}
          sub={infra.status === 'UNKNOWN' ? t('fpcost_infra_unknown') : t('fpcost_infra_per_search')} icon={Gauge} />
      </div>

      <Card><CardContent className="space-y-2 p-4 text-sm" data-fp-basis>
        <p>{t('fpcost_basis_ai')}</p>
        <p>{t('fpcost_basis_workers')}</p>
        <p>{infra.status === 'UNKNOWN' ? t('fpcost_basis_infra_unknown', { usd: usd(infra.monthly_fixed_usd) }) : t('fpcost_basis_infra', { usd: usd(infra.monthly_fixed_usd), share: Math.round(Number(infra.share) * 100) })}</p>
        {s.unlinked_brief_calls ? <p className="text-amber-400">{t('fpcost_unlinked', { n: s.unlinked_brief_calls, from: usd(s.unlinked_brief_usd), to: usd(s.unlinked_brief_upper_usd) })}</p> : null}
      </CardContent></Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">{t('fpcost_chart_trend')}</CardTitle></CardHeader><CardContent className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => usd(v, 4)} width={80} />
              <Tooltip formatter={(v: number) => usd(v)} />
              <Area type="monotone" dataKey="ai_upper_usd" name={t('fpcost_upper')} fill="hsl(var(--gold) / 0.12)" stroke="none" />
              <Line type="monotone" dataKey="ai_usd" name={t('fpcost_ai')} stroke="hsl(var(--gold))" strokeWidth={2} dot={false} />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">{t('fpcost_chart_volume')}</CardTitle></CardHeader><CardContent className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis yAxisId="usd" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => usd(v, 4)} width={80} />
              <Tooltip formatter={(v: number, name: string) => (name === t('fpcost_searches') ? v : usd(v))} />
              <Bar yAxisId="n" dataKey="searches" name={t('fpcost_searches')} fill="hsl(var(--muted-foreground) / 0.45)" />
              <Line yAxisId="usd" type="monotone" dataKey="ai_usd" name={t('fpcost_ai')} stroke="hsl(var(--gold))" strokeWidth={2} dot={false} />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-base">{t('fpcost_by_provider')}</CardTitle></CardHeader><CardContent>
          <TableWrap>
            <table className="w-full text-sm" data-fp-providers>
              <thead><tr className="text-start text-xs text-muted-foreground"><th className="py-2 text-start">{t('fpcost_provider')}</th><th className="text-end">{t('fpcost_runs')}</th><th className="text-end">{t('fpcost_requests')}</th><th className="text-end">{t('fpcost_listings')}</th><th className="text-end">{t('fpcost_direct')}</th><th className="text-start ps-3">{t('fpcost_billing')}</th></tr></thead>
              <tbody>
                <tr className="border-t border-border/60"><td className="py-2 font-medium">OpenAI (gpt-4o-mini)</td><td className="text-end tabular-nums">{num(data.searches.reduce((n, r) => n + r.ai_calls, 0))}</td><td className="text-end">—</td><td className="text-end">—</td>
                  <td className="text-end">{partialMonth ? <span className="tabular-nums" dir="ltr">{usd(data.daily.reduce((n, d) => n + Number(d.ai_usd), 0))}+</span> : <Money value={data.daily.reduce((n, d) => n + Number(d.ai_usd), 0)} />}</td><td className="ps-3"><StateBadge state={partialMonth ? 'PARTIAL' : 'ESTIMATED'} /></td></tr>
                {data.providers.map((p) => (
                  <tr key={p.worker} className="border-t border-border/60"><td className="py-2">{workerName(p.worker)}</td><td className="text-end tabular-nums">{num(p.runs)}</td><td className="text-end tabular-nums">{num(p.pages)}</td><td className="text-end tabular-nums">{num(p.listings)}</td>
                    <td className="text-end"><Money value={0} /></td><td className="ps-3 text-xs text-muted-foreground">{t('fpcost_no_paid_provider')}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-xs text-muted-foreground">{t('fpcost_split', { ai: usd(data.daily.reduce((n, d) => n + Number(d.ai_usd), 0)) })}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">{t('fpcost_cache')}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm" data-fp-cache>
          <p className="text-3xl font-semibold tabular-nums">{data.cache.hit_rate === null ? t('fin_na') : `${Math.round(Number(data.cache.hit_rate) * 100)}%`}</p>
          <p className="text-muted-foreground">{t('fpcost_cache_body', { shared: num(data.cache.shared_runs), warm: num(data.cache.warm_index_runs), runs: num(data.cache.runs), pool: num(data.cache.pool_listings) })}</p>
          <SectionTitle title={t('fpcost_optimise')} />
          <ul className="space-y-1" data-fp-optimise>
            <li>{t('fpcost_opt_repeated', { n: data.optimisation.repeated_ai_searches })}</li>
            <li>{t('fpcost_opt_retries', { n: data.optimisation.retries })}</li>
            <li>{t('fpcost_opt_failed', { n: data.optimisation.failed_runs })}</li>
            <li>{t('fpcost_opt_empty', { n: data.optimisation.empty_runs })}</li>
          </ul>
          <p className="text-xs text-muted-foreground">{t('fpcost_savings_note')}</p>
        </CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-base">{t('fpcost_history')}</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">{t('fpcost_filter_id')}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={filters.id} onChange={(e) => setFilters((f) => ({ ...f, id: e.target.value }))} placeholder={t('fpcost_filter_id')} className="ps-9 font-mono" />
          </label>
          <select aria-label={t('fpcost_provider')} value={filters.provider} onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value }))} className="min-h-[40px] rounded-xl border border-border bg-background px-3 text-sm">
            <option value="">{t('fpcost_all_providers')}</option>{workers.map((w) => <option key={w} value={w}>{workerName(w)}</option>)}
          </select>
          <select aria-label={t('fpcost_status')} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="min-h-[40px] rounded-xl border border-border bg-background px-3 text-sm">
            <option value="">{t('fpcost_all_statuses')}</option>{statuses.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>
        {rows.length ? <TableWrap>
          <table className="w-full text-sm" data-fp-history>
            <thead><tr className="text-xs text-muted-foreground"><th className="py-2 text-start">{t('fpcost_when')}</th><th className="text-start">{t('fpcost_search_id')}</th><th className="text-start">{t('fpcost_status')}</th><th className="text-end">{t('fpcost_results')}</th><th className="text-start ps-3">{t('fpcost_providers')}</th><th className="text-end">{t('fpcost_ai')}</th><th className="text-end">{t('fpcost_provider_cost')}</th><th className="text-end">{t('fpcost_other')}</th><th className="text-end">{t('fpcost_total')}</th><th className="text-start ps-3">{t('fpcost_completeness')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/30" onClick={() => setOpenId(r.id)} data-fp-row={r.id}>
                  <td className="py-2 whitespace-nowrap tabular-nums" dir="ltr">{new Date(r.created_at).toLocaleString()}</td>
                  <td><button type="button" className="font-mono text-xs underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{r.id.slice(0, 8)}</button></td>
                  <td className="text-xs">{r.status}</td>
                  <td className="text-end tabular-nums">{r.properties ?? '—'}</td>
                  <td className="ps-3 text-xs text-muted-foreground">{r.workers.map(workerName).join(', ') || '—'}</td>
                  <td className="text-end"><CostCell usdValue={r.ai_usd} upper={r.ai_upper_usd} state={r.completeness} /></td>
                  <td className="text-end"><Money value={r.provider_usd} /></td>
                  <td className="text-end text-xs text-muted-foreground">{t('fpcost_not_recorded')}</td>
                  <td className="text-end font-medium"><CostCell usdValue={r.total_usd} upper={r.ai_upper_usd} state={r.completeness} /></td>
                  <td className="ps-3"><StateBadge state={r.completeness} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap> : <Empty message={t('fpcost_empty')} />}
      </CardContent></Card>

      <Dialog open={!!openId} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{t('fpcost_detail_title')} <span className="font-mono text-sm text-muted-foreground">{openId?.slice(0, 8)}</span></DialogTitle></DialogHeader>
          {detailError ? <LoadError message={detailError} /> : !detail ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('fpcost_loading')}</div> : (
            <div className="space-y-4 text-sm" data-fp-detail>
              <p className="text-muted-foreground">{t('fpcost_detail_meta', { status: detail.search.status, n: detail.search.properties ?? 0, at: new Date(detail.search.created_at).toLocaleString() })}</p>
              <SectionTitle title={t('fpcost_detail_ai')} />
              {detail.ai.length ? <TableWrap><table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="py-1 text-start">{t('fpcost_operation')}</th><th className="text-start">{t('fpcost_model')}</th><th className="text-end">{t('fpcost_tokens')}</th><th className="text-end">{t('fpcost_rates')}</th><th className="text-end">{t('fpcost_cost')}</th><th className="text-start ps-2">{t('fpcost_completeness')}</th></tr></thead>
                <tbody>{detail.ai.map((a) => <tr key={a.id} className="border-t border-border/60">
                  <td className="py-1">{a.operation.replace('MARKETPLACE_', '')}</td><td>{a.model ?? '—'}</td>
                  <td className="text-end tabular-nums" dir="ltr">{a.input_tokens !== null ? `${num(a.input_tokens)} in / ${num(a.output_tokens ?? 0)} out` : `${num(a.units)} total`}</td>
                  <td className="text-end tabular-nums" dir="ltr">{a.input_rate_per_1m !== null ? `$${a.input_rate_per_1m} / $${a.output_rate_per_1m} per 1M` : '—'}</td>
                  <td className="text-end"><CostCell usdValue={a.usd} upper={a.upper_usd} state={a.state === 'PARTIAL' ? 'PARTIAL' : a.state === 'UNPRICED' ? 'UNKNOWN' : 'ESTIMATED'} /></td>
                  <td className="ps-2"><StateBadge state={a.state === 'PARTIAL' ? 'PARTIAL' : a.state === 'UNPRICED' ? 'UNKNOWN' : 'ESTIMATED'} /></td>
                </tr>)}</tbody>
              </table></TableWrap> : <Empty message={t('fpcost_detail_no_ai')} />}
              <SectionTitle title={t('fpcost_detail_workers')} />
              <TableWrap><table className="w-full text-xs">
                <thead><tr className="text-muted-foreground"><th className="py-1 text-start">{t('fpcost_provider')}</th><th className="text-start">{t('fpcost_status')}</th><th className="text-end">{t('fpcost_requests')}</th><th className="text-end">{t('fpcost_listings')}</th><th className="text-start ps-2">{t('fpcost_cache')}</th><th className="text-end">{t('fpcost_direct')}</th></tr></thead>
                <tbody>{detail.workers.map((w) => <tr key={w.worker} className="border-t border-border/60">
                  <td className="py-1">{workerName(w.worker)}</td><td>{w.status}{w.attempts > 1 ? ` ×${w.attempts}` : ''}</td>
                  <td className="text-end tabular-nums">{w.pages ?? '—'}</td><td className="text-end tabular-nums">{w.returned}</td>
                  <td className="ps-2">{[w.index === 'WARM' ? t('fpcost_index_warm') : null, w.shared_run_id ? t('fpcost_shared') : null, w.cached_listings ? t('fpcost_pool_n', { n: w.cached_listings }) : null].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-end"><Money value={0} /></td>
                </tr>)}</tbody>
              </table></TableWrap>
              <p className="text-xs text-muted-foreground">{t('fpcost_basis_workers')}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
