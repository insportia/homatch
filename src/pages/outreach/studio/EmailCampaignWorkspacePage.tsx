// EMAIL STUDIO — the campaign workspace. Owner brief §4 and the UX pass §1: a full-page workflow,
// never a modal. Routes: /outreach/email/campaigns/new and /outreach/email/campaigns/:id
// (?step=design|sender|recipients|review).
//
// THE ORDER IS THE ORDER PEOPLE THINK IN: 1 Design the email (blank, a template, or HOMI) ·
// 2 Choose the sender · 3 Choose the recipients · 4 Review & send. Every step can be revisited;
// nothing is lost going back, because every step edits the same working copy.
//
// STATE AND SAVING. The page edits a local working copy. Every change is (a) mirrored to
// localStorage at once — a refresh or a crash restores it — and (b) saved to the server after a
// short pause through campaign_save, which renders the design server-side. The first save carries
// a draft key, so a retried or doubled first save returns the same draft (never two). Leaving the
// page with unsaved changes saves them on the way out; closing the tab asks first. Saving never
// sends.
//
// APPROVAL. A campaign that was submitted or approved returns to draft when its content changes
// (the database guard does it, and logs it); the page says so before the first such edit.
// Sending, scheduling and the approval itself are enforced by the server, never by this page.

import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, Check, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, Info,
  LayoutTemplate, ListChecks, Loader2, Lock, Mail, RefreshCw, Search, Send, ShieldCheck, Sparkles, Upload, UserPlus, Users, X,
} from 'lucide-react';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { AllowancePanel } from '@/components/emailStudio/AllowancePanel';
import { HomiPanel } from '@/components/emailStudio/HomiPanel';
import { LeadDialog, LeadStatusChip } from '@/components/emailStudio/LeadDialog';
import { domainAuth, EmailPreviewFrame, findingText, PhaseBadge, RiskReport, reasonText, VerdictLine } from '@/components/emailStudio/shared';
import { type PickedStart, TemplatePicker } from '@/components/emailStudio/TemplatePicker';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { buttonsMissingLink, imagesMissingAlt } from '@/emailMarketing/designer/checks';
import { type Block, type EmailDoc, emptyDoc, normalizeDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { builtInTemplate, type TemplateKind, templateSubject, unfilledPlaceholders } from '@/emailMarketing/designer/templates';
import { editDropsApproval, emailPhase, isEditable } from '@/emailMarketing/reviewState';
import type { RiskResult } from '@/emailMarketing/risk/engine';
import { cn } from '@/lib/utils';
import {
  type AudienceEstimate, type AudienceFilter, type CampaignPatch, campaignReviews, checkCampaign, type EmailAllowance, estimateAudience, getAllowance, getCampaign, type ListOption,
  listTemplates, myLists, mySenders, type ReviewEntry, type SenderOption, type StudioCampaign, StudioError, saveCampaign, saveTemplate, scheduleCampaign, sendable, sendNow, sendTest,
  setCampaignStatus, submitCampaign, type UserTemplate, unscheduleCampaign,
} from '@/services/emailCampaignStudio';
import { type Lead, type LeadStatus, listLeads } from '@/services/emailLeads';
import { listDomains, type SendingDomain } from '@/services/emailMarketing';
import { supabase } from '@/db/supabase';
import { PRESELECT_KEY } from '@/services/emailLeads';

const EmailDesigner = lazy(() => import('@/components/emailStudio/EmailDesigner'));

const STEPS = ['design', 'sender', 'recipients', 'review'] as const;
type Step = (typeof STEPS)[number];
/* Links written before the reorder used 1…6 (identity, recipients, sender, subject, design, review). */
const LEGACY_STEP: Record<string, Step> = { 1: 'design', 2: 'recipients', 3: 'sender', 4: 'design', 5: 'design', 6: 'review' };
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
/* outreach_contacts.source_kind values (CURATED_LEAD / INTERNAL_MATCH come from the Matching Marketplace). */
const SOURCES = ['IMPORT', 'MANUAL', 'FIND_BUYERS', 'CURATED_LEAD', 'INTERNAL_MATCH'];
/* outreach_contacts.lead_type CHECK values. */
const LEAD_TYPES = ['BUYER', 'TENANT', 'INVESTOR', 'AGENT', 'OTHER'];
const UUID = /^[0-9a-f-]{36}$/i;

interface Working {
  name: string; objective: string; description: string; language: string; audienceNote: string;
  subject: string; preview_text: string; sender_name: string; sender_email: string; reply_to: string;
  contact_list_ids: string[]; audience_filter: AudienceFilter; design: EmailDoc;
}

const blank = (lang: string): Working => ({
  name: '', objective: '', description: '', language: LANGS.includes(lang) ? lang : 'ka', audienceNote: '',
  subject: '', preview_text: '', sender_name: '', sender_email: '', reply_to: '',
  contact_list_ids: [], audience_filter: {}, design: emptyDoc(),
});

function fromCampaign(c: StudioCampaign, lang: string): Working {
  return {
    name: c.name ?? '', objective: c.objective ?? '', description: c.description ?? '', language: c.language ?? lang, audienceNote: c.audience_note ?? '',
    subject: c.subject ?? '', preview_text: c.preview_text ?? '', sender_name: c.sender_name ?? '', sender_email: c.sender_email ?? '', reply_to: c.reply_to ?? '',
    contact_list_ids: c.contact_list_ids?.length ? c.contact_list_ids : c.contact_list_id ? [c.contact_list_id] : [],
    audience_filter: c.audience_filter ?? {}, design: c.design ? normalizeDoc(c.design) : emptyDoc(),
  };
}

function toPatch(w: Working, fallbackName: string): CampaignPatch {
  const filter = Object.fromEntries(Object.entries(w.audience_filter).filter(([, v]) => Array.isArray(v) && v.length)) as AudienceFilter;
  return {
    name: w.name.trim() || fallbackName, objective: w.objective || null, language: w.language,
    description: w.description || null, audience_note: w.audienceNote || null,
    subject: w.subject || null, preview_text: w.preview_text || null, sender_name: w.sender_name || null,
    sender_email: w.sender_email || null, reply_to: w.reply_to || null, contact_list_ids: w.contact_list_ids,
    audience_filter: Object.keys(filter).length ? filter : null, design: w.design,
  };
}

const storageKey = (id: string | null) => `ems-draft:${id ?? 'new'}`;
interface LocalDraft { at: number; w: Working; draftKey?: string }
const readLocal = (id: string | null): LocalDraft | null => {
  try { const raw = localStorage.getItem(storageKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const writeLocal = (id: string | null, w: Working, draftKey?: string) => { try { localStorage.setItem(storageKey(id), JSON.stringify({ at: Date.now(), w, draftKey })); } catch { /* storage full or blocked */ } };
const clearLocal = (id: string | null) => { try { localStorage.removeItem(storageKey(id)); } catch { /* ignore */ } };

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export default function EmailCampaignWorkspacePage() {
  const { t, lang } = useLanguage();
  const { supaUser } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [search, setSearch] = useSearchParams();
  const [campaignId, setCampaignId] = useState<string | null>(params.id && params.id !== 'new' ? params.id : null);
  const [campaign, setCampaign] = useState<StudioCampaign | null>(null);
  /* A new campaign may arrive with a list chosen elsewhere (Matching Marketplace → "create an
     email campaign": /outreach/email?new=1&list=<id> → here with ?list=<id>). */
  const [w, setW] = useState<Working>(() => {
    const b = blank(lang);
    const isNew = !params.id || params.id === 'new';
    /* Leads → "Email these leads": the selection travels in sessionStorage, never in the URL. */
    if (isNew && search.get('leads') === 'session') {
      try {
        const ids = (JSON.parse(sessionStorage.getItem(PRESELECT_KEY) ?? '[]') as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 1000);
        sessionStorage.removeItem(PRESELECT_KEY);
        if (ids.length) return { ...b, audience_filter: { contactIds: ids } };
      } catch { /* start without a preselection */ }
    }
    const preset = isNew ? search.get('list') : null;
    return preset && UUID.test(preset) ? { ...b, contact_list_ids: [preset] } : b;
  });
  const [loading, setLoading] = useState(Boolean(campaignId));
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restore, setRestore] = useState<LocalDraft | null>(null);
  const [homiOpen, setHomiOpen] = useState(false);
  const [approvalWarned, setApprovalWarned] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState<null | (() => void)>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<TemplateKind | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);
  /* The id the NEXT save must use — a ref, so two saves in flight before a re-render never create twice. */
  const idRef = useRef<string | null>(campaignId);
  const creating = useRef<Promise<StudioCampaign | null> | null>(null);
  const draftKey = useRef<string>(readLocal(null)?.draftKey ?? crypto.randomUUID());
  const latest = useRef<Working>(w);
  latest.current = w;

  const rawStep = search.get('step') ?? 'design';
  const step: Step = (STEPS as readonly string[]).includes(rawStep) ? rawStep as Step : LEGACY_STEP[rawStep] ?? 'design';
  const stepIndex = STEPS.indexOf(step);
  const goStep = (s: Step) => { const n = new URLSearchParams(search); n.set('step', s); setSearch(n, { replace: false }); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const phase = emailPhase(campaign?.status ?? 'DRAFT');
  const readOnly = Boolean(campaign) && !isEditable(campaign?.status);
  const fallbackName = useMemo(() => t('ems_untitled_dated', { date: new Date().toLocaleDateString(lang) }), [t, lang]);

  /* ── load ──────────────────────────────────────────────────────────────────────────────── */
  /* The id a draft got from its first save in THIS visit: it is not reloaded (that would replace
     what is being typed with the server copy and drop the editor's focus). */
  const createdHere = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (campaignId && createdHere.current === campaignId) return;
    if (!campaignId) {
      const local = readLocal(null);
      if (local) setRestore(local);
      setLoading(false);
      return;
    }
    setLoading(true); setLoadError(false);
    try {
      const c = await getCampaign(campaignId);
      if (!c) { setLoadError(true); return; }
      setCampaign(c);
      const server = fromCampaign(c, lang);
      setW(server);
      setSavedAt(Date.parse(c.updated_at));
      const local = readLocal(campaignId);
      if (local && local.at > Date.parse(c.updated_at) + 1000 && JSON.stringify(local.w) !== JSON.stringify(server)) setRestore(local);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [campaignId, lang]);
  useEffect(() => { void load(); }, [load]);

  /* ── save ──────────────────────────────────────────────────────────────────────────────── */
  const flush = useCallback(async (working: Working): Promise<StudioCampaign | null> => {
    if (readOnly) return null;
    if (!idRef.current && creating.current) await creating.current;
    setSaving('saving');
    const wasNew = !idRef.current;
    const run = (async () => {
      const saved = await saveCampaign(idRef.current, toPatch(working, fallbackName), draftKey.current);
      idRef.current = saved.id;
      return saved;
    })();
    if (wasNew) creating.current = run.catch(() => null);
    try {
      const saved = await run;
      setCampaign(saved);
      if (wasNew) {
        createdHere.current = saved.id;
        setCampaignId(saved.id);
        clearLocal(null);
        navigate(`/outreach/email/campaigns/${saved.id}?${search.toString()}`, { replace: true });
      }
      clearLocal(saved.id);
      /* Saved what was current when the save began; a later edit is still pending. */
      if (latest.current === working) dirtyRef.current = false;
      setSaving(dirtyRef.current ? 'pending' : 'saved');
      setSavedAt(Date.now());
      return saved;
    } catch (e) {
      setSaving('error');
      const code = e instanceof StudioError ? e.code : 'SAVE_FAILED';
      toast.error(t(`ems_err_${code.toLowerCase()}`) === `ems_err_${code.toLowerCase()}` ? t('ems_err_save_failed') : t(`ems_err_${code.toLowerCase()}`));
      return null;
    }
  }, [navigate, readOnly, search, t, fallbackName]);

  const update = useCallback((patch: Partial<Working>) => {
    if (readOnly) return;
    const apply = () => {
      setW((prev) => {
        const next = { ...prev, ...patch };
        writeLocal(idRef.current, next, idRef.current ? undefined : draftKey.current);
        dirtyRef.current = true;
        setSaving('pending');
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => { inflight.current = flush(next); }, 1200);
        return next;
      });
    };
    if (campaign && editDropsApproval(campaign.status) && !approvalWarned) { setConfirmEdit(() => apply); return; }
    apply();
  }, [approvalWarned, campaign, flush, readOnly]);

  /* Leaving with unsaved changes: the browser asks on tab close; an in-app navigation saves on the way out. */
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (dirtyRef.current) void saveCampaign(idRef.current, toPatch(latest.current, fallbackName), draftKey.current).then((s) => clearLocal(s.id)).catch(() => undefined);
    };
  }, []);

  const saveNow = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (inflight.current) await inflight.current.catch(() => null);
    return flush(latest.current);
  };

  /* Preselected leads arrive without their lists: resolve them once, so the estimate can count. */
  useEffect(() => {
    const ids = w.audience_filter.contactIds ?? [];
    if (!ids.length || w.contact_list_ids.length) return;
    void supabase.from('outreach_contacts').select('list_id').in('id', ids).then(({ data }) => {
      const lists = [...new Set(((data ?? []) as Array<{ list_id: string | null }>).map((r) => r.list_id).filter((x): x is string => Boolean(x)))].slice(0, 50);
      if (lists.length) update({ contact_list_ids: lists });
    });
    // Runs when a selection exists without lists (preselection), not on every edit.
  }, [w.audience_filter.contactIds, w.contact_list_ids.length, update]);

  /* ── side data ─────────────────────────────────────────────────────────────────────────── */
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [senders, setSenders] = useState<SenderOption[] | null>(null);
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [allowance, setAllowance] = useState<EmailAllowance | null>(null);
  const [allowanceLoading, setAllowanceLoading] = useState(false);
  const reloadLists = useCallback(() => myLists().then(setLists).catch(() => setLists([])), []);
  useEffect(() => {
    void reloadLists();
    void mySenders().then(setSenders).catch(() => setSenders([]));
    void listDomains().then(setDomains).catch(() => setDomains([]));
    void listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [reloadLists]);
  const loadAllowance = useCallback(() => {
    setAllowanceLoading(true);
    void getAllowance().then(setAllowance).catch(() => setAllowance(null)).finally(() => setAllowanceLoading(false));
  }, []);
  useEffect(() => { if (step === 'review') loadAllowance(); }, [step, loadAllowance]);

  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateTick, setEstimateTick] = useState(0);
  useEffect(() => {
    if (!w.contact_list_ids.length) { setEstimate(null); return; }
    setEstimating(true);
    const h = window.setTimeout(() => {
      estimateAudience(w.contact_list_ids, w.audience_filter).then(setEstimate).catch(() => setEstimate(null)).finally(() => setEstimating(false));
    }, 350);
    return () => window.clearTimeout(h);
  }, [w.contact_list_ids, w.audience_filter, estimateTick]);

  /* ── review step state ─────────────────────────────────────────────────────────────────── */
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ risk: RiskResult; problems: string[]; audience: AudienceEstimate | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<ReviewEntry[]>([]);
  const [scheduleAt, setScheduleAt] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [sendAck, setSendAck] = useState(false);
  useEffect(() => { if (campaignId && step === 'review') void campaignReviews(campaignId).then(setHistory).catch(() => setHistory([])); }, [campaignId, step, campaign?.status]);

  /* ── HOMI actions ──────────────────────────────────────────────────────────────────────── */
  const applyEdits = (edits: Array<{ id: string; field: 'text' | 'label'; value: string }>) => {
    const map = new Map(edits.map((e) => [e.id, e]));
    const edit = (b: Block): Block => {
      const e = map.get(b.id);
      if (b.type === 'columns') return { ...b, columns: b.columns.map((c) => c.map((x) => edit(x) as typeof x)) as typeof b.columns };
      if (!e) return b;
      /* HOMI writes plain text: the rich version is replaced by it, never merged into it. */
      return e.field === 'label' ? { ...b, label: e.value } as Block : { ...b, text: e.value, rich: null } as Block;
    };
    update({ design: normalizeDoc({ ...w.design, blocks: w.design.blocks.map(edit) }) });
  };
  const applyBlocks = (blocks: Block[], mode: 'replace' | 'append') => {
    update({ design: normalizeDoc({ ...w.design, blocks: mode === 'replace' ? blocks : [...w.design.blocks, ...blocks] }) });
    if (step !== 'design') goStep('design');
  };
  const startFromTemplate = (kind: TemplateKind) => {
    update({ design: builtInTemplate(kind, w.language), ...(!w.subject ? { subject: templateSubject(kind, w.language) } : {}) });
    if (step !== 'design') goStep('design');
  };

  /* ── step validity (for the stepper ticks and the review checklist) ───────────────────── */
  const senderOk = !w.sender_email || Boolean(senders?.find((s) => s.address === w.sender_email && s.verified));
  const designText = useMemo(() => renderDesignBody(w.design).text, [w.design]);
  const placeholders = useMemo(() => unfilledPlaceholders([w.subject, w.preview_text, designText].join('\n')), [w.subject, w.preview_text, designText]);
  const noLink = useMemo(() => buttonsMissingLink(w.design), [w.design]);
  const noAlt = useMemo(() => imagesMissingAlt(w.design), [w.design]);
  const done: Record<Step, boolean> = {
    design: Boolean(w.subject.trim()) && w.design.blocks.length > 0 && placeholders.length === 0 && noLink.length === 0,
    sender: senderOk,
    recipients: w.contact_list_ids.length > 0 && (estimate?.eligible ?? 0) > 0,
    review: ['APPROVED', 'SCHEDULED', 'SENDING', 'SENT'].includes(phase),
  };

  const sendCheck = allowance && estimate ? sendable(allowance, estimate.eligible) : null;
  const helpFacts = useMemo(() => {
    const lines: string[] = [];
    if (step === 'design') lines.push(`Blocks: ${w.design.blocks.length}`, `Unfilled placeholders: ${placeholders.length}${placeholders.length ? ` (${placeholders.slice(0, 5).join(', ')})` : ''}`,
      `Buttons without a link: ${noLink.length}`, `Images without alt text: ${noAlt.length}`, `Subject set: ${Boolean(w.subject.trim())}`);
    if (step === 'sender') lines.push(`Senders: ${(senders ?? []).map((s) => `${s.custom ? s.address ?? s.domain : 'HOMATCH shared sender'} (${s.verified ? 'verified' : 'not verified'})`).join('; ')}`,
      `Chosen: ${w.sender_email || 'HOMATCH shared sender'}`);
    if (step === 'recipients' || step === 'review') {
      lines.push(estimate ? `Audience: ${estimate.matched} matched, ${estimate.eligible} eligible (consented), ${estimate.consentUnknown} without recorded consent, ${estimate.suppressed} unsubscribed/suppressed, ${estimate.duplicates} duplicate addresses` : 'Audience: none selected');
    }
    if (step === 'review' && allowance) {
      lines.push(`Plan ${allowance.plan.code}: ${allowance.plan.remaining} of ${allowance.plan.included} emails left (${allowance.plan.periodKind})`,
        allowance.tenantDaily ? `Daily account ceiling: ${allowance.tenantDaily.remaining} of ${allowance.tenantDaily.cap} left today` : 'No daily account ceiling',
        allowance.providerDaily ? `Platform capacity left today: ${allowance.providerDaily.remaining}` : '',
        `Overage: ${allowance.overage.enabled ? `on, $${allowance.overage.pricePer1kUsd} per 1,000` : 'off'}`,
        sendCheck ? `Can send now: ${sendCheck.now}${sendCheck.limitedBy ? ` (limited by ${sendCheck.limitedBy})` : ''}` : '',
        `Status: ${phase}`, lastCheck ? `Problems: ${lastCheck.problems.join(', ') || 'none'}` : '');
    }
    return lines.filter(Boolean).join('\n');
  }, [step, w, placeholders, noLink, noAlt, senders, estimate, allowance, sendCheck, phase, lastCheck]);

  const homi = (
    <HomiPanel
      ctx={{ name: w.name, objective: w.objective, subject: w.subject, previewText: w.preview_text, language: w.language, audience: w.audienceNote, design: w.design, findings: lastCheck?.risk.findings, step, helpFacts }}
      actions={{
        applySubject: (s) => update({ subject: s.slice(0, 200) }), applyPreview: (p) => update({ preview_text: p.slice(0, 200) }),
        applyEdits, applyBlocks, applyIdea: (i) => update({ name: i.name, objective: i.objective }), applyLanguage: (l) => update({ language: l }),
        applyTemplate: (k) => (w.design.blocks.length ? setConfirmTemplate(k) : startFromTemplate(k)),
      }}
    />
  );

  const runCheck = async () => {
    const saved = await saveNow();
    const id = saved?.id ?? campaignId;
    if (!id) return;
    setChecking(true);
    try { setLastCheck(await checkCampaign(id)); } catch { toast.error(t('ems_err_check_failed')); } finally { setChecking(false); }
  };
  const doSubmit = async () => {
    const saved = await saveNow();
    const id = saved?.id ?? campaignId;
    if (!id) return;
    setBusy('submit');
    try {
      const r = await submitCampaign(id);
      setLastCheck({ risk: r.risk, problems: [], audience: null });
      toast.success(t(`ems_submit_${r.status.toLowerCase()}`));
      const c = await getCampaign(id); if (c) setCampaign(c);
    } catch (e) {
      if (e instanceof StudioError && e.code === 'INCOMPLETE') {
        const body = e.body as { problems?: string[]; risk?: RiskResult } | null;
        setLastCheck({ risk: body?.risk ?? { verdict: 'REVIEW', level: 'MEDIUM', score: 0, findings: [], needsModel: false }, problems: body?.problems ?? [], audience: null });
        toast.error(t('ems_submit_incomplete'));
      } else toast.error(t('ems_err_submit_failed'));
    } finally { setBusy(null); }
  };
  const doTest = async () => {
    const saved = await saveNow();
    const id = saved?.id ?? campaignId;
    if (!id) return;
    setBusy('test');
    try { const r = await sendTest(id); toast.success(t('ems_test_sent', { to: r.sentTo })); }
    catch (e) {
      const code = e instanceof StudioError ? e.code.toLowerCase() : 'request_failed';
      const k = `ems_test_err_${code}`;
      toast.error(t(k) === k ? t('ems_test_err_generic') : t(k));
    } finally { setBusy(null); }
  };
  const doSchedule = async () => {
    if (!campaignId || !scheduleAt) return;
    const when = new Date(scheduleAt);
    if (!(when.getTime() > Date.now() + 60_000)) { toast.error(t('ems_schedule_future')); return; }
    setBusy('schedule');
    try {
      await scheduleCampaign(campaignId, when, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      toast.success(t('ems_scheduled_ok'));
      const c = await getCampaign(campaignId); if (c) setCampaign(c);
    } catch { toast.error(t('ems_err_schedule_failed')); } finally { setBusy(null); }
  };
  const doUnschedule = async () => {
    if (!campaignId) return;
    setBusy('unschedule');
    try { await unscheduleCampaign(campaignId); const c = await getCampaign(campaignId); if (c) setCampaign(c); }
    catch { toast.error(t('ems_err_schedule_failed')); } finally { setBusy(null); }
  };
  const doSendNow = async () => {
    if (!campaignId || !sendAck) return;
    setConfirmSend(false);
    setBusy('send');
    try {
      const r = await sendNow(campaignId);
      toast.success(t('ems_send_started', { n: r.sent ?? 0 }));
      const c = await getCampaign(campaignId); if (c) setCampaign(c);
      navigate(`/outreach/email/campaigns/${campaignId}/overview`);
    } catch (e) {
      const code = e instanceof StudioError ? e.code : 'SEND_FAILED';
      const k = `ems_send_err_${code.toLowerCase()}`;
      toast.error(t(k) === k ? t('ems_send_err_generic') : t(k));
    } finally { setBusy(null); setSendAck(false); }
  };
  const doWithdraw = async () => {
    if (!campaignId) return;
    try { await setCampaignStatus(campaignId, 'DRAFT'); const c = await getCampaign(campaignId); if (c) setCampaign(c); } catch { toast.error(t('ems_err_status_failed')); }
  };

  const saveAsTemplate = async () => {
    const name = window.prompt(t('ems_tpl_name_prompt'), w.name || t('ems_tpl_untitled'));
    if (!name?.trim()) return;
    try { const tpl = await saveTemplate({ name: name.trim(), language: w.language, subject: w.subject, preview_text: w.preview_text, design: w.design }); setTemplates((ts) => [tpl, ...ts]); toast.success(t('ems_tpl_saved')); }
    catch { toast.error(t('ems_tpl_save_failed')); }
  };
  const saveSection = async (block: Block) => {
    const name = window.prompt(t('ems_section_name_prompt'), t(`ems_block_${block.type}`));
    if (!name?.trim()) return;
    try { const tpl = await saveTemplate({ name: name.trim(), kind: 'SECTION', design: { ...emptyDoc(), blocks: [block] } }); setTemplates((ts) => [tpl, ...ts]); toast.success(t('ems_section_saved')); }
    catch { toast.error(t('ems_tpl_save_failed')); }
  };
  const sections = useMemo(() => templates.filter((x) => x.kind === 'SECTION' && x.design?.blocks?.length).map((x) => ({ id: x.id, name: x.name, block: x.design.blocks[0] })), [templates]);

  /* ── render ────────────────────────────────────────────────────────────────────────────── */
  if (loading) return <CommsWorkspace product="email"><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-96 w-full rounded-2xl" /></CommsWorkspace>;
  if (loadError) {
    return (
      <CommsWorkspace product="email">
        <div className="rounded-2xl border bg-card p-8 text-center">
          <p className="font-medium">{t('ems_load_failed')}</p>
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="outline" onClick={() => void load()}>{t('ems_retry')}</Button>
            <Button onClick={() => navigate('/outreach/email/campaigns')}>{t('ems_back_to_campaigns')}</Button>
          </div>
        </div>
      </CommsWorkspace>
    );
  }

  return (
    /* The design step needs the width: no product rail and no HOMI column (HOMI opens as a sheet). */
    <CommsWorkspace product="email" railless={step === 'design'} header={
      <div className="overflow-hidden rounded-2xl bg-[#0C1119] px-4 py-4 text-white sm:px-6 sm:py-5">
        <nav aria-label={t('ems_breadcrumb')} className="mb-1.5 flex flex-wrap items-center gap-1 text-2xs text-white/60">
          <button type="button" onClick={() => navigate('/outreach/email')} className="hover:text-white">{t('dnav_email')}</button>
          <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
          <button type="button" onClick={() => navigate('/outreach/email/campaigns')} className="hover:text-white">{t('ems_nav_campaigns')}</button>
          <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
          <span className="text-white/85">{w.name || (campaignId ? fallbackName : t('ems_new_campaign'))}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <h1 className="font-display text-xl font-bold leading-tight [overflow-wrap:break-word] sm:text-2xl">{w.name || (campaignId ? fallbackName : t('ems_new_campaign'))}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-white/70">
              <PhaseBadge status={campaign?.status ?? 'DRAFT'} className="border-white/20" />
              <SaveIndicator state={saving} at={savedAt} onRetry={() => void saveNow()} hasCampaign={Boolean(campaignId)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaignId && !['DRAFT', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'].includes(phase) ? (
              <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => navigate(`/outreach/email/campaigns/${campaignId}/overview`)}>
                <ListChecks className="h-4 w-4" />{t('ems_details_open')}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => setHomiOpen(true)}>
              <Sparkles className="h-4 w-4 text-[hsl(38_92%_60%)]" />{t('homi_ask')}
            </Button>
            {!readOnly ? (
              <Button size="sm" className="h-9 gap-1.5 bg-white text-[#0C1119] hover:bg-white/90" onClick={() => void saveNow()} disabled={saving === 'saving'}>
                {saving === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('ems_save_draft')}
              </Button>
            ) : null}
          </div>
        </div>
        {/* Stepper */}
        <ol className="mt-4 grid grid-cols-2 gap-1.5 xl:grid-cols-4" aria-label={t('ems_steps')}>
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => goStep(s)} aria-current={i === stepIndex ? 'step' : undefined}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs leading-tight transition-colors',
                  i === stepIndex ? 'bg-white text-[#0C1119]' : 'text-white/75 hover:bg-white/10')}>
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold',
                  done[s] ? 'bg-[hsl(38_92%_54%)] text-[#161309]' : i === stepIndex ? 'bg-[#0C1119] text-white' : 'border border-white/40')}>
                  {done[s] ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold [overflow-wrap:anywhere]">{t(`ems_step2_${s}`)}</span>
                  <span className={cn('hidden text-2xs md:block', i === stepIndex ? 'text-[#0C1119]/60' : 'text-white/50')}>{t(`ems_step2_${s}_sub`)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    }>
      {restore ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="me-auto">{t('ems_restore_found', { when: new Date(restore.at).toLocaleString(lang) })}</span>
          <Button size="sm" className="h-8" onClick={() => { if (restore.draftKey) draftKey.current = restore.draftKey; update(restore.w); setRestore(null); }}>{t('ems_restore_yes')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { clearLocal(campaignId); setRestore(null); }}>{t('ems_restore_no')}</Button>
        </div>
      ) : null}
      {readOnly ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-sm"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="me-auto">{t('ems_read_only')}</span>
          {campaignId ? <Button size="sm" variant="outline" className="h-8" onClick={() => navigate(`/outreach/email/campaigns/${campaignId}/overview`)}>{t('ems_details_open')}</Button> : null}
        </div>
      ) : campaign && editDropsApproval(campaign.status) ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{t('ems_edit_drops_approval')}</div>
      ) : null}

      <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5', step !== 'design' && '2xl:grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="min-w-0 space-y-5">
          {step === 'design' ? (
            <DesignStep w={w} update={update} readOnly={readOnly} templates={templates} sections={sections} fallbackName={fallbackName}
              onSaveTemplate={() => void saveAsTemplate()} onSaveSection={(b) => void saveSection(b)} placeholders={placeholders} noLink={noLink} noAlt={noAlt} />
          ) : null}
          {step === 'sender' ? <SenderStep w={w} update={update} senders={senders} domains={domains} readOnly={readOnly} campaignId={campaignId} /> : null}
          {step === 'recipients' ? (
            <RecipientsStep w={w} update={update} lists={lists} estimate={estimate} estimating={estimating} readOnly={readOnly}
              onListsChanged={() => { void reloadLists(); setEstimateTick((n) => n + 1); }} campaignId={campaignId} />
          ) : null}
          {step === 'review' ? (
            <ReviewStep
              w={w} campaign={campaign} done={done} placeholders={placeholders} noLink={noLink} noAlt={noAlt} estimate={estimate} lastCheck={lastCheck} checking={checking}
              busy={busy} history={history} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt} allowance={allowance} allowanceLoading={allowanceLoading}
              onRefreshAllowance={loadAllowance} testTo={supaUser?.email ?? null} senders={senders}
              onCheck={() => void runCheck()} onSubmit={() => void doSubmit()} onTest={() => void doTest()} onSchedule={() => void doSchedule()}
              onUnschedule={() => void doUnschedule()} onSendNow={() => { setSendAck(false); setConfirmSend(true); }} onWithdraw={() => void doWithdraw()} goStep={goStep}
            />
          ) : null}

          {/* Step navigation */}
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <Button variant="outline" className="gap-1.5" disabled={stepIndex === 0} onClick={() => goStep(STEPS[stepIndex - 1])}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{stepIndex > 0 ? t(`ems_step2_${STEPS[stepIndex - 1]}`) : t('ems_back')}
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button className="gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={() => goStep(STEPS[stepIndex + 1])}>
                {t('ems_next_to', { step: t(`ems_step2_${STEPS[stepIndex + 1]}`) })}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* HOMI rail on very wide screens (not on the design step, which needs the width); elsewhere "Ask HOMI" opens it as a sheet. */}
        {step !== 'design' ? <aside className="hidden min-w-0 2xl:block"><div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">{homi}</div></aside> : null}
      </div>

      <Sheet open={homiOpen} onOpenChange={setHomiOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>{t('homi_assistant')}</SheetTitle></SheetHeader>
          <div className="mt-3">{homi}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(confirmEdit)} onOpenChange={(o) => { if (!o) setConfirmEdit(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ems_edit_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ems_edit_confirm_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setApprovalWarned(true); confirmEdit?.(); setConfirmEdit(null); }}>{t('ems_edit_confirm_yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(confirmTemplate)} onOpenChange={(o) => { if (!o) setConfirmTemplate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ems_tpl_replace_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ems_tpl_replace_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmTemplate) startFromTemplate(confirmTemplate); setConfirmTemplate(null); }}>{t('ems_tpl_use')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSend} onOpenChange={(o) => { setConfirmSend(o); if (!o) setSendAck(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ems_send_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ems_send_confirm_body', { n: campaign?.audience_count ?? estimate?.eligible ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
            <Checkbox checked={sendAck} onCheckedChange={(v) => setSendAck(v === true)} className="min-h-0 mt-0.5" />
            <span>{t('ems_send_confirm_ack', { n: campaign?.audience_count ?? estimate?.eligible ?? 0 })}</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!sendAck} onClick={(e) => { if (!sendAck) { e.preventDefault(); return; } void doSendNow(); }}>{t('ems_send_now')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}

function SaveIndicator({ state, at, onRetry, hasCampaign }: { state: SaveState; at: number | null; onRetry: () => void; hasCampaign: boolean }) {
  const { t, lang } = useLanguage();
  const time = at ? new Date(at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';
  if (state === 'idle') return hasCampaign && at ? <span className="inline-flex items-center gap-1" role="status"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t('ems_save_saved_at', { time })}</span> : null;
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-200" role="alert"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('ems_save_error')}
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded underline underline-offset-2 hover:text-white"><RefreshCw className="h-3 w-3" />{t('ems_retry')}</button>
      </span>
    );
  }
  const map = { pending: [CircleDashed, t('ems_save_pending')], saving: [Loader2, t('ems_save_saving')], saved: [CheckCircle2, t('ems_save_saved_at', { time })] } as const;
  const [Icon, label] = map[state];
  return <span className="inline-flex items-center gap-1" role="status"><Icon className={cn('h-3.5 w-3.5', state === 'saving' && 'animate-spin')} aria-hidden="true" />{label}</span>;
}

/* ── steps ─────────────────────────────────────────────────────────────────────────────────── */

type StepProps = { w: Working; update: (p: Partial<Working>) => void; readOnly: boolean };

function Card({ title, sub, children, icon: Icon, actions }: { title: string; sub?: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; actions?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-[0_1px_0_rgba(12,17,25,0.04)] sm:p-6">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(38_90%_95%)] text-[hsl(32_70%_32%)]"><Icon className="h-[18px] w-[18px]" /></span> : null}
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          {sub ? <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function F({ id, label, hint, children, counter }: { id?: string; label: string; hint?: string; children: React.ReactNode; counter?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-2">
        <Label htmlFor={id} className="text-[13px] font-medium">{label}</Label>
        {counter ? <span className="text-2xs tabular-nums text-muted-foreground">{counter}</span> : null}
      </div>
      {children}
      {hint ? <p className="text-2xs leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DesignStep({ w, update, readOnly, templates, sections, onSaveTemplate, onSaveSection, placeholders, noLink, noAlt, fallbackName }: StepProps & {
  templates: UserTemplate[]; sections: Array<{ id: string; name: string; block: Block }>; onSaveTemplate: () => void; onSaveSection: (b: Block) => void;
  placeholders: string[]; noLink: string[]; noAlt: string[]; fallbackName: string;
}) {
  const { t } = useLanguage();
  const [picker, setPicker] = useState(w.design.blocks.length === 0);
  const rtl = w.language === 'ar' || w.language === 'he';
  const pick = (p: PickedStart) => {
    update({
      design: normalizeDoc({ ...p.doc, meta: { template: p.template } }),
      ...(p.subject && !w.subject ? { subject: p.subject } : {}), ...(p.previewText && !w.preview_text ? { preview_text: p.previewText } : {}),
    });
    setPicker(false);
  };
  const basics = (
    <Card title={t('ems_basics_title')} sub={t('ems_basics_sub')} icon={Mail}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <F id="ems-name" label={t('ems_f_name')} hint={t('ems_f_name_hint')}>
          <Input id="ems-name" value={w.name} maxLength={160} placeholder={fallbackName} disabled={readOnly} onChange={(e) => update({ name: e.target.value })} />
        </F>
        <F id="ems-subj" label={t('ems_f_subject')} hint={t('ems_f_subject_hint')} counter={`${w.subject.length}/200`}>
          <Input id="ems-subj" value={w.subject} maxLength={200} disabled={readOnly} onChange={(e) => update({ subject: e.target.value })} />
        </F>
        <F id="ems-prev" label={t('ems_f_preview')} hint={t('ems_f_preview_hint')} counter={`${w.preview_text.length}/200`}>
          <Input id="ems-prev" value={w.preview_text} maxLength={200} disabled={readOnly} onChange={(e) => update({ preview_text: e.target.value })} />
        </F>
        <F id="ems-lang" label={t('ems_f_language')} hint={t('ems_f_language_hint')}>
          <Select value={w.language} disabled={readOnly} onValueChange={(v) => update({ language: v })}>
            <SelectTrigger id="ems-lang"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGS.map((l) => <SelectItem key={l} value={l}>{t(`ems_lang_${l}`)}</SelectItem>)}</SelectContent>
          </Select>
        </F>
      </div>
    </Card>
  );
  if (readOnly) {
    const body = renderDesignBody(w.design, { rtl });
    return <EmailPreviewFrame subject={w.subject} html={w.design.blocks.length ? body.html : null} text={body.text} senderName={w.sender_name} language={w.language} previewText={w.preview_text} />;
  }
  return (
    <div className="space-y-4">
      {basics}
      {picker ? (
        <TemplatePicker language={w.language} mine={templates} onPick={pick} onCancel={w.design.blocks.length ? () => setPicker(false) : undefined} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPicker(true)}><LayoutTemplate className="h-3.5 w-3.5" />{t('ems_change_template')}</Button>
            {placeholders.length ? <Chip tone="amber" icon={AlertTriangle}>{t('ems_placeholders_left', { n: placeholders.length })}</Chip> : null}
            {noLink.length ? <Chip tone="red" icon={AlertTriangle}>{t('ems_buttons_no_link', { n: noLink.length })}</Chip> : null}
            {noAlt.length ? <Chip tone="amber" icon={Info}>{t('ems_images_no_alt', { n: noAlt.length })}</Chip> : null}
            {!placeholders.length && !noLink.length && w.design.blocks.length ? <Chip tone="green" icon={CheckCircle2}>{t('ems_design_ready')}</Chip> : null}
          </div>
          <Suspense fallback={<Skeleton className="h-[32rem] w-full rounded-2xl" />}>
            <EmailDesigner value={w.design} onChange={(doc) => update({ design: doc })} rtl={rtl} subject={w.subject} previewText={w.preview_text}
              senderName={w.sender_name} language={w.language} sections={sections} onSaveSection={onSaveSection} onSaveTemplate={onSaveTemplate} flagged={noLink} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function Chip({ tone, icon: Icon, children }: { tone: 'amber' | 'red' | 'green'; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  const c = { amber: 'bg-amber-50 text-amber-900', red: 'bg-red-50 text-red-800', green: 'bg-emerald-50 text-emerald-800' }[tone];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium', c)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{children}</span>;
}

function SenderStep({ w, update, senders, domains, readOnly, campaignId }: StepProps & { senders: SenderOption[] | null; domains: SendingDomain[]; campaignId: string | null }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const current = senders?.find((s) => (s.address ?? '') === (w.sender_email ?? '')) ?? senders?.[0];
  const domain = domains.find((d) => d.domain === current?.domain);
  const auth = current && !current.custom ? { spf: 'OK', dkim: 'OK', dmarc: 'OK' } : domain ? domainAuth(domain) : { spf: 'MISSING', dkim: 'MISSING', dmarc: 'MISSING' };
  const back = campaignId ? `?return=${encodeURIComponent(`/outreach/email/campaigns/${campaignId}?step=sender`)}` : '';
  return (
    <Card title={t('ems_step2_sender')} sub={t('ems_sender_sub')} icon={BadgeCheck}
      actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/outreach/email/domains${back}`)}><ExternalLink className="h-3.5 w-3.5" />{t('ems_sender_add')}</Button>}>
      {senders === null ? <Skeleton className="h-24 w-full" /> : (
        <div className="space-y-4">
          <div className="grid gap-2">
            {senders.map((s) => {
              const val = s.address ?? '';
              const on = (w.sender_email ?? '') === val;
              return (
                <button key={val || 'homatch'} type="button" disabled={readOnly || !s.verified} onClick={() => update({ sender_email: val, ...(s.name && !w.sender_name ? { sender_name: s.name } : {}) })} aria-pressed={on}
                  className={cn('flex items-center gap-3 rounded-xl border p-3.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60', on ? 'border-[#0C1119] ring-1 ring-[#0C1119]' : 'hover:border-foreground/40')}>
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on && 'border-[#0C1119] bg-[#0C1119]')}>{on ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{s.custom ? (s.name || s.domain) : t('ems_sender_homatch')}</span>
                    <span className="block text-[13px] text-foreground/80 [overflow-wrap:anywhere]" dir="ltr">{s.custom ? s.address ?? t('ems_sender_no_address') : t('ems_sender_homatch_address')}</span>
                    <span className="block text-2xs text-muted-foreground">{t('ems_sender_provider', { provider: 'Resend' })}{s.custom ? '' : ` · ${t('ems_sender_homatch_note')}`}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold', s.verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900')}>
                    {s.verified ? t('ems_verified') : t('ems_not_verified')}
                  </span>
                </button>
              );
            })}
          </div>
          {senders.some((s) => s.custom && !s.verified) ? <p className="flex items-start gap-1.5 text-2xs text-muted-foreground"><Info className="mt-px h-3.5 w-3.5 shrink-0" />{t('ems_sender_unverified_hint')}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <F id="ems-sname" label={t('ems_f_sender_name')} hint={t('ems_f_sender_name_hint')}>
              <Input id="ems-sname" value={w.sender_name} maxLength={80} disabled={readOnly} onChange={(e) => update({ sender_name: e.target.value })} />
            </F>
            <F id="ems-reply" label={t('ems_f_reply_to')} hint={t('ems_f_reply_to_hint')}>
              <Input id="ems-reply" type="email" dir="ltr" value={w.reply_to} maxLength={254} disabled={readOnly} onChange={(e) => update({ reply_to: e.target.value.trim() })} />
            </F>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="mb-2 text-[13px] font-medium">{t('ems_auth_title')}</p>
            <div className="grid grid-cols-3 gap-2 text-center text-2xs">
              {(['spf', 'dkim', 'dmarc'] as const).map((k) => {
                const ok = auth[k] === 'OK';
                return (
                  <div key={k} className={cn('rounded-lg border px-2 py-2', ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
                    <p className="font-semibold uppercase">{k}</p>
                    <p>{ok ? t('ems_auth_ok') : auth[k] === 'MISSING' ? t('ems_auth_missing') : t('ems_auth_pending')}</p>
                  </div>
                );
              })}
            </div>
            {current?.custom && auth.dmarc !== 'OK' ? <p className="mt-2 text-2xs text-muted-foreground">{t('ems_auth_dmarc_note')}</p> : null}
          </div>
          <div className="rounded-xl border border-[hsl(38_60%_85%)] bg-[hsl(38_90%_97%)] p-3">
            <p className="text-[13px] font-medium">{t('ems_inbox_preview')}</p>
            <div className="mt-1.5 rounded-lg bg-white p-3 shadow-sm">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{w.sender_name || (current?.custom ? current.name || current.domain : 'HOMATCH')}</p>
              <p className="text-sm [overflow-wrap:anywhere]">{w.subject || t('ems_subject_placeholder')}</p>
              <p className="truncate text-[13px] text-muted-foreground">{w.preview_text || t('ems_preview_placeholder')}</p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Chips({ options, value, onChange, label, disabled }: { options: Array<{ v: string; l: string }>; value: string[]; onChange: (v: string[]) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.v);
        return (
          <button key={o.v} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])}
            className={cn('rounded-full border px-2.5 py-1 text-2xs leading-tight transition-colors', on ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'bg-card text-foreground/80 hover:border-foreground/40')}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function RecipientsStep({ w, update, lists, estimate, estimating, readOnly, onListsChanged, campaignId }: StepProps & {
  lists: ListOption[] | null; estimate: AudienceEstimate | null; estimating: boolean; onListsChanged: () => void; campaignId: string | null;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const selectedIds = w.audience_filter.contactIds ?? [];
  const [mode, setMode] = useState<'lists' | 'selected'>(selectedIds.length ? 'selected' : 'lists');
  const [countryText, setCountryText] = useState((w.audience_filter.countries ?? []).join(', '));
  const [leadOpen, setLeadOpen] = useState(false);
  const f = w.audience_filter;
  const setF = (p: Partial<AudienceFilter>) => update({ audience_filter: { ...f, ...p } });
  const toggleList = (id: string) => update({ contact_list_ids: w.contact_list_ids.includes(id) ? w.contact_list_ids.filter((x) => x !== id) : [...w.contact_list_ids, id] });
  const back = encodeURIComponent(campaignId ? `/outreach/email/campaigns/${campaignId}?step=recipients` : '/outreach/email/campaigns/new?step=recipients');
  const switchMode = (m: 'lists' | 'selected') => {
    setMode(m);
    if (m === 'lists' && selectedIds.length) update({ audience_filter: { ...f, contactIds: [] }, contact_list_ids: [] });
    if (m === 'selected' && !selectedIds.length) update({ contact_list_ids: [] });
  };
  return (
    <>
      <Card title={t('ems_step2_recipients')} sub={t('ems_recipients_sub2')} icon={Users}
        actions={<>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLeadOpen(true)} disabled={readOnly}><UserPlus className="h-3.5 w-3.5" />{t('ems_lead_add')}</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/outreach/email/contacts/import?return=${back}`)}><Upload className="h-3.5 w-3.5" />{t('ems_import_contacts')}</Button>
        </>}>
        <div className="mb-4 inline-flex rounded-lg border p-0.5" role="tablist" aria-label={t('ems_rcpt_mode')}>
          {(['lists', 'selected'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={readOnly} onClick={() => switchMode(m)}
              className={cn('inline-flex h-8 items-center rounded-md px-3 text-xs font-medium', mode === m ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {t(`ems_rcpt_mode_${m}`)}
            </button>
          ))}
        </div>
        {mode === 'lists' ? (
          lists === null ? <Skeleton className="h-32 w-full" /> : lists.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="font-medium">{t('ems_no_lists')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('ems_no_lists_body2')}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button className="gap-1.5" onClick={() => setLeadOpen(true)}><UserPlus className="h-4 w-4" />{t('ems_lead_add')}</Button>
                <Button variant="outline" className="gap-1.5" onClick={() => navigate(`/outreach/email/contacts/import?return=${back}`)}><Upload className="h-4 w-4" />{t('ems_import_contacts')}</Button>
              </div>
            </div>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border p-1.5">
              {lists.map((l) => (
                <label key={l.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/60', w.contact_list_ids.includes(l.id) && 'bg-[hsl(38_90%_97%)]')}>
                  <Checkbox className="min-h-0" checked={w.contact_list_ids.includes(l.id)} disabled={readOnly} onCheckedChange={() => toggleList(l.id)} />
                  <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{l.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t('ems_list_rows', { n: l.total_rows ?? 0 })}</span>
                </label>
              ))}
            </div>
          )
        ) : (
          <SelectedLeads w={w} update={update} readOnly={readOnly} />
        )}
      </Card>

      {mode === 'lists' ? (
        <Card title={t('ems_segment_title')} sub={t('ems_segment_sub')}>
          <div className="space-y-4">
            <F label={t('ems_seg_sources')}><Chips label={t('ems_seg_sources')} disabled={readOnly} value={f.sources ?? []} onChange={(v) => setF({ sources: v })} options={SOURCES.map((s) => ({ v: s, l: t(`ems_src_${s.toLowerCase()}`) }))} /></F>
            <F label={t('ems_seg_languages')}><Chips label={t('ems_seg_languages')} disabled={readOnly} value={f.languages ?? []} onChange={(v) => setF({ languages: v })} options={[...LANGS, 'unknown'].map((l) => ({ v: l, l: t(`ems_lang_${l}`) }))} /></F>
            <F label={t('ems_seg_interest')}><Chips label={t('ems_seg_interest')} disabled={readOnly} value={f.leadTypes ?? []} onChange={(v) => setF({ leadTypes: v })} options={LEAD_TYPES.map((l) => ({ v: l, l: t(`ems_lead_${l.toLowerCase()}`) }))} /></F>
            <F label={t('ems_seg_countries')} hint={t('ems_seg_countries_hint')}>
              <Input value={countryText} disabled={readOnly} dir="ltr" placeholder={t('ems_seg_countries_example')} onChange={(e) => setCountryText(e.target.value)}
                onBlur={() => setF({ countries: [...new Set(countryText.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))] })} />
            </F>
            {lists && lists.length > 1 ? (
              <F label={t('ems_seg_exclude')} hint={t('ems_seg_exclude_hint')}>
                <Chips label={t('ems_seg_exclude')} disabled={readOnly} value={f.excludeListIds ?? []} onChange={(v) => setF({ excludeListIds: v })}
                  options={lists.filter((l) => !w.contact_list_ids.includes(l.id)).map((l) => ({ v: l.id, l: l.name }))} />
              </F>
            ) : null}
          </div>
        </Card>
      ) : null}

      <section className="rounded-2xl border bg-[#0C1119] p-4 text-white sm:p-5" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t('ems_estimate_title')}</p>
          {estimating ? <Loader2 className="h-4 w-4 animate-spin text-white/60" aria-hidden="true" /> : null}
        </div>
        {estimate ? (
          <>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums text-[hsl(38_92%_60%)]">{estimate.eligible.toLocaleString(lang)}</p>
            <p className="text-[13px] text-white/75">{t('ems_estimate_eligible2')}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-5">
              <div><dt className="text-white/55">{t('ems_estimate_matched')}</dt><dd className="tabular-nums">{estimate.matched}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_unknown')}</dt><dd className="tabular-nums">{estimate.consentUnknown}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_dupes')}</dt><dd className="tabular-nums">{estimate.duplicates}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_suppressed')}</dt><dd className="tabular-nums">{estimate.suppressed}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_invalid')}</dt><dd className="tabular-nums">{estimate.invalidEmail ?? 0}</dd></div>
            </dl>
            {estimate.consentUnknown > 0 ? (
              <p className="mt-3 flex flex-wrap items-start gap-1.5 rounded-lg bg-white/10 p-2.5 text-2xs text-white/85"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{t('ems_consent_note2')}</span>
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => navigate('/outreach/email/contacts?status=CONSENT_MISSING')}>{t('ems_consent_review')}</button>
              </p>
            ) : null}
          </>
        ) : <p className="mt-2 text-sm text-white/70">{t(mode === 'selected' ? 'ems_estimate_pick_leads' : 'ems_estimate_pick')}</p>}
      </section>

      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} lists={lists ?? []}
        onListCreated={() => onListsChanged()}
        onSaved={(lead) => {
          onListsChanged();
          if (lead.list_id && mode === 'lists' && !w.contact_list_ids.includes(lead.list_id)) update({ contact_list_ids: [...w.contact_list_ids, lead.list_id] });
          if (mode === 'selected') update({ audience_filter: { ...f, contactIds: [...new Set([...(f.contactIds ?? []), lead.id])] }, contact_list_ids: [...new Set([...w.contact_list_ids, ...(lead.list_id ? [lead.list_id] : [])])] });
        }} />
    </>
  );
}

