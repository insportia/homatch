// EMAIL STUDIO — Analytics (/outreach/email/analytics[?campaign=<id>]). Owner brief §13.
//
// Provider-confirmed records only (see sendFacts): sent attempts, accepted by Resend, delivered,
// bounced, complained, unsubscribed. Opens and clicks are NOT tracked for campaign email — no
// tracking pixel, no click redirect — and the page says so instead of showing zeros. Open rates are
// also unreliable by nature (Apple Mail Privacy Protection pre-loads images), which is why HOMATCH
// does not present them as engagement. Export is a CSV of exactly what is on screen.

import { Download, Info } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { ErrorState, Kpi, KpiRow, PageHeader, ScrollTable } from '@/components/communications/primitives';
import { PhaseBadge, pct } from '@/components/emailStudio/shared';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { dailySeries, listCampaigns, rate, type SendFact, type StudioCampaign, sendFacts, totalsOf } from '@/services/emailCampaignStudio';

const RANGES = [7, 30, 90, 0] as const;

export default function EmailAnalyticsPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const campaignId = params.get('campaign') ?? 'all';
  const [range, setRange] = useState<(typeof RANGES)[number]>(campaignId === 'all' ? 30 : 0);
  const [campaigns, setCampaigns] = useState<StudioCampaign[] | null>(null);
  const [facts, setFacts] = useState<SendFact[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false); setFacts(null);
    try {
      const since = range ? new Date(Date.now() - range * 86_400_000).toISOString() : null;
      const [c, f] = await Promise.all([listCampaigns(), sendFacts(since)]);
      setCampaigns(c); setFacts(f);
    } catch { setError(true); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const scoped = useMemo(() => (facts ?? []).filter((f) => campaignId === 'all' || f.campaign_id === campaignId), [facts, campaignId]);
  const totals = useMemo(() => totalsOf(scoped), [scoped]);
  const series = useMemo(() => dailySeries(scoped, range && range <= 30 ? range : 30), [scoped, range]);
  const maxDay = Math.max(1, ...series.map((d) => d.accepted));
  const perCampaign = useMemo(() => {
    const by = new Map<string, SendFact[]>();
    for (const f of facts ?? []) by.set(f.campaign_id, [...(by.get(f.campaign_id) ?? []), f]);
    return (campaigns ?? []).filter((c) => by.has(c.id)).map((c) => ({ c, tt: totalsOf(by.get(c.id)!) }))
      .sort((a, b) => b.tt.accepted - a.tt.accepted);
  }, [facts, campaigns]);
  const selected = campaigns?.find((c) => c.id === campaignId) ?? null;
  const loading = facts === null || campaigns === null;

  const exportCsv = () => {
    const head = ['campaign', 'status', 'attempted', 'accepted', 'delivered', 'bounced', 'complained', 'unsubscribed', 'failed', 'delivery_rate', 'bounce_rate', 'complaint_rate'];
    const rows = perCampaign.filter((r) => campaignId === 'all' || r.c.id === campaignId).map(({ c, tt }) => [
      c.name, c.status, tt.attempted, tt.accepted, tt.delivered, tt.bounced, tt.complained, tt.unsubscribed, tt.failed,
      rate(tt.delivered, tt.accepted)?.toFixed(4) ?? '', rate(tt.bounced, tt.accepted)?.toFixed(4) ?? '', rate(tt.complained, tt.accepted)?.toFixed(4) ?? '',
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `homatch-email-analytics-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={selected ? selected.name : t('ems_nav_analytics')} subtitle={t('ems_an_subtitle')}
        secondary={{ label: t('ems_export_csv'), onClick: exportCsv, icon: Download }} />
    }>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={campaignId} onValueChange={(v) => { const n = new URLSearchParams(params); if (v === 'all') n.delete('campaign'); else n.set('campaign', v); setParams(n, { replace: true }); }}>
          <SelectTrigger className="h-9 w-full sm:w-80" aria-label={t('ems_an_campaign')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('ems_an_all')}</SelectItem>
            {(campaigns ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name || t('ems_untitled')}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label={t('ems_range')}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}
              className={cn('h-7 rounded-md px-2.5 text-xs', range === r ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {r ? t('ems_range_days', { n: r }) : t('ems_range_all')}
            </button>
          ))}
        </div>
        {selected ? <PhaseBadge status={selected.status} /> : null}
        {selected ? <Button variant="ghost" size="sm" onClick={() => navigate(`/outreach/email/campaigns/${selected.id}`)}>{t('ems_open_campaign')}</Button> : null}
      </div>

      {error ? <ErrorState messageKey="ems_load_failed" onRetry={() => void load()} /> : null}

      <KpiRow>
        <Kpi labelKey="ems_k_attempted" value={loading ? null : totals.attempted} loading={loading} />
        <Kpi labelKey="ems_k_accepted" value={loading ? null : totals.accepted} sub={t('ems_k_accepted_sub')} loading={loading} />
        <Kpi labelKey="ems_k_delivered" value={loading ? null : totals.delivered} sub={pct(rate(totals.delivered, totals.accepted))} loading={loading} />
        <Kpi labelKey="ems_k_bounced" value={loading ? null : totals.bounced} sub={pct(rate(totals.bounced, totals.accepted))} loading={loading} />
        <Kpi labelKey="ems_k_complaints" value={loading ? null : totals.complained} sub={pct(rate(totals.complained, totals.accepted))} loading={loading} />
        <Kpi labelKey="ems_k_unsubscribes" value={loading ? null : totals.unsubscribed} sub={pct(rate(totals.unsubscribed, totals.accepted))} loading={loading} />
      </KpiRow>

      <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('ems_an_tracking_note')}</p>
      </div>

      <Section titleKey="ems_trend_title" sub={t('ems_trend_sub')}>
        <div className="rounded-2xl border bg-card p-4">
          {loading ? <Skeleton className="h-40 w-full" /> : totals.accepted === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t('ems_trend_empty')}</p> : (
            <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={t('ems_trend_title')}>
              {series.map((d) => (
                <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${d.accepted} / ${d.delivered} / ${d.bounced}`}>
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-[#0C1119]/15" style={{ height: `${(d.accepted / maxDay) * 100}%` }}>
                    <div className="w-full rounded-t bg-[hsl(38_85%_52%)]" style={{ height: `${d.accepted ? (d.delivered / d.accepted) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section titleKey="ems_an_by_campaign">
        {loading ? <Skeleton className="h-32 w-full rounded-2xl" /> : perCampaign.length === 0 ? (
          <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">{t('ems_trend_empty')}</p>
        ) : (
          <div className="rounded-2xl border bg-card">
            <ScrollTable minWidth={720}>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-2xs text-muted-foreground">
                  <tr>{['ems_col_campaign', 'ems_col_accepted', 'ems_col_delivered', 'ems_k_bounced', 'ems_k_complaints', 'ems_k_unsubscribes'].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr>
                </thead>
                <tbody>
                  {perCampaign.map(({ c, tt }) => (
                    <tr key={c.id} className={cn('border-t', c.id === campaignId && 'bg-[hsl(38_90%_97%)]')}>
                      <td className="px-3 py-2.5"><button type="button" className="text-start font-medium hover:underline" onClick={() => setParams({ campaign: c.id }, { replace: true })}>{c.name || t('ems_untitled')}</button></td>
                      <td className="px-3 py-2.5 tabular-nums">{tt.accepted}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(rate(tt.delivered, tt.accepted))}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(rate(tt.bounced, tt.accepted))}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(rate(tt.complained, tt.accepted))}</td>
                      <td className="px-3 py-2.5 tabular-nums">{tt.unsubscribed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </div>
        )}
        <p className="mt-2 text-2xs text-muted-foreground">{t('ems_an_range_note', { since: range ? new Date(Date.now() - range * 86_400_000).toLocaleDateString(lang) : t('ems_range_all') })}</p>
      </Section>
    </CommsWorkspace>
  );
}
