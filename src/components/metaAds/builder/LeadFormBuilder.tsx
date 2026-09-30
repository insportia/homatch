// PREMIUM LEAD FORM — a Meta Instant Form written the HOMATCH way. The
// customer names it, picks contact fields and up to five real-estate
// qualifying questions; HOMATCH writes the form in the chosen language. The
// preview is the same pure leadFormPreview() the server uses, so what is
// shown is what Meta will show. Nothing claims the form exists until the
// server returns Meta's id.
import React, { useMemo, useState } from 'react';
import { Check, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  CONTACT_FIELDS, QUALIFYING_KEYS, leadFormPreview, validateLeadFormSpec, META_LOCALE,
  type ContactField, type FormLocale, type LeadFormSpec, type QualifyingKey,
} from '@/lib/metaAds/leadForms';
import { createPremiumLeadForm } from '@/services/metaAds';
import { leadFormIssueKey, MAX_FORM_QUESTIONS } from './masterLogic';

const LOCALES = Object.keys(META_LOCALE) as FormLocale[];

function languageName(code: string, ui: string): string {
  try { return new Intl.DisplayNames([ui], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

export function LeadFormBuilder({ propertyId, onCreated, onCancel }: {
  propertyId: string | null;
  /** Meta's form id, after the server created it. */
  onCreated: (externalId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t, lang } = useLanguage();
  const uiLocale: FormLocale = (LOCALES as string[]).includes(lang) ? lang as FormLocale : 'en';
  const [spec, setSpec] = useState<LeadFormSpec>({
    name: '', headline: '', thankYouMessage: '', contactFields: ['FULL_NAME', 'PHONE', 'EMAIL'],
    questions: ['buy_or_rent', 'budget', 'timeframe'], privacyPolicyUrl: '', followUpUrl: '', locale: uiLocale,
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);

  const clean: LeadFormSpec = useMemo(() => ({
    ...spec,
    name: spec.name.trim(),
    headline: spec.headline?.trim() || null,
    thankYouMessage: spec.thankYouMessage?.trim() || null,
    privacyPolicyUrl: spec.privacyPolicyUrl.trim(),
    followUpUrl: spec.followUpUrl?.trim() || null,
  }), [spec]);
  const issues = useMemo(() => validateLeadFormSpec(clean), [clean]);
  const preview = useMemo(() => leadFormPreview(clean), [clean]);
  // Question labels for the picker, in the customer's own language.
  const questionLabels = useMemo(() => leadFormPreview({ ...clean, questions: QUALIFYING_KEYS, locale: uiLocale }).questions, [clean, uiLocale]);
  const set = (p: Partial<LeadFormSpec>) => { setSpec((s) => ({ ...s, ...p })); setServerIssues([]); };
  const issueFor = (field: string) => (touched ? issues.find((i) => i.field === field) : undefined);

  const toggleContact = (f: ContactField) => set({ contactFields: spec.contactFields.includes(f) ? spec.contactFields.filter((x) => x !== f) : CONTACT_FIELDS.filter((x) => x === f || spec.contactFields.includes(x)) });
  const toggleQuestion = (q: QualifyingKey) => {
    if (spec.questions.includes(q)) set({ questions: spec.questions.filter((x) => x !== q) });
    else if (spec.questions.length < MAX_FORM_QUESTIONS) set({ questions: [...spec.questions, q] });
  };

  const create = async () => {
    setTouched(true);
    if (issues.length) return;
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
      else if (code === 'NO_PAGE') toast.error(t('madsb_gap_page'));
      else if (String(err?.message ?? '').startsWith('meta_err')) toast.error(t(String(err.message)));
      else toast.error(t('mads_load_failed'));
    } finally { setBusy(false); }
  };

  const fieldErr = (field: string) => {
    const i = issueFor(field);
    return i ? <span className="mt-1 block text-2xs text-destructive">{t(leadFormIssueKey(i.code))}</span> : null;
  };

  return (
    <div data-mm-lead-form-builder="" className="space-y-4 rounded-2xl border border-border bg-[hsl(var(--secondary))]/30 p-3.5 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{t('mm_b_lf_title')}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t('mm_b_lf_lead')}</p>
      </div>

      {permissionNeeded && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] px-3.5 py-3 text-[13px] leading-relaxed text-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />
          <span>{t('mm_b_lf_permission')}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="min-w-0 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_name')}</span>
            <Input value={spec.name} maxLength={100} placeholder={t('madsb_form_name_ph')} aria-invalid={!!issueFor('name')} onChange={(e) => set({ name: e.target.value })} />
            <span className="mt-1 block text-2xs text-muted-foreground">{t('mm_b_lf_name_d')}</span>
            {fieldErr('name')}
          </label>
          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-foreground">
              {t('mm_b_lf_headline')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{(spec.headline ?? '').length}/60</span>
            </span>
            <Input value={spec.headline ?? ''} maxLength={60} placeholder={t('mm_b_lf_headline_ph')} onChange={(e) => set({ headline: e.target.value })} />
            {fieldErr('headline')}
          </label>

          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-foreground">{t('mm_b_lf_contact')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {CONTACT_FIELDS.map((f) => (
                <Pill key={f} active={spec.contactFields.includes(f)} onClick={() => toggleContact(f)}>{t(`madsb_form_field_${f.toLowerCase()}`)}</Pill>
              ))}
            </div>
            <span className="mt-1 block text-2xs text-muted-foreground">{t('mm_b_lf_contact_d')}</span>
            {fieldErr('contactFields')}
          </fieldset>

          <fieldset>
            <legend className="mb-1 flex w-full items-baseline justify-between text-[13px] font-medium text-foreground">
              {t('mm_b_lf_questions')}<span className="text-2xs font-normal text-muted-foreground" dir="ltr">{spec.questions.length}/{MAX_FORM_QUESTIONS}</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {questionLabels.map((q) => {
                const on = spec.questions.includes(q.key);
                return (
                  <Pill key={q.key} active={on} disabled={!on && spec.questions.length >= MAX_FORM_QUESTIONS} onClick={() => toggleQuestion(q.key)}>
                    <span dir="auto">{q.label}</span>
                  </Pill>
                );
              })}
            </div>
            <span className="mt-1 block text-2xs text-muted-foreground">{t('mm_b_lf_questions_d', { n: String(MAX_FORM_QUESTIONS) })}</span>
            {fieldErr('questions')}
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_privacy')}</span>
            <Input dir="ltr" inputMode="url" placeholder="https://" value={spec.privacyPolicyUrl} aria-invalid={!!issueFor('privacyPolicyUrl')}
              onChange={(e) => set({ privacyPolicyUrl: e.target.value })} />
            <span className="mt-1 block text-2xs text-muted-foreground">{t('madsb_form_privacy_why')}</span>
            {fieldErr('privacyPolicyUrl')}
          </label>
          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-foreground">
              {t('mm_b_lf_thanks')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span>
            </span>
            <Textarea rows={2} maxLength={500} value={spec.thankYouMessage ?? ''} placeholder={preview.thankYou.body} onChange={(e) => set({ thankYouMessage: e.target.value })} />
            {fieldErr('thankYouMessage')}
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_follow_up')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
            <Input dir="ltr" inputMode="url" placeholder="https://" value={spec.followUpUrl ?? ''} aria-invalid={!!issueFor('followUpUrl')}
              onChange={(e) => set({ followUpUrl: e.target.value })} />
            {fieldErr('followUpUrl')}
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">{t('mm_b_lf_locale')}</span>
            <select value={spec.locale} onChange={(e) => set({ locale: e.target.value as FormLocale })}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
              {LOCALES.map((l) => <option key={l} value={l}>{languageName(l, lang)}</option>)}
            </select>
            <span className="mt-1 block text-2xs text-muted-foreground">{t('mm_b_lf_locale_d')}</span>
          </label>
        </div>

        {/* LIVE PREVIEW — the labels Meta will show, in the form's language. */}
        <div className="min-w-0" aria-label={t('mm_b_lf_preview')} role="region">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mm_b_lf_preview')}</p>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-3.5 shadow-card" dir={spec.locale === 'ar' || spec.locale === 'he' ? 'rtl' : 'ltr'} lang={spec.locale}>
            {preview.headline && <p className="text-sm font-semibold text-foreground">{preview.headline}</p>}
            <div className="space-y-1.5">
              {preview.contact.map((f) => (
                <div key={f} className="rounded-lg border border-border px-2.5 py-1.5 text-2xs text-muted-foreground">{t(`madsb_form_field_${f.toLowerCase()}`)}</div>
              ))}
            </div>
            {preview.questions.map((q) => (
              <div key={q.key}>
                <p className="text-[13px] font-medium text-foreground">{q.label}</p>
                {q.options ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {q.options.map((o) => <span key={o} className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">{o}</span>)}
                  </div>
                ) : <div className="mt-1 h-7 rounded-lg border border-dashed border-border" aria-hidden />}
              </div>
            ))}
            <p className="text-2xs text-[hsl(var(--gold-ink))] underline">{preview.privacyLinkText}</p>
            <div className="rounded-xl bg-[hsl(var(--secondary))]/60 p-2.5">
              <p className="text-[13px] font-semibold text-foreground">{preview.thankYou.title}</p>
              <p className="text-2xs text-muted-foreground">{preview.thankYou.body}</p>
            </div>
          </div>
        </div>
      </div>

      {serverIssues.length > 0 && (
        <ul className="space-y-1 text-2xs text-destructive" role="status">
          {[...new Set(serverIssues)].map((c) => <li key={c}>{t(leadFormIssueKey(c))}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={create} disabled={busy || (touched && issues.length > 0)} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('mm_b_lf_create')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('general_cancel')}</Button>
      </div>
      <p className="text-2xs leading-relaxed text-muted-foreground" aria-live="polite">{busy ? t('mm_b_lf_creating') : ''}</p>
    </div>
  );
}

function Pill({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-2xs text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
      {active && <Check className="h-3 w-3 shrink-0" aria-hidden />}{children}
    </button>
  );
}
