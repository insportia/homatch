// EMAIL STUDIO — /outreach/email/studio and /outreach/email/studio/:docId
//
// Choose a property or template → choose recipients → generate or design →
// preview → confirm → send. Every step is editable by hand; AI is available at
// every step and only ever proposes (Accept / Discard). Drafts save themselves
// to email_studio_documents; templates are saved designs anyone on the account
// can start from. Sending goes through the existing outreach pipeline
// (eligible contacts only, unsubscribe footer, suppression, per-contact claim,
// delivery webhooks) and only after an explicit confirmation.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookmarkPlus, Building2, Check, CheckCircle2, FileText,
  Layers, Loader2, Mail, Palette, RefreshCw, Save, Send, Sparkles, Trash2, Users, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { ContactPicker } from '@/components/communication/ContactPicker';
import { aiErrorKey } from '@/components/communication/MessageAssistDialog';
import { BlockCanvas } from '@/components/communication/emailStudio/BlockCanvas';
import { BlockInspector } from '@/components/communication/emailStudio/BlockInspector';
import { type Device, EmailPreview } from '@/components/communication/emailStudio/EmailPreview';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type Block, type BlockType, type EmailDesign, THEMES, designProblems, emptyDesign, makeBlock, newId, sanitizeDesign,
} from '@/communication/emailDesign';
import { placeName } from '@/lib/placeNames';
import { type LibraryContact, channelsOf, listLibraryContacts } from '@/services/contactLibrary';
import {
  type DraftEmail, type SendOutcome, type StudioDocument, type StudioPhoto,
  campaignDelivery, deleteDocument, getDocument, listDocuments, listPublicPhotos, saveDocument, sendDocument,
  studioAi, suggestPhotos,
} from '@/services/communicationStudio';
import { listPortfolio, readProperty } from '@/services/propertyManagement';
import type { Property, PropertyFacts } from '@/types/types';

type Step = 'start' | 'recipients' | 'design' | 'review';
const STEPS: Step[] = ['start', 'recipients', 'design', 'review'];
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
const BLOCKED_KEY: Record<string, string> = {
  EMAIL_SENDING_NOT_ENABLED: 'email_blocked_not_enabled',
  PROVIDER_KILL_SWITCH_ACTIVE: 'email_blocked_kill_switch',
  CAMPAIGN_IS_LEGACY_MOCK: 'email_legacy_mock_note',
  GLOBAL_SPEND_CAP: 'email_blocked_spend_cap',
  PROVIDER_SPEND_CAP: 'email_blocked_spend_cap',
};

function factsOf(p: Property | null): PropertyFacts | null {
  const embedded = p?.facts as PropertyFacts | PropertyFacts[] | undefined;
  return (Array.isArray(embedded) ? embedded[0] : embedded) ?? null;
}

