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
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  result: EarlyRepaymentResult | null;
  currency: string;
  context: PresetContext;
  termMonths: number;
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
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
            <Metric
              labelKey="mortgage_early_total_cost"
              figure={fig(result.totalCostWithExtra)}
              kind="money"
              currency={currency}
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
