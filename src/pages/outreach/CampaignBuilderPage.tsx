// HOMATCH — the Campaign builder.
//
// §17's seven steps. Step 5 is the one that matters and is the reason this
// page is worth writing carefully: the compliance and cost review is produced
// by calling the SERVER's own gate in preview mode, which is literally the
// same function that will decide at launch. A customer is therefore never told
// "ready" by one code path and refused by another.
//
// §110: the estimate for a call campaign is a RANGE, and it says what it
// assumed. Homatch does not know how long a stranger will stay on the phone,
// and a single confident figure there becomes an invoice dispute.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Rocket, Loader2, Phone, MessageSquare, Mail, Users,
  ShieldCheck, CalendarClock, Eye,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  LoadingBlock, ErrorState, ComplianceBadge, formatUsd,
} from '@/components/communications/primitives';
import {
  createCampaign, updateCampaign, getCampaign, previewLaunch, launchCampaign,
  listAgents, listTemplates, listChannelAccounts,
} from '@/services/communications';
import type { CommCampaign, LaunchPreview, AgentListRow, CommTemplate, CommChannelAccount } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const STEPS = ['channel', 'audience', 'content', 'schedule', 'review', 'launch'] as const;
type Step = typeof STEPS[number];

interface ContactListRow { id: string; name: string; total_rows: number; valid_rows: number }

