// THE TECHNICAL HALF, BEHIND THREE CLOSED DOORS.
//
// Everything here was once a full-width module competing with the
// monthly payment for attention: the effective-rate decomposition, the
// term ladder, the amortization schedule, the fifteen-item checklist.
// None of it was wrong and none of it was wasted — it was simply in
// front of people who had come to find out what a loan costs a month.
//
// So the effective rate keeps a two-line summary up here, because the
// gap between the advertised rate and the real one is the single most
// useful thing this product knows, and everything else opens only when
// somebody asks for it.

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { RateView, CostStack } from './views/RateView';
import { TermsView } from './views/TermsView';
import { ScheduleView } from './views/ScheduleView';
import { ChecklistView } from './views/GuidanceViews';
import type { RateBreakdown } from '@/mortgage/calculations/rateBreakdown';
import type {
  MortgageCalculationResult,
  MortgageInput,
  TermComparisonRow,
} from '@/mortgage/types';

function Drawer({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hm-workspace-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-start"
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? <div id={id} className="space-y-4 border-t border-border p-5 sm:p-6">{children}</div> : null}
    </div>
  );
}

export function DetailsSection({
  input,
  result,
  breakdown,
  termRows,
  currency,
  onSelectTerm,
}: {
  input: MortgageInput | null;
  result: MortgageCalculationResult;
  breakdown: RateBreakdown | null;
  termRows: TermComparisonRow[];
  currency: string;
  onSelectTerm: (months: number) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  return (
    <section id="details" className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-foreground">{t('mortgage_details_title')}</h2>

      {/* ── The real cost, in two lines ── */}
      {breakdown ? (
        <div className="hm-workspace-panel p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                {t('mortgage_details_nominal')}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                {formatPercent(breakdown.nominalAnnualRatePercent, locale, 2)}
              </p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                {t('mortgage_details_effective')}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-[hsl(var(--gold-ink))]">
                {breakdown.effectiveAnnualRatePercent === null
                  ? '—'
                  : formatPercent(breakdown.effectiveAnnualRatePercent, locale, 2)}
              </p>
            </div>
          </div>

          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            {t('mortgage_details_effective_explain')}
          </p>

          {/* Never "there are no other costs" — only "you have not told us
              about these", which is a different statement. */}
          {breakdown.unknownCosts.length ? (
            <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
              {t('mortgage_details_missing_costs', { n: breakdown.unknownCosts.length })}
            </p>
          ) : null}

          <details className="mt-4 group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-[hsl(var(--gold-ink))]">
              {t('mortgage_details_see_breakdown')}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4 space-y-4">
              <RateView breakdown={breakdown} currency={currency} />
              <CostStack
                breakdown={breakdown}
                currency={currency}
                totalInterest={result.totalInterest}
                totalRepayment={result.totalRepayment}
                loanAmount={result.loanAmount}
              />
            </div>
          </details>
        </div>
      ) : null}

      {termRows.length > 1 ? (
        <Drawer id="details-terms" title={t('mortgage_details_terms')}>
          <TermsView rows={termRows} currency={currency} onSelectTerm={onSelectTerm} />
        </Drawer>
      ) : null}

      <Drawer id="details-schedule" title={t('mortgage_details_schedule')}>
        <ScheduleView result={result} currency={currency} />
      </Drawer>

      <Drawer id="details-checklist" title={t('mortgage_details_checklist')}>
        <ChecklistView input={input} />
      </Drawer>
    </section>
  );
}
