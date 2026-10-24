// HOMATCH FOR EXPATS — "let's build your plan together".
//
// Five questions, one at a time, each answered with a tap. The answers are
// written onto the same ExpatProfile the plan engine already reads, so the
// checklist that follows is the existing, tested roadmap (saved per person,
// progress kept when the plan is regenerated). Nothing here states a legal
// rule, a fee or a deadline: those live in the sourced topic pages.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import type { ExpatProfile, Household } from '@/expats/types';
import type { TaskCategory } from '@/expats/plan/roadmap';
import type { PlanTask } from '@/expats/plan/tasks';

import {
  HOUSING_PLAN, arrivalFor, housingFromPlan, intentsFor, reasonFromIntents, whenFromArrival,
  type Housing, type Reason, type When,
} from '@/expats/journeyAnswers';
export type Focus = 'HOUSING' | 'DOCUMENTS' | 'BANKING' | 'FAMILY' | 'BUSINESS';

const REASONS: Reason[] = ['LIVE', 'WORK', 'STUDY', 'INVEST', 'BROWSING'];
const WHENS: When[] = ['MONTH', 'QUARTER', 'HALF_YEAR', 'LATER', 'HERE'];
const HOUSINGS: Housing[] = ['SEARCH', 'RENT', 'BUY', 'CHOSEN'];
const FOCUSES: Focus[] = ['HOUSING', 'DOCUMENTS', 'BANKING', 'FAMILY', 'BUSINESS'];

export const FOCUS_CATEGORIES: Record<Focus, TaskCategory[]> = {
  HOUSING: ['HOUSING', 'PROPERTY', 'UTILITIES'],
  DOCUMENTS: ['DOCUMENTS', 'RESIDENCY'],
  BANKING: ['BANKING', 'TAX', 'INSURANCE'],
  FAMILY: ['FAMILY', 'HEALTHCARE', 'PETS'],
  BUSINESS: ['BUSINESS', 'TAX'],
};
const FOCUS_KEY = 'homatch.expat.focus.v1';

export function loadFocus(): Focus | null {
  try { const v = localStorage.getItem(FOCUS_KEY); return v && (FOCUSES as string[]).includes(v) ? v as Focus : null; } catch { return null; }
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border px-4 py-2 text-start text-sm font-medium transition-colors',
        on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))]')}>
      {children}
    </button>
  );
}

