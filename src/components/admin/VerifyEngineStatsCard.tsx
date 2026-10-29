// Admin → Providers → Verify version management: the engines side by side.
//
// Per engine version stamped on the job (V1 / V2 / V3): jobs, completed,
// failed, mean duration and mean COGS (verify_job_cogs, provider cost only),
// over the last 30 days, then the latest jobs with their engine. Read only,
// from admin_verify_engine_stats (admin-checked server side). The live
// measurement of V3 is this card; nothing here is an estimate.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';

interface EngineRow { engine: string; jobs: number; complete: number; failed: number; avgSeconds: number | null; avgCogsUsd: number | null; pricedJobs: number }
interface RecentRow { id: string; engine: string; status: string; createdAt: string; seconds: number | null; cogsUsd: number | null }
interface Stats { days: number; engines: EngineRow[]; recent: RecentRow[] }

const usd = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(3)}` : '—');
const dur = (s: number | null | undefined) => (typeof s === 'number' ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');

export function VerifyEngineStatsCard() {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_verify_engine_stats', { p_days: 30 });
    if (error) setFailed(true);
    else setStats(data as Stats);
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
              <table className="w-full min-w-[22rem] text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_engine')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_jobs')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_complete')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_failed')}</th>
                    <th className="py-1 pe-2 font-medium">{t('adm_engine_stats_avg_time')}</th>
                    <th className="py-1 font-medium">{t('adm_engine_stats_avg_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.engines.map((e) => (
                    <tr key={e.engine} className="border-t border-border tabular-nums">
                      <td className="py-1 pe-2 font-semibold">{e.engine}</td>
                      <td className="py-1 pe-2">{e.jobs}</td>
                      <td className="py-1 pe-2">{e.complete}</td>
                      <td className="py-1 pe-2">{e.failed}</td>
                      <td className="py-1 pe-2">{dur(e.avgSeconds)}</td>
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
                      <span className="font-semibold text-foreground">{r.engine}</span> · {fmt(r.createdAt)} · {r.status} · {dur(r.seconds)} · {usd(r.cogsUsd)}
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
