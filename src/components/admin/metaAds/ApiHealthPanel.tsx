// ADMIN — META API HEALTH. What Meta itself last reported about HOMATCH's
// Marketing API usage (X-Business-Use-Case-Usage per ad account and type,
// X-Ad-Account-Usage, X-App-Usage), stored by meta-ads-api as percentages,
// regain minutes and access tier — never a token. The pressure level is the
// one the schedulers act on (src/lib/metaAds/rateLimit.ts): above 50% insights
// slow down, above 75% only status is read, above 90% status every fifth
// minute, and a regain time stops calls for that account until it passes.
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { pressureOf, type Pressure } from '@/lib/metaAds/rateLimit';
import { cn } from '@/lib/utils';
import { ago } from '@/components/metaAds/workspace/format';
import { AGO, errorText, Panel, Stat } from './kit';

interface UsageRow { bucket: string; type: string; call_count: number; total_cputime: number; total_time: number; regain_minutes: number; tier: string | null; observed_at: string }

/** Account ids are shown by their last four digits only. */
export const maskBucket = (b: string) => (/^\d{5,}$/.test(b) ? `…${b.slice(-4)}` : b);

const TONE: Record<Pressure, string> = {
  NORMAL: 'text-[hsl(var(--success))]', ELEVATED: 'text-[hsl(var(--warning))]', HIGH: 'text-[hsl(var(--warning))]',
  CRITICAL: 'text-destructive', THROTTLED: 'text-destructive',
};

/** What admin_test_connection returns: booleans and timestamps, never a value. */
interface Probe {
  mode: 'REAL' | 'MOCK'; secretsConfigured: boolean; webhookVerifyTokenConfigured: boolean;
  tokenEncryptionConfigured: boolean; redirectUriConfigured: boolean;
  capabilities: { key: string; status: string; requirement?: string }[];
  lastStatusSyncAt: string | null; lastUsageReportAt: string | null; checkedAt: string;
  instantForms?: { goalEnabled: boolean; leadImportEnabled: boolean; requiredScopes: string[]; connectedTotal: number; connectedWithScopes: number };
}
/** HOMATCH's view of Meta older than this is stale (status sync runs every minute). */
const PROBE_STALE_MS = 20 * 60_000;

/**
 * The integration truth from the server: mode, whether each credential is SET,
 * the capability matrix, and how fresh the status sync and Meta's usage
 * reports are. Rendered from booleans only — there is nothing secret to show.
 */
export function IntegrationProbe() {
  const { t } = useLanguage();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useCallback(async () => {
    setBusy(true); setFailed(false);
    try {
      const { data, error } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_test_connection' } });
      if (error) throw error;
      setProbe(data as Probe);
    } catch { setFailed(true); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void run(); }, [run]);
  const now = Date.now();
  const when = (iso: string | null) => {
    if (!iso) return { text: t('mm_a_api_never'), stale: true };
    const a = ago(iso, now);
    return { text: a ? t(AGO[a.key] ?? 'mm_a_ago_min', { n: a.n }) : '—', stale: now - Date.parse(iso) > PROBE_STALE_MS };
  };
  const flag = (label: string, on: boolean, key: string) => (
    <li key={key} data-mm-probe={key} data-mm-probe-value={on ? 'set' : 'missing'} className="flex items-center justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <span className="min-w-0 break-words">{label}</span>
      <b className={cn('shrink-0 whitespace-nowrap', on ? 'text-[hsl(var(--success))]' : 'text-destructive')}>{on ? t('mm_a_api_set') : t('mm_a_api_missing')}</b>
    </li>
  );
  const sync = probe ? when(probe.lastStatusSyncAt) : null;
  const usage = probe ? when(probe.lastUsageReportAt) : null;
  return (
    <div data-mm-probe-panel="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-foreground">{t('admin_mads_integration')}</h2>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('admin_mads_test_conn')}
        </Button>
      </div>
      {failed && <p className="mt-2 text-sm text-destructive">{t('mm_a_load_failed')}</p>}
      {probe && (
        <div className="mt-3 grid gap-4 text-[13px] md:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1">{t('admin_mads_mode')}: <b data-mm-probe-mode={probe.mode} className={probe.mode === 'REAL' ? 'text-[hsl(var(--success))]' : 'text-[hsl(var(--gold-ink))]'}>{probe.mode}</b></p>
            <ul>
              {flag(t('mm_a_api_secret_meta'), probe.secretsConfigured, 'secrets')}
              {flag(t('mm_a_api_secret_webhook'), probe.webhookVerifyTokenConfigured, 'webhook')}
              {flag(t('mm_a_api_secret_enc'), probe.tokenEncryptionConfigured, 'encryption')}
              {flag(t('mm_a_api_secret_redirect'), probe.redirectUriConfigured, 'redirect')}
            </ul>
            <ul className="mt-2">
              <li className="flex items-center justify-between gap-3 py-1" data-mm-probe-fresh={sync?.stale ? 'stale' : 'fresh'}>
                <span>{t('mm_a_api_last_sync')}</span><b className={cn('shrink-0 whitespace-nowrap', sync?.stale && 'text-[hsl(var(--warning))]')}>{sync?.text}</b>
              </li>
              <li className="flex items-center justify-between gap-3 py-1">
                <span>{t('mm_a_api_last_usage')}</span><b className={cn('shrink-0 whitespace-nowrap', usage?.stale && 'text-[hsl(var(--warning))]')}>{usage?.text}</b>
              </li>
            </ul>
          </div>
          <div className="min-w-0 space-y-1">
            {probe.instantForms && (
              <div className="mb-3 rounded-lg border border-border p-2.5" data-mm-probe-forms={probe.instantForms.connectedWithScopes > 0 ? 'granted' : 'blocked'}>
                <p className="font-semibold">{t('mm_a_forms_title')}</p>
                <p className="text-muted-foreground">{t('mm_a_forms_counts', { n: probe.instantForms.connectedWithScopes, total: probe.instantForms.connectedTotal })}</p>
                {probe.instantForms.goalEnabled && probe.instantForms.connectedWithScopes === 0 && (
                  <p className="mt-1 text-[hsl(var(--warning))]">{t('mm_a_forms_blocked')} <span className="font-mono" dir="ltr">{probe.instantForms.requiredScopes.join(', ')}</span></p>
                )}
              </div>
            )}
            <p className="font-semibold">{t('mm_a_api_capabilities')}</p>
            {(probe.capabilities ?? []).map((c) => (
              <div key={c.key} className="flex items-start gap-2">
                {c.status === 'VERIFIED_SUPPORTED' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))]" />
                  : c.status === 'UNSUPPORTED' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" />}
                <span className="min-w-0 break-words"><b>{c.key}</b> — {c.status}{c.requirement ? `: ${c.requirement}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-4">
    <Panel><IntegrationProbe /></Panel>
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
    </div>
  );
}
