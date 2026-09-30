// ADMIN — META API HEALTH. What Meta itself last reported about HOMATCH's
// Marketing API usage (X-Business-Use-Case-Usage per ad account and type,
// X-Ad-Account-Usage, X-App-Usage), stored by meta-ads-api as percentages,
// regain minutes and access tier — never a token. The pressure level is the
// one the schedulers act on (src/lib/metaAds/rateLimit.ts): above 50% insights
// slow down, above 75% only status is read, above 90% status every fifth
// minute, and a regain time stops calls for that account until it passes.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { pressureOf, type Pressure } from '@/lib/metaAds/rateLimit';
import { cn } from '@/lib/utils';
import { errorText, Panel, Stat } from './kit';

interface UsageRow { bucket: string; type: string; call_count: number; total_cputime: number; total_time: number; regain_minutes: number; tier: string | null; observed_at: string }

/** Account ids are shown by their last four digits only. */
export const maskBucket = (b: string) => (/^\d{5,}$/.test(b) ? `…${b.slice(-4)}` : b);

const TONE: Record<Pressure, string> = {
  NORMAL: 'text-[hsl(152_60%_32%)]', ELEVATED: 'text-[hsl(38_92%_38%)]', HIGH: 'text-[hsl(24_90%_42%)]',
  CRITICAL: 'text-destructive', THROTTLED: 'text-destructive',
};

export function ApiHealthPanel() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data, error: e } = await supabase.from('meta_api_usage')
        .select('bucket,type,call_count,total_cputime,total_time,regain_minutes,tier,observed_at').order('observed_at', { ascending: false }).limit(200);
      if (e) throw e;
      setRows((data ?? []) as UsageRow[]);
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const byBucket = new Map<string, UsageRow[]>();
  for (const r of rows ?? []) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);
  const pressureFor = (list: UsageRow[]) => pressureOf(list
    .filter((r) => Date.parse(r.observed_at) > now - 3_600_000)
    .map((r) => ({ callCount: Number(r.call_count), totalCputime: Number(r.total_cputime), totalTime: Number(r.total_time),
      regainMinutes: Date.parse(r.observed_at) + Number(r.regain_minutes) * 60_000 > now ? Number(r.regain_minutes) : 0 })));
  const tiers = [...new Set((rows ?? []).map((r) => r.tier).filter(Boolean))] as string[];
  const peak = (rows ?? []).reduce((m, r) => Math.max(m, Number(r.call_count), Number(r.total_cputime), Number(r.total_time)), 0);
  const throttled = [...byBucket.values()].filter((l) => pressureFor(l) === 'THROTTLED').length;
  const pct = (n: number) => `${Number(n).toLocaleString(lang, { maximumFractionDigits: 1 })}%`;

  return (
    <Panel title={t('mm_a_api_title')} actions={
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t('mm_a_api_refresh')}
      </Button>}>
      <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{t('mm_a_api_lead')}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !rows ? <Skeleton className="h-32 rounded-xl" /> : rows && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-mm-api-empty="">{t('mm_a_api_empty')}</p>
      ) : rows && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label={t('mm_a_api_tier')} value={tiers.join(', ') || '—'} />
            <Stat label={t('mm_a_api_buckets')} value={byBucket.size} />
            <Stat label={t('mm_a_api_peak')} value={pct(peak)} tone={peak >= 50 ? 'warn' : undefined} />
            <Stat label={t('mm_a_api_throttled')} value={throttled} tone={throttled ? 'warn' : undefined} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]" data-mm-api-table="">
              <thead><tr className="text-start text-2xs uppercase tracking-[0.08em] text-muted-foreground">
                {['mm_a_api_col_bucket', 'mm_a_api_col_type', 'mm_a_api_col_calls', 'mm_a_api_col_cpu', 'mm_a_api_col_time', 'mm_a_api_col_regain', 'mm_a_api_col_pressure', 'mm_a_api_col_seen'].map((k) => (
                  <th key={k} className="px-2 py-1.5 text-start font-semibold">{t(k)}</th>))}
              </tr></thead>
              <tbody>
                {[...byBucket.entries()].flatMap(([bucket, list]) => {
                  const p = pressureFor(list);
                  return list.map((r) => (
                    <tr key={`${bucket}|${r.type}`} className="border-t border-border">
                      <td className="px-2 py-1.5 font-mono" dir="ltr">{maskBucket(bucket)}</td>
                      <td className="px-2 py-1.5" dir="ltr">{r.type}</td>
                      <td className="px-2 py-1.5 tabular-nums">{pct(r.call_count)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{pct(r.total_cputime)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{pct(r.total_time)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{Number(r.regain_minutes) > 0 ? t('mm_a_api_regain_v', { n: Number(r.regain_minutes) }) : '—'}</td>
                      <td className={cn('px-2 py-1.5 font-semibold', TONE[p])}>{t(`mm_a_api_p_${p}`)}</td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{new Date(r.observed_at).toLocaleString(lang)}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">{t('mm_a_api_policy')}</p>
    </Panel>
  );
}
