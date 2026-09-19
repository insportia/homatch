// HOMATCH HOME FINANCING — entering the loan, mostly by clicking.
//
// Three collapsing sections, only one of which is required: the loan
// itself, then the bank's cost sheet, then income. They collapse into a
// one-line summary once answered, and the topic beside them updates on
// every click — there is nothing to submit.
//
// THE ONE FIELD THAT IS STILL TYPED
//
// The nominal rate. See the note at the top of src/mortgage/presets.ts:
// every other number here can be suggested from something already known
// or from ordinary practice, but an interest rate is quoted by one bank
// to one borrower on one day, and offering "12%" as a chip would be this
// product putting a figure in somebody's head and then calculating with
// it. So it is typed, and it says where to find the real one.

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { ChipField } from '@/components/workspace/controls';
import { NumberField, OptionField } from './fields';
import { mortgageDerivedPercent } from '@/mortgage/presets';
import type { DraftField, FinancingDraft } from './useFinancingSession';

const CURRENCIES = ['GEL', 'USD', 'EUR'];

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
    <section className="hm-workspace-panel overflow-hidden">
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
          {!open && summary ? (
            <span className="mt-1 block truncate text-2xs text-muted-foreground">{summary}</span>
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

export function LoanBuilder({
  draft,
  set,
  loanAmount,
  monthlyPayment,
  errors,
}: {
  draft: FinancingDraft;
  set: (field: DraftField, value: number | string | null) => void;
  loanAmount: number | null;
  monthlyPayment: number | null;
  errors: string[];
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

  const loanComplete =
    draft.propertyPrice !== null &&
    draft.downPayment !== null &&
    draft.termMonths !== null &&
    draft.nominalAnnualRatePercent !== null;

  const costsComplete =
    draft.originationFeePercent !== null ||
    draft.monthlyFeeFlat !== null ||
    draft.mandatoryInsuranceAnnualFlat !== null;

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, fallback: boolean) => open[id] ?? fallback;
  const toggle = (id: string, fallback: boolean) =>
    setOpen((current) => ({ ...current, [id]: !isOpen(id, fallback) }));

  const downPaymentPercent = mortgageDerivedPercent({
    propertyPrice: draft.propertyPrice ?? undefined,
    downPayment: draft.downPayment ?? undefined,
  });

  const loanSummary = loanComplete
    ? [
        formatMoney(draft.propertyPrice as number, currency, locale),
        downPaymentPercent !== null ? `${formatPercent(downPaymentPercent, locale, 0)} ${t('mortgage_down')}` : null,
        t('mortgage_years_value', { years: (draft.termMonths as number) / 12 }),
        formatPercent(draft.nominalAnnualRatePercent as number, locale, 2),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="space-y-3">
      <Section
        id="loan"
        titleKey="mortgage_section_loan"
        descriptionKey="mortgage_section_loan_desc"
        summary={loanSummary}
        complete={loanComplete}
        open={isOpen('loan', !loanComplete)}
        onToggle={() => toggle('loan', !loanComplete)}
      >
        <div>
          <span className="mb-2.5 block text-sm font-medium text-foreground">{t('mortgage_label_currency')}</span>
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-[hsl(var(--secondary))] p-1">
            {CURRENCIES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => set('currency', code)}
                aria-pressed={currency === code}
                className={cn(
                  'min-h-[40px] rounded-lg px-4 text-sm font-medium transition-colors',
                  currency === code
                    ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <NumberField
          field="propertyPrice"
          labelKey="mortgage_label_property_price"
          kind="money"
          currency={currency}
          value={draft.propertyPrice}
          onChange={(v) => set('propertyPrice', v)}
          context={context}
          required
        />

        <NumberField
          field="downPayment"
          labelKey="mortgage_label_down_payment"
          kind="money"
          currency={currency}
          value={draft.downPayment}
          onChange={(v) => set('downPayment', v)}
          context={context}
          required
        >
          {downPaymentPercent !== null ? (
            <p className="mt-2 text-2xs text-muted-foreground">
              {t('mortgage_down_payment_percent_preview', { pct: downPaymentPercent.toFixed(1) })}
            </p>
          ) : null}
        </NumberField>

        <NumberField
          field="termMonths"
          labelKey="mortgage_label_term"
          kind="months"
          currency={currency}
          value={draft.termMonths}
          onChange={(v) => set('termMonths', v)}
          context={context}
          required
        />

        {/* Typed, deliberately. See the file header. */}
        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span id="mtg-rate" className="text-sm font-medium text-foreground">
              {t('mortgage_label_nominal_rate')}
            </span>
            <span className="text-2xs text-muted-foreground">{t('mortgage_required')}</span>
          </div>
          <p className="mb-2.5 max-w-[60ch] text-2xs leading-relaxed text-muted-foreground">
            {t('mortgage_label_nominal_rate_hint')}
          </p>
          <ChipField
            presets={[]}
            value={draft.nominalAnnualRatePercent ?? undefined}
            onChange={(v) => set('nominalAnnualRatePercent', v)}
            kind="percent"
            currency={currency}
            labelledBy="mtg-rate"
          />
        </div>

        {errors.length ? (
          <ul className="space-y-1 rounded-lg border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] px-4 py-3">
            {errors.map((key) => (
              <li key={key} className="text-sm text-[hsl(var(--destructive))]">
                {t(key)}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

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
