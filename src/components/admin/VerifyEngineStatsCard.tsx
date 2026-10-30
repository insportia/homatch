// Admin → Providers → Verify version management: the engines side by side.
//
// Per engine version stamped on the job (V1 / V2 / V3): jobs, research
// complete, reports DELIVERED (synthesis READY and the report exists), report
// failed, report still being prepared, research failed, success rate, mean
// duration, research end → report time and mean COGS (verify_job_cogs, provider cost only),
// over the last 30 days, then the latest jobs with their engine. Read only,
// from admin_verify_engine_stats (admin-checked server side). The live
// measurement of V3 is this card; nothing here is an estimate.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { DELIVERY_LABEL_KEY } from '@/components/admin/VerifyDeliveryCard';

/* `complete` / `failed` count DELIVERY since 20261208130000 (countsBy = 'DELIVERY');
   the delivery fields are absent on a database without that migration. */
interface EngineRow {
  engine: string; jobs: number; complete: number; failed: number; avgSeconds: number | null; avgCogsUsd: number | null; pricedJobs: number;
  researchComplete?: number; delivered?: number; reportFailed?: number; reportPending?: number; researchFailed?: number; stopped?: number;
  successRate?: number | null; avgReportSeconds?: number | null;
}
interface RecentRow { id: string; engine: string; status: string; createdAt: string; seconds: number | null; cogsUsd: number | null; delivery?: string | null; synthesisState?: string | null; attempts?: number | null }
interface Stats { days: number; engines: EngineRow[]; recent: RecentRow[] }

const usd = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(3)}` : '—');
const dur = (s: number | null | undefined) => (typeof s === 'number' ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');
const pct = (n: number | null | undefined) => (typeof n === 'number' ? `${Math.round(n * 1000) / 10}%` : '—');
const num = (n: number | null | undefined) => (typeof n === 'number' ? n : '—');

export function VerifyEngineStatsCard() {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_verify_engine_stats', { p_days: 30 });
    /* A malformed answer is "unavailable", never a crash of the whole Providers page. */
    const d = data as Stats | null;
    if (error || !d || !Array.isArray(d.engines) || !Array.isArray(d.recent)) setFailed(true);
    else setStats(d);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ka' ? 'ka-GE' : lang);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('adm_engine_stats_title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {failed ? <p className="text-2xs text-muted-foreground">{t('adm_engine_stats_unavailable')}</p> : null}
        {stats ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_engine')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_jobs')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_research_complete')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_delivered')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_report_failed')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_report_pending')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_research_failed')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_success_rate')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_avg_time')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_avg_report_time')}</th>
                    <th className="py-1 font-medium">{t('adm_engine_stats_avg_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.engines.map((e) => (
                    <tr key={e.engine} className="border-t border-border tabular-nums">
                      <td className="py-1 pe-2 font-semibold">{e.engine}</td>
                      <td className="py-1 pe-2">{e.jobs}</td>
                      <td className="py-1 pe-2">{num(e.researchComplete)}</td>
                      <td className="py-1 pe-2">{e.delivered ?? e.complete}</td>
                      <td className="py-1 pe-2">{num(e.reportFailed)}</td>
                      <td className="py-1 pe-2">{num(e.reportPending)}</td>
                      <td className="py-1 pe-2">{num(e.researchFailed)}</td>
                      <td className="py-1 pe-2">{pct(e.successRate)}</td>
                      <td className="py-1 pe-2">{dur(e.avgSeconds)}</td>
                      <td className="py-1 pe-2">{dur(e.avgReportSeconds)}</td>
                      <td className="py-1">{usd(e.avgCogsUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stats.recent.length ? (
              <div className="space-y-1">
                <p className="text-2xs font-medium text-muted-foreground">{t('adm_engine_recent')}</p>
                <ul className="space-y-1 text-2xs text-muted-foreground">
                  {stats.recent.slice(0, 15).map((r) => (
                    <li key={r.id} className="break-words tabular-nums">
                      <span className="font-semibold text-foreground">{r.engine}</span> · {fmt(r.createdAt)} · {t('adm_delivery_research')}: {r.status}
                      {r.delivery ? <> · {t('adm_delivery_report')}: <span className={r.delivery === 'FAILED' ? 'text-destructive' : r.delivery === 'DELIVERED' ? 'text-foreground' : ''}>{t(DELIVERY_LABEL_KEY[r.delivery] ?? 'adm_delivery_state_preparing')}</span>{r.attempts ? ` (${r.attempts})` : ''}</> : null}
                      {' '}· {dur(r.seconds)} · {usd(r.cogsUsd)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
