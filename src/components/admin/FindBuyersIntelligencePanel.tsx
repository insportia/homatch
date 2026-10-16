// FIND BUYERS / FIND TENANTS — the Intelligence tab of the admin center.
//
// What works, what costs and what is noise, across recent campaigns, from
// admin_find_buyers_intelligence (admin-gated, read-only): query and Actor
// effectiveness against qualified leads, the false-positive rate after
// re-qualification, rejection reasons, source quality per group / channel,
// discovery vs extraction timing, comment coverage, free vs paid Telegram,
// and the waits that slowed campaigns down. Money arrives as microdollars.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getFindBuyersIntelligence, usd, type FindBuyersIntelligence } from '@/services/findBuyers';

const n = (v: unknown) => Number(v ?? 0) || 0;
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const secs = (v: number | null | undefined) => (v == null ? '—' : v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`);
const counts = (m: Record<string, number> | null | undefined) =>
  (m && Object.keys(m).length ? Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') : '—');
const sinceStart = (start: string, at: string | null) => (at ? secs(Math.max(0, Math.round((Date.parse(at) - Date.parse(start)) / 1000))) : '—');

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3" data-testid={testId}>
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums" dir="ltr">{value}</p>
    </div>
  );
}

function Grid({ head, rows, testId }: { head: string[]; rows: React.ReactNode[][]; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border" data-testid={testId}>
      <table className="w-full min-w-[720px] text-2xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>{head.map((h) => <th key={h} className="px-2.5 py-2 text-start font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="px-2.5 py-3 text-muted-foreground" colSpan={head.length}>—</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60 align-top">{r.map((c, j) => <td key={j} className="px-2.5 py-2">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Line({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <p className="rounded-lg border border-border px-3 py-2 text-2xs" data-testid={testId}>
      <span className="font-semibold">{label}</span> <span dir="ltr" className="break-words">{value}</span>
    </p>
  );
}

export function FindBuyersIntelligencePanel({ days }: { days: number }) {
  const { t } = useLanguage();
  const [data, setData] = useState<FindBuyersIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getFindBuyersIntelligence(days > 0 ? days : 30);
      /* Anything but the function's own shape (e.g. before the migration) is "not available", never a crash. */
      if (!next || !Array.isArray(next.actors) || !Array.isArray(next.queries) || !next.falsePositives || !next.telegram || !next.bottlenecks) {
        setData(null);
        setError('UNAVAILABLE');
      } else setData(next);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <div className="mt-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (error || !data) return <p className="mt-4 text-sm text-destructive" data-testid="fbi-error">{t('fbi_unavailable')}</p>;

  const fp = data.falsePositives;
  const tg = data.telegram;
  return (
    <div className="mt-4 space-y-4" data-testid="fbx-intelligence">
      <p className="text-2xs text-muted-foreground">{t('fbi_explain')}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label={t('fbi_campaigns')} value={n(data.campaigns).toLocaleString()} />
        <Kpi testId="fbi-fp-rate" label={t('fbi_fp_rate')}
          value={fp.rate == null ? '—' : `${(fp.rate * 100).toFixed(1)}% (${n(fp.rejectedAfterRequalification)}/${n(fp.requalified)})`} />
        <Kpi testId="fbi-tg" label={t('fbi_tg_free_paid')} value={`${n(tg.freeMessages)} / ${n(tg.paidItems)}`} />
        <Kpi label={t('fbi_phase1_avg')} value={secs(data.bottlenecks.phase1AvgSeconds)} />
      </div>

      <h3 className="pt-2 text-xs font-semibold">{t('fbi_actors')}</h3>
      <Grid testId="fbi-actors"
        head={[t('fbi_actor'), t('fbi_runs'), t('fbi_failed'), t('fbi_empty'), t('fbi_items'), t('fbi_cost'), t('fbi_qualified'), t('fbi_cost_per_qualified')]}
        rows={data.actors.map((a) => [
          <span key="k" className="font-semibold" dir="ltr">{a.actorKey}</span>, n(a.runs), n(a.failed), n(a.empty), n(a.items),
          <span key="c" dir="ltr">{usd(n(a.costMicros), 3)}</span>, n(a.qualified),
          <span key="q" dir="ltr">{a.costPerQualifiedMicros == null ? '—' : usd(a.costPerQualifiedMicros, 3)}</span>,
        ])} />

      <h3 className="pt-2 text-xs font-semibold">{t('fbi_queries')}</h3>
      <Grid testId="fbi-queries"
        head={[t('fbi_operation'), t('fbi_query'), t('fbi_language'), t('fbi_runs'), t('fbi_items'), t('fbi_cost'), t('fbi_qualified')]}
        rows={data.queries.slice(0, 40).map((q) => [
          <span key="o" dir="ltr">{q.operation}</span>, <span key="q" dir="auto" className="break-all">{q.query}</span>, q.language ?? '—',
          n(q.runs), n(q.items), <span key="c" dir="ltr">{usd(n(q.costMicros), 3)}</span>, n(q.qualified),
        ])} />

      <h3 className="pt-2 text-xs font-semibold">{t('fbi_sources')}</h3>
      <Grid testId="fbi-sources"
        head={[t('fbi_community'), t('fbi_leads'), t('fbi_qualified'), t('fbi_rejected'), t('fbi_uncategorised'), t('fbi_items'), t('fbi_cost'), t('fbi_per_dollar')]}
        rows={data.sourceQuality.slice(0, 40).map((s) => [
          <span key="c" dir="ltr" className="break-all">{s.community ?? s.platform ?? '—'}</span>, n(s.leads), n(s.qualified), n(s.rejected), n(s.uncategorised), n(s.items),
          <span key="m" dir="ltr">{usd(n(s.costMicros), 3)}</span>, s.qualifiedPerDollar == null ? '—' : String(s.qualifiedPerDollar),
        ])} />

      <h3 className="pt-2 text-xs font-semibold">{t('fbi_quality')}</h3>
      <div className="space-y-2">
        <Line testId="fbi-categories" label={t('fbi_categories')} value={counts(data.categories)} />
        <Line testId="fbi-rejections" label={t('fbi_rejections')} value={counts(data.rejectionReasons)} />
        <Line testId="fbi-signal-rejections" label={t('fbi_signal_rejections')} value={counts(data.signalRejectionReasons)} />
        <Line testId="fbi-comments" label={t('fbi_comments', { comments: String(n(data.comments.commentsAssessed)), posts: String(n(data.comments.postsAssessed)) })}
          value={counts(data.comments.decisions)} />
        <Line testId="fbi-telegram" label={t('fbi_telegram')}
          value={t('fbi_telegram_value', { free: String(n(tg.freeMessages)), targets: String(n(tg.freeTargets)), paid: String(n(tg.paidItems)),
            channels: String(n(tg.paidChannels)), cost: usd(n(tg.paidCostMicros), 3), discovered: String(n(tg.communitiesDiscovered)) })} />
        <Line testId="fbi-waits" label={t('fbi_waits')} value={counts(data.bottlenecks.waits)} />
        <Line testId="fbi-cancelled" label={t('fbi_cancelled')} value={counts(data.bottlenecks.cancelled)} />
      </div>

      <h3 className="pt-2 text-xs font-semibold">{t('fbi_timing')}</h3>
      <Grid testId="fbi-timing"
        head={[t('fbi_started'), t('fbi_phase1'), t('fbi_first_extraction'), t('fbi_first_lead'), t('fbi_first_qualified'), t('fbi_duration')]}
        rows={data.timing.map((c) => [
          when(c.createdAt), <span key="p" dir="ltr">{secs(c.phase1Seconds)}</span>,
          <span key="e" dir="ltr">{sinceStart(c.createdAt, c.firstExtractionAt)}</span>,
          <span key="l" dir="ltr">{sinceStart(c.createdAt, c.firstLeadAt)}</span>,
          <span key="q" dir="ltr">{sinceStart(c.createdAt, c.firstQualifiedAt)}</span>,
          <span key="d" dir="ltr">{secs(c.durationSeconds)}</span>,
        ])} />
    </div>
  );
}

export default FindBuyersIntelligencePanel;
