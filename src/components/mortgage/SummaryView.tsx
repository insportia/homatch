// HOMATCH MORTGAGE — the live summary: one scenario, one answer.
//
// Everything on this page writes into ONE draft and one calculation, and
// this panel is where that fact becomes visible: change a number anywhere
// and this re-renders with it. It says the decision-useful figures first,
// then the one-line meaning of each tool the person actually used. It is
// not a table of contents and it repeats no accordion.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Module, formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { StatRow } from './fields';
import type { AffordabilityResult, EarlyRepaymentResult, MortgageCalculationResult, MortgageInput } from '@/mortgage/types';
import type { SubsidyMatch } from '@/mortgage/rules/subsidy';

const VERDICT_KEY: Record<string, string> = {
  LIKELY_MATCH: 'mortgage_subsidy_verdict_likely',
  NOT_A_MATCH: 'mortgage_subsidy_verdict_no',
  CANNOT_DETERMINE: 'mortgage_subsidy_verdict_unknown',
};

export function SummaryView({
  input,
  result,
  affordability,
  earlyRepayment,
  subsidyMatch,
}: {
  input: MortgageInput;
  result: MortgageCalculationResult;
  affordability: AffordabilityResult | null;
  earlyRepayment: EarlyRepaymentResult | null;
  subsidyMatch: SubsidyMatch | null;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = result.currency;

  return (
    <Module
      id="summary"
      eyebrowKey="mortgage_summary_eyebrow"
      titleKey="mortgage_summary_title"
      subtitleKey="mortgage_summary_sub"
    >
      {/* The scenario, as rows a person compares in one glance. */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <StatRow labelKey="mortgage_label_property_price" value={input.propertyPrice} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_label_down_payment" value={input.downPayment} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_result_loan_amount" value={result.loanAmount} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_label_nominal_rate" value={input.nominalAnnualRatePercent} kind="percent" decimals={2} />
        <StatRow labelKey="mortgage_early_payoff_label" value={input.termMonths} kind="months" tone="muted" />
        <StatRow labelKey="mortgage_result_monthly_label" value={result.monthlyPayment} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_result_total_interest" value={result.totalInterest} kind="money" currency={currency} />
        <StatRow labelKey="mortgage_result_total_repayment" value={result.totalRepayment} kind="money" currency={currency} />
      </div>

      {/* One sentence per tool the person used. Nothing is invented: each
          line renders only when its calculation actually ran. */}
      <ul className="mt-4 space-y-2">
        {affordability ? (
          <li className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
            {t('mortgage_afford_pti_lead', { p: formatPercent(affordability.ptiPercent, locale, 1) })}
            {affordability.ltvPercent !== null
              ? ` ${t('mortgage_afford_ltv_lead', { p: formatPercent(affordability.ltvPercent, locale, 1) })}`
              : ''}
          </li>
        ) : null}
        {earlyRepayment ? (
          <li className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
            {t('mortgage_early_lead', {
              months: earlyRepayment.monthsSaved,
              saved: formatMoney(earlyRepayment.interestSaved, currency, locale),
            })}
          </li>
        ) : null}
        {subsidyMatch ? (
          <li className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
            {t('mortgage_summary_program_prefix')} {t(VERDICT_KEY[subsidyMatch.verdict] ?? VERDICT_KEY.CANNOT_DETERMINE)}
          </li>
        ) : null}
      </ul>

      <p className="mt-4 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_summary_note')}
      </p>
    </Module>
  );
}
