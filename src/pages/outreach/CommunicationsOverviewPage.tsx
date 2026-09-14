// HOMATCH Communications — the control centre.
//
// WHAT THIS PAGE IS FOR
//
// Three independent products live here: AI telephony, WhatsApp messaging and
// WhatsApp calling. They share contacts, agents, a wallet and an inbox, and
// they share nothing else — a customer can run WhatsApp without ever placing
// a call, and can run calls while WhatsApp is switched off.
//
// The previous version said none of that. It led with a six-KPI row and a
// campaign table, and put the channels in four small cards below the fold, a
// quarter the weight of the table. So the WhatsApp product — an entire half
// of what this hub sells — was effectively invisible on the screen that is
// supposed to introduce it.
//
// Now the three directions ARE the page, at equal weight, each with its own
// state and its own way in. Everything shared sits underneath, where shared
// things belong.
//
// WHAT IT REFUSES TO DO
//
// It shows no number it cannot source. A new account has no calls, no
// messages and no campaigns, and the honest rendering of that is a module
// explaining what the channel is for plus a setup path — not a row of zeros
// dressed as measurements, and not a blank screen either.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PhoneCall, MessageCircle, PhoneForwarded, Bot, Users, Megaphone,
  AlertTriangle, ArrowRight, Wallet, Activity, Target, Clock, TrendingUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { ChannelModule, SetupProgress, type ChannelState, type SetupStep } from '@/components/communications/ChannelModule';
import {
  Kpi, KpiRow, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  formatUsd, formatDuration, relativeTime,
} from '@/components/communications/primitives';
import {
  getOverviewStats, getAttentionItems, getChannelStatus, listCampaigns,
  listAgents, listContacts, subscribeToCalls,
} from '@/services/communications';
import type {
  AttentionItem, ChannelStatusCard, CommCampaign, CommOverviewStats, AgentListRow, CommContact,
} from '@/types/communications';
import { cn } from '@/lib/utils';

type Range = '1d' | '7d' | '30d' | '90d';
type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
const RANGE_DAYS: Record<Range, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };

/** Channel state, from what the server said — never from a config flag name. */
function toChannelState(card: ChannelStatusCard | undefined): { state: ChannelState; detailKey: string | null } {
  if (!card) return { state: 'NOT_ACTIVATED', detailKey: 'comms_state_detail_not_activated' };
  switch (card.state) {
    case 'CONNECTED':        return { state: 'ACTIVE', detailKey: null };
    case 'PARTIAL':          return { state: 'SETUP_REQUIRED', detailKey: 'comms_state_detail_test_number' };
    case 'ACTION_REQUIRED':  return { state: 'SETUP_REQUIRED', detailKey: 'comms_state_detail_action' };
    case 'DISABLED':         return { state: 'UNAVAILABLE', detailKey: 'comms_state_detail_unavailable' };
    default:                 return { state: 'NOT_ACTIVATED', detailKey: 'comms_state_detail_not_activated' };
  }
}

