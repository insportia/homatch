// EMAIL STUDIO — the campaign workspace. Owner brief §4: a dedicated full-page workflow, never a
// modal. Routes: /outreach/email/campaigns/new and /outreach/email/campaigns/:id (?step=1…6).
//
// Steps: 1 Identity · 2 Recipients · 3 Sender · 4 Subject & preview · 5 Design · 6 Review & send.
//
// STATE AND SAVING. The page edits a local working copy. Every change is (a) mirrored to
// localStorage at once — a refresh or a crash restores it — and (b) saved to the server after a
// short pause through campaign_save, which renders the design server-side. The first save creates
// the campaign and the address bar switches to its id without a reload. Saving never sends.
//
// APPROVAL. A campaign that was submitted or approved returns to draft when its content changes
// (the database guard does it, and logs it); the page says so before the first such edit.
// Sending, scheduling and the approval itself are enforced by the server, never by this page.

import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, Check, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, Info, 
  LayoutTemplate, Loader2,Lock, Mail, Send, ShieldCheck, Sparkles, Upload, Users, X,
} from 'lucide-react';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { HomiPanel } from '@/components/emailStudio/HomiPanel';
import { domainAuth, EmailPreviewFrame, findingText, PhaseBadge, RiskReport, reasonText, VerdictLine } from '@/components/emailStudio/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Block, type EmailDoc, emptyDoc, normalizeDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { builtInTemplate, TEMPLATE_KINDS, type TemplateKind, templateSubject, unfilledPlaceholders } from '@/emailMarketing/designer/templates';
import { editDropsApproval, emailPhase, isEditable } from '@/emailMarketing/reviewState';
import type { RiskResult } from '@/emailMarketing/risk/engine';
import { cn } from '@/lib/utils';
import {
  type AudienceEstimate, type AudienceFilter, type CampaignPatch, campaignReviews, checkCampaign, estimateAudience, getCampaign, type ListOption,
  listTemplates, myLists, mySenders, type ReviewEntry, type SenderOption, type StudioCampaign, StudioError, saveCampaign, saveTemplate, scheduleCampaign, sendNow, sendTest,
  setCampaignStatus, submitCampaign, type UserTemplate,unscheduleCampaign, 
} from '@/services/emailCampaignStudio';
import { listDomains, type SendingDomain } from '@/services/emailMarketing';

const EmailDesigner = lazy(() => import('@/components/emailStudio/EmailDesigner'));

const STEPS = ['identity', 'recipients', 'sender', 'subject', 'design', 'review'] as const;
type Step = (typeof STEPS)[number];
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const OBJECTIVES = ['announce', 'investors', 'introduce', 'newsletter', 'event', 'followup', 'update'];
/* outreach_contacts.source_kind values (CURATED_LEAD / INTERNAL_MATCH come from the Matching Marketplace). */
const SOURCES = ['IMPORT', 'MANUAL', 'FIND_BUYERS', 'CURATED_LEAD', 'INTERNAL_MATCH'];
const LEAD_TYPES = ['BUYER', 'TENANT', 'INVESTOR', 'SELLER', 'LANDLORD', 'OTHER'];

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

function toPatch(w: Working): CampaignPatch {
  const filter = Object.fromEntries(Object.entries(w.audience_filter).filter(([, v]) => Array.isArray(v) && v.length)) as AudienceFilter;
  return {
    name: w.name, objective: w.objective || null, language: w.language,
    description: w.description || null, audience_note: w.audienceNote || null,
    subject: w.subject || null, preview_text: w.preview_text || null, sender_name: w.sender_name || null,
    sender_email: w.sender_email || null, reply_to: w.reply_to || null, contact_list_ids: w.contact_list_ids,
    audience_filter: Object.keys(filter).length ? filter : null, design: w.design,
  };
}