/** Individually chosen leads: their ids filter the audience, their lists scope it. */
function SelectedLeads({ w, update, readOnly }: StepProps) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [known, setKnown] = useState<Map<string, string | null>>(new Map());
  const ids = w.audience_filter.contactIds ?? [];

  useEffect(() => {
    let live = true;
    const h = window.setTimeout(() => {
      void listLeads({ search: q, status, pageSize: 100 }).then((r) => { if (live) { setRows(r.rows); setTotal(r.total); } }).catch(() => { if (live) setRows([]); });
    }, 250);
    return () => { live = false; window.clearTimeout(h); };
  }, [q, status]);
  /* Lists of leads chosen in an earlier visit (not on this page of results). */
  useEffect(() => {
    const missing = ids.filter((id) => !known.has(id));
    if (!missing.length) return;
    void supabase.from('outreach_contacts').select('id, list_id').in('id', missing.slice(0, 1000)).then(({ data }) => {
      setKnown((m) => { const n = new Map(m); for (const r of (data ?? []) as Array<{ id: string; list_id: string | null }>) n.set(r.id, r.list_id); return n; });
    });
  }, [ids, known]);

  const apply = (next: string[], map: Map<string, string | null>) => {
    const listIds = [...new Set(next.map((id) => map.get(id)).filter((x): x is string => Boolean(x)))].slice(0, 50);
    update({ audience_filter: { ...w.audience_filter, contactIds: next.slice(0, 1000) }, contact_list_ids: listIds });
  };
  const toggle = (l: Lead) => {
    const map = new Map(known); map.set(l.id, l.list_id); setKnown(map);
    apply(ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id], map);
  };
  const toggleAll = () => {
    if (!rows) return;
    const map = new Map(known); for (const r of rows) map.set(r.id, r.list_id); setKnown(map);
    const all = rows.every((r) => ids.includes(r.id));
    apply(all ? ids.filter((x) => !rows.some((r) => r.id === x)) : [...new Set([...ids, ...rows.map((r) => r.id)])], map);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ems_leads_search')} className="ps-8" aria-label={t('ems_leads_search')} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | 'ALL')}>
          <SelectTrigger className="w-auto min-w-[10rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('ems_leads_f_all')}</SelectItem>
            {(['CAN_RECEIVE', 'CONSENT_MISSING', 'UNSUBSCRIBED', 'SUPPRESSED'] as const).map((s) => <SelectItem key={s} value={s}>{t(`ems_lead_st_${s.toLowerCase()}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-2xs text-muted-foreground">{t('ems_rcpt_selected_n', { n: ids.length })} · {t('ems_rcpt_selected_hint')}</p>
      {rows === null ? <Skeleton className="h-40 w-full" /> : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('ems_leads_none_match')}</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-2xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-10 p-2"><Checkbox className="min-h-0" aria-label={t('ems_leads_select_all')} checked={rows.every((r) => ids.includes(r.id))} disabled={readOnly} onCheckedChange={toggleAll} /></th>
                <th className="p-2 text-start font-medium">{t('ems_leads_col_name')}</th>
                <th className="hidden p-2 text-start font-medium sm:table-cell">{t('ems_leads_col_email')}</th>
                <th className="p-2 text-start font-medium">{t('ems_leads_col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={cn('border-t', ids.includes(l.id) && 'bg-[hsl(38_90%_97%)]')}>
                  <td className="p-2"><Checkbox className="min-h-0" aria-label={l.full_name ?? l.email ?? ''} checked={ids.includes(l.id)} disabled={readOnly} onCheckedChange={() => toggle(l)} /></td>
                  <td className="p-2"><span className="block font-medium [overflow-wrap:anywhere]">{l.full_name || '—'}</span><span className="block text-2xs text-muted-foreground sm:hidden" dir="ltr">{l.email}</span></td>
                  <td className="hidden p-2 text-[13px] text-muted-foreground sm:table-cell" dir="ltr">{l.email}</td>
                  <td className="p-2"><LeadStatusChip lead={l} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length ? <p className="border-t p-2 text-center text-2xs text-muted-foreground">{t('ems_leads_showing', { n: rows.length, total })}</p> : null}
        </div>
      )}
    </div>
  );
}

function ReviewStep(p: {
  w: Working; campaign: StudioCampaign | null; done: Record<Step, boolean>; placeholders: string[]; noLink: string[]; noAlt: string[]; estimate: AudienceEstimate | null;
  lastCheck: { risk: RiskResult; problems: string[]; audience: AudienceEstimate | null } | null; checking: boolean; busy: string | null; history: ReviewEntry[];
  scheduleAt: string; setScheduleAt: (v: string) => void; onCheck: () => void; onSubmit: () => void; onTest: () => void; onSchedule: () => void;
  onUnschedule: () => void; onSendNow: () => void; onWithdraw: () => void; goStep: (s: Step) => void;
  allowance: EmailAllowance | null; allowanceLoading: boolean; onRefreshAllowance: () => void; testTo: string | null; senders: SenderOption[] | null;
}) {
  const { t, lang } = useLanguage();
  const phase = emailPhase(p.campaign?.status ?? 'DRAFT');
  const rtl = p.w.language === 'ar' || p.w.language === 'he';
  const body = useMemo(() => renderDesignBody(p.w.design, { rtl }), [p.w.design, rtl]);
  const sender = p.senders?.find((s) => (s.address ?? '') === (p.w.sender_email ?? ''));
  const eligible = p.estimate?.eligible ?? 0;
  const fits = p.allowance ? sendable(p.allowance, eligible) : null;
  const checks: Array<{ ok: boolean; key: string; step?: Step; vars?: Record<string, string | number>; soft?: boolean }> = [
    { ok: Boolean(p.w.subject.trim()), key: 'ems_chk_subject', step: 'design' },
    { ok: p.w.design.blocks.length > 0, key: 'ems_chk_design', step: 'design' },
    { ok: p.placeholders.length === 0, key: 'ems_chk_placeholders', step: 'design', vars: { list: p.placeholders.slice(0, 3).join(', ') } },
    { ok: p.noLink.length === 0, key: 'ems_chk_links', step: 'design', vars: { n: p.noLink.length } },
    { ok: p.noAlt.length === 0, key: 'ems_chk_alt', step: 'design', vars: { n: p.noAlt.length }, soft: true },
    { ok: p.done.sender, key: 'ems_chk_sender', step: 'sender' },
    { ok: p.done.recipients, key: 'ems_chk_recipients', step: 'recipients', vars: { n: eligible } },
    { ok: true, key: 'ems_chk_unsubscribe' },
    { ok: Boolean(p.lastCheck) && p.lastCheck!.risk.verdict !== 'BLOCK', key: 'ems_chk_risk' },
  ];
  const canSubmit = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(phase) && checks.filter((c) => !c.soft && c.key !== 'ems_chk_risk' && c.key !== 'ems_chk_unsubscribe').every((c) => c.ok);
  return (
    <>
      <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <EmailPreviewFrame subject={p.w.subject || p.w.name} html={p.w.design.blocks.length ? body.html : null} text={body.text} senderName={p.w.sender_name} language={p.w.language} previewText={p.w.preview_text} />
        <Card title={t('ems_review_summary')} icon={Mail}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Summary label={t('ems_f_subject')} value={p.w.subject || '—'} onEdit={() => p.goStep('design')} />
            <Summary label={t('ems_f_preview')} value={p.w.preview_text || '—'} onEdit={() => p.goStep('design')} />
            <Summary label={t('ems_review_sender')} value={`${p.w.sender_name || (sender?.custom ? sender.name || sender.domain : 'HOMATCH')} · ${sender?.custom ? sender.address : t('ems_sender_homatch_address')}`} onEdit={() => p.goStep('sender')} ltr />
            <Summary label={t('ems_review_recipients')} value={t('ems_review_recipients_n', { n: eligible.toLocaleString(lang) })} onEdit={() => p.goStep('recipients')} />
          </dl>
        </Card>
      </div>

      <AllowancePanel allowance={p.allowance} loading={p.allowanceLoading} recipients={eligible} />
      <div className="-mt-3 flex justify-end"><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={p.onRefreshAllowance}><RefreshCw className="h-3.5 w-3.5" />{t('ems_allow_refresh')}</Button></div>

      <Card title={t('ems_step2_review')} sub={t('ems_review_sub2')} icon={ShieldCheck}>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.key} className="flex items-center gap-2.5 text-sm">
              {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : c.soft ? <Info className="h-4 w-4 shrink-0 text-amber-600" /> : <X className="h-4 w-4 shrink-0 text-red-600" />}
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(c.key, c.vars)}</span>
              {!c.ok && c.step ? <button type="button" className="shrink-0 text-2xs font-medium underline-offset-2 hover:underline" onClick={() => p.goStep(c.step!)}>{t('ems_fix')}</button> : null}
            </li>
          ))}
        </ul>
        {fits && fits.now < eligible && eligible > 0 ? <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[13px] text-amber-900"><AlertTriangle className="mt-px h-4 w-4 shrink-0" />{t('ems_review_partial', { now: fits.now, n: eligible })}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" onClick={p.onCheck} disabled={p.checking}>
            {p.checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{t('ems_run_check')}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={p.onTest} disabled={p.busy === 'test' || !p.w.design.blocks.length}>
            {p.busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t('ems_send_test')}
          </Button>
          {canSubmit ? (
            <Button className="gap-1.5 bg-[hsl(38_92%_54%)] font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)]" onClick={p.onSubmit} disabled={p.busy === 'submit'}>
              {p.busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}{t('ems_submit')}
            </Button>
          ) : null}
          {['UNDER_REVIEW', 'READY_FOR_REVIEW'].includes(phase) ? <Button variant="ghost" onClick={p.onWithdraw}>{t('ems_withdraw')}</Button> : null}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">{p.testTo ? t('ems_test_to', { email: p.testTo }) : t('ems_test_to_account')}</p>
        {['UNDER_REVIEW', 'READY_FOR_REVIEW'].includes(phase) ? <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky-50 p-2.5 text-[13px] text-sky-900"><Info className="mt-px h-4 w-4 shrink-0" />{t('ems_review_waiting')}</p> : null}
      </Card>

      {p.lastCheck ? (
        <Card title={t('ems_risk_title')} sub={t('ems_risk_sub')}>
          <div className="mb-3"><VerdictLine verdict={p.lastCheck.risk.verdict} level={p.lastCheck.risk.level} /></div>
          {p.lastCheck.problems.length ? (
            <ul className="mb-3 space-y-1">{p.lastCheck.problems.map((x) => <li key={x} className="text-sm text-red-700">• {t(`ems_problem_${x.toLowerCase()}`)}</li>)}</ul>
          ) : null}
          <RiskReport findings={p.lastCheck.risk.findings} />
        </Card>
      ) : null}

      {p.campaign && (phase === 'APPROVED' || phase === 'SCHEDULED') ? (
        <Card title={t('ems_delivery_title')} sub={phase === 'SCHEDULED' && p.campaign.scheduled_at ? t('ems_scheduled_for', { when: new Date(p.campaign.scheduled_at).toLocaleString(lang) }) : t('ems_delivery_sub')} icon={CalendarClock}>
          {phase === 'APPROVED' ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="ems-when" className="text-[13px]">{t('ems_schedule_at')}</Label>
                <Input id="ems-when" type="datetime-local" value={p.scheduleAt} onChange={(e) => p.setScheduleAt(e.target.value)} className="w-auto" />
              </div>
              <Button variant="outline" className="gap-1.5" onClick={p.onSchedule} disabled={!p.scheduleAt || p.busy === 'schedule'}><CalendarClock className="h-4 w-4" />{t('ems_schedule')}</Button>
              <Button className="gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={p.onSendNow} disabled={p.busy === 'send' || (fits != null && fits.now === 0)}>
                {p.busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t('ems_send_now')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={p.onUnschedule} disabled={p.busy === 'unschedule'}>{t('ems_unschedule')}</Button>
          )}
        </Card>
      ) : null}

      {p.campaign?.review_note && ['REJECTED', 'CHANGES_REQUESTED'].includes(phase) ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3.5 text-sm text-orange-900">
          <p className="font-semibold">{t('ems_reviewer_note')}</p><p className="mt-1 whitespace-pre-line">{p.campaign.review_note}</p>
        </div>
      ) : null}

      {p.history.length ? (
        <Card title={t('ems_history_title')}>
          <ol className="space-y-2">
            {p.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="font-medium">{t(`ems_rev_${h.action.toLowerCase()}`)}</span>
                <span className="text-2xs text-muted-foreground">{t(`ems_actor_${h.actor_kind.toLowerCase()}`)} · {new Date(h.created_at).toLocaleString(lang)}</span>
                {h.reason ? <span className="w-full text-[13px] text-muted-foreground">{reasonText(t, h.reason)}</span> : null}
                {h.risk_findings?.length ? <span className="w-full text-2xs text-muted-foreground">{h.risk_findings.slice(0, 3).map((f) => findingText(t, f)).join(' · ')}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}

function Summary({ label, value, onEdit, ltr }: { label: string; value: string; onEdit: () => void; ltr?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2">
      <dt className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-2xs font-medium text-muted-foreground">
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
        <button type="button" onClick={onEdit} className="shrink-0 whitespace-nowrap text-2xs font-medium text-foreground/70 underline-offset-2 hover:underline">{t('ems_edit')}</button>
      </dt>
      <dd className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]" dir={ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}