export default function CampaignBuilderPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const campaignId = params.get('id');
  const step = (params.get('step') ?? 'channel') as Step;
  const stepIndex = Math.max(0, STEPS.indexOf(step));

  const [campaign, setCampaign] = useState<CommCampaign | null>(null);
  const [draft, setDraft] = useState<Partial<CommCampaign>>({ campaign_type: 'AI_CALL', max_attempts: 1, concurrency: 1 });
  const [lists, setLists] = useState<ContactListRow[]>([]);
  const [agents, setAgents] = useState<AgentListRow[]>([]);
  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [accounts, setAccounts] = useState<CommChannelAccount[]>([]);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [{ data: listRows }, agentRows, templateRows, accountRows] = await Promise.all([
          supabase.from('outreach_contact_lists')
            .select('id, name, total_rows, valid_rows')
            .eq('import_status', 'READY').order('created_at', { ascending: false }).limit(100),
          listAgents(),
          listTemplates(),
          listChannelAccounts(),
        ]);
        setLists((listRows ?? []) as ContactListRow[]);
        setAgents(agentRows);
        setTemplates(templateRows);
        setAccounts(accountRows);

        if (campaignId) {
          const existing = await getCampaign(campaignId);
          if (existing) { setCampaign(existing); setDraft(existing); }
        }
      } catch {
        setError('comm_campaigns_load_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [campaignId]);

  const patch = useCallback((next: Partial<CommCampaign>) => setDraft((d) => ({ ...d, ...next })), []);

  const persist = useCallback(async (): Promise<string | null> => {
    if (campaignId) {
      await updateCampaign(campaignId, draft);
      return campaignId;
    }
    const created = await createCampaign(draft);
    if (!created) { toast.error(t('comm_save_failed')); return null; }
    setCampaign(created);
    setParams({ id: created.id, step }, { replace: true });
    return created.id;
  }, [campaignId, draft, step, setParams, t]);

  const goTo = useCallback(async (next: Step) => {
    setBusy(true);
    try {
      const id = await persist();
      if (!id) return;
      setParams({ id, step: next }, { replace: true });
    } finally { setBusy(false); }
  }, [persist, setParams]);

  // Step 5 asks the server, every time it is opened. A cached verdict from
  // three edits ago is exactly the stale client validation §17 forbids.
  useEffect(() => {
    if (step !== 'review' || !campaignId) return;
    setPreview(null);
    void (async () => {
      await updateCampaign(campaignId, draft);
      const result = await previewLaunch(campaignId);
      setPreview(result.ok ? result.data : (result.data as LaunchPreview) ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, campaignId]);

  const onLaunch = useCallback(async () => {
    if (!campaignId) return;
    setBusy(true);
    try {
      const result = await launchCampaign(campaignId);
      const payload = result.ok ? result.data : (result.data as LaunchPreview | undefined);
      setPreview(payload ?? null);

      if (!result.ok) {
        const code = result.error;
        toast.error(t(
          code === 'DOMAIN_BLOCKED' ? 'comm_launch_domain_blocked'
          : code === 'NEEDS_REVIEW' ? 'comm_launch_needs_review'
          : code === 'INSUFFICIENT_BALANCE' ? 'comm_launch_no_balance'
          : code === 'NO_ELIGIBLE_CONTACTS' ? 'comm_launch_no_contacts'
          : code === 'ACCOUNT_FROZEN' ? 'comm_launch_frozen'
          : code === 'AGENT_NOT_READY' ? 'comm_launch_agent_not_ready'
          : code === 'TEMPLATE_NOT_APPROVED' ? 'comm_launch_template_not_approved'
          : code === 'CHANNEL_NOT_CONFIGURED' ? 'comm_launch_channel_missing'
          : 'comm_launch_failed',
        ));
        return;
      }
      toast.success(t('comm_launch_started'));
      navigate('/outreach/campaigns');
    } finally { setBusy(false); }
  }, [campaignId, navigate, t]);

  if (loading) {
    return <RouteGuard><AppLayout><div className="mx-auto max-w-3xl"><LoadingBlock rows={6} /></div></AppLayout></RouteGuard>;
  }

  const isCall = draft.campaign_type === 'AI_CALL';
  const isWhatsApp = draft.campaign_type === 'WHATSAPP';

  return (
    <RouteGuard>
      <AppLayout>
        <div className="mx-auto max-w-3xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/campaigns')}>
            <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_campaigns_title')}
          </Button>

          <div>
            <h1 className="text-xl font-semibold">{campaign ? campaign.name : t('comm_new_campaign')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('comm_campaign_builder_subtitle')}</p>
          </div>

          {error ? <ErrorState messageKey={error} /> : null}

          <ol className="flex overflow-x-auto rounded-lg border bg-card p-1" role="tablist">
            {STEPS.map((s, i) => (
              <li key={s} className="min-w-0 flex-1">
                <button
                  type="button" role="tab" aria-selected={i === stepIndex}
                  onClick={() => void goTo(s)}
                  disabled={!campaignId && i > 0}
                  className={cn(
                    'w-full truncate rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40',
                    i === stepIndex ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t(`comm_cstep_${s}` as TKey)}
                </button>
              </li>
            ))}
          </ol>

          {step === 'channel' ? (
            <Card><CardContent className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_campaign_name')}</Label>
                <Input
                  value={draft.name ?? ''} onChange={(e) => patch({ name: e.target.value })}
                  className="h-9 text-sm" maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_col_channel')}</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { code: 'AI_CALL', icon: Phone, key: 'comm_channel_ai_call' },
                    { code: 'WHATSAPP', icon: MessageSquare, key: 'comm_channel_whatsapp' },
                    { code: 'EMAIL', icon: Mail, key: 'comm_channel_email' },
                    { code: 'SMS', icon: MessageSquare, key: 'comm_channel_sms' },
                  ].map(({ code, icon: Icon, key }) => (
                    <button
                      key={code} type="button"
                      aria-pressed={draft.campaign_type === code}
                      onClick={() => patch({ campaign_type: code as CommCampaign['campaign_type'] })}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border p-3 text-start text-xs transition-colors',
                        draft.campaign_type === code ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                      )}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {t(key as TKey)}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent></Card>
          ) : null}

          {step === 'audience' ? (
            <Card><CardContent className="space-y-3 p-4">
              <Label className="text-xs">{t('comm_campaign_audience')}</Label>
              {!lists.length ? (
                <Alert>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    {t('comm_no_contact_lists')}
                    <Button size="sm" variant="outline" onClick={() => navigate('/outreach/contact-lists')}>
                      <Users className="me-1.5 h-3.5 w-3.5" />{t('comm_import_contacts')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <ul className="space-y-1.5">
                  {lists.map((list) => (
                    <li key={list.id}>
                      <button
                        type="button"
                        aria-pressed={draft.contact_list_id === list.id}
                        onClick={() => patch({ contact_list_id: list.id })}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors',
                          draft.contact_list_id === list.id ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{list.name}</span>
                          <span className="text-[13px] text-muted-foreground">
                            {t('comm_list_counts')
                              .replace('{total}', String(list.total_rows))
                              .replace('{valid}', String(list.valid_rows))}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>
          ) : null}

          {step === 'content' ? (
            <Card><CardContent className="space-y-3 p-4">
              {isCall ? (
                <>
                  <Label className="text-xs">{t('comm_campaign_agent')}</Label>
                  {!agents.filter((a) => a.status === 'READY').length ? (
                    <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {t('comm_no_ready_agents')}
                      <Button size="sm" variant="outline" onClick={() => navigate('/outreach/agents')}>
                        {t('comm_create_agent')}
                      </Button>
                    </AlertDescription></Alert>
                  ) : (
                    <ul className="space-y-1.5">
                      {agents.filter((a) => a.status === 'READY').map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            aria-pressed={draft.agent_id === a.id}
                            onClick={() => patch({ agent_id: a.id })}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors',
                              draft.agent_id === a.id ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium">{a.name}</span>
                              <span className="line-clamp-1 text-[13px] text-muted-foreground">{a.purpose}</span>
                            </span>
                            <Badge variant="outline" className="shrink-0 text-[13px]">v{a.current_version}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : isWhatsApp ? (
                <>
                  <Label className="text-xs">{t('comm_campaign_template')}</Label>
                  {/* §38: only an APPROVED template may open a conversation.
                      Others are shown, disabled, with their real status, so a
                      user can see that Meta has not approved it yet. */}
                  <ul className="space-y-1.5">
                    {templates.map((tpl) => {
                      const sendable = tpl.status === 'APPROVED';
                      return (
                        <li key={tpl.id}>
                          <button
                            type="button"
                            disabled={!sendable}
                            aria-pressed={draft.template_id === tpl.id}
                            onClick={() => patch({ template_id: tpl.id })}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors disabled:opacity-50',
                              draft.template_id === tpl.id ? 'border-gold bg-gold/[0.06]' : 'hover:border-foreground/20',
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium">{tpl.name}</span>
                              <span className="line-clamp-2 text-[13px] text-muted-foreground">{tpl.body_text}</span>
                            </span>
                            <Badge variant="outline" className="shrink-0 text-[13px]">{tpl.status}</Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {!templates.length ? (
                    <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {t('comm_no_templates')}
                      <Button size="sm" variant="outline" onClick={() => navigate('/outreach/whatsapp/templates')}>
                        {t('comm_templates_title')}
                      </Button>
                    </AlertDescription></Alert>
                  ) : null}

                  {accounts.filter((a) => a.channel === 'WHATSAPP').length > 1 ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('comm_campaign_sender')}</Label>
                      <Select
                        value={draft.channel_account_id ?? ''}
                        onValueChange={(v) => patch({ channel_account_id: v })}
                      >
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {accounts.filter((a) => a.channel === 'WHATSAPP').map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </>
              ) : (
                <Alert><AlertDescription className="text-xs">{t('comm_channel_builder_elsewhere')}</AlertDescription></Alert>
              )}
            </CardContent></Card>
          ) : null}

          {step === 'schedule' ? (
            <Card><CardContent className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('comm_campaign_timezone')}</Label>
                  <Input
                    value={draft.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
                    onChange={(e) => patch({ timezone: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('comm_campaign_max_spend')}</Label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={draft.max_spend_usd ?? ''}
                    onChange={(e) => patch({ max_spend_usd: e.target.value ? Number(e.target.value) : null })}
                    placeholder={t('comm_campaign_max_spend_placeholder')}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('comm_campaign_window_start')}</Label>
                  <Input
                    type="number" min={0} max={23}
                    value={draft.send_window_start ?? 9}
                    onChange={(e) => patch({ send_window_start: Number(e.target.value) })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('comm_campaign_window_end')}</Label>
                  <Input
                    type="number" min={0} max={23}
                    value={draft.send_window_end ?? 19}
                    onChange={(e) => patch({ send_window_end: Number(e.target.value) })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {isCall ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('comm_campaign_max_attempts')}</Label>
                    <Input
                      type="number" min={1} max={5}
                      value={draft.max_attempts ?? 1}
                      onChange={(e) => patch({ max_attempts: Number(e.target.value) })}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('comm_campaign_retry_gap')}</Label>
                    <Input
                      type="number" min={30} step={30}
                      value={draft.retry_gap_minutes ?? 240}
                      onChange={(e) => patch({ retry_gap_minutes: Number(e.target.value) })}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              ) : null}

              <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
                <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {t('comm_campaign_window_hint')}
              </p>
            </CardContent></Card>
          ) : null}

          {step === 'review' ? <ReviewPanel preview={preview} language={language} /> : null}

          {step === 'launch' ? (
            <Card><CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <Rocket className="mt-0.5 h-4 w-4 text-gold" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{t('comm_launch_title')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('comm_launch_body')}</p>
                </div>
              </div>
              {preview ? <ReviewPanel preview={preview} language={language} compact /> : null}
              <Button className="w-full" onClick={() => void onLaunch()} disabled={busy || preview?.ok === false}>
                {busy ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Rocket className="me-1.5 h-4 w-4" />}
                {t('comm_launch_button')}
              </Button>
            </CardContent></Card>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              variant="outline" size="sm" disabled={stepIndex === 0 || busy}
              onClick={() => void goTo(STEPS[Math.max(0, stepIndex - 1)])}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_back')}
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button size="sm" disabled={busy} onClick={() => void goTo(STEPS[stepIndex + 1])}>
                {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t('comm_continue')}<ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" />
              </Button>
            ) : null}
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

/**
 * What the server decided, shown as-is.
 *
 * §131 governs what appears: the audience breakdown, the estimate and a
 * compliance label. Not the risk score, not the weights, not the tier
 * thresholds — those are in the Admin Risk centre and are not the customer's.
 */
function ReviewPanel({
  preview, language, compact,
}: { preview: LaunchPreview | null; language: string; compact?: boolean }) {
  const { t } = useLanguage();
  if (!preview) return <LoadingBlock rows={4} />;

  const a = preview.audience;
  const e = preview.estimate;

  return (
    <Card><CardContent className={cn('space-y-3', compact ? 'p-3' : 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('comm_review_compliance')}
        </span>
        <ComplianceBadge state={preview.compliance} />
      </div>

      {!preview.ok ? (
        <Alert variant={preview.compliance === 'PAUSED_FOR_SAFETY' ? 'destructive' : 'default'}>
          <AlertDescription className="text-xs">{preview.message}</AlertDescription>
        </Alert>
      ) : null}

      {a ? (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">{t('comm_audience_total')}</dt><dd className="font-medium tabular-nums">{a.total}</dd></div>
          <div><dt className="text-muted-foreground">{t('comm_audience_eligible')}</dt><dd className="font-medium tabular-nums">{a.eligible}</dd></div>
          <div><dt className="text-muted-foreground">{t('comm_audience_suppressed')}</dt><dd className="font-medium tabular-nums">{a.suppressed}</dd></div>
          <div><dt className="text-muted-foreground">{t('comm_audience_invalid')}</dt><dd className="font-medium tabular-nums">{a.invalid}</dd></div>
        </dl>
      ) : null}

      {a && a.allowed < a.eligible ? (
        // Being capped by a tier is a fact the customer should know, phrased as
        // a limit on this campaign rather than as a judgement about them.
        <p className="text-[13px] text-muted-foreground">
          {t('comm_audience_capped').replace('{n}', String(a.allowed))}
        </p>
      ) : null}

      {e ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium">{t('comm_estimate_title')}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {e.isRange && e.maxCents !== e.minCents
              ? `${formatUsd(e.minCents / 100, language)} – ${formatUsd(e.maxCents / 100, language)}`
              : formatUsd(e.maxCents / 100, language)}
          </p>
          {/* The assumptions, in the open. §110: do not pretend duration is known. */}
          <p className="mt-0.5 text-[13px] text-muted-foreground">{e.basis}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('comm_estimate_note')}</p>
        </div>
      ) : null}

      {preview.throughputPerHour ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Eye className="h-3 w-3" aria-hidden="true" />
          {t('comm_throughput').replace('{n}', String(preview.throughputPerHour))}
        </p>
      ) : null}
    </CardContent></Card>
  );
}
