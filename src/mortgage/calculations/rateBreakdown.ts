// src/mortgage/calculations/rateBreakdown.ts — DETERMINISTIC MATH ONLY.
//
// WHY THE EFFECTIVE RATE NEEDS TAKING APART
//
// "Nominal 12.5%, effective 13.24%" is a true statement that teaches
// nobody anything. The whole reason two loans with the same advertised
// rate can cost different amounts is that the gap is made of specific,
// nameable costs — and a borrower who cannot see which ones cannot ask
// the bank about them.
//
// HOW THE ATTRIBUTION WORKS, AND WHY THIS METHOD
//
// Build-up, not leave-one-out. Start from the loan with every known cost
// stripped away — which is the nominal rate compounded monthly, and
// nothing else — then add ONE cost class at a time, re-running the same
// IRR from effectiveRate.ts at each step, and record how far the rate
// moved. The steps then sum EXACTLY to the total gap, with no residual to
// explain away.
//
// Leave-one-out was the obvious alternative and it is worse here: the
// contributions do not sum to the gap (fees interact through the discount
// factor), so the UI would have to show a reconciling remainder that
// means nothing to a borrower. Build-up's cost is that the order matters
// a little — a fee added fifth moves the rate marginally less than the
// same fee added second. That order is fixed, documented below, and
// chosen to match how a bank's own cost sheet reads: everything charged
// at signing first, then everything charged every month.
//
// NOTHING IS EVER INVENTED. A cost the borrower has not entered
// contributes nothing AND is reported by name in `unknownCosts`, because
// "we did not include a fee you never told us about" and "this loan has
// no such fee" are different statements and only one of them is true.
import type { MortgageInput } from '../types.ts';
import { computeLoanAmount, roundCurrency } from './amortization.ts';
import { computeEffectiveRate } from './effectiveRate.ts';

/** The cost classes the gap is made of, in the order they are added. */
export type RateComponentKey =
  | 'INTEREST'
  | 'ORIGINATION_FEE'
  | 'VALUATION_FEE'
  | 'OTHER_ONE_TIME'
  | 'MONTHLY_FEE'
  | 'ANNUAL_FEE'
  | 'MANDATORY_INSURANCE'
  | 'OTHER_RECURRING';

export interface RateComponent {
  key: RateComponentKey;
  /** Percentage points this class adds to the effective rate. */
  ratePoints: number;
  /** The money it costs over the life of the loan, as entered. */
  amount: number;
  /** False when the borrower has not supplied this cost at all. */
  supplied: boolean;
}

export interface RateBreakdown {
  nominalAnnualRatePercent: number;
  /** The effective rate with every entered cost included. */
  effectiveAnnualRatePercent: number | null;
  effectiveRateUnavailableReason: string | null;
  /** effective − nominal, in percentage points. Null when unavailable. */
  gapPoints: number | null;
  /** Interest first, then each cost class that was actually supplied. */
  components: RateComponent[];
  /**
   * Cost classes the borrower has NOT entered, as i18n keys. These are
   * the "what could still change this" list — never assumed to be zero.
   */
  unknownCosts: RateComponentKey[];
  /**
   * The bank's own stated effective rate, when supplied, and how far it
   * sits from the one calculated here. A difference is not an error: it
   * usually means the bank's figure includes a cost not entered above.
   */
  bankStatedEffectiveRate: number | null;
  bankStatedDifferencePoints: number | null;
}

/** The cost fields belonging to each class, in build-up order. */
const CLASSES: { key: RateComponentKey; fields: (keyof MortgageInput)[] }[] = [
  { key: 'ORIGINATION_FEE', fields: ['originationFeePercent', 'originationFeeFlat'] },
  { key: 'VALUATION_FEE', fields: ['valuationFeeFlat'] },
  { key: 'OTHER_ONE_TIME', fields: ['otherMandatoryOneTimeCosts'] },
  { key: 'MONTHLY_FEE', fields: ['monthlyFeeFlat'] },
  { key: 'ANNUAL_FEE', fields: ['annualFeeFlat'] },
  { key: 'MANDATORY_INSURANCE', fields: ['mandatoryInsuranceAnnualFlat'] },
  { key: 'OTHER_RECURRING', fields: ['otherMandatoryRecurringMonthlyCosts'] },
];