export default function CommunicationsOverviewPage() {
  const { t, lang: language } = useLanguage();
  const { supaUser: user } = useAuth();
  const navigate = useNavigate();

  const [range, setRange] = useState<Range>('7d');
  const [stats, setStats] = useState<CommOverviewStats | null>(null);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [channels, setChannels] = useState<ChannelStatusCard[]>([]);
  const [agents, setAgents] = useState<AgentListRow[]>([]);
  const [contacts, setContacts] = useState<CommContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(
    () => new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString(),
    [range],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, c, at, ch, ag, co] = await Promise.all([
        getOverviewStats(range === '1d' ? undefined : since),
        listCampaigns({ limit: 25 }),
        getAttentionItems(),
        getChannelStatus(),
        listAgents(6),
        listContacts({ pageSize: 1 }),
      ]);
      setStats(s); setCampaigns(c); setAttention(at); setChannels(ch); setAgents(ag); setContacts(co.rows ?? []);
    } catch {
      setError('comm_overview_load_failed');
    } finally {
      setLoading(false);
    }
  }, [since, range]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToCalls(user.id, () => { void load(); });
  }, [user?.id, load]);

  const call = toChannelState(channels.find((c) => c.channel === 'AI_CALL'));
  const wa = toChannelState(channels.find((c) => c.channel === 'WHATSAPP'));

  const recent = campaigns.slice(0, 6);
  const activeCount = campaigns.filter((c) => ['RUNNING', 'SCHEDULED'].includes(c.status)).length;

  /* Setup progress, read from real account state. Nothing is assumed done. */
  const steps: SetupStep[] = [
    {
      titleKey: 'comms_step_agent', bodyKey: 'comms_step_agent_body',
      done: agents.length > 0,
      action: { label: t('comms_create_agent'), onClick: () => navigate('/outreach/agents') },
    },
    {
      titleKey: 'comms_step_contacts', bodyKey: 'comms_step_contacts_body',
      done: contacts.length > 0,
      action: { label: t('comms_import_contacts'), onClick: () => navigate('/outreach/contacts/import') },
    },
    {
      titleKey: 'comms_step_campaign', bodyKey: 'comms_step_campaign_body',
      done: campaigns.length > 0,
      action: { label: t('comm_new_campaign'), onClick: () => navigate('/outreach/campaigns/new') },
    },
    {
      titleKey: 'comms_step_launch', bodyKey: 'comms_step_launch_body',
      done: campaigns.some((c) => ['RUNNING', 'COMPLETED'].includes(c.status)),
      action: { label: t('comms_nav_campaigns'), onClick: () => navigate('/outreach/campaigns') },
    },
  ];

  return (
    <CommsWorkspace product="hub"
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{t('comms_title')}</h1>
            <p className="mt-1 max-w-[46rem] text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('comms_subtitle')}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['1d', '7d', '30d', '90d'] as Range[]).map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{t(`comm_range_${r}` as TKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8" onClick={() => navigate('/outreach/campaigns/new')}>
              {t('comm_new_campaign')}
            </Button>
          </div>
        </div>
      }
    >
      {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

      {attention.length ? (
        <Card className="border-gold/40 bg-gold/[0.04]">
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:p-4">
            <AlertTriangle className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
            <ul className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1">
              {attention.slice(0, 3).map((a) => (
                <li key={a.id} className="min-w-0 text-xs leading-snug [overflow-wrap:anywhere]">
                  <span className="font-medium">{t(a.titleKey as TKey)}</span>
                  {a.detail ? <span className="text-muted-foreground"> — {a.detail}</span> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <SetupProgress steps={steps} loading={loading} />

      {/* ── THE THREE DIRECTIONS ──────────────────────────────────────────
          Equal weight, each independent. This is the page's whole point. */}
      <Section titleKey="comms_channels_title" sub={t('comms_channels_sub')}>
        <div className="grid gap-3 lg:grid-cols-3">
          <ChannelModule
            featured
            icon={PhoneCall}
            titleKey="comms_ch_calls"
            purposeKey="comms_ch_calls_purpose"
            state={call.state}
            stateDetailKey={call.detailKey}
            loading={loading}
            stats={[
              { labelKey: 'comm_kpi_calls', value: stats?.callsToday ?? null },
              { labelKey: 'comm_kpi_qualified', value: stats?.qualifiedLeads ?? null },
              { labelKey: 'comm_kpi_answer_rate', value: stats?.answerRate != null ? `${Math.round(stats.answerRate * 100)}%` : null },
            ]}
            primary={{ label: t('comms_open_call_center'), onClick: () => navigate('/outreach/calls') }}
            links={[
              { label: t('comm_new_campaign'), onClick: () => navigate('/outreach/campaigns/new?channel=AI_CALL') },
              { label: t('comms_nav_agents'), onClick: () => navigate('/outreach/agents') },
            ]}
          />

          <ChannelModule
            featured
            icon={MessageCircle}
            titleKey="comms_ch_wa"
            purposeKey="comms_ch_wa_purpose"
            state={wa.state}
            stateDetailKey={wa.detailKey}
            loading={loading}
            stats={[
              { labelKey: 'comm_kpi_conversations', value: stats?.whatsappConversations ?? null },
              { labelKey: 'comm_kpi_reply_rate', value: stats?.replyRate != null ? `${Math.round(stats.replyRate * 100)}%` : null },
              { labelKey: 'comm_kpi_qualified', value: stats?.qualifiedLeads ?? null },
            ]}
            primary={{ label: t('comms_open_whatsapp'), onClick: () => navigate('/outreach/whatsapp') }}
            links={[
              { label: t('comms_wa_new_campaign'), onClick: () => navigate('/outreach/campaigns/new?channel=WHATSAPP') },
              { label: t('comms_nav_inbox'), onClick: () => navigate('/outreach/whatsapp/inbox') },
            ]}
          />

          {/*
           * WhatsApp Calling is its own direction, not a phone campaign that
           * happens to go over WhatsApp. It is shown even while unavailable,
           * because a product a customer cannot see is a product they cannot
           * ask for — and its state says so honestly rather than hiding it.
           */}
          <ChannelModule
            icon={PhoneForwarded}
            titleKey="comms_ch_wacall"
            purposeKey="comms_ch_wacall_purpose"
            state="NOT_ACTIVATED"
            stateDetailKey="comms_ch_wacall_detail"
            primary={{ label: t('comms_open_whatsapp'), onClick: () => navigate('/outreach/whatsapp') }}
          />
        </div>
      </Section>

      {/* ── Shared across the channels ─────────────────────────────────── */}
      <Section titleKey="comms_activity_title" sub={t('comms_activity_sub')}>
        <KpiRow cols={6}>
          <Kpi labelKey="comm_kpi_conversations" icon={Activity} value={stats?.conversationsToday ?? null} loading={loading} />
          <Kpi labelKey="comm_kpi_calls" icon={PhoneCall} value={stats?.callsToday ?? null} loading={loading} />
          <Kpi labelKey="comm_kpi_qualified" icon={Target} value={stats?.qualifiedLeads ?? null} accent loading={loading} />
          <Kpi labelKey="comm_kpi_viewings" icon={Clock} value={stats?.viewingsRequested ?? null} loading={loading} />
          <Kpi labelKey="comm_kpi_avg_duration" icon={TrendingUp} value={formatDuration(stats?.averageCallDurationSec)} loading={loading} />
          <Kpi labelKey="comm_kpi_spend" icon={Wallet} value={formatUsd(stats?.spendTodayUsd, language)} loading={loading} />
        </KpiRow>
      </Section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          titleKey="comms_recent_campaigns"
          sub={activeCount ? t('comms_campaigns_active', { n: activeCount }) : null}
          action={{ label: t('comms_see_all'), onClick: () => navigate('/outreach/campaigns') }}
        >
          {loading ? <LoadingBlock rows={3} /> : recent.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              titleKey="comms_no_campaigns"
              bodyKey="comms_no_campaigns_body"
              action={{ labelKey: 'comm_new_campaign', onClick: () => navigate('/outreach/campaigns/new') }}
            />
          ) : (
            <ul className="grid gap-2">
              {recent.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/outreach/campaigns?open=${c.id}`)}
                    className="flex w-full min-w-0 items-center gap-3 rounded-lg border bg-card p-3 text-start transition-colors hover:border-foreground/25"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-muted/60 text-muted-foreground">
                      {c.campaign_type === 'WHATSAPP'
                        ? <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        : <PhoneCall className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                        <span>{t(`comm_channel_${c.campaign_type.toLowerCase()}` as TKey)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{c.sent_count ?? 0}/{c.audience_count}</span>
                        <span aria-hidden="true">·</span>
                        <span>{relativeTime(c.launched_at ?? c.created_at, language)}</span>
                      </span>
                    </span>
                    <StatusBadge status={c.status} />
                  </button>
                </li>
              ))}
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
              {agents.slice(0, 4).map((a) => (
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
                        {(a.languages ?? []).join(' · ').toUpperCase() || '·'}
                      </span>
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[13px] font-normal">{a.campaignCount ?? 0}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 grid gap-2">
            <QuickAction icon={Users} labelKey="comms_nav_contacts" onClick={() => navigate('/outreach/contacts')} />
            <QuickAction icon={Wallet} labelKey="comms_nav_billing" onClick={() => navigate('/outreach/billing')} />
          </div>
        </Section>
      </div>
    </CommsWorkspace>
  );
}

function QuickAction({
  icon: Icon, labelKey, onClick,
}: { icon: React.ComponentType<{ className?: string }>; labelKey: string; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-start',
        'transition-colors hover:border-foreground/25',
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{t(labelKey as TKey)}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}
