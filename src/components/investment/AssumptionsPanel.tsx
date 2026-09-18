// HOMATCH INVESTMENT INTELLIGENCE — the assumptions, and where each came from.
//
// WHY EVERY FIELD SHOWS ITS ORIGIN
//
// This panel is the one place the whole scenario is visible at once, which
// makes it the one place somebody can check whether the number driving a
// conclusion is theirs, the listing's, or a portal sweep's. A grid of bare
// inputs would render all three identically, and the investor would have no
// way to tell that the rent behind their 6.4% net yield is a figure they
// never agreed to.
//
// WHY IT IS COLLAPSED BY DEFAULT ONCE A SCENARIO EXISTS
//
// The product's promise is a consultation, not a form. The form is the
// correction surface: it opens when somebody wants to change something
// precisely, and it stays out of the way otherwise. It is never the entry
// experience.

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentContext } from '@/investment/consultant/context';
import { SUPPORTED_CURRENCIES } from '@/investment/consultant/context';
import { OriginChip } from './primitives';

interface FieldDef {
  field: string;
  labelKey: string;
  kind: 'money' | 'percent' | 'number' | 'months';
  hintKey?: string;
}

interface GroupDef {
  titleKey: string;
  fields: FieldDef[];
  /** Open on first render. The first two groups; the rest on demand. */
  defaultOpen?: boolean;
}

const GROUPS: GroupDef[] = [
  {
    titleKey: 'inv_group_property',
    defaultOpen: true,
    fields: [
      { field: 'purchasePrice', labelKey: 'inv_f_purchase_price', kind: 'money' },
      { field: 'askingPrice', labelKey: 'inv_f_asking_price', kind: 'money', hintKey: 'inv_f_asking_price_hint' },
      { field: 'areaSqm', labelKey: 'inv_f_area', kind: 'number' },
      { field: 'rooms', labelKey: 'inv_f_rooms', kind: 'number' },
      { field: 'bedrooms', labelKey: 'inv_f_bedrooms', kind: 'number' },
      { field: 'floor', labelKey: 'inv_f_floor', kind: 'number' },
    ],
  },
  {
    titleKey: 'inv_group_income',
    defaultOpen: true,
    fields: [
      { field: 'monthlyRent', labelKey: 'inv_f_monthly_rent', kind: 'money' },
      { field: 'vacantMonthsPerYear', labelKey: 'inv_f_vacant_months', kind: 'months', hintKey: 'inv_f_vacant_months_hint' },
      { field: 'otherAnnualIncome', labelKey: 'inv_f_other_income', kind: 'money' },
      { field: 'benchmarkYieldPercent', labelKey: 'inv_f_benchmark_yield', kind: 'percent', hintKey: 'inv_f_benchmark_yield_hint' },
    ],
  },
  {
    titleKey: 'inv_group_operating',
    fields: [
      { field: 'managementPercentOfCollectedRent', labelKey: 'inv_f_management_pct', kind: 'percent', hintKey: 'inv_f_management_pct_hint' },
      { field: 'managementFlatMonthly', labelKey: 'inv_f_management_flat', kind: 'money' },
      { field: 'maintenanceAnnual', labelKey: 'inv_f_maintenance', kind: 'money' },
      { field: 'repairsAnnual', labelKey: 'inv_f_repairs', kind: 'money' },
      { field: 'insuranceAnnual', labelKey: 'inv_f_insurance', kind: 'money' },
      { field: 'propertyTaxAnnual', labelKey: 'inv_f_property_tax', kind: 'money' },
      { field: 'utilitiesPaidByOwnerAnnual', labelKey: 'inv_f_utilities', kind: 'money' },
      { field: 'otherOperatingAnnual', labelKey: 'inv_f_other_operating', kind: 'money' },
      { field: 'lettingFeePerTenancy', labelKey: 'inv_f_letting_fee', kind: 'money' },
      { field: 'tenanciesPerYear', labelKey: 'inv_f_tenancies', kind: 'number' },
    ],
  },
  {
    titleKey: 'inv_group_capital',
    fields: [
      { field: 'acquisitionCosts', labelKey: 'inv_f_acquisition_costs', kind: 'money' },
      { field: 'acquisitionCostPercent', labelKey: 'inv_f_acquisition_pct', kind: 'percent' },
      { field: 'renovationCost', labelKey: 'inv_f_renovation', kind: 'money' },
      { field: 'furnishingCost', labelKey: 'inv_f_furnishing', kind: 'money' },
    ],
  },
  {
    titleKey: 'inv_group_financing',
    fields: [
      { field: 'downPaymentPercent', labelKey: 'inv_f_down_payment_pct', kind: 'percent' },
      { field: 'downPaymentAmount', labelKey: 'inv_f_down_payment_amount', kind: 'money' },
      { field: 'mortgageAnnualRatePercent', labelKey: 'inv_f_mortgage_rate', kind: 'percent' },
      { field: 'mortgageTermMonths', labelKey: 'inv_f_mortgage_term', kind: 'months' },
      { field: 'originationFeePercent', labelKey: 'inv_f_origination_fee', kind: 'percent' },
    ],
  },
  {
    titleKey: 'inv_group_exit',
    fields: [
      { field: 'holdMonths', labelKey: 'inv_f_hold_months', kind: 'months' },
      { field: 'exitPriceAssumption', labelKey: 'inv_f_exit_price', kind: 'money', hintKey: 'inv_f_exit_price_hint' },
      { field: 'sellingCostPercent', labelKey: 'inv_f_selling_cost_pct', kind: 'percent' },
      { field: 'sellingCostAmount', labelKey: 'inv_f_selling_cost_amount', kind: 'money' },
    ],
  },
  {
    titleKey: 'inv_group_location',
    fields: [],
  },
];

