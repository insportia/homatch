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

import React from 'react';
import { ArrowRight, Building2, Hammer, KeyRound, Scale } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { STRATEGIES, STRATEGY_ORDER, type StrategyId } from '@/investment/strategies/definitions';

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

  return (
    <div className="mx-auto w-full max-w-[72rem] px-5 py-12 sm:py-16">
      <header className="mb-10 max-w-[44rem]">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          {t('inv_product_eyebrow')}
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {t('inv_home_title')}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t('inv_home_body')}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {STRATEGY_ORDER.map((id) => {
          const strategy = STRATEGIES[id];
          const Icon = ICONS[id];
          const isResumable = resumable === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={cn(
                'hm-invest-panel group flex min-h-[11rem] flex-col p-6 text-start transition-all',
                'hover:border-[hsl(var(--gold-border))] hover:shadow-[var(--shadow-hover)]',
                isResumable && 'border-[hsl(var(--gold-border))]',
              )}
            >
              <span className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
                  <Icon className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                </span>
                {isResumable ? (
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
