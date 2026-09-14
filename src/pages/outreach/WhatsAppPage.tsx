// HOMATCH — WhatsApp.
//
// §33 and §34. The account state at the top, the delivery funnel under it, and
// nothing invented in between.
//
// THE ONE THING THIS PAGE REFUSES TO DO
//
// §33: "Do not invent Meta metrics if API does not supply them." Quality
// rating, messaging tier and verification state are shown only when Meta
// actually returned them, and are absent otherwise — not defaulted to "Good",
// not hidden behind a plausible placeholder.
//
// §100: the test number says it is a test number, prominently. A working test
// number is not a production sender, and a page that lets someone believe
// otherwise is the dishonesty that section exists to prevent.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UnreadBadge } from '@/components/common/UnreadBadge';
import {
  Inbox, MessageSquare, FileText, Plus, RefreshCw, ShieldAlert,
  Users, Send, CheckCheck, Eye, Reply,
} from 'lucide-react';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Kpi, KpiRow, LoadingBlock, ErrorState, StatusBadge, EmptyState,
  formatUsd, formatRate, relativeTime,
} from '@/components/communications/primitives';
import {
  getAnalytics, listChannelAccounts, listConversations, listTemplates, listCampaigns,
} from '@/services/communications';
import type {
  AnalyticsResult, CommChannelAccount, CommConversation, CommTemplate, CommCampaign,
} from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

