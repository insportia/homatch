// EMAIL STUDIO — one campaign, in detail (UX pass §7): /outreach/email/campaigns/:id/overview.
//
// What it is, who sent it to whom, what the recipient saw, and what happened — every figure from
// provider-confirmed records (outreach_sends, written by outreach-send and the Resend webhook).
// Opens and clicks are not tracked for campaign email and say so; they are never shown as zero.
// A draft opens in the editor; a sent campaign is shown as it was sent and is never edited in
// place — "Duplicate" starts a new draft from it.

import {
  AlertTriangle, ArrowLeft, CalendarClock, CircleSlash, Copy, Loader2, Mail, Pause, Pencil, Play, RefreshCw, Send, ShieldCheck, Users, XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { EmailPreviewFrame, findingText, PhaseBadge, reasonText } from '@/components/emailStudio/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { emailPhase, isEditable } from '@/emailMarketing/reviewState';
import {
  campaignReviews, campaignSends, duplicateCampaign, getCampaign, myLists, type ReviewEntry, type SendRow, type StudioCampaign, sendNow, setCampaignStatus, StudioError,
} from '@/services/emailCampaignStudio';

export default function EmailCampaignDetailsPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const [c, setC] = useState<StudioCampaign | null>(null);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [history, setHistory] = useState<ReviewEntry[]>([]);
  const [listNames, setListNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'pause'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [camp, s, h, lists] = await Promise.all([getCampaign(id), campaignSends(id), campaignReviews(id), myLists()]);
      if (!camp) { setMissing(true); return; }
      setC(camp); setSends(s); setHistory(h);
      setListNames(Object.fromEntries(lists.map((l) => [l.id, l.name])));
    } catch { setMissing(true); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const m = useMemo(() => {
    const out = { attempted: sends.length, accepted: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0, failed: 0, queued: 0, first: null as string | null, last: null as string | null };
    const errors = new Map<string, number>();
    for (const s of sends) {
      if (['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPTED_OUT', 'READ'].includes(s.status)) out.accepted++;
      if (s.status === 'DELIVERED' || s.status === 'READ' || s.delivered_at) out.delivered++;
      if (s.status === 'BOUNCED') out.bounced++;
      if (s.status === 'COMPLAINED') out.complained++;
      if (s.status === 'OPTED_OUT') out.unsubscribed++;
      if (s.status === 'FAILED') { out.failed++; const k = (s.error_message ?? 'UNKNOWN').slice(0, 80); errors.set(k, (errors.get(k) ?? 0) + 1); }
      if (s.status === 'QUEUED') out.queued++;
      const at = s.sent_at ?? null;
      if (at && (!out.first || at < out.first)) out.first = at;
      if (at && (!out.last || at > out.last)) out.last = at;
    }
    return { ...out, errors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [sends]);

  if (loading && !c) return <CommsWorkspace product="email"><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-96 w-full rounded-2xl" /></CommsWorkspace>;
  if (missing || !c) {
    return (
      <CommsWorkspace product="email">
        <div className="rounded-2xl border bg-card p-8 text-center">
          <p className="font-medium">{t('ems_load_failed')}</p>
          <Button className="mt-3" onClick={() => navigate('/outreach/email/campaigns')}>{t('ems_back_to_campaigns')}</Button>
        </div>
      </CommsWorkspace>
    );
  }

  const phase = emailPhase(c.status);
  const editable = isEditable(c.status);
  const lists = (c.contact_list_ids?.length ? c.contact_list_ids : c.contact_list_id ? [c.contact_list_id] : []).map((x) => listNames[x] ?? '—');
  const selected = c.audience_filter?.contactIds?.length ?? 0;
  const pctOf = (n: number) => (m.accepted ? `${Math.round((n / m.accepted) * 1000) / 10}%` : '—');

  const act = async (what: 'duplicate' | 'pause' | 'resume' | 'cancel') => {
    setBusy(what);
    try {
      if (what === 'duplicate') {
        const copy = await duplicateCampaign(c, t('ems_copy_of'));
        toast.success(t('ems_duplicated'));
        navigate(`/outreach/email/campaigns/${copy.id}?step=design`);
        return;
      }
      if (what === 'pause') await setCampaignStatus(c.id, 'PAUSED');
      if (what === 'cancel') await setCampaignStatus(c.id, 'CANCELLED');
      if (what === 'resume') await sendNow(c.id);
      toast.success(t({ pause: 'ems_details_paused', resume: 'ems_details_resumed', cancel: 'ems_details_cancelled' }[what]));
      await load();
    } catch (e) {
      const code = e instanceof StudioError ? e.code.toLowerCase() : 'failed';
      toast.error(t(`ems_send_err_${code}`) === `ems_send_err_${code}` ? t('ems_err_status_failed') : t(`ems_send_err_${code}`));
    } finally { setBusy(null); setConfirm(null); }
  };

  const Stat = ({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'red' | 'amber' }) => (
    <div className={`rounded-xl border bg-card px-3.5 py-3 ${tone === 'red' ? 'border-red-200' : tone === 'amber' ? 'border-amber-200' : ''}`}>
      <p className="text-2xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString(lang) : value}</p>
      {sub ? <p className="text-2xs text-muted-foreground">{sub}</p> : null}
    </div>
  );

  return (
    <CommsWorkspace product="email" header={
      <div className="rounded-2xl bg-[#0C1119] px-4 py-4 text-white sm:px-6 sm:py-5">
        <button type="button" onClick={() => navigate('/outreach/email/campaigns')} className="mb-1.5 inline-flex items-center gap-1 text-2xs text-white/60 hover:text-white">
          <ArrowLeft className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />{t('ems_nav_campaigns')}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <h1 className="font-display text-xl font-bold leading-tight [overflow-wrap:break-word] sm:text-2xl">{c.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-white/70">
              <PhaseBadge status={c.status} className="border-white/20" />
              <span>{t('ems_details_created', { when: new Date(c.created_at).toLocaleString(lang) })}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? <Button size="sm" className="h-9 gap-1.5 bg-white text-[#0C1119] hover:bg-white/90" onClick={() => navigate(`/outreach/email/campaigns/${c.id}?step=${phase === 'APPROVED' || phase === 'SCHEDULED' ? 'review' : 'design'}`)}><Pencil className="h-4 w-4" />{t(phase === 'APPROVED' || phase === 'SCHEDULED' ? 'ems_details_review' : 'ems_details_edit')}</Button> : null}
            <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" disabled={busy === 'duplicate'} onClick={() => void act('duplicate')}>
              {busy === 'duplicate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}{t('ems_duplicate')}
            </Button>
            {phase === 'SENDING' ? <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => setConfirm('pause')}><Pause className="h-4 w-4" />{t('ems_details_pause')}</Button> : null}
            {phase === 'PAUSED' && c.approved_content_hash && c.approved_content_hash === c.content_hash ? (
              <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" disabled={busy === 'resume'} onClick={() => void act('resume')}><Play className="h-4 w-4" />{t('ems_details_resume')}</Button>
            ) : null}
            {!['SENDING', 'SENT', 'CANCELLED', 'PARTIALLY_SENT'].includes(phase) ? <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => setConfirm('cancel')}><XCircle className="h-4 w-4" />{t('ems_details_cancel')}</Button> : null}
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-white hover:bg-white/10" aria-label={t('ems_retry')} onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
    }>
      <section aria-label={t('ems_details_metrics')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={t('ems_m_recipients')} value={c.audience_count ?? m.attempted} sub={t('ems_m_recipients_sub')} />
        <Stat label={t('ems_m_sent')} value={m.accepted} sub={m.queued ? t('ems_m_queued', { n: m.queued }) : undefined} />
        <Stat label={t('ems_m_delivered')} value={m.delivered} sub={pctOf(m.delivered)} />
        <Stat label={t('ems_m_bounced')} value={m.bounced} sub={pctOf(m.bounced)} tone={m.bounced ? 'amber' : undefined} />
        <Stat label={t('ems_m_failed')} value={m.failed} tone={m.failed ? 'red' : undefined} />
        <Stat label={t('ems_m_unsubscribed')} value={m.unsubscribed} sub={m.complained ? t('ems_m_complaints', { n: m.complained }) : undefined} />
      </section>
      <p className="-mt-2 text-2xs text-muted-foreground">{t('ems_m_opens_note')}</p>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <EmailPreviewFrame subject={c.subject ?? c.name} html={c.html_body ?? null} senderName={c.sender_name} language={c.language} previewText={c.preview_text} />
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4 text-[hsl(32_60%_38%)]" />{t('ems_details_about')}</h2>
            <dl className="space-y-2.5 text-sm">
              <Row label={t('ems_f_subject')} value={c.subject ?? '—'} />
              <Row label={t('ems_f_preview')} value={c.preview_text ?? '—'} />
              <Row label={t('ems_review_sender')} value={`${c.sender_name || 'HOMATCH'} · ${c.sender_email || t('ems_sender_homatch_address')}`} ltr />
              <Row label={t('ems_review_recipients')} value={selected ? t('ems_details_selected', { n: selected }) : lists.join(', ') || '—'} icon={Users} />
              {c.scheduled_at ? <Row label={t('ems_details_scheduled')} value={new Date(c.scheduled_at).toLocaleString(lang)} icon={CalendarClock} /> : null}
              <Row label={t('ems_details_first_sent')} value={m.first ? new Date(m.first).toLocaleString(lang) : '—'} icon={Send} />
              <Row label={t('ems_details_last_sent')} value={m.last ? new Date(m.last).toLocaleString(lang) : '—'} />
            </dl>
          </section>

          {m.errors.length || c.review_note || (c.risk_reasons?.length ?? 0) > 0 ? (
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />{t('ems_details_issues')}</h2>
              <ul className="space-y-1.5 text-[13px]">
                {m.errors.map(([e, n]) => <li key={e} className="flex items-start gap-1.5 text-red-800"><CircleSlash className="mt-px h-3.5 w-3.5 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{t('ems_details_error_n', { n })}: <span dir="ltr">{e}</span></span></li>)}
                {c.review_note ? <li className="text-orange-900">{t('ems_reviewer_note')}: {c.review_note}</li> : null}
                {(c.risk_reasons ?? []).slice(0, 5).map((f, i) => <li key={i} className="text-muted-foreground">• {findingText(t, f)}</li>)}
              </ul>
            </section>
          ) : null}

          {history.length ? (
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-[hsl(32_60%_38%)]" />{t('ems_history_title')}</h2>
              <ol className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="text-[13px]">
                    <span className="font-medium">{t(`ems_rev_${h.action.toLowerCase()}`)}</span>
                    <span className="ms-1.5 text-2xs text-muted-foreground">{new Date(h.created_at).toLocaleString(lang)}</span>
                    {h.reason ? <span className="block text-2xs text-muted-foreground">{reasonText(t, h.reason)}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`ems_details_${confirm}_title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`ems_details_${confirm}_body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void act(confirm)}>{t(`ems_details_${confirm}`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}

function Row({ label, value, icon: Icon, ltr }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }>; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-2xs font-medium text-muted-foreground">{Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}{label}</dt>
      <dd className="[overflow-wrap:anywhere]" dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}
