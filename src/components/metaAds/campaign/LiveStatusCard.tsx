// LIVE ACTIVITY — where the campaign stands at Meta right now, from data the
// backend already holds: Meta's campaign status and ad review states (the
// scheduled sync), the requested and Meta-reported start, budget and end, and
// delivery totals from the one KPI source. A row without data is left out;
// before Meta reports delivery there are no zeros, just "waiting".
//
// Freshness is the real schedule (pg_cron): `homatch-meta-ads-status-sync`
// reads each live campaign's status at Meta every minute (paused: every fifth
// minute), and `homatch-meta-ads-maintenance` refreshes insights, Guard and
// analysis every 15 minutes. The next check is shown as a clock time from that
// schedule — never a countdown.
import React, { useEffect, useRef, useState } from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import type { Fmt, T } from './shared';

export const STATUS_EVERY_MINUTES = 1;
export const STATUS_EVERY_MINUTES_PAUSED = 5;
export const INSIGHTS_EVERY_MINUTES = 15;
const LIVE = ['SUBMITTED', 'META_REVIEW', 'ACTIVE'];
const HUMAN_META_STATUS = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'];

/** The next run of an every-N-minutes cron job after `nowMs`. */
export function nextRun(nowMs: number, everyMinutes: number): Date {
  const step = everyMinutes * 60_000;
  return new Date(Math.floor(nowMs / step) * step + step);
}

/** Pulse while Meta is working on it or delivering; still when paused or done. */
export function liveMotion(status: string): 'pulse' | 'still' | 'none' {
  if (LIVE.includes(status)) return 'pulse';
  if (status === 'PAUSED') return 'still';
  return 'none';
}

