// A Meta breakdown (placement / age·gender / country / region / hour) as raw
// totals. A table on wide screens, cards on phones. The "strongest signal"
// mark appears only when the server named a leader with MEANINGFUL_SIGNAL+.
import React from 'react';
import { Award } from 'lucide-react';
import type { MetricTotalsRow } from '@/services/metaAds';
import { atLeast, Chip, Muted, type Fmt, type T } from './shared';

export function SegmentTable({ t, fmt, rows, name, leader, label }: {
  t: T; fmt: Fmt; rows: Array<{ key: string; totals: MetricTotalsRow }> | undefined;
  name: (key: string) => string; leader?: { key: string; evidence: string } | null; label: string;
}) {
  if (!rows?.length) return <Muted>{t('mm_c_seg_none')}</Muted>;
  const sorted = [...rows].sort((a, b) => (b.totals.spendMinor ?? 0) - (a.totals.spendMinor ?? 0));
  const lead = leader && atLeast(leader.evidence, 'MEANINGFUL_SIGNAL') ? leader.key : null;
  const cols: Array<[string, (x: MetricTotalsRow) => string]> = [
    [t('mm_c_col_spend'), (x) => fmt.money(x.spendMinor)],
    [t('mm_c_col_impressions'), (x) => fmt.num(x.impressions)],
    [t('mm_c_m_clicks'), (x) => fmt.num(x.linkClicks)],
    [t('mm_c_m_leads'), (x) => fmt.num(x.leads)],
  ];
  const Leader = () => <Chip tone="gold"><Award className="h-3 w-3" aria-hidden="true" />{t('mm_c_leader')}</Chip>;
  return (
    <>
      <table className="hidden w-full text-sm sm:table" aria-label={label}>
        <thead>
          <tr className="border-b border-border text-2xs text-muted-foreground">
            <th scope="col" className="py-2 text-start font-medium">{t('mm_c_col_segment')}</th>
            {cols.map(([h]) => <th key={h} scope="col" className="py-2 text-end font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className={`border-b border-border/60 last:border-0 ${r.key === lead ? 'bg-[hsl(var(--gold-soft))]/40' : ''}`}>
              <th scope="row" className="py-2 pe-2 text-start font-normal text-foreground">
                <span className="flex flex-wrap items-center gap-1.5">{name(r.key)}{r.key === lead && <Leader />}</span>
              </th>
              {cols.map(([h, v]) => <td key={h} className="py-2 text-end tabular-nums" dir="ltr">{v(r.totals)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 sm:hidden" aria-label={label}>
        {sorted.map((r) => (
          <li key={r.key} className={`rounded-xl border px-3 py-2.5 ${r.key === lead ? 'border-[hsl(var(--gold-border))]' : 'border-border'}`}>
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-foreground">{name(r.key)}{r.key === lead && <Leader />}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
              {cols.map(([h, v]) => (
                <div key={h} className="flex min-w-0 justify-between gap-2">
                  <dt className="truncate text-muted-foreground">{h}</dt>
                  <dd className="tabular-nums text-foreground" dir="ltr">{v(r.totals)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {!lead && <Muted className="mt-3">{t('mm_c_seg_early')}</Muted>}
    </>
  );
}
