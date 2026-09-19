// THE INPUTS THAT ARE NOT THE CALCULATION.
//
// The five fields anybody arrives with — price, deposit, term, rate,
// currency — moved to the calculator at the top of the page, where
// nothing stands in front of them. What is left here is everything a
// bank's own paperwork adds: the origination fee, the monthly service
// charge, mandatory insurance, valuation, a grace period, the rate
// type, and the effective rate the bank itself quotes. Plus income,
// which only the affordability tool needs.
//
// All of it is optional and all of it is COLLAPSED by default. Nobody
// should have to decline seven questions to get a monthly payment.
//
// Entering any of it makes the effective rate more truthful, which is
// why the section says what its absence costs rather than pretending
// the loan has no fees.

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { ChipField } from '@/components/workspace/controls';
import { NumberField, OptionField } from './fields';
import type { DraftField, FinancingDraft } from './useFinancingSession';

const RATE_TYPES = [
  { value: 'FIXED', labelKey: 'mortgage_rate_type_fixed' },
  { value: 'VARIABLE', labelKey: 'mortgage_rate_type_variable' },
  { value: 'INDEXED', labelKey: 'mortgage_rate_type_indexed' },
];

interface SectionProps {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  summary: string | null;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ id, titleKey, descriptionKey, summary, complete, open, onToggle, children }: SectionProps) {
  const { t } = useLanguage();
  return (
    /* The id was taken as a prop and never applied, so `aria-controls`
       pointed at nothing and no link could reach a section. Found by
       opening the deployed page rather than by reading this file. */
    <section id={id} className="hm-workspace-panel overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{t(titleKey)}</span>
            {complete ? (
              <Check className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
            ) : null}
          </span>
          {/* Wraps rather than truncates: at 390px a one-line clamp drops
              the interest rate off the end of the summary, which is the
              one number in it a reader is looking for. */}
          {!open && summary ? (
            <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{summary}</span>
          ) : null}
          {!open && !summary && descriptionKey ? (
            <span className="mt-1 block truncate text-2xs text-muted-foreground">{t(descriptionKey)}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={`${id}-body`} className="space-y-6 border-t border-border px-5 py-5">
          {descriptionKey ? (
            <p className="-mt-1 text-sm text-muted-foreground">{t(descriptionKey)}</p>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function AdvancedInputs({
  draft,
  set,
  loanAmount,
  monthlyPayment,
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  loanAmount: number | null;
  monthlyPayment: number | null;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = draft.currency;

  const context = useMemo(
    () => ({
      propertyPrice: draft.propertyPrice ?? undefined,
      loanAmount: loanAmount ?? undefined,
      termMonths: draft.termMonths ?? undefined,
      monthlyPayment: monthlyPayment ?? undefined,
      currency,
    }),
    [draft.propertyPrice, draft.termMonths, loanAmount, monthlyPayment, currency],
  );

  const costsComplete =
    draft.originationFeePercent !== null ||
    draft.monthlyFeeFlat !== null ||
    draft.mandatoryInsuranceAnnualFlat !== null;

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, fallback: boolean) => open[id] ?? fallback;
  const toggle = (id: string, fallback: boolean) =>
    setOpen((current) => ({ ...current, [id]: !isOpen(id, fallback) }));

  return (
    <div className="space-y-3">
      <Section
        id="costs"
        titleKey="mortgage_section_costs"
        descriptionKey="mortgage_section_costs_desc"
        summary={costsComplete ? t('mortgage_section_costs_entered') : null}
        complete={costsComplete}
        open={isOpen('costs', false)}
        onToggle={() => toggle('costs', false)}
      >
        <OptionField
          labelKey="mortgage_label_rate_type"
          hintKey="mortgage_label_rate_type_hint"
          options={RATE_TYPES}
          value={draft.rateType}
          onChange={(v) => set('rateType', v)}
        />
        <NumberField
          field="originationFeePercent"
          labelKey="mortgage_label_origination_fee_percent"
          kind="percent"
          currency={currency}
          value={draft.originationFeePercent}
          onChange={(v) => set('originationFeePercent', v)}
          context={context}
        />
        <NumberField
          field="monthlyFeeFlat"
          labelKey="mortgage_label_monthly_fee"
          kind="money"
          currency={currency}
          value={draft.monthlyFeeFlat}
          onChange={(v) => set('monthlyFeeFlat', v)}
          context={context}
        />
        <NumberField
          field="mandatoryInsuranceAnnualFlat"
          labelKey="mortgage_label_insurance_annual"
          kind="money"
          currency={currency}
          value={draft.mandatoryInsuranceAnnualFlat}
          onChange={(v) => set('mandatoryInsuranceAnnualFlat', v)}
          context={context}
        />
        <NumberField
          field="valuationFeeFlat"
          labelKey="mortgage_label_valuation_fee"
          kind="money"
          currency={currency}
          value={draft.valuationFeeFlat}
          onChange={(v) => set('valuationFeeFlat', v)}
          context={context}
        />
        <NumberField
          field="gracePeriodMonths"
          labelKey="mortgage_label_grace_period"
          hintKey="mortgage_label_grace_period_hint"
          kind="months"
          currency={currency}
          value={draft.gracePeriodMonths}
          onChange={(v) => set('gracePeriodMonths', v)}
          context={context}
        />
        <div>
          <span id="mtg-bank-eff" className="mb-2.5 block text-sm font-medium text-foreground">
            {t('mortgage_label_effective_rate_bank')}
          </span>
          <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
            {t('mortgage_label_effective_rate_bank_hint')}
          </p>
          <ChipField
            presets={[]}
            value={draft.effectiveAnnualRatePercentFromBank ?? undefined}
            onChange={(v) => set('effectiveAnnualRatePercentFromBank', v)}
            kind="percent"
            currency={currency}
            labelledBy="mtg-bank-eff"
          />
        </div>
      </Section>

      <Section
        id="income"
        titleKey="mortgage_section_income"
        descriptionKey="mortgage_section_income_desc"
        summary={
          draft.monthlyNetIncome !== null ? formatMoney(draft.monthlyNetIncome, currency, locale) : null
        }
        complete={draft.monthlyNetIncome !== null}
        open={isOpen('income', false)}
        onToggle={() => toggle('income', false)}
      >
        <NumberField
          field="monthlyNetIncome"
          labelKey="mortgage_label_monthly_income"
          kind="money"
          currency={currency}
          value={draft.monthlyNetIncome}
          onChange={(v) => set('monthlyNetIncome', v)}
          context={context}
        />
        <NumberField
          field="existingMonthlyDebtObligations"
          labelKey="mortgage_label_existing_debt"
          hintKey="mortgage_label_existing_debt_hint"
          kind="money"
          currency={currency}
          value={draft.existingMonthlyDebtObligations}
          onChange={(v) => set('existingMonthlyDebtObligations', v)}
          context={context}
        />
      </Section>
    </div>
  );
}
