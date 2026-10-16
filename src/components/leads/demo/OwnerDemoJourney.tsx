// HOMATCH LEADS — DEMO MODE: the whole Leads journey against one fictional buyer.
//
// Shown inside the real HOMATCH Leads page (/property/:id/leads?demo=1), only to the
// property's owner when they are in the demo audience (the server decides:
// owner_demo_lead_* in 20261029090000). It reuses the real pieces — LeadCard, the
// UnlockDialog (with a simulated adapter), the CRM statuses, the chat delivery ticks,
// the Email Studio renderer and preview — and every action goes to the demo RPCs, which
// write only to the demo_* tables. No credits move; nothing is sent to anybody.
//
// Every surface says DEMO. The match score (92%) and the unlock price (2.5 credits) are
// fixed demo values, labelled as simulated wherever they appear.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, BellRing, Building2, CheckCircle2, Circle, ClipboardList, FlaskConical, Home, Loader2, LogOut, Mail,
  MessageSquare, Phone, RotateCcw, Send, Sparkles, StickyNote, UserRound, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageStatusIcon } from '@/components/chat/MessageStatusIcon';
import { EmailPreview, type PreviewMode } from '@/components/emailStudio/EmailPreview';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { CRM_STATUSES, statusLabelKey } from '@/crm/model';
import { defaultContent, type EmailContent } from '@/emailStudio/blocks';
import { renderEmail, type PropertyEmailData } from '@/emailStudio/render';
import { budgetLabel, locationLabel } from '@/leads/leadSummary';
import {
  DEMO_STEPS, DEMO_STEP_SECTION, demoActivity, demoBuyerHistory, demoEventKey, demoProgress, demoStepDone,
  nextDemoStep, toDemoLeadItem, unreadDemoNotifications, type DemoStep, type OwnerDemoMessage, type OwnerDemoPayload,
} from '@/leads/ownerDemo';
import { emailStudio } from '@/services/emailStudio';
import type { UnlockQuote, UnlockResult } from '@/services/homatchLeads';
import {
  openOwnerDemo, ownerDemoAct, resetOwnerDemo, sendOwnerDemoMessage, type OwnerDemoAction,
} from '@/services/ownerDemoLead';
import { deliveryState } from '@/services/internalMatchDemo';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TERTIARY, EYEBROW, SURFACE } from '../kit';
import { LeadCard, useLeadFormatters } from '../LeadCard';
import { UnlockDialog, type UnlockAdapter } from '../UnlockDialog';

const DEMO_TEMPLATE = 'PERSONAL_FOLLOW_UP' as const;
const STATUS_KEY = { SENT: 'im_chat_status_sent', DELIVERED: 'im_chat_status_delivered', SEEN: 'im_chat_status_seen' } as const;
const PINK_TAG = 'inline-flex items-center gap-1 rounded-full bg-[hsl(328_70%_95%)] px-2.5 py-0.5 text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(328_70%_30%)]';

export function DemoTag({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <span className={PINK_TAG} data-testid="demo-tag">
      <FlaskConical className="h-3 w-3" aria-hidden="true" />{label ?? t('demo_badge')}
    </span>
  );
}