export default function WhatsAppPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [account, setAccount] = useState<CommChannelAccount | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [unread, setUnread] = useState(0);
  const [threads, setThreads] = useState<CommConversation[]>([]);
  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [accounts, stats, conversations, recentThreads, tpl, camp] = await Promise.all([
        listChannelAccounts(),
        getAnalytics({ since, channel: 'WHATSAPP' }),
        listConversations({ channel: 'WHATSAPP', unread: true, limit: 100 }),
        listConversations({ channel: 'WHATSAPP', limit: 6 }),
        listTemplates(),
        listCampaigns({ channel: 'WHATSAPP', limit: 10 }),
      ]);
      setAccount(accounts.find((a) => a.channel === 'WHATSAPP') ?? null);
      setAnalytics(stats);
      setUnread(conversations.reduce((s, c) => s + c.unread_count, 0));
      setThreads(recentThreads);
      setTemplates(tpl);
      setCampaigns(camp);
    } catch {
      setError('comm_whatsapp_load_failed');
    } finally {
      setLoading(false);
    }
  }, [since]);

  useEffect(() => { void load(); }, [load]);

  const m = analytics?.messageStats;

  /*
   * NOTHING HAS HAPPENED ON THIS NUMBER YET.
   *
   * Nine KPI tiles and a funnel, every one of them empty, is nine repetitions
   * of a fact the setup panel above has already stated once. It reads as a
   * broken dashboard rather than a new one, and it pushes the two things that
   * ARE actionable -- templates and the first campaign -- below the fold.
   *
   * Measured on traffic rather than on configuration: an account can be fully
   * connected and have had no conversation, and that is still nothing to
   * measure.
   */
  const noTraffic = !loading && !threads.length && !campaigns.length && !(m?.sent ?? 0);
  const funnel: Array<[string, number]> = [
    ['comm_wa_sent', m?.sent ?? 0],
    ['comm_wa_delivered', m?.delivered ?? 0],
    ['comm_wa_read', m?.read ?? 0],
    ['comm_wa_replied', m?.replies ?? 0],
    ['comm_kpi_qualified', analytics?.qualified ?? 0],
  ];
  const funnelMax = Math.max(1, ...funnel.map(([, v]) => v));

  const approved = templates.filter((x) => x.status === 'APPROVED').length;

  return (
    <CommsWorkspace product="whatsapp"
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-ink">
              {t('comms_ch_wa')}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight sm:text-2xl">{t('comm_channel_whatsapp')}</h1>
            <p className="mt-1 max-w-[46rem] text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('comm_whatsapp_subtitle')}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" onClick={() => navigate('/outreach/whatsapp/campaigns/new')}>
              {t('comms_wa_new_campaign')}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/outreach/whatsapp/inbox')}>
              {t('comm_open_inbox')}
              {/* 99+, not 9+: a shared inbox genuinely reaches three digits,
                  and "9+" on 240 waiting conversations is not information. */}
              <UnreadBadge count={unread} cap={99} />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate('/outreach/whatsapp/templates')}>
              {t('comm_templates')}
            </Button>
          </div>
        </div>
      }
    >

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {loading ? <LoadingBlock rows={3} /> : !account ? (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              {/* §108: never ask them to attach a personal number. */}
              <AlertDescription className="text-xs">{t('comm_whatsapp_not_connected')}</AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {account.display_name || account.label}
                      <StatusBadge status={account.status} />
                      {/* §100, said out loud. */}
                      {account.environment === 'TEST' ? (
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[13px] text-amber-700 dark:text-amber-400">
                          {t('comm_test_mode')}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{account.phone_e164 ?? t('comm_no_number_yet')}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setLoading(true); void load(); }}>
                    <RefreshCw className="me-1.5 h-3.5 w-3.5" />{t('comm_refresh')}
                  </Button>
                </div>

                {account.environment === 'TEST' ? (
                  <Alert className="mt-3">
                    <AlertDescription className="text-[13px]">{t('comm_whatsapp_test_note')}</AlertDescription>
                  </Alert>
                ) : null}

                <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-4">
                  {/* Rendered only when Meta actually said something. */}
                  {account.quality_rating ? (
                    <div><dt className="text-muted-foreground">{t('comm_wa_quality')}</dt><dd className="font-medium">{account.quality_rating}</dd></div>
                  ) : null}
                  {account.messaging_tier ? (
                    <div><dt className="text-muted-foreground">{t('comm_wa_tier')}</dt><dd className="font-medium">{account.messaging_tier}</dd></div>
                  ) : null}
                  {account.verification_state ? (
                    <div><dt className="text-muted-foreground">{t('comm_wa_verification')}</dt><dd className="font-medium">{account.verification_state}</dd></div>
                  ) : null}
                  <div>
                    <dt className="text-muted-foreground">{t('comm_wa_webhook')}</dt>
                    <dd className="font-medium">
                      {account.webhook_verified_at ? t('comm_yes') : t('comm_wa_webhook_pending')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('comm_wa_last_inbound')}</dt>
                    <dd className="font-medium">{relativeTime(account.last_inbound_at, language)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <QuickCard icon={Inbox} labelKey="comm_open_inbox" badge={unread ? String(unread) : null} onClick={() => navigate('/outreach/whatsapp/inbox')} />
            <QuickCard
              icon={FileText}
              labelKey="comm_templates_title"
              badge={templates.length ? `${approved}/${templates.length}` : null}
              onClick={() => navigate('/outreach/whatsapp/templates')}
            />
            {/* "New WhatsApp campaign", not "New campaign". The model behind
                it is shared with email and calls; the label a customer reads
                must not be, or three products look like one. */}
            <QuickCard icon={Plus} labelKey="comm_new_campaign_wa" onClick={() => navigate('/outreach/whatsapp/campaigns/new')} />
          </div>

          {noTraffic ? null : (<>
          <KpiRow cols={6}>
            <Kpi labelKey="comm_wa_sent" value={m?.sent ?? null} loading={loading} />
            <Kpi labelKey="comm_wa_delivered" value={m?.delivered ?? null} loading={loading} />
            <Kpi labelKey="comm_wa_read" value={m?.read ?? null} loading={loading} />
            <Kpi labelKey="comm_wa_failed" value={m?.failed ?? null} loading={loading} />
            <Kpi labelKey="comm_wa_replies" value={m?.replies ?? null} loading={loading} />
            <Kpi labelKey="comm_wa_optouts" value={m?.optOuts ?? null} loading={loading} />
          </KpiRow>

          <KpiRow cols={3}>
            <Kpi
              labelKey="comm_kpi_reply_rate"
              value={formatRate(m && m.sent ? m.replies / m.sent : null)}
              loading={loading}
            />
            <Kpi labelKey="comm_kpi_qualified" value={analytics?.qualified ?? null} accent loading={loading} />
            <Kpi labelKey="comm_kpi_cost_per_lead" value={formatUsd(analytics?.costPerQualifiedUsd ?? null, language)} loading={loading} />
          </KpiRow>

          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 text-sm font-semibold">{t('comm_wa_funnel')}</h2>
              {loading ? <LoadingBlock rows={3} /> : !m?.sent ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t('comm_no_activity')}</p>
              ) : (
                <ol className="space-y-1.5">
                  {funnel.map(([key, value]) => (
                    <li key={key} className="text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span>{t(key as TKey)}</span>
                        <span className="font-medium tabular-nums">{value}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground/60" style={{ width: `${(value / funnelMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          </>)}

          {/* ── Messaging campaigns, conversations, templates ────────────
              WhatsApp is its own product. It gets its own campaign list, its
              own recent conversations and its own template state, so nothing
              here requires a telephony campaign to exist first. */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              titleKey="comms_wa_campaigns"
              sub={t('comms_wa_campaigns_sub')}
              action={{ label: t('comms_see_all'), onClick: () => navigate('/outreach/campaigns?channel=WHATSAPP') }}
            >
              {loading ? <LoadingBlock rows={2} /> : campaigns.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  titleKey="comms_wa_no_campaigns"
                  bodyKey="comms_wa_no_campaigns_body"
                  action={{ labelKey: 'comms_wa_new_campaign', onClick: () => navigate('/outreach/whatsapp/campaigns/new') }}
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
                          onClick={() => navigate(`/outreach/campaigns?channel=WHATSAPP&open=${c.id}`)}
                          className="w-full min-w-0 rounded-lg border bg-card p-3 text-start transition-colors hover:border-foreground/25"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                            <StatusBadge status={c.status} />
                          </span>
                          {c.audience_count ? (
                            <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                              <span className="block h-full rounded-full bg-gold transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                            </span>
                          ) : null}
                          <span className="mt-1.5 block text-[13px] tabular-nums text-muted-foreground">
                            {sent}/{c.audience_count} · {relativeTime(c.launched_at ?? c.created_at, language)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section
              titleKey="comms_wa_conversations"
              action={{ label: t('comm_open_inbox'), onClick: () => navigate('/outreach/whatsapp/inbox') }}
            >
              {loading ? <LoadingBlock rows={2} /> : threads.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  titleKey="comms_wa_no_threads"
                  bodyKey="comms_wa_no_threads_body"
                />
              ) : (
                <ul className="grid gap-2">
                  {threads.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/outreach/whatsapp/inbox?thread=${c.id}`)}
                        className="flex w-full min-w-0 items-start gap-2.5 rounded-lg border bg-card p-2.5 text-start transition-colors hover:border-foreground/25"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {c.peer_name || c.peer_address}
                            </span>
                            {c.unread_count > 0 ? (
                              <Badge className="h-4 min-w-4 justify-center px-1 text-2xs tabular-nums">{c.unread_count}</Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                            {c.last_message_preview ?? '·'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Templates moved up to the primary row with its approval
                  count; a second card to the same place was the page telling
                  somebody twice. */}
              <div className="mt-3 grid gap-2">
                <QuickCard icon={Users} labelKey="comms_nav_contacts" onClick={() => navigate('/outreach/contacts')} />
              </div>
            </Section>
          </div>

          {/*
            * WHATSAPP CALLING USED TO BE A SECTION HERE. IT IS NOT A PRODUCT.
            *
            * It rendered a channel module in NOT_ACTIVATED state, which reads
            * as "a thing you will be able to turn on" — and the owner's scope
            * decision is that WhatsApp calling is not part of the launch at
            * all. Its route row is already disabled with the kill switch on;
            * leaving the card was advertising a launch path that does not
            * exist.
            *
            * It is also the wrong SHAPE for this page. WhatsApp is messaging:
            * conversations, campaigns, templates, automation. A call module
            * here is the same generic communications card the AI Call Center
            * owns, and two products that look structurally identical are two
            * products a customer cannot tell apart.
            *
            * The backend rows (comm_provider_routes WHATSAPP_CALL, disabled)
            * stay exactly where they are.
            */}
    </CommsWorkspace>
  );
}

function QuickCard({
  icon: Icon, labelKey, badge, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string; badge?: string | null; onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button" onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 text-xs font-medium transition-colors hover:border-foreground/20"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t(labelKey as TKey)}
      </span>
      {badge ? <Badge className="text-[13px]">{badge}</Badge> : null}
    </button>
  );
}