export default function EmailStudioPage() {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { docId } = useParams<{ docId?: string }>();
  const handoff = (location.state ?? null) as { recipients?: string[]; body?: string; propertyId?: string | null } | null;

  const [step, setStep] = useState<Step>('start');
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [language, setLanguage] = useState<string>(LANGS.includes(lang as never) ? lang : 'en');
  const [propertyId, setPropertyId] = useState<string | null>(handoff?.propertyId ?? null);
  const [design, setDesign] = useState<EmailDesign>(emptyDesign());
  const [recipientKeys, setRecipientKeys] = useState<Set<string>>(new Set(handoff?.recipients ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [panel, setPanel] = useState<'edit' | 'preview'>('edit');

  const [properties, setProperties] = useState<Property[]>([]);
  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [contacts, setContacts] = useState<LibraryContact[] | null>(null);
  const [saved, setSaved] = useState<StudioDocument[]>([]);

  const [instruction, setInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DraftEmail | null>(null);
  const [variants, setVariants] = useState<DraftEmail[] | null>(null);
  const [subjectIdeas, setSubjectIdeas] = useState<string[]>([]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [delivery, setDelivery] = useState<Awaited<ReturnType<typeof campaignDelivery>>>(null);
  const loadedDoc = useRef<string | null>(null);

  const dir: 'ltr' | 'rtl' = language === 'ar' || language === 'he' ? 'rtl' : 'ltr';
  const touch = useCallback(() => setDirty(true), []);

  /* ── loading ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!homatchUser) return;
    listPortfolio({ userId: homatchUser.id, limit: 100 }).then(setProperties).catch(() => setProperties([]));
  }, [homatchUser]);
  useEffect(() => { listLibraryContacts().then(setContacts).catch(() => setContacts([])); }, []);
  useEffect(() => { listDocuments().then(setSaved).catch(() => setSaved([])); }, [savedAt]);
  useEffect(() => {
    if (!propertyId) { setProperty(null); setPhotos([]); return; }
    readProperty(propertyId).then(setProperty).catch(() => setProperty(null));
    listPublicPhotos(propertyId).then(setPhotos).catch(() => setPhotos([]));
  }, [propertyId]);

  const applyDoc = useCallback((d: StudioDocument, asNew: boolean) => {
    setDoc(asNew ? null : d);
    setName(asNew ? `${d.name}` : d.name);
    setSubject(d.subject);
    setPreheader(d.preheader);
    setLanguage(d.language);
    setPropertyId(d.property_id);
    setDesign(sanitizeDesign(d.design));
    if (!asNew) setRecipientKeys(new Set(d.recipients));
    setSelectedId(null);
    setOutcome(null);
  }, []);

  useEffect(() => {
    if (!docId || loadedDoc.current === docId) return;
    loadedDoc.current = docId;
    getDocument(docId).then((d) => {
      if (!d) { toast.error(t('es_doc_missing')); navigate('/outreach/email/studio', { replace: true }); return; }
      applyDoc(d, false);
      setStep(d.outreach_campaign_id ? 'review' : 'design');
    });
  }, [docId, applyDoc, navigate, t]);

  /* A message drafted in the assistant arrives as the first paragraph. */
  useEffect(() => {
    if (!handoff?.body || docId) return;
    setDesign((d) => (d.blocks.length ? d : { ...d, blocks: [{ ...makeBlock('text'), html: handoff.body!.replace(/\n/g, '<br>') } as Block] }));
  }, [handoff, docId]);

  /* ── autosave (drafts only; a sent document is history) ───────────────── */
  const save = useCallback(async (kind: 'DRAFT' | 'TEMPLATE' = 'DRAFT', explicit = false) => {
    if (doc?.outreach_campaign_id && kind === 'DRAFT') return doc;
    setSaving(true);
    try {
      const next = await saveDocument({
        id: kind === 'TEMPLATE' ? null : doc?.id ?? null,
        kind,
        name: name || subject || t('es_untitled'),
        subject, preheader, language, property_id: propertyId, design,
        recipients: kind === 'TEMPLATE' ? [] : [...recipientKeys],
      });
      if (kind === 'DRAFT') {
        setDoc(next);
        setDirty(false);
        if (docId !== next.id) { loadedDoc.current = next.id; navigate(`/outreach/email/studio/${next.id}`, { replace: true }); }
      }
      setSavedAt(new Date());
      if (explicit) toast.success(t(kind === 'TEMPLATE' ? 'es_template_saved' : 'es_draft_saved'));
      return next;
    } catch {
      toast.error(t('es_save_failed'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [doc, name, subject, preheader, language, propertyId, design, recipientKeys, docId, navigate, t]);

  useEffect(() => {
    if (!dirty || step === 'start') return undefined;
    const id = window.setTimeout(() => { void save('DRAFT'); }, 1500);
    return () => window.clearTimeout(id);
  }, [dirty, step, save]);

  /* ── design editing ──────────────────────────────────────────────────── */
  const setBlocks = (fn: (b: Block[]) => Block[]) => { setDesign((d) => ({ ...d, blocks: fn(d.blocks) })); touch(); };
  const updateBlock = (next: Block) => setBlocks((bs) => bs.map((b) => (b.id === next.id ? next : b)));
  const addBlock = (type: BlockType) => {
    const b = makeBlock(type);
    if (type === 'image' && photos[0]) (b as Extract<Block, { type: 'image' }>).src = suggestPhotos(photos, 1)[0].url;
    setBlocks((bs) => {
      const at = selectedId ? bs.findIndex((x) => x.id === selectedId) + 1 : bs.length;
      return [...bs.slice(0, at), b, ...bs.slice(at)];
    });
    setSelectedId(b.id);
  };
  const moveBlock = (id: string, delta: -1 | 1) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id); const j = i + delta;
    if (i < 0 || j < 0 || j >= bs.length) return bs;
    const next = [...bs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const reorder = (from: number, to: number) => setBlocks((bs) => { const next = [...bs]; const [m] = next.splice(from, 1); next.splice(to, 0, m); return next; });
  const duplicate = (id: string) => setBlocks((bs) => { const i = bs.findIndex((b) => b.id === id); if (i < 0) return bs; const copy = { ...bs[i], id: newId() } as Block; return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)]; });
  const remove = (id: string) => { setBlocks((bs) => bs.filter((b) => b.id !== id)); if (selectedId === id) setSelectedId(null); };
  const selected = design.blocks.find((b) => b.id === selectedId) ?? null;

  /* Real facts of the chosen property, in the reader's language. */
  const facts = factsOf(property);
  const propertyFacts = useMemo(() => {
    if (!facts) return [];
    const loc = intlLocaleFor(language as never);
    const out: Array<{ label: string; value: string }> = [];
    if (facts.total_price) out.push({ label: t('es_fact_price'), value: formatMoney(Number(facts.total_price), facts.currency ?? 'USD', loc, { decimals: 0, narrowSymbol: true }) });
    if (facts.area) out.push({ label: t('es_fact_area'), value: `${facts.area} m²` });
    if (facts.rooms) out.push({ label: t('es_fact_rooms'), value: String(facts.rooms) });
    if (facts.bedrooms) out.push({ label: t('es_fact_bedrooms'), value: String(facts.bedrooms) });
    if (facts.floor != null && (facts as { total_floors?: number | null }).total_floors) out.push({ label: t('es_fact_floor'), value: `${facts.floor}/${(facts as { total_floors?: number }).total_floors}` });
    const where = [placeName(facts.district, language as never), placeName(facts.city, language as never)].filter(Boolean).join(', ');
    if (where) out.push({ label: t('es_fact_location'), value: where });
    return out;
  }, [facts, language, t]);

  const starter = (kind: 'showcase' | 'blank') => {
    const blocks: Block[] = [];
    if (kind === 'showcase') {
      blocks.push({ ...makeBlock('header'), tagline: '' } as Block);
      const hero = suggestPhotos(photos, 1)[0];
      if (hero) blocks.push({ ...makeBlock('image'), src: hero.url, alt: property?.title ?? '' } as Block);
      blocks.push({ ...makeBlock('heading'), text: property?.title ?? '' } as Block);
      blocks.push({ ...makeBlock('text'), html: t('es_starter_intro') } as Block);
      if (propertyFacts.length) blocks.push({ ...makeBlock('facts'), items: propertyFacts } as Block);
      const more = suggestPhotos(photos, 4).slice(1, 4);
      if (more.length >= 2) blocks.push({ ...makeBlock('gallery'), images: more.map((p) => ({ src: p.url, alt: '' })) } as Block);
      blocks.push(makeBlock('divider'));
      blocks.push({ ...makeBlock('footer'), text: t('es_starter_footer') } as Block);
    }
    setDesign({ version: 1, theme: { ...THEMES.gold }, blocks });
    setSelectedId(null);
    touch();
  };

  /* ── AI ──────────────────────────────────────────────────────────────── */
  const runAi = async (label: string, fn: () => Promise<void>) => {
    setAiBusy(label);
    try { await fn(); } catch (e) { toast.error(t(aiErrorKey(e))); } finally { setAiBusy(null); }
  };
  const compose = () => runAi('compose', async () => {
    setProposal(await studioAi.composeEmail({ instruction, language, propertyId, design: design.blocks.length ? design : null }));
  });
  const makeVariants = () => runAi('variants', async () => {
    setVariants(await studioAi.variations({ instruction, language, propertyId }));
  });
  const acceptDraft = (d: DraftEmail) => {
    setDesign(d.design);
    if (d.subject) setSubject(d.subject);
    if (d.preheader) setPreheader(d.preheader);
    setProposal(null);
    setVariants(null);
    setSelectedId(null);
    touch();
  };

  /* ── recipients & send ───────────────────────────────────────────────── */
  const chosen = (contacts ?? []).filter((c) => recipientKeys.has(c.key));
  const sendable = chosen.filter((c) => channelsOf(c).includes('EMAIL') && c.outreachContactId);
  const problems = designProblems(design, subject);
  const alreadySent = Boolean(doc?.outreach_campaign_id);
  const sampleName = sendable[0]?.name ?? null;

  const doSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    try {
      const current = (dirty || !doc) ? await save('DRAFT') : doc;
      if (!current) return;
      const res = await sendDocument(current, { contactIds: sendable.map((c) => c.outreachContactId!), dir });
      setOutcome(res);
      if (res.kind !== 'nobody' && res.campaignId) {
        setDoc({ ...current, outreach_campaign_id: res.campaignId });
        setDelivery(await campaignDelivery(res.campaignId));
      }
    } catch {
      toast.error(t('es_send_failed'));
    } finally {
      setSending(false);
    }
  };
  const refreshDelivery = async () => { if (doc?.outreach_campaign_id) setDelivery(await campaignDelivery(doc.outreach_campaign_id)); };
  useEffect(() => { if (step === 'review' && doc?.outreach_campaign_id) void refreshDelivery(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [step, doc?.outreach_campaign_id]);

  const duplicateAsNew = () => {
    if (!doc) return;
    const copy = { ...doc };
    setDoc(null);
    loadedDoc.current = null;
    applyDoc({ ...copy, outreach_campaign_id: null }, true);
    setName(`${copy.name} (2)`);
    setOutcome(null);
    setDelivery(null);
    navigate('/outreach/email/studio', { replace: true });
    setStep('design');
    touch();
  };

  const stepIndex = STEPS.indexOf(step);
  const canNext = step === 'start' ? true : step === 'recipients' ? sendable.length > 0 : step === 'design' ? problems.length === 0 : false;
  const field = 'h-10 w-full min-w-0 rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring';
  const pill = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-2xs font-semibold ring-1 ring-inset ring-border hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <CommsWorkspace
      product="email"
      header={(
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Wand2 className="h-5 w-5 text-gold-ink" aria-hidden="true" />{t('es_title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('es_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span aria-live="polite">{saving ? t('es_saving') : savedAt ? t('es_saved_at', { time: savedAt.toLocaleTimeString(lang, { timeStyle: 'short' }) }) : dirty ? t('es_unsaved') : null}</span>
            {step !== 'start' && !alreadySent && (
              <>
                <button type="button" className={pill} onClick={() => void save('DRAFT', true)} disabled={saving}><Save className="h-3.5 w-3.5" aria-hidden="true" />{t('es_save_draft')}</button>
                <button type="button" className={pill} onClick={() => void save('TEMPLATE', true)} disabled={saving || !design.blocks.length}><BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />{t('es_save_template')}</button>
              </>
            )}
          </div>
        </div>
      )}
    >
      <div className="space-y-5 pb-24">
        {/* ── the steps ── */}
        <ol className="grid grid-cols-4 gap-1.5" aria-label={t('es_steps')}>
          {STEPS.map((s, i) => {
            const reachable = i <= stepIndex || (i === stepIndex + 1 && canNext);
            return (
              <li key={s} className="min-w-0">
                <button type="button" disabled={!reachable || alreadySent} onClick={() => setStep(s)} aria-current={s === step ? 'step' : undefined}
                  className={cn('flex w-full min-w-0 flex-col items-start gap-1 rounded-xl p-2.5 text-start ring-1 ring-inset transition-colors disabled:cursor-not-allowed',
                    s === step ? 'bg-[hsl(218_52%_11%)] text-white ring-transparent' : i < stepIndex ? 'bg-[hsl(42_100%_96%)] ring-[hsl(40_80%_78%)]' : 'ring-border')}>
                  <span className={cn('grid h-6 w-6 place-items-center rounded-full text-2xs font-bold', s === step ? 'bg-[hsl(40_94%_60%)] text-[hsl(218_52%_11%)]' : i < stepIndex ? 'bg-[hsl(38_92%_50%)] text-white' : 'bg-muted')}>
                    {i < stepIndex ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
                  </span>
                  <span className="w-full truncate text-2xs font-semibold sm:text-sm">{t(`es_step_${s}`)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* ── 1. START ── */}
        {step === 'start' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="es-start">
              <h2 id="es-start" className="text-base font-semibold">{t('es_start_title')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="mb-1 block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{t('es_name')}</span>
                  <input className={field} value={name} maxLength={200} onChange={(e) => { setName(e.target.value); touch(); }} placeholder={t('es_untitled')} dir="auto" /></label>
                <label className="block"><span className="mb-1 flex items-center gap-1 text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />{t('es_property')}</span>
                  <select className={field} value={propertyId ?? ''} onChange={(e) => { setPropertyId(e.target.value || null); touch(); }}>
                    <option value="">{t('es_no_property')}</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.title || t('matches_rail_untitled')}</option>)}
                  </select></label>
                <label className="block"><span className="mb-1 block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{t('es_language')}</span>
                  <select className={field} value={language} onChange={(e) => { setLanguage(e.target.value); touch(); }}>
                    {LANGS.map((l) => <option key={l} value={l}>{t(`fbx_lang_${l}`)}</option>)}
                  </select></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={!propertyId} onClick={() => { starter('showcase'); setStep(recipientKeys.size ? 'design' : 'recipients'); }}
                  className="flex min-h-20 min-w-0 items-start gap-3 rounded-xl p-3 text-start ring-1 ring-inset ring-border hover:bg-muted/50 disabled:opacity-50">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(34_90%_40%)]" aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-sm font-semibold">{t('es_from_property')}</span><span className="block text-2xs text-muted-foreground">{t(propertyId ? 'es_from_property_note' : 'es_pick_property_first')}</span></span>
                </button>
                <button type="button" onClick={() => { starter('blank'); setStep(recipientKeys.size ? 'design' : 'recipients'); }}
                  className="flex min-h-20 min-w-0 items-start gap-3 rounded-xl p-3 text-start ring-1 ring-inset ring-border hover:bg-muted/50">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-sm font-semibold">{t('es_blank')}</span><span className="block text-2xs text-muted-foreground">{t('es_blank_note')}</span></span>
                </button>
                <button type="button" onClick={() => setStep('recipients')}
                  className="flex min-h-20 min-w-0 items-start gap-3 rounded-xl p-3 text-start ring-1 ring-inset ring-border hover:bg-muted/50 sm:col-span-2">
                  <Users className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-sm font-semibold">{t('es_from_contacts')}</span><span className="block text-2xs text-muted-foreground">{t('es_from_contacts_note', { n: String(recipientKeys.size) })}</span></span>
                </button>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="es-saved">
              <h2 id="es-saved" className="flex items-center gap-2 text-base font-semibold"><Layers className="h-4 w-4" aria-hidden="true" />{t('es_saved_title')}</h2>
              {saved.length === 0 ? <p className="text-sm text-muted-foreground">{t('es_saved_empty')}</p> : (
                <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-inset ring-border">
                  {saved.map((d) => (
                    <li key={d.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold uppercase', d.kind === 'TEMPLATE' ? 'bg-[hsl(42_100%_92%)] text-[hsl(34_90%_30%)]' : d.outreach_campaign_id ? 'bg-[hsl(158_45%_90%)] text-[hsl(158_64%_24%)]' : 'bg-muted')}>
                        {t(d.kind === 'TEMPLATE' ? 'es_kind_template' : d.outreach_campaign_id ? 'es_kind_sent' : 'es_kind_draft')}
                      </span>
                      <button type="button" className="min-w-0 flex-1 truncate text-start text-sm font-medium hover:underline" dir="auto"
                        onClick={() => {
                          if (d.kind === 'TEMPLATE') { applyDoc(d, true); setName(''); setStep(recipientKeys.size ? 'design' : 'recipients'); touch(); }
                          else navigate(`/outreach/email/studio/${d.id}`);
                        }}>{d.name || d.subject || t('es_untitled')}</button>
                      <button type="button" aria-label={t('es_delete_doc')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-muted"
                        onClick={async () => { try { await deleteDocument(d.id); setSaved((all) => all.filter((x) => x.id !== d.id)); } catch { toast.error(t('es_save_failed')); } }}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ── 2. RECIPIENTS ── */}
        {step === 'recipients' && (
          <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="es-to">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h2 id="es-to" className="text-base font-semibold">{t('es_recipients_title')}</h2>
                <p className="text-2xs text-muted-foreground">{t('es_recipients_note')}</p>
              </div>
              <Link to="/outreach/library" className="text-2xs font-semibold text-[hsl(34_90%_36%)] hover:underline">{t('cl_title')}</Link>
            </div>
            {contacts === null ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : (
              <ContactPicker contacts={contacts} selected={recipientKeys} onChange={(s) => { setRecipientKeys(s); touch(); }} requireChannel="EMAIL" compact
                initialFilter={propertyId ? { propertyId: 'ALL' } : undefined} />
            )}
            {contacts && !contacts.some((c) => channelsOf(c).includes('EMAIL')) && (
              <p className="rounded-xl bg-muted/50 p-3 text-2xs text-muted-foreground">{t('es_no_email_contacts')} <Link className="font-semibold underline" to="/outreach/email/contacts/import">{t('es_import_contacts')}</Link></p>
            )}
          </section>
        )}

        {/* ── 3. DESIGN ── */}
        {step === 'design' && (
          <div className="space-y-4">
            {/* AI brief */}
            <section className="space-y-2.5 rounded-2xl bg-[linear-gradient(135deg,hsl(218_52%_11%),hsl(222_46%_20%))] p-4 text-white sm:p-5" aria-labelledby="es-ai">
              <h2 id="es-ai" className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-[hsl(40_94%_64%)]" aria-hidden="true" />{t('es_ai_title')}</h2>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} dir="auto" placeholder={t('es_ai_placeholder')}
                className="w-full rounded-xl bg-white/10 p-3 text-sm text-white placeholder:text-white/50 ring-1 ring-inset ring-white/20 focus:outline-none focus:ring-2 focus:ring-[hsl(40_94%_64%)]" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void compose()} disabled={aiBusy !== null}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(40_94%_60%)] px-4 text-sm font-semibold text-[hsl(218_52%_11%)] disabled:opacity-60">
                  {aiBusy === 'compose' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}{t(design.blocks.length ? 'es_ai_redo' : 'es_ai_generate')}
                </button>
                <button type="button" onClick={() => void makeVariants()} disabled={aiBusy !== null}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold ring-1 ring-inset ring-white/25 disabled:opacity-60">
                  {aiBusy === 'variants' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Layers className="h-4 w-4" aria-hidden="true" />}{t('es_ai_variations')}
                </button>
              </div>
              <p className="text-2xs text-white/70">{t(propertyId ? 'es_ai_grounded' : 'es_ai_no_property')}</p>
            </section>

            {(proposal || variants) && (
              <section className="space-y-3 rounded-2xl border-2 border-[hsl(38_92%_50%)] bg-card p-4" aria-label={t('es_ai_suggestion')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{t(variants ? 'es_ai_pick_variant' : 'es_ai_review_draft')}</h2>
                  <button type="button" className={pill} onClick={() => { setProposal(null); setVariants(null); }}>{t('es_discard')}</button>
                </div>
                <div className={cn('grid gap-3', variants && 'md:grid-cols-3')}>
                  {(variants ?? (proposal ? [proposal] : [])).map((v, i) => (
                    <div key={i} className="min-w-0 space-y-2">
                      <EmailPreview design={v.design} subject={v.subject} preheader={v.preheader} dir={dir} lang={language} device={variants ? 'mobile' : device} onDevice={setDevice} sampleName={sampleName} />
                      <button type="button" onClick={() => acceptDraft(v)}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] text-sm font-semibold text-[hsl(40_94%_64%)]">
                        <Check className="h-4 w-4" aria-hidden="true" />{t(variants ? 'es_use_this' : 'es_accept')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* subject + preheader */}
            <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2" aria-label={t('es_envelope')}>
              <label className="block sm:col-span-2"><span className="mb-1 block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{t('es_subject')}</span>
                <div className="flex gap-2">
                  <input className={field} dir="auto" value={subject} maxLength={300} onChange={(e) => { setSubject(e.target.value); touch(); }} />
                  <button type="button" className={pill} disabled={aiBusy !== null} onClick={() => void runAi('subjects', async () => setSubjectIdeas(await studioAi.subjects({ subject, design, language, propertyId })))}>
                    {aiBusy === 'subjects' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}<span className="hidden sm:inline">{t('es_ai_subjects')}</span>
                  </button>
                </div>
              </label>
              {subjectIdeas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                  {subjectIdeas.map((s) => <button key={s} type="button" dir="auto" className={pill} onClick={() => { setSubject(s); setSubjectIdeas([]); touch(); }}>{s}</button>)}
                </div>
              )}
              <label className="block sm:col-span-2"><span className="mb-1 block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{t('es_preheader')}</span>
                <input className={field} dir="auto" value={preheader} maxLength={300} onChange={(e) => { setPreheader(e.target.value); touch(); }} /></label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <span className="flex items-center gap-1 text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground"><Palette className="h-3.5 w-3.5" aria-hidden="true" />{t('es_theme')}</span>
                {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((k) => (
                  <button key={k} type="button" aria-pressed={design.theme.accent === THEMES[k].accent && design.theme.background === THEMES[k].background}
                    onClick={() => { setDesign((d) => ({ ...d, theme: { ...THEMES[k] } })); touch(); }}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-2xs font-semibold ring-1 ring-inset ring-border hover:bg-muted aria-pressed:ring-2 aria-pressed:ring-[hsl(38_92%_50%)]">
                    <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(135deg, ${THEMES[k].background} 50%, ${THEMES[k].accent} 50%)` }} aria-hidden="true" />{t(`es_theme_${k}`)}
                  </button>
                ))}
              </div>
            </section>

            {/* editor ⟷ preview on phones; side by side from lg */}
            <div className="inline-flex rounded-lg p-0.5 ring-1 ring-inset ring-border lg:hidden" role="tablist" aria-label={t('es_view')}>
              {(['edit', 'preview'] as const).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={panel === p} onClick={() => setPanel(p)}
                  className={cn('min-h-9 rounded-md px-4 text-sm font-semibold', panel === p ? 'bg-foreground text-background' : 'hover:bg-muted')}>{t(p === 'edit' ? 'es_edit' : 'es_preview')}</button>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className={cn('min-w-0 space-y-4', panel !== 'edit' && 'hidden lg:block')}>
                <section className="rounded-2xl border bg-card p-3 sm:p-4" aria-label={t('es_sections')}>
                  <BlockCanvas blocks={design.blocks} selectedId={selectedId} onSelect={setSelectedId} onMove={moveBlock} onReorder={reorder}
                    onDuplicate={duplicate} onRemove={remove} onAdd={addBlock} />
                </section>
                {selected && (
                  <section className="rounded-2xl border bg-card p-3 sm:p-4" aria-labelledby="es-inspect">
                    <h3 id="es-inspect" className="mb-3 text-sm font-semibold">{t(`es_block_${selected.type}`)}</h3>
                    <BlockInspector key={selected.id} block={selected} onChange={updateBlock} photos={photos} language={language} propertyId={propertyId} propertyFacts={propertyFacts} />
                  </section>
                )}
              </div>
              <div className={cn('min-w-0 lg:sticky lg:top-4 lg:self-start', panel !== 'preview' && 'hidden lg:block')}>
                <EmailPreview design={design} subject={subject} preheader={preheader} dir={dir} lang={language} device={device} onDevice={setDevice} sampleName={sampleName} />
              </div>
            </div>
            {problems.length > 0 && (
              <ul className="space-y-1 rounded-xl bg-[hsl(42_100%_96%)] p-3 text-2xs text-[hsl(34_90%_28%)]" aria-label={t('es_problems')}>
                {problems.map((p) => <li key={p} className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`es_problem_${p.toLowerCase()}`)}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* ── 4. REVIEW & SEND ── */}
        {step === 'review' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="es-review">
              <h2 id="es-review" className="text-base font-semibold">{t(alreadySent ? 'es_sent_title' : 'es_review_title')}</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('es_subject')}</dt><dd className="min-w-0 break-words text-end font-medium" dir="auto">{subject || '—'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('es_recipients_ready')}</dt><dd className="font-semibold tabular-nums">{sendable.length}</dd></div>
                {chosen.length > sendable.length && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('es_recipients_skipped')}</dt><dd className="tabular-nums">{chosen.length - sendable.length}</dd></div>}
              </dl>
              {!alreadySent && (
                <>
                  <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-inset ring-border">
                    {sendable.map((c) => (
                      <li key={c.key} className="flex min-w-0 items-center justify-between gap-2 px-3 py-1.5 text-sm">
                        <span dir="auto" className="min-w-0 truncate">{c.name || '—'}</span><span className="min-w-0 truncate text-2xs text-muted-foreground" dir="ltr">{c.email}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1.5 text-2xs text-muted-foreground">
                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(158_64%_36%)]" aria-hidden="true" />{t('es_guard_unsub')}</li>
                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(158_64%_36%)]" aria-hidden="true" />{t('es_guard_suppression')}</li>
                    <li className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(158_64%_36%)]" aria-hidden="true" />{t('es_guard_once')}</li>
                  </ul>
                  <label className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(38_92%_50%)]" />
                    <span>{t('es_consent')}</span>
                  </label>
                  {problems.length > 0 && <p className="text-2xs text-[hsl(350_60%_40%)]">{t('es_fix_problems')}</p>}
                  <button type="button" onClick={() => setConfirmOpen(true)} disabled={!consent || sending || problems.length > 0 || sendable.length === 0}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-4 text-sm font-semibold text-[hsl(40_94%_64%)] disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}{t('es_send_n', { n: String(sendable.length) })}
                  </button>
                </>
              )}

              {outcome?.kind === 'blocked' && (
                <p className="flex gap-2 rounded-xl bg-[hsl(350_60%_96%)] p-3 text-sm text-[hsl(350_60%_30%)]" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(BLOCKED_KEY[outcome.reason] ?? 'es_send_failed')}
                </p>
              )}
              {outcome?.kind === 'nobody' && <p className="rounded-xl bg-muted/50 p-3 text-sm" role="status">{t('es_nobody_eligible', { n: String(outcome.excluded) })}</p>}
              {outcome?.kind === 'sent' && (
                <p className="rounded-xl bg-[hsl(158_45%_94%)] p-3 text-sm text-[hsl(158_64%_22%)]" role="status">
                  {t('es_send_result', { sent: String(outcome.sent), failed: String(outcome.failed), excluded: String(outcome.excluded) })}
                </p>
              )}
              {alreadySent && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t('es_delivery')}</h3>
                    <button type="button" className={pill} onClick={() => void refreshDelivery()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('cl_refresh')}</button>
                  </div>
                  {delivery ? (
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([['es_d_sent', delivery.sent_count], ['es_d_delivered', delivery.delivered_count], ['es_d_bounced', delivery.bounce_count],
                        ['es_d_complaints', delivery.complaint_count], ['es_d_unsubscribed', delivery.unsubscribe_count], ['es_d_failed', delivery.failed_count]] as Array<[string, number]>).map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-muted/40 p-2.5"><dd className="text-lg font-semibold tabular-nums">{v ?? 0}</dd><dt className="text-2xs text-muted-foreground">{t(k)}</dt></div>
                      ))}
                    </dl>
                  ) : <p className="text-2xs text-muted-foreground">{t('cw_loading')}</p>}
                  <p className="text-2xs text-muted-foreground">{t('es_delivery_note')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={pill} onClick={duplicateAsNew}><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t('es_duplicate_new')}</button>
                    <Link to="/outreach/email" className={pill}><Mail className="h-3.5 w-3.5" aria-hidden="true" />{t('es_email_activity')}</Link>
                  </div>
                </div>
              )}
            </section>
            <div className="min-w-0">
              <EmailPreview design={design} subject={subject} preheader={preheader} dir={dir} lang={language} device={device} onDevice={setDevice} sampleName={sampleName} />
            </div>
          </div>
        )}

        {/* ── step navigation ── */}
        {!alreadySent && (
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={pill} disabled={stepIndex === 0} onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}>
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />{t('es_back')}
            </button>
            {step !== 'review' && (
              <button type="button" disabled={!canNext} onClick={() => setStep(STEPS[stepIndex + 1])}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-4 text-sm font-semibold text-[hsl(40_94%_64%)] disabled:opacity-50">
                {t('es_next')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('es_confirm_title', { n: String(sendable.length) })}</AlertDialogTitle>
            <AlertDialogDescription>{t('es_confirm_body', { subject })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSend()} className="bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] hover:bg-[hsl(218_52%_16%)]">{t('es_confirm_send')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}
