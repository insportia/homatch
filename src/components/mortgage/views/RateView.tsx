// HOMATCH HOME FINANCING — why the advertised rate is not the real one.
//
// This is the view the whole product is built around. Two numbers side
// by side is the hook; the bar underneath is the lesson.
//
// THE BAR IS THE ARGUMENT
//
// Each segment is one nameable cost, drawn to scale against the gap it
// creates, and the FIRST segment is interest alone — which is already
// above the advertised rate before any fee exists, because monthly
// compounding does that on its own. A borrower who understands only
// that one fact has learned the thing most likely to surprise them.
//
// WHAT IS MISSING IS PART OF THE ANSWER
//
// Every cost class the borrower has not entered is listed by name under
// the bar. Not as an error — most loans genuinely have no annual fee —
// but because "this comparison does not include an insurance premium
// you have not told us about" is the difference between a figure
// somebody can act on and one that quietly misleads.

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { FigureValue, Metric, Module, formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { SourceBadge } from '@/components/workspace/controls';
import { fig, StatRow } from '../fields';
import type { RateBreakdown, RateComponentKey } from '@/mortgage/calculations/rateBreakdown';

/* Exported so the Details summary can NAME the costs nobody entered
   rather than only counting them. */
export const COMPONENT_LABELS: Record<RateComponentKey, string> = {
  INTEREST: 'mortgage_rate_component_interest',
  ORIGINATION_FEE: 'mortgage_rate_component_origination',
  VALUATION_FEE: 'mortgage_rate_component_valuation',
  OTHER_ONE_TIME: 'mortgage_rate_component_other_one_time',
  MONTHLY_FEE: 'mortgage_rate_component_monthly_fee',
  ANNUAL_FEE: 'mortgage_rate_component_annual_fee',
  MANDATORY_INSURANCE: 'mortgage_rate_component_insurance',
  OTHER_RECURRING: 'mortgage_rate_component_other_recurring',
};

/* Interest is the ground the fees sit on, so it is the quiet colour and
   every fee is gold. A chart where the biggest band is also the loudest
   would say the interest is the problem, and it usually is not. */
const SEGMENT_TONES = [
  'bg-[hsl(var(--secondary))]',
  'bg-[hsl(var(--gold))]',
  'bg-[hsl(var(--gold)/0.75)]',
  'bg-[hsl(var(--gold)/0.55)]',
  'bg-[hsl(var(--gold)/0.4)]',
  'bg-[hsl(var(--gold)/0.28)]',
  'bg-[hsl(var(--gold)/0.2)]',
  'bg-[hsl(var(--gold)/0.14)]',
];

export function RateView({ breakdown, currency }: { breakdown: RateBreakdown; currency: string }) {
  const { t, lang, isRTL } = useLanguage();
  const locale = intlLocaleFor(lang);

  const total = breakdown.components.reduce((sum, c) => sum + Math.max(0, c.ratePoints), 0);

  return (
    <>
      <Module
        id="rate"
        eyebrowKey="mortgage_mod_rate_eyebrow"
        titleKey="mortgage_mod_rate_title"
        subtitleKey="mortgage_mod_rate_sub"
      >
        <div className="flex flex-wrap items-end gap-4 sm:gap-8">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('mortgage_rate_nominal')}
            </p>
            <p className="mt-1.5 font-display text-3xl font-semibold leading-none text-foreground sm:text-4xl">
              {formatPercent(breakdown.nominalAnnualRatePercent, locale, 2)}
            </p>
            <p className="mt-1.5 max-w-[24ch] text-2xs text-muted-foreground">
              {t('mortgage_rate_nominal_note')}
            </p>
          </div>

          <ArrowRight
            className={cn('mb-8 hidden h-5 w-5 shrink-0 text-muted-foreground sm:block', isRTL && 'scale-x-[-1]')}
            aria-hidden="true"
          />

          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('mortgage_rate_effective')}
            </p>
            <p className="mt-1.5 font-display text-3xl font-semibold leading-none text-[hsl(var(--gold-ink))] sm:text-4xl">
              <FigureValue
                figure={fig(
                  breakdown.effectiveAnnualRatePercent,
                  breakdown.effectiveRateUnavailableReason ?? 'mortgage_effective_rate_unavailable_generic',
                )}
                kind="percent"
                decimals={2}
              />
            </p>
            <p className="mt-1.5 max-w-[26ch] text-2xs text-muted-foreground">
              {t('mortgage_rate_effective_note')}
            </p>
          </div>

          {breakdown.gapPoints !== null ? (
            <div className="min-w-0">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('mortgage_rate_gap')}
              </p>
              <p className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                +{formatPercent(breakdown.gapPoints, locale, 2)}
              </p>
            </div>
          ) : null}
        </div>

        {total > 0 ? (
          <div className="mt-8">
            <div className="flex h-10 w-full overflow-hidden rounded-lg" dir="ltr">
              {breakdown.components.map((component, index) => {
                const share = (Math.max(0, component.ratePoints) / total) * 100;
                if (share <= 0) return null;
                return (
                  <div
                    key={component.key}
                    className={cn('flex items-center justify-center', SEGMENT_TONES[index % SEGMENT_TONES.length])}
                    style={{ width: `${share}%` }}
                    title={`${t(COMPONENT_LABELS[component.key])} · ${formatPercent(component.ratePoints, locale, 2)}`}
                  />
                );
              })}
            </div>

            <ul className="mt-5 space-y-2.5">
              {breakdown.components.map((component, index) => (
                <li key={component.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm',
                      SEGMENT_TONES[index % SEGMENT_TONES.length],
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-sm text-foreground">{t(COMPONENT_LABELS[component.key])}</span>
                  {component.amount > 0 ? (
                    <span className="text-2xs tabular-nums text-muted-foreground">
                      {formatMoney(component.amount, currency, locale)}
                    </span>
                  ) : null}
                  <span className="w-16 shrink-0 text-end text-sm tabular-nums text-foreground">
                    {component.key === 'INTEREST'
                      ? formatPercent(component.ratePoints, locale, 2)
                      : `+${formatPercent(component.ratePoints, locale, 2)}`}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
              {t('mortgage_rate_buildup_note')}
            </p>
          </div>
        ) : null}
      </Module>

      {breakdown.unknownCosts.length ? (
        <Module
          id="rate-unknown"
          eyebrowKey="mortgage_mod_unknown_eyebrow"
          titleKey="mortgage_mod_unknown_title"
          subtitleKey="mortgage_mod_unknown_sub"
        >
          <ul className="flex flex-wrap gap-2">
            {breakdown.unknownCosts.map((key) => (
              <li
                key={key}
                className="rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground"
              >
                {t(COMPONENT_LABELS[key])}
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
            {t('mortgage_rate_unknown_note')}
          </p>
        </Module>
      ) : null}

      {breakdown.bankStatedEffectiveRate !== null ? (
        <Module
          id="rate-bank"
          eyebrowKey="mortgage_mod_bank_rate_eyebrow"
          titleKey="mortgage_mod_bank_rate_title"
          subtitleKey="mortgage_mod_bank_rate_sub"
        >
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase leading-tight tracking-wide text-muted-foreground">
                  {t('mortgage_rate_bank_stated')}
                </p>
                <SourceBadge source="USER" />
              </div>
              <p className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                {formatPercent(breakdown.bankStatedEffectiveRate, locale, 2)}
              </p>
            </div>
            <Metric
              labelKey="mortgage_rate_ours"
              figure={fig(breakdown.effectiveAnnualRatePercent)}
              kind="percent"
              decimals={2}
            />
            <Metric
              labelKey="mortgage_rate_difference"
              figure={fig(breakdown.bankStatedDifferencePoints)}
              kind="percent"
              decimals={2}
              noteKey="mortgage_rate_difference_note"
            />
          </div>
        </Module>
      ) : null}
    </>
  );
}

/** The cost stack as money rather than as rate points. */
export function CostStack({
  breakdown,
  currency,
  totalInterest,
  totalRepayment,
  loanAmount,
}: {
  breakdown: RateBreakdown;
  currency: string;
  totalInterest: number;
  totalRepayment: number;
  loanAmount: number;
}) {
  return (
    <Module
      id="cost-stack"
      eyebrowKey="mortgage_mod_cost_eyebrow"
      titleKey="mortgage_mod_cost_title"
      subtitleKey="mortgage_mod_cost_sub"
    >
      <div className="mt-1">
        <StatRow labelKey="mortgage_cost_principal" value={loanAmount} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_cost_interest" value={totalInterest} kind="money" currency={currency} />
        {breakdown.components
          .filter((c) => c.key !== 'INTEREST' && c.amount > 0)
          .map((c) => (
            <StatRow
              key={c.key}
              labelKey={COMPONENT_LABELS[c.key]}
              value={c.amount}
              kind="money"
              currency={currency}
              tone="muted"
            />
          ))}
        <StatRow labelKey="mortgage_cost_total" value={totalRepayment} kind="money" currency={currency} />
      </div>
    </Module>
  );
}