/** A copy of the input with every cost field in `strip` removed. */
function without(input: MortgageInput, strip: (keyof MortgageInput)[]): MortgageInput {
  const next: MortgageInput = { ...input };
  for (const field of strip) delete next[field];
  return next;
}

const isSet = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** What this cost class actually costs across the whole loan, in money. */
function classAmount(input: MortgageInput, key: RateComponentKey, loanAmount: number): number {
  const years = input.termMonths / 12;
  switch (key) {
    case 'ORIGINATION_FEE':
      return roundCurrency(
        ((input.originationFeePercent ?? 0) / 100) * loanAmount + (input.originationFeeFlat ?? 0),
      );
    case 'VALUATION_FEE':
      return roundCurrency(input.valuationFeeFlat ?? 0);
    case 'OTHER_ONE_TIME':
      return roundCurrency(input.otherMandatoryOneTimeCosts ?? 0);
    case 'MONTHLY_FEE':
      return roundCurrency((input.monthlyFeeFlat ?? 0) * input.termMonths);
    case 'ANNUAL_FEE':
      return roundCurrency((input.annualFeeFlat ?? 0) * years);
    case 'MANDATORY_INSURANCE':
      return roundCurrency((input.mandatoryInsuranceAnnualFlat ?? 0) * years);
    case 'OTHER_RECURRING':
      return roundCurrency((input.otherMandatoryRecurringMonthlyCosts ?? 0) * input.termMonths);
    default:
      return 0;
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildRateBreakdown(input: MortgageInput): RateBreakdown {
  const full = computeEffectiveRate(input);
  const loanAmount = computeLoanAmount(input);
  const everyCostField = CLASSES.flatMap((c) => c.fields);

  const bankStated =
    typeof input.effectiveAnnualRatePercentFromBank === 'number' &&
    Number.isFinite(input.effectiveAnnualRatePercentFromBank)
      ? input.effectiveAnnualRatePercentFromBank
      : null;

  const unknownCosts = CLASSES.filter((c) => !c.fields.some((f) => isSet(input[f]))).map((c) => c.key);

  if (full.effectiveAnnualRatePercent === null) {
    return {
      nominalAnnualRatePercent: input.nominalAnnualRatePercent,
      effectiveAnnualRatePercent: null,
      effectiveRateUnavailableReason: full.unavailableReasonKey,
      gapPoints: null,
      components: [],
      unknownCosts,
      bankStatedEffectiveRate: bankStated,
      bankStatedDifferencePoints: null,
    };
  }

  /*
   * The floor: the same loan with every known cost removed. This is not
   * the nominal rate — monthly compounding alone lifts 12.00% to 12.68%
   * — and saying so is half the lesson. A borrower who thinks the
   * advertised number is what they pay has already been misled once
   * before any fee is added.
   */
  const bare = computeEffectiveRate(without(input, everyCostField));
  const floor = bare.effectiveAnnualRatePercent ?? input.nominalAnnualRatePercent;

  const components: RateComponent[] = [
    {
      key: 'INTEREST',
      ratePoints: round2(floor),
      amount: 0,
      supplied: true,
    },
  ];

  // Add the classes back one at a time, keeping everything not yet added
  // stripped, so each step's delta belongs to exactly one class.
  let previous = floor;
  const added: (keyof MortgageInput)[] = [];
  for (const cls of CLASSES) {
    added.push(...cls.fields);
    const supplied = cls.fields.some((f) => isSet(input[f]));
    if (!supplied) continue;
    const stripped = everyCostField.filter((f) => !added.includes(f));
    const step = computeEffectiveRate(without(input, stripped));
    const rate = step.effectiveAnnualRatePercent;
    if (rate === null) continue;
    components.push({
      key: cls.key,
      ratePoints: round2(rate - previous),
      amount: classAmount(input, cls.key, loanAmount),
      supplied: true,
    });
    previous = rate;
  }

  return {
    nominalAnnualRatePercent: input.nominalAnnualRatePercent,
    effectiveAnnualRatePercent: full.effectiveAnnualRatePercent,
    effectiveRateUnavailableReason: null,
    gapPoints: round2(full.effectiveAnnualRatePercent - input.nominalAnnualRatePercent),
    components,
    unknownCosts,
    bankStatedEffectiveRate: bankStated,
    bankStatedDifferencePoints:
      bankStated === null ? null : round2(bankStated - full.effectiveAnnualRatePercent),
  };
}
