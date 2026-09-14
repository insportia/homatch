// HOMATCH — Campaigns.
//
// §16: one cohesive screen rather than unrelated isolated lists. Email, SMS,
// AI calls and WhatsApp are tabs over the same table, because from an
// operator's point of view they are the same object with a different channel.
//
// §52's line is drawn in the action menu: a campaign the customer paused can
// be resumed here, and one the kill switch paused cannot. The button is hidden
// AND the server refuses, because hiding a button is a courtesy and the SQL
// predicate in comm_user_resume_campaign is the control.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Megaphone, MoreHorizontal, Pause, Play, Plus, ShieldAlert } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  Kpi, KpiRow, PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  ScrollTable, formatUsd, relativeTime,
} from '@/components/communications/primitives';
import { listCampaigns, pauseCampaign, resumeCampaign } from '@/services/communications';
import {
  CHANNEL_TITLE_KEY, useCommsChannel, useCommsProduct,
} from '@/components/communications/channel';
import type { CommCampaign } from '@/types/communications';
import { isUserResumable } from '@/lib/comm/vocabulary';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const CHANNEL_TABS = ['ALL', 'AI_CALL', 'WHATSAPP', 'EMAIL', 'SMS'] as const;

export default function CampaignsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const routeChannel = useCommsChannel();
  /*
   * The builder, inside this product. Editing an existing campaign goes to
   * the same scoped path: a draft opened from AI Calls must not present its
   * channel as an open question either.
   */
  const builderPath = (suffix = '') => (
    routeChannel === 'AI_CALL' ? `/outreach/calls/campaigns/new${suffix}`
      : routeChannel === 'WHATSAPP' ? `/outreach/whatsapp/campaigns/new${suffix}`
        : `/outreach/campaigns/new${suffix}`
  );

  const product = useCommsProduct();
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /*
   * Inside a product the channel is NOT a tab. /outreach/calls/campaigns is
   * the call campaigns, and a tab strip offering WhatsApp there is a door out
   * of the product wearing the clothes of a filter. The ?channel= selector
   * survives only on the cross-channel screen, which is the one place where
   * choosing between them is the actual job.
   */
  const channel = (routeChannel ?? params.get('channel') ?? 'ALL') as typeof CHANNEL_TABS[number];

  const load = useCallback(async () => {
    setError(null);
    try {
      /* The product's own campaigns. An AI Call campaign and an email
         campaign are the same row shape and completely different work;
         listing them together means Pause sits beside a campaign the
         operator did not come here to touch. */
      setCampaigns(await listCampaigns({ limit: 200, channel }));
    } catch {
      setError('comm_campaigns_load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => (channel === 'ALL' ? campaigns : campaigns.filter((c) => c.campaign_type === channel)),
    [campaigns, channel],
  );

  const totals = useMemo(() => ({
    active: filtered.filter((c) => c.status === 'RUNNING').length,
    scheduled: filtered.filter((c) => c.status === 'SCHEDULED').length,
    completed: filtered.filter((c) => c.status === 'COMPLETED').length,
    paused: filtered.filter((c) => c.status === 'PAUSED' || c.status === 'COMPLIANCE_PAUSED').length,
    audience: filtered.reduce((s, c) => s + (c.audience_count ?? 0), 0),
    spend: filtered.reduce((s, c) => s + (Number(c.cost_actual_usd) || 0), 0),
  }), [filtered]);

  const onPause = useCallback(async (c: CommCampaign) => {
    setBusyId(c.id);
    try {
      const ok = await pauseCampaign(c.id);
      toast[ok ? 'success' : 'error'](t(ok ? 'comm_campaign_paused' : 'comm_save_failed'));
      if (ok) void load();
    } finally { setBusyId(null); }
  }, [load, t]);

  const onResume = useCallback(async (c: CommCampaign) => {
    setBusyId(c.id);
    try {
      const ok = await resumeCampaign(c.id);
      // A refusal here is the server declining, which is the honest message to
      // show rather than a generic save failure.
      toast[ok ? 'success' : 'error'](t(ok ? 'comm_campaign_resumed' : 'comm_campaign_resume_refused'));
      if (ok) void load();
    } finally { setBusyId(null); }
  }, [load, t]);

  return (
    <CommsWorkspace product={product}>
        <div className="space-y-4">
          <PageHeader
            eyebrow={routeChannel ? t(CHANNEL_TITLE_KEY[routeChannel] as TKey) : undefined}
            title={t('comm_campaigns_title')}
            subtitle={t('comm_campaigns_subtitle')}
            primary={{
              label: t('comm_new_campaign'),
              /* The channel travels with the action. "Create campaign" inside
                 AI Calls must open the builder ON AI Calls -- an unscoped CTA
                 is the same leak as an unscoped menu, reached by the button
                 somebody is most likely to press. */
              onClick: () => navigate(builderPath()),
            }}
          />

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {/* The channel chooser exists only where choosing is the job. Inside
              a product the answer is already decided by the route, and
              offering the other two here would be the leak this whole
              separation exists to close. */}
          {routeChannel ? null : (
            <Tabs value={channel} onValueChange={(v) => setParams({ channel: v }, { replace: true })}>
              <TabsList className="h-8">
                {CHANNEL_TABS.map((c) => (
                  <TabsTrigger key={c} value={c} className="h-7 px-2.5 text-xs">
                    {t(c === 'ALL' ? 'comm_filter_all' : `comm_channel_${c.toLowerCase()}` as TKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <KpiRow cols={6}>
            <Kpi labelKey="comm_kpi_active" value={totals.active} loading={loading} />
            <Kpi labelKey="comm_kpi_scheduled" value={totals.scheduled} loading={loading} />
            <Kpi labelKey="comm_kpi_completed" value={totals.completed} loading={loading} />
            <Kpi labelKey="comm_kpi_paused" value={totals.paused} loading={loading} />
            <Kpi labelKey="comm_kpi_audience" value={totals.audience} loading={loading} />
            <Kpi labelKey="comm_kpi_spend" value={formatUsd(totals.spend, language)} loading={loading} />
          </KpiRow>

          {loading ? <LoadingBlock rows={5} /> : !filtered.length ? (
            <EmptyState
              icon={Megaphone}
              titleKey="comm_campaigns_empty"
              bodyKey="comm_campaigns_empty_body"
              action={{ labelKey: 'comm_new_campaign', onClick: () => navigate(builderPath()) }}
            />
          ) : (
            <ScrollTable minWidth={980}>
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                    <th>{t('comm_col_campaign')}</th>
                    <th>{t('comm_col_channel')}</th>
                    <th>{t('comm_col_status')}</th>
                    <th>{t('comm_col_audience')}</th>
                    <th>{t('comm_col_progress')}</th>
                    <th>{t('comm_col_qualified')}</th>
                    <th>{t('comm_col_spend')}</th>
                    <th>{t('comm_col_created')}</th>
                    <th className="w-10" aria-label={t('comm_actions')} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const sent = c.sent_count ?? 0;
                    const pct = c.audience_count ? Math.min(100, Math.round((sent / c.audience_count) * 100)) : 0;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30 [&>td]:px-3 [&>td]:py-2">
                        <td className="max-w-[220px]">
                          <button
                            type="button"
                            className="block max-w-full truncate text-start font-medium hover:underline"
                            onClick={() => navigate(builderPath(`?id=${c.id}`))}
                          >
                            {c.name}
                          </button>
                          {c.paused_reason ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
                              <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{c.paused_reason}</span>
                            </span>
                          ) : null}
                        </td>
                        <td>{t(`comm_channel_${c.campaign_type.toLowerCase()}` as TKey)}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td className="tabular-nums">{c.audience_count}</td>
                        <td className="tabular-nums">{sent} <span className="text-muted-foreground">({pct}%)</span></td>
                        <td className="tabular-nums">{c.reply_count ?? '·'}</td>
                        <td className="tabular-nums">{formatUsd(c.cost_actual_usd, language)}</td>
                        <td className="text-muted-foreground">{relativeTime(c.created_at, language)}</td>
                        <td>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                aria-label={t('comm_actions')} disabled={busyId === c.id}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(builderPath(`?id=${c.id}`))}>
                                {t('comm_open')}
                              </DropdownMenuItem>
                              {c.status === 'RUNNING' ? (
                                <DropdownMenuItem onClick={() => void onPause(c)}>
                                  <Pause className="me-2 h-3.5 w-3.5" />{t('comm_pause')}
                                </DropdownMenuItem>
                              ) : null}
                              {/* Only for a pause the customer caused. A
                                  COMPLIANCE_PAUSED campaign never offers this. */}
                              {isUserResumable(c.status) ? (
                                <DropdownMenuItem onClick={() => void onResume(c)}>
                                  <Play className="me-2 h-3.5 w-3.5" />{t('comm_resume')}
                                </DropdownMenuItem>
                              ) : null}
                              {c.campaign_type === 'AI_CALL' ? (
                                <DropdownMenuItem onClick={() => navigate(`/outreach/calls?campaign=${c.id}`)}>
                                  {t('comm_view_calls')}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          )}
        </div>
    </CommsWorkspace>
  );
}
