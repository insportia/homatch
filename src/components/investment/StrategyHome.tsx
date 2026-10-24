// HOMATCH INVESTMENT INTELLIGENCE — the front door.
//
// Four products, not four calculators. The card carries the business model
// in the investor's own words — Buy → Renovate → Sell — because that is how
// somebody decides which one they are doing, and a tile labelled "ROI
// calculator" would make them work it out.
//
// WHY THE CARDS ARE LARGE
//
// This is the choice the entire rest of the experience depends on: it
// decides which questions get asked, which engine runs, and what the
// headline means. Four cramped tiles would treat it as navigation. It is
// the first analytical decision.

import React, { useState } from 'react';
import { ArrowRight, Building2, Hammer, KeyRound, Scale } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { STRATEGIES, STRATEGY_ORDER, type StrategyId } from '@/investment/strategies/definitions';

/*
 * GOAL FIRST. One question, four answers, and the strategies that fit are
 * marked and moved to the front. The four strategies stay the home: the goal
 * only says where to start, and "not sure" gets two more taps, not a form.
 */
type Goal = 'INCOME' | 'GROWTH' | 'BOTH' | 'UNSURE';
type Horizon = 'SHORT' | 'LONG';
type Involvement = 'ACTIVE' | 'PASSIVE';
const GOALS: Goal[] = ['INCOME', 'GROWTH', 'BOTH', 'UNSURE'];

export function recommendedFor(goal: Goal | null, horizon: Horizon | null, involvement: Involvement | null): StrategyId[] {
  switch (goal) {
    case 'INCOME': return ['RENTAL_INVESTMENT'];
    case 'GROWTH': return ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE'];
    case 'BOTH': return ['RENTAL_INVESTMENT', 'INVESTMENT_VALUE'];
    case 'UNSURE':
      if (!horizon || !involvement) return [];
      if (horizon === 'SHORT') return involvement === 'ACTIVE' ? ['RENOVATE_RESELL'] : ['CONSTRUCTION_RESALE'];
      return involvement === 'ACTIVE' ? ['RENTAL_INVESTMENT'] : ['RENTAL_INVESTMENT', 'INVESTMENT_VALUE'];
    default: return [];
  }
}

const ICONS: Record<StrategyId, typeof Hammer> = {
  RENOVATE_RESELL: Hammer,
  CONSTRUCTION_RESALE: Building2,
  RENTAL_INVESTMENT: KeyRound,
  INVESTMENT_VALUE: Scale,
};

export function StrategyHome({
  onSelect,
  resumable,
}: {
  onSelect: (strategy: StrategyId) => void;
  /** A strategy with work already in it, offered as "pick up where you left off". */
  resumable: StrategyId | null;
}) {
  const { t, isRTL } = useLanguage();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [horizon, setHorizon] = useState<Horizon | null>(null);
  const [involvement, setInvolvement] = useState<Involvement | null>(null);
  const picks = recommendedFor(goal, horizon, involvement);
  const ordered = [...STRATEGY_ORDER].sort((a, b) => Number(picks.includes(b)) - Number(picks.includes(a)));
  const pill = (on: boolean) => cn(
    'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
    on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))]',
  );

  return (
    <div className="mx-auto w-full max-w-[72rem] px-5 py-12 sm:py-16">
      {/* NAVY IDENTITY, LIGHT WORKSPACE: the band is the product's one
          structural dark element; the strategy cards below read on white. */}
      <header className="mb-8 overflow-hidden rounded-2xl bg-[#0C1119] px-5 py-6 text-white shadow-hover sm:px-8 sm:py-8">
        <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_60%)]">
          {t('inv_product_eyebrow')}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-white sm:text-4xl">
          {t('inv_home_title')}
        </h1>
        <p className="mt-3 max-w-[44rem] text-base leading-relaxed text-white/80">
          {t('inv_home_body')}
        </p>
        <span className="mt-4 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
      </header>

      <section aria-labelledby="inv-goal-q" className="hm-invest-panel mb-6 p-5 sm:p-6">
        <h2 id="inv-goal-q" className="font-display text-lg font-semibold text-foreground">{t('inv_goal_question')}</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-labelledby="inv-goal-q">
          {GOALS.map((g) => (
            <button key={g} type="button" aria-pressed={goal === g} onClick={() => setGoal(goal === g ? null : g)} className={pill(goal === g)}>
              {t(`inv_goal_${g.toLowerCase()}`)}
            </button>
          ))}
        </div>
        {goal === 'UNSURE' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p id="inv-horizon" className="mb-2 text-sm font-medium text-foreground">{t('inv_goal_horizon_q')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="inv-horizon">
                {(['SHORT', 'LONG'] as Horizon[]).map((h) => (
                  <button key={h} type="button" aria-pressed={horizon === h} onClick={() => setHorizon(h)} className={pill(horizon === h)}>
                    {t(`inv_goal_horizon_${h.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p id="inv-involve" className="mb-2 text-sm font-medium text-foreground">{t('inv_goal_involve_q')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="inv-involve">
                {(['ACTIVE', 'PASSIVE'] as Involvement[]).map((v) => (
                  <button key={v} type="button" aria-pressed={involvement === v} onClick={() => setInvolvement(v)} className={pill(involvement === v)}>
                    {t(`inv_goal_involve_${v.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {picks.length > 0 && <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">{t('inv_goal_picked')}</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {ordered.map((id) => {
          const strategy = STRATEGIES[id];
          const Icon = ICONS[id];
          const isResumable = resumable === id;
          const isPick = picks.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={cn(
                'hm-invest-panel group flex min-h-[11rem] flex-col p-6 text-start transition-all',
                'hover:border-[hsl(var(--gold-border))] hover:shadow-[var(--shadow-hover)]',
                (isResumable || isPick) && 'border-[hsl(var(--gold-border))]',
                isPick && 'ring-2 ring-[hsl(var(--gold))]/40',
              )}
            >
              <span className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
                  <Icon className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                </span>
                {isPick ? (
                  <span className="rounded-full bg-[hsl(var(--gold))] px-2.5 py-1 text-2xs font-semibold text-[hsl(var(--primary-foreground))]">
                    {t('inv_goal_recommended')}
                  </span>
                ) : isResumable ? (
                  <span className="rounded-full border border-[hsl(var(--gold-border))] px-2.5 py-1 text-2xs text-[hsl(var(--gold-ink))]">
                    {t('inv_home_in_progress')}
                  </span>
                ) : null}
              </span>

              <span className="block font-display text-xl font-semibold text-foreground">
                {t(strategy.titleKey)}
              </span>
              <span className="mt-1.5 block text-2xs font-medium uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">
                {t(strategy.flowKey)}
              </span>
              <span className="mt-3 block flex-1 text-sm leading-relaxed text-muted-foreground">
                {t(strategy.descriptionKey)}
              </span>

              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                {isResumable ? t('inv_home_continue') : t('inv_home_start')}
                <ArrowRight
                  className={cn(
                    'h-4 w-4 transition-transform group-hover:translate-x-0.5',
                    isRTL && 'scale-x-[-1] group-hover:-translate-x-0.5',
                  )}
                  aria-hidden="true"
                />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-10 max-w-[56ch] text-2xs leading-relaxed text-muted-foreground">
        {t('inv_home_footnote')}
      </p>
    </div>
  );
}
