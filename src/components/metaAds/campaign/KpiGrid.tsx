// ONE KPI source: the server's `kpis` object for the campaign lifetime.
// A metric Meta or HOMATCH can't compute yet is shown as "—", never as 0.
import React from 'react';
import type { KpisRow } from '@/services/metaAds';
import { Stat, type Fmt, type T } from './shared';

export function KpiGrid({ t, fmt, kpis }: { t: T; fmt: Fmt; kpis: KpisRow }) {
  const cells: Array<[string, string]> = [
    [t('mm_c_kpi_spend'), fmt.money(kpis.spendMinor)],
    [t('mm_c_kpi_results'), fmt.num(kpis.results)],
    [t('mm_c_kpi_cpr'), fmt.money(kpis.costPerResultMinor)],
    [t('mm_c_kpi_ctr'), fmt.pct(kpis.ctr, 2)],
    [t('mm_c_kpi_cpc'), fmt.money(kpis.cpcMinor)],
    [t('mm_c_kpi_cpm'), fmt.money(kpis.cpmMinor)],
    [t('mm_c_kpi_frequency'), fmt.num(kpis.frequency, 2)],
    [t('mm_c_kpi_cpl'), fmt.money(kpis.cplMinor)],
    [t('mm_c_kpi_cpql'), fmt.money(kpis.cpqlMinor)],
    [t('mm_c_kpi_qual_rate'), fmt.pct(kpis.qualificationRate)],
    [t('mm_c_kpi_cpv'), fmt.money(kpis.costPerViewingMinor)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-mm-kpis="">
      {cells.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
    </div>
  );
}
