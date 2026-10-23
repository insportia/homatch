/*
 * HOMATCH — Email campaigns.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A REDESIGN
 *
 * The page could create a campaign and launch it. It could not edit one,
 * schedule one, choose who it comes from, or tell you what became of it —
 * and its one status banner described behaviour the server does not have.
 *
 * THE NUMBERS ON A CARD ARE A CLAIM ABOUT REALITY
 *
 * sent_count used to be the only figure shown, and a simulated send
 * incremented it exactly as a real one did. So the card asserted deliveries
 * that had not happened, to the person deciding whether outreach works.
 *
 * Two things fix that, and only one of them is here. The server now REFUSES
 * to simulate an email rather than recording a fiction (outreach-send), and a
 * campaign that was ever simulated is marked LEGACY_MOCK by a database
 * trigger and can never be dispatched. This page's job is to show that mark
 * rather than to enforce it — enforcement that lives in a screen is
 * enforcement that a second screen forgets.
 *
 * DELIVERED IS NOT SENT
 *
 * Accepted by the provider, delivered to the mailbox, bounced and complained
 * are four different facts and they arrive at four different times. They are
 * shown apart, and a campaign with both successes and failures says so
 * instead of averaging them into a number that reads like success.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Mail, Plus, Eye, Loader2, BarChart2, Rocket, Clock, Pencil, XCircle, Send, CheckCircle2, AlertTriangle, AlertCircle, Activity, MessageSquare, Inbox } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useNavigate } from 'react-router-dom';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { OutreachCampaign, ContactList } from '@/types/types';
import { toast } from 'sonner';
import { useOutreachProviderStatus } from '@/hooks/useOutreachProviderStatus';
import { listConversations, listEmailSends } from '@/services/communications';
import { EmptyState, Kpi, KpiRow, PageHeader, StatusBadge } from '@/components/communications/primitives';
import { cn } from '@/lib/utils';
import { renderCampaignEmail } from '@/emailMarketing/campaignTemplate';
import { EmailMarketingError, sendCampaignTest } from '@/services/emailMarketing';
import type { CommConversation, CommSend } from '@/types/communications';

/** The tabs, and which statuses each one owns. Every status has a home. */
const TABS = [
  { key: 'all', label: 'email_tab_all', match: null },
  { key: 'drafts', label: 'email_tab_drafts', match: ['DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED'] },
  { key: 'scheduled', label: 'email_tab_scheduled', match: ['SCHEDULED'] },
  { key: 'sending', label: 'email_tab_sending', match: ['RUNNING', 'PAUSED', 'COMPLIANCE_PAUSED'] },
  { key: 'sent', label: 'email_tab_sent', match: ['COMPLETED'] },
  { key: 'failed', label: 'email_tab_failed', match: ['FAILED', 'CANCELLED'] },
] as const;

/** Columns the list needs. Named rather than `*`: this is a hot query. */
const LIST_COLUMNS =
  'id,name,status,campaign_type,audience_count,sent_count,delivered_count,bounce_count,' +
  'complaint_count,failed_count,open_count,cost_estimate_usd,created_at,language,subject,' +
  'contact_list_id,scheduled_at,timezone,sender_name,sender_email,reply_to,send_eligibility,last_send_error';

interface CampaignForm {
  name: string;
  subject: string;
  text_body: string;
  language: string;
  contact_list_id: string;
  sender_name: string;
  sender_email: string;
  reply_to: string;
}

const EMPTY_FORM: CampaignForm = {
  name: '', subject: '', text_body: '', language: 'en',
  contact_list_id: '', sender_name: '', sender_email: '', reply_to: '',
};

/** The browser's own zone. The one the person picking a time is thinking in. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * An instant, rendered in the zone the campaign was scheduled in.
 *
 * NOT in the reader's zone. An owner who schedules 09:00 Tbilisi and opens
 * the page from Berlin must still see 09:00 Tbilisi, because that is the
 * decision they made and the one the recipients will experience.
 */
function formatScheduled(iso: string | undefined, zone: string | undefined, locale: string): string {
  if (!iso) return '';
  const tz = zone || localZone();
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: tz,
    }).format(new Date(iso)) + ` (${tz})`;
  } catch {
    return new Date(iso).toISOString();
  }
}