export function LiveDot({ status }: { status: string }) {
  const motion = liveMotion(status);
  if (motion === 'none') return null;
  const tone = status === 'ACTIVE' ? 'bg-[hsl(152_60%_42%)]' : status === 'PAUSED' ? 'bg-muted-foreground/50' : 'bg-[hsl(38_92%_54%)]';
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true" data-mm-live-dot={motion}>
      {motion === 'pulse' && <span className={`absolute inline-flex h-full w-full rounded-full opacity-50 motion-safe:animate-ping motion-safe:[animation-duration:2.4s] ${tone}`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone}`} />
    </span>
  );
}

export function LiveStatusCard({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const c = d.campaign;
  // Re-render relative times; the values themselves come only from the backend.
  const [, setTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 30_000); return () => window.clearInterval(id); }, []);

  const life = d.analysis?.lifetime ?? null;
  const delivered = !!life && (life.impressions > 0 || life.spendMinor > 0);
  const metrics: Array<[string, string, string]> = delivered ? [
    ['spend', t('mm_c_kpi_spend'), fmt.money(life!.spendMinor)],
    ['impressions', t('mm_c_live_impressions'), fmt.num(life!.impressions)],
    ...(life!.reach != null ? [['reach', t('mm_c_live_reach'), fmt.num(life!.reach)] as [string, string, string]] : []),
    ['clicks', t('mm_c_live_clicks'), fmt.num(life!.clicks)],
    ...(d.kpis ? [['results', t('mm_c_kpi_results'), fmt.num(d.kpis.results)] as [string, string, string]] : []),
    ...(d.kpis?.costPerResultMinor != null ? [['cpr', t('mm_c_kpi_cpr'), fmt.money(d.kpis.costPerResultMinor)] as [string, string, string]] : []),
  ] : [];

  /* A value that genuinely changed since the last refresh glows once. */
  const prev = useRef<Record<string, string>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const signature = metrics.map(([k, , v]) => `${k}=${v}`).join('|');
  useEffect(() => {
    const now: Record<string, string> = Object.fromEntries(metrics.map(([k, , v]) => [k, v]));
    const diff = Object.keys(prev.current).length ? new Set(Object.keys(now).filter((k) => prev.current[k] !== undefined && prev.current[k] !== now[k])) : new Set<string>();
    prev.current = now;
    if (diff.size) {
      setChanged(diff);
      const id = window.setTimeout(() => setChanged(new Set()), 2500);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const ads = d.entities.filter((e) => e.kind === 'AD');
  const count = (pred: (s: string) => boolean) => ads.filter((a) => pred(String(a.status ?? '').toUpperCase())).length;
  const inReview = count((s) => s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PREAPPROVED');
  const delivering = count((s) => s === 'ACTIVE');
  const rejected = count((s) => s === 'DISAPPROVED');
  const adParts = [
    inReview ? t('mm_c_live_ads_review', { n: inReview }) : null,
    delivering ? t('mm_c_live_ads_active', { n: delivering }) : null,
    rejected ? t('mm_c_live_ads_rejected', { n: rejected }) : null,
  ].filter(Boolean) as string[];

  const metaStatus = String(c.external_status ?? '').toUpperCase();
  const startFrom = c.requested_start_at ?? c.launched_at ?? null;
  const endAt = startFrom && c.duration_days ? new Date(Date.parse(startFrom) + Number(c.duration_days) * 86_400_000).toISOString() : null;
  const live = LIVE.includes(c.status);
  const watched = live || c.status === 'PAUSED';
  const next = watched ? nextRun(Date.now(), c.status === 'PAUSED' ? STATUS_EVERY_MINUTES_PAUSED : STATUS_EVERY_MINUTES) : null;
  const insightsAt = c.insights_synced_at ?? d.provenance?.insightsSyncedAt ?? null;

  const rows: Array<[string, React.ReactNode, string?]> = [
    ...(metaStatus ? [[t('mm_c_live_meta_status'), HUMAN_META_STATUS.includes(metaStatus) ? t(`mm_c_meta_status_${metaStatus}`) : metaStatus] as [string, React.ReactNode]] : []),
    ...(adParts.length ? [[t('mm_c_live_ads'), adParts.join(' · ')] as [string, React.ReactNode]] : []),
    ...(c.requested_start_at ? [[t('mm_c_live_requested_start'), fmt.dateTime(c.requested_start_at)] as [string, React.ReactNode]] : []),
    ...(c.meta_start_time ? [[t('mm_c_live_meta_start'), fmt.dateTime(c.meta_start_time)] as [string, React.ReactNode]] : []),
    ...(c.daily_budget_cents ? [[t('mm_c_live_budget'), t('mm_c_live_budget_v', { amount: fmt.money(c.daily_budget_cents), days: c.duration_days ?? '—' })] as [string, React.ReactNode]] : []),
    ...(endAt ? [[t('mm_c_live_ends'), fmt.dateTime(endAt)] as [string, React.ReactNode]] : []),
    ...(c.last_synced_at ? [[t('mm_c_live_synced'), fmt.rel(c.last_synced_at) ?? '—', fmt.dateTime(c.last_synced_at)] as [string, React.ReactNode, string]] : []),
    ...(insightsAt ? [[t('mm_c_live_insights'), fmt.rel(insightsAt) ?? '—', fmt.dateTime(insightsAt)] as [string, React.ReactNode, string]] : []),
    ...(next ? [[t('mm_c_live_next'), t('mm_c_live_next_v', { time: next.toLocaleTimeString(fmt.lang, { hour: '2-digit', minute: '2-digit' }) })] as [string, React.ReactNode]] : []),
  ];

  const stateKey = ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(c.status) ? `mm_c_live_state_${c.status}` : null;

  return (
    <section data-mm-live="" aria-labelledby="mm-c-live-title" className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mm-c-live-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LiveDot status={c.status} />{t('mm_c_live_title')}
        </h2>
        {stateKey && <p className="text-[13px] font-medium text-foreground" aria-live="polite" data-mm-live-state={c.status}>{t(stateKey)}</p>}
      </div>
      {c.status === 'META_REVIEW' && (
        /* Indeterminate on purpose: nobody knows when Meta's review ends. */
        <div className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-[hsl(var(--gold-soft))]" aria-hidden="true" data-mm-review-activity="">
          <div className="h-full w-1/3 rounded-full bg-[hsl(38_92%_54%)]/70 motion-safe:animate-[mm-indeterminate_2.8s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-40" />
        </div>
      )}
      {c.status === 'META_REVIEW' && <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t('mm_c_live_review_note')}</p>}

      {rows.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {rows.map(([k, v, title]) => (
            <div key={k} className="flex min-w-0 items-baseline justify-between gap-3">
              <dt className="min-w-0 text-muted-foreground">{k}</dt>
              <dd className="shrink-0 text-end font-medium text-foreground tabular-nums" title={title}>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 border-t border-border pt-3">
        {delivered ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-mm-live-metrics="">
            {metrics.map(([k, label, v]) => (
              <div key={k} className={`rounded-xl px-2.5 py-2 transition-colors duration-700 ${changed.has(k) ? 'bg-[hsl(var(--gold-soft))]' : 'bg-[hsl(var(--secondary))]/40'}`}>
                <dt className="text-2xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-muted-foreground" data-mm-live-waiting="">{t('mm_c_live_waiting')}</p>
        )}
      </div>
    </section>
  );
}
