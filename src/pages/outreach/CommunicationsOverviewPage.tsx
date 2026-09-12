// HOMATCH — Communications Overview.
//
// §9. This replaces the old Outreach Hub, which was a menu: four cards that
// said "disabled" and led somewhere else. A menu is not an operational screen.
// What an operator needs on opening this page is the answer to four questions:
// what happened today, what it cost, what is running, and what needs them.
//
// §8 and §105: the existing Outreach routes are NOT deleted. Email, SMS and
// Communities keep working and keep their entries; this page becomes the way
// into all of it, with the new channels beside them rather than instead.
//
// EVERY NUMBER HERE IS REAL OR ABSENT
//
// §93. There is no seeded activity, no illustrative funnel and no placeholder
// chart. A figure that cannot be computed renders as a dot, and an account
// that has never run a campaign gets the first-use path in §108 rather than a
// dashboard of zeroes pretending to be a product.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, BarChart3, Bot, ChevronRight, Mail, MessageSquare,
  Megaphone, Phone, Users, Rocket,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  Kpi, KpiRow, PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  ScrollTable, formatUsd, formatRate, formatDuration, relativeTime,
} from '@/components/communications/primitives';
import {
  getOverviewStats, getAttentionItems, getChannelStatus, listCampaigns, getAnalytics,
  subscribeToCalls,
} from '@/services/communications';
import type {
  AttentionItem, ChannelStatusCard, CommCampaign, CommOverviewStats, AnalyticsResult,
} from '@/types/communications';
import { FUNNEL_STAGES } from '@/lib/comm/vocabulary';
import { cn } from '@/lib/utils';

type Range = '1d' | '7d' | '30d' | '90d';
type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const RANGE_DAYS: Record<Range, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };

