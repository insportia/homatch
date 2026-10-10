// HOMATCH EMAIL STUDIO — property-offer emails to unlocked HOMATCH leads.
//
// Routes (wired by the integrator): /email-studio and /email-studio/:campaignId.
// Query: ?property=<propertyId>&leads=<matchId,...> — matchIds are HOMATCH Leads
// handles (supply_matches ids); the server resolves them to this account's unlocked
// leads. No email address ever reaches this page: recipients are display names and
// reason codes, and the server reads addresses at send time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Mail, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { CustomerSurface } from '@/components/customer/surface';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  applyDraftCopy, defaultContent, normalizeContent, relocalizeContent, switchTemplate, type EmailContent,
} from '@/emailStudio/blocks';
import { renderEmail } from '@/emailStudio/render';
import { EMAIL_LANGS, TEMPLATE_NAME_KEY, isTemplateId, templateAvailability, type TemplateId } from '@/emailStudio/templates';
import { reasonKey, type EligibilitySummary } from '@/emailStudio/eligibility';
import {
  emailStudio, type CampaignStats, type CampaignSummary, type RenderResult, type ReviewResult, type StudioProperty,
} from '@/services/emailStudio';
import { StudioSection } from '@/components/emailStudio/StudioSection';
import { TemplateGallery } from '@/components/emailStudio/TemplateGallery';
import { PropertySelector } from '@/components/emailStudio/PropertySelector';
import { BlockEditor } from '@/components/emailStudio/BlockEditor';
import { EmailPreview, type PreviewMode } from '@/components/emailStudio/EmailPreview';
import { RecipientReview } from '@/components/emailStudio/RecipientReview';
import { SendConfirmDialog } from '@/components/emailStudio/SendConfirmDialog';
import { CampaignResults } from '@/components/emailStudio/CampaignResults';
import {
  CANVAS, FIELD, GOLD_BUTTON, GOLD_EYEBROW, INK, INK_SOFT, LABEL, NAVY_BUTTON, QUIET_BUTTON,
} from '@/components/emailStudio/styles';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG_NAMES: Record<string, string> = { en: 'English', ka: 'ქართული', ru: 'Русский', tr: 'Türkçe', ar: 'العربية', he: 'עברית' };
const EDITABLE = new Set(['DRAFT', 'REVIEWED']);

function stateKey(state: string | undefined | null): string {
  switch (state) {
    case 'SENDING_DISABLED': return 'es_state_sending_disabled';
    case 'DAILY_CAP_REACHED': return 'es_state_daily_cap';
    case 'VERSION_MISMATCH':
    case 'NOT_REVIEWED': return 'es_state_version_mismatch';
    case 'TEST_LIMIT_REACHED': return 'es_test_limit';
    default: return 'es_state_unavailable';
  }
}

