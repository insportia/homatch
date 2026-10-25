// MY GEORGIA BY HOMI — the five-step onboarding.
//
// Owner-approved copy (2026-10-24), used exactly through the mg_* keys.
// Mostly taps: cards, chips and a searchable country list; the only typing is
// a name and an optional note. Every change autosaves (to the account when
// signed in, to this device before), the page resumes at the saved step, the
// account's name and email are prefilled, and a question that does not apply
// to the answers so far is not asked.

import React from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Search } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import PageMeta from '@/components/common/PageMeta';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { countryName } from '@/components/matching/workspace/format';
import { COUNTRY_CODES } from '@/myGeorgia/countries';
import {
  BUDGET_BANDS, EMPTY_ANSWERS, GEORGIA_CITIES, NOTES_MAX, PROPERTY_INTENTS, RENT_BANDS, RENT_CURRENCIES,
  STAY_LENGTHS, SUPPORT_TOPICS, TOTAL_STEPS, VISIT_STATUSES, asksArrival, budgetKind, normalise,
  stepComplete, stepSkippable, type MyGeorgiaAnswers, type RentBand, type RentCurrency,
} from '@/myGeorgia/answers';
import { clearDraft, loadDraft, loadMyGeorgia, saveDraft, saveMyGeorgia } from '@/services/myGeorgia';
import { rememberPendingPath } from '@/services/returnTo';
import { rememberPendingAsk } from '@/lib/pendingAsk';
import '@/components/expats/expats.css';

type Phase = 'LOADING' | 'WELCOME' | 'STEP' | 'SUCCESS';

const SYMBOL: Record<RentCurrency, string> = { USD: '$', GEL: '₾', EUR: '€' };
const RENT_LIMITS: Record<Exclude<RentBand, 'CUSTOM' | 'UNDECIDED'>, [number | null, number | null]> = {
  UP_TO_500: [null, 500], FROM_500_TO_1000: [500, 1000], FROM_1000_TO_2000: [1000, 2000], OVER_2000: [2000, null],
};

function Chip({ on, onClick, children, multi = false }: { on: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean }) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-start text-sm font-medium transition-colors motion-reduce:transition-none',
        on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/15 text-foreground' : 'border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))]',
      )}
    >
      {multi ? (
        <span aria-hidden="true" className={cn('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#0C1119]' : 'border-border')}>
          {on ? <Check className="h-3 w-3" /> : null}
        </span>
      ) : null}
      {children}
    </button>
  );
}