export default function CommunicationsOverviewPage() {
  const { t, lang: language } = useLanguage();
  const { supaUser: user } = useAuth();
  const navigate = useNavigate();

  const [range, setRange] = useState<Range>('7d');
  const [series, setSeries] = useState<'ALL' | 'AI_CALL' | 'WHATSAPP'>('ALL');
  const [stats, setStats] = useState<CommOverviewStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [channels, setChannels] = useState<ChannelStatusCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(
    () => new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString(),
    [range],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, c, at, ch] = await Promise.all([
        getOverviewStats(range === '1d' ? undefined : since),
        getAnalytics({ since, channel: series }),
        listCampaigns({ limit: 25 }),
        getAttentionItems(),
        getChannelStatus(),
      ]);
      setStats(s); setAnalytics(a); setCampaigns(c); setAttention(at); setChannels(ch);
    } catch {
      // §80: a persistent failure is inline state, not a toast that fades.
      setError('comm_overview_load_failed');
    } finally {
      setLoading(false);
    }
  }, [since, range, series]);

  useEffect(() => { void load(); }, [load]);

  // §124: live updates through one scoped channel, not one per row.
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToCalls(user.id, () => { void load(); });
  }, [user?.id, load]);

  const activeCampaigns = campaigns.filter((c) => ['RUNNING', 'SCHEDULED', 'REVIEW_REQUIRED', 'COMPLIANCE_PAUSED', 'PAUSED'].includes(c.status));
  const neverUsed = !loading && !campaigns.length && (stats?.callsToday ?? 0) === 0 && (stats?.whatsappConversations ?? 0) === 0;

  return (
    <RouteGuard>
      <AppLayout>
        <div className="mx-auto max-w-6xl space-y-5">
          <PageHeader
            title={t('comms_title')}
            subtitle={t('comms_subtitle')}
            primary={{ label: t('comm_new_campaign'), onClick: () => navigate('/outreach/campaigns/new') }}
            secondary={{ label: t('comm_create_agent'), onClick: () => navigate('/outreach/agents') }}
          >
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="h-8 w-[120px] text-xs" aria-label={t('comm_date_range')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">{t('comm_range_today')}</SelectItem>
                <SelectItem value="7d">{t('comm_range_7d')}</SelectItem>
                <SelectItem value="30d">{t('comm_range_30d')}</SelectItem>
                <SelectItem value="90d">{t('comm_range_90d')}</SelectItem>
              </SelectContent>
            </Select>
          </PageHeader>

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {/* §108: a first-time account gets three steps, not an empty dashboard. */}
          {neverUsed ? <FirstUse onNavigate={navigate} /> : null}

          {!neverUsed ? (
            <>
              <KpiRow cols={6}>
                <Kpi labelKey="comm_kpi_conversations" value={stats?.conversationsToday ?? null} loading={loading} />
                <Kpi labelKey="comm_kpi_calls" value={stats?.callsToday ?? null} loading={loading} />
                <Kpi labelKey="comm_kpi_whatsapp" value={stats?.whatsappConversations ?? null} loading={loading} />
                <Kpi labelKey="comm_kpi_qualified" value={stats?.qualifiedLeads ?? null} accent loading={loading} />
                <Kpi labelKey="comm_kpi_viewings" value={stats?.viewingsRequested ?? null} loading={loading} />
                <Kpi labelKey="comm_kpi_spend" value={formatUsd(stats?.spendTodayUsd ?? null, language)} loading={loading} />
              </KpiRow>

              <KpiRow cols={6}>
                <Kpi labelKey="comm_kpi_answer_rate" value={formatRate(stats?.answerRate)} loading={loading} />
                <Kpi labelKey="comm_kpi_reply_rate" value={formatRate(stats?.replyRate)} loading={loading} />
                <Kpi labelKey="comm_kpi_qualification_rate" value={formatRate(stats?.qualificationRate)} loading={loading} />
                <Kpi labelKey="comm_kpi_cost_per_lead" value={formatUsd(stats?.costPerQualifiedLeadUsd ?? null, language)} loading={loading} />
                <Kpi labelKey="comm_kpi_avg_duration" value={formatDuration(stats?.averageCallDurationSec)} loading={loading} />
                <Kpi labelKey="comm_kpi_ai_resolution" value={formatRate(stats?.aiResolutionRate)} loading={loading} />
              </KpiRow>

              <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">{t('comm_activity_title')}</h2>
                      <Tabs value={series} onValueChange={(v) => setSeries(v as typeof series)}>
                        <TabsList className="h-7">
                          <TabsTrigger value="ALL" className="h-6 px-2 text-xs">{t('comm_series_all')}</TabsTrigger>
                          <TabsTrigger value="AI_CALL" className="h-6 px-2 text-xs">{t('comm_series_calls')}</TabsTrigger>
                          <TabsTrigger value="WHATSAPP" className="h-6 px-2 text-xs">{t('comm_series_whatsapp')}</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    {loading ? <LoadingBlock rows={3} /> : <ActivityChart data={analytics?.series ?? []} />}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <h2 className="mb-3 text-sm font-semibold">{t('comm_funnel_title')}</h2>
                    {loading ? <LoadingBlock rows={3} /> : <Funnel data={analytics?.funnel ?? []} />}
                  </CardContent>
                </Card>
              </div>

              <section aria-labelledby="active-campaigns">
                <div className="mb-2 flex items-center justify-between">
                  <h2 id="active-campaigns" className="text-sm font-semibold">{t('comm_active_campaigns')}</h2>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/campaigns')}>
                    {t('comm_view_all')} <ChevronRight className="ms-1 h-3.5 w-3.5" />
                  </Button>
                </div>
                {loading ? <LoadingBlock rows={3} /> : activeCampaigns.length ? (
                  <ActiveCampaignsTable campaigns={activeCampaigns} onOpen={(id) => navigate(`/outreach/campaigns?c=${id}`)} />
                ) : (
                  <EmptyState
                    icon={Megaphone}
                    titleKey="comm_no_active_campaigns"
                    bodyKey="comm_no_active_campaigns_body"
                    action={{ labelKey: 'comm_new_campaign', onClick: () => navigate('/outreach/campaigns/new') }}
                  />
                )}
              </section>

              {attention.length ? (
                <section aria-labelledby="needs-attention">
                  <h2 id="needs-attention" className="mb-2 text-sm font-semibold">{t('comm_needs_attention')}</h2>
                  <div className="space-y-2">
                    {attention.map((item) => (
                      <Card key={item.id} className={cn(
                        'border-s-2',
                        item.severity === 'CRITICAL' ? 'border-s-red-500' : 'border-s-amber-500',
                      )}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <AlertTriangle className={cn(
                              'h-4 w-4 shrink-0',
                              item.severity === 'CRITICAL' ? 'text-red-500' : 'text-amber-500',
                            )} aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">{t(item.titleKey as TKey)}</p>
                              {item.detail ? <p className="truncate text-[13px] text-muted-foreground">{item.detail}</p> : null}
                            </div>
                          </div>
                          {item.href ? (
                            <Button size="sm" variant="outline" onClick={() => navigate(item.href!)}>
                              {t('comm_open')}
                            </Button>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <section aria-labelledby="channels">
            <h2 id="channels" className="mb-2 text-sm font-semibold">{t('comm_channels')}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ChannelCard
                icon={Phone} labelKey="comm_channel_calls"
                state={channels.find((c) => c.channel === 'AI_CALL')?.state ?? 'NOT_CONFIGURED'}
                onClick={() => navigate('/outreach/calls')}
              />
              <ChannelCard
                icon={MessageSquare} labelKey="comm_channel_whatsapp"
                state={channels.find((c) => c.channel === 'WHATSAPP')?.state ?? 'NOT_CONFIGURED'}
                badge={channels.find((c) => c.channel === 'WHATSAPP')?.detail === 'TEST' ? t('comm_test_mode') : null}
                onClick={() => navigate('/outreach/whatsapp')}
              />
              {/* The existing channels keep their place (§8). */}
              <ChannelCard icon={Mail} labelKey="comm_channel_email" state="DISABLED" onClick={() => navigate('/outreach/email')} />
              <ChannelCard icon={Users} labelKey="comm_channel_communities" state="DISABLED" onClick={() => navigate('/outreach/communities')} />
            </div>
          </section>

          <nav aria-label={t('comms_title')} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <QuickLink icon={Bot} labelKey="comm_nav_agents" onClick={() => navigate('/outreach/agents')} />
            <QuickLink icon={Users} labelKey="comm_nav_contacts" onClick={() => navigate('/outreach/contact-lists')} />
            <QuickLink icon={BarChart3} labelKey="comm_nav_analytics" onClick={() => navigate('/outreach/analytics')} />
            <QuickLink icon={Activity} labelKey="comm_nav_insights" onClick={() => navigate('/outreach/insights')} />
          </nav>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

function FirstUse({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { t } = useLanguage();
  const steps = [
    { icon: Bot, titleKey: 'comm_firstrun_step1', bodyKey: 'comm_firstrun_step1_body', to: '/outreach/agents' },
    { icon: Users, titleKey: 'comm_firstrun_step2', bodyKey: 'comm_firstrun_step2_body', to: '/outreach/contact-lists' },
    { icon: Rocket, titleKey: 'comm_firstrun_step3', bodyKey: 'comm_firstrun_step3_body', to: '/outreach/campaigns/new' },
  ];
  return (
    <Card className="border-gold/30 bg-gold/[0.03]">
      <CardContent className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold">{t('comm_firstrun_title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('comm_firstrun_body')}</p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {steps.map(({ icon: Icon, titleKey, bodyKey, to }, i) => (
            <li key={to}>
              <button
                type="button"
                onClick={() => onNavigate(to)}
                className="flex h-full w-full flex-col rounded-lg border bg-background p-3 text-start transition-colors hover:border-gold/50"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/15 text-[13px] font-semibold text-gold-ink">
                    {i + 1}
                  </span>
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
                <span className="mt-2 text-xs font-medium">{t(titleKey as TKey)}</span>
                <span className="mt-0.5 text-[13px] text-muted-foreground">{t(bodyKey as TKey)}</span>
              </button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * The activity chart.
 *
 * Deliberately an SVG bar chart rather than a charting library: §85 says not
 * to load weight the page does not need, this renders a handful of bars, and
 * §84 requires the same information to exist as text — which the KPI row above
 * already provides, so the chart is reinforcement rather than the only source.
 */
function ActivityChart({ data }: { data: AnalyticsResult['series'] }) {
  const { t, lang: language } = useLanguage();
  if (!data.length) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{t('comm_no_activity')}</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.calls + d.messages));
  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label={t('comm_activity_title')}>
        {data.map((d) => {
          const total = d.calls + d.messages;
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col justify-end gap-px" title={`${d.date}: ${total}`}>
              <div
                className="w-full rounded-t-sm bg-foreground/80"
                style={{ height: `${(d.calls / max) * 100}%` }}
              />
              <div
                className="w-full bg-foreground/30"
                style={{ height: `${(d.messages / max) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px] text-muted-foreground">
        <span>{new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(new Date(data[0].date))}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-foreground/80" />{t('comm_series_calls')}</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-foreground/30" />{t('comm_series_whatsapp')}</span>
        </span>
        <span>{new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(new Date(data[data.length - 1].date))}</span>
      </div>
    </div>
  );
}

function Funnel({ data }: { data: AnalyticsResult['funnel'] }) {
  const { t } = useLanguage();
  const max = Math.max(1, ...data.map((d) => d.count));
  const anything = data.some((d) => d.count > 0);
  if (!anything) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{t('comm_no_funnel')}</p>;
  }
  return (
    <ol className="space-y-1.5">
      {FUNNEL_STAGES.map((stage) => {
        const row = data.find((d) => d.stage === stage);
        const count = row?.count ?? 0;
        return (
          <li key={stage} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{t(`comm_stage_${stage.toLowerCase()}` as TKey)}</span>
              <span className="tabular-nums font-medium">{count}</span>
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
  );
}

function ActiveCampaignsTable({ campaigns, onOpen }: { campaigns: CommCampaign[]; onOpen: (id: string) => void }) {
  const { t, lang: language } = useLanguage();
  return (
    <ScrollTable minWidth={860}>
      <table className="w-full text-xs">
        <thead className="border-b bg-muted/40 text-start">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
            <th>{t('comm_col_campaign')}</th>
            <th>{t('comm_col_channel')}</th>
            <th>{t('comm_col_status')}</th>
            <th>{t('comm_col_progress')}</th>
            <th>{t('comm_col_spend')}</th>
            <th>{t('comm_col_started')}</th>
            <th className="w-8" aria-label={t('comm_open')} />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const sent = c.sent_count ?? 0;
            const pct = c.audience_count ? Math.min(100, Math.round((sent / c.audience_count) * 100)) : 0;
            return (
              <tr
                key={c.id}
                className="cursor-pointer border-b last:border-0 hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2"
                onClick={() => onOpen(c.id)}
              >
                <td className="max-w-[220px] truncate font-medium">{c.name}</td>
                <td>{t(`comm_channel_${c.campaign_type.toLowerCase()}` as TKey)}</td>
                <td><StatusBadge status={c.status} /></td>
                <td className="tabular-nums">{sent}/{c.audience_count} <span className="text-muted-foreground">({pct}%)</span></td>
                <td className="tabular-nums">{formatUsd(c.cost_actual_usd, language)}</td>
                <td className="text-muted-foreground">{relativeTime(c.launched_at ?? c.created_at, language)}</td>
                <td><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function ChannelCard({
  icon: Icon, labelKey, state, badge, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  state: ChannelStatusCard['state'];
  badge?: string | null;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border bg-card p-3 text-start transition-colors hover:border-foreground/20"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{t(labelKey as TKey)}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          {t(`comm_channel_state_${state.toLowerCase()}` as TKey)}
        </p>
      </div>
      {badge ? <Badge variant="outline" className="shrink-0 text-[13px]">{badge}</Badge> : null}
    </button>
  );
}

function QuickLink({
  icon: Icon, labelKey, onClick,
}: { icon: React.ComponentType<{ className?: string }>; labelKey: string; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 text-start text-xs font-medium transition-colors hover:border-foreground/20"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t(labelKey as TKey)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}
