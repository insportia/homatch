// HOMATCH — the AI Call Center.
//
// §18, §19 and §20. This is what /outreach/calls mounts: what is on the wire
// right now, everything that has happened, and one call in full.
//
// It was not always. This page shipped at /outreach/calls/log while the
// pre-Communications screen kept /outreach/calls — the route the home page,
// the footer, the action launcher, the shell nav and the Communications hub
// all point at. So the product had a real call centre nothing linked to, and
// a legacy one every path led to, whose banner told customers that AI calling
// was disabled and campaigns ran with a MOCK provider. Neither half of that
// was true any more.
//
// Campaign creation lives in the campaign screens rather than here: one
// six-step builder that knows about both calling and WhatsApp beats two
// half-builders that each know about one.
//
// §20's recording rule is the one with teeth. A recording is played through a
// URL the provider gave us and that Homatch stores privately — it is never
// rendered as a bare link for anyone to pass around, and it is only offered
// when a recording actually exists.
//
// §18's other rule: "Do not fake controls when provider cannot support them."
// There is no Listen button and no End call button on this screen, because
// whether either is possible depends on the live call exposing a control
// channel, and a button that silently does nothing is worse than no button.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Phone, PhoneCall, Search, X, Bot, Users, Megaphone, Target, Clock,
  TrendingUp, Wallet, PhoneOff, ArrowRight,
} from 'lucide-react';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { ChannelModule } from '@/components/communications/ChannelModule';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  Kpi, KpiRow, PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  LiveDot, ScrollTable, formatUsd, formatDuration, formatPhone, relativeTime,
} from '@/components/communications/primitives';
import {
  listCalls, listLiveCalls, getCall, listCampaigns, listAgents, subscribeToCalls,
} from '@/services/communications';
import type { CommSend, CommExtraction, CommCampaign, AgentListRow } from '@/types/communications';
import { isCallLive } from '@/lib/comm/vocabulary';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

