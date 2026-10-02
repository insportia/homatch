// GUIDED LEAD FORM — a Meta Instant Form, built step by step in plain words.
//
//   Basics → Intro (optional) → Questions → Contact → Privacy → Thank-you
//
// What the owner sees on the phone preview is the same pure leadFormPreview()
// the server sends to Meta (labels, options, screens). It approximates Meta's
// look, and says so. Suggestions come from the campaign's own context
// (leadForms.suggestLeadQuestions) and are never applied by themselves. Only
// Meta-supported question types exist here; a sensitive question is refused.
// NOTHING is created at Meta until the owner confirms in the dialog — and
// Meta forms cannot be edited afterwards, which the dialog says.
import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, ShieldAlert, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  CONTACT_FIELDS, QUALIFYING_KEYS, MAX_QUESTIONS, MAX_INTRO_POINTS, leadFormPreview, leadFormReadiness, suggestLeadQuestions, validateLeadFormSpec, META_LOCALE,
  type ContactField, type FormContext, type FormLocale, type LeadFormSpec, type QualifyingKey,
} from '@/lib/metaAds/leadForms';
import { createPremiumLeadForm } from '@/services/metaAds';
import { leadFormIssueKey } from './masterLogic';
import { FORMS_COPY } from './instantFormsCopy';
import { Hint } from './FinishKit';
import type { InstantFormsState } from '@/lib/metaAds/instantForms';

const LOCALES = Object.keys(META_LOCALE) as FormLocale[];
const SECTIONS = ['basics', 'intro', 'questions', 'contact', 'privacy', 'thanks'] as const;
type SectionKey = (typeof SECTIONS)[number];
const SCREENS = ['intro', 'questions', 'privacy', 'thanks'] as const;
type Screen = (typeof SCREENS)[number];

