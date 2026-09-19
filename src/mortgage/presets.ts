// HOMATCH HOME FINANCING — the options you click instead of typing.
//
// Same rule as Investment's preset table: for every number, ask whether
// it can be CHOSEN. Most mortgage inputs can, because most of them are
// either a market convention (a 3% agent fee), a round choice (a 20-year
// term) or a share of a number already entered (a 20% down payment).
//
// WHAT IS DELIBERATELY NOT HERE
//
// The nominal rate. Every other field's suggestions can be justified —
// from the price, from the term, from ordinary practice — but an
// interest rate is quoted by one bank to one borrower on one day, and a
// chip reading "12%" beside an empty field is a number this product
// would be putting in somebody's head. The field stays typed, and the
// page says where to find the real one.
//
// Plain data, no React, so the tests can import it directly.

import type { MortgageInput } from './types.ts';
import { mortgageCurrency } from './currencies.ts';
import type { ValueSource } from '../components/workspace/sources.ts';

export interface MortgagePreset {
  value: number;
  labelKey?: string;
  kind: ValueSource;
  noteKey?: string;
  noteVars?: Record<string, string | number>;
}

const round = (value: number) => Math.round(value * 100) / 100;
const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const plain = (values: readonly number[], kind: ValueSource = 'EXAMPLE'): MortgagePreset[] =>
  values.map((value) => ({ value, kind }));

const DOWN_PAYMENT_PCT = [10, 20, 30, 50];
const TERM_YEARS = [10, 15, 20, 25, 30];
const GRACE_MONTHS = [0, 3, 6, 12];
/* Origination fees are quoted as a share of the loan and cluster tightly
   in this market; these are CONVENTION, not measurements. */
const ORIGINATION_PCT = [0, 0.5, 1, 1.5, 2];
const EXTRA_PAYMENT_MONTHS = [12, 24, 36, 60];

/*
 * FLAT MONEY IS A MULTIPLE OF THE CURRENCY'S OWN SMALL STEP.
 *
 * "0, 5, 10, 20" is a sensible set of monthly service fees in lari and a
 * meaningless one in Turkish lira. These multipliers reproduce the
 * original GEL/USD/EUR figures exactly (their step is 5) and stay in
 * proportion everywhere else. No exchange rate is involved: see the note
 * at the top of ./currencies.ts.
 */
const MONTHLY_FEE_STEPS = [0, 1, 2, 4];
const VALUATION_STEPS = [0, 20, 30, 50];
const INSURANCE_STEPS = [0, 30, 60, 120];
const EXISTING_DEBT_STEPS = [0, 20, 50, 100];
const REFINANCING_FEE_STEPS = [0, 40, 100, 200];
const RECURRING_EXTRA_STEPS = [0, 10, 20, 50];

export interface PresetContext {
  propertyPrice?: number;
  loanAmount?: number;
  termMonths?: number;
  monthlyPayment?: number;
  currency?: string;
}

/**
 * The options for one field, given whatever is already known.
 *
 * Returns an empty list when nothing can be suggested honestly — the
 * field then falls back to typing, which is a cost and therefore a last
 * resort rather than a default.
 */
