// Performance: the current 7-day window against the one before it, and the
// daily series from Meta. Spend and leads have different scales, so they are
// two small single-series charts — never one chart with two axes.
import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { CampaignDetail, MetricTotalsRow } from '@/services/metaAds';
import { InsufficientBanner } from './OverviewSection';
import { Card, Muted, type Fmt, type T } from './shared';

type Row = { label: string; cur: number | null; prev: number | null; show: (n: number | null) => string };

function change(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

export function PerformanceSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const a = d.analysis;
  const insufficient = (d.evidence || 'INSUFFICIENT_DATA') === 'INSUFFICIENT_DATA';
  const cur: MetricTotalsRow | null = a?.current ?? null;
  const prev: MetricTotalsRow | null = a?.previous ?? null;
  const rows: Row[] = [
    { label: t('mm_c_kpi_spend'), cur: cur?.spendMinor ?? null, prev: prev?.spendMinor ?? null, show: (n) => fmt.money(n) },
    { label: t('mm_c_m_impressions'), cur: cur?.impressions ?? null, prev: prev?.impressions ?? null, show: (n) => fmt.num(n) },
    { label: t('mm_c_m_reach'), cur: cur?.reach ?? null, prev: prev?.reach ?? null, show: (n) => fmt.num(n) },
    { label: t('mm_c_m_clicks'), cur: cur?.linkClicks ?? null, prev: prev?.linkClicks ?? null, show: (n) => fmt.num(n) },
    { label: t('mm_c_m_leads'), cur: cur?.leads ?? null, prev: prev?.leads ?? null, show: (n) => fmt.num(n) },
    { label: t('mm_c_funnel_qualified'), cur: a?.outcomes?.current?.qualifiedLeads ?? null, prev: a?.outcomes?.previous?.qualifiedLeads ?? null, show: (n) => fmt.num(n) },
  ];
  const w = a?.windows;

  return (
    <div className="space-y-4">
      {insufficient && <InsufficientBanner t={t} />}
      <Card id="mm-perf" title={t('mm_c_perf_title')}>
        {!cur && !prev ? <Muted>{t('mm_c_perf_none')}</Muted> : (
          <>
            {w && (
              <p className="mb-3 text-2xs text-muted-foreground">
                {t('mm_c_perf_current')}: <span dir="ltr">{`${fmt.date(w.current.since)} – ${fmt.date(w.current.until)}`}</span>
                {' · '}
                {t('mm_c_perf_previous')}: <span dir="ltr">{`${fmt.date(w.previous.since)} – ${fmt.date(w.previous.until)}`}</span>
              </p>
            )}
            {/* Desktop table; each row becomes a card below sm. */}
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-border text-start text-2xs text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">{t('mm_c_perf_metric')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('mm_c_perf_current')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('mm_c_perf_previous')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('mm_c_perf_change')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-2 text-start font-normal text-foreground">{r.label}</th>
                    <td className="py-2 text-end tabular-nums" dir="ltr">{r.show(r.cur)}</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground" dir="ltr">{r.show(r.prev)}</td>
                    <td className="py-2 text-end"><Delta t={t} fmt={fmt} value={change(r.cur, r.prev)} gated={insufficient} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="space-y-2 sm:hidden">
              {rows.map((r) => (
                <li key={r.label} className="rounded-xl border border-border px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-foreground">{r.label}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
                    <span className="text-muted-foreground">{t('mm_c_perf_current')}: <b className="tabular-nums text-foreground" dir="ltr">{r.show(r.cur)}</b></span>
                    <span className="text-muted-foreground">{t('mm_c_perf_previous')}: <span className="tabular-nums" dir="ltr">{r.show(r.prev)}</span></span>
                    <Delta t={t} fmt={fmt} value={change(r.cur, r.prev)} gated={insufficient} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card id="mm-daily" title={t('mm_c_perf_daily_title')}>
        {!a?.daily?.length ? <Muted>{t('mm_c_perf_daily_none')}</Muted> : (
          <>
            <Muted className="mb-3">{t('mm_c_perf_daily_desc')}</Muted>
            <div className="grid gap-4 md:grid-cols-2">
              <DailyBars t={t} fmt={fmt} daily={a.daily} label={t('mm_c_kpi_spend')} pick={(x) => x.spendMinor} show={(n) => fmt.money(n)} tone="bg-[hsl(var(--gold))]" srList />
              <DailyBars t={t} fmt={fmt} daily={a.daily} label={t('mm_c_m_leads')} pick={(x) => x.leads} show={(n) => fmt.num(n)} tone="bg-foreground/60" />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Delta({ t, fmt, value, gated }: { t: T; fmt: Fmt; value: number | null; gated: boolean }) {
  // Not enough evidence: a percentage would read as a conclusion, so none is shown.
  if (gated) return <span className="text-2xs text-muted-foreground">{t('mm_c_perf_too_early')}</span>;
  if (value == null) return <span className="text-muted-foreground" dir="ltr">—</span>;
  const Icon = value > 0.005 ? ArrowUpRight : value < -0.005 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-[13px] tabular-nums text-foreground" dir="ltr">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {value > 0 ? '+' : ''}{fmt.pct(value, 0)}
    </span>
  );
}

/** One series, one axis, zero baseline. Hover (title) and a screen-reader list give every value. */
function DailyBars({ t, fmt, daily, label, pick, show, tone, srList }: {
  t: T; fmt: Fmt; daily: Array<{ date: string; totals: MetricTotalsRow }>; label: string;
  pick: (x: MetricTotalsRow) => number; show: (n: number) => string; tone: string; srList?: boolean;
}) {
  const pts = [...daily].sort((x, y) => x.date.localeCompare(y.date)).slice(-30);
  const max = Math.max(1, ...pts.map((p) => pick(p.totals) || 0));
  const peak = Math.max(...pts.map((p) => pick(p.totals) || 0));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="tabular-nums" dir="ltr" aria-hidden="true">↑ {show(peak)}</span>
      </figcaption>
      <div className="flex h-28 items-end gap-[2px] border-b border-border" aria-hidden="true">
        {pts.map((p) => {
          const v = pick(p.totals) || 0;
          return (
            <div key={p.date} className="group relative flex h-full min-w-0 flex-1 items-end"
              title={`${fmt.date(p.date)}: ${show(v)}`}>
              <div className={`w-full rounded-t-[4px] ${tone} transition-opacity group-hover:opacity-80`}
                style={{ height: `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-muted-foreground" aria-hidden="true">
        <span>{fmt.date(pts[0]?.date)}</span><span>{fmt.date(pts[pts.length - 1]?.date)}</span>
      </div>
      {srList && <ul className="sr-only">
        {pts.map((p) => (
          <li key={p.date}>{t('mm_c_chart_day', { date: fmt.date(p.date), spend: fmt.money(p.totals.spendMinor), leads: fmt.num(p.totals.leads) })}</li>
        ))}
      </ul>}
    </figure>
  );
}