function languageName(code: string, ui: string): string {
  try { return new Intl.DisplayNames([ui], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

export function LeadFormBuilder({ propertyId, onCreated, onCancel, formsState, context, pageName }: {
  propertyId: string | null;
  /** Why Instant Forms may be unavailable (server-decided); product words only. */
  formsState?: InstantFormsState;
  /** The campaign's own context — HOMATCH suggests from it, never assumes. */
  context?: FormContext;
  pageName?: string | null;
  /** Meta's form id, after the server created it. */
  onCreated: (externalId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t, lang } = useLanguage();
  const uiLocale: FormLocale = (LOCALES as string[]).includes(lang) ? lang as FormLocale : 'en';
  const suggested = useMemo(() => suggestLeadQuestions(context ?? { isProperty: false }), [context]);
  const [spec, setSpec] = useState<LeadFormSpec>({
    name: '', headline: '', intro: null, thankYouTitle: '', thankYouMessage: '', contactFields: ['FULL_NAME', 'PHONE', 'EMAIL'],
    questions: suggested, customQuestions: [], privacyPolicyUrl: '', followUpUrl: '', locale: uiLocale,
  });
  const [section, setSection] = useState<SectionKey>('basics');
  const [screen, setScreen] = useState<Screen>('questions');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);

  const clean: LeadFormSpec = useMemo(() => ({
    ...spec,
    name: spec.name.trim(),
    headline: spec.headline?.trim() || null,
    intro: spec.intro ? { title: spec.intro.title.trim(), points: spec.intro.points.map((x) => x.trim()).filter(Boolean) } : null,
    thankYouTitle: spec.thankYouTitle?.trim() || null,
    thankYouMessage: spec.thankYouMessage?.trim() || null,
    customQuestions: (spec.customQuestions ?? []).map((c) => ({ label: c.label.trim(), options: c.options.map((o) => o.trim()).filter(Boolean) })),
    privacyPolicyUrl: spec.privacyPolicyUrl.trim(),
    followUpUrl: spec.followUpUrl?.trim() || null,
  }), [spec]);
  const issues = useMemo(() => validateLeadFormSpec(clean), [clean]);
  const readiness = useMemo(() => leadFormReadiness(clean), [clean]);
  const preview = useMemo(() => leadFormPreview(clean), [clean]);
  const questionLabels = useMemo(() => leadFormPreview({ ...clean, questions: QUALIFYING_KEYS, customQuestions: [], locale: uiLocale }).questions, [clean, uiLocale]);
  const set = (p: Partial<LeadFormSpec>) => { setSpec((s) => ({ ...s, ...p })); setServerIssues([]); };
  const issueFor = (field: string) => issues.find((i) => i.field === field);
  const nQuestions = spec.questions.length + (spec.customQuestions ?? []).length;
  const ready = issues.length === 0;

  const toggleContact = (f: ContactField) => set({ contactFields: spec.contactFields.includes(f) ? spec.contactFields.filter((x) => x !== f) : CONTACT_FIELDS.filter((x) => x === f || spec.contactFields.includes(x)) });
  const toggleQuestion = (q: QualifyingKey) => {
    if (spec.questions.includes(q)) set({ questions: spec.questions.filter((x) => x !== q) });
    else if (nQuestions < MAX_QUESTIONS) set({ questions: [...spec.questions, q] });
  };
  const custom = spec.customQuestions ?? [];
  const setCustom = (i: number, p: Partial<{ label: string; options: string[] }>) => set({ customQuestions: custom.map((c, j) => (j === i ? { ...c, ...p } : c)) });

  const create = async () => {
    setConfirmOpen(false);
    if (!ready) return;
    setBusy(true); setPermissionNeeded(false); setServerIssues([]);
    try {
      const r = await createPremiumLeadForm(clean, propertyId);
      await onCreated(r.form.external_id);
      toast.success(t('madsb_form_created'));
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; body?: { code?: string; issues?: Array<{ code: string }> } };
      const code = String(err?.code ?? err?.body?.code ?? '');
      if (code === 'INSTANT_FORMS_PERMISSION_REQUIRED') setPermissionNeeded(true);
      else if (code === 'INVALID_FORM') setServerIssues((err.body?.issues ?? []).map((i) => i.code));
      else if (code === 'LEAD_TERMS_REQUIRED') toast.error(t('mm_l_terms_body'));
      else if (code === 'NO_PAGE') toast.error(t('madsb_gap_page'));
      else if (String(err?.message ?? '').startsWith('meta_err')) toast.error(t(String(err.message)));
      else toast.error(t('mads_load_failed'));
    } finally { setBusy(false); }
  };

  const fieldErr = (field: string) => {
    const i = issueFor(field);
    return i ? <span className="mt-1 block text-2xs text-destructive" data-mm-lf-issue={i.code}>{t(leadFormIssueKey(i.code))}</span> : null;
  };
  const sectionIndex = SECTIONS.indexOf(section);
  const rtl = spec.locale === 'ar' || spec.locale === 'he';

  return (
    <div data-mm-lead-form-builder="" className="space-y-4 rounded-2xl border border-border bg-[hsl(var(--secondary))]/30 p-3.5 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{t('mm_b_lf_title')}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t('mm_c_lf_lead')}</p>
      </div>

      {permissionNeeded && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] px-3.5 py-3 text-[13px] leading-relaxed text-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />
          <span>{t(FORMS_COPY.PERMISSIONS_MISSING)}</span>
        </div>
      )}
      {formsState && formsState !== 'READY' && !permissionNeeded && (
        <p className="text-2xs text-muted-foreground">{t(FORMS_COPY[formsState as keyof typeof FORMS_COPY] ?? 'mm_c_lf_terms_unknown')}</p>
      )}

      {/* Section tabs — a step at a time, every step reachable. */}
      <div role="tablist" aria-label={t('mm_c_lf_sections')} className="flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map((k, i) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => { setSection(k); if (k === 'intro' || k === 'privacy' || k === 'thanks') setScreen(k === 'intro' ? 'intro' : k); else setScreen('questions'); }}
            data-mm-lf-section={k}
            className={cn('inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
              section === k ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-background text-2xs font-bold" aria-hidden>{i + 1}</span>{t(`mm_c_lf_sec_${k}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
        <div className="min-w-0 space-y-3" role="tabpanel" data-mm-lf-panel={section}>
          {section === 'basics' && (
            <>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_name')}</span>
                <Input value={spec.name} maxLength={100} placeholder={t('madsb_form_name_ph')} aria-invalid={!!issueFor('name')} onChange={(e) => set({ name: e.target.value })} data-mm-lf-name="" />
                <Hint k="mm_b_lf_name_d" className="mt-1" />
                {fieldErr('name')}
              </label>
              <label className="block">
                <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-foreground">
                  {t('mm_b_lf_headline')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{(spec.headline ?? '').length}/60</span>
                </span>
                <Input value={spec.headline ?? ''} maxLength={60} placeholder={t('mm_b_lf_headline_ph')} onChange={(e) => set({ headline: e.target.value })} />
                {fieldErr('headline')}
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_locale')}</span>
                <select value={spec.locale} onChange={(e) => set({ locale: e.target.value as FormLocale })}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
                  {LOCALES.map((l) => <option key={l} value={l}>{languageName(l, lang)}</option>)}
                </select>
                <Hint k="mm_b_lf_locale_d" className="mt-1" />
              </label>
            </>
          )}

          {section === 'intro' && (
            <>
              <Hint k="mm_c_lf_intro_d" />
              <label className="flex min-h-11 items-center gap-2 text-[13px] font-medium text-foreground">
                <input type="checkbox" checked={!!spec.intro} data-mm-lf-intro-toggle=""
                  onChange={(e) => set({ intro: e.target.checked ? { title: '', points: [''] } : null })} className="h-4 w-4 accent-[hsl(var(--gold))]" />
                {t('mm_c_lf_intro_on')}
              </label>
              {spec.intro && (
                <div className="space-y-2">
                  <Input value={spec.intro.title} maxLength={60} placeholder={t('mm_c_lf_intro_title_ph')} aria-label={t('mm_c_lf_intro_title')}
                    onChange={(e) => set({ intro: { ...spec.intro!, title: e.target.value } })} />
                  {spec.intro.points.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={p} maxLength={80} placeholder={t('mm_c_lf_intro_point_ph')} aria-label={t('mm_c_lf_intro_point', { n: String(i + 1) })}
                        onChange={(e) => set({ intro: { ...spec.intro!, points: spec.intro!.points.map((x, j) => (j === i ? e.target.value : x)) } })} />
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t('mm_c_lf_remove')}
                        onClick={() => set({ intro: { ...spec.intro!, points: spec.intro!.points.filter((_, j) => j !== i) } })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  {spec.intro.points.length < MAX_INTRO_POINTS && (
                    <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => set({ intro: { ...spec.intro!, points: [...spec.intro!.points, ''] } })}>
                      <Plus className="h-4 w-4" />{t('mm_c_lf_intro_add')}
                    </Button>
                  )}
                  {fieldErr('intro')}
                </div>
              )}
            </>
          )}

          {section === 'questions' && (
            <>
              <div className="flex items-baseline justify-between text-[13px] font-medium text-foreground">
                {t('mm_b_lf_questions')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{nQuestions}/{MAX_QUESTIONS}</span>
              </div>
              {suggested.length > 0 && (
                <p className="flex items-start gap-1.5 text-2xs text-muted-foreground" data-mm-lf-suggested={suggested.join(',')}>
                  <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />{t('mm_c_lf_suggested')}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {questionLabels.map((q) => {
                  const on = spec.questions.includes(q.key as QualifyingKey);
                  return (
                    <Pill key={q.key} active={on} disabled={!on && nQuestions >= MAX_QUESTIONS} onClick={() => toggleQuestion(q.key as QualifyingKey)}>
                      <span dir="auto">{q.label}</span>
                    </Pill>
                  );
                })}
              </div>
              <div className="space-y-2 rounded-xl border border-border bg-card p-3" data-mm-lf-custom="">
                <p className="text-[13px] font-medium text-foreground">{t('mm_c_lf_custom_title')}</p>
                <Hint k="mm_c_lf_custom_d" />
                {custom.map((c, i) => (
                  <div key={i} className="space-y-1.5 rounded-lg border border-border p-2.5">
                    <div className="flex gap-2">
                      <Input value={c.label} maxLength={80} placeholder={t('mm_c_lf_custom_label_ph')} aria-label={t('mm_c_lf_custom_label')} onChange={(e) => setCustom(i, { label: e.target.value })} />
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t('mm_c_lf_remove')}
                        onClick={() => set({ customQuestions: custom.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Input value={c.options.join(', ')} placeholder={t('mm_c_lf_custom_options_ph')} aria-label={t('mm_c_lf_custom_options')}
                      onChange={(e) => setCustom(i, { options: e.target.value.split(',').map((x) => x.trimStart()) })} />
                  </div>
                ))}
                {nQuestions < MAX_QUESTIONS && (
                  <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5" data-mm-lf-custom-add=""
                    onClick={() => set({ customQuestions: [...custom, { label: '', options: [] }] })}>
                    <Plus className="h-4 w-4" />{t('mm_c_lf_custom_add')}
                  </Button>
                )}
                {fieldErr('customQuestions')}
              </div>
              {fieldErr('questions')}
            </>
          )}

          {section === 'contact' && (
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium text-foreground">{t('mm_b_lf_contact')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {CONTACT_FIELDS.map((f) => (
                  <Pill key={f} active={spec.contactFields.includes(f)} onClick={() => toggleContact(f)}>{t(`madsb_form_field_${f.toLowerCase()}`)}</Pill>
                ))}
              </div>
              <Hint k="mm_c_lf_contact_d" className="mt-1" />
              {fieldErr('contactFields')}
            </fieldset>
          )}

          {section === 'privacy' && (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_c_lf_privacy_label')}</span>
              <Input dir="ltr" inputMode="url" placeholder="https://" value={spec.privacyPolicyUrl} aria-invalid={!!issueFor('privacyPolicyUrl')}
                onChange={(e) => set({ privacyPolicyUrl: e.target.value })} data-mm-lf-privacy="" />
              <Hint k="mm_c_lf_privacy_why" className="mt-1" />
              {fieldErr('privacyPolicyUrl')}
              {readiness.find((r) => r.key === 'privacy')?.code === 'PRIVACY_IS_HOMATCH' && (
                <span className="mt-1 block text-2xs text-[hsl(32_78%_32%)]" data-mm-lf-privacy-homatch="">{t('mm_c_lf_privacy_homatch')}</span>
              )}
            </label>
          )}

          {section === 'thanks' && (
            <>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_c_lf_thanks_title')}</span>
                <Input value={spec.thankYouTitle ?? ''} maxLength={60} placeholder={preview.thankYou.title} onChange={(e) => set({ thankYouTitle: e.target.value })} />
                {fieldErr('thankYouTitle')}
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_thanks')}</span>
                <Textarea rows={2} maxLength={500} value={spec.thankYouMessage ?? ''} placeholder={preview.thankYou.body} onChange={(e) => set({ thankYouMessage: e.target.value })} />
                {fieldErr('thankYouMessage')}
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_follow_up')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
                <Input dir="ltr" inputMode="url" placeholder="https://" value={spec.followUpUrl ?? ''} aria-invalid={!!issueFor('followUpUrl')}
                  onChange={(e) => set({ followUpUrl: e.target.value })} />
                {fieldErr('followUpUrl')}
              </label>
            </>
          )}

          <div className="flex justify-between gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1" disabled={sectionIndex === 0} onClick={() => setSection(SECTIONS[Math.max(0, sectionIndex - 1)])}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('madsb_back')}
            </Button>
            {sectionIndex < SECTIONS.length - 1 && (
              <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1" onClick={() => setSection(SECTIONS[sectionIndex + 1])}>
                {t('madsb_continue')}<ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            )}
          </div>
        </div>

        {/* PHONE PREVIEW — an approximation of Meta's form, screen by screen. */}
        <div className="min-w-0" aria-label={t('mm_b_lf_preview')} role="region" data-mm-lf-preview={screen}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mm_b_lf_preview')}</p>
            <span className="text-2xs text-muted-foreground">{t('mm_c_lf_preview_approx')}</span>
          </div>
          <div className="mx-auto w-full max-w-[17rem] rounded-[2rem] border-[6px] border-[#0B1220] bg-[#0B1220] shadow-hover">
            <div className="min-h-[24rem] overflow-hidden rounded-[1.5rem] bg-white text-[#1c1e21]" dir={rtl ? 'rtl' : 'ltr'} lang={spec.locale}>
              <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))] text-2xs font-bold text-[#161309]" aria-hidden>{(pageName ?? 'H').slice(0, 1)}</span>
                <span className="min-w-0 truncate text-2xs font-semibold" dir="auto">{pageName ?? 'HOMATCH'}</span>
              </div>
              <div className="space-y-2.5 p-3 text-2xs">
                {screen === 'intro' && (preview.intro ? (
                  <>
                    <p className="text-[14px] font-bold" dir="auto">{preview.intro.title || t('mm_c_lf_intro_title_ph')}</p>
                    <ul className="list-disc space-y-1 ps-4">{preview.intro.points.map((p, i) => <li key={i} dir="auto">{p}</li>)}</ul>
                  </>
                ) : <p className="text-[#606770]">{t('mm_c_lf_intro_none')}</p>)}
                {screen === 'questions' && (
                  <>
                    {preview.headline && <p className="text-[14px] font-bold" dir="auto">{preview.headline}</p>}
                    {preview.questions.map((q) => (
                      <div key={q.key}>
                        <p className="font-semibold" dir="auto">{q.label || '…'}</p>
                        {q.options ? (
                          <div className="mt-1 space-y-1">{q.options.map((o) => <div key={o} className="rounded-md border border-black/15 px-2 py-1" dir="auto">{o}</div>)}</div>
                        ) : <div className="mt-1 h-7 rounded-md border border-black/15" aria-hidden />}
                      </div>
                    ))}
                    <p className="pt-1 text-2xs font-semibold uppercase tracking-wide text-[#606770]">{t('mm_c_lf_preview_contact')}</p>
                    {preview.contact.map((f) => (
                      <div key={f} className="rounded-md border border-black/15 px-2 py-1.5 text-[#606770]">{t(`madsb_form_field_${f.toLowerCase()}`)}</div>
                    ))}
                  </>
                )}
                {screen === 'privacy' && (
                  <>
                    <p className="text-[14px] font-bold">{t('mm_c_lf_preview_privacy_title')}</p>
                    <p className="text-[#606770]">{t('mm_c_lf_preview_privacy_body', { page: pageName ?? t('mm_c_lf_your_business') })}</p>
                    <p className="font-semibold text-[#1877f2] underline">{preview.privacyLinkText}</p>
                  </>
                )}
                {screen === 'thanks' && (
                  <div className="space-y-1.5 pt-6 text-center">
                    <p className="text-[14px] font-bold" dir="auto">{preview.thankYou.title}</p>
                    <p className="text-[#606770]" dir="auto">{preview.thankYou.body}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div role="tablist" aria-label={t('mm_c_lf_screens')} className="mt-2 flex justify-center gap-1">
            {SCREENS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={screen === k} onClick={() => setScreen(k)} data-mm-lf-screen={k}
                className={cn('min-h-11 rounded-full px-2.5 text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
                  screen === k ? 'bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'text-muted-foreground')}>
                {t(`mm_c_lf_screen_${k}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* READINESS — exactly what remains before Meta. */}
      <ul className="grid gap-1.5 rounded-xl border border-border bg-card p-3 sm:grid-cols-2" aria-label={t('mm_c_lf_ready_title')} data-mm-lf-readiness={ready ? 'ready' : 'todo'}>
        {readiness.map((r) => (
          <li key={r.key} data-mm-lf-ready={r.key} data-mm-lf-ready-state={r.state} className="flex items-start gap-2 text-[13px]">
            <span aria-hidden className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
              r.state === 'ok' ? 'bg-[hsl(152_54%_28%)] text-white' : r.state === 'warn' ? 'bg-[hsl(32_78%_45%)] text-white' : 'border border-muted-foreground/60 text-muted-foreground')}>
              {r.state === 'ok' ? '✓' : r.state === 'warn' ? '!' : '·'}
            </span>
            <span><span className="font-medium">{t(`mm_c_lf_ready_${r.key}`)}</span> · {t(`mm_c_lf_ready_state_${r.state}`)}</span>
          </li>
        ))}
      </ul>

      {serverIssues.length > 0 && (
        <ul className="space-y-1 text-2xs text-destructive" role="status">
          {[...new Set(serverIssues)].map((c) => <li key={c}>{t(leadFormIssueKey(c))}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setConfirmOpen(true)} disabled={busy || !ready} className="min-h-11 gap-1.5" data-mm-lf-create="">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('mm_b_lf_create')}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={onCancel}>{t('general_cancel')}</Button>
      </div>
      <p className="text-2xs leading-relaxed text-muted-foreground" aria-live="polite">{busy ? t('mm_b_lf_creating') : !ready ? t('mm_c_lf_not_ready') : ''}</p>

      {/* The only path to Meta: an explicit confirmation. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md" data-mm-lf-confirm="">
          <DialogHeader>
            <DialogTitle>{t('mm_c_lf_confirm_title')}</DialogTitle>
            <DialogDescription>{t('mm_c_lf_confirm_body')}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('mm_b_lf_name')}</dt><dd className="min-w-0 truncate font-medium" dir="auto">{clean.name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('mm_b_lf_questions')}</dt><dd className="font-medium" dir="ltr">{nQuestions}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('mm_b_lf_locale')}</dt><dd className="font-medium">{languageName(clean.locale, lang)}</dd></div>
          </dl>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setConfirmOpen(false)}>{t('general_cancel')}</Button>
            <Button type="button" className="min-h-11" onClick={() => void create()} data-mm-lf-confirm-create="">{t('mm_c_lf_confirm_cta')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pill({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
      className={cn('inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border px-3 py-1 text-[13px] text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
      {active && <Check className="h-3 w-3 shrink-0" aria-hidden />}{children}
    </button>
  );
}