const storageKey = (id: string | null) => `ems-draft:${id ?? 'new'}`;
const readLocal = (id: string | null): { at: number; w: Working } | null => {
  try { const raw = localStorage.getItem(storageKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const writeLocal = (id: string | null, w: Working) => { try { localStorage.setItem(storageKey(id), JSON.stringify({ at: Date.now(), w })); } catch { /* storage full or blocked */ } };
const clearLocal = (id: string | null) => { try { localStorage.removeItem(storageKey(id)); } catch { /* ignore */ } };

export default function EmailCampaignWorkspacePage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [search, setSearch] = useSearchParams();
  const [campaignId, setCampaignId] = useState<string | null>(params.id && params.id !== 'new' ? params.id : null);
  const [campaign, setCampaign] = useState<StudioCampaign | null>(null);
  /* A new campaign may arrive with a list chosen elsewhere (Matching Marketplace → "create an
     email campaign": /outreach/email?new=1&list=<id> → here with ?list=<id>). */
  const [w, setW] = useState<Working>(() => {
    const b = blank(lang);
    const preset = !params.id || params.id === 'new' ? search.get('list') : null;
    return preset && /^[0-9a-f-]{36}$/i.test(preset) ? { ...b, contact_list_ids: [preset] } : b;
  });
  const [loading, setLoading] = useState(Boolean(campaignId));
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [restore, setRestore] = useState<{ at: number; w: Working } | null>(null);
  const [homiOpen, setHomiOpen] = useState(false);
  const [approvalWarned, setApprovalWarned] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState<null | (() => void)>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);
  /* The id the NEXT save must use — a ref, so two saves in flight before a re-render never create twice. */
  const idRef = useRef<string | null>(campaignId);
  const creating = useRef<Promise<StudioCampaign | null> | null>(null);

  const stepIndex = Math.min(STEPS.length - 1, Math.max(0, Number(search.get('step') ?? '1') - 1));
  const step: Step = STEPS[stepIndex];
  const goStep = (i: number) => { const n = new URLSearchParams(search); n.set('step', String(i + 1)); setSearch(n, { replace: false }); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const phase = emailPhase(campaign?.status ?? 'DRAFT');
  const readOnly = Boolean(campaign) && !isEditable(campaign?.status);

  /* ── load ──────────────────────────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
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
      const saved = await saveCampaign(idRef.current, toPatch(working));
      idRef.current = saved.id;
      return saved;
    })();
    if (wasNew) creating.current = run.catch(() => null);
    try {
      const saved = await run;
      setCampaign(saved);
      if (wasNew) {
        setCampaignId(saved.id);
        clearLocal(null);
        navigate(`/outreach/email/campaigns/${saved.id}?${search.toString()}`, { replace: true });
      }
      clearLocal(saved.id);
      dirtyRef.current = false;
      setSaving('saved');
      return saved;
    } catch (e) {
      setSaving('error');
      const code = e instanceof StudioError ? e.code : 'SAVE_FAILED';
      toast.error(t(`ems_err_${code.toLowerCase()}`) === `ems_err_${code.toLowerCase()}` ? t('ems_err_save_failed') : t(`ems_err_${code.toLowerCase()}`));
      return null;
    }
  }, [navigate, readOnly, search, t]);

  const update = useCallback((patch: Partial<Working>) => {
    if (readOnly) return;
    const apply = () => {
      setW((prev) => {
        const next = { ...prev, ...patch };
        writeLocal(campaignId, next);
        dirtyRef.current = true;
        setSaving('pending');
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => { inflight.current = flush(next); }, 1200);
        return next;
      });
    };
    if (campaign && editDropsApproval(campaign.status) && !approvalWarned) { setConfirmEdit(() => apply); return; }
    apply();
  }, [approvalWarned, campaign, campaignId, flush, readOnly]);

  /* Save before leaving the page; warn while a change is unsaved. */
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const saveNow = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (inflight.current) await inflight.current.catch(() => null);
    return flush(w);
  };

  /* ── side data ─────────────────────────────────────────────────────────────────────────── */
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [senders, setSenders] = useState<SenderOption[] | null>(null);
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  useEffect(() => {
    void myLists().then(setLists).catch(() => setLists([]));
    void mySenders().then(setSenders).catch(() => setSenders([]));
    void listDomains().then(setDomains).catch(() => setDomains([]));
    void listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  useEffect(() => {
    if (!w.contact_list_ids.length) { setEstimate(null); return; }
    setEstimating(true);
    const h = window.setTimeout(() => {
      estimateAudience(w.contact_list_ids, w.audience_filter).then(setEstimate).catch(() => setEstimate(null)).finally(() => setEstimating(false));
    }, 350);
    return () => window.clearTimeout(h);
  }, [w.contact_list_ids, w.audience_filter]);

  /* ── review step state ─────────────────────────────────────────────────────────────────── */
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ risk: RiskResult; problems: string[]; audience: AudienceEstimate | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<ReviewEntry[]>([]);
  const [scheduleAt, setScheduleAt] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  useEffect(() => { if (campaignId && step === 'review') void campaignReviews(campaignId).then(setHistory).catch(() => setHistory([])); }, [campaignId, step, campaign?.status]);

  /* ── HOMI actions ──────────────────────────────────────────────────────────────────────── */
  const applyEdits = (edits: Array<{ id: string; field: 'text' | 'label'; value: string }>) => {
    const map = new Map(edits.map((e) => [e.id, e]));
    const edit = (b: Block): Block => {
      const e = map.get(b.id);
      if (b.type === 'columns') return { ...b, columns: b.columns.map((c) => c.map((x) => edit(x) as typeof x)) as typeof b.columns };
      if (!e) return b;
      return e.field === 'label' ? { ...b, label: e.value } as Block : { ...b, text: e.value } as Block;
    };
    update({ design: normalizeDoc({ ...w.design, blocks: w.design.blocks.map(edit) }) });
  };
  const applyBlocks = (blocks: Block[], mode: 'replace' | 'append') => {
    update({ design: normalizeDoc({ ...w.design, blocks: mode === 'replace' ? blocks : [...w.design.blocks, ...blocks] }) });
    if (step !== 'design') goStep(4);
  };

  const homi = (
    <HomiPanel
      ctx={{ name: w.name, objective: w.objective, subject: w.subject, previewText: w.preview_text, language: w.language, audience: w.audienceNote, design: w.design, findings: lastCheck?.risk.findings }}
      actions={{
        applySubject: (s) => update({ subject: s.slice(0, 200) }), applyPreview: (p) => update({ preview_text: p.slice(0, 200) }),
        applyEdits, applyBlocks, applyIdea: (i) => update({ name: i.name, objective: i.objective }), applyLanguage: (l) => update({ language: l }),
      }}
    />
  );

  const runCheck = async () => {
    const saved = await saveNow();
    const id = saved?.id ?? campaignId;
    if (!id) return;
    setChecking(true);
    try { setLastCheck(await checkCampaign(id)); } catch (e) { toast.error(t('ems_err_check_failed')); void e; } finally { setChecking(false); }
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
    if (!campaignId) return;
    setConfirmSend(false);
    setBusy('send');
    try {
      const r = await sendNow(campaignId);
      toast.success(t('ems_send_started', { n: r.sent ?? 0 }));
      const c = await getCampaign(campaignId); if (c) setCampaign(c);
    } catch (e) {
      const code = e instanceof StudioError ? e.code : 'SEND_FAILED';
      const k = `ems_send_err_${code.toLowerCase()}`;
      toast.error(t(k) === k ? t('ems_send_err_generic') : t(k));
    } finally { setBusy(null); }
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

  /* ── step validity (for the stepper ticks and the review checklist) ───────────────────── */
  const senderOk = !w.sender_email || Boolean(senders?.find((s) => s.address === w.sender_email && s.verified));
  const designText = useMemo(() => renderDesignBody(w.design).text, [w.design]);
  const placeholders = useMemo(() => unfilledPlaceholders([w.subject, w.preview_text, designText].join('\n')), [w.subject, w.preview_text, designText]);
  const hasUnsubscribeBlockOrFooter = true; /* the campaign shell always adds the one-click unsubscribe footer */
  const done: Record<Step, boolean> = {
    identity: Boolean(w.name.trim()),
    recipients: w.contact_list_ids.length > 0 && (estimate?.eligible ?? 0) > 0,
    sender: senderOk,
    subject: Boolean(w.subject.trim()),
    design: w.design.blocks.length > 0 && placeholders.length === 0,
    review: ['APPROVED', 'SCHEDULED', 'SENDING', 'SENT'].includes(phase),
  };

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
          <span className="text-white/85">{campaignId ? (w.name || t('ems_untitled')) : t('ems_new_campaign')}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <h1 className="font-display text-xl font-bold leading-tight [overflow-wrap:break-word] sm:text-2xl">{w.name || t('ems_new_campaign')}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-white/70">
              <PhaseBadge status={campaign?.status ?? 'DRAFT'} className="border-white/20" />
              <SaveIndicator state={saving} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => setHomiOpen(true)}>
              <Sparkles className="h-4 w-4 text-[hsl(38_92%_60%)]" />HOMI
            </Button>
            {!readOnly ? (
              <Button size="sm" className="h-9 gap-1.5 bg-white text-[#0C1119] hover:bg-white/90" onClick={() => void saveNow()} disabled={saving === 'saving'}>
                {saving === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('ems_save_draft')}
              </Button>
            ) : null}
          </div>
        </div>
        {/* Stepper */}
        <ol className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label={t('ems_steps')}>
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => goStep(i)} aria-current={i === stepIndex ? 'step' : undefined}
                className={cn('flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-start text-2xs leading-tight transition-colors',
                  i === stepIndex ? 'bg-white text-[#0C1119]' : 'text-white/75 hover:bg-white/10')}>
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold',
                  done[s] ? 'bg-[hsl(38_92%_54%)] text-[#161309]' : i === stepIndex ? 'bg-[#0C1119] text-white' : 'border border-white/40')}>
                  {done[s] ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(`ems_step_${s}`)}</span>
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
          <Button size="sm" className="h-8" onClick={() => { update(restore.w); setRestore(null); }}>{t('ems_restore_yes')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { clearLocal(campaignId); setRestore(null); }}>{t('ems_restore_no')}</Button>
        </div>
      ) : null}
      {readOnly ? (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-sm"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />{t('ems_read_only')}</div>
      ) : campaign && editDropsApproval(campaign.status) ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{t('ems_edit_drops_approval')}</div>
      ) : null}

      <div className={cn('grid min-w-0 gap-5', step !== 'design' && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="min-w-0 space-y-5">
          {step === 'identity' ? <IdentityStep w={w} update={update} readOnly={readOnly} /> : null}
          {step === 'recipients' ? <RecipientsStep w={w} update={update} lists={lists} estimate={estimate} estimating={estimating} readOnly={readOnly} /> : null}
          {step === 'sender' ? <SenderStep w={w} update={update} senders={senders} domains={domains} readOnly={readOnly} /> : null}
          {step === 'subject' ? <SubjectStep w={w} update={update} readOnly={readOnly} /> : null}
          {step === 'design' ? (
            <DesignStep w={w} update={update} readOnly={readOnly} templates={templates} sections={sections}
              onSaveTemplate={() => void saveAsTemplate()} onSaveSection={(b) => void saveSection(b)} placeholders={placeholders} />
          ) : null}
          {step === 'review' ? (
            <ReviewStep
              w={w} campaign={campaign} done={done} placeholders={placeholders} estimate={estimate} lastCheck={lastCheck} checking={checking}
              busy={busy} history={history} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt}
              onCheck={() => void runCheck()} onSubmit={() => void doSubmit()} onTest={() => void doTest()} onSchedule={() => void doSchedule()}
              onUnschedule={() => void doUnschedule()} onSendNow={() => setConfirmSend(true)} onWithdraw={() => void doWithdraw()} goStep={goStep}
              unsubscribeAlways={hasUnsubscribeBlockOrFooter}
            />
          ) : null}

          {/* Step navigation */}
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <Button variant="outline" className="gap-1.5" disabled={stepIndex === 0} onClick={() => goStep(stepIndex - 1)}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('ems_back')}
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button className="gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={() => goStep(stepIndex + 1)}>
                {t('ems_next')}<ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* HOMI rail on wide screens (not on the design step, which needs the width). */}
        {step !== 'design' ? <aside className="hidden min-w-0 xl:block"><div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">{homi}</div></aside> : null}
      </div>

      <Sheet open={homiOpen} onOpenChange={setHomiOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>HOMI</SheetTitle></SheetHeader>
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

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ems_send_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ems_send_confirm_body', { n: campaign?.audience_count ?? estimate?.eligible ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSendNow()}>{t('ems_send_now')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}

function SaveIndicator({ state }: { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error' }) {
  const { t } = useLanguage();
  if (state === 'idle') return null;
  const map = {
    pending: [CircleDashed, 'ems_save_pending'], saving: [Loader2, 'ems_save_saving'], saved: [CheckCircle2, 'ems_save_saved'], error: [AlertTriangle, 'ems_save_error'],
  } as const;
  const [Icon, key] = map[state];
  return <span className="inline-flex items-center gap-1" role="status"><Icon className={cn('h-3.5 w-3.5', state === 'saving' && 'animate-spin')} aria-hidden="true" />{t(key)}</span>;
}

/* ── steps ─────────────────────────────────────────────────────────────────────────────────── */

type StepProps = { w: Working; update: (p: Partial<Working>) => void; readOnly: boolean };

function Card({ title, sub, children, icon: Icon }: { title: string; sub?: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-[0_1px_0_rgba(12,17,25,0.04)] sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(38_90%_95%)] text-[hsl(32_70%_32%)]"><Icon className="h-[18px] w-[18px]" /></span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          {sub ? <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
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

function IdentityStep({ w, update, readOnly }: StepProps) {
  const { t } = useLanguage();
  return (
    <Card title={t('ems_step_identity')} sub={t('ems_identity_sub')} icon={Mail}>
      <div className="grid gap-4 sm:grid-cols-2">
        <F id="ems-name" label={t('ems_f_name')} hint={t('ems_f_name_hint')} counter={`${w.name.length}/160`}>
          <Input id="ems-name" value={w.name} maxLength={160} disabled={readOnly} onChange={(e) => update({ name: e.target.value })} />
        </F>
        <F id="ems-lang" label={t('ems_f_language')} hint={t('ems_f_language_hint')}>
          <Select value={w.language} disabled={readOnly} onValueChange={(v) => update({ language: v })}>
            <SelectTrigger id="ems-lang"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGS.map((l) => <SelectItem key={l} value={l}>{t(`ems_lang_${l}`)}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F id="ems-obj" label={t('ems_f_objective')}>
          <Select value={OBJECTIVES.includes(w.objective) ? w.objective : w.objective ? '__custom' : ''} disabled={readOnly}
            onValueChange={(v) => update({ objective: v === '__custom' ? (OBJECTIVES.includes(w.objective) ? '' : w.objective) : v })}>
            <SelectTrigger id="ems-obj"><SelectValue placeholder={t('ems_f_objective_pick')} /></SelectTrigger>
            <SelectContent>
              {OBJECTIVES.map((o) => <SelectItem key={o} value={o}>{t(`ems_obj_${o}`)}</SelectItem>)}
              <SelectItem value="__custom">{t('ems_obj_custom')}</SelectItem>
            </SelectContent>
          </Select>
          {w.objective && !OBJECTIVES.includes(w.objective) ? (
            <Input className="mt-2" value={w.objective} maxLength={300} disabled={readOnly} onChange={(e) => update({ objective: e.target.value })} />
          ) : null}
        </F>
        <F id="ems-aud" label={t('ems_f_target')} hint={t('ems_f_target_hint')}>
          <Input id="ems-aud" value={w.audienceNote} maxLength={300} disabled={readOnly} onChange={(e) => update({ audienceNote: e.target.value })} />
        </F>
        <div className="sm:col-span-2">
          <F id="ems-desc" label={t('ems_f_description')} counter={`${w.description.length}/600`}>
            <Textarea id="ems-desc" rows={3} value={w.description} maxLength={600} disabled={readOnly} onChange={(e) => update({ description: e.target.value })} />
          </F>
        </div>
      </div>
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

function RecipientsStep({ w, update, lists, estimate, estimating, readOnly }: StepProps & { lists: ListOption[] | null; estimate: AudienceEstimate | null; estimating: boolean }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [countryText, setCountryText] = useState((w.audience_filter.countries ?? []).join(', '));
  const f = w.audience_filter;
  const setF = (p: Partial<AudienceFilter>) => update({ audience_filter: { ...f, ...p } });
  const toggleList = (id: string) => update({ contact_list_ids: w.contact_list_ids.includes(id) ? w.contact_list_ids.filter((x) => x !== id) : [...w.contact_list_ids, id] });
  return (
    <>
      <Card title={t('ems_step_recipients')} sub={t('ems_recipients_sub')} icon={Users}>
        {lists === null ? <Skeleton className="h-32 w-full" /> : lists.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="font-medium">{t('ems_no_lists')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('ems_no_lists_body')}</p>
            <Button className="mt-3 gap-1.5" onClick={() => navigate('/outreach/email/contacts/import')}><Upload className="h-4 w-4" />{t('ems_import_contacts')}</Button>
          </div>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border p-1.5">
            {lists.map((l) => (
              <label key={l.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/60', w.contact_list_ids.includes(l.id) && 'bg-[hsl(38_90%_97%)]')}>
                <Checkbox checked={w.contact_list_ids.includes(l.id)} disabled={readOnly} onCheckedChange={() => toggleList(l.id)} />
                <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{l.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t('ems_list_rows', { n: l.valid_rows ?? l.total_rows ?? 0 })}</span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/outreach/email/contacts/import')}><Upload className="h-3.5 w-3.5" />{t('ems_import_contacts')}</Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/email-studio')}><ExternalLink className="h-3.5 w-3.5" />{t('ems_internal_matches_link')}</Button>
        </div>
      </Card>

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

      <section className="rounded-2xl border bg-[#0C1119] p-4 text-white sm:p-5" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t('ems_estimate_title')}</p>
          {estimating ? <Loader2 className="h-4 w-4 animate-spin text-white/60" aria-hidden="true" /> : null}
        </div>
        {estimate ? (
          <>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums text-[hsl(38_92%_60%)]">{estimate.eligible.toLocaleString()}</p>
            <p className="text-[13px] text-white/75">{t('ems_estimate_eligible')}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-4">
              <div><dt className="text-white/55">{t('ems_estimate_matched')}</dt><dd className="tabular-nums">{estimate.matched}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_unknown')}</dt><dd className="tabular-nums">{estimate.consentUnknown}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_dupes')}</dt><dd className="tabular-nums">{estimate.duplicates}</dd></div>
              <div><dt className="text-white/55">{t('ems_estimate_suppressed')}</dt><dd className="tabular-nums">{estimate.suppressed}</dd></div>
            </dl>
            {estimate.consentUnknown > 0 ? <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-white/10 p-2.5 text-2xs text-white/85"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />{t('ems_consent_note')}</p> : null}
          </>
        ) : <p className="mt-2 text-sm text-white/70">{t('ems_estimate_pick')}</p>}
      </section>
    </>
  );
}

function SenderStep({ w, update, senders, domains, readOnly }: StepProps & { senders: SenderOption[] | null; domains: SendingDomain[] }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const current = senders?.find((s) => (s.address ?? '') === (w.sender_email ?? '')) ?? senders?.[0];
  const domain = domains.find((d) => d.domain === current?.domain);
  const auth = current && !current.custom ? { spf: 'OK', dkim: 'OK', dmarc: 'OK' } : domain ? domainAuth(domain) : { spf: 'MISSING', dkim: 'MISSING', dmarc: 'MISSING' };
  return (
    <Card title={t('ems_step_sender')} sub={t('ems_sender_sub')} icon={BadgeCheck}>
      {senders === null ? <Skeleton className="h-24 w-full" /> : (
        <div className="space-y-4">
          <div className="grid gap-2">
            {senders.map((s) => {
              const val = s.address ?? '';
              const on = (w.sender_email ?? '') === val;
              return (
                <button key={val || 'homatch'} type="button" disabled={readOnly || !s.verified} onClick={() => update({ sender_email: val })} aria-pressed={on}
                  className={cn('flex items-center gap-3 rounded-xl border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60', on ? 'border-[#0C1119] ring-1 ring-[#0C1119]' : 'hover:border-foreground/40')}>
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on && 'border-[#0C1119] bg-[#0C1119]')}>{on ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]" dir="ltr">{s.custom ? s.address ?? s.domain : t('ems_sender_homatch')}</span>
                    <span className="block text-2xs text-muted-foreground">{s.custom ? s.domain : t('ems_sender_homatch_note')}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold', s.verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900')}>
                    {s.verified ? t('ems_verified') : t('ems_not_verified')}
                  </span>
                </button>
              );
            })}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/outreach/email/domains')}><ExternalLink className="h-3.5 w-3.5" />{t('ems_manage_domains')}</Button>
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
        </div>
      )}
    </Card>
  );
}

function SubjectStep({ w, update, readOnly }: StepProps) {
  const { t } = useLanguage();
  return (
    <Card title={t('ems_step_subject')} sub={t('ems_subject_sub')} icon={Mail}>
      <div className="space-y-4">
        <F id="ems-subj" label={t('ems_f_subject')} hint={t('ems_f_subject_hint')} counter={`${w.subject.length}/200`}>
          <Input id="ems-subj" value={w.subject} maxLength={200} disabled={readOnly} onChange={(e) => update({ subject: e.target.value })} />
        </F>
        <F id="ems-prev" label={t('ems_f_preview')} hint={t('ems_f_preview_hint')} counter={`${w.preview_text.length}/200`}>
          <Input id="ems-prev" value={w.preview_text} maxLength={200} disabled={readOnly} onChange={(e) => update({ preview_text: e.target.value })} />
        </F>
        <div className="rounded-xl border bg-[#F6F3EE] p-3">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_inbox_preview')}</p>
          <div className="rounded-lg bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">{w.sender_name || 'HOMATCH'}</p>
            <p className="text-sm [overflow-wrap:anywhere]">{w.subject || t('ems_subject_placeholder')}</p>
            <p className="truncate text-[13px] text-muted-foreground">{w.preview_text || t('ems_preview_placeholder')}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DesignStep({ w, update, readOnly, templates, sections, onSaveTemplate, onSaveSection, placeholders }: StepProps & {
  templates: UserTemplate[]; sections: Array<{ id: string; name: string; block: Block }>; onSaveTemplate: () => void; onSaveSection: (b: Block) => void; placeholders: string[];
}) {
  const { t } = useLanguage();
  const [picker, setPicker] = useState(w.design.blocks.length === 0);
  const rtl = w.language === 'ar' || w.language === 'he';
  const pick = (doc: EmailDoc, subject?: string | null, preview?: string | null) => {
    update({ design: normalizeDoc(doc), ...(subject && !w.subject ? { subject } : {}), ...(preview && !w.preview_text ? { preview_text: preview } : {}) });
    setPicker(false);
  };
  if (readOnly) {
    const body = renderDesignBody(w.design, { rtl });
    return <EmailPreviewFrame subject={w.subject} html={w.design.blocks.length ? body.html : null} text={body.text} senderName={w.sender_name} language={w.language} previewText={w.preview_text} />;
  }
  if (picker) {
    const mine = templates.filter((x) => x.kind !== 'SECTION');
    return (
      <Card title={t('ems_pick_start')} sub={t('ems_pick_start_sub')} icon={LayoutTemplate}>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <button type="button" onClick={() => pick(emptyDoc())} className="flex min-h-[6.5rem] flex-col justify-between rounded-xl border border-dashed p-3 text-start hover:border-foreground/40">
            <span className="text-sm font-semibold">{t('ems_tpl_blank')}</span><span className="text-2xs text-muted-foreground">{t('ems_tpl_blank_sub')}</span>
          </button>
          {TEMPLATE_KINDS.map((k: TemplateKind) => (
            <button key={k} type="button" onClick={() => pick(builtInTemplate(k, w.language), templateSubject(k, w.language))}
              className="flex min-h-[6.5rem] flex-col justify-between rounded-xl border bg-card p-3 text-start transition-colors hover:border-[hsl(38_70%_60%)] hover:bg-[hsl(38_90%_98%)]">
              <span className="text-sm font-semibold">{t(`ems_tpl_${k.toLowerCase()}`)}</span>
              <span className="text-2xs leading-snug text-muted-foreground">{t(`ems_tpl_${k.toLowerCase()}_sub`)}</span>
            </button>
          ))}
          {mine.map((x) => (
            <button key={x.id} type="button" onClick={() => pick(x.design, x.subject, x.preview_text)}
              className="flex min-h-[6.5rem] flex-col justify-between rounded-xl border bg-card p-3 text-start hover:border-foreground/40">
              <span className="text-sm font-semibold [overflow-wrap:anywhere]">{x.name}</span><span className="text-2xs text-muted-foreground">{t('ems_tpl_mine')}</span>
            </button>
          ))}
        </div>
        {w.design.blocks.length ? <Button variant="ghost" className="mt-3" onClick={() => setPicker(false)}>{t('ems_cancel')}</Button> : null}
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPicker(true)}><LayoutTemplate className="h-3.5 w-3.5" />{t('ems_change_template')}</Button>
        {placeholders.length ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-2xs text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />{t('ems_placeholders_left', { n: placeholders.length })}</span>
        ) : null}
      </div>
      <Suspense fallback={<Skeleton className="h-[32rem] w-full rounded-2xl" />}>
        <EmailDesigner value={w.design} onChange={(doc) => update({ design: doc })} rtl={rtl} subject={w.subject} previewText={w.preview_text}
          senderName={w.sender_name} language={w.language} sections={sections} onSaveSection={onSaveSection} onSaveTemplate={onSaveTemplate} />
      </Suspense>
    </div>
  );
}

function ReviewStep(p: {
  w: Working; campaign: StudioCampaign | null; done: Record<Step, boolean>; placeholders: string[]; estimate: AudienceEstimate | null;
  lastCheck: { risk: RiskResult; problems: string[]; audience: AudienceEstimate | null } | null; checking: boolean; busy: string | null; history: ReviewEntry[];
  scheduleAt: string; setScheduleAt: (v: string) => void; onCheck: () => void; onSubmit: () => void; onTest: () => void; onSchedule: () => void;
  onUnschedule: () => void; onSendNow: () => void; onWithdraw: () => void; goStep: (i: number) => void; unsubscribeAlways: boolean;
}) {
  const { t, lang } = useLanguage();
  const phase = emailPhase(p.campaign?.status ?? 'DRAFT');
  const rtl = p.w.language === 'ar' || p.w.language === 'he';
  const body = useMemo(() => renderDesignBody(p.w.design, { rtl }), [p.w.design, rtl]);
  const checks: Array<{ ok: boolean; key: string; step?: number; vars?: Record<string, string | number> }> = [
    { ok: p.done.identity, key: 'ems_chk_identity', step: 0 },
    { ok: p.done.recipients, key: 'ems_chk_recipients', step: 1, vars: { n: p.estimate?.eligible ?? 0 } },
    { ok: p.done.sender, key: 'ems_chk_sender', step: 2 },
    { ok: p.done.subject, key: 'ems_chk_subject', step: 3 },
    { ok: p.w.design.blocks.length > 0, key: 'ems_chk_design', step: 4 },
    { ok: p.placeholders.length === 0, key: 'ems_chk_placeholders', step: 4, vars: { list: p.placeholders.slice(0, 3).join(', ') } },
    { ok: p.unsubscribeAlways, key: 'ems_chk_unsubscribe' },
    { ok: Boolean(p.lastCheck) && p.lastCheck!.risk.verdict !== 'BLOCK', key: 'ems_chk_risk' },
  ];
  const canSubmit = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(phase) && checks.slice(0, 6).every((c) => c.ok);
  return (
    <>
      <Card title={t('ems_step_review')} sub={t('ems_review_sub')} icon={ShieldCheck}>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.key} className="flex items-center gap-2.5 text-sm">
              {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <X className="h-4 w-4 shrink-0 text-red-600" />}
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(c.key, c.vars)}</span>
              {!c.ok && c.step != null ? <button type="button" className="shrink-0 text-2xs font-medium underline-offset-2 hover:underline" onClick={() => p.goStep(c.step!)}>{t('ems_fix')}</button> : null}
            </li>
          ))}
        </ul>
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
              <Button className="gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={p.onSendNow} disabled={p.busy === 'send'}>
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

      <EmailPreviewFrame subject={p.w.subject || p.w.name} html={p.w.design.blocks.length ? body.html : null} text={body.text} senderName={p.w.sender_name} language={p.w.language} previewText={p.w.preview_text} />

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
