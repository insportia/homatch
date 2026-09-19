// HOMATCH INVESTMENT INTELLIGENCE — the answer, before the detail.
//
// Six figures at the top of every result, in the same six slots whichever
// strategy produced them, so somebody who has run one deal can read the
// next one at a glance.
//
// THE STATE BADGE IS NOT DECORATION
//
// An analysis built on the five required answers and an analysis with every
// cost filled in are both real, and they are not equally trustworthy. The
// badge says which one this is:
//
//   NEEDS MORE   the strategy cannot produce its headline yet, and the
//                missing answers are named right there.
//   ESTIMATE     it can, but questions remain open. Most analyses live
//                here, and pretending otherwise is the temptation this
//                product exists to resist.
//   COMPLETE     every question was answered.
//
// Without it, an ROI computed from a price and a resale alone looks
// exactly like one computed from a full cost stack.

import React from 'react';
import { AlertCircle, CheckCircle2, CircleDashed } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { Figure } from '@/investment/types';
import type { AnalysisState } from '@/investment/strategies/definitions';
import { FigureValue, type FigureKind } from './primitives';

export interface SummaryMetric {
  labelKey: string;
  figure: Figure;
  kind: FigureKind;
  /** The one figure that answers the question the strategy was chosen for. */
  emphasis?: boolean;
  noteKey?: string;
  decimals?: number;
}

export function AnalysisStateBadge({
  state,
  missingLabels,
}: {
  state: AnalysisState;
  missingLabels: string[];
}) {
  const { t } = useLanguage();
  const config = {
    MISSING_INPUT: {
      Icon: AlertCircle,
      labelKey: 'inv_state_needs_more',
      tone: 'border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
    },
    ESTIMATED: {
      Icon: CircleDashed,
      labelKey: 'inv_state_estimate',
      tone: 'border-border bg-[hsl(var(--secondary))] text-muted-foreground',
    },
    COMPLETE: {
      Icon: CheckCircle2,
      labelKey: 'inv_state_complete',
      tone: 'border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]',
    },
  }[state];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-2xs font-medium',
        config.tone,
      )}
      title={missingLabels.length ? missingLabels.join(', ') : undefined}
    >
      <config.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(config.labelKey)}
    </span>
  );
}

export function ResultSummary({
  titleKey,
  flowKey,
  metrics,
  state,
  missingLabels,
  currency,
}: {
  titleKey: string;
  flowKey: string;
  metrics: SummaryMetric[];
  state: AnalysisState;
  missingLabels: string[];
  currency: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="hm-invest-panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">{t(titleKey)}</h2>
          <p className="mt-0.5 text-2xs font-medium uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">
            {t(flowKey)}
          </p>
        </div>
        <AnalysisStateBadge state={state} missingLabels={missingLabels} />
      </header>

      {state === 'MISSING_INPUT' && missingLabels.length ? (
        <p className="border-b border-border bg-[hsl(var(--secondary))] px-5 py-3 text-sm text-muted-foreground">
          {t('inv_summary_needs')}{' '}
          <span className="text-foreground">{missingLabels.join(', ')}</span>
        </p>
      ) : null}

      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-6 lg:divide-x rtl:lg:divide-x-reverse">
        {metrics.map((metric) => (
          <div
            key={metric.labelKey}
            className={cn('p-5', metric.emphasis && 'bg-[hsl(var(--gold-soft))]')}
          >
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(metric.labelKey)}
            </p>
            <p
              className={cn(
                'mt-1.5 font-display text-2xl font-semibold leading-none',
                metric.emphasis ? 'text-[hsl(var(--gold-ink))]' : 'text-foreground',
              )}
            >
              <FigureValue
                figure={metric.figure}
                kind={metric.kind}
                currency={currency}
                decimals={metric.decimals}
              />
            </p>
            {metric.noteKey ? (
              <p className="mt-1.5 text-2xs text-muted-foreground">{t(metric.noteKey)}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
