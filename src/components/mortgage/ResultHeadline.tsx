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

import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { rateSensitivity } from '@/mortgage/calculations/rateSensitivity';
import { LabelTerm } from './TermInfo';
import type { MortgageCalculationResult, MortgageInput } from '@/mortgage/types';

function Figure({ label, value, labelKey }: { label: string; value: string; labelKey?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">{label}{labelKey ? <LabelTerm labelKey={labelKey} /> : null}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </p>
    </div>
  );
}

export function ResultHeadline({
  result,
  currency,
  input,
}: {
  result: MortgageCalculationResult;
  currency: string;
  /** The entered scenario, for the rate up and down check. */
  input?: MortgageInput | null;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const m = (value: number) => formatMoney(value, currency, locale);
  const sensitivity = useMemo(() => {
    if (!input) return [];
    try { return rateSensitivity(input); } catch { return []; }
  }, [input]);

  return (
    <section id="result" className="hm-customer-panel hm-customer-focus p-5 sm:p-7">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
        {t('mortgage_result_eyebrow')}
      </p>

      <p className="mt-3 font-display text-4xl font-semibold leading-none tabular-nums text-[hsl(var(--gold-ink))] sm:text-5xl">
        {m(result.monthlyPayment)}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">{t('mortgage_result_monthly_label')}<LabelTerm labelKey="mortgage_result_monthly_label" /></p>

      <div className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
        <Figure labelKey="mortgage_result_loan_amount" label={t('mortgage_result_loan_amount')} value={m(result.loanAmount)} />
        <Figure labelKey="mortgage_result_total_interest" label={t('mortgage_result_total_interest')} value={m(result.totalInterest)} />
        <Figure labelKey="mortgage_result_total_repayment" label={t('mortgage_result_total_repayment')} value={m(result.totalRepayment)} />
      </div>

      <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-foreground">
        {t('mortgage_result_sentence', {
          amount: m(result.monthlyPayment),
          years: Math.round((result.amortizationSchedule.length / 12) * 10) / 10,
        })}
      </p>

      {/* The handoff. Four numbers and a sentence is where a calculator
          stops; this is the line that says the rest of the product is a
          conversation, and it sits with the result rather than as the
          heading of the next box so it reads as one thought. */}
      <p className="mt-3 max-w-[60ch] text-sm font-medium leading-relaxed text-[hsl(var(--gold-ink))]">
        {t('mortgage_result_handoff')}
      </p>

      {/* The one number a bank most often changes: the same loan with the rate moved, never a forecast. */}
      {sensitivity.length > 0 && input ? (
        <details className="group mt-5 rounded-xl border border-border bg-background px-4" data-testid="mortgage-rate-sensitivity">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
            {t('mortgage_rs_title')}
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <p className="text-sm text-muted-foreground">{t('mortgage_rs_note', { rate: formatPercent(input.nominalAnnualRatePercent, locale, 2) })}</p>
          <div className="overflow-x-auto pb-4">
            <table className="mt-3 w-full min-w-[18rem] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 text-start font-medium">{t('mortgage_rs_rate')}</th>
                  <th scope="col" className="py-1.5 text-end font-medium">{t('mortgage_rs_monthly')}</th>
                  <th scope="col" className="py-1.5 text-end font-medium">{t('mortgage_rs_change')}</th>
                  <th scope="col" className="hidden py-1.5 text-end font-medium sm:table-cell">{t('mortgage_rs_interest')}</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((row) => (
                  <tr key={row.deltaPoints} className="border-t border-border">
                    <td className="py-2 tabular-nums text-foreground">{formatPercent(row.ratePercent, locale, 2)}</td>
                    <td className="py-2 text-end tabular-nums text-foreground">{m(row.monthlyPayment)}</td>
                    <td className={row.monthlyChange > 0 ? 'py-2 text-end tabular-nums text-rose-700' : 'py-2 text-end tabular-nums text-emerald-700'}>
                      {row.monthlyChange > 0 ? '+' : '\u2212'}{m(Math.abs(row.monthlyChange))}
                    </td>
                    <td className="hidden py-2 text-end tabular-nums text-foreground sm:table-cell">{m(row.totalInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
