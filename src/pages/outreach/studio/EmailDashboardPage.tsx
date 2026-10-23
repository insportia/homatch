// EMAIL STUDIO — Dashboard (/outreach/email). Owner brief §3.
//
// Every number is a count of real records: campaigns by phase from outreach_campaigns, delivery
// metrics from outreach_sends rows the provider confirmed (accepted = Resend returned an id;
// delivered / bounced / complained = its webhook said so; unsubscribed = the one-click link was
// used). Opens and clicks are not tracked for campaign email and say so — never a fake zero.

import { Activity, ArrowRight, BarChart3, CalendarClock, CheckCircle2, FileEdit, Inbox, LayoutTemplate, Mail, Plus, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { EmptyState, ErrorState, Kpi, KpiRow, PageHeader } from '@/components/communications/primitives';
import { PhaseBadge, pct } from '@/components/emailStudio/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { emailPhase } from '@/emailMarketing/reviewState';
import { useOutreachProviderStatus } from '@/hooks/useOutreachProviderStatus';
import { cn } from '@/lib/utils';
import {
  dailySeries, listCampaigns, myReviewEvents, type ReviewEntry, rate, type SendFact, type StudioCampaign, sendFacts, totalsOf,
} from '@/services/emailCampaignStudio';

const RANGES = [7, 30, 90, 0] as const;


export default function EmailDashboardPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  /* Deep link kept from the old campaigns page: /outreach/email?new=1&list=<id> opens a new
     campaign with that list already chosen (used by the Matching Marketplace hand-off). */
  const [deepLink] = useSearchParams();
  useEffect(() => {
    if (deepLink.get('new') !== '1') return;
    const list = deepLink.get('list');
    navigate(`/outreach/email/campaigns/new?step=2${list && /^[0-9a-f-]{36}$/i.test(list) ? `&list=${list}` : ''}`, { replace: true });
  }, [deepLink, navigate]);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [campaigns, setCampaigns] = useState<StudioCampaign[] | null>(null);
  const [facts, setFacts] = useState<SendFact[] | null>(null);
  const [events, setEvents] = useState<Array<ReviewEntry & { campaign_id: string }>>([]);
  const [error, setError] = useState(false);
  const { status: providerStatus, loading: providerLoading } = useOutreachProviderStatus();

  const load = useCallback(async () => {
    setError(false);
    try {
      const since = range ? new Date(Date.now() - range * 86_400_000).toISOString() : null;
      const [c, f, e] = await Promise.all([listCampaigns(), sendFacts(since), myReviewEvents(10)]);
      setCampaigns(c); setFacts(f); setEvents(e);
    } catch { setError(true); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const by = (ps: string[]) => (campaigns ?? []).filter((c) => ps.includes(emailPhase(c.status))).length;
    return {
      total: campaigns?.length ?? 0, drafts: by(['DRAFT', 'CHANGES_REQUESTED', 'REJECTED']), scheduled: by(['SCHEDULED']),
      review: by(['READY_FOR_REVIEW', 'UNDER_REVIEW']), sent: by(['SENT', 'PARTIALLY_SENT', 'SENDING']), approved: by(['APPROVED']),
    };
  }, [campaigns]);
  const totals = useMemo(() => totalsOf(facts ?? []), [facts]);
  const series = useMemo(() => dailySeries(facts ?? [], range === 7 ? 7 : range === 30 ? 30 : 30), [facts, range]);
  const maxDay = Math.max(1, ...series.map((d) => d.accepted));
  const names = useMemo(() => new Map((campaigns ?? []).map((c) => [c.id, c.name])), [campaigns]);
  const emailKilled = providerStatus?.email?.kill_switch ?? providerStatus?.kill_switch;
  const live = !providerLoading && Boolean(providerStatus?.email?.real) && !emailKilled;
  const loading = campaigns === null || facts === null;

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={t('ems_dash_title')} subtitle={t('ems_dash_subtitle')}
        secondary={{ label: t('ems_nav_templates'), onClick: () => navigate('/outreach/email/templates'), icon: LayoutTemplate }}
        primary={{ label: t('ems_new_campaign'), onClick: () => navigate('/outreach/email/campaigns/new'), icon: Plus }}>
        <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => navigate('/outreach/email/analytics')}>
          <BarChart3 className="h-3.5 w-3.5" />{t('ems_nav_analytics')}
        </Button>
      </PageHeader>
    }>
      <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug', live ? 'border-emerald-600/25 bg-emerald-500/[0.06] text-emerald-900' : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-950')} role="status">
        <span aria-hidden="true" className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', live ? 'bg-emerald-500' : 'bg-amber-500')} />
        <span className="min-w-0 [overflow-wrap:break-word]">{providerLoading ? t('outreach_status_checking') : live ? t('ems_live_on') : t('ems_live_off')}</span>
      </div>

      {error ? <ErrorState messageKey="ems_load_failed" onRetry={() => void load()} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('ems_dash_campaigns')}</h2>
      </div>
      <KpiRow>
        <Kpi labelKey="ems_k_total" value={loading ? null : counts.total} loading={loading} icon={Mail} />
        <Kpi labelKey="ems_k_drafts" value={loading ? null : counts.drafts} loading={loading} icon={FileEdit} />
        <Kpi labelKey="ems_k_review" value={loading ? null : counts.review} loading={loading} icon={ShieldAlert} />
        <Kpi labelKey="ems_k_approved" value={loading ? null : counts.approved} loading={loading} icon={ShieldCheck} />
        <Kpi labelKey="ems_k_scheduled" value={loading ? null : counts.scheduled} loading={loading} icon={CalendarClock} />
        <Kpi labelKey="ems_k_sent" value={loading ? null : counts.sent} loading={loading} icon={Send} />
      </KpiRow>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h2 className="text-sm font-semibold">{t('ems_dash_delivery')}</h2>
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label={t('ems_range')}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}
              className={cn('h-7 rounded-md px-2.5 text-xs', range === r ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {r ? t('ems_range_days', { n: r }) : t('ems_range_all')}
            </button>
          ))}
        </div>
      </div>
      <KpiRow>
        <Kpi labelKey="ems_k_accepted" value={loading ? null : totals.accepted.toLocaleString(lang)} sub={t('ems_k_accepted_sub')} loading={loading} />
        <Kpi labelKey="ems_k_delivery_rate" value={loading ? null : pct(rate(totals.delivered, totals.accepted))} sub={t('ems_k_of_accepted', { n: totals.delivered })} loading={loading} />
        <Kpi labelKey="ems_k_bounce_rate" value={loading ? null : pct(rate(totals.bounced, totals.accepted))} sub={t('ems_k_count', { n: totals.bounced })} loading={loading} />
        <Kpi labelKey="ems_k_complaint_rate" value={loading ? null : pct(rate(totals.complained, totals.accepted))} sub={t('ems_k_count', { n: totals.complained })} loading={loading} />
        <Kpi labelKey="ems_k_unsub_rate" value={loading ? null : pct(rate(totals.unsubscribed, totals.accepted))} sub={t('ems_k_count', { n: totals.unsubscribed })} loading={loading} />
        <Kpi labelKey="ems_k_ctr" value="—" sub={`${t('ems_not_tracked')} · ${t('ems_k_opens_note')}`} loading={loading} />
      </KpiRow>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section titleKey="ems_trend_title" sub={t('ems_trend_sub')}>
          <div className="rounded-2xl border bg-card p-4">
            {loading ? <Skeleton className="h-40 w-full" /> : totals.accepted === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('ems_trend_empty')}</p>
            ) : (
              <>
                <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={t('ems_trend_title')}>
                  {series.map((d) => (
                    <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${d.accepted} / ${d.delivered} / ${d.bounced}`}>
                      <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-[#0C1119]/15" style={{ height: `${(d.accepted / maxDay) * 100}%` }}>
                        <div className="w-full rounded-t bg-[hsl(38_85%_52%)]" style={{ height: `${d.accepted ? (d.delivered / d.accepted) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-2xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#0C1119]/15" />{t('ems_k_accepted')}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(38_85%_52%)]" />{t('ems_k_delivered')}</span>
                </div>
              </>
            )}
          </div>
        </Section>

        <Section titleKey="ems_activity_title" action={{ label: t('ems_see_all'), onClick: () => navigate('/outreach/email/campaigns') }}>
          <div className="rounded-2xl border bg-card">
            {loading ? <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              : !campaigns?.length ? (
                <div className="p-3"><EmptyState icon={Mail} titleKey="ems_empty_title" bodyKey="ems_empty_body" action={{ labelKey: 'ems_new_campaign', onClick: () => navigate('/outreach/email/campaigns/new') }} /></div>
              ) : (
                <ul className="divide-y">
                  {campaigns.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => navigate(`/outreach/email/campaigns/${c.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/40">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium [overflow-wrap:anywhere]">{c.name || t('ems_untitled')}</span>
                          <span className="block text-2xs text-muted-foreground">{new Date(c.updated_at).toLocaleDateString(lang)}</span>
                        </span>
                        <PhaseBadge status={c.status} />
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {events.length ? (
              <div className="border-t px-4 py-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Activity className="h-3.5 w-3.5" />{t('ems_review_events')}</p>
                <ul className="space-y-1">
                  {events.slice(0, 5).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className="font-medium">{t(`ems_rev_${e.action.toLowerCase()}`)}</span>
                      <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{names.get(e.campaign_id) ?? ''}</span>
                      <span className="ms-auto text-2xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString(lang)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Inbox, k: 'ems_tile_inbox', to: '/outreach/email/inbox' },
          { icon: CheckCircle2, k: 'ems_tile_deliverability', to: '/outreach/email/deliverability' },
          { icon: LayoutTemplate, k: 'ems_tile_templates', to: '/outreach/email/templates' },
        ].map(({ icon: Icon, k, to }) => (
          <button key={k} type="button" onClick={() => navigate(to)} className="flex items-start gap-3 rounded-2xl border bg-card p-4 text-start transition-colors hover:border-[hsl(38_70%_60%)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(38_90%_95%)] text-[hsl(32_70%_32%)]"><Icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold">{t(`${k}`)}</span><span className="block text-2xs leading-snug text-muted-foreground">{t(`${k}_sub`)}</span></span>
          </button>
        ))}
      </div>
    </CommsWorkspace>
  );
}