function Field({ label, children, helper }: { label: string; children: React.ReactNode; helper?: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      {children}
      {helper ? <p className="text-xs leading-relaxed text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function CountryPicker({ value, onChange }: { value: string | null; onChange: (code: string) => void }) {
  const { t, lang } = useLanguage();
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const options = React.useMemo(
    /* Searchable in the reader's language and in English: some browsers have no Georgian region names. */
    () => COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c, lang), en: countryName(c, 'en').toLocaleLowerCase() })).sort((a, b) => a.name.localeCompare(b.name, lang)),
    [lang],
  );
  const q = query.trim().toLocaleLowerCase();
  const shown = (q ? options.filter((o) => o.name.toLocaleLowerCase().includes(q) || o.en.includes(q) || o.code.toLowerCase() === q) : options).slice(0, 8);
  const listId = 'mg-country-list';
  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t('mg_country')}
          placeholder={value ? countryName(value, lang) : t('mg_country_placeholder')}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          className={cn('min-h-11 w-full rounded-xl border border-border bg-background ps-9 pe-3 text-sm text-foreground',
            value ? 'placeholder:text-foreground' : 'placeholder:text-muted-foreground')}
        />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="mt-2 max-h-72 overflow-auto rounded-xl border border-border bg-card p-1 shadow-card">
          {shown.map((o) => (
            <li key={o.code} role="option" aria-selected={value === o.code}>
              <button
                type="button"
                onClick={() => { onChange(o.code); setQuery(''); setOpen(false); }}
                className={cn('flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-start text-sm',
                  value === o.code ? 'bg-[hsl(var(--gold))]/15 font-semibold' : 'hover:bg-accent')}
              >
                {o.name}
                {value === o.code ? <Check className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function MyGeorgiaStartPage() {
  const { t, lang } = useLanguage();
  const { homatchUser, status } = useAuth();
  const navigate = useNavigate();
  const userId = homatchUser?.id ?? null;

  const [phase, setPhase] = React.useState<Phase>('LOADING');
  const [step, setStep] = React.useState(1);
  const [answers, setAnswers] = React.useState<MyGeorgiaAnswers>(EMPTY_ANSWERS);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const dirty = React.useRef(false);

  /* Load: the account first, then this device; prefill the name from the account. */
  React.useEffect(() => {
    if (status === 'UNKNOWN') return;
    let live = true;
    void (async () => {
      const fromAccount = userId ? await loadMyGeorgia(userId) : null;
      const draft = loadDraft();
      const state = fromAccount && (fromAccount.step > 0 || fromAccount.completedAt) ? fromAccount : draft ?? fromAccount;
      if (!live) return;
      const [first, ...rest] = (homatchUser?.full_name ?? '').trim().split(/\s+/);
      const base = state?.answers ?? EMPTY_ANSWERS;
      setAnswers({ ...base, firstName: base.firstName || first || '', lastName: base.lastName || rest.join(' ') });
      if (state?.completedAt && fromAccount?.completedAt) { setPhase('SUCCESS'); return; }
      /* A profile finished before signing up is saved the moment the account exists. */
      if (userId && draft && draft.step >= TOTAL_STEPS && draft.completedAt === 'PENDING') {
        setBusy(true);
        await saveMyGeorgia(userId, draft.answers, TOTAL_STEPS, true);
        clearDraft();
        if (live) { setBusy(false); setPhase('SUCCESS'); }
        return;
      }
      if (state && state.step > 0) { setStep(Math.min(TOTAL_STEPS, Math.max(1, state.step))); setPhase('STEP'); }
      else setPhase('WELCOME');
    })();
    return () => { live = false; };
  }, [status, userId, homatchUser?.full_name]);

  /* Autosave, gently debounced. */
  React.useEffect(() => {
    if (phase !== 'STEP' || !dirty.current) return undefined;
    setSaved(false);
    const timer = window.setTimeout(() => {
      if (userId) void saveMyGeorgia(userId, answers, step).then((r) => setSaved(!r.error));
      else { saveDraft({ answers, step, completedAt: null }); setSaved(true); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [answers, step, phase, userId]);

  const update = (patch: Partial<MyGeorgiaAnswers>) => {
    dirty.current = true;
    setAnswers((a) => normalise({ ...a, ...patch }));
  };
  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const go = (next: number) => { dirty.current = true; setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const finish = async () => {
    if (!userId) {
      saveDraft({ answers, step: TOTAL_STEPS, completedAt: 'PENDING' });
      rememberPendingPath('/my-georgia/start');
      navigate('/auth/signup');
      return;
    }
    setBusy(true);
    const r = await saveMyGeorgia(userId, answers, TOTAL_STEPS, true);
    setBusy(false);
    if (!r.error) { clearDraft(); setPhase('SUCCESS'); }
  };

  const later = () => {
    if (userId) void saveMyGeorgia(userId, answers, step);
    else saveDraft({ answers, step, completedAt: null });
    navigate('/my-georgia');
  };

  const askHomi = () => {
    const prompt = t('mg_homi_prompt');
    if (!userId) rememberPendingAsk(prompt);
    navigate('/ai', { state: { prompt, context: { type: 'workspace', data: { surface: 'my-georgia' } } } });
  };

  if (status === 'AUTHENTICATED' && !userId) return null;
  const money = (n: number) => `${SYMBOL[answers.rentCurrency]}${n.toLocaleString(lang === 'ka' ? 'ka-GE' : lang)}`;
  const rentLabel = (b: RentBand) => {
    if (b === 'CUSTOM') return t('mg_rent_custom');
    if (b === 'UNDECIDED') return t('mg_budget_undecided');
    const [lo, hi] = RENT_LIMITS[b];
    if (lo === null && hi !== null) return t('mg_rent_up_to', { amount: money(hi) });
    if (hi === null && lo !== null) return t('mg_rent_over', { amount: money(lo) });
    return t('mg_rent_range', { from: money(lo as number), to: money(hi as number) });
  };

  const kind = budgetKind(answers.propertyIntent);
  const canContinue = stepComplete(step, answers);

  return (
    <AppLayout noPadding>
      <PageMeta title={t('mg_product')} description={t('mg_welcome_body')} />
      <div className="expat-page min-h-[calc(100vh-4rem)] bg-[#0C1119] px-4 py-8 text-white sm:py-14">
        <div className="mx-auto w-full max-w-[40rem]">
          <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-[hsl(var(--gold))]">
            <HomiAvatar state={phase === 'SUCCESS' ? 'happy' : 'listening'} size={36} animate={false} />
            {t('mg_product')}
          </p>

          {phase === 'LOADING' || busy ? (
            <div aria-hidden="true" className="h-64 animate-pulse rounded-3xl bg-white/5 motion-reduce:animate-none" />
          ) : phase === 'WELCOME' ? (
            <section data-mg-welcome className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-10">
              <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{t('mg_welcome_title')}</h1>
              <p className="mt-4 text-base leading-relaxed text-white/75">{t('mg_welcome_body')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={() => { setPhase('STEP'); go(1); }}
                  className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-7 text-sm font-semibold text-[#0C1119]">
                  {t('mg_start')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </button>
                <Link to="/my-georgia" className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-6 text-sm font-medium text-white/85">
                  {t('mg_later')}
                </Link>
              </div>
            </section>
          ) : phase === 'SUCCESS' ? (
            <section data-mg-success className="rounded-3xl border border-[hsl(var(--gold))]/40 bg-white/[0.03] p-6 text-center sm:p-10">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--gold))] text-[#0C1119]">
                <Check className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="font-display text-3xl font-semibold">{t('mg_success_title')}</h1>
              <p className="mx-auto mt-3 max-w-[36ch] text-base leading-relaxed text-white/75">{t('mg_success_body')}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link to="/my-georgia" className="inline-flex min-h-12 items-center rounded-full bg-[hsl(var(--gold))] px-7 text-sm font-semibold text-[#0C1119]">
                  {t('mg_view_profile')}
                </Link>
                <button type="button" onClick={askHomi} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/20 px-6 text-sm font-medium">
                  <HomiAvatar state="happy" size={24} animate={false} /> {t('mg_ask_homi')}
                </button>
              </div>
            </section>
          ) : (
            <section data-mg-step={step} className="rounded-3xl bg-card p-5 text-foreground shadow-card sm:p-8">
              <div className="mb-6 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step}>
                  <div className="h-full bg-[hsl(var(--gold))] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{step} / {TOTAL_STEPS}</span>
                <span aria-live="polite" className={cn('text-xs text-emerald-700 transition-opacity motion-reduce:transition-none', saved ? 'opacity-100' : 'opacity-0')}>
                  {t('mg_saved')}
                </span>
              </div>

              <div key={step} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 space-y-6">
                {step === 1 && (
                  <>
                    <header><h1 className="font-display text-2xl font-semibold">{t('mg_s1_title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('mg_s1_body')}</p></header>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2"><span className="text-sm font-semibold">{t('mg_first_name')}</span>
                        <input value={answers.firstName} onChange={(e) => update({ firstName: e.target.value })} autoComplete="given-name"
                          className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
                      <label className="space-y-2"><span className="text-sm font-semibold">{t('mg_last_name')}</span>
                        <input value={answers.lastName} onChange={(e) => update({ lastName: e.target.value })} autoComplete="family-name"
                          className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
                    </div>
                    <Field label={t('mg_country')}><CountryPicker value={answers.country} onChange={(c) => update({ country: c })} /></Field>
                    {homatchUser?.email ? (
                      <Field label={t('mg_email')} helper={t('mg_email_helper')}>
                        <input value={homatchUser.email} readOnly dir="ltr" aria-readonly="true"
                          className="min-h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-muted-foreground" />
                      </Field>
                    ) : null}
                  </>
                )}

                {step === 2 && (
                  <>
                    <header><h1 className="font-display text-2xl font-semibold">{t('mg_s2_title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('mg_s2_body')}</p></header>
                    <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2" role="radiogroup" aria-label={t('mg_s2_title')}>
                      {PROPERTY_INTENTS.map((i) => {
                        const on = answers.propertyIntent === i;
                        return (
                          <button key={i} type="button" role="radio" aria-checked={on} onClick={() => update({ propertyIntent: i })}
                            className={cn('min-h-20 rounded-2xl border p-4 text-start transition-colors motion-reduce:transition-none',
                              on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/10 ring-1 ring-[hsl(var(--gold))]' : 'border-border hover:border-[hsl(var(--gold-border))]')}>
                            <span className="block text-base font-semibold">{t(`mg_intent_${i.toLowerCase()}`)}</span>
                            <span className="mt-1 block text-sm text-muted-foreground">{t(`mg_intent_${i.toLowerCase()}_h`)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Field label={t('mg_cities_q')}>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={t('mg_cities_q')}>
                        {GEORGIA_CITIES.map((c) => (
                          <Chip key={c} multi on={answers.cities.includes(c)} onClick={() => update({ cities: toggle(answers.cities, c) })}>
                            {t(`mg_city_${c.toLowerCase()}`)}
                          </Chip>
                        ))}
                      </div>
                    </Field>
                    {kind === 'PURCHASE' ? (
                      <Field label={t('mg_budget_q')}>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('mg_budget_q')}>
                          {BUDGET_BANDS.map((b) => (
                            <Chip key={b} on={answers.budgetBand === b} onClick={() => update({ budgetBand: b })}>{t(`mg_budget_${b.toLowerCase()}`)}</Chip>
                          ))}
                        </div>
                      </Field>
                    ) : kind === 'RENT' ? (
                      <Field label={`${t('mg_budget_q')} · ${t('mg_rent_per_month')}`}>
                        <div className="mb-3 flex gap-2" role="radiogroup" aria-label={t('mg_rent_currency')}>
                          {RENT_CURRENCIES.map((c) => (
                            <Chip key={c} on={answers.rentCurrency === c} onClick={() => update({ rentCurrency: c })}>{SYMBOL[c]} {c}</Chip>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('mg_budget_q')}>
                          {RENT_BANDS.map((b) => (
                            <Chip key={b} on={answers.rentBand === b} onClick={() => update({ rentBand: b })}>{rentLabel(b)}</Chip>
                          ))}
                        </div>
                        {answers.rentBand === 'CUSTOM' ? (
                          <label className="mt-3 block space-y-2"><span className="text-sm font-semibold">{t('mg_rent_amount_label')}</span>
                            <input type="number" inputMode="numeric" min={1} value={answers.rentAmount ?? ''} dir="ltr"
                              onChange={(e) => update({ rentAmount: e.target.value ? Number(e.target.value) : null })}
                              className="min-h-11 w-full max-w-[14rem] rounded-xl border border-border bg-background px-3 text-sm" /></label>
                        ) : null}
                      </Field>
                    ) : null}
                  </>
                )}

                {step === 3 && (
                  <>
                    <header><h1 className="font-display text-2xl font-semibold">{t('mg_s3_title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('mg_s3_body')}</p></header>
                    <Field label={t('mg_visit_q')}>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('mg_visit_q')}>
                        {VISIT_STATUSES.map((v) => (
                          <Chip key={v} on={answers.visitStatus === v} onClick={() => update({ visitStatus: v })}>{t(`mg_visit_${v.toLowerCase()}`)}</Chip>
                        ))}
                      </div>
                    </Field>
                    {asksArrival(answers.visitStatus) ? (
                      <Field label={t('mg_arrival_q')}>
                        <div className="flex flex-wrap items-center gap-3">
                          <input type="date" value={answers.arrivalDate ?? ''} disabled={answers.arrivalUnknown} aria-label={t('mg_arrival_q')}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => update({ arrivalDate: e.target.value || null })}
                            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm disabled:opacity-50" />
                          <Chip multi on={answers.arrivalUnknown} onClick={() => update({ arrivalUnknown: !answers.arrivalUnknown })}>{t('mg_arrival_unknown')}</Chip>
                        </div>
                      </Field>
                    ) : null}
                    <Field label={t('mg_stay_q')}>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('mg_stay_q')}>
                        {STAY_LENGTHS.map((s) => (
                          <Chip key={s} on={answers.stayLength === s} onClick={() => update({ stayLength: s })}>{t(`mg_stay_${s.toLowerCase()}`)}</Chip>
                        ))}
                      </div>
                    </Field>
                  </>
                )}

                {step === 4 && (
                  <>
                    <header><h1 className="font-display text-2xl font-semibold">{t('mg_s4_title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('mg_s4_body')}</p></header>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={t('mg_s4_title')}>
                      {SUPPORT_TOPICS.map((s) => (
                        <Chip key={s} multi on={answers.supportTopics.includes(s)} onClick={() => update({ supportTopics: toggle(answers.supportTopics, s) })}>
                          {t(`mg_support_${s.toLowerCase()}`)}
                        </Chip>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('mg_s4_helper')}</p>
                  </>
                )}

                {step === 5 && (
                  <>
                    <header><h1 className="font-display text-2xl font-semibold">{t('mg_s5_title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('mg_s5_body')}</p></header>
                    <textarea value={answers.notes} maxLength={NOTES_MAX} rows={6} aria-label={t('mg_s5_title')}
                      placeholder={t('mg_notes_placeholder')} onChange={(e) => update({ notes: e.target.value })}
                      className="w-full rounded-2xl border border-border bg-background p-4 text-sm leading-relaxed" />
                    <p className="text-xs text-muted-foreground">{t('mg_notes_helper')} {t('mg_notes_private')}</p>
                    {!userId ? <p className="rounded-xl bg-muted p-3 text-sm text-foreground">{t('mg_signup_to_save')}</p> : null}
                  </>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                {step > 1 ? (
                  <button type="button" onClick={() => go(step - 1)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium">
                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t('mg_back')}
                  </button>
                ) : null}
                {step < TOTAL_STEPS ? (
                  <button type="button" aria-disabled={!canContinue} onClick={() => { if (canContinue) go(step + 1); }}
                    className={cn('inline-flex min-h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold',
                      canContinue ? 'bg-[#0C1119] text-white' : 'cursor-not-allowed bg-muted text-muted-foreground')}>
                    {t('mg_continue')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" onClick={() => void finish()} data-mg-create
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-6 text-sm font-semibold text-[#0C1119]">
                    {t('mg_create_profile')}
                  </button>
                )}
                {stepSkippable(step) && step < TOTAL_STEPS ? (
                  <button type="button" onClick={() => go(step + 1)} className="inline-flex min-h-11 items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline">
                    {t('mg_skip')}
                  </button>
                ) : null}
                <button type="button" onClick={later} className="ms-auto inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground hover:text-foreground">
                  {t('mg_continue_later')}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export function MyGeorgiaStartRedirect() {
  return <Navigate to="/my-georgia/start" replace />;
}