function SectionCard({ id, icon: Icon, title, done, children, testId }: {
  id: string; icon: React.ComponentType<{ className?: string }>; title: string; done?: boolean; children: React.ReactNode; testId?: string;
}) {
  const { t } = useLanguage();
  const doneLabel = t('demo_done');
  return (
    <section id={id} data-testid={testId ?? id} aria-labelledby={`${id}-title`} className={cn(SURFACE, 'scroll-mt-24 p-4 sm:p-5')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--gold-soft))]">
          <Icon className="h-[18px] w-[18px] text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="min-w-0 flex-1 font-display text-base font-semibold leading-snug text-[hsl(224_14%_10%)]">{title}</h2>
        <DemoTag />
        {done ? (
          <span className="inline-flex items-center" data-testid={`${id}-done`}>
            <CheckCircle2 className="h-5 w-5 text-[hsl(152_55%_32%)]" aria-hidden="true" /><span className="sr-only">{doneLabel}</span>
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Locked({ text }: { text: string }) {
  return <p className="rounded-xl bg-[hsl(42_60%_97%)] px-3 py-3 text-sm text-[hsl(224_14%_26%)]">{text}</p>;
}

function scrollToSection(id: string) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function clock(iso: string, locale: string) {
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso; }
}

/* ── the simulated thread ───────────────────────────────────────────────── */

function DemoBubble({ message, locale }: { message: OwnerDemoMessage; locale: string }) {
  const { t } = useLanguage();
  const mine = message.sender === 'OWNER';
  const status = deliveryState(message);
  return (
    <li data-testid={mine ? 'demo-msg-owner' : 'demo-msg-reply'} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-[75%]',
        mine ? 'rounded-ee-sm bg-primary text-primary-foreground' : 'rounded-es-sm bg-[hsl(42_40%_97%)] text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(328_60%_85%)]',
      )}>
        {!mine ? (
          <p className="mb-1 inline-flex items-center gap-1 rounded-full bg-[hsl(328_70%_95%)] px-2 py-0.5 text-2xs font-bold text-[hsl(328_70%_30%)]">
            <FlaskConical className="h-3 w-3" aria-hidden="true" />{t('im_chat_simulated_reply')}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words leading-relaxed" dir="auto">{message.body}</p>
        <div className={cn('mt-1 flex items-center gap-1', mine ? 'justify-end' : 'justify-start')}>
          <time dateTime={message.created_at} className="text-[13px] opacity-70">{clock(message.created_at, locale)}</time>
          {mine ? (
            <span className="inline-flex items-center gap-1" data-status={status}>
              <MessageStatusIcon status={status} />
              <span className="sr-only">{t(STATUS_KEY[status])}</span>
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/* ── the guided walkthrough ─────────────────────────────────────────────── */

function DemoGuideBar({ payload, open, step, onOpen, onClose, onStep, onShow }: {
  payload: OwnerDemoPayload; open: boolean; step: number;
  onOpen: () => void; onClose: () => void; onStep: (n: number) => void; onShow: (s: DemoStep) => void;
}) {
  const { t } = useLanguage();
  const done = demoStepDone(payload);
  const progress = demoProgress(payload);
  const current = DEMO_STEPS[step];
  const next = nextDemoStep(payload);
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-4" data-testid="demo-guide-bar">
      <div className={cn(SURFACE, 'mx-auto max-w-3xl border-[hsl(328_60%_85%)] p-3 shadow-hover sm:p-4')} role="region" aria-label={t('demo_guide_title')}>
        {open ? (
          <div data-testid="demo-guide" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className={PINK_TAG}><FlaskConical className="h-3 w-3" aria-hidden="true" />{t('demo_mode_pill')}</span>
              <span className="text-xs font-semibold text-[hsl(224_14%_30%)]" dir="auto">{t('demo_guide_step', { n: step + 1, total: DEMO_STEPS.length })}</span>
              <button type="button" className={cn(BTN_TERTIARY, 'ms-auto')} onClick={onClose} data-testid="demo-guide-close">{t('demo_guide_close')}</button>
            </div>
            <h3 className="mt-1 font-display text-base font-semibold leading-snug" data-testid="demo-guide-title">{t(`demo_step_${current}_title`)}</h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_24%)]">{t(`demo_step_${current}_body`)}</p>
            <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={t('demo_guide_title')}>
              {DEMO_STEPS.map((s, i) => (
                <li key={s}>
                  <button type="button" onClick={() => onStep(i)} aria-current={i === step ? 'step' : undefined}
                    aria-label={`${i + 1}. ${t(`demo_step_${s}_title`)}`}
                    className={cn('flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-2xs font-bold tabular-nums ring-1 ring-inset',
                      i === step ? 'bg-[#0C1119] text-[hsl(38_92%_62%)] ring-[#0C1119]'
                        : done[s] ? 'bg-[hsl(152_45%_94%)] text-[hsl(152_55%_24%)] ring-[hsl(152_40%_78%)]'
                          : 'bg-white text-[hsl(224_14%_30%)] ring-[hsl(var(--border))]')}>
                    {i + 1}
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BTN_SECONDARY} disabled={step === 0} onClick={() => onStep(step - 1)}>{t('demo_guide_back')}</button>
              <button type="button" className={BTN_SECONDARY} onClick={() => onShow(current)} data-testid="demo-guide-show">{t('demo_guide_show')}</button>
              {step + 1 < DEMO_STEPS.length ? (
                <button type="button" className={cn(BTN_PRIMARY, 'ms-auto')} onClick={() => onStep(step + 1)} data-testid="demo-guide-next">{t('demo_guide_next')}</button>
              ) : (
                <button type="button" className={cn(BTN_PRIMARY, 'ms-auto')} onClick={onClose} data-testid="demo-guide-finish">{t('demo_guide_finish')}</button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={PINK_TAG} data-testid="demo-mode-indicator"><FlaskConical className="h-3 w-3" aria-hidden="true" />{t('demo_mode_pill')}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
              {next ? `${t('demo_progress', { done: progress.done, total: progress.total })} · ${t(`demo_step_${next}_title`)}` : t('demo_guide_complete')}
            </p>
            <button type="button" className={BTN_SECONDARY} onClick={onOpen} data-testid="demo-guide-open">
              <Sparkles className="h-4 w-4" aria-hidden="true" />{t('demo_guide')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the journey ────────────────────────────────────────────────────────── */

export function OwnerDemoJourney({ propertyId, propertyLabel, onExit }: {
  propertyId: string; propertyLabel: string | null; onExit: () => void;
}) {
  const { t, lang, locale, money, date } = useLeadFormatters();
  const [payload, setPayload] = useState<OwnerDemoPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [note, setNote] = useState('');
  const [chatText, setChatText] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const [email, setEmail] = useState<EmailContent | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [listing, setListing] = useState<PropertyEmailData | null>(null);
  const guideShown = useRef(false);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const p = await openOwnerDemo(propertyId);
      setPayload(p);
      if (!guideShown.current && !p.state.walkthrough_done_at) { guideShown.current = true; setGuideOpen(true); }
    } catch {
      setLoadError(true);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  /* The listing's own facts and photos, read-only (the same call Email Studio's preview makes). */
  useEffect(() => {
    let alive = true;
    emailStudio.render({ propertyId, templateId: DEMO_TEMPLATE, language: lang, content: null })
      .then((r) => { if (alive && r.ok) setListing(r.property); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [propertyId, lang]);

  const act = useCallback(async (action: OwnerDemoAction, extra: Record<string, unknown> = {}) => {
    if (!payload) return null;
    setBusy(action);
    try {
      const next = await ownerDemoAct(payload.conversation_id, action, extra);
      setPayload(next);
      return next;
    } catch {
      toast.error(t('demo_error'));
      return null;
    } finally {
      setBusy(null);
    }
  }, [payload, t]);

  const lead = useMemo(() => (payload ? toDemoLeadItem(payload) : null), [payload]);
  const unlocked = payload?.unlocked_at != null;
  const name = payload?.profile.display_name ?? 'Alex Morgan';
  const score = payload?.profile.details?.match_score ?? 92;

  /* A listing card for the offer and the email, from Email Studio's data or the stored facts. */
  const property: PropertyEmailData | null = useMemo(() => {
    if (listing) return listing;
    if (!payload) return null;
    const f = payload.facts;
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    return {
      title: payload.property.title, homatchId: payload.property.homatch_id, transactionType: 'SALE', propertyType: 'APARTMENT',
      city: f?.city ?? null, district: f?.district ?? null, address: null, price: num(f?.total_price), currency: f?.currency ?? 'USD',
      area: num(f?.area), rooms: f?.rooms ?? null, bedrooms: f?.bedrooms ?? null, bathrooms: null, floor: null, totalFloors: null, images: [],
    };
  }, [listing, payload]);

  const unlockAdapter: UnlockAdapter = useMemo(() => ({
    quote: async (): Promise<UnlockQuote> => {
      const price = payload?.profile.details?.unlock_credits ?? 2.5;
      return {
        requested: 1, eligible: unlocked ? 0 : 1, alreadyUnlocked: unlocked ? 1 : 0,
        standardCount: unlocked ? 0 : 1, premiumCount: 0, standardCredits: unlocked ? 0 : price, premiumCredits: 0,
        totalCredits: unlocked ? 0 : price, balance: null, prices: { STANDARD: price, PREMIUM: 6, active: true },
      };
    },
    unlock: async (ids: string[]): Promise<UnlockResult> => {
      const next = await act('UNLOCK');
      if (!next) throw new Error('DEMO_FAILED');
      return { unlocked: ids, alreadyUnlocked: [], skipped: [], chargedCredits: 0, balanceAfter: null, duplicate: false };
    },
  }), [act, payload, unlocked]);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    if (payload && !payload.state.walkthrough_done_at) void act('WALKTHROUGH_DONE');
  }, [act, payload]);

  async function sendChat(body: string) {
    const text = body.trim();
    if (!payload || !text) return;
    setBusy('CHAT');
    try {
      await sendOwnerDemoMessage(payload.conversation_id, text, lang);
      setChatText('');
      setPayload(await openOwnerDemo(propertyId));
      window.setTimeout(() => threadEnd.current?.scrollIntoView({ block: 'nearest' }), 50);
    } catch {
      toast.error(t('demo_error'));
    } finally {
      setBusy(null);
    }
  }

  const offerText = property
    ? t('demo_offer_message', {
      title: property.title ?? '', id: String(property.homatchId ?? ''),
      price: property.price != null ? money(property.price, property.currency) : '',
    })
    : '';

  const emailHtml = useMemo(() => {
    if (!email || !property) return null;
    try {
      return renderEmail({
        content: email, templateId: DEMO_TEMPLATE, lang, property, preview: true, unsubscribeUrl: null,
        listingUrl: `${window.location.origin}/property/${propertyId}`, senderName: 'HOMATCH',
      }).html;
    } catch {
      return null;
    }
  }, [email, property, lang, propertyId]);

  if (loadError) {
    return (
      <div className={cn(SURFACE, 'mt-4 p-6 text-center')} data-testid="demo-load-error">
        <p className="text-sm font-semibold">{t('demo_error_load')}</p>
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>{t('demo_retry')}</button>
          <button type="button" className={BTN_SECONDARY} onClick={onExit}>{t('demo_exit')}</button>
        </div>
      </div>
    );
  }
  if (!payload || !lead) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-[hsl(224_14%_30%)]" aria-busy="true" data-testid="demo-loading">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('demo_loading')}
      </div>
    );
  }

  const done = demoStepDone(payload);
  const state = payload.state;
  const activity = demoActivity(payload);
  const unread = unreadDemoNotifications(payload);
  const history = demoBuyerHistory(payload);
  const agreed = payload.profile.details?.agreed ?? [];
  const districts = payload.profile.districts ?? [];
  const budget = budgetLabel(lead.budget, (n, c) => money(n, c), t);
  const where = locationLabel(lead.locations) ?? districts.join(', ');

  return (
    <div className="mt-4 space-y-4" data-testid="owner-demo">
      {/* ── Demo Mode banner ── */}
      <div className="rounded-2xl border border-[hsl(328_60%_82%)] bg-[linear-gradient(135deg,hsl(328_70%_97%),hsl(42_80%_97%))] p-4 sm:p-5" role="status" data-testid="demo-banner">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className={PINK_TAG}><FlaskConical className="h-3 w-3" aria-hidden="true" />{t('demo_mode_pill')}</p>
            <h2 className="mt-1.5 font-display text-lg font-semibold">{t('demo_banner_title')}</h2>
            <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[hsl(224_14%_22%)]">{t('demo_banner_body')}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
            <button type="button" className={BTN_SECONDARY} onClick={() => setGuideOpen(true)} data-testid="demo-open-guide">
              <Sparkles className="h-4 w-4" aria-hidden="true" />{t('demo_guide')}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setResetOpen(true)} data-testid="demo-reset">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('demo_reset')}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onExit} data-testid="demo-exit">
              <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('demo_exit')}
            </button>
          </div>
        </div>
      </div>

      {/* ── 1. Campaign dashboard ── */}
      <SectionCard id="demo-campaign" icon={Building2} title={t('demo_campaign_title')} done={done.campaign}>
        <p className={EYEBROW}>{t('demo_campaign_eyebrow')}</p>
        {propertyLabel ? <p className="mt-1 truncate text-sm font-semibold" dir="auto">{propertyLabel}</p> : null}
        <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_26%)]">{t('demo_campaign_body')}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {([
            ['demo_campaign_matches', '1'],
            ['demo_campaign_best', t('demo_score_simulated', { score })],
            ['demo_campaign_source', t('demo_source_homatch_demo')],
            ['demo_campaign_spend', t('demo_campaign_spend_value')],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(42_40%_99%)] px-3 py-2.5">
              <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{t(k)}</dt>
              <dd className="mt-0.5 text-sm font-bold leading-snug [overflow-wrap:anywhere]" dir="auto">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(152_45%_94%)] px-2.5 py-1 text-xs font-semibold text-[hsl(152_55%_24%)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(152_55%_38%)]" aria-hidden="true" />{t('demo_campaign_status')}
          </span>
          <button type="button" className={BTN_TERTIARY} onClick={() => scrollToSection('demo-lead')} data-testid="demo-view-lead">{t('demo_campaign_view_lead')}</button>
        </div>
      </SectionCard>

      {/* ── 2–3. The lead card (real LeadCard) and why it matches ── */}
      <section id="demo-lead" className="scroll-mt-24 space-y-2" aria-label={t('demo_lead_tag')}>
        <div className="flex flex-wrap items-center gap-2">
          <DemoTag />
          <span className="text-xs font-semibold text-[hsl(224_14%_26%)]">{t('demo_lead_tag')}</span>
          <span className="text-xs text-[hsl(224_14%_30%)]">· {t('demo_score_simulated', { score })}</span>
        </div>
        <LeadCard lead={lead} selected={false} busy={busy === 'UNLOCK'}
          onToggleSelect={() => setUnlockOpen(true)}
          onUnlock={() => setUnlockOpen(true)}
          onOpenDetails={() => { void act('VIEW_DETAILS'); scrollToSection('demo-why'); }}
          onOpenContact={() => scrollToSection('demo-contact')}
          onOpenConversation={() => { if (!state.chat_opened_at) void act('OPEN_CHAT'); scrollToSection('demo-chat'); }}
          onToggleSave={() => void act('TOGGLE_SAVED')}
          onCreateEmail={() => scrollToSection('demo-email')} />
        <div id="demo-why" data-testid="demo-why" className={cn(SURFACE, 'scroll-mt-24 p-4 sm:p-5')}>
          <h3 className="font-display text-base font-semibold">{t('demo_why_title')}</h3>
          <p className="mt-1 text-sm text-[hsl(224_14%_26%)]">{t('demo_why_body', { score })}</p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {agreed.map((d) => (
              <li key={d} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(152_55%_32%)]" aria-hidden="true" />
                {d === 'PARKING' ? t('demo_criteria_parking') : t(`hl_dim_${d.toLowerCase()}`)}
              </li>
            ))}
            {(payload.profile.details?.conflicted ?? []).includes('PRICE') ? (
              <li className="flex items-start gap-2 text-sm sm:col-span-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(32_80%_40%)]" aria-hidden="true" />{t('demo_criteria_price_note')}
              </li>
            ) : null}
          </ul>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-[hsl(42_60%_97%)] p-3">
              <p className={EYEBROW}>{t('demo_request_title')}</p>
              <p className="mt-1 text-sm leading-relaxed" dir="auto" data-testid="demo-request">
                {t('demo_request_text', {
                  bedrooms: payload.profile.bedrooms_min ?? 2, locations: where, budget: budget ?? '',
                  months: payload.profile.timeline_months ?? 3,
                })}
              </p>
            </div>
            <div className="rounded-xl bg-[hsl(42_60%_97%)] p-3">
              <p className={EYEBROW}>{t('demo_history_title')}</p>
              <ol className="mt-1 space-y-1">
                {history.map((h) => (
                  <li key={h.kind} className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{t(`demo_history_${h.kind.toLowerCase()}`)}</span>
                    <time dateTime={h.at} className="shrink-0 text-xs text-[hsl(224_14%_30%)]">{date(h.at)}</time>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 4. Revealed contact ── */}
        <SectionCard id="demo-contact" icon={UserRound} title={t('demo_contact_title')} done={done.contact}>
          {!unlocked ? <Locked text={t('demo_contact_locked')} /> : (
            <div data-testid="demo-contact-revealed">
              <dl className="grid gap-2 text-sm">
                {([
                  [UserRound, 'demo_contact_name', name],
                  [Phone, 'demo_contact_phone', payload.contact?.phone ?? ''],
                  [Mail, 'demo_contact_email', payload.contact?.email ?? ''],
                  [MessageSquare, 'demo_contact_channel', t('demo_contact_channel_message')],
                ] as Array<[React.ComponentType<{ className?: string }>, string, string]>).map(([Icon, k, v]) => (
                  <div key={k} className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                    <dt className="w-32 shrink-0 text-[hsl(224_14%_30%)]">{t(k)}</dt>
                    <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]" dir={k === 'demo_contact_phone' || k === 'demo_contact_email' ? 'ltr' : 'auto'}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 rounded-lg bg-[hsl(328_70%_97%)] px-3 py-2 text-xs font-medium text-[hsl(328_60%_28%)]">{t('demo_contact_fictional')}</p>
            </div>
          )}
        </SectionCard>

        {/* ── 5–6. CRM ── */}
        <SectionCard id="demo-crm" icon={ClipboardList} title={t('demo_crm_title')} done={done.crm_save && done.crm_manage}>
          {!unlocked ? <Locked text={t('demo_crm_locked')} /> : !state.crm_saved_at ? (
            <button type="button" className={cn(BTN_PRIMARY, 'w-full')} onClick={() => void act('SAVE_CRM')} disabled={busy === 'SAVE_CRM'} data-testid="demo-crm-save">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />{t('demo_crm_save')}
            </button>
          ) : (
            <div className="space-y-3" data-testid="demo-crm-entry">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[hsl(152_55%_26%)]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('demo_crm_saved')}</p>
              <label className="block text-sm font-medium">
                <span className="text-[hsl(224_14%_30%)]">{t('demo_crm_stage')}</span>
                <select value={state.crm_stage ?? 'UNLOCKED'} disabled={busy === 'SET_STAGE'} data-testid="demo-crm-stage"
                  onChange={(e) => void act('SET_STAGE', { stage: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
                  {CRM_STATUSES.map((s) => <option key={s} value={s}>{t(statusLabelKey(s))}</option>)}
                </select>
              </label>
              <div>
                <p className="text-sm font-medium text-[hsl(224_14%_30%)]">{t('demo_crm_notes')}</p>
                {(state.notes ?? []).length ? (
                  <ul className="mt-1 space-y-1.5" data-testid="demo-crm-notes">
                    {(state.notes ?? []).map((n) => (
                      <li key={n.id} className="rounded-lg bg-[hsl(42_60%_97%)] px-3 py-2 text-sm">
                        <StickyNote className="me-1 inline h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                        <span dir="auto">{n.body}</span>
                        <time dateTime={n.at} className="ms-2 text-2xs text-[hsl(224_14%_34%)]">{clock(n.at, locale)}</time>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-sm text-[hsl(224_14%_34%)]">{t('demo_crm_no_notes')}</p>}
                <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  void act('ADD_NOTE', { body: note.trim() }).then((r) => { if (r) setNote(''); });
                }}>
                  <label htmlFor="demo-note" className="sr-only">{t('demo_crm_note_placeholder')}</label>
                  <input id="demo-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} dir="auto"
                    placeholder={t('demo_crm_note_placeholder')} data-testid="demo-note-input"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]" />
                  <button type="submit" className={BTN_SECONDARY} disabled={!note.trim() || busy === 'ADD_NOTE'} data-testid="demo-note-add">{t('crm_add_note')}</button>
                </form>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 7–8. Conversation ── */}
      <SectionCard id="demo-chat" icon={MessageSquare} title={t('demo_chat_title')} done={done.chat_open && done.chat_exchange}>
        {!unlocked ? <Locked text={t('demo_chat_locked')} /> : !state.chat_opened_at ? (
          <button type="button" className={cn(BTN_PRIMARY, 'w-full sm:w-auto')} onClick={() => void act('OPEN_CHAT')} disabled={busy === 'OPEN_CHAT'} data-testid="demo-chat-open">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />{t('crm_open_conversation')}
          </button>
        ) : (
          <div data-testid="demo-chat-thread">
            <p className="text-sm font-semibold" dir="auto">{t('demo_chat_with', { name })}</p>
            <p className="mt-1 rounded-lg bg-[hsl(328_70%_97%)] px-3 py-2 text-xs font-medium text-[hsl(328_60%_28%)]">{t('demo_chat_simulated_banner')}</p>
            <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(42_30%_99%)] p-3">
              {payload.messages.length ? (
                <ol className="space-y-3" aria-label={t('demo_chat_title')}>
                  {payload.messages.map((m) => <DemoBubble key={m.id} message={m} locale={locale} />)}
                </ol>
              ) : <p className="py-6 text-center text-sm text-[hsl(224_14%_32%)]">{t('demo_chat_empty')}</p>}
              <div ref={threadEnd} />
            </div>
            <p className="mt-3 text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{t('demo_chat_suggestions')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {['demo_chat_sample_1', 'demo_chat_sample_2', 'demo_chat_sample_3'].map((k) => (
                <button key={k} type="button" className="min-h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-start text-xs font-medium hover:border-[hsl(var(--gold-border))]"
                  onClick={() => setChatText(t(k))} data-testid="demo-chat-sample">{t(k)}</button>
              ))}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendChat(chatText); }}>
              <label htmlFor="demo-chat-input" className="sr-only">{t('demo_chat_placeholder')}</label>
              <textarea id="demo-chat-input" rows={2} value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={2000} dir="auto"
                placeholder={t('demo_chat_placeholder')} data-testid="demo-chat-input"
                className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]" />
              <button type="submit" className={cn(BTN_PRIMARY, 'self-end px-4')} disabled={!chatText.trim() || busy === 'CHAT'} data-testid="demo-chat-send"
                aria-label={t('demo_chat_send')}>
                {busy === 'CHAT' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
                <span className="hidden sm:inline">{t('demo_chat_send')}</span>
              </button>
            </form>
          </div>
        )}
      </SectionCard>

      {/* ── 9. Property offer ── */}
      <SectionCard id="demo-offer" icon={Home} title={t('demo_offer_title')} done={done.offer}>
        {!unlocked ? <Locked text={t('demo_offer_locked')} /> : (
          <div className="space-y-3">
            <p className="text-sm text-[hsl(224_14%_26%)]">{t('demo_offer_body')}</p>
            {!offerOpen && !state.offer_attached_at ? (
              <button type="button" className={BTN_SECONDARY} onClick={() => setOfferOpen(true)} data-testid="demo-offer-attach">
                <Home className="h-4 w-4" aria-hidden="true" />{t('demo_offer_attach')}
              </button>
            ) : (
              <div data-testid="demo-offer-preview">
                <p className={EYEBROW}>{t('demo_offer_preview')}</p>
                <article className="mt-2 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white sm:flex">
                  {property?.images?.[0] ? (
                    <img src={property.images[0]} alt="" loading="lazy" className="h-44 w-full object-cover sm:h-auto sm:w-56" />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center bg-[hsl(42_40%_96%)] sm:h-auto sm:w-56"><Home className="h-8 w-8 text-[hsl(var(--gold-ink))]" aria-hidden="true" /></div>
                  )}
                  <div className="min-w-0 flex-1 p-4">
                    <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]" dir="ltr">HOMATCH {property?.homatchId ?? ''}</p>
                    <h3 className="mt-0.5 font-display text-base font-semibold leading-snug" dir="auto">{property?.title}</h3>
                    <p className="mt-1 text-lg font-bold text-[hsl(var(--gold-ink))]">{property?.price != null ? money(property.price, property.currency) : ''}</p>
                    <p className="mt-1 text-sm text-[hsl(224_14%_26%)]" dir="auto">
                      {[
                        property?.area != null ? t('demo_fact_area', { n: Math.round(Number(property.area)) }) : null,
                        property?.rooms != null ? t('demo_fact_rooms', { n: property.rooms }) : null,
                        property?.bedrooms != null ? t('demo_fact_bedrooms', { n: property.bedrooms }) : null,
                        [property?.district, property?.city].filter(Boolean).join(', ') || null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </article>
                <p className="mt-2 rounded-xl bg-[hsl(42_60%_97%)] px-3 py-2 text-sm" dir="auto">{offerText}</p>
                {state.offer_attached_at ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-[hsl(152_55%_26%)]" data-testid="demo-offer-sent">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('demo_offer_sent')}
                  </p>
                ) : (
                  <button type="button" className={cn(BTN_PRIMARY, 'mt-2')} disabled={busy === 'ATTACH_OFFER' || !offerText}
                    onClick={() => void act('ATTACH_OFFER', { body: offerText, lang }).then((r) => { if (r) toast.success(t('demo_offer_sent')); })}
                    data-testid="demo-offer-send">
                    <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('demo_offer_send')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── 10. Email Studio draft + preview ── */}
      <SectionCard id="demo-email" icon={Mail} title={t('demo_email_title')} done={done.email}>
        {!unlocked ? <Locked text={t('demo_email_locked')} /> : (
          <div className="space-y-3">
            <p className="text-sm text-[hsl(224_14%_26%)]">{t('demo_email_body')}</p>
            {!email ? (
              <button type="button" className={BTN_SECONDARY} data-testid="demo-email-generate"
                onClick={() => {
                  const c = defaultContent(DEMO_TEMPLATE, lang);
                  setEmail(state.email_draft?.subject ? { ...c, subject: state.email_draft.subject } : c);
                }}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />{t('demo_email_generate')}
              </button>
            ) : (
              <div className="space-y-3" data-testid="demo-email-draft">
                <p className="text-sm"><span className="text-[hsl(224_14%_30%)]">{t('demo_email_to')}: </span>
                  <span className="font-semibold">{name} · <span dir="ltr">{payload.contact?.email}</span></span> <DemoTag />
                </p>
                <label className="block text-sm font-medium">
                  <span className="text-[hsl(224_14%_30%)]">{t('demo_email_subject')}</span>
                  <input value={email.subject} maxLength={150} dir="auto" data-testid="demo-email-subject"
                    onChange={(e) => setEmail({ ...email, subject: e.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]" />
                </label>
                <div data-testid="demo-email-preview">
                  <EmailPreview html={emailHtml} mode={previewMode} onModeChange={setPreviewMode} loading={!emailHtml} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={BTN_PRIMARY} disabled={!email.subject.trim() || busy === 'SAVE_EMAIL_DRAFT'} data-testid="demo-email-save"
                    onClick={() => void act('SAVE_EMAIL_DRAFT', { subject: email.subject.trim(), template_id: DEMO_TEMPLATE, lang })
                      .then((r) => { if (r) toast.success(t('demo_email_saved')); })}>
                    {t('demo_email_save')}
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled aria-describedby="demo-email-send-note" data-testid="demo-email-send">
                    <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('demo_email_send')}
                  </button>
                  {state.email_draft ? (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[hsl(152_55%_26%)]" data-testid="demo-email-saved">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('demo_email_saved')}
                    </span>
                  ) : null}
                </div>
                <p id="demo-email-send-note" className="text-xs text-[hsl(224_14%_30%)]">{t('demo_email_send_disabled')}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── 11. Notifications and activity ── */}
      <SectionCard id="demo-activity" icon={unread ? BellRing : Bell} title={t('demo_activity_title')} done={done.activity}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t('demo_notifications')}</span>
          {unread ? (
            <span className="rounded-full bg-[hsl(0_70%_96%)] px-2 py-0.5 text-xs font-bold text-[hsl(0_60%_36%)]" data-testid="demo-unread">{t('demo_notifications_unread', { n: unread })}</span>
          ) : null}
          <button type="button" className={cn(BTN_TERTIARY, 'ms-auto')} disabled={!unread || busy === 'NOTIFICATIONS_READ'}
            onClick={() => void act('NOTIFICATIONS_READ')} data-testid="demo-mark-read">{t('demo_notifications_mark_read')}</button>
        </div>
        <p className="mt-1 text-xs text-[hsl(224_14%_30%)]">{t('demo_notifications_simulated')}</p>
        {activity.length ? (
          <ol className="mt-3 space-y-2" data-testid="demo-activity-list">
            {activity.map((row) => {
              const fresh = row.notification && (!state.notifications_read_at || Date.parse(row.at) > Date.parse(state.notifications_read_at));
              const stage = typeof row.detail.to === 'string' ? t(statusLabelKey(row.detail.to)) : '';
              return (
                <li key={row.key} className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--border))] px-3 py-2">
                  {row.notification
                    ? <Bell className={cn('mt-0.5 h-4 w-4 shrink-0', fresh ? 'text-[hsl(0_60%_42%)]' : 'text-[hsl(var(--gold-ink))]')} aria-hidden="true" />
                    : <Circle className="mt-1 h-3 w-3 shrink-0 text-[hsl(224_14%_50%)]" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" dir="auto">{t(demoEventKey(row.kind), { stage })}</p>
                    <p className="text-2xs text-[hsl(224_14%_34%)]">
                      <time dateTime={row.at}>{clock(row.at, locale)}</time> · {t('demo_simulated')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-3 text-sm">{t('demo_activity_empty')}</p>}
      </SectionCard>

      <UnlockDialog open={unlockOpen} matchIds={[lead.matchId]} adapter={unlockAdapter} demo
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => {
          setUnlockOpen(false);
          toast.success(t('demo_unlocked_toast'));
          window.setTimeout(() => scrollToSection('demo-contact'), 80);
        }} />

      <Dialog open={resetOpen} onOpenChange={(o) => { if (!o && busy !== 'RESET') setResetOpen(false); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] bg-white sm:max-w-md" data-testid="demo-reset-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">{t('demo_reset_title')}</DialogTitle>
            <DialogDescription className="text-sm text-[hsl(224_14%_30%)]">{t('demo_reset_body')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={BTN_SECONDARY} onClick={() => setResetOpen(false)}>{t('demo_cancel')}</button>
            <button type="button" className={BTN_PRIMARY} disabled={busy === 'RESET'} data-testid="demo-reset-confirm"
              onClick={async () => {
                setBusy('RESET');
                try {
                  setPayload(await resetOwnerDemo(payload.conversation_id));
                  setEmail(null); setOfferOpen(false); setNote(''); setChatText(''); setGuideStep(0);
                  setResetOpen(false);
                  toast.success(t('demo_reset_done'));
                  scrollToSection('demo-campaign');
                } catch {
                  toast.error(t('demo_error'));
                } finally {
                  setBusy(null);
                }
              }}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('demo_reset_confirm')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <DemoGuideBar payload={payload} open={guideOpen} step={guideStep}
        onOpen={() => { const n = nextDemoStep(payload); setGuideStep(n ? DEMO_STEPS.indexOf(n) : 0); setGuideOpen(true); }}
        onClose={closeGuide}
        onStep={(n) => setGuideStep(Math.max(0, Math.min(DEMO_STEPS.length - 1, n)))}
        onShow={(s) => scrollToSection(DEMO_STEP_SECTION[s])} />
    </div>
  );
}