export function ExpatJourney({ profile, saving, onDone, onCancel }: {
  profile: ExpatProfile;
  saving: boolean;
  onDone: (next: ExpatProfile, focus: Focus) => void;
  onCancel?: () => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);
  /* Starting from the saved plan, so "change my answers" never resets what is there. */
  const [reason, setReason] = useState<Reason | null>(() => reasonFromIntents(profile.intents ?? []));
  const [when, setWhen] = useState<When | null>(() => whenFromArrival(profile.arrivalDate));
  const [household, setHousehold] = useState<Household | null>(profile.household);
  const [housing, setHousing] = useState<Housing | null>(() => housingFromPlan(profile.housingPlan));
  const [focus, setFocus] = useState<Focus | null>(loadFocus());

  const steps = [
    { q: 'expat_journey_q_why', ok: reason !== null },
    { q: 'expat_journey_q_when', ok: when !== null },
    { q: 'expat_journey_q_who', ok: household !== null },
    { q: 'expat_journey_q_housing', ok: housing !== null },
    { q: 'expat_journey_q_first', ok: focus !== null },
  ];

  const finish = () => {
    if (!reason || !when || !household || !housing || !focus) return;
    const arrival = arrivalFor(when, profile.arrivalDate);
    try { localStorage.setItem(FOCUS_KEY, focus); } catch { /* storage unavailable */ }
    onDone({ ...profile, intents: intentsFor(reason, profile.intents ?? []), arrivalDate: arrival, household, housingPlan: HOUSING_PLAN[housing] }, focus);
  };

  return (
    <section aria-labelledby="expat-journey-title" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-4">
        <HomiAvatar state={step === 4 ? 'encouraging' : 'listening'} crop="upper" size={60} />
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--gold-ink))]">{t('expat_journey_eyebrow')}</p>
          <h2 id="expat-journey-title" className="mt-1 font-display text-xl font-semibold text-foreground">{t('expat_journey_title')}</h2>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step + 1} aria-label={t('expat_journey_step', { n: step + 1, total: 5 })}>
          <div className="h-full bg-[hsl(var(--gold))] transition-[width] motion-reduce:transition-none" style={{ width: `${((step + 1) / 5) * 100}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">{t('expat_journey_step', { n: step + 1, total: 5 })}</span>
      </div>

      <p id="expat-journey-q" className="mt-5 text-base font-semibold text-foreground">{t(steps[step].q)}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-labelledby="expat-journey-q">
        {step === 0 && REASONS.map((r) => <Pill key={r} on={reason === r} onClick={() => setReason(r)}>{t(`expat_journey_why_${r.toLowerCase()}`)}</Pill>)}
        {step === 1 && WHENS.map((w) => <Pill key={w} on={when === w} onClick={() => setWhen(w)}>{t(`expat_journey_when_${w.toLowerCase()}`)}</Pill>)}
        {step === 2 && (['ALONE', 'COUPLE', 'FAMILY'] as Household[]).map((h) => <Pill key={h} on={household === h} onClick={() => setHousehold(h)}>{t(`expat_journey_who_${h.toLowerCase()}`)}</Pill>)}
        {step === 3 && HOUSINGS.map((h) => <Pill key={h} on={housing === h} onClick={() => setHousing(h)}>{t(`expat_journey_housing_${h.toLowerCase()}`)}</Pill>)}
        {step === 4 && FOCUSES.map((f) => <Pill key={f} on={focus === f} onClick={() => setFocus(f)}>{t(`expat_journey_first_${f.toLowerCase()}`)}</Pill>)}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground">
            {t('expat_journey_back')}
          </button>
        )}
        <button
          type="button"
          aria-disabled={!steps[step].ok || saving}
          onClick={() => { if (!steps[step].ok || saving) return; if (step < 4) setStep(step + 1); else finish(); }}
          className={cn('inline-flex min-h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold',
            steps[step].ok && !saving ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'cursor-not-allowed bg-muted text-muted-foreground')}
        >
          {step < 4 ? t('expat_journey_next') : saving ? t('expat_journey_building') : t('expat_journey_save')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center px-3 text-sm text-muted-foreground">
            {t('expat_journey_cancel')}
          </button>
        )}
      </div>
    </section>
  );
}

/** "შემდეგი ნაბიჯი": the first open tasks in the area the person asked for help with first. */
export function ExpatNextStep({ tasks, focus, onEdit }: { tasks: PlanTask[]; focus: Focus | null; onEdit: () => void }) {
  const { t } = useLanguage();
  const open = tasks.filter((x) => x.status !== 'DONE' && x.status !== 'NOT_APPLICABLE');
  const inFocus = focus ? open.filter((x) => FOCUS_CATEGORIES[focus].includes(x.category)) : [];
  const next = (inFocus.length ? inFocus : open).slice(0, 3);
  const allDone = tasks.length > 0 && open.length === 0;
  return (
    <section aria-labelledby="expat-next-title" className="mt-6 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="expat-next-title" className="font-display text-lg font-semibold text-foreground">{t('expat_journey_your_plan')}</h2>
        <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground">
          {t('expat_journey_change')}
        </button>
      </div>
      {allDone ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('expat_journey_all_done')}</p>
      ) : next.length ? (
        <>
          <p className="mt-3 text-sm font-semibold text-foreground">{t('expat_journey_next_step')}</p>
          <ol className="mt-2 grid gap-2">
            {next.map((task) => (
              <li key={task.id} className="rounded-xl border border-border bg-background p-3">
                <p className="text-sm font-medium text-foreground">{t(task.titleKey)}</p>
                <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">{t('expat_journey_why_matters')}</span> {t(task.whyKey)}</p>
                {task.topicKey && (
                  <Link to={`/for-expats/georgia/${task.topicKey}`} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[hsl(var(--gold-ink))]">
                    {t('expat_journey_docs')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <Link to="/ai" state={{ context: { type: 'workspace', data: { surface: 'expats', focus, openTasks: open.slice(0, 8).map((x) => t(x.titleKey)) } }, prompt: t('expat_journey_ask_prompt') }}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
        <HomiAvatar state="happy" size={26} animate={false} /> {t('expat_journey_ask_homi')}
      </Link>
    </section>
  );
}
