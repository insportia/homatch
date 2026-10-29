/*
 * ONE UNLOCKED CONTACT, IN FULL.
 *
 * Status, notes, a follow-up, the recent messages, the activity timeline and one
 * suggested next step. Full screen on a phone, a side panel from the inline-end edge on
 * wider screens. Built on the Radix dialog primitive directly (not ui/sheet) so the close
 * control is touch-sized, localized and on the logical edge in RTL.
 *
 * Find Buyers 2.0: the lead's profile (documented search, match explanation, source,
 * unlock), the contact details the member allows today (internal_lead_contact — consent and
 * blocks re-checked on every read), AI outreach drafts and the owner's logged contacts.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity, CalendarClock, ChevronDown, Loader2, Mail, MessageSquare, NotebookPen, PhoneCall, RefreshCw, X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  CONTACT_CHANNELS, OWNER_SETTABLE_STATUSES, conversationHref, emailStudioHref, isFollowUpDue, isoToLocalInput, localInputToIso, statusLabelKey,
  type ContactChannel,
} from '@/crm/model';
import { suggestNextStep, type CrmStatus, type NextStep } from '@/crm/nextStep';
import { useServiceVisible } from '@/lib/serviceControls';
import { cn } from '@/lib/utils';
import {
  crmEntryDetail, crmEntryProfile, crmUpdate, type CrmEntryDetail, type CrmListItem, type CrmProfile,
} from '@/services/leadsCrm';
import { getLeadContact, type LeadContact } from '@/services/homatchLeads';
import { LeadOutreachComposer } from './LeadOutreachComposer';
import { LeadProfileCard } from './LeadProfileCard';
import { ActivityTimeline } from './ActivityTimeline';
import { NextStepCard } from './NextStepCard';
import {
  CrmStatusPill, FIELD, GOLD_BUTTON, SECONDARY_BUTTON, SectionCard, useCrmDateFormat,
} from './ui';

const NOTE_MAX = 4000;
const FOLLOW_UP_NOTE_MAX = 500;

export function CrmEntryDrawer({
  entryId,
  item,
  onClose,
  onChanged,
}: {
  entryId: string | null;
  /** The list row, when the entry is on the current page (gives the name and property). */
  item: CrmListItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  /* Email Marketing hidden (fail closed): no Email Studio entry from the CRM. */
  const emailMarketing = useServiceVisible('email_marketing');
  const fmt = useCrmDateFormat();
  const open = entryId !== null;

  const [detail, setDetail] = useState<CrmEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'status' | 'note' | 'follow' | 'clear' | 'log'>(null);
  const [profile, setProfile] = useState<CrmProfile | null>(null);
  const [contact, setContact] = useState<LeadContact | null>(null);
  const [logChannel, setLogChannel] = useState<ContactChannel>('PHONE');
  const [logOutcome, setLogOutcome] = useState('');

  const [statusDraft, setStatusDraft] = useState<CrmStatus>('UNLOCKED');
  const [noteDraft, setNoteDraft] = useState('');
  const [followAt, setFollowAt] = useState('');
  const [followNote, setFollowNote] = useState('');
  const [showActivity, setShowActivity] = useState(false);

  const statusRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef<HTMLInputElement>(null);

  const adopt = useCallback((d: CrmEntryDetail) => {
    setDetail(d);
    setStatusDraft(d.status);
    setFollowAt(isoToLocalInput(d.followUpAt));
    setFollowNote(d.followUpNote ?? '');
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setFailed(false);
    try {
      adopt(await crmEntryDetail(id));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  /* Find Buyers 2.0: the lead's documented search, the match explanation and the contact the
     member allows today (consent re-checked on every read). */
  const loadProfile = useCallback(async (id: string) => {
    try {
      const p = await crmEntryProfile(id);
      setProfile(p);
      if (p?.match?.matchId) setContact(await getLeadContact(p.match.matchId).catch(() => ({ restricted: true, reason: 'UNAVAILABLE' as const })));
      else setContact({ restricted: true, reason: 'UNAVAILABLE' });
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    setProfile(null);
    setContact(null);
    setNoteDraft('');
    setLogOutcome('');
    setShowActivity(false);
    if (entryId) { void load(entryId); void loadProfile(entryId); }
  }, [entryId, load, loadProfile]);

  const logContact = async () => {
    if (!entryId) return;
    setBusy('log');
    try {
      adopt(await crmUpdate(entryId, { logContact: logChannel, outcome: logOutcome }));
      setLogOutcome('');
      toast.success(t('lo_logged'));
      onChanged();
    } catch {
      toast.error(t('crm_save_failed'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (kind: 'status' | 'note' | 'follow' | 'clear') => {
    if (!entryId) return;
    setBusy(kind);
    try {
      let next: CrmEntryDetail;
      if (kind === 'status') next = await crmUpdate(entryId, { status: statusDraft });
      else if (kind === 'note') next = await crmUpdate(entryId, { note: noteDraft });
      else if (kind === 'follow') {
        next = await crmUpdate(entryId, { followUpAt: localInputToIso(followAt), followUpNote: followNote.trim() || null });
      } else next = await crmUpdate(entryId, { followUpAt: null, followUpNote: null });
      adopt(next);
      if (kind === 'note') setNoteDraft('');
      toast.success(t(kind === 'status' ? 'crm_saved_status' : kind === 'note' ? 'crm_saved_note' : kind === 'follow' ? 'crm_saved_follow_up' : 'crm_cleared_follow_up'));
      onChanged();
    } catch {
      toast.error(t('crm_save_failed'));
    } finally {
      setBusy(null);
    }
  };

  const step: NextStep | null = useMemo(() => (detail ? suggestNextStep({
    status: detail.status,
    messages: detail.messages,
    followUpAt: detail.followUpAt,
    lastActivityAt: item?.lastActivityAt ?? detail.events[0]?.createdAt ?? null,
  }) : null), [detail, item?.lastActivityAt]);

  const conversationId = detail?.conversationId ?? item?.conversationId ?? null;
  const propertyId = detail?.propertyId ?? item?.propertyId ?? null;

  const openConversation = () => {
    if (conversationId) navigate(conversationHref(conversationId));
  };
  const createEmail = () => {
    if (!entryId || !emailMarketing) return;
    const href = emailStudioHref([{ entryId, propertyId }]);
    if (href) navigate(href);
  };

  const focusRef = (ref: React.RefObject<HTMLElement | null>) => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  const onStepAction = (action: NonNullable<NextStep['action']>) => {
    if (action === 'conversation') openConversation();
    else if (action === 'follow_up') focusRef(followRef);
    else if (action === 'note') focusRef(noteRef);
    else focusRef(statusRef);
  };

  const followIso = localInputToIso(followAt);
  const followInPast = followIso !== null && Date.parse(followIso) <= Date.now();
  const due = isFollowUpDue(detail?.followUpAt);
  const name = item?.displayName || t('crm_anonymous');

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(218_45%_8%/0.45)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          dir={isRTL ? 'rtl' : 'ltr'}
          aria-describedby={undefined}
          className={cn(
            'hm-customer fixed inset-y-0 end-0 z-50 flex w-full flex-col bg-[hsl(42_38%_97%)] text-[hsl(218_45%_14%)] shadow-2xl outline-none',
            'sm:max-w-[40rem] sm:border-s sm:border-[hsl(40_12%_84%)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none',
          )}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className="flex items-start gap-3 border-b border-[hsl(40_12%_86%)] bg-white px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="break-words font-display text-lg font-semibold leading-tight text-[hsl(218_45%_14%)]">
                {name}
              </DialogPrimitive.Title>
              {item?.propertyTitle || item?.homatchId ? (
                <p className="mt-1 break-words text-sm text-[hsl(218_28%_34%)]">
                  {item?.propertyTitle ?? ''}
                  {item?.homatchId ? <span dir="ltr" className="ms-1.5 tabular-nums text-[hsl(218_15%_44%)]">#{item.homatchId}</span> : null}
                </p>
              ) : null}
              {detail ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CrmStatusPill status={detail.status} />
                  {due ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(38_60%_70%)] bg-[hsl(41_88%_94%)] px-2.5 py-1 text-2xs font-semibold text-[hsl(34_90%_28%)]">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {t('crm_follow_up_due')}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogPrimitive.Close
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(40_12%_84%)] bg-white text-[hsl(218_45%_14%)] hover:bg-[hsl(42_60%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]"
              aria-label={t('crm_close')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>

          {/* ── Body ───────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6">
            {loading && !detail ? (
              <div className="space-y-3" aria-busy="true" aria-live="polite">
                <span className="sr-only">{t('crm_loading')}</span>
                <Skeleton className="h-12 rounded-xl motion-reduce:animate-none" />
                <Skeleton className="h-32 rounded-2xl motion-reduce:animate-none" />
                <Skeleton className="h-40 rounded-2xl motion-reduce:animate-none" />
              </div>
            ) : failed ? (
              <div role="alert" className="rounded-2xl border border-[hsl(0_60%_80%)] bg-white p-5">
                <p className="text-sm text-[hsl(218_45%_14%)]">{t('crm_detail_failed')}</p>
                <button type="button" className={cn(SECONDARY_BUTTON, 'mt-3')} onClick={() => entryId && void load(entryId)}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('crm_retry')}
                </button>
              </div>
            ) : detail ? (
              <div className="space-y-4">
                {/* Primary actions */}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button type="button" className={cn(GOLD_BUTTON, 'w-full sm:w-auto')} onClick={openConversation} disabled={!conversationId}>
                    <MessageSquare className="h-4 w-4" aria-hidden="true" /> {t('crm_open_conversation')}
                  </button>
                  {emailMarketing ? (
                    <button type="button" className={cn(SECONDARY_BUTTON, 'h-12 w-full sm:w-auto')} onClick={createEmail} data-testid="crm-create-email">
                      <Mail className="h-4 w-4" aria-hidden="true" /> {t('crm_create_email')}
                    </button>
                  ) : null}
                </div>
                {!conversationId ? (
                  <p className="text-2xs leading-relaxed text-[hsl(218_15%_40%)]">{t('crm_no_conversation')}</p>
                ) : null}

                {step ? <NextStepCard step={step} onAction={onStepAction} canOpenConversation={Boolean(conversationId)} /> : null}

                {profile ? <LeadProfileCard profile={profile} contact={contact} /> : null}

                {entryId ? (
                  <LeadOutreachComposer entryId={entryId} propertyId={propertyId}
                    memberLanguage={item?.language ?? contact?.language ?? null}
                    contact={contact}
                    conversationId={conversationId} onOpenConversation={openConversation} onOpenEmailStudio={createEmail}
                    onLogged={() => { if (entryId) void load(entryId); onChanged(); }} />
                ) : null}

                {/* Log a contact that happened outside HOMATCH — the owner's own statement. */}
                <SectionCard title={t('crm_log_contact')} icon={PhoneCall} labelledBy="crm-log-h">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
                    <label className="grid gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
                      <span>{t('crm_log_channel')}</span>
                      <select className={cn(FIELD, 'h-11')} value={logChannel} onChange={(e) => setLogChannel(e.target.value as ContactChannel)} disabled={busy !== null}>
                        {CONTACT_CHANNELS.map((c) => <option key={c} value={c}>{t(`crm_channel_${c}`)}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
                      <span>{t('crm_log_outcome')}</span>
                      <input className={cn(FIELD, 'h-11')} value={logOutcome} maxLength={300} onChange={(e) => setLogOutcome(e.target.value)}
                        placeholder={t('crm_log_outcome_placeholder')} disabled={busy !== null} dir="auto" />
                    </label>
                  </div>
                  <button type="button" className={cn(SECONDARY_BUTTON, 'mt-2 h-11 w-full sm:w-auto')} onClick={() => void logContact()} disabled={busy !== null} data-testid="crm-log-contact">
                    {busy === 'log' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PhoneCall className="h-4 w-4" aria-hidden="true" />}
                    {t('crm_log_contact')}
                  </button>
                  <p className="mt-2 text-2xs leading-relaxed text-[hsl(218_15%_40%)]">{t('crm_log_hint')}</p>
                </SectionCard>

                {/* Update Status */}
                <SectionCard title={t('crm_update_status')} icon={RefreshCw} labelledBy="crm-status-h">
                  <label htmlFor="crm-status" className="sr-only">{t('crm_status_label')}</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      id="crm-status"
                      ref={statusRef}
                      className={cn(FIELD, 'h-12 sm:flex-1')}
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value as CrmStatus)}
                      disabled={busy !== null}
                    >
                      {/* DELIVERED is a transport fact, never chosen by hand; it stays visible when it is the current stage. */}
                      {(detail.status === 'DELIVERED' ? ['DELIVERED' as CrmStatus, ...OWNER_SETTABLE_STATUSES] : OWNER_SETTABLE_STATUSES)
                        .map((s) => <option key={s} value={s}>{t(statusLabelKey(s))}</option>)}
                    </select>
                    <button
                      type="button"
                      className={cn(SECONDARY_BUTTON, 'h-12')}
                      disabled={busy !== null || statusDraft === detail.status}
                      onClick={() => void save('status')}
                    >
                      {busy === 'status' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                      {t('crm_update_status')}
                    </button>
                  </div>
                  <p className="mt-2 text-2xs leading-relaxed text-[hsl(218_15%_40%)]">{t('crm_status_hint')}</p>
                </SectionCard>

                {/* Schedule Follow-Up */}
                <SectionCard title={t('crm_schedule_follow_up')} icon={CalendarClock} labelledBy="crm-follow-h">
                  {detail.followUpAt ? (
                    <p className={cn('mb-3 rounded-xl border px-3 py-2 text-sm', due
                      ? 'border-[hsl(38_60%_70%)] bg-[hsl(41_88%_94%)] text-[hsl(34_90%_24%)]'
                      : 'border-[hsl(40_12%_86%)] bg-[hsl(42_38%_98%)] text-[hsl(218_45%_14%)]')}
                    >
                      {t(due ? 'crm_follow_up_was_due' : 'crm_follow_up_set', { date: fmt.dateTime(detail.followUpAt) })}
                      {detail.followUpNote ? <span className="mt-0.5 block break-words text-[hsl(218_28%_34%)]" dir="auto">{detail.followUpNote}</span> : null}
                    </p>
                  ) : null}
                  <div className="grid gap-3">
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-[hsl(218_45%_14%)]">{t('crm_follow_up_when')}</span>
                      <input
                        ref={followRef}
                        type="datetime-local"
                        className={cn(FIELD, 'h-12 min-w-0')}
                        value={followAt}
                        onChange={(e) => setFollowAt(e.target.value)}
                        disabled={busy !== null}
                        aria-invalid={followInPast || undefined}
                        aria-describedby={followInPast ? 'crm-follow-past' : undefined}
                      />
                    </label>
                    {followInPast ? <p id="crm-follow-past" className="text-2xs text-[hsl(0_66%_40%)]">{t('crm_follow_up_past')}</p> : null}
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-[hsl(218_45%_14%)]">{t('crm_follow_up_note')}</span>
                      <input
                        type="text"
                        className={cn(FIELD, 'h-12')}
                        value={followNote}
                        maxLength={FOLLOW_UP_NOTE_MAX}
                        onChange={(e) => setFollowNote(e.target.value)}
                        placeholder={t('crm_follow_up_note_placeholder')}
                        disabled={busy !== null}
                        dir="auto"
                      />
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className={cn(SECONDARY_BUTTON, 'h-12')}
                        disabled={busy !== null || !followIso || followInPast}
                        onClick={() => void save('follow')}
                      >
                        {busy === 'follow' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}
                        {t('crm_schedule_follow_up')}
                      </button>
                      {detail.followUpAt ? (
                        <button type="button" className={cn(SECONDARY_BUTTON, 'h-12')} disabled={busy !== null} onClick={() => void save('clear')}>
                          {busy === 'clear' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                          {t('crm_clear_follow_up')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>

                {/* Add Note */}
                <SectionCard title={t('crm_notes')} icon={NotebookPen} labelledBy="crm-notes-h">
                  <label htmlFor="crm-note" className="sr-only">{t('crm_add_note')}</label>
                  <textarea
                    id="crm-note"
                    ref={noteRef}
                    rows={3}
                    maxLength={NOTE_MAX}
                    className={cn(FIELD, 'min-h-[6rem] resize-y py-3')}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder={t('crm_note_placeholder')}
                    disabled={busy !== null}
                    dir="auto"
                  />
                  <button
                    type="button"
                    className={cn(SECONDARY_BUTTON, 'mt-2 h-12 w-full sm:w-auto')}
                    disabled={busy !== null || noteDraft.trim().length === 0}
                    onClick={() => void save('note')}
                  >
                    {busy === 'note' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <NotebookPen className="h-4 w-4" aria-hidden="true" />}
                    {t('crm_add_note')}
                  </button>
                  <p className="mt-2 text-2xs text-[hsl(218_15%_40%)]">{t('crm_notes_private')}</p>
                  {detail.notes.length > 0 ? (
                    <ul className="mt-3 divide-y divide-[hsl(40_12%_88%)]">
                      {detail.notes.map((n) => (
                        <li key={n.id} className="py-2.5">
                          <p className="whitespace-pre-wrap break-words text-sm text-[hsl(218_45%_14%)]" dir="auto">{n.body}</p>
                          <p className="mt-0.5 text-2xs text-[hsl(218_15%_42%)]"><time dateTime={n.createdAt}>{fmt.dateTime(n.createdAt)}</time></p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </SectionCard>

                {/* Recent messages */}
                <SectionCard title={t('crm_recent_messages')} icon={MessageSquare} labelledBy="crm-msgs-h">
                  {detail.messages.length === 0 ? (
                    <p className="text-sm text-[hsl(218_15%_40%)]">{t('crm_messages_empty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.messages.slice(0, 6).map((m) => (
                        <li
                          key={m.id}
                          className={cn('max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm',
                            m.mine
                              ? 'ms-auto bg-[hsl(218_45%_14%)] text-white'
                              : 'me-auto border border-[hsl(40_12%_86%)] bg-white text-[hsl(218_45%_14%)]')}
                        >
                          <p className={cn('mb-0.5 text-2xs font-semibold', m.mine ? 'text-[hsl(40_94%_70%)]' : 'text-[hsl(34_90%_31%)]')}>
                            {m.mine ? t('crm_msg_you') : name}
                          </p>
                          <p className="whitespace-pre-wrap break-words" dir="auto">{m.body}</p>
                          <p className={cn('mt-1 text-2xs', m.mine ? 'text-white/70' : 'text-[hsl(218_15%_42%)]')}>
                            <time dateTime={m.createdAt}>{fmt.dateTime(m.createdAt)}</time>
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {conversationId ? (
                    <button type="button" className={cn(SECONDARY_BUTTON, 'mt-3 w-full sm:w-auto')} onClick={openConversation}>
                      {t('crm_open_conversation')}
                    </button>
                  ) : null}
                </SectionCard>

                {/* View Activity */}
                <section aria-labelledby="crm-activity-h" className="rounded-2xl border border-[hsl(40_12%_86%)] bg-white p-4 sm:p-5">
                  <h3 id="crm-activity-h" className="sr-only">{t('crm_view_activity')}</h3>
                  <button
                    type="button"
                    className={cn(SECONDARY_BUTTON, 'w-full justify-between')}
                    aria-expanded={showActivity}
                    aria-controls="crm-activity"
                    onClick={() => setShowActivity((v) => !v)}
                  >
                    <span className="flex items-center gap-2">
                      <Activity className="h-4 w-4" aria-hidden="true" /> {t('crm_view_activity')}
                      <span className="tabular-nums text-[hsl(218_15%_44%)]">({detail.events.length})</span>
                    </span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', showActivity && 'rotate-180')} aria-hidden="true" />
                  </button>
                  {showActivity ? (
                    <div id="crm-activity" className="mt-4">
                      <ActivityTimeline events={detail.events} />
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