export default function EmailStudioPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { campaignId: routeCampaignId } = useParams<{ campaignId?: string }>();
  const [params] = useSearchParams();
  const queryProperty = params.get('property');
  const queryLeads = useMemo(
    () => (params.get('leads') ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s)).slice(0, 500),
    [params],
  );

  const [properties, setProperties] = useState<StudioProperty[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);

  const [campaignId, setCampaignId] = useState<string | null>(routeCampaignId && UUID.test(routeCampaignId) ? routeCampaignId : null);
  const [status, setStatus] = useState<string>('DRAFT');
  const [propertyId, setPropertyId] = useState<string | null>(queryProperty && UUID.test(queryProperty) ? queryProperty : null);
  const [templateId, setTemplateId] = useState<TemplateId>('PROPERTY_INTRODUCTION');
  const [emailLang, setEmailLang] = useState<string>(EMAIL_LANGS.includes(lang as never) ? lang : 'en');
  const [name, setName] = useState('');
  const [content, setContent] = useState<EmailContent>(() => defaultContent('PROPERTY_INTRODUCTION', lang));
  const [stats, setStats] = useState<CampaignStats | null>(null);

  const [renderData, setRenderData] = useState<RenderResult | null>(null);
  const [renderLoading, setRenderLoading] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilitySummary | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const loadedCampaign = useRef(false);
  const savingRef = useRef<Promise<string | null> | null>(null);
  /* Every edit bumps this; a save only clears `dirty` if nothing changed while it ran. */
  const editSeq = useRef(0);
  /* The id a save must update — never a stale closure that would create a second draft. */
  const campaignIdRef = useRef<string | null>(campaignId);
  useEffect(() => { campaignIdRef.current = campaignId; }, [campaignId]);

  const editable = EDITABLE.has(status);
  const isSent = status === 'SENT' || status === 'SENDING' || status === 'FAILED';

  /* ── initial data ─────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    emailStudio.myProperties()
      .then((list) => { if (alive) setProperties(list ?? []); })
      .catch(() => { if (alive) toast.error(t('es_state_error')); })
      .finally(() => { if (alive) setPropertiesLoading(false); });
    emailStudio.listCampaigns().then((list) => { if (alive) setCampaigns(list ?? []); }).catch(() => undefined);
    return () => { alive = false; };
  }, [t]);

  useEffect(() => {
    if (!campaignId || loadedCampaign.current) return;
    loadedCampaign.current = true;
    emailStudio.getCampaign(campaignId).then((c) => {
      setStatus(c.status);
      setPropertyId(c.propertyId);
      setTemplateId(isTemplateId(c.templateId) ? c.templateId : 'PROPERTY_INTRODUCTION');
      setEmailLang(c.language);
      setName(c.name ?? '');
      const raw = c.content as unknown as { blocks?: unknown[] };
      setContent(raw && Array.isArray(raw.blocks) && raw.blocks.length ? normalizeContent(c.content) : defaultContent(c.templateId, c.language));
      setStats(c.stats);
      setSelected(new Set(c.recipients.map((r) => r.unlockId).filter((x): x is string => Boolean(x))));
    }).catch(() => {
      toast.error(t('es_state_error'));
      navigate('/email-studio', { replace: true });
    });
  }, [campaignId, navigate, t]);

  useEffect(() => {
    let alive = true;
    setEligibilityLoading(true);
    emailStudio.eligibleRecipients(queryLeads.length ? queryLeads : null)
      .then((s) => {
        if (!alive) return;
        setEligibility(s);
        // A new campaign starts with every eligible lead selected; a saved one keeps its audience.
        if (!routeCampaignId) setSelected(new Set(s.items.filter((i) => i.eligible && i.unlockId).map((i) => i.unlockId!)));
      })
      .catch(() => { if (alive) setEligibility({ total: 0, eligibleCount: 0, reasons: {}, items: [] }); })
      .finally(() => { if (alive) setEligibilityLoading(false); });
    return () => { alive = false; };
  }, [queryLeads, routeCampaignId]);

  /* ── the listing's real data (photos, facts, template availability) ───── */
  useEffect(() => {
    if (!propertyId) { setRenderData(null); return; }
    let alive = true;
    setRenderLoading(true);
    emailStudio.render({ propertyId, templateId, language: emailLang, content })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) { setRenderData(null); if (r.error === 'PROPERTY_NOT_FOUND') setPropertyId(null); return; }
        setRenderData(r);
      })
      .catch(() => { if (alive) setRenderData(null); })
      .finally(() => { if (alive) setRenderLoading(false); });
    return () => { alive = false; };
    // Content changes are previewed locally below; only the listing reloads here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const segment = renderData?.property.segment ?? properties.find((p) => p.propertyId === propertyId)?.segment ?? null;
  const availability = useMemo(() => ({
    PROPERTY_INTRODUCTION: templateAvailability('PROPERTY_INTRODUCTION', segment),
    MODERN_RESIDENCE: templateAvailability('MODERN_RESIDENCE', segment),
    PREMIUM_PROPERTY: templateAvailability('PREMIUM_PROPERTY', segment),
    PERSONAL_FOLLOW_UP: templateAvailability('PERSONAL_FOLLOW_UP', segment),
  }), [segment]);

  // Premium is never kept on a listing that is not premium.
  useEffect(() => {
    if (templateId === 'PREMIUM_PROPERTY' && renderData && !availability.PREMIUM_PROPERTY.available) {
      setContent((c) => switchTemplate(c, 'PREMIUM_PROPERTY', 'PROPERTY_INTRODUCTION', emailLang));
      setTemplateId('PROPERTY_INTRODUCTION');
    }
  }, [availability, renderData, templateId, emailLang]);

  /* ── the preview: the same renderer the server sends with ─────────────── */
  const previewHtml = useMemo(() => {
    if (!renderData) return null;
    try {
      return renderEmail({
        content, templateId, lang: emailLang, property: renderData.property, preview: true, unsubscribeUrl: null,
        listingUrl: `${window.location.origin}/property/${propertyId}`, senderName: review?.sender.fromName ?? 'HOMATCH',
      }).html;
    } catch {
      return renderData.html;
    }
  }, [content, templateId, emailLang, renderData, propertyId, review]);

  /* ── edits ────────────────────────────────────────────────────────────── */
  const edit = useCallback(<T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  }, []);

  const onContent = edit(setContent);
  const onName = edit(setName);
  const onTemplate = (next: TemplateId) => {
    if (!editable || next === templateId) return;
    setContent((c) => switchTemplate(c, templateId, next, emailLang));
    setTemplateId(next);
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  };
  const onLanguage = (next: string) => {
    setContent((c) => relocalizeContent(c, templateId, emailLang, next));
    setEmailLang(next);
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  };
  const onProperty = (id: string) => {
    if (!editable) return;
    setPropertyId(id);
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  };
  const onToggleRecipient = (unlockId: string, on: boolean) => {
    setSelected((s) => { const n = new Set(s); if (on) n.add(unlockId); else n.delete(unlockId); return n; });
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  };
  const onSelectAll = () => {
    if (!eligibility) return;
    setSelected(new Set(eligibility.items.filter((i) => i.eligible && i.unlockId).map((i) => i.unlockId!)));
    editSeq.current += 1;
    setDirty(true);
    setReview(null);
  };

  /* ── autosave ─────────────────────────────────────────────────────────── */
  const save = useCallback(async (): Promise<string | null> => {
    if (!propertyId || !editable) return campaignIdRef.current;
    if (savingRef.current) await savingRef.current;
    const seq = editSeq.current;
    const run = (async () => {
      setSaving(true);
      try {
        const existing = campaignIdRef.current;
        const saved = await emailStudio.saveDraft({ campaignId: existing, propertyId, templateId, language: emailLang, name, content });
        const id = saved.campaignId;
        campaignIdRef.current = id;
        const after = await emailStudio.setRecipients(id, [...selected]);
        setStatus(after.status);
        setStats(after.stats);
        if (!existing) {
          setCampaignId(id);
          loadedCampaign.current = true;
          /* The address bar learns the id without a router navigation: /email-studio and
             /email-studio/:id may be two route entries, and switching between them would
             remount the page mid-edit. */
          window.history.replaceState(window.history.state, '', `/email-studio/${id}${window.location.search}`);
        }
        if (editSeq.current === seq) setDirty(false);
        setSavedAt(Date.now());
        return id;
      } catch {
        toast.error(t('es_state_error'));
        return null;
      } finally {
        setSaving(false);
      }
    })();
    savingRef.current = run;
    const out = await run;
    savingRef.current = null;
    return out;
  }, [propertyId, templateId, emailLang, name, content, selected, editable, t]);

  useEffect(() => {
    if (!dirty || !propertyId || !editable) return;
    const timer = window.setTimeout(() => { void save(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, propertyId, editable, save]);

  /* ── actions ──────────────────────────────────────────────────────────── */
  const onGenerate = async () => {
    if (!propertyId) return;
    setGenerating(true);
    try {
      const r = await emailStudio.generate({ propertyId, templateId, language: emailLang });
      if (!r.ok || !r.copy) { toast.error(t('es_state_error')); return; }
      onContent(applyDraftCopy(content, r.copy));
      toast(r.source === 'AI' ? t('es_ai_used') : t('es_ai_fallback'));
    } catch {
      toast.error(t('es_state_error'));
    } finally {
      setGenerating(false);
    }
  };

  const onReview = async () => {
    setReviewing(true);
    setNotice(null);
    try {
      const id = dirty || !campaignId ? await save() : campaignId;
      if (!id) return;
      const r = await emailStudio.review(id);
      if (!r.ok) { setNotice(t(r.error === 'SUBJECT_REQUIRED' ? 'es_review_needed' : 'es_state_error')); return; }
      setReview(r);
      setStatus('REVIEWED');
      if (r.sendingState && r.sendingState !== 'READY') setNotice(t(stateKey(r.sendingState)));
    } catch {
      setNotice(t('es_state_error'));
    } finally {
      setReviewing(false);
    }
  };

  const onTest = async () => {
    if (!campaignId) return;
    setTesting(true);
    try {
      const id = dirty ? await save() : campaignId;
      if (!id) return;
      const r = await emailStudio.sendTest(id);
      if (r.ok) toast.success(t('es_test_sent', { email: r.sentTo ?? '' }));
      else setNotice(t(stateKey(r.state ?? r.error)));
    } catch {
      setNotice(t('es_state_error'));
    } finally {
      setTesting(false);
    }
  };

  const onSend = async () => {
    if (!campaignId || !review) return;
    setSending(true);
    let total = 0;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const r = await emailStudio.send(campaignId, review.versionHash);
        if (!r.ok) { setNotice(t(stateKey(r.state ?? r.error))); break; }
        total += r.sent ?? 0;
        if (r.state === 'DAILY_CAP_REACHED') { setNotice(t('es_state_daily_cap')); break; }
        if (!r.remaining) break;
      }
      if (total > 0) toast.success(t('es_sent_done', { count: total }));
      const fresh = await emailStudio.getCampaign(campaignId);
      setStatus(fresh.status);
      setStats(fresh.stats);
      emailStudio.listCampaigns().then(setCampaigns).catch(() => undefined);
    } catch {
      setNotice(t('es_state_error'));
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const images = renderData?.property.images ?? [];
  const sendingBlocked = review ? review.sendingState !== 'READY' : true;
  const canReview = Boolean(propertyId) && selected.size > 0 && content.subject.trim().length > 0 && editable;
  const leadsHref = propertyId ? `/property/${propertyId}/leads` : '/leads';
  const excluded = review ? Object.entries(review.reasons ?? {}) : [];

  return (
    <div className={cn(CANVAS, 'min-h-[calc(100dvh-4rem)] pb-16 pt-6 sm:pt-8')}>
      <CustomerSurface className="space-y-5">
        <header className="max-w-3xl">
          <p className={GOLD_EYEBROW}>{t('es_eyebrow')}</p>
          <h1 className={cn('mt-2 font-display text-2xl font-bold leading-tight tracking-[-0.01em] sm:text-3xl lg:text-4xl', INK)}>{t('es_title')}</h1>
          <p className={cn('mt-3 text-[15px] leading-relaxed sm:text-base', INK_SOFT)}>{t('es_description')}</p>
          <span className="mt-4 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        </header>

        {campaigns.length ? (
          <nav aria-label={t('es_campaigns')} className="flex flex-wrap items-center gap-2">
            <span className={cn('text-sm font-semibold', INK)}>{t('es_campaigns')}:</span>
            {campaigns.slice(0, 6).map((c) => (
              <Link key={c.campaignId} to={`/email-studio/${c.campaignId}`} reloadDocument
                aria-current={c.campaignId === campaignId ? 'page' : undefined}
                className={cn(QUIET_BUTTON, 'max-w-[16rem] text-xs', c.campaignId === campaignId && 'border-[hsl(38_92%_50%)] bg-[hsl(42_100%_96%)]')}>
                <span className="truncate">{c.name || c.subject || c.propertyTitle || t('es_untitled')}</span>
                <span className={INK_SOFT}>· {t(`es_status_${c.status}`)}</span>
              </Link>
            ))}
            {campaignId ? <Link to="/email-studio" reloadDocument className={cn(QUIET_BUTTON, 'text-xs')}>{t('es_new_campaign')}</Link> : null}
          </nav>
        ) : null}

        <div className={cn('flex min-h-6 items-center gap-2 text-sm', INK_SOFT)} aria-live="polite">
          {saving ? <><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{t('es_saving')}</>
            : savedAt && !dirty ? <><CheckCircle2 className="h-4 w-4 text-[hsl(152_45%_35%)]" aria-hidden="true" />{t('es_saved')}</> : null}
          {!editable ? <span className="rounded-full bg-[hsl(218_30%_94%)] px-2.5 py-0.5 text-xs font-semibold">{t(`es_status_${status}`)}</span> : null}
        </div>

        <StudioSection id="es-template" step={1} title={t('es_section_template')}>
          <TemplateGallery value={templateId} onChange={onTemplate} availability={availability} />
        </StudioSection>

        <StudioSection id="es-property" step={2} title={t('es_section_property')}>
          <PropertySelector properties={properties} value={propertyId} onChange={onProperty} loading={propertiesLoading} />
        </StudioSection>

        <StudioSection
          id="es-customize" step={3} title={t('es_section_customize')}
          actions={(
            <button type="button" className={NAVY_BUTTON} onClick={onGenerate} disabled={!propertyId || !editable || generating} aria-busy={generating}>
              {generating ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {t('es_generate_ai')}
            </button>
          )}
        >
          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="es-name" className={LABEL}>{t('es_campaign_name')}</label>
              <input id="es-name" className={FIELD} value={name} maxLength={160} disabled={!editable} onChange={(e) => onName(e.target.value)}
                placeholder={t(TEMPLATE_NAME_KEY[templateId])} />
            </div>
            <div>
              <label htmlFor="es-lang" className={LABEL}>{t('es_email_language')}</label>
              <select id="es-lang" className={cn(FIELD, 'h-12 py-0')} value={emailLang} disabled={!editable} onChange={(e) => onLanguage(e.target.value)}>
                {EMAIL_LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
              </select>
            </div>
          </div>
          {propertyId && !renderLoading && renderData && images.length === 0 ? (
            <p className={cn('mb-4 rounded-xl bg-[hsl(42_100%_96%)] p-3 text-sm', INK)}>{t('es_no_photos')}</p>
          ) : null}
          <BlockEditor content={content} onChange={onContent} templateId={templateId} emailLang={emailLang} images={images} disabled={!editable} />
        </StudioSection>

        <StudioSection id="es-recipients" step={4} title={t('es_section_recipients')}>
          <RecipientReview summary={eligibility} selected={selected} onToggle={onToggleRecipient} onSelectAll={onSelectAll}
            loading={eligibilityLoading} disabled={!editable} leadsHref={leadsHref} />
        </StudioSection>

        <StudioSection id="es-preview" step={5} title={t('es_section_preview')}>
          <EmailPreview html={previewHtml} mode={previewMode} onModeChange={setPreviewMode} loading={renderLoading} />

          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[hsl(152_30%_80%)] bg-[hsl(152_40%_97%)] p-3.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(152_45%_32%)]" aria-hidden="true" />
            <p className={cn('text-[15px] leading-relaxed', INK)}>{t('es_safety_note')}</p>
          </div>

          {review ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <dl className="space-y-2 rounded-xl border border-[hsl(38_28%_88%)] p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><dt className={INK_SOFT}>{t('es_review_eligible')}</dt><dd className={cn('font-bold', INK)}>{review.eligible}</dd></div>
                <div className="flex flex-wrap justify-between gap-2"><dt className={INK_SOFT}>{t('es_review_excluded')}</dt><dd className={cn('font-bold', INK)}>{review.recipients - review.eligible}</dd></div>
                {excluded.map(([reason, n]) => (
                  <div key={reason} className="flex flex-wrap justify-between gap-2 ps-3"><dt className={INK_SOFT}>{t(reasonKey(reason))}</dt><dd className={INK}>{n}</dd></div>
                ))}
                <div className="flex flex-wrap justify-between gap-2"><dt className={INK_SOFT}>{t('es_review_daily', { used: review.dailyUsed, cap: review.dailyCap })}</dt></div>
                <p className={cn('pt-1 font-semibold', INK)}>{t('es_review_free')}</p>
              </dl>
              <dl className="space-y-2 rounded-xl border border-[hsl(38_28%_88%)] p-4 text-sm">
                <div><dt className={INK_SOFT}>{t('es_review_from')}</dt><dd className={cn('break-words font-semibold', INK)}>{review.sender.fromName} &lt;{review.sender.fromAddress}&gt;</dd></div>
                <div><dt className={INK_SOFT}>{t('es_review_reply_to')}</dt><dd className={cn('break-words font-semibold', INK)}>{review.sender.replyTo ?? t('es_review_reply_none')}</dd></div>
                {review.droppedImages > 0 ? <p className="text-[hsl(30_80%_35%)]">{t('es_dropped_images', { count: review.droppedImages })}</p> : null}
              </dl>
            </div>
          ) : editable && !canReview ? (
            <p className={cn('mt-4 text-sm', INK_SOFT)}>{t('es_review_needed')}</p>
          ) : null}

          {notice ? (
            <div role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-[hsl(38_70%_70%)] bg-[hsl(42_100%_96%)] p-3.5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(32_85%_40%)]" aria-hidden="true" />
              <p className={cn('text-[15px] leading-relaxed', INK)}>{notice}</p>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <button type="button" className={QUIET_BUTTON} onClick={onTest} disabled={!campaignId || testing || !editable} aria-busy={testing}
              title={t('es_test_note')}>
              {testing ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <FlaskConical className="h-4 w-4" aria-hidden="true" />}
              {t('es_send_test')}
            </button>
            <button type="button" className={NAVY_BUTTON} onClick={onReview} disabled={!canReview || reviewing} aria-busy={reviewing}>
              {reviewing ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
              {t('es_review_campaign')}
            </button>
            <button type="button" className={GOLD_BUTTON} onClick={() => setConfirmOpen(true)}
              disabled={!review || sendingBlocked || review.eligible === 0 || dirty || !editable}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {t('es_send_campaign')}
            </button>
          </div>
          {dirty && status === 'REVIEWED' ? <p className={cn('mt-2 text-sm', INK_SOFT)}>{t('es_review_stale')}</p> : null}
        </StudioSection>

        <StudioSection id="es-results" step={6} title={t('es_section_results')}>
          <CampaignResults stats={stats} sent={isSent} />
        </StudioSection>
      </CustomerSurface>

      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        count={review?.eligible ?? 0}
        sender={review?.sender.fromName ?? 'HOMATCH'}
        sending={sending}
        onConfirm={onSend}
      />
    </div>
  );
}
