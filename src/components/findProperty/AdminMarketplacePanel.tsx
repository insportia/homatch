// HOMATCH ADMIN — MARKETPLACE SEARCH observability.
//
// One admin-only RPC (admin_marketplace_search_intelligence): the switch, the
// worker registry, recent searches with their counters, AI status and cost, and
// per search the worker runs (state, latency, errors), pipeline stats
// (raw → validated → unique, duplicates collapsed, possible duplicates, seller
// classes, price discrepancies) and each property's ranking components. No
// listing text, no contact data, no token. Read-only: nothing here switches
// anything on.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type AdminMarketplaceDetail, type AdminMarketplaceOverview, adminMarketplaceDetail, adminMarketplaceOverview,
} from '@/services/marketplaceSearch';

const cost = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${v.toFixed(4)}`);

function Content() {
  const { t } = useLanguage();
  const [data, setData] = useState<AdminMarketplaceOverview | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'UNAVAILABLE'>('LOADING');
  const [detail, setDetail] = useState<AdminMarketplaceDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try { setData(await adminMarketplaceOverview()); setState('READY'); } catch { setState('UNAVAILABLE'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => {
    setSelected(id);
    setDetail(null);
    try { setDetail(await adminMarketplaceDetail(id)); } catch { setDetail(null); }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card" aria-labelledby="mps-admin-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="mps-admin-title" className="text-sm font-semibold text-foreground">{t('mps_admin_title')}</h2>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={state === 'LOADING'}>
          {state === 'LOADING' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {state === 'UNAVAILABLE' ? <p className="text-xs text-muted-foreground">{t('mps_admin_unavailable')}</p> : null}
      {data ? (
        <div className="space-y-4 text-xs">
          <p>{t('mps_admin_switch')}: <strong>{data.enabled ? t('mps_admin_on') : t('mps_admin_off')}</strong> · {t('mps_admin_workers')}: {data.workers.length}</p>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[32rem]">
              <thead><tr className="text-muted-foreground">{['mps_admin_col_worker', 'mps_admin_col_source', 'mps_admin_col_mode', 'mps_admin_col_state', 'mps_admin_col_enabled', 'mps_admin_col_health'].map((k) => <th key={k} className="py-1 text-start font-medium">{t(k)}</th>)}</tr></thead>
              <tbody dir="ltr">
                {data.workers.length ? data.workers.map((w) => (
                  <tr key={w.worker_id} className="border-t border-border/60"><td className="py-1.5">{w.worker_id}</td><td>{w.source_key}</td><td>{w.execution_mode}</td><td>{w.state}</td><td>{w.enabled ? '✓' : '✗'}</td><td>{w.health?.status ?? '—'}</td></tr>
                )) : <tr><td colSpan={6} className="py-2 text-muted-foreground">{t('mps_admin_no_workers')}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[44rem]">
              <thead><tr className="text-muted-foreground">{['mps_admin_col_search', 'mps_admin_col_status', 'mps_admin_col_workers', 'mps_admin_col_pipeline', 'mps_admin_col_strong', 'mps_admin_col_ai', 'mps_admin_col_ai_cost'].map((k) => <th key={k} className="py-1 text-start font-medium">{t(k)}</th>)}</tr></thead>
              <tbody dir="ltr">
                {data.searches.map((s) => {
                  const st = (s.stats ?? {}) as Record<string, number>;
                  const ai = s.ai ?? [];
                  const aiCost = ai.some((a) => a.costUsd === null) ? null : ai.reduce((sum, a) => sum + (a.costUsd ?? 0), 0);
                  return (
                    <tr key={s.id} className={`border-t border-border/60 ${selected === s.id ? 'bg-muted/50' : ''}`}>
                      <td className="py-1.5"><button type="button" className="underline underline-offset-2" onClick={() => void open(s.id)}>{s.id.slice(0, 8)}</button></td>
                      <td>{s.status}{s.failure_reason ? ` · ${s.failure_reason}` : ''}</td>
                      <td>{s.workers_terminal}/{s.workers_total}</td>
                      <td>{st.raw ?? 0}→{st.validated ?? 0}→{st.uniqueProperties ?? 0}</td>
                      <td>{s.strong_matches}</td>
                      <td>{s.ai_status} · {ai.reduce((n, a) => n + a.inputTokens + a.outputTokens, 0)} tok</td>
                      <td>{cost(aiCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected && detail ? (
            <div className="space-y-3 rounded-xl border border-border p-3" dir="ltr">
              <p className="font-semibold">{selected}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{JSON.stringify((detail.search as Record<string, unknown> | null)?.stats ?? {}, null, 1)}</pre>
              <table className="w-full">
                <thead><tr className="text-muted-foreground">{['mps_admin_col_worker', 'mps_admin_col_status', 'mps_admin_col_counts', 'mps_admin_col_latency', 'mps_admin_col_errors'].map((k) => <th key={k} className="py-1 text-start font-medium">{t(k)}</th>)}</tr></thead>
                <tbody>{detail.worker_runs.map((r) => (
                  <tr key={r.worker_id} className="border-t border-border/60"><td className="py-1">{r.worker_id}</td><td>{r.status}</td><td>{r.discovered}/{r.returned}/{r.rejected}</td><td>{r.latency_ms ?? '—'} ms</td><td className="break-all">{JSON.stringify(r.errors)}</td></tr>
                ))}</tbody>
              </table>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem]">
                  <thead><tr className="text-muted-foreground">{['mps_admin_col_group', 'mps_admin_col_rank', 'mps_admin_col_score', 'mps_admin_col_seller', 'mps_admin_col_sources', 'mps_admin_col_price_diff', 'mps_admin_col_components'].map((k) => <th key={k} className="py-1 text-start font-medium">{t(k)}</th>)}</tr></thead>
                  <tbody>{detail.properties.slice(0, 60).map((p) => (
                    <tr key={p.key} className="border-t border-border/60"><td className="py-1">{p.group}</td><td>{p.rank}</td><td>{p.score}</td><td>{p.seller?.classification ?? '—'}</td><td>{p.source_count}</td>
                      <td>{p.price_discrepancy?.significant ? `${Math.round((p.price_discrepancy.differencePct ?? 0) * 1000) / 10}%` : '—'}</td>
                      <td className="break-all">{JSON.stringify(p.internal?.components ?? {})}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('AdminMarketplacePanel failed', error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function AdminMarketplacePanel() {
  return <Boundary><Content /></Boundary>;
}