export default function CallsPage() {
  const { t, lang: language } = useLanguage();
  const { supaUser: user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [live, setLive] = useState<CommSend[]>([]);
  const [calls, setCalls] = useState<CommSend[]>([]);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [agents, setAgents] = useState<AgentListRow[]>([]);
  const [detail, setDetail] = useState<{ send: CommSend | null; extraction: CommExtraction | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('ALL');
  const [outcome, setOutcome] = useState('ALL');
  const [campaignId, setCampaignId] = useState(params.get('campaign') ?? 'ALL');
  const [search, setSearch] = useState('');
  const [qualifiedOnly, setQualifiedOnly] = useState(false);

  const selectedId = params.get('call');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [liveRows, rows, campaignRows, agentRows] = await Promise.all([
        listLiveCalls(),
        listCalls({
          status, outcome, search: search.trim() || undefined,
          qualifiedOnly,
          campaignId: campaignId === 'ALL' ? undefined : campaignId,
          limit: 200,
        }),
        listCampaigns({ channel: 'AI_CALL', limit: 100 }),
        listAgents(8),
      ]);
      setLive(liveRows);
      setCalls(rows);
      setCampaigns(campaignRows);
      setAgents(agentRows);
    } catch {
      setError('comm_calls_load_failed');
    } finally {
      setLoading(false);
    }
  }, [status, outcome, search, qualifiedOnly, campaignId]);

  useEffect(() => { void load(); }, [load]);

  // §124: live call rows update through one scoped channel.
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToCalls(user.id, () => { void load(); });
  }, [user?.id, load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    void getCall(selectedId).then(setDetail);
  }, [selectedId]);

  const stats = useMemo(() => {
    const attempted = calls.filter((c) => !['PENDING', 'QUEUED', 'SUPPRESSED'].includes(c.status));
    const answered = calls.filter((c) => ['ANSWERED', 'COMPLETED'].includes(c.status));
    const durations = answered.map((c) => c.duration_sec ?? 0).filter((d) => d > 0);
    const qualified = calls.filter((c) => (c.lead_score ?? 0) >= 60).length;
    const spend = calls.reduce((s, c) => s + (Number(c.cost_usd) || 0), 0);
    return {
      total: attempted.length,
      answerRate: attempted.length ? `${Math.round((answered.length / attempted.length) * 100)}%` : null,
      avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      qualified,
      callbacks: calls.filter((c) => c.outcome === 'CALLBACK').length,
      spend,
      costPerLead: qualified ? spend / qualified : null,
    };
  }, [calls]);

  /*
   * Outcomes, counted from the calls actually loaded. Only codes that really
   * occurred appear, so an account with three interested callers shows one
   * tile rather than six categories of zero.
   */
  const outcomeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) {
      if (!c.outcome) continue;
      counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [calls]);

  const hasNothing = !loading && !calls.length && !campaigns.length;

  return (
    <CommsWorkspace product="calls"
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-ink">
              {t('comms_ch_calls')}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight sm:text-2xl">{t('comm_calls_title')}</h1>
            <p className="mt-1 max-w-[46rem] text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('comm_calls_subtitle')}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" onClick={() => navigate('/outreach/calls/campaigns/new')}>
              {t('comms_calls_new_campaign')}
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => navigate('/outreach/campaigns?channel=AI_CALL')}>
              {t('comm_campaigns_title')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate('/outreach/agents')}>
              {t('comms_create_agent')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate('/outreach/contacts/import')}>
              {t('comms_import_contacts')}
            </Button>
          </div>
        </div>
      }
    >
          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {/*
           * A BRAND NEW ACCOUNT IS NOT AN EMPTY TABLE.
           *
           * With no calls and no campaigns there is nothing to measure, so
           * measuring it would be six zeros pretending to be performance. What
           * a first-time operator needs instead is what this thing does and
           * where to start, which is a product rather than a placeholder.
           */}
          {hasNothing ? (
            <Card className="border-foreground/10">
              <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-snug">{t('comms_calls_start_title')}</h2>
                  <p className="mt-1 max-w-[42rem] text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                    {t('comms_calls_start_body')}
                  </p>
                  <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                    {['comms_calls_cap_1', 'comms_calls_cap_2', 'comms_calls_cap_3', 'comms_calls_cap_4'].map((k) => (
                      <li key={k} className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
                        <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{t(k as TKey)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2 lg:flex-col">
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => navigate('/outreach/agents')}>
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />{t('comms_create_agent')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/outreach/contacts/import')}>
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />{t('comms_import_contacts')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/outreach/calls/campaigns/new')}>
                    <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />{t('comms_calls_new_campaign')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/*
           * EVERYTHING BELOW MEASURES CALLS. WITH NO CALLS IT MEASURES NOTHING.
           *
           * The card above already says so, and then this used to render six
           * KPIs reading zero, an empty campaigns box, an empty agents box and
           * a search field over an empty table -- four more ways to say "no
           * data" underneath the one that said it properly, which is what made
           * a new account look like a broken product rather than a new one.
           *
           * Every action from these sections is on the start card, so nothing
           * becomes unreachable by not drawing them.
           */}
          {hasNothing ? null : (<>
          <Section titleKey="comms_calls_performance" sub={t('comms_calls_performance_sub')}>
            <KpiRow cols={6}>
              <Kpi labelKey="comm_kpi_calls" icon={PhoneCall} value={stats.total} loading={loading} />
              <Kpi labelKey="comm_kpi_answer_rate" icon={TrendingUp} value={stats.answerRate} loading={loading} />
              <Kpi labelKey="comm_kpi_avg_duration" icon={Clock} value={formatDuration(stats.avgDuration)} loading={loading} />
              <Kpi labelKey="comm_kpi_qualified" icon={Target} value={stats.qualified} accent loading={loading} />
              <Kpi labelKey="comm_outcome_callback" icon={Phone} value={stats.callbacks} loading={loading} />
              <Kpi labelKey="comm_kpi_cost_per_lead" icon={Wallet} value={formatUsd(stats.costPerLead, language)} loading={loading} />
            </KpiRow>
          </Section>

          {/* §18's Live Calls panel. Shown only when something is actually on
              the wire, so it is never an empty box pretending to be a feature. */}
          {live.length ? (
            <Card className="border-emerald-500/30">
              <CardContent className="p-4">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <LiveDot label={t('comm_calls_live')} />
                  {t('comm_calls_live')} ({live.length})
                </h2>
                <ul className="space-y-1.5">
                  {live.map((call) => (
                    <li key={call.id}>
                      <button
                        type="button"
                        onClick={() => setParams({ call: call.id }, { replace: true })}
                        className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-start transition-colors hover:border-foreground/20"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{formatPhone(call.recipient_phone)}</span>
                          <span className="text-[13px] text-muted-foreground">
                            {call.language ? call.language.toUpperCase() : '·'}
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {call.call_started_at ? <LiveTimer startedAt={call.call_started_at} /> : null}
                          <StatusBadge status={call.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* ── Campaigns and agents, side by side ─────────────────────
              The two things a call centre is made of. Neither was on this
              screen before, so an operator could see what had happened but
              not what was running or who was running it. */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              titleKey="comms_calls_campaigns"
              sub={t('comms_calls_campaigns_sub')}
              action={{ label: t('comms_see_all'), onClick: () => navigate('/outreach/campaigns?channel=AI_CALL') }}
            >
              {loading ? <LoadingBlock rows={2} /> : campaigns.length === 0 ? (
                <EmptyState
                  icon={Megaphone}
                  titleKey="comms_calls_no_campaigns"
                  bodyKey="comms_calls_no_campaigns_body"
                  action={{ labelKey: 'comms_calls_new_campaign', onClick: () => navigate('/outreach/calls/campaigns/new') }}
                />
              ) : (
                <ul className="grid gap-2">
                  {campaigns.slice(0, 5).map((c) => {
                    const sent = c.sent_count ?? 0;
                    const pct = c.audience_count ? Math.min(100, Math.round((sent / c.audience_count) * 100)) : 0;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCampaignId(c.id)}
                          className="w-full min-w-0 rounded-lg border bg-card p-3 text-start transition-colors hover:border-foreground/25"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <PhoneCall className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                            <StatusBadge status={c.status} />
                          </span>
                          {/* Progress is sent over audience, both real columns.
                              A campaign with no audience shows no bar rather
                              than a full one. */}
                          {c.audience_count ? (
                            <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                              <span
                                className="block h-full rounded-full bg-gold transition-[width] duration-500 motion-reduce:transition-none"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          ) : null}
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
                            <span className="tabular-nums">{sent}/{c.audience_count}</span>
                            <span aria-hidden="true">·</span>
                            <span>{relativeTime(c.launched_at ?? c.created_at, language)}</span>
                            {c.cost_actual_usd ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{formatUsd(c.cost_actual_usd, language)}</span>
                              </>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section
              titleKey="comms_your_agents"
              action={{ label: t('comms_see_all'), onClick: () => navigate('/outreach/agents') }}
            >
              {loading ? <LoadingBlock rows={2} /> : agents.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  titleKey="comms_no_agents"
                  bodyKey="comms_no_agents_body"
                  action={{ labelKey: 'comms_create_agent', onClick: () => navigate('/outreach/agents') }}
                />
              ) : (
                <ul className="grid gap-2">
                  {agents.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/outreach/agents/${a.id}`)}
                        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border bg-card p-2.5 text-start transition-colors hover:border-foreground/25"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gold/30 bg-gold/[0.06] text-gold-ink">
                          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{a.name}</span>
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {a.voice_label ?? (a.languages ?? []).join(' · ').toUpperCase() ?? '·'}
                          </span>
                        </span>
                        <StatusBadge status={a.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {/* ── Outcomes, counted from the calls actually in view ───────── */}
          {outcomeCounts.length ? (
            <Section titleKey="comms_calls_outcomes" sub={t('comms_calls_outcomes_sub')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {outcomeCounts.map(([code, n]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setOutcome(code)}
                    className="min-w-0 rounded-lg border bg-card p-3 text-start transition-colors hover:border-foreground/25"
                  >
                    <p className="text-[13px] leading-[1.25] text-muted-foreground [overflow-wrap:anywhere]">
                      {t(`comm_outcome_${code.toLowerCase()}`)}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{n}</p>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          <Section titleKey="comms_calls_recent" sub={t('comms_calls_recent_sub')}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('comm_calls_search')} aria-label={t('comm_calls_search')}
                className="h-8 ps-8 text-xs"
              />
            </div>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger className="h-8 w-[150px] text-xs" aria-label={t('comm_col_campaign')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('comm_all_campaigns')}</SelectItem>
                {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={t('comm_col_status')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('comm_filter_all')}</SelectItem>
                {['COMPLETED', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED'].map((s) => (
                  <SelectItem key={s} value={s}>{t(`comm_status_${s.toLowerCase()}` as TKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="h-8 w-[150px] text-xs" aria-label={t('comm_outcomes')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('comm_filter_all')}</SelectItem>
                {['QUALIFIED', 'INTERESTED', 'CALLBACK', 'NOT_INTERESTED', 'HUMAN_HANDOFF'].map((o) => (
                  <SelectItem key={o} value={o}>{t(`comm_outcome_${o.toLowerCase()}` as TKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm" variant={qualifiedOnly ? 'default' : 'outline'}
              onClick={() => setQualifiedOnly((v) => !v)}
            >
              {t('comm_calls_qualified_only')}
            </Button>
          </div>

          {loading ? <LoadingBlock rows={5} /> : !calls.length ? (
            <EmptyState
              icon={Phone}
              titleKey="comm_calls_empty"
              bodyKey="comm_calls_empty_body"
              action={{ labelKey: 'comm_new_campaign_call', onClick: () => navigate('/outreach/calls/campaigns/new') }}
            />
          ) : (
            <ScrollTable minWidth={900}>
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                    <th>{t('comm_col_contact')}</th>
                    <th>{t('comm_col_status')}</th>
                    <th>{t('comm_outcomes')}</th>
                    <th>{t('comm_col_duration')}</th>
                    <th>{t('comm_lead_score')}</th>
                    <th>{t('comm_field_language')}</th>
                    <th>{t('comm_col_spend')}</th>
                    <th>{t('comm_col_created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr
                      key={call.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/30 [&>td]:px-3 [&>td]:py-2"
                      onClick={() => setParams({ call: call.id }, { replace: true })}
                    >
                      <td className="font-mono">
                        <span className="flex items-center gap-1.5">
                          {isCallLive(call.status) ? <LiveDot label={t('comm_calls_live')} /> : null}
                          {formatPhone(call.recipient_phone)}
                        </span>
                      </td>
                      <td><StatusBadge status={call.status} /></td>
                      <td>{call.outcome ? t(`comm_outcome_${call.outcome.toLowerCase()}` as TKey) : '·'}</td>
                      <td className="tabular-nums">{formatDuration(call.duration_sec)}</td>
                      <td className={cn('tabular-nums', (call.lead_score ?? 0) >= 60 && 'font-semibold text-gold-ink')}>
                        {call.lead_score ?? '·'}
                      </td>
                      <td className="uppercase">{call.language ?? '·'}</td>
                      <td className="tabular-nums">{formatUsd(call.cost_usd, language)}</td>
                      <td className="text-muted-foreground">{relativeTime(call.created_at, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          )}
          </Section>
          </>)}

        <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setParams({}, { replace: true })}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
            <SheetTitle className="text-sm">{t('comm_call_detail')}</SheetTitle>
            <CallDetail data={detail} />
          </SheetContent>
        </Sheet>
    </CommsWorkspace>
  );
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return (
    <span className="font-mono text-[13px] tabular-nums">
      {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
    </span>
  );
}

function CallDetail({ data }: { data: { send: CommSend | null; extraction: CommExtraction | null } | null }) {
  const { t, lang: language } = useLanguage();
  if (!data) return <div className="mt-3"><LoadingBlock rows={5} /></div>;
  const { send, extraction } = data;
  if (!send) return <p className="mt-3 text-xs text-muted-foreground">{t('comm_call_not_found')}</p>;

  const facts: Array<[string, string | null]> = [
    ['comm_contact_intent', extraction?.transaction_type ?? null],
    ['comm_contact_locations', extraction?.locations?.join(', ') ?? null],
    ['comm_contact_budget', extraction?.budget_max
      ? new Intl.NumberFormat(language, { style: 'currency', currency: extraction.currency ?? 'USD', maximumFractionDigits: 0 }).format(extraction.budget_max)
      : null],
    ['comm_contact_bedrooms', extraction?.bedrooms != null ? String(extraction.bedrooms) : null],
    ['comm_contact_property_type', extraction?.property_type ?? null],
    ['comm_contact_timeline', extraction?.timeline ?? null],
  ];

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono font-medium">{formatPhone(send.recipient_phone)}</span>
        <StatusBadge status={send.status} />
        {send.outcome ? (
          <Badge variant="outline" className="text-[13px]">
            {t(`comm_outcome_${send.outcome.toLowerCase()}` as TKey)}
          </Badge>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-lg border p-2.5 text-[13px]">
        <div><dt className="text-muted-foreground">{t('comm_col_duration')}</dt><dd className="font-medium">{formatDuration(send.duration_sec)}</dd></div>
        <div><dt className="text-muted-foreground">{t('comm_col_spend')}</dt><dd className="font-medium">{formatUsd(send.cost_usd, language)}</dd></div>
        <div><dt className="text-muted-foreground">{t('comm_lead_score')}</dt><dd className="font-medium">{send.lead_score ?? '·'}</dd></div>
        <div><dt className="text-muted-foreground">{t('comm_col_created')}</dt><dd className="font-medium">{relativeTime(send.created_at, language)}</dd></div>
      </dl>

      {send.error_message ? (
        <Alert variant="destructive"><AlertDescription className="text-[13px]">{send.error_message}</AlertDescription></Alert>
      ) : null}

      {/* §73: offered only when a recording actually exists, and never as a
          bare link to copy out of the page. */}
      {send.recording_url ? (
        <div>
          <p className="mb-1 font-medium">{t('comm_call_recording')}</p>
          <audio controls preload="none" src={send.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </div>
      ) : null}

      {send.summary ? (
        <div>
          <p className="mb-1 font-medium">{t('comm_call_summary')}</p>
          <p className="rounded-lg border bg-muted/30 p-2.5 text-[13px] leading-relaxed">{send.summary}</p>
        </div>
      ) : null}

      {facts.some(([, v]) => v) ? (
        <div>
          <p className="mb-1 font-medium">{t('comm_call_extracted')}</p>
          <dl className="divide-y rounded-lg border">
            {facts.filter(([, v]) => v).map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-2 px-2.5 py-1.5 text-[13px]">
                <dt className="text-muted-foreground">{t(key as TKey)}</dt>
                <dd className="text-end font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {extraction?.next_action ? (
        <div>
          <p className="mb-1 font-medium">{t('comm_call_next_action')}</p>
          <p className="text-[13px] text-muted-foreground">{extraction.next_action}</p>
        </div>
      ) : null}

      {send.transcript ? (
        <div>
          <p className="mb-1 font-medium">{t('comm_call_transcript')}</p>
          {/* The caller's own words, in the language they spoke (§135). Never
              translated behind their back. */}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-2.5 text-[13px] leading-relaxed">
            {send.transcript}
          </pre>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t('comm_call_no_transcript')}</p>
      )}
    </div>
  );
}