export function mortgagePresetsFor(field: string, context: PresetContext): MortgagePreset[] {
  const price = context.propertyPrice;
  const loan = context.loanAmount;
  const payment = context.monthlyPayment;
  const money = mortgageCurrency(context.currency);
  /** Flat amounts in the chosen currency's own units. */
  const steps = (multipliers: readonly number[], kind: ValueSource = 'CONVENTION') =>
    plain(multipliers.map((m) => m * money.smallStep), kind);

  switch (field) {
    case 'propertyPrice':
      return plain(money.pricePoints);

    case 'downPayment': {
      // The one field where the percentage IS the decision: nobody
      // chooses "$31,400", they choose "twenty percent".
      if (!positive(price)) return [];
      return DOWN_PAYMENT_PCT.map((pct) => ({
        value: round((price * pct) / 100),
        kind: 'CALCULATED' as const,
        noteKey: 'mortgage_preset_share_of_price',
        noteVars: { pct },
      }));
    }

    case 'termMonths':
      return TERM_YEARS.map((years) => ({
        value: years * 12,
        kind: 'EXAMPLE' as const,
        labelKey: 'mortgage_years_value',
        noteVars: { years },
      }));

    case 'gracePeriodMonths':
      return plain(GRACE_MONTHS, 'CONVENTION');

    case 'originationFeePercent':
      return plain(ORIGINATION_PCT, 'CONVENTION');

    case 'monthlyFeeFlat':
      return steps(MONTHLY_FEE_STEPS);

    case 'valuationFeeFlat':
      // A one-off valuation is a flat professional fee, not a share of
      // anything, so these are round money amounts rather than percentages.
      return steps(VALUATION_STEPS);

    case 'mandatoryInsuranceAnnualFlat': {
      if (!positive(loan)) return steps(INSURANCE_STEPS);
      return [0.1, 0.2, 0.35].map((pct) => ({
        value: round((loan * pct) / 100),
        kind: 'CONVENTION' as const,
        noteKey: 'mortgage_preset_share_of_loan_year',
        noteVars: { pct },
      }));
    }

    case 'monthlyNetIncome': {
      // Suggested from the payment, framed as the PTI it would produce —
      // which is the thing the affordability topic is actually about.
      if (!positive(payment)) return [];
      return [20, 30, 40, 50].map((pti) => ({
        value: Math.round((payment / pti) * 100),
        kind: 'CALCULATED' as const,
        noteKey: 'mortgage_preset_implied_pti',
        noteVars: { pct: pti },
      }));
    }

    case 'existingMonthlyDebtObligations':
      return steps(EXISTING_DEBT_STEPS, 'EXAMPLE');

    case 'extraPaymentAmount': {
      if (positive(payment)) {
        return [1, 3, 6, 12].map((months) => ({
          value: round(payment * months),
          kind: 'CALCULATED' as const,
          noteKey: 'mortgage_preset_months_of_payment',
          noteVars: { n: months },
        }));
      }
      if (!positive(loan)) return [];
      return [1, 5, 10].map((pct) => ({
        value: round((loan * pct) / 100),
        kind: 'EXAMPLE' as const,
        noteKey: 'mortgage_preset_share_of_loan',
        noteVars: { pct },
      }));
    }

    case 'extraPaymentMonth': {
      const term = context.termMonths;
      const candidates = EXTRA_PAYMENT_MONTHS.filter((m) => !positive(term) || m <= term);
      return candidates.map((value) => ({
        value,
        kind: 'EXAMPLE' as const,
        labelKey: value % 12 === 0 ? 'mortgage_preset_after_years' : undefined,
        noteVars: { n: value / 12 },
      }));
    }

    case 'recurringMonthlyExtra': {
      if (!positive(payment)) return steps(RECURRING_EXTRA_STEPS, 'EXAMPLE');
      return [0, 0.1, 0.25, 0.5].map((share) => ({
        value: round(payment * share),
        kind: 'EXAMPLE' as const,
      }));
    }

    case 'refinancingFeesFlat':
      return steps(REFINANCING_FEE_STEPS);

    default:
      return [];
  }
}

/**
 * Values that follow from others and are shown rather than asked.
 *
 * Only one today, and it is the one people most often get wrong: a down
 * payment entered as an amount has a percentage, and a borrower thinking
 * about LTV needs the percentage.
 */
export function mortgageDerivedPercent(input: {
  propertyPrice?: number;
  downPayment?: number;
}): number | null {
  if (!positive(input.propertyPrice) || !positive(input.downPayment)) return null;
  return round((input.downPayment / input.propertyPrice) * 100);
}

/** Every field the advanced section collects, in the order it asks. */
export const ADVANCED_FIELDS: (keyof MortgageInput)[] = [
  'rateType',
  'originationFeePercent',
  'monthlyFeeFlat',
  'mandatoryInsuranceAnnualFlat',
  'valuationFeeFlat',
  'gracePeriodMonths',
  'effectiveAnnualRatePercentFromBank',
];
