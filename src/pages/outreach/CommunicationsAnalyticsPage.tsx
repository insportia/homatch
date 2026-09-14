// HOMATCH — Communications analytics.
//
// §77. Every figure here is derived from stored events, and §93 is why that
// sentence matters: there is no seeded data, no illustrative series and no
// demo mode. An account with no activity sees empty states.
//
// §77 also draws a line this page respects: "Do not invent revenue attribution
// if Homatch does not possess transaction data." Homatch knows what a campaign
// COST and how many leads it qualified. It does not know what any of them
// eventually sold for, so there is no revenue column and no ROI figure.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Kpi, KpiRow, PageHeader, LoadingBlock, EmptyState, ErrorState,
  ScrollTable, formatUsd, formatRate, formatDuration,
} from '@/components/communications/primitives';
import { getAnalytics, listCampaigns } from '@/services/communications';
import type { AnalyticsResult, CommCampaign } from '@/types/communications';
import { FUNNEL_STAGES } from '@/lib/comm/vocabulary';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
type Range = '7d' | '30d' | '90d' | '180d';
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180 };

export default function CommunicationsAnalyticsPage() {
  const { t, lang: language } = useLanguage();

  const [range, setRange] = useState<Range>('30d');
  const [channel, setChannel] = useState('ALL');
  const [campaignId, setCampaignId] = useState('ALL');
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(
    () => new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString(),
    [range],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [result, campaignRows] = await Promise.all([
        getAnalytics({ since, channel, campaignId: campaignId === 'ALL' ? undefined : campaignId }),
        listCampaigns({ limit: 200 }),
      ]);
      setData(result);
      setCampaigns(campaignRows);
    } catch {
      setError('comm_analytics_load_failed');
    } finally {
      setLoading(false);
    }
  }, [since, channel, campaignId]);

  useEffect(() => { void load(); }, [load]);

  const anything = Boolean(data && (data.callStats.attempted > 0 || data.messageStats.sent > 0));
  const maxSeries = Math.max(1, ...(data?.series ?? []).map((d) => d.calls + d.messages));

  return (
    <CommsWorkspace product="hub">
        <div className="space-y-4">
          <PageHeader title={t('comm_analytics_title')} subtitle={t('comm_analytics_subtitle')}>
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="h-8 w-[110px] text-xs" aria-label={t('comm_date_range')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">{t('comm_range_7d')}</SelectItem>
                <SelectItem value="30d">{t('comm_range_30d')}</SelectItem>
                <SelectItem value="90d">{t('comm_range_90d')}</SelectItem>
                <SelectItem value="180d">{t('comm_range_180d')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger className="h-8 w-[160px] text-xs" aria-label={t('comm_col_campaign')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('comm_all_campaigns')}</SelectItem>
                {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </PageHeader>

          <Tabs value={channel} onValueChange={setChannel}>
            <TabsList className="h-8">
              <TabsTrigger value="ALL" className="h-7 px-2.5 text-xs">{t('comm_filter_all')}</TabsTrigger>
              <TabsTrigger value="AI_CALL" className="h-7 px-2.5 text-xs">{t('comm_channel_ai_call')}</TabsTrigger>
              <TabsTrigger value="WHATSAPP" className="h-7 px-2.5 text-xs">{t('comm_channel_whatsapp')}</TabsTrigger>
            </TabsList>
          </Tabs>

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {loading ? <LoadingBlock rows={6} /> : !anything ? (
            <EmptyState icon={BarChart3} titleKey="comm_analytics_empty" bodyKey="comm_analytics_empty_body" />
          ) : (
            <>
              <KpiRow cols={5}>
                <Kpi labelKey="comm_kpi_interactions" value={(data!.callStats.attempted + data!.messageStats.sent)} />
                <Kpi labelKey="comm_kpi_qualified" value={data!.qualified} accent />
                <Kpi labelKey="comm_kpi_spend" value={formatUsd(data!.spendUsd, language)} />
                <Kpi labelKey="comm_kpi_cost_per_lead" value={formatUsd(data!.costPerQualifiedUsd, language)} />
                <Kpi labelKey="comm_kpi_answer_rate" value={formatRate(data!.callStats.answerRate)} />
              </KpiRow>

              <Card><CardContent className="p-4">
                <h2 className="mb-3 text-sm font-semibold">{t('comm_activity_title')}</h2>
                <div className="flex h-44 items-end gap-0.5" role="img" aria-label={t('comm_activity_title')}>
                  {data!.series.map((d) => (
                    <div key={d.date} className="flex min-w-0 flex-1 flex-col justify-end gap-px" title={`${d.date}`}>
                      <div className="w-full rounded-t-sm bg-foreground/80" style={{ height: `${(d.calls / maxSeries) * 100}%` }} />
                      <div className="w-full bg-foreground/30" style={{ height: `${(d.messages / maxSeries) * 100}%` }} />
                    </div>
                  ))}
                </div>
                {/* §84: the same information as text, for anyone who cannot
                    read the bars. */}
                <ScrollTable minWidth={520}>
                  <table className="mt-3 w-full text-[13px]">
                    <thead className="border-b bg-muted/40">
                      <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                        <th>{t('comm_col_date')}</th>
                        <th>{t('comm_series_calls')}</th>
                        <th>{t('comm_series_whatsapp')}</th>
                        <th>{t('comm_kpi_qualified')}</th>
                        <th>{t('comm_col_spend')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.series.slice(-14).map((d) => (
                        <tr key={d.date} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1">
                          <td>{d.date}</td>
                          <td className="tabular-nums">{d.calls}</td>
                          <td className="tabular-nums">{d.messages}</td>
                          <td className="tabular-nums">{d.qualified}</td>
                          <td className="tabular-nums">{formatUsd(d.spend, language)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              </CardContent></Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardContent className="p-4">
                  <h2 className="mb-3 text-sm font-semibold">{t('comm_call_analytics')}</h2>
                  <dl className="space-y-1.5 text-xs">
                    <Row label={t('comm_calls_attempted')} value={String(data!.callStats.attempted)} />
                    <Row label={t('comm_calls_answered')} value={String(data!.callStats.answered)} />
                    <Row label={t('comm_kpi_answer_rate')} value={formatRate(data!.callStats.answerRate)} />
                    <Row label={t('comm_kpi_avg_duration')} value={formatDuration(data!.callStats.avgDurationSec)} />
                  </dl>
                  {Object.keys(data!.callStats.outcomes).length ? (
                    <>
                      <h3 className="mb-1.5 mt-3 text-xs font-medium">{t('comm_outcomes')}</h3>
                      <ul className="space-y-1">
                        {Object.entries(data!.callStats.outcomes)
                          .sort(([, a], [, b]) => b - a)
                          .map(([outcome, count]) => (
                            <li key={outcome} className="flex items-center justify-between text-[13px]">
                              <span>{t(`comm_outcome_${outcome.toLowerCase()}` as TKey)}</span>
                              <span className="font-medium tabular-nums">{count}</span>
                            </li>
                          ))}
                      </ul>
                    </>
                  ) : null}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <h2 className="mb-3 text-sm font-semibold">{t('comm_funnel_title')}</h2>
                  <ol className="space-y-1.5">
                    {FUNNEL_STAGES.map((stage) => {
                      const count = data!.funnel.find((f) => f.stage === stage)?.count ?? 0;
                      const max = Math.max(1, ...data!.funnel.map((f) => f.count));
                      return (
                        <li key={stage} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span>{t(`comm_stage_${stage.toLowerCase()}` as TKey)}</span>
                            <span className="font-medium tabular-nums">{count}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn('h-full rounded-full', stage === 'CONVERTED' ? 'bg-gold' : 'bg-foreground/50')}
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent></Card>
              </div>
            </>
          )}
        </div>
    </CommsWorkspace>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
