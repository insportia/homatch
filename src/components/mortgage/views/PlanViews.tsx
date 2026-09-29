// HOMATCH HOME FINANCING — the two "what if" topics.
//
// EARLY REPAYMENT and REFINANCING share a shape: enter a change, see
// what it does to the money and the calendar. They also share the one
// rule that matters most in both — a fee nobody has entered is NOT a
// fee of zero, and the result says so in place of the number rather
// than beside it.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Metric, Module, formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { NumberField, StatRow, fig } from '../fields';
import type { PresetContext } from '@/mortgage/presets';
import type { EarlyRepaymentResult, RefinancingResult } from '@/mortgage/types';
import type { DraftField, FinancingDraft } from '../useFinancingSession';

export function EarlyRepaymentView({
  draft,
  set,
  result,
  currency,
  context,
  termMonths,
  monthlyPayment,
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  result: EarlyRepaymentResult | null;
  currency: string;
  context: PresetContext;
  termMonths: number;
  /** The scenario's own monthly payment, for the before/with pair. */
  monthlyPayment: number;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);

  return (
    <>
      <Module
        id="early-input"
        eyebrowKey="mortgage_mod_early_eyebrow"
        titleKey="mortgage_mod_early_title"
        subtitleKey="mortgage_mod_early_sub"
      >
        <div className="space-y-6">
          <NumberField
            field="extraPaymentAmount"
            labelKey="mortgage_label_extra_amount"
            hintKey="mortgage_label_extra_amount_hint"
            kind="money"
            currency={currency}
            value={draft.extraPaymentAmount}
            onChange={(v) => set('extraPaymentAmount', v)}
            context={context}
            required
          />
          <NumberField
            field="extraPaymentMonth"
            labelKey="mortgage_label_extra_month"
            hintKey="mortgage_label_extra_month_hint"
            kind="months"
            currency={currency}
            value={draft.extraPaymentMonth}
            onChange={(v) => set('extraPaymentMonth', v === null ? null : Math.min(v, termMonths))}
            context={context}
            required
          />
          <NumberField
            field="recurringMonthlyExtra"
            labelKey="mortgage_label_recurring_extra"
            hintKey="mortgage_label_recurring_extra_hint"
            kind="money"
            currency={currency}
            value={draft.recurringMonthlyExtra}
            onChange={(v) => set('recurringMonthlyExtra', v)}
            context={context}
          />
          <NumberField
            field="knownEarlyRepaymentFeeFlat"
            labelKey="mortgage_label_early_fee"
            hintKey="mortgage_label_early_fee_hint"
            kind="money"
            currency={currency}
            value={draft.knownEarlyRepaymentFeeFlat}
            onChange={(v) => set('knownEarlyRepaymentFeeFlat', v)}
            context={context}
          />
        </div>
      </Module>

      {result ? (
        <Module
          id="early-result"
          eyebrowKey="mortgage_mod_early_result_eyebrow"
          titleKey="mortgage_mod_early_result_title"
          subtitleKey="mortgage_mod_early_result_sub"
        >
          {/* WHAT THEY CHOSE, read back as one sentence, so nobody has to
              decode four controls to remember the scenario they built. */}
          {draft.extraPaymentAmount !== null && draft.extraPaymentMonth !== null ? (
            <div className="mb-4 max-w-[64ch] rounded-xl border border-border bg-card px-4 py-3.5 shadow-card">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t('mortgage_early_choice_title')}
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-foreground">
                {t(
                  draft.recurringMonthlyExtra ? 'mortgage_early_choice_with_recurring' : 'mortgage_early_choice_once',
                  {
                    when: draft.extraPaymentMonth % 12 === 0
                      ? t('mortgage_early_choice_when_years', { n: draft.extraPaymentMonth / 12 })
                      : t('mortgage_early_choice_when_months', { n: draft.extraPaymentMonth }),
                    amount: formatMoney(draft.extraPaymentAmount, currency, locale),
                    ...(draft.recurringMonthlyExtra
                      ? { extra: formatMoney(draft.recurringMonthlyExtra, currency, locale) }
                      : {}),
                  },
                )}
              </p>
            </div>
          ) : null}

          {/* THE SENTENCE FIRST. What this plan does, in the user's numbers,
              before any table asks to be read. */}
          <p className="max-w-[64ch] rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-3.5 text-[15px] leading-relaxed text-[hsl(var(--gold-ink))]">
            {t('mortgage_early_lead', {
              months: result.monthsSaved,
              saved: formatMoney(result.interestSaved, currency, locale),
            })}
          </p>

          {/* ONE decision, THREE connected columns from the SAME simulator:
              the loan as scheduled, then the two things a bank actually does
              with an early repayment — keep the term and lower the payment,
              or keep the payment and shorten the term. Neither option is
              declared "better"; the numbers carry the trade-off. */}
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t('mortgage_early_before_title')}
              </p>
              <div className="mt-2">
                <StatRow labelKey="mortgage_result_monthly_label" value={monthlyPayment} kind="money" currency={currency} />
                <StatRow labelKey="mortgage_early_payoff_label" value={result.baselinePayoffMonth} kind="months" />
                <StatRow labelKey="mortgage_result_total_interest" value={result.baselineTotalInterest} kind="money" currency={currency} />
                <StatRow labelKey="mortgage_early_total_label" value={result.baselineTotalCost} kind="money" currency={currency} />
              </div>
            </div>
            {result.keepTerm ? (
              <div className="relative overflow-hidden rounded-xl border border-[hsl(var(--gold-border))] bg-card p-4 shadow-hover">
                <span className="absolute inset-y-0 start-0 w-[3px] bg-gold" aria-hidden="true" />
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">
                  {t('mortgage_early_scenario_a_title')}
                </p>
                <div className="mt-2">
                  <StatRow labelKey="mortgage_result_monthly_label" value={result.keepTerm.newMonthlyPayment} kind="money" currency={currency} />
                  <StatRow labelKey="mortgage_early_monthly_saved" value={Math.max(0, result.keepTerm.monthlySaved)} kind="money" currency={currency} />
                  <StatRow labelKey="mortgage_early_payoff_label" value={result.baselinePayoffMonth} kind="months" />
                  <StatRow labelKey="mortgage_result_total_interest" value={result.keepTerm.totalInterest} kind="money" currency={currency} />
                  <StatRow labelKey="mortgage_early_total_label" value={result.keepTerm.totalCost} kind="money" currency={currency} />
                  <StatRow
                    labelKey="mortgage_early_delta_label"
                    value={Math.max(0, result.baselineTotalCost - result.keepTerm.totalCost)}
                    kind="money"
                    currency={currency}
                  />
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t('mortgage_early_keepterm_note')}</p>
              </div>
            ) : null}
            <div className="relative overflow-hidden rounded-xl border border-[hsl(var(--gold-border))] bg-card p-4 shadow-hover">
              <span className="absolute inset-y-0 start-0 w-[3px] bg-gold" aria-hidden="true" />
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">
                {t('mortgage_early_scenario_b_title')}
              </p>
              <div className="mt-2">
                <StatRow labelKey="mortgage_result_monthly_label" value={monthlyPayment} kind="money" currency={currency} />
                <StatRow labelKey="mortgage_early_payoff_label" value={result.newPayoffMonth} kind="months" />
                <StatRow labelKey="mortgage_early_months_saved" value={result.monthsSaved} kind="months" />
                <StatRow labelKey="mortgage_result_total_interest" value={result.totalInterestWithExtra} kind="money" currency={currency} />
                <StatRow labelKey="mortgage_early_total_label" value={result.totalCostWithExtra} kind="money" currency={currency} />
                <StatRow
                  labelKey="mortgage_early_delta_label"
                  value={Math.max(0, result.baselineTotalCost - result.totalCostWithExtra)}
                  kind="money"
                  currency={currency}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            <Metric
              labelKey="mortgage_early_interest_saved"
              figure={fig(result.interestSaved)}
              kind="money"
              currency={currency}
              emphasis
            />
            <Metric labelKey="mortgage_early_months_saved" figure={fig(result.monthsSaved)} kind="months" />
            <Metric
              labelKey="mortgage_early_new_payoff"
              figure={fig(result.newPayoffMonth)}
              kind="months"
              noteKey="mortgage_early_new_payoff_note"
            />
          </div>

          {/* The honesty rule, rendered where the number would be. */}
          <p
            className={cn(
              'mt-6 max-w-[64ch] rounded-lg border px-4 py-3 text-2xs leading-relaxed',
              result.earlyRepaymentFeeIncluded
                ? 'border-border text-muted-foreground'
                : 'border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
            )}
          >
            {result.earlyRepaymentFeeIncluded
              ? t('mortgage_early_fee_included', {
                  amount: formatMoney(draft.knownEarlyRepaymentFeeFlat ?? 0, currency, locale),
                })
              : t('mortgage_early_fee_not_included')}
          </p>
          {/* The one honest legal boundary: this models the calculator's
              assumption, not every bank's contract. */}
          <p className="mt-2 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
            {t('mortgage_early_bank_terms_note')}
          </p>
        </Module>
      ) : null}
    </>
  );
}