export function AssumptionsPanel({
  context,
  onChange,
  onTextChange,
}: {
  context: InvestmentContext;
  onChange: (field: string, value: number | null) => void;
  onTextChange: (field: string, value: string | null) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.titleKey, Boolean(g.defaultOpen)])),
  );
  const currency = context.currency?.value ?? 'USD';

  return (
    <div className="space-y-2">
      {GROUPS.map((group) => {
        const isOpen = open[group.titleKey];
        const filled = group.fields.filter((f) => context[f.field as keyof InvestmentContext]).length;
        return (
          <div key={group.titleKey} className="overflow-hidden rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setOpen((s) => ({ ...s, [group.titleKey]: !s[group.titleKey] }))}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 bg-[hsl(var(--secondary))] px-4 py-3 text-start"
            >
              <span className="text-sm font-medium text-foreground">{t(group.titleKey)}</span>
              <span className="flex items-center gap-2">
                {filled > 0 ? (
                  <span className="text-2xs text-[hsl(var(--gold-ink))]">{filled}</span>
                ) : null}
                <ChevronDown
                  className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </span>
            </button>
            {isOpen ? (
              <div className="space-y-3 px-4 py-4">
                {group.titleKey === 'inv_group_location' ? (
                  <LocationFields context={context} onTextChange={onTextChange} />
                ) : null}
                {group.titleKey === 'inv_group_property' ? (
                  <CurrencyField value={currency} onChange={(v) => onTextChange('currency', v)} />
                ) : null}
                {group.fields.map((definition) => (
                  <NumberField
                    key={definition.field}
                    definition={definition}
                    context={context}
                    currency={currency}
                    onChange={onChange}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NumberField({
  definition,
  context,
  currency,
  onChange,
}: {
  definition: FieldDef;
  context: InvestmentContext;
  currency: string;
  onChange: (field: string, value: number | null) => void;
}) {
  const { t } = useLanguage();
  const entry = context[definition.field as keyof InvestmentContext];
  const suffix =
    definition.kind === 'money'
      ? currency
      : definition.kind === 'percent'
        ? '%'
        : definition.kind === 'months'
          ? t('inv_unit_months_short')
          : null;

  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t(definition.labelKey)}</span>
        {entry ? <OriginChip origin={entry.origin} /> : null}
      </span>
      <span className="flex items-stretch overflow-hidden rounded-lg border border-border bg-[hsl(var(--input))] focus-within:border-[hsl(var(--gold-border))]">
        <input
          type="number"
          inputMode="decimal"
          value={entry?.value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(definition.field, raw === '' ? null : Number(raw));
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base text-foreground outline-none"
        />
        {suffix ? (
          <span className="flex items-center px-3 text-xs text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
      {definition.hintKey ? (
        <span className="mt-1 block text-2xs text-muted-foreground">{t(definition.hintKey)}</span>
      ) : null}
    </label>
  );
}

function CurrencyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted-foreground">{t('inv_f_currency')}</span>
      {/* A native select rather than the Radix one: this surface scopes its
          dark palette to an element, and a portalled listbox renders outside
          it on the light app palette. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-[hsl(var(--input))] px-3 py-2.5 text-base text-foreground outline-none focus:border-[hsl(var(--gold-border))]"
      >
        {SUPPORTED_CURRENCIES.map((code) => (
          <option key={code} value={code} className="bg-[hsl(var(--card))]">
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}

function LocationFields({
  context,
  onTextChange,
}: {
  context: InvestmentContext;
  onTextChange: (field: string, value: string | null) => void;
}) {
  const { t } = useLanguage();
  const fields: Array<{ field: string; labelKey: string }> = [
    { field: 'city', labelKey: 'inv_f_city' },
    { field: 'district', labelKey: 'inv_f_district' },
    { field: 'projectName', labelKey: 'inv_f_project' },
    { field: 'propertyType', labelKey: 'inv_f_property_type' },
  ];
  return (
    <>
      {fields.map(({ field, labelKey }) => {
        const entry = context[field as keyof InvestmentContext];
        return (
          <label key={field} className="block">
            <span className="mb-1.5 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
              {entry ? <OriginChip origin={entry.origin} /> : null}
            </span>
            <input
              type="text"
              dir="auto"
              value={(entry?.value as string) ?? ''}
              onChange={(e) => onTextChange(field, e.target.value === '' ? null : e.target.value)}
              className="w-full rounded-lg border border-border bg-[hsl(var(--input))] px-3 py-2.5 text-base text-foreground outline-none focus:border-[hsl(var(--gold-border))]"
            />
          </label>
        );
      })}
      <p className="text-2xs text-muted-foreground">{t('inv_location_note')}</p>
    </>
  );
}