/** `datetime-local` wants local wall-clock with no zone. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EmailCampaignsPage() {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const { status: providerStatus, loading: providerLoading } = useOutreachProviderStatus();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);

  const [editing, setEditing] = useState<OutreachCampaign | null>(null);
  const [editForm, setEditForm] = useState<CampaignForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [scheduling, setScheduling] = useState<OutreachCampaign | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [previewCampaign, setPreviewCampaign] = useState<OutreachCampaign | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  /*
   * Replies live in comm_conversations, not in a second email store: an
   * inbound email is recorded by the same comm_record_inbound as every other
   * channel, so this is the inbox the product already has, filtered to EMAIL.
   * Filtered explicitly -- without the channel this would also list WhatsApp.
   */
  const [replies, setReplies] = useState<CommConversation[]>([]);
  /* The dispatch log, from the same outreach_sends the call centre reads. */
  const [activity, setActivity] = useState<CommSend[]>([]);

  const zone = useMemo(localZone, []);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select(LIST_COLUMNS)
        .eq('owner_id', homatchUser.id)
        .eq('campaign_type', 'EMAIL')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setCampaigns(Array.isArray(data) ? (data as unknown as OutreachCampaign[]) : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  const loadContactLists = useCallback(async () => {
    if (!homatchUser) return;
    const { data } = await supabase.from('outreach_contact_lists')
      .select('id,name,valid_rows')
      .eq('owner_id', homatchUser.id)
      .order('created_at', { ascending: false });
    setContactLists(Array.isArray(data) ? data as ContactList[] : []);
  }, [homatchUser]);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await listEmailSends(12));
    } catch {
      setActivity([]);
    }
  }, []);

  const loadReplies = useCallback(async () => {
    try {
      setReplies(await listConversations({ channel: 'EMAIL', limit: 8 }));
    } catch {
      /* A failed read of the replies panel must not blank the campaigns the
         page is actually for. It stays empty and says so. */
      setReplies([]);
    }
  }, []);

  useEffect(() => {
    load(); loadContactLists(); loadReplies(); loadActivity();
  }, [load, loadContactLists, loadReplies, loadActivity]);

  // Live counters: any change to this user's outreach_campaigns rows (from
  // this tab's own Launch click, from a delivery webhook, or from the
  // scheduler dispatching it) refreshes the list automatically.
  useEffect(() => {
    if (!homatchUser) return;
    const channel = supabase.channel(`email-campaigns-${homatchUser.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'outreach_campaigns', filter: `owner_id=eq.${homatchUser.id}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [homatchUser, load]);

  /*
   * WHAT THE NUMBERS ARE, AND WHAT THEY ARE NOT.
   *
   * Every figure is a sum over the campaigns this owner actually has. There
   * is no denominator invented to make a percentage look better and no metric
   * the backend cannot answer: opens and clicks have columns but nothing
   * writes them yet, so they are not shown. A tile that always reads 0%
   * because nothing populates it teaches people to ignore the whole strip.
   *
   * Rates are null rather than 0 when their denominator is 0. "0% delivered"
   * and "nothing sent yet" are different facts and only one of them is true.
   */
  const stats = useMemo(() => {
    const sum = (k: keyof OutreachCampaign) =>
      campaigns.reduce((n, c) => n + (Number(c[k] ?? 0) || 0), 0);
    const sent = sum('sent_count');
    const delivered = sum('delivered_count');
    const bounced = sum('bounce_count');
    const failed = sum('failed_count');
    const active = campaigns.filter((c) => ['RUNNING', 'SCHEDULED'].includes(c.status)).length;
    return {
      sent, delivered, bounced, failed, active,
      scheduled: campaigns.filter((c) => c.status === 'SCHEDULED').length,
      drafts: campaigns.filter((c) => ['DRAFT', 'READY'].includes(c.status)).length,
      deliveryRate: sent > 0 ? delivered / sent : null,
      replyRate: sent > 0 ? replies.length / sent : null,
    };
  }, [campaigns, replies.length]);

  /*
   * A WORKSPACE NOBODY HAS USED YET IS NOT FIVE EMPTY PANELS.
   *
   * With no campaigns there is nothing sent, nothing delivered and nothing
   * replied to -- so the strip is six tiles reading 0 and an em dash, and
   * three dashed boxes beneath it each saying "nothing here" about a
   * different absence. Four restatements of one fact, and the only useful
   * control (create a campaign) ends up beneath all of them.
   *
   * So the measurements and the feeds appear once there is something to
   * measure. The campaigns list keeps its own empty state, which is the one
   * that carries the action.
   */
  const hasNothing = !loading && !campaigns.length && !activity.length && !replies.length;

  const visible = useMemo(() => {
    const spec = TABS.find(x => x.key === tab);
    if (!spec || !spec.match) return campaigns;
    const allowed = spec.match as readonly string[];
    return campaigns.filter(c => allowed.includes(c.status));
  }, [campaigns, tab]);

  /* A test copy to the owner's own address — the server decides whether sending is allowed. */
  const [testingId, setTestingId] = useState<string | null>(null);
  const handleTestSend = async (campaignId: string) => {
    setTestingId(campaignId);
    try {
      const r = await sendCampaignTest(campaignId, crypto.randomUUID());
      toast.success(t('emx_test_sent', { to: r.sentTo }));
    } catch (e) {
      const code = e instanceof EmailMarketingError ? e.code : '';
      const key = code === 'SENDING_DISABLED' || code === 'PROVIDER_KILL_SWITCH' ? 'emx_test_blocked'
        : code === 'EMPTY_CAMPAIGN' ? 'emx_test_empty' : code === 'NO_ACCOUNT_EMAIL' ? 'emx_test_no_email'
        : code === 'RATE_LIMITED' ? 'emx_test_rate' : /QUOTA|CAP|CAPACITY/.test(code) ? 'emx_test_quota' : 'emx_test_failed';
      toast.error(t(key));
    } finally {
      setTestingId(null);
    }
  };

  const handlePreview = async (campaignId: string) => {
    setPreviewLoadingId(campaignId);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select('id,name,status,subject,html_body,text_body,sender_name,sender_email,reply_to,language,send_eligibility')
        .eq('id', campaignId)
        .single();
      if (error) throw error;
      setPreviewCampaign(data as OutreachCampaign);
    } catch (err) {
      toast.error(t('email_preview_error'));
      console.error(err);
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { error } = await supabase.functions.invoke('outreach-campaign-preview', {
        body: {
          campaign_type: 'EMAIL', name: form.name, subject: form.subject, text_body: form.text_body,
          language: form.language, contact_list_id: form.contact_list_id || undefined,
          sender_name: form.sender_name || undefined,
          sender_email: form.sender_email || undefined,
          reply_to: form.reply_to || undefined,
        },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('email_campaign_created'));
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(t('email_campaign_create_error'));
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (c: OutreachCampaign) => {
    setEditing(c);
    setEditForm({
      name: c.name ?? '', subject: c.subject ?? '', text_body: c.text_body ?? '',
      language: c.language ?? 'en', contact_list_id: c.contact_list_id ?? '',
      sender_name: c.sender_name ?? '', sender_email: c.sender_email ?? '', reply_to: c.reply_to ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      /*
       * Guarded on status as well as id. A campaign the scheduler picked up
       * while this dialog was open is RUNNING by now, and editing the body of
       * a send already in flight would change what the second half of the
       * audience receives.
       */
      const { data, error } = await supabase.from('outreach_campaigns')
        .update({
          name: editForm.name, subject: editForm.subject, text_body: editForm.text_body,
          language: editForm.language,
          contact_list_id: editForm.contact_list_id || null,
          sender_name: editForm.sender_name || null,
          sender_email: editForm.sender_email || null,
          reply_to: editForm.reply_to || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editing.id)
        .in('status', ['DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED'])
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) { toast.error(t('email_edit_locked')); return; }
      toast.success(t('email_saved'));
      setEditing(null);
      load();
    } catch (err) {
      toast.error(t('email_save_error'));
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!scheduling || !scheduleAt) return;
    const when = new Date(scheduleAt);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error(t('email_schedule_past'));
      return;
    }
    setSavingSchedule(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .update({
          status: 'SCHEDULED',
          scheduled_at: when.toISOString(),
          /* The zone is stored beside the instant so the time can be shown
             back as it was chosen, from anywhere. */
          timezone: zone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduling.id)
        .in('status', ['DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED'])
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) { toast.error(t('email_edit_locked')); return; }
      toast.success(t('email_schedule_saved'));
      setScheduling(null);
      setScheduleAt('');
      load();
    } catch (err) {
      toast.error(t('email_schedule_error'));
      console.error(err);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCancelSchedule = async (c: OutreachCampaign) => {
    try {
      const { error } = await supabase.from('outreach_campaigns')
        .update({ status: 'DRAFT', scheduled_at: null, updated_at: new Date().toISOString() })
        .eq('id', c.id)
        .eq('status', 'SCHEDULED');
      if (error) throw error;
      toast.success(t('email_schedule_cancelled'));
      load();
    } catch (err) {
      toast.error(t('email_schedule_error'));
      console.error(err);
    }
  };

  const handleLaunch = async (campaign: OutreachCampaign) => {
    setLaunchingId(campaign.id);
    try {
      const { data, error } = await supabase.functions.invoke('outreach-send', {
        body: { campaign_id: campaign.id },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      if (data?.blocked) {
        const reason = data.reason === 'PROVIDER_KILL_SWITCH_ACTIVE' ? t('email_blocked_kill_switch')
          : data.reason === 'EMAIL_SENDING_NOT_ENABLED' ? t('email_blocked_not_enabled')
          : data.reason === 'CAMPAIGN_IS_LEGACY_MOCK' ? t('email_legacy_mock_note')
          : t('email_blocked_spend_cap');
        toast.error(reason);
        return;
      }
      toast.success(`${t('email_launch_success')}: ${data?.sent ?? 0} ${t('email_sent')}${data?.failed ? `, ${data.failed} ${t('email_failed')}` : ''}`);
      load();
    } catch (err) {
      toast.error(t('email_launch_error'));
      console.error(err);
    } finally {
      setLaunchingId(null);
    }
  };

  const fields = (f: CampaignForm, set: (next: CampaignForm) => void) => (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>{t('email_campaign_name')}</Label>
        <Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder={t('email_campaign_name_placeholder')} />
      </div>
      <div className="space-y-1.5">
        <Label>{t('email_subject')}</Label>
        <Input value={f.subject} onChange={(e) => set({ ...f, subject: e.target.value })} placeholder={t('email_subject_placeholder')} />
      </div>
      <div className="space-y-1.5">
        <Label>{t('email_body')}</Label>
        <Textarea rows={4} value={f.text_body} onChange={(e) => set({ ...f, text_body: e.target.value })} placeholder={t('email_body_placeholder')} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('email_sender_name')}</Label>
          <Input value={f.sender_name} onChange={(e) => set({ ...f, sender_name: e.target.value })} placeholder="Homatch" />
        </div>
        <div className="space-y-1.5">
          <Label>{t('email_sender_email')}</Label>
          <Input type="email" value={f.sender_email} onChange={(e) => set({ ...f, sender_email: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t('email_reply_to')}</Label>
        <Input type="email" value={f.reply_to} onChange={(e) => set({ ...f, reply_to: e.target.value })} />
        <p className="text-[13px] text-muted-foreground">{t('email_sender_note')}</p>
      </div>
      <div className="space-y-1.5">
        <Label>{t('email_contact_list_label')}</Label>
        {contactLists.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('email_no_lists')}</p>
        ) : (
          <Select value={f.contact_list_id} onValueChange={(v) => set({ ...f, contact_list_id: v })}>
            <SelectTrigger><SelectValue placeholder={t('email_contact_list_placeholder')} /></SelectTrigger>
            <SelectContent>
              {contactLists.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name} ({l.valid_rows ?? 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const sendingLive = !providerLoading && Boolean(providerStatus?.email?.real) && !providerStatus?.kill_switch;

  return (
    <CommsWorkspace
      product="email"
      header={(
        <PageHeader
          eyebrow={t('dnav_email')}
          title={t('email_campaigns_title')}
          subtitle={t('email_campaigns_subtitle')}
          secondary={{ label: t('emx_nav_inbox'), onClick: () => navigate('/outreach/email/inbox'), icon: Inbox }}
          primary={{ label: t('email_new_campaign'), onClick: () => setCreateOpen(true), icon: Plus }}
        />
      )}
    >
        <div className="space-y-5">

          {/* Sending state, stated plainly: a quiet strip, green only when mail really goes out. */}
          <div
            role="status"
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug',
              sendingLive ? 'border-emerald-600/25 bg-emerald-500/[0.06] text-emerald-900' : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-950',
            )}
          >
            <span aria-hidden="true" className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', sendingLive ? 'bg-emerald-500' : 'bg-amber-500')} />
            <span className="min-w-0 [overflow-wrap:break-word]">
              {/* "Checking" is only true while the request is in flight. A finished request that
                  could not tell us is UNKNOWN, and the honest answer to unknown is the
                  conservative one — the same message a disabled channel shows. */}
              {providerLoading
                ? t('outreach_status_checking')
                : providerStatus?.kill_switch
                ? t('outreach_status_kill_switch')
                : providerStatus?.email?.real
                ? t('email_sending_real', { provider: providerStatus?.email?.provider })
                : t('email_sending_disabled')}
            </span>
          </div>

          {/* ── At a glance ──────────────────────────────────────────── */}
          {/* ── At a glance: real counters only; a rate with nothing sent is a dot, not 0%. ── */}
          {hasNothing ? null : (
            <KpiRow cols={6}>
              <Kpi labelKey="email_ws_active" icon={Activity} value={stats.active} accent loading={loading} />
              <Kpi labelKey="email_sent" icon={Send} value={stats.sent} loading={loading} />
              <Kpi labelKey="email_delivered" icon={CheckCircle2} value={stats.delivered} loading={loading} />
              <Kpi labelKey="email_bounced" icon={AlertTriangle} value={stats.bounced} loading={loading} />
              <Kpi labelKey="email_ws_delivery_rate" icon={BarChart2} value={stats.deliveryRate === null ? null : pct(stats.deliveryRate)} loading={loading} />
              <Kpi labelKey="email_ws_reply_rate" icon={MessageSquare} value={stats.replyRate === null ? null : pct(stats.replyRate)} loading={loading} />
            </KpiRow>
          )}

          <div className="flex flex-wrap items-center gap-1 border-b border-border/70 pb-px" role="tablist" aria-label={t('email_campaigns_title')}>
            {TABS.map((x) => {
              const n = x.match ? campaigns.filter((c) => (x.match as readonly string[]).includes(c.status)).length : campaigns.length;
              return (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.key}
                  onClick={() => setTab(x.key)}
                  className={cn(
                    '-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    tab === x.key ? 'border-gold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(x.label)}
                  <span className={cn('min-w-[1.25rem] rounded-full px-1.5 text-center text-2xs leading-5 tabular-nums', tab === x.key ? 'bg-[#0C1119] text-white' : 'bg-muted text-muted-foreground')}>{n}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Mail}
              titleKey="email_empty_title"
              bodyKey="email_empty_desc"
              action={{ labelKey: 'email_new_campaign', onClick: () => setCreateOpen(true) }}
              secondary={{ labelKey: 'comms_nav_contacts', onClick: () => navigate('/outreach/email/contacts') }}
            />
          ) : (
            <div className="space-y-3">
              {visible.map((c) => {
                const isLegacy = c.send_eligibility === 'LEGACY_MOCK';
                const sent = c.sent_count ?? 0;
                const failed = c.failed_count ?? 0;
                /* Both outcomes present is its own state. Reporting only the
                   successes of a half-failed campaign is the kind of true
                   number that misleads. */
                const partial = c.status === 'COMPLETED' && sent > 0 && failed > 0;
                const editable = ['DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED'].includes(c.status);
                const launchable = !isLegacy && !['COMPLETED', 'CANCELLED', 'SCHEDULED'].includes(c.status) && !!c.contact_list_id;

                return (
                  <Card key={c.id} className="overflow-hidden rounded-2xl border-border/80 shadow-[0_1px_2px_rgba(12,17,25,0.04)] transition-[border-color,box-shadow] hover:border-gold/40 hover:shadow-[0_10px_30px_-18px_rgba(12,17,25,0.35)]">
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0C1119] text-[hsl(38_92%_60%)] shadow-sm" aria-hidden="true">
                          <Mail className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="min-w-0 text-[15px] font-semibold leading-snug [overflow-wrap:break-word]">{c.name}</span>
                            <StatusBadge status={c.status} />
                            {partial && (
                              <Badge className="text-[13px] px-1.5 bg-yellow-500/10 text-yellow-700">{t('email_partially_failed')}</Badge>
                            )}
                            {isLegacy && (
                              <Badge className="text-[13px] px-1.5 bg-orange-500/10 text-orange-700 uppercase tracking-wide">
                                {t('email_legacy_mock_badge')}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[13px] px-1.5 uppercase">{c.language ?? 'en'}</Badge>
                          </div>
                          {c.subject && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground [overflow-wrap:break-word]">{c.subject}</p>}

                          {c.status === 'SCHEDULED' && c.scheduled_at && (
                            <p className="text-xs text-purple-700 mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {t('email_scheduled_for', { when: formatScheduled(c.scheduled_at, c.timezone, lang) })}
                            </p>
                          )}

                          {isLegacy && (
                            <p className="text-[13px] text-orange-700 mt-1">{t('email_legacy_mock_note')}</p>
                          )}
                          {/* The stored error is a provider message, not a
                              sentence for the person who wrote the campaign. */}
                          {c.status === 'FAILED' && c.last_send_error && (
                            <p className="text-[13px] text-red-700 mt-1">{t('email_send_error_generic')}</p>
                          )}

                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                            <span className="flex items-center gap-1"><BarChart2 className="h-3 w-3" />{c.audience_count ?? 0} {t('email_audience')}</span>
                            {sent === 0 && failed === 0 ? (
                              <span>{t('email_never_sent')}</span>
                            ) : (
                              <>
                                <span>{sent} {t('email_sent')}</span>
                                <span>{c.delivered_count ?? 0} {t('email_delivered')}</span>
                                {(c.bounce_count ?? 0) > 0 && <span className="text-red-700">{c.bounce_count} {t('email_bounced')}</span>}
                                {failed > 0 && <span className="text-red-700">{failed} {t('email_failed')}</span>}
                                {(c.complaint_count ?? 0) > 0 && <span className="text-red-700">{c.complaint_count} {t('email_complaints')}</span>}
                              </>
                            )}
                            {(c.cost_estimate_usd ?? 0) > 0 && <span>${c.cost_estimate_usd?.toFixed(2)}</span>}
                          </div>
                        </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
                          <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={t('email_preview_error')} disabled={previewLoadingId === c.id} onClick={() => handlePreview(c.id)}>
                            {previewLoadingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                          {editable && (
                            <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={t('email_edit')} onClick={() => openEdit(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {c.status === 'SCHEDULED' ? (
                            <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1.5 text-xs" onClick={() => handleCancelSchedule(c)}>
                              <XCircle className="h-3.5 w-3.5" />{t('email_cancel_schedule')}
                            </Button>
                          ) : editable && !isLegacy && c.contact_list_id ? (
                            <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1.5 text-xs"
                              onClick={() => { setScheduling(c); setScheduleAt(toLocalInput(c.scheduled_at)); }}>
                              <Clock className="h-3.5 w-3.5" />{t('email_schedule')}
                            </Button>
                          ) : null}
                          {launchable && (
                            <Button
                              size="sm" className="h-8 px-2.5 gap-1.5 text-xs"
                              disabled={launchingId === c.id}
                              onClick={() => handleLaunch(c)}
                            >
                              {launchingId === c.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Rocket className="h-3.5 w-3.5" />}
                              {c.status === 'RUNNING' ? t('email_continue_sending') : t('email_send_now')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {hasNothing ? null : (<>
          {/* ── Replies ──────────────────────────────────────────────── */}
          <Section titleKey="email_ws_replies">
            {replies.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card/50 px-4 py-6 text-center">
                <p className="text-sm font-medium">{t('email_ws_no_replies')}</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t('email_ws_no_replies_body')}
                </p>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {replies.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.peer_name || c.peer_address}
                        </span>
                        {(c.unread_count ?? 0) > 0 && (
                          <Badge className="bg-gold-soft px-1.5 text-[13px] text-gold-ink">{c.unread_count}</Badge>
                        )}
                      </div>
                      {c.last_message_preview ? (
                        <p className="truncate text-xs text-muted-foreground">{c.last_message_preview}</p>
                      ) : null}
                    </div>
                    {c.last_message_at ? (
                      <time
                        dateTime={c.last_message_at}
                        className="shrink-0 text-[13px] tabular-nums text-muted-foreground"
                      >
                        {new Date(c.last_message_at).toLocaleDateString(lang, { month: 'short', day: 'numeric' })}
                      </time>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Live email activity ──────────────────────────────────── */}
          <Section titleKey="email_ws_activity">
            {activity.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card/50 px-4 py-6 text-center">
                <p className="text-sm font-medium">{t('email_ws_no_activity')}</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t('email_ws_no_activity_body')}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-secondary/40 text-start">
                    <tr className="text-[13px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-3 py-2 text-start font-medium">{t('email_from')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{t('email_campaign_name')}</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{t('comm_status')}</th>
                      <th scope="col" className="px-3 py-2 text-end font-medium">{t('email_sent')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activity.map((row) => {
                      /* The campaign NAME from rows this page already holds.
                         Asking the database again for something already in
                         memory is how a list becomes N+1 queries. */
                      const campaign = campaigns.find((c) => c.id === row.campaign_id);
                      return (
                        <tr key={row.id} className="align-middle">
                          <td className="max-w-[14rem] truncate px-3 py-2">{row.recipient_email ?? '—'}</td>
                          <td className="max-w-[12rem] truncate px-3 py-2 text-muted-foreground">
                            {campaign?.name ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-end text-[13px] tabular-nums text-muted-foreground">
                            {row.sent_at
                              ? new Date(row.sent_at).toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── Templates: what is true, rather than an empty list ────── */}
          <Section titleKey="email_ws_templates">
            <div className="rounded-lg border border-dashed bg-card/50 px-4 py-6 text-center">
              <p className="text-sm font-medium">{t('email_ws_templates_none')}</p>
              <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {t('email_ws_templates_body')}
              </p>
            </div>
          </Section>
          </>)}
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('email_new_campaign')}</DialogTitle></DialogHeader>
            {fields(form, setForm)}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('general_cancel')}</Button>
              <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
                {creating && <Loader2 className="h-4 w-4 me-2 animate-spin" />}{t('general_create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('email_edit_title')}</DialogTitle></DialogHeader>
            {fields(editForm, setEditForm)}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>{t('general_cancel')}</Button>
              <Button onClick={handleSaveEdit} disabled={saving || !editForm.name.trim()}>
                {saving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}{t('general_save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!scheduling} onOpenChange={(open) => !open && setScheduling(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <DialogHeader><DialogTitle>{t('email_schedule_title')}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-schedule-at">{t('email_schedule_at')}</Label>
                <Input
                  id="email-schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('email_timezone')}: {zone}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduling(null)}>{t('general_cancel')}</Button>
              <Button onClick={handleSaveSchedule} disabled={savingSchedule || !scheduleAt}>
                {savingSchedule && <Loader2 className="h-4 w-4 me-2 animate-spin" />}{t('email_schedule')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!previewCampaign} onOpenChange={(open) => !open && setPreviewCampaign(null)}>
          <DialogContent className="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-gold-ink" />
                {previewCampaign?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {previewCampaign?.send_eligibility === 'LEGACY_MOCK' && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{t('email_legacy_mock_note')}</AlertDescription>
                </Alert>
              )}
              <div className="rounded-lg border border-border p-3 space-y-1 text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">{t('email_subject')}:</span> {previewCampaign?.subject || '—'}</p>
                {(previewCampaign?.sender_name || previewCampaign?.sender_email) && (
                  <p><span className="font-medium text-foreground">{t('email_from')}:</span> {previewCampaign?.sender_name} {previewCampaign?.sender_email ? `<${previewCampaign.sender_email}>` : ''}</p>
                )}
                {previewCampaign?.reply_to && (
                  <p><span className="font-medium text-foreground">{t('email_reply_to')}:</span> {previewCampaign.reply_to}</p>
                )}
              </div>
              {/* The email as it is sent (src/emailMarketing/campaignTemplate.ts), in a frame with
                  every sandbox permission withheld: no script runs, nothing reaches this page. */}
              {previewCampaign?.html_body || previewCampaign?.text_body ? (
                <>
                  <iframe
                    title={t('emx_preview_title')}
                    sandbox=""
                    srcDoc={renderCampaignEmail({
                      subject: previewCampaign.subject || previewCampaign.name,
                      bodyHtml: previewCampaign.html_body ?? null, bodyText: previewCampaign.text_body ?? null,
                      senderName: previewCampaign.sender_name ?? null, lang: previewCampaign.language ?? 'en', unsubscribeUrl: '#',
                    }).html}
                    className="h-[30rem] w-full rounded-xl border bg-[#F6F3EE]"
                  />
                  <p className="text-[13px] leading-snug text-muted-foreground">{t('emx_preview_note')}</p>
                </>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t('email_preview_empty')}</p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setPreviewCampaign(null)}>{t('general_close')}</Button>
              <Button
                disabled={testingId === previewCampaign?.id || !(previewCampaign?.html_body || previewCampaign?.text_body)}
                onClick={() => previewCampaign && void handleTestSend(previewCampaign.id)}
                className="gap-1.5"
              >
                {testingId === previewCampaign?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('emx_test_send')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </CommsWorkspace>
  );
}