export function RefinancingView({
  draft,
  set,
  result,
  currency,
  context,
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  result: RefinancingResult | null;
  currency: string;
  context: PresetContext;
}) {
  const { t } = useLanguage();

  return (
    <>
      <Module
        id="refi-input"
        eyebrowKey="mortgage_mod_refi_eyebrow"
        titleKey="mortgage_mod_refi_title"
        subtitleKey="mortgage_mod_refi_sub"
      >
        <div className="space-y-6">
          <h3 className="font-display text-base font-semibold text-foreground">{t('mortgage_refi_current')}</h3>
          <NumberField
            field="ownRemainingPrincipal"
            labelKey="mortgage_label_own_principal"
            kind="money"
            currency={currency}
            value={draft.ownRemainingPrincipal}
            onChange={(v) => set('ownRemainingPrincipal', v)}
            context={context}
            required
          />
          <NumberField
            field="ownRemainingTermMonths"
            labelKey="mortgage_label_own_term"
            kind="months"
            currency={currency}
            value={draft.ownRemainingTermMonths}
            onChange={(v) => set('ownRemainingTermMonths', v)}
            context={{ ...context, termMonths: undefined }}
            required
          />
          <NumberField
            field="ownNominalRatePercent"
            labelKey="mortgage_label_own_rate"
            kind="percent"
            currency={currency}
            value={draft.ownNominalRatePercent}
            onChange={(v) => set('ownNominalRatePercent', v)}
            context={context}
            required
          />

          <div className="h-px w-full bg-border" />

          <h3 className="font-display text-base font-semibold text-foreground">{t('mortgage_refi_new')}</h3>
          <NumberField
            field="refiNewRatePercent"
            labelKey="mortgage_label_refi_rate"
            kind="percent"
            currency={currency}
            value={draft.refiNewRatePercent}
            onChange={(v) => set('refiNewRatePercent', v)}
            context={context}
            required
          />
          <NumberField
            field="refiNewTermMonths"
            labelKey="mortgage_label_refi_term"
            kind="months"
            currency={currency}
            value={draft.refiNewTermMonths}
            onChange={(v) => set('refiNewTermMonths', v)}
            context={{ ...context, termMonths: undefined }}
            required
          />
          <NumberField
            field="refinancingFeesFlat"
            labelKey="mortgage_label_refi_fees"
            hintKey="mortgage_label_refi_fees_hint"
            kind="money"
            currency={currency}
            value={draft.refinancingFeesFlat}
            onChange={(v) => set('refinancingFeesFlat', v)}
            context={context}
          />
        </div>
      </Module>

      {result ? (
        <Module
          id="refi-result"
          eyebrowKey="mortgage_mod_refi_result_eyebrow"
          titleKey="mortgage_mod_refi_result_title"
          subtitleKey="mortgage_mod_refi_result_sub"
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <Metric
              labelKey="mortgage_refi_payment_before"
              figure={fig(result.monthlyPaymentBefore)}
              kind="money"
              currency={currency}
            />
            <Metric
              labelKey="mortgage_refi_payment_after"
              figure={fig(result.monthlyPaymentAfter)}
              kind="money"
              currency={currency}
            />
          </div>

          <div className="mt-6">
            <StatRow
              labelKey="mortgage_refi_cost_before"
              value={result.currentRemainingTotalCost}
              kind="money"
              currency={currency}
            />
            <StatRow
              labelKey="mortgage_refi_cost_after"
              value={result.newTotalCost}
              kind="money"
              currency={currency}
            />
            <StatRow
              labelKey="mortgage_refi_lifetime_saving"
              value={result.lifetimeSavings}
              kind="money"
              currency={currency}
              tone={result.lifetimeSavings < 0 ? 'negative' : 'default'}
            />
            <StatRow
              labelKey="mortgage_refi_break_even"
              value={result.breakEvenMonths}
              kind="months"
              tone="muted"
            />
          </div>

          {/*
           * The sentence this whole topic exists for. A lower monthly
           * payment almost always comes with a longer term, and a longer
           * term at a lower rate can still cost more in total — which is
           * exactly the case somebody refinancing is most likely to walk
           * into and least likely to check.
           */}
          <p
            className={cn(
              'mt-6 max-w-[64ch] rounded-lg border px-4 py-3 text-sm leading-relaxed',
              result.lifetimeSavings < 0
                ? 'border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] text-[hsl(var(--destructive))]'
                : 'border-border text-muted-foreground',
            )}
          >
            {result.lifetimeSavings < 0
              ? t('mortgage_refi_verdict_costlier')
              : t('mortgage_refi_verdict_cheaper')}
          </p>
          {draft.refinancingFeesFlat === null ? (
            <p className="mt-3 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
              {t('mortgage_refi_no_fee_entered')}
            </p>
          ) : null}
        </Module>
      ) : null}
    </>
  );
}
