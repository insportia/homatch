// THE ANSWER, BEFORE ANY EXPLANATION OF IT.
//
// Four numbers and one sentence. Everything this product knows about
// effective rates, regulatory ceilings and contractual traps is still
// here — one section further down, where somebody who wants it can go
// and find it. What it must never do is stand between a person and the
// figure they came for.
//
// The monthly payment is set large and alone because it is the only one
// of the four that anybody repeats out loud.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import type { MortgageCalculationResult } from '@/mortgage/types';

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </p>
    </div>
  );
}

export function ResultHeadline({
  result,
  currency,
}: {
  result: MortgageCalculationResult;
  currency: string;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const m = (value: number) => formatMoney(value, currency, locale);

  return (
    <section id="result" className="hm-workspace-panel hm-workspace-focus p-5 sm:p-7">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
        {t('mortgage_result_eyebrow')}
      </p>

      <p className="mt-3 font-display text-4xl font-semibold leading-none tabular-nums text-[hsl(var(--gold-ink))] sm:text-5xl">
        {m(result.monthlyPayment)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{t('mortgage_result_monthly_label')}</p>

      <div className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
        <Figure label={t('mortgage_result_loan_amount')} value={m(result.loanAmount)} />
        <Figure label={t('mortgage_result_total_interest')} value={m(result.totalInterest)} />
        <Figure label={t('mortgage_result_total_repayment')} value={m(result.totalRepayment)} />
      </div>

      <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-foreground">
        {t('mortgage_result_sentence', {
          amount: m(result.monthlyPayment),
          years: Math.round((result.amortizationSchedule.length / 12) * 10) / 10,
        })}
      </p>
    </section>
  );
}
